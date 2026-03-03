import { CLASS_OPTIONS, EXAM_DURATION_SECONDS, EXAM_QUESTION_COUNT } from './questions.js';
import { getCollection } from './db.js';

const COLLECTION_NAME = 'exams';
const EXAM_ID_PATTERN = /^[a-z0-9-]{2,48}$/;
const DEFAULT_MAX_ATTEMPTS_INPUT = Number(process.env.DEFAULT_MAX_ATTEMPTS ?? 3);
const DEFAULT_MAX_ATTEMPTS = Number.isFinite(DEFAULT_MAX_ATTEMPTS_INPUT)
  ? Math.max(1, Math.min(50, Math.round(DEFAULT_MAX_ATTEMPTS_INPUT)))
  : 3;

let initialized = false;
let initializingPromise = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function toExamId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeExamId(value) {
  const examId = toExamId(value);
  return EXAM_ID_PATTERN.test(examId) ? examId : '';
}

function sanitizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }

  return fallback;
}

function sanitizePositiveInteger(value, fallback, min = 1, max = 7200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    return fallback;
  }

  return rounded;
}

function sanitizeAllowedClasses(value, fallback = CLASS_OPTIONS) {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  const classes = [];

  for (const item of source) {
    const classRoom = normalizeText(item);
    if (!CLASS_OPTIONS.includes(classRoom) || seen.has(classRoom)) {
      continue;
    }

    seen.add(classRoom);
    classes.push(classRoom);
  }

  return classes.length ? classes : [...CLASS_OPTIONS];
}

function sanitizeQuestionIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const questionIds = [];

  for (const item of value) {
    const questionId = normalizeText(item).toUpperCase();
    if (!questionId || seen.has(questionId)) {
      continue;
    }

    seen.add(questionId);
    questionIds.push(questionId);
  }

  return questionIds;
}

function normalizeExamRecord(input, { fallbackId = '', fallbackCreatedAt = Date.now() } = {}) {
  const id = sanitizeExamId(input?.id ?? fallbackId);
  if (!id) {
    throw new Error('Invalid exam ID. Use letters, numbers, and dashes only.');
  }

  const title = normalizeText(input?.title);
  if (title.length < 3) {
    throw new Error('Exam title must be at least 3 characters.');
  }

  const mode = normalizeText(input?.mode).toLowerCase() === 'pool' ? 'pool' : 'fixed';
  const questionIds = sanitizeQuestionIds(input?.questionIds);

  let questionCount = sanitizePositiveInteger(input?.questionCount, EXAM_QUESTION_COUNT, 1, 500);
  if (mode === 'fixed') {
    if (!questionIds.length) {
      throw new Error('Fixed exam must include at least one question ID.');
    }

    questionCount = Math.min(questionCount, questionIds.length);
  }

  const createdAt = sanitizePositiveInteger(input?.createdAt, fallbackCreatedAt, 1, 9_999_999_999_999);
  const updatedAt = sanitizePositiveInteger(input?.updatedAt, Date.now(), 1, 9_999_999_999_999);

  return {
    id,
    title,
    description: normalizeText(input?.description ?? ''),
    mode,
    questionIds,
    questionCount,
    durationSeconds: sanitizePositiveInteger(input?.durationSeconds, EXAM_DURATION_SECONDS, 60, 3 * 60 * 60),
    maxAttempts: sanitizePositiveInteger(input?.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 50),
    allowedClasses: sanitizeAllowedClasses(input?.allowedClasses),
    published: sanitizeBoolean(input?.published, true),
    proctoring: {
      tab_switch: sanitizeBoolean(input?.proctoring?.tab_switch, true),
      window_blur: sanitizeBoolean(input?.proctoring?.window_blur, true),
      fullscreen_exit: sanitizeBoolean(input?.proctoring?.fullscreen_exit, true),
      right_click: sanitizeBoolean(input?.proctoring?.right_click, true),
      restricted_key: sanitizeBoolean(input?.proctoring?.restricted_key, true),
      deductTabSwitch: sanitizeBoolean(input?.proctoring?.deductTabSwitch, true),
      deductWindowBlur: sanitizeBoolean(input?.proctoring?.deductWindowBlur, true),
      deductFullscreenExit: sanitizeBoolean(input?.proctoring?.deductFullscreenExit, true),
      deductRightClick: sanitizeBoolean(input?.proctoring?.deductRightClick, false),
      deductRestrictedKey: sanitizeBoolean(input?.proctoring?.deductRestrictedKey, false),
    },
    isDefault: id === 'general' || sanitizeBoolean(input?.isDefault, false),
    createdAt,
    updatedAt,
  };
}

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
}

