import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { MongoClient } from 'mongodb';

const PENALTY_PER_VIOLATION = 2;
const DEFAULT_RESULT_DELAY_MS = 25 * 60 * 1000;
const DEFAULT_DURATION_SECONDS = 25 * 60;
const OPTION_IDS = ['A', 'B', 'C', 'D'];

function parseEnvText(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    out[key] = value;
  }
  return out;
}

function loadLocalEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const text = readFileSync(envPath, 'utf8');
    return parseEnvText(text);
  } catch {
    return {};
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeExamId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeQuestionId(value) {
  return normalizeText(value).toUpperCase();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasSameOptions(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) {
    return false;
  }

  const bSet = new Set(b);
  return a.every((item) => bSet.has(item));
}

function evaluateSession(session) {
  let correctCount = 0;
  let answeredCount = 0;
  const questionOrder = Array.isArray(session.questionOrder) ? session.questionOrder : [];

  for (const questionId of questionOrder) {
    const question = session.questionSnapshot?.[questionId];
    if (!question) {
      continue;
    }

    const selected = Array.isArray(session.answers?.[questionId]) ? session.answers[questionId] : [];
    if (selected.length > 0) {
      answeredCount += 1;
    }

    const correctOptionIds = Array.isArray(question.correctOptionIds) ? question.correctOptionIds : [];
    if (hasSameOptions(selected, correctOptionIds)) {
      correctCount += 1;
    }
  }

  const totalQuestions = questionOrder.length;
  const rawPercent = totalQuestions === 0 ? 0 : Number(((correctCount / totalQuestions) * 100).toFixed(2));
  const activeViolations = (session.violations ?? []).filter(
    (violation) => !violation?.waived && violation?.deduct !== false
  );
  const waivedViolations = (session.violations ?? []).filter((violation) => Boolean(violation?.waived));
  const penaltyPoints = Number(
    Math.min(rawPercent, activeViolations.length * PENALTY_PER_VIOLATION).toFixed(2)
  );
  const finalPercent = Number(Math.max(0, rawPercent - penaltyPoints).toFixed(2));
  const finalScoreOutOfExam = Number(((finalPercent / 100) * totalQuestions).toFixed(2));
  const finalScoreOutOf40 = Number(((finalPercent / 100) * 40).toFixed(2));

  return {
    totalQuestions,
    answeredCount,
    correctCount,
    rawPercent,
    penaltyPoints,
    violationsCount: activeViolations.length,
    totalViolationsCount: Array.isArray(session.violations) ? session.violations.length : 0,
    waivedViolationsCount: waivedViolations.length,
    finalPercent,
    finalScoreOutOfExam,
    finalScoreOutOf40,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
  };
}

function summariesEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  const keys = [
    'totalQuestions',
    'answeredCount',
    'correctCount',
    'rawPercent',
    'penaltyPoints',
    'violationsCount',
    'totalViolationsCount',
    'waivedViolationsCount',
    'finalPercent',
    'finalScoreOutOfExam',
    'finalScoreOutOf40',
    'penaltyPerViolation',
  ];

  return keys.every((key) => left[key] === right[key]);
}

function buildUserKey(student) {
  return [
    normalizeText(student?.fullName).toLowerCase(),
    normalizeText(student?.classRoom).toLowerCase(),
    normalizeEmail(student?.email),
  ].join('|');
}

function buildStudentKey(student, examId = 'general') {
  return [
    normalizeText(student?.fullName).toLowerCase(),
    normalizeText(student?.classRoom).toLowerCase(),
    normalizeEmail(student?.email),
    normalizeExamId(examId || 'general') || 'general',
  ].join('|');
}

