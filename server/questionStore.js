import { DEFAULT_QUESTION_BANK } from './questions.js';
import { getCollection } from './db.js';
import { validateQuestion } from './questionModel.js';

const COLLECTION_NAME = 'questions';
let initialized = false;
let initializingPromise = null;

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeExamId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractNumericId(questionId) {
  const match = /^Q(\d+)$/i.exec(questionId ?? '');
  return match ? Number(match[1]) : 0;
}

async function getNextQuestionId(collection) {
  const all = await collection.find({}, { projection: { id: 1 } }).toArray();
  const maxId = all.reduce((max, item) => {
    const parsed = extractNumericId(item.id);
    return parsed > max ? parsed : max;
  }, 0);

  return `Q${String(maxId + 1).padStart(3, '0')}`;
}

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
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
    await collection.createIndex({ id: 1 }, { unique: true, name: 'idx_question_id' });
    await collection.createIndex({ sourceExamId: 1 }, { name: 'idx_question_source_exam_id' });

    const count = await collection.estimatedDocumentCount();
    if (count === 0) {
      const defaults = DEFAULT_QUESTION_BANK.map((item) =>
        validateQuestion({ ...item, sourceExamId: item.sourceExamId ?? 'general' }, item.id)
      );

      if (defaults.length > 0) {
        try {
          await collection.insertMany(defaults, { ordered: false });
        } catch (error) {
          // If another concurrent initializer inserted rows first, ignore duplicate-key races.
          if (error?.code !== 11000 && error?.name !== 'MongoBulkWriteError') {
            throw error;
          }
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

// The question bank is read on every exam start and by the public meta endpoint, but only
// changes through the admin dashboard. Cache it briefly; every write invalidates immediately.
const QUESTION_CACHE_TTL_MS = 15_000;
let questionCache = null;
let questionCacheLoad = null;

function invalidateQuestionCache() {
  questionCache = null;
  questionCacheLoad = null;
}

async function loadQuestionRows() {
  if (questionCache && questionCache.expiresAt > Date.now()) {
    return questionCache.rows;
  }

  if (!questionCacheLoad) {
    questionCacheLoad = (async () => {
      const collection = await getCollection(COLLECTION_NAME);
      const rows = (await collection.find({}).toArray()).map((item) => stripMongoId(item));
      questionCache = { rows, expiresAt: Date.now() + QUESTION_CACHE_TTL_MS };
      return rows;
    })().finally(() => {
      questionCacheLoad = null;
    });
  }

  return questionCacheLoad;
}

export async function getQuestionPool() {
  await ensureInitialized();
  return clone(await loadQuestionRows());
}

export async function getQuestionByIdMap() {
  const questions = await getQuestionPool();
  return new Map(questions.map((question) => [question.id, question]));
}

export async function getQuestionPoolCount() {
  await ensureInitialized();
  return (await loadQuestionRows()).length;
}

export async function addQuestion(payload) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  const generatedId = normalizeText(payload?.id) || (await getNextQuestionId(collection));
  const nextQuestion = validateQuestion(payload, generatedId);

  const existing = await collection.findOne({ id: nextQuestion.id });
  if (existing) {
    throw new Error('Question ID already exists.');
  }

  await collection.insertOne({ ...nextQuestion });
  invalidateQuestionCache();
  return clone(nextQuestion);
}

export async function getQuestion(questionId) {
  await ensureInitialized();
  const id = normalizeText(questionId).toUpperCase();
  const found = (await loadQuestionRows()).find((question) => question.id === id);
  return found ? clone(found) : null;
}

export async function updateQuestion(questionId, payload) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const id = normalizeText(questionId).toUpperCase();
  const existing = await collection.findOne({ id });
  if (!existing) {
    return null;
  }

  // The ID never changes. Exam sessions keep their own snapshot of each question, so editing
  // here only affects exams started from now on.
  const nextQuestion = validateQuestion(
    {
      ...stripMongoId(existing),
      ...payload,
      id,
      sourceExamId: payload?.sourceExamId ?? existing.sourceExamId,
    },
    id
  );

  await collection.replaceOne({ id }, nextQuestion, { upsert: false });
  invalidateQuestionCache();
  return clone(nextQuestion);
}

export async function deleteQuestion(questionId) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const id = normalizeText(questionId).toUpperCase();
  const result = await collection.deleteOne({ id });
  invalidateQuestionCache();
  return (result.deletedCount ?? 0) > 0;
}

export async function deleteQuestionsBySourceExam(examId) {
  await ensureInitialized();
  const sourceExamId = normalizeExamId(examId);
  if (!sourceExamId || sourceExamId === 'general') {
    return 0;
  }

  const collection = await getCollection(COLLECTION_NAME);
  const result = await collection.deleteMany({ sourceExamId });
  invalidateQuestionCache();
  return result.deletedCount ?? 0;
}