function defaultGeneralExam() {
  const now = Date.now();
  return {
    id: 'general',
    title: 'General Exam Pool',
    description: 'General computer fundamentals exam pool.',
    mode: 'pool',
    questionIds: [],
    questionCount: EXAM_QUESTION_COUNT,
    durationSeconds: EXAM_DURATION_SECONDS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    allowedClasses: [...CLASS_OPTIONS],
    published: true,
    proctoring: {
      tab_switch: true,
      window_blur: true,
      fullscreen_exit: true,
      right_click: true,
      restricted_key: true,
      deductTabSwitch: true,
      deductWindowBlur: true,
      deductFullscreenExit: true,
      deductRightClick: false,
      deductRestrictedKey: false,
    },
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function sortExamRecords(exams) {
  const copy = [...exams];
  copy.sort((left, right) => {
    if (left.id === 'general') {
      return -1;
    }
    if (right.id === 'general') {
      return 1;
    }

    return left.title.localeCompare(right.title);
  });

  return copy;
}

async function ensureInitialized() {
  if (initialized) {
    return;
  }

  if (initializingPromise) {
    await initializingPromise;
    return;
  }

  initializingPromise = (async () => {
    const collection = await getCollection(COLLECTION_NAME);
    await collection.createIndex({ id: 1 }, { unique: true, name: 'idx_exam_id' });
    await collection.createIndex({ published: 1 }, { name: 'idx_exam_published' });

    const general = await collection.findOne({ id: 'general' });
    if (!general) {
      try {
        await collection.insertOne(defaultGeneralExam());
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
      }
    }

    initialized = true;
  })();

  try {
    await initializingPromise;
  } finally {
    if (!initialized) {
      initializingPromise = null;
    }
  }
}

function buildUniqueExamId(existingExams, preferredId) {
  const base = sanitizeExamId(preferredId) || `exam-${Date.now()}`;

  if (!existingExams.some((exam) => exam.id === base)) {
    return base;
  }

  let suffix = 2;
  while (existingExams.some((exam) => exam.id === `${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export async function listExams() {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const exams = await collection.find({}).toArray();
  return sortExamRecords(exams.map((exam) => clone(stripMongoId(exam))));
}

export async function getExam(examId) {
  await ensureInitialized();
  const id = sanitizeExamId(examId);
  if (!id) {
    return null;
  }

  const collection = await getCollection(COLLECTION_NAME);
  const exam = await collection.findOne({ id });
  return exam ? clone(stripMongoId(exam)) : null;
}

export async function createExam(payload) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const existingExams = await listExams();

  const id = buildUniqueExamId(existingExams, payload?.id ?? payload?.title);
  const next = normalizeExamRecord(
    {
      ...payload,
      id,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    { fallbackId: id }
  );

  await collection.insertOne(next);
  return clone(next);
}

export async function updateExam(examId, patch) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  const id = sanitizeExamId(examId);
  if (!id) {
    throw new Error('Exam not found.');
  }

  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new Error('Exam not found.');
  }

  const normalizedExisting = stripMongoId(existing);
  const merged = normalizeExamRecord(
    {
      ...normalizedExisting,
      ...patch,
      id: normalizedExisting.id,
      isDefault: normalizedExisting.id === 'general' ? true : normalizedExisting.isDefault,
      createdAt: normalizedExisting.createdAt,
      updatedAt: Date.now(),
    },
    { fallbackId: normalizedExisting.id, fallbackCreatedAt: normalizedExisting.createdAt }
  );

  await collection.replaceOne({ id }, merged, { upsert: false });
  return clone(merged);
}

export async function attachExamQuestionIds(examId, questionIds) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  const id = sanitizeExamId(examId);
  if (!id) {
    throw new Error('Exam not found.');
  }

  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new Error('Exam not found.');
  }

  const normalizedExisting = stripMongoId(existing);
  const mergedIds = sanitizeQuestionIds([...(normalizedExisting.questionIds ?? []), ...(questionIds ?? [])]);

  const next = normalizeExamRecord(
    {
      ...normalizedExisting,
      mode: 'fixed',
      questionIds: mergedIds,
      questionCount:
        normalizedExisting.mode === 'fixed'
          ? Math.min(normalizedExisting.questionCount, mergedIds.length)
          : mergedIds.length,
      updatedAt: Date.now(),
    },
    { fallbackId: normalizedExisting.id, fallbackCreatedAt: normalizedExisting.createdAt }
  );

  await collection.replaceOne({ id }, next, { upsert: false });
  return clone(next);
}

export function toPublicExam(exam) {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    mode: exam.mode,
    questionCount: exam.questionCount,
    durationSeconds: exam.durationSeconds,
    maxAttempts: exam.maxAttempts,
    allowedClasses: exam.allowedClasses,
    published: exam.published,
    proctoring: exam.proctoring,
    isDefault: exam.isDefault,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
  };
}