function sanitizeSnapshotQuestion(input, fallbackId = '') {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const id = normalizeQuestionId(input.id || fallbackId);
  if (!id) {
    return null;
  }

  const optionSource = Array.isArray(input.options) ? input.options : [];
  const options = optionSource
    .map((option, index) => ({
      id: normalizeQuestionId(option?.id || OPTION_IDS[index] || ''),
      text: normalizeText(option?.text),
    }))
    .filter((option) => option.id && option.text);

  const allowedOptionIds = new Set(options.map((option) => option.id));
  const correctOptionIds = [...new Set(
    (Array.isArray(input.correctOptionIds) ? input.correctOptionIds : [])
      .map((optionId) => normalizeQuestionId(optionId))
      .filter((optionId) => allowedOptionIds.has(optionId))
  )];

  return {
    ...input,
    id,
    topic: normalizeText(input.topic).toLowerCase(),
    type: normalizeText(input.type).toLowerCase() === 'multi' ? 'multi' : 'single',
    text: normalizeText(input.text),
    options,
    correctOptionIds,
  };
}

function normalizeQuestionSnapshot(snapshotInput) {
  if (!snapshotInput || typeof snapshotInput !== 'object') {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(snapshotInput)) {
    const fallbackId = normalizeQuestionId(key);
    const question = sanitizeSnapshotQuestion(value, fallbackId);
    if (!question) {
      continue;
    }

    const questionId = normalizeQuestionId(question.id || fallbackId);
    if (!questionId) {
      continue;
    }

    normalized[questionId] = {
      ...question,
      id: questionId,
    };
  }

  return normalized;
}

function findQuestionInSnapshot(snapshot, questionId) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const directKey = normalizeQuestionId(questionId);
  if (directKey && snapshot[directKey]) {
    return snapshot[directKey];
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (normalizeQuestionId(key) === directKey) {
      return value;
    }
    if (normalizeQuestionId(value?.id) === directKey) {
      return value;
    }
  }

  return null;
}

function dedupeQuestionIds(ids) {
  const seen = new Set();
  const output = [];

  for (const item of ids) {
    const questionId = normalizeQuestionId(item);
    if (!questionId || seen.has(questionId)) {
      continue;
    }
    seen.add(questionId);
    output.push(questionId);
  }

  return output;
}

function buildQuestionOrder(session, snapshot) {
  const existingOrder = Array.isArray(session.questionOrder) ? session.questionOrder : [];
  const normalizedOrder = dedupeQuestionIds(
    existingOrder.map((questionId) => {
      const snapshotQuestion = findQuestionInSnapshot(snapshot, questionId);
      return snapshotQuestion?.id || questionId;
    })
  );

  if (normalizedOrder.length > 0) {
    return normalizedOrder;
  }

  return dedupeQuestionIds(
    Object.entries(snapshot).map(([key, value]) => normalizeQuestionId(value?.id || key))
  );
}

function resolveQuestionIdFromOrder(order, rawKey) {
  const key = normalizeText(rawKey);
  if (!key || !Array.isArray(order) || order.length === 0) {
    return null;
  }

  const direct = normalizeQuestionId(key);
  if (order.includes(direct)) {
    return direct;
  }

  const numeric = Number(key);
  if (Number.isFinite(numeric)) {
    const asInt = Math.trunc(numeric);
    if (asInt >= 0 && asInt < order.length) {
      return order[asInt];
    }
    if (asInt > 0 && asInt <= order.length) {
      return order[asInt - 1];
    }
  }

  return null;
}

function alignSnapshotWithOrder(snapshot, order, questionByNormalizedId) {
  const nextOrder = [...order];
  const aligned = {};
  let hydratedCount = 0;

  for (const questionId of nextOrder) {
    const existing = findQuestionInSnapshot(snapshot, questionId);
    if (existing) {
      aligned[questionId] = {
        ...existing,
        id: questionId,
      };
      continue;
    }

    const fromBank = questionByNormalizedId.get(normalizeQuestionId(questionId));
    if (fromBank) {
      aligned[questionId] = {
        ...clone(fromBank),
        id: questionId,
      };
      hydratedCount += 1;
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    const questionId = normalizeQuestionId(value?.id || key);
    if (!questionId) {
      continue;
    }

    if (!aligned[questionId]) {
      aligned[questionId] = {
        ...value,
        id: questionId,
      };
    }

    if (!nextOrder.includes(questionId)) {
      nextOrder.push(questionId);
    }
  }

  return {
    questionOrder: nextOrder,
    questionSnapshot: aligned,
    hydratedCount,
  };
}

function sanitizeSelectedOptions(question, input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\s|]+/g)
      : [];

  const allowed = new Set(
    (Array.isArray(question?.options) ? question.options : [])
      .map((option) => normalizeQuestionId(option?.id))
      .filter(Boolean)
  );

  const normalized = [...new Set(
    source
      .map((item) => normalizeQuestionId(item))
      .filter((item) => item && (allowed.size === 0 || allowed.has(item)))
  )];

  return question?.type === 'single' ? normalized.slice(0, 1) : normalized;
}

function remapAnswerMap(input, questionOrder, questionSnapshot) {
  const source = input && typeof input === 'object' ? input : {};
  const mapped = {};
  let remappedKeys = 0;

  for (const [rawKey, value] of Object.entries(source)) {
    const resolvedQuestionId =
      resolveQuestionIdFromOrder(questionOrder, rawKey) ||
      normalizeQuestionId(findQuestionInSnapshot(questionSnapshot, rawKey)?.id || '');

    if (!resolvedQuestionId) {
      continue;
    }

    if (normalizeQuestionId(rawKey) !== resolvedQuestionId) {
      remappedKeys += 1;
    }

    const question = findQuestionInSnapshot(questionSnapshot, resolvedQuestionId);
    mapped[resolvedQuestionId] = sanitizeSelectedOptions(question, value);
  }

  return {
    value: mapped,
    remappedKeys,
  };
}

function remapBooleanMap(input, questionOrder, questionSnapshot) {
  const source = input && typeof input === 'object' ? input : {};
  const mapped = {};
  let remappedKeys = 0;

  for (const [rawKey, value] of Object.entries(source)) {
    const resolvedQuestionId =
      resolveQuestionIdFromOrder(questionOrder, rawKey) ||
      normalizeQuestionId(findQuestionInSnapshot(questionSnapshot, rawKey)?.id || '');
    if (!resolvedQuestionId) {
      continue;
    }

    if (normalizeQuestionId(rawKey) !== resolvedQuestionId) {
      remappedKeys += 1;
    }

    mapped[resolvedQuestionId] = Boolean(value);
  }

  return {
    value: mapped,
    remappedKeys,
  };
}

function normalizeViolations(input) {
  const source = Array.isArray(input) ? input : [];
  const now = Date.now();
  let normalizedCount = 0;

  const violations = source
    .map((violation, index) => {
      if (!violation || typeof violation !== 'object') {
        normalizedCount += 1;
        return null;
      }

      const type =
        normalizeText(violation.type).slice(0, 80) ||
        normalizeText(violation.policy).replace(':monitor_only', '').slice(0, 80) ||
        'legacy_unspecified';
      const detail = normalizeText(violation.detail).slice(0, 160);
      const occurredAt = toPositiveInteger(violation.occurredAt, now);
      const normalized = {
        id: normalizeText(violation.id) || `legacy-${index + 1}-${occurredAt}`,
        type,
        detail,
        occurredAt,
        waived: Boolean(violation.waived),
        deduct: violation.deduct !== false,
        policy: normalizeText(violation.policy) || 'default',
        waivedAt: null,
      };
      normalized.waivedAt = normalized.waived ? toPositiveInteger(violation.waivedAt, occurredAt) : null;

      if (
        normalized.id !== violation.id ||
        normalized.type !== violation.type ||
        normalized.detail !== violation.detail ||
        normalized.occurredAt !== violation.occurredAt ||
        normalized.waived !== Boolean(violation.waived) ||
        normalized.deduct !== (violation.deduct !== false) ||
        normalized.policy !== (violation.policy ?? 'default') ||
        normalized.waivedAt !== (violation.waived ? violation.waivedAt ?? null : null)
      ) {
        normalizedCount += 1;
      }

      return normalized;
    })
    .filter(Boolean);

  return {
    value: violations,
    normalizedCount,
  };
}

function parseArgs(argv) {
  return {
    fix: argv.includes('--fix'),
    finalizeExpired: argv.includes('--finalize-expired'),
    normalizeShape: argv.includes('--normalize-shape') || argv.includes('--normalize'),
  };
}

function normalizeSessionShape(session, context) {
  let changed = false;
  const stats = {
    repairedQuestionOrder: false,
    hydratedSnapshotQuestions: 0,
    remappedAnswerKeys: 0,
    remappedSeenKeys: 0,
    remappedFlaggedKeys: 0,
    normalizedViolationRows: 0,
    relinkedUser: false,
  };

  const normalizedStudent = {
    fullName: normalizeText(session.student?.fullName),
    classRoom: normalizeText(session.student?.classRoom),
    email: normalizeEmail(session.student?.email),
  };
  if (JSON.stringify(normalizedStudent) !== JSON.stringify(session.student ?? {})) {
    session.student = normalizedStudent;
    changed = true;
  }

  const normalizedExamId = normalizeExamId(session.examId) || 'general';
  if ((session.examId ?? '') !== normalizedExamId) {
    session.examId = normalizedExamId;
    changed = true;
  }

  const trialNumber = toPositiveInteger(session.trialNumber, 1);
  if (session.trialNumber !== trialNumber) {
    session.trialNumber = trialNumber;
    changed = true;
  }

  const durationSeconds = toPositiveInteger(session.durationSeconds, DEFAULT_DURATION_SECONDS);
  if (session.durationSeconds !== durationSeconds) {
    session.durationSeconds = durationSeconds;
    changed = true;
  }

  const normalizedSnapshot = normalizeQuestionSnapshot(session.questionSnapshot);
  const questionOrder = buildQuestionOrder(session, normalizedSnapshot);
  const aligned = alignSnapshotWithOrder(normalizedSnapshot, questionOrder, context.questionByNormalizedId);

  if (
    JSON.stringify(session.questionOrder ?? []) !== JSON.stringify(aligned.questionOrder) ||
    JSON.stringify(session.questionSnapshot ?? {}) !== JSON.stringify(aligned.questionSnapshot)
  ) {
    session.questionOrder = aligned.questionOrder;
    session.questionSnapshot = aligned.questionSnapshot;
    changed = true;
    stats.repairedQuestionOrder = true;
    stats.hydratedSnapshotQuestions = aligned.hydratedCount;
  }

  const mappedAnswers = remapAnswerMap(session.answers, session.questionOrder, session.questionSnapshot);
  if (JSON.stringify(session.answers ?? {}) !== JSON.stringify(mappedAnswers.value)) {
    session.answers = mappedAnswers.value;
    changed = true;
  }
  stats.remappedAnswerKeys = mappedAnswers.remappedKeys;

  const mappedSeen = remapBooleanMap(session.seen, session.questionOrder, session.questionSnapshot);
  if (JSON.stringify(session.seen ?? {}) !== JSON.stringify(mappedSeen.value)) {
    session.seen = mappedSeen.value;
    changed = true;
  }
  stats.remappedSeenKeys = mappedSeen.remappedKeys;

  const mappedFlagged = remapBooleanMap(session.flagged, session.questionOrder, session.questionSnapshot);
  if (JSON.stringify(session.flagged ?? {}) !== JSON.stringify(mappedFlagged.value)) {
    session.flagged = mappedFlagged.value;
    changed = true;
  }
  stats.remappedFlaggedKeys = mappedFlagged.remappedKeys;

  const normalizedViolations = normalizeViolations(session.violations);
  if (JSON.stringify(session.violations ?? []) !== JSON.stringify(normalizedViolations.value)) {
    session.violations = normalizedViolations.value;
    changed = true;
  }
  stats.normalizedViolationRows = normalizedViolations.normalizedCount;

  const userKey = buildUserKey(normalizedStudent);
  if ((session.userKey ?? '') !== userKey) {
    session.userKey = userKey;
    changed = true;
    stats.relinkedUser = true;
  }

  const linkedUserId = userKey ? context.userByKey.get(userKey)?.id ?? null : null;
  if (linkedUserId && session.userId !== linkedUserId) {
    session.userId = linkedUserId;
    changed = true;
    stats.relinkedUser = true;
  }

  const studentKey = buildStudentKey(normalizedStudent, normalizedExamId);
  if ((session.studentKey ?? '') !== studentKey) {
    session.studentKey = studentKey;
    changed = true;
  }

  return {
    changed,
    stats,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const localEnv = loadLocalEnv();
  const mongoUri = process.env.MONGO_URI ?? localEnv.MONGO_URI ?? '';
  const dbName = process.env.MONGO_DB_NAME ?? localEnv.MONGO_DB_NAME ?? 'salemexams';
  const mongoDnsServers = process.env.MONGO_DNS_SERVERS ?? localEnv.MONGO_DNS_SERVERS ?? '';
  const resultDelayMsInput = Number(process.env.RESULT_RELEASE_DELAY_MS ?? localEnv.RESULT_RELEASE_DELAY_MS);
  const resultDelayMs =
    Number.isFinite(resultDelayMsInput) && resultDelayMsInput >= 0
      ? Math.round(resultDelayMsInput)
      : DEFAULT_RESULT_DELAY_MS;

  if (!mongoUri) {
    throw new Error('MONGO_URI is not set. Add it to env or .env before running this script.');
  }

  const dnsServers = String(mongoDnsServers)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
  }

  const client = new MongoClient(mongoUri, {
    maxPoolSize: 5,
    minPoolSize: 1,
    retryWrites: true,
  });

  await client.connect();
  const db = client.db(dbName);
  const sessionsCollection = db.collection('sessions');

  const [sessions, users, questions] = await Promise.all([
    sessionsCollection.find({}).toArray(),
    args.normalizeShape ? db.collection('users').find({}).toArray() : Promise.resolve([]),
    args.normalizeShape ? db.collection('questions').find({}).toArray() : Promise.resolve([]),
  ]);

  const userByKey = new Map(
    users
      .map((user) => {
        const fullName = normalizeText(user.fullName);
        const classRoom = normalizeText(user.classRoom);
        const email = normalizeEmail(user.email);
        const userKey = user.userKey || buildUserKey({ fullName, classRoom, email });
        return userKey ? [userKey, { ...user, userKey }] : null;
      })
      .filter(Boolean)
  );

  const questionByNormalizedId = new Map();
  for (const question of questions) {
    const normalizedId = normalizeQuestionId(question.id);
    const snapshotQuestion = sanitizeSnapshotQuestion(question, question.id);
    if (normalizedId && snapshotQuestion) {
      questionByNormalizedId.set(normalizedId, snapshotQuestion);
    }
  }

  let submittedCount = 0;
  let activeCount = 0;
  let missingSummaryCount = 0;
  let zeroAnsweredCount = 0;
  let feedbackCount = 0;
  let fixedCount = 0;
  let finalizedCount = 0;

  let normalizedSessionCount = 0;
  let repairedOrderCount = 0;
  let hydratedSnapshotQuestionCount = 0;
  let remappedAnswerKeyCount = 0;
  let remappedSeenKeyCount = 0;
  let remappedFlaggedKeyCount = 0;
  let normalizedViolationRowCount = 0;
  let relinkedUserCount = 0;

  const samples = [];
  const now = Date.now();

  for (const rawSession of sessions) {
    const session = { ...rawSession };
    const isSubmitted = Boolean(session.submittedAt);
    const isExpired = !isSubmitted && Number.isFinite(Number(session.expiresAt)) && Number(session.expiresAt) <= now;

    if (isSubmitted) {
      submittedCount += 1;
    } else {
      activeCount += 1;
    }

    if (session.feedback?.rating || session.feedback?.comment) {
      feedbackCount += 1;
    }

    let changed = false;

    if (args.normalizeShape) {
      const normalized = normalizeSessionShape(session, {
        userByKey,
        questionByNormalizedId,
      });
      if (normalized.changed) {
        changed = true;
        normalizedSessionCount += 1;
      }
      if (normalized.stats.repairedQuestionOrder) {
        repairedOrderCount += 1;
      }
      hydratedSnapshotQuestionCount += normalized.stats.hydratedSnapshotQuestions;
      remappedAnswerKeyCount += normalized.stats.remappedAnswerKeys;
      remappedSeenKeyCount += normalized.stats.remappedSeenKeys;
      remappedFlaggedKeyCount += normalized.stats.remappedFlaggedKeys;
      normalizedViolationRowCount += normalized.stats.normalizedViolationRows;
      if (normalized.stats.relinkedUser) {
        relinkedUserCount += 1;
      }
    }

    if (!session.submittedAt && args.finalizeExpired && isExpired) {
      session.submittedAt = now;
      finalizedCount += 1;
      changed = true;
    }

    if (session.submittedAt) {
      const computed = evaluateSession(session);
      if (!session.summary || !summariesEqual(session.summary, computed)) {
        missingSummaryCount += session.summary ? 0 : 1;
        session.summary = computed;
        changed = true;
      }

      if ((session.summary?.answeredCount ?? 0) === 0) {
        zeroAnsweredCount += 1;
      }

      const expectedReleaseAt = Number(session.submittedAt) + resultDelayMs;
      const storedReleaseAt = Number(session.resultsAvailableAt);
      if (!Number.isFinite(storedReleaseAt) || storedReleaseAt <= 0) {
        session.resultsAvailableAt = expectedReleaseAt;
        changed = true;
      }

      if (samples.length < 20) {
        samples.push({
          id: session.id,
          student: session.student?.fullName ?? 'Unknown',
          classRoom: session.student?.classRoom ?? 'Unknown',
          startedAt: session.startedAt ?? null,
          submittedAt: session.submittedAt ?? null,
          answeredCount: session.summary?.answeredCount ?? 0,
          rawPercent: session.summary?.rawPercent ?? 0,
          finalPercent: session.summary?.finalPercent ?? 0,
          feedbackRating: session.feedback?.rating ?? null,
          hasFeedbackComment: Boolean((session.feedback?.comment ?? '').trim()),
        });
      }
    }

    if (args.fix && changed) {
      await sessionsCollection.replaceOne({ _id: rawSession._id }, session, { upsert: false });
      fixedCount += 1;
    }
  }

  await client.close();

  const report = {
    inspectedAt: new Date().toISOString(),
    dbName,
    totalSessions: sessions.length,
    submittedCount,
    activeCount,
    feedbackCount,
    missingSummaryCount,
    zeroAnsweredSubmittedCount: zeroAnsweredCount,
    finalizedExpiredCount: finalizedCount,
    normalizedSessionCount,
    repairedOrderCount,
    hydratedSnapshotQuestionCount,
    remappedAnswerKeyCount,
    remappedSeenKeyCount,
    remappedFlaggedKeyCount,
    normalizedViolationRowCount,
    relinkedUserCount,
    fixedCount,
    mode: args.fix ? 'fix' : 'read-only',
    finalizeExpired: args.finalizeExpired,
    normalizeShape: args.normalizeShape,
    sampleSubmittedSessions: samples,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
