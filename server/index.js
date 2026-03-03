import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { CLASS_OPTIONS, EXAM_DURATION_SECONDS, EXAM_QUESTION_COUNT } from './questions.js';
import { addQuestion, getQuestionByIdMap, getQuestionPool } from './questionStore.js';
import {
  createExam,
  getExam,
  listExams,
  toPublicExam,
  updateExam,
} from './examStore.js';
import {
  buildUserKey,
  createPasswordAssistanceRequest,
  createUserFromDefaultPassword,
  getUserById,
  getUserByKey,
  listPasswordAssistanceRequests,
  listUsers,
  resolvePasswordAssistanceRequest,
  toPublicUserRecord,
  updateUser,
  updateUserPassword,
  touchUserLogin,
} from './userStore.js';
import { hashPasswordScrypt, parseScryptHash, verifyPasswordScrypt } from './authUtils.js';
import {
  deleteSession,
  deleteSessions,
  getSession,
  listSessions,
  saveSession,
  updateSession,
} from './store.js';

const PORT = Number(process.env.PORT ?? 4000);
const PENALTY_PER_VIOLATION = 2;
const ADMIN_PASSCODE_HASH = process.env.ADMIN_PASSCODE_HASH ?? '';
const ADMIN_TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000;
const STUDENT_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const RESULT_RELEASE_DELAY_MS_INPUT = Number(process.env.RESULT_RELEASE_DELAY_MS ?? 25 * 60 * 1000);
const RESULT_RELEASE_DELAY_MS =
  Number.isFinite(RESULT_RELEASE_DELAY_MS_INPUT) && RESULT_RELEASE_DELAY_MS_INPUT >= 0
    ? Math.round(RESULT_RELEASE_DELAY_MS_INPUT)
    : 25 * 60 * 1000;
const OPTION_IDS = ['A', 'B', 'C', 'D'];
const KEEP_ALIVE_ENABLED = String(process.env.KEEP_ALIVE_ENABLED ?? 'true').toLowerCase() === 'true';
const KEEP_ALIVE_URL = String(process.env.KEEP_ALIVE_URL ?? '').trim();
const KEEP_ALIVE_INTERVAL_MS_INPUT = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? 5 * 60 * 1000);
const KEEP_ALIVE_INTERVAL_MS =
  Number.isFinite(KEEP_ALIVE_INTERVAL_MS_INPUT) && KEEP_ALIVE_INTERVAL_MS_INPUT >= 60_000
    ? KEEP_ALIVE_INTERVAL_MS_INPUT
    : 5 * 60 * 1000;

const adminTokens = new Map();
const studentTokens = new Map();

function shuffleArray(items) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function parseSessionIdsInput(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((id) => normalizeName(id)).filter(Boolean))];
}

function parseSessionIdsFromRequest(req) {
  const fromBody = parseSessionIdsInput(req.body?.sessionIds);
  if (fromBody.length > 0) {
    return fromBody;
  }

  const queryValue = req.query?.sessionIds ?? req.query?.ids ?? '';
  if (typeof queryValue !== 'string') {
    return [];
  }

  return [...new Set(queryValue.split(',').map((id) => normalizeName(id)).filter(Boolean))];
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeExamId(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProctoringPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    tab_switch: source.tab_switch !== false,
    window_blur: source.window_blur !== false,
    fullscreen_exit: source.fullscreen_exit !== false,
    right_click: source.right_click !== false,
    restricted_key: source.restricted_key !== false,
    deductTabSwitch: source.deductTabSwitch !== false,
    deductWindowBlur: source.deductWindowBlur !== false,
    deductFullscreenExit: source.deductFullscreenExit !== false,
    deductRightClick: source.deductRightClick === true,
    deductRestrictedKey: source.deductRestrictedKey === true,
  };
}

function buildStudentKey(student, examId = '') {
  const fullName = normalizeName(student?.fullName).toLowerCase();
  const classRoom = normalizeName(student?.classRoom).toLowerCase();
  const email = normalizeEmail(student?.email);
  const safeExamId = normalizeExamId(examId || student?.examId || '');
  return `${fullName}|${classRoom}|${email}|${safeExamId}`;
}

function normalizeStoredViolation(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const type = normalizeName(value.type).slice(0, 80);
  const detail = normalizeName(value.detail).slice(0, 160);
  if (!type) {
    return null;
  }

  const occurredAtInput = Number(value.occurredAt);
  const occurredAt = Number.isFinite(occurredAtInput) && occurredAtInput > 0
    ? occurredAtInput
    : Date.now();

  return {
    id: normalizeName(value.id) || randomUUID(),
    type,
    detail,
    occurredAt,
    waived: Boolean(value.waived),
    deduct: value.deduct !== false,
    policy: normalizeName(value.policy) || 'default',
    waivedAt:
      Number.isFinite(Number(value.waivedAt)) && Number(value.waivedAt) > 0
        ? Number(value.waivedAt)
        : null,
  };
}

function getActiveViolations(session) {
  return (session.violations ?? []).filter((violation) => !violation.waived && violation.deduct !== false);
}

function getWaivedViolations(session) {
  return (session.violations ?? []).filter((violation) => violation.waived);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function sanitizeRating(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function normalizeFeedbackComment(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ').slice(0, 600);
}

function sanitizeFeedbackPayload(payload) {
  const rating = sanitizeRating(payload?.rating);
  const comment = normalizeFeedbackComment(payload?.comment);

  if (!rating && !comment) {
    return null;
  }

  return {
    rating,
    comment,
    submittedAt: Date.now(),
  };
}

function normalizeStoredFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object') {
    return null;
  }

  const rating = sanitizeRating(feedback.rating);
  const comment = normalizeFeedbackComment(feedback.comment);
  if (!rating && !comment) {
    return null;
  }

  const submittedAtInput = Number(feedback.submittedAt);
  const submittedAt = Number.isFinite(submittedAtInput) && submittedAtInput > 0
    ? submittedAtInput
    : Date.now();

  if (feedback.rating === rating && feedback.comment === comment && feedback.submittedAt === submittedAt) {
    return feedback;
  }

  return {
    rating,
    comment,
    submittedAt,
  };
}

function shuffleQuestionOptions(question) {
  const shuffledOptions = shuffleArray(question.options.map((option) => ({ ...option })));
  const options = shuffledOptions.map((option, index) => ({
    id: OPTION_IDS[index],
    text: option.text,
  }));
  const correctOptionIds = shuffledOptions
    .map((option, index) => (question.correctOptionIds.includes(option.id) ? OPTION_IDS[index] : null))
    .filter(Boolean);

  return {
    ...question,
    options,
    correctOptionIds,
  };
}

const parsedAdminPasscodeHash = parseScryptHash(ADMIN_PASSCODE_HASH);

function verifyAdminPasscode(passcode) {
  return Boolean(parsedAdminPasscodeHash) && verifyPasswordScrypt(passcode, ADMIN_PASSCODE_HASH);
}

function asPublicQuestion(question) {
  return {
    id: question.id,
    topic: question.topic,
    type: question.type,
    text: question.text,
    options: question.options,
  };
}

function hasSameOptions(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function sanitizeSelectedOptions(question, selectedOptionIds) {
  if (!Array.isArray(selectedOptionIds)) {
    return [];
  }

  const allowedOptionIds = new Set(question.options.map((option) => option.id));
  const unique = [...new Set(selectedOptionIds.filter((optionId) => allowedOptionIds.has(optionId)))];

  if (question.type === 'single') {
    return unique.slice(0, 1);
  }

  return unique;
}

function normalizeQuestionId(value) {
  return normalizeName(value).toUpperCase();
}

function resolveSessionQuestionId(session, requestedQuestionId) {
  const order = Array.isArray(session?.questionOrder) ? session.questionOrder : [];
  if (!order.length) {
    return null;
  }

  if (order.includes(requestedQuestionId)) {
    return requestedQuestionId;
  }

  const normalizedRequested = normalizeQuestionId(requestedQuestionId);
  if (!normalizedRequested) {
    return null;
  }

  for (const questionId of order) {
    if (normalizeQuestionId(questionId) === normalizedRequested) {
      return questionId;
    }
  }

  return null;
}

function resolveQuestionFromSnapshot(session, questionId) {
  const snapshot = session?.questionSnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  if (snapshot[questionId]) {
    return snapshot[questionId];
  }

  const normalizedId = normalizeQuestionId(questionId);
  for (const [key, value] of Object.entries(snapshot)) {
    if (normalizeQuestionId(key) === normalizedId) {
      return value;
    }

    if (normalizeQuestionId(value?.id) === normalizedId) {
      return value;
    }
  }

  return null;
}

function evaluateSession(session) {
  let correctCount = 0;
  let answeredCount = 0;

  for (const questionId of session.questionOrder) {
    const question = session.questionSnapshot?.[questionId];
    if (!question) {
      continue;
    }

    const selected = session.answers[questionId] ?? [];
    if (selected.length > 0) {
      answeredCount += 1;
    }

    if (hasSameOptions(selected, question.correctOptionIds)) {
      correctCount += 1;
    }
  }

  const totalQuestions = session.questionOrder.length;
  const rawPercent = totalQuestions === 0 ? 0 : Number(((correctCount / totalQuestions) * 100).toFixed(2));
  const activeViolations = getActiveViolations(session);
  const waivedViolations = getWaivedViolations(session);
  const penaltyPoints = Number(
    Math.min(rawPercent, activeViolations.length * PENALTY_PER_VIOLATION).toFixed(2)
  );
  const finalPercent = Number(Math.max(0, rawPercent - penaltyPoints).toFixed(2));
  const finalScoreOutOfExam = Number(((finalPercent / 100) * totalQuestions).toFixed(2));
  const finalScoreOutOf40 = Number(((finalPercent / 100) * EXAM_QUESTION_COUNT).toFixed(2));

  return {
    totalQuestions,
    answeredCount,
    correctCount,
    rawPercent,
    penaltyPoints,
    violationsCount: activeViolations.length,
    totalViolationsCount: (session.violations ?? []).length,
    waivedViolationsCount: waivedViolations.length,
    finalPercent,
    finalScoreOutOfExam,
    finalScoreOutOf40,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
  };
}

function finalizeSession(session) {
  if (session.submittedAt) {
    if (session.summary) {
      return session;
    }

    return {
      ...session,
      summary: evaluateSession(session),
    };
  }

  return {
    ...session,
    submittedAt: Date.now(),
    summary: evaluateSession(session),
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

function violationsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }

    if (
      a.id !== b.id ||
      a.type !== b.type ||
      a.detail !== b.detail ||
      a.occurredAt !== b.occurredAt ||
      (a.deduct !== false) !== (b.deduct !== false) ||
      (a.policy ?? 'default') !== (b.policy ?? 'default') ||
      Boolean(a.waived) !== Boolean(b.waived) ||
      (a.waivedAt ?? null) !== (b.waivedAt ?? null)
    ) {
      return false;
    }
  }

  return true;
}

function getResultsAvailableAt(session) {
  if (!session?.submittedAt) {
    return null;
  }

  const storedValue = Number(session.resultsAvailableAt);
  if (Number.isFinite(storedValue) && storedValue > 0) {
    return storedValue;
  }

  return Number(session.submittedAt) + RESULT_RELEASE_DELAY_MS;
}

function isResultsReleased(session) {
  const resultsAvailableAt = getResultsAvailableAt(session);
  if (!resultsAvailableAt) {
    return false;
  }

  return Date.now() >= resultsAvailableAt;
}

function toClientSession(session) {
  const durationSeconds = session.durationSeconds ?? EXAM_DURATION_SECONDS;
  const remainingSeconds = session.submittedAt
    ? 0
    : Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));

  const questionList = session.questionOrder
    .map((questionId) => session.questionSnapshot?.[questionId])
    .filter(Boolean)
    .map(asPublicQuestion);

  return {
    sessionId: session.id,
    exam: {
      id: session.examId ?? 'general',
      title: session.examTitle ?? 'General Exam Pool',
      maxAttempts: session.examMaxAttempts ?? null,
      proctoring: session.examProctoring ?? null,
    },
    trialNumber: session.trialNumber ?? 1,
    student: session.student,
    studentKey: session.studentKey ?? buildStudentKey(session.student, session.examId),
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    durationSeconds,
    remainingSeconds,
    questions: questionList,
    responses: session.answers,
    flagged: session.flagged,
    seen: session.seen,
    violations: session.violations,
    submittedAt: session.submittedAt,
    resultsAvailableAt: getResultsAvailableAt(session),
    resultsReleased: isResultsReleased(session),
    summary: session.summary,
    feedback: session.feedback ?? null,
  };
}

function sessionStatus(session) {
  if (session.submittedAt) {
    return 'submitted';
  }

  return Date.now() < session.expiresAt ? 'active' : 'time_up';
}

async function hydrateLegacyQuestionSnapshot(session) {
  if (session.questionSnapshot && Object.keys(session.questionSnapshot).length > 0) {
    return session;
  }

  const questionMap = await getQuestionByIdMap();
  const snapshot = {};

  for (const questionId of session.questionOrder ?? []) {
    const question = questionMap.get(questionId);
    if (question) {
      snapshot[questionId] = question;
    }
  }

  return {
    ...session,
    questionSnapshot: snapshot,
  };
}

async function normalizeSession(session) {
  const normalizedStudent = {
    fullName: normalizeName(session.student?.fullName ?? ''),
    classRoom: normalizeName(session.student?.classRoom ?? ''),
    email: normalizeEmail(session.student?.email ?? ''),
  };
  const normalizedExamId = normalizeExamId(session.examId) || 'general';
  const matchingExam = await getExam(normalizedExamId);
  const examTitle = normalizeName(session.examTitle) || matchingExam?.title || 'General Exam Pool';
  const examMaxAttemptsInput = Number(session.examMaxAttempts);
  const examMaxAttempts = Number.isFinite(examMaxAttemptsInput) && examMaxAttemptsInput > 0
    ? Math.round(examMaxAttemptsInput)
    : Number(matchingExam?.maxAttempts ?? 3);
  const examProctoring = normalizeProctoringPolicy(session.examProctoring ?? matchingExam?.proctoring ?? {});
  const trialNumberInput = Number(session.trialNumber);
  const trialNumber = Number.isFinite(trialNumberInput) && trialNumberInput > 0
    ? Math.round(trialNumberInput)
    : 1;
  const normalizedViolations = (Array.isArray(session.violations) ? session.violations : [])
    .map((violation) => normalizeStoredViolation(violation))
    .filter(Boolean);
  const studentKey = normalizeName(session.studentKey) || buildStudentKey(normalizedStudent, normalizedExamId);
  const userKey = normalizeName(session.userKey) || buildUserKey(normalizedStudent);
  let userId = normalizeName(session.userId);
  if (!userId && userKey) {
    const linkedUser = await getUserByKey(userKey);
    userId = linkedUser?.id ?? '';
  }
  const resultsAvailableAt = session.submittedAt
    ? getResultsAvailableAt(session)
    : null;

  let next = {
    ...session,
    student: normalizedStudent,
    examId: normalizedExamId,
    examTitle,
    examMaxAttempts,
    examProctoring,
    trialNumber,
    studentKey,
    userKey,
    userId: userId || null,
    durationSeconds: session.durationSeconds ?? EXAM_DURATION_SECONDS,
    answers: session.answers ?? {},
    flagged: session.flagged ?? {},
    seen: session.seen ?? {},
    violations: normalizedViolations,
    questionOrder: Array.isArray(session.questionOrder) ? session.questionOrder : [],
    feedback: normalizeStoredFeedback(session.feedback),
    resultsAvailableAt,
  };

  let changed =
    normalizedStudent.fullName !== (session.student?.fullName ?? '') ||
    normalizedStudent.classRoom !== (session.student?.classRoom ?? '') ||
    normalizedStudent.email !== (session.student?.email ?? '') ||
    normalizedExamId !== (session.examId ?? '') ||
    examTitle !== (session.examTitle ?? '') ||
    examMaxAttempts !== session.examMaxAttempts ||
    JSON.stringify(examProctoring) !== JSON.stringify(normalizeProctoringPolicy(session.examProctoring ?? {})) ||
    trialNumber !== session.trialNumber ||
    studentKey !== (session.studentKey ?? '') ||
    userKey !== (session.userKey ?? '') ||
    (userId || null) !== (session.userId ?? null) ||
    (resultsAvailableAt ?? null) !== (session.resultsAvailableAt ?? null) ||
    next.durationSeconds !== session.durationSeconds ||
    next.answers !== session.answers ||
    next.flagged !== session.flagged ||
    next.seen !== session.seen ||
    !violationsEqual(next.violations, Array.isArray(session.violations) ? session.violations : []) ||
    next.questionOrder !== session.questionOrder ||
    next.feedback !== session.feedback;

  next = await hydrateLegacyQuestionSnapshot(next);
  if (!session.questionSnapshot && next.questionSnapshot) {
    changed = true;
  }

  if (!next.submittedAt && Date.now() >= next.expiresAt) {
    next = finalizeSession(next);
    changed = true;
  }

  if (next.submittedAt && !next.summary) {
    next = finalizeSession(next);
    changed = true;
  }

  if (next.submittedAt && next.summary) {
    const recalculated = evaluateSession(next);
    if (!summariesEqual(next.summary, recalculated)) {
      next = {
        ...next,
        summary: recalculated,
      };
      changed = true;
    }
  }

  if (changed) {
    await saveSession(next);
  }

  return next;
}

async function getLatestSession(sessionId) {
  const existing = await getSession(sessionId);
  if (!existing) {
    return null;
  }

  return normalizeSession(existing);
}

async function getLatestSessions() {
  const sessions = await listSessions();
  return Promise.all(sessions.map((session) => normalizeSession(session)));
}

async function getUpdatableSessionOrError(sessionId, res, studentUser = null) {
  const session = await getLatestSession(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return null;
  }

  if (studentUser && !studentOwnsSession(studentUser, session)) {
    res.status(403).json({ error: 'You do not have access to this session.' });
    return null;
  }

  if (session.submittedAt) {
    res.status(409).json({ error: 'Exam already submitted.', session: toStudentClientSession(session) });
    return null;
  }

  if (Date.now() >= session.expiresAt) {
    const finalized = finalizeSession(session);
    await saveSession(finalized);
    res.status(409).json({ error: 'Exam time is over.', session: toStudentClientSession(finalized) });
    return null;
  }

  return session;
}

function cleanupAdminTokens() {
  const now = Date.now();

  for (const [token, details] of adminTokens.entries()) {
    if (details.expiresAt <= now) {
      adminTokens.delete(token);
    }
  }
}

function cleanupStudentTokens() {
  const now = Date.now();

  for (const [token, details] of studentTokens.entries()) {
    if (details.expiresAt <= now) {
      studentTokens.delete(token);
    }
  }
}

function issueAdminToken() {
  cleanupAdminTokens();

  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + ADMIN_TOKEN_LIFETIME_MS;

  adminTokens.set(token, { token, createdAt, expiresAt });
  return { token, createdAt, expiresAt };
}

function issueStudentToken(user) {
  cleanupStudentTokens();

  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + STUDENT_TOKEN_LIFETIME_MS;

  studentTokens.set(token, {
    token,
    createdAt,
    expiresAt,
    userId: user.id,
    userKey: user.userKey,
  });

  return { token, createdAt, expiresAt };
}

function revokeStudentTokensForUser(userId) {
  if (!userId) {
    return;
  }

  for (const [token, details] of studentTokens.entries()) {
    if (details.userId === userId) {
      studentTokens.delete(token);
    }
  }
}

function getBearerToken(req) {
  const raw = req.headers.authorization ?? '';
  if (!raw.startsWith('Bearer ')) {
    return '';
  }

  return raw.slice('Bearer '.length).trim();
}

function requireAdmin(req, res, next) {
  cleanupAdminTokens();

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing admin token.' });
    return;
  }

  const details = adminTokens.get(token);
  if (!details) {
    res.status(401).json({ error: 'Invalid or expired admin token.' });
    return;
  }

  req.admin = details;
  next();
}

async function requireStudent(req, res, next) {
  cleanupStudentTokens();

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing student token.' });
    return;
  }

  const tokenDetails = studentTokens.get(token);
  if (!tokenDetails) {
    res.status(401).json({ error: 'Invalid or expired student token.' });
    return;
  }

  const user = await getUserById(tokenDetails.userId);
  if (!user) {
    studentTokens.delete(token);
    res.status(401).json({ error: 'Student account not found.' });
    return;
  }

  if (user.disabled) {
    res.status(403).json({ error: 'This student account is disabled. Contact admin.' });
    return;
  }

  req.student = {
    token: tokenDetails,
    user,
  };
  next();
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function scoreBand(score) {
  if (score < 20) {
    return '0-19';
  }
  if (score < 40) {
    return '20-39';
  }
  if (score < 60) {
    return '40-59';
  }
  if (score < 80) {
    return '60-79';
  }

  return '80-100';
}

function toSessionRow(session) {
  const status = sessionStatus(session);
  const remainingSeconds = session.submittedAt
    ? 0
    : Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
  const activeViolationsCount = session.summary?.violationsCount ?? getActiveViolations(session).length;
  const totalViolationsCount = session.summary?.totalViolationsCount ?? (session.violations?.length ?? 0);
  const waivedViolationsCount =
    session.summary?.waivedViolationsCount ?? Math.max(0, totalViolationsCount - activeViolationsCount);

  return {
    id: session.id,
    examId: session.examId ?? 'general',
    examTitle: session.examTitle ?? 'General Exam Pool',
    trialNumber: session.trialNumber ?? 1,
    studentKey: session.studentKey ?? buildStudentKey(session.student, session.examId),
    studentName: session.student?.fullName ?? 'Unknown',
    classRoom: session.student?.classRoom ?? 'Unknown',
    email: session.student?.email ?? '',
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    expiresAt: session.expiresAt,
    status,
    remainingSeconds,
    violationsCount: activeViolationsCount,
    totalViolationsCount,
    waivedViolationsCount,
    answeredCount: session.summary?.answeredCount ?? 0,
    correctCount: session.summary?.correctCount ?? 0,
    rawPercent: session.summary?.rawPercent ?? 0,
    finalPercent: session.summary?.finalPercent ?? 0,
    feedbackRating: session.feedback?.rating ?? null,
    feedbackComment: session.feedback?.comment ?? '',
    feedbackSubmittedAt: session.feedback?.submittedAt ?? null,
  };
}

function toStudentTrialRow(session) {
  const released = isResultsReleased(session);
  return {
    id: session.id,
    exam: {
      id: session.examId ?? 'general',
      title: session.examTitle ?? 'General Exam Pool',
      maxAttempts: session.examMaxAttempts ?? null,
    },
    trialNumber: session.trialNumber ?? 1,
    status: sessionStatus(session),
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    expiresAt: session.expiresAt,
    resultsAvailableAt: getResultsAvailableAt(session),
    resultsReleased: released,
    durationSeconds: session.durationSeconds ?? EXAM_DURATION_SECONDS,
    summary: released ? session.summary ?? evaluateSession(session) : null,
    violations: session.violations ?? [],
    feedback: session.feedback ?? null,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }

  return lines.join('\n');
}

function buildOverview(sessions, questionPool) {
  const submitted = sessions.filter((session) => session.submittedAt);
  const active = sessions.filter((session) => sessionStatus(session) === 'active');

  const classBuckets = new Map();
  for (const session of submitted) {
    const key = session.student?.classRoom ?? 'Unknown';
    const existing = classBuckets.get(key) ?? { count: 0, scores: [], violations: [] };
    existing.count += 1;
    existing.scores.push(session.summary?.finalPercent ?? 0);
    existing.violations.push(session.summary?.violationsCount ?? 0);
    classBuckets.set(key, existing);
  }

  const classPerformance = [...classBuckets.entries()]
    .map(([classRoom, details]) => ({
      classRoom,
      count: details.count,
      averageScore: average(details.scores),
      averageViolations: average(details.violations),
    }))
    .sort((left, right) => right.averageScore - left.averageScore);

  const scoreDistributionMap = {
    '0-19': 0,
    '20-39': 0,
    '40-59': 0,
    '60-79': 0,
    '80-100': 0,
  };

  for (const session of submitted) {
    const band = scoreBand(session.summary?.finalPercent ?? 0);
    scoreDistributionMap[band] += 1;
  }

  const violationBreakdownMap = new Map();
  for (const session of sessions) {
    for (const violation of session.violations ?? []) {
      const key = violation.type ?? 'unknown';
      violationBreakdownMap.set(key, (violationBreakdownMap.get(key) ?? 0) + 1);
    }
  }

  const topicCoverageMap = new Map();
  const typeCoverageMap = new Map();

  for (const question of questionPool) {
    topicCoverageMap.set(question.topic, (topicCoverageMap.get(question.topic) ?? 0) + 1);
    typeCoverageMap.set(question.type, (typeCoverageMap.get(question.type) ?? 0) + 1);
  }

  const scores = submitted.map((session) => session.summary?.finalPercent ?? 0);
  const rawScores = submitted.map((session) => session.summary?.rawPercent ?? 0);
  const violations = submitted.map((session) => session.summary?.violationsCount ?? 0);
  const feedbackSessions = submitted.filter((session) => session.feedback?.rating || session.feedback?.comment);
  const ratingValues = feedbackSessions
    .map((session) => session.feedback?.rating)
    .filter((value) => Number.isFinite(value));
  const ratingDistributionMap = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  for (const rating of ratingValues) {
    ratingDistributionMap[rating] += 1;
  }

  const studentBuckets = new Map();
  for (const session of sessions) {
    const studentKey = session.studentKey ?? buildStudentKey(session.student, session.examId);
    const existing = studentBuckets.get(studentKey) ?? {
      studentKey,
      studentName: session.student?.fullName ?? 'Unknown',
      classRoom: session.student?.classRoom ?? 'Unknown',
      email: session.student?.email ?? '',
      totalTrials: 0,
      submittedTrials: 0,
      bestFinalPercent: -1,
      bestSessionId: null,
      bestTrialNumber: null,
      bestExamId: null,
      bestExamTitle: null,
      latestStartedAt: 0,
      scores: [],
    };

    existing.totalTrials += 1;
    existing.latestStartedAt = Math.max(existing.latestStartedAt, Number(session.startedAt) || 0);

    if (session.submittedAt) {
      existing.submittedTrials += 1;
      const finalPercent = Number(session.summary?.finalPercent ?? 0);
      existing.scores.push(finalPercent);
      if (finalPercent > existing.bestFinalPercent) {
        existing.bestFinalPercent = finalPercent;
        existing.bestSessionId = session.id;
        existing.bestTrialNumber = session.trialNumber ?? 1;
        existing.bestExamId = session.examId ?? 'general';
        existing.bestExamTitle = session.examTitle ?? 'General Exam Pool';
      }
    }

    studentBuckets.set(studentKey, existing);
  }

  const studentSummaries = [...studentBuckets.values()].map((item) => ({
    studentKey: item.studentKey,
    studentName: item.studentName,
    classRoom: item.classRoom,
    email: item.email,
    totalTrials: item.totalTrials,
    submittedTrials: item.submittedTrials,
    averageFinalPercent: average(item.scores),
    bestFinalPercent: item.bestFinalPercent < 0 ? 0 : Number(item.bestFinalPercent.toFixed(2)),
    bestSessionId: item.bestSessionId,
    bestTrialNumber: item.bestTrialNumber,
    bestExamId: item.bestExamId,
    bestExamTitle: item.bestExamTitle,
    latestStartedAt: item.latestStartedAt,
  }));

  const outstandingStudents = studentSummaries
    .filter((student) => student.submittedTrials > 0)
    .sort((left, right) => {
      if (right.bestFinalPercent !== left.bestFinalPercent) {
        return right.bestFinalPercent - left.bestFinalPercent;
      }
      if (right.averageFinalPercent !== left.averageFinalPercent) {
        return right.averageFinalPercent - left.averageFinalPercent;
      }
      return right.submittedTrials - left.submittedTrials;
    })
    .slice(0, 10);

  const classLeaderboards = [...new Set(studentSummaries.map((student) => student.classRoom))]
    .map((classRoom) => ({
      classRoom,
      leaders: studentSummaries
        .filter((student) => student.classRoom === classRoom && student.submittedTrials > 0)
        .sort((left, right) => {
          if (right.bestFinalPercent !== left.bestFinalPercent) {
            return right.bestFinalPercent - left.bestFinalPercent;
          }
          if (right.averageFinalPercent !== left.averageFinalPercent) {
            return right.averageFinalPercent - left.averageFinalPercent;
          }
          return right.submittedTrials - left.submittedTrials;
        })
        .slice(0, 5),
    }))
    .filter((item) => item.leaders.length > 0)
    .sort((left, right) => left.classRoom.localeCompare(right.classRoom));

  return {
    totals: {
      candidates: sessions.length,
      submitted: submitted.length,
      active: active.length,
      completionRate: sessions.length
        ? Number(((submitted.length / sessions.length) * 100).toFixed(2))
        : 0,
      averageScore: average(scores),
      averageRawScore: average(rawScores),
      averageViolations: average(violations),
      lowScoreCount: submitted.filter((session) => (session.summary?.finalPercent ?? 0) < 40).length,
      feedbackCount: feedbackSessions.length,
      averageRating: average(ratingValues),
      uniqueStudents: studentSummaries.length,
      repeatCandidates: studentSummaries.filter((student) => student.totalTrials > 1).length,
      averageTrialsPerStudent: average(studentSummaries.map((student) => student.totalTrials)),
    },
    scoreDistribution: Object.entries(scoreDistributionMap).map(([band, count]) => ({ band, count })),
    classPerformance,
    violationBreakdown: [...violationBreakdownMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count),
    topicCoverage: [...topicCoverageMap.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((left, right) => right.count - left.count),
    questionTypeCoverage: [...typeCoverageMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count),
    ratingDistribution: Object.entries(ratingDistributionMap).map(([rating, count]) => ({
      rating: Number(rating),
      count,
    })),
    outstandingStudents,
    classLeaderboards,
    studentSummaries: studentSummaries
      .sort((left, right) => right.latestStartedAt - left.latestStartedAt)
      .slice(0, 200),
    recentSubmissions: submitted
      .sort((left, right) => (right.submittedAt ?? 0) - (left.submittedAt ?? 0))
      .slice(0, 10)
      .map((session) => ({
        id: session.id,
        studentName: session.student?.fullName ?? 'Unknown',
        classRoom: session.student?.classRoom ?? 'Unknown',
        finalPercent: session.summary?.finalPercent ?? 0,
        violationsCount: session.summary?.violationsCount ?? 0,
        feedbackRating: session.feedback?.rating ?? null,
        submittedAt: session.submittedAt,
      })),
    recentFeedback: feedbackSessions
      .sort((left, right) => (right.feedback?.submittedAt ?? 0) - (left.feedback?.submittedAt ?? 0))
      .slice(0, 12)
      .map((session) => ({
        id: session.id,
        studentName: session.student?.fullName ?? 'Unknown',
        classRoom: session.student?.classRoom ?? 'Unknown',
        rating: session.feedback?.rating ?? null,
        comment: session.feedback?.comment ?? '',
        submittedAt: session.feedback?.submittedAt ?? null,
      })),
  };
}

function questionToAdminRow(question) {
  return {
    ...question,
    answerKey: question.correctOptionIds.join(', '),
  };
}

function examAllowsClass(exam, classRoom) {
  if (!exam || !Array.isArray(exam.allowedClasses)) {
    return false;
  }

  return exam.allowedClasses.includes(classRoom);
}

function pickExamQuestionSet(exam, questionPool, questionMap) {
  if (!exam) {
    return [];
  }

  if (exam.mode === 'fixed') {
    return (exam.questionIds ?? [])
      .map((questionId) => questionMap.get(questionId))
      .filter(Boolean);
  }

  if (exam.id === 'general') {
    return questionPool.filter((question) => (question.sourceExamId ?? 'general') === 'general');
  }

  return questionPool.filter((question) => (question.sourceExamId ?? 'general') === exam.id);
}

function buildQuestionReview(session) {
  return (session.questionOrder ?? [])
    .map((questionId, index) => {
      const question = session.questionSnapshot?.[questionId];
      if (!question) {
        return null;
      }

      const selectedOptionIds = session.answers?.[questionId] ?? [];
      const isCorrect = hasSameOptions(selectedOptionIds, question.correctOptionIds ?? []);

      return {
        index: index + 1,
        questionId,
        topic: question.topic,
        type: question.type,
        text: question.text,
        options: question.options ?? [],
        selectedOptionIds,
        correctOptionIds: question.correctOptionIds ?? [],
        isCorrect,
      };
    })
    .filter(Boolean);
}

function buildStudentQuestionReview(session) {
  const released = isResultsReleased(session);
  const baseReview = buildQuestionReview(session);
  if (released) {
    return baseReview;
  }

  return baseReview.map((item) => ({
    ...item,
    correctOptionIds: [],
    isCorrect: null,
  }));
}

function toStudentClientSession(session) {
  const base = toClientSession(session);
  if (!session.submittedAt) {
    return base;
  }

  if (isResultsReleased(session)) {
    return base;
  }

  return {
    ...base,
    summary: null,
  };
}

function sanitizeViolationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((id) => normalizeName(id)).filter(Boolean))];
}

function getViolationPolicy(session, type) {
  const policy = normalizeProctoringPolicy(session?.examProctoring ?? {});

  const mapping = {
    tab_switch: {
      track: policy.tab_switch,
      deduct: policy.deductTabSwitch,
      policy: 'tab_switch',
    },
    window_blur: {
      track: policy.window_blur,
      deduct: policy.deductWindowBlur,
      policy: 'window_blur',
    },
    fullscreen_exit: {
      track: policy.fullscreen_exit,
      deduct: policy.deductFullscreenExit,
      policy: 'fullscreen_exit',
    },
    right_click: {
      track: policy.right_click,
      deduct: policy.deductRightClick,
      policy: 'right_click',
    },
    restricted_key: {
      track: policy.restricted_key,
      deduct: policy.deductRestrictedKey,
      policy: 'restricted_key',
    },
  };

  const normalizedType = normalizeName(type).toLowerCase();
  const selected = mapping[normalizedType];
  if (!selected) {
    return {
      track: true,
      deduct: true,
      policy: 'default',
    };
  }

  return {
    track: selected.track !== false,
    deduct: selected.track !== false && selected.deduct !== false,
    policy: selected.track === false ? `${selected.policy}:monitor_only` : selected.policy,
  };
}

function studentOwnsSession(studentUser, session) {
  if (!studentUser || !session) {
    return false;
  }

  return (
    (session.userId && session.userId === studentUser.id) ||
    (session.userKey && session.userKey === studentUser.userKey)
  );
}

function buildExamAttemptStatsForUser(user, exams, sessions) {
  return exams.map((exam) => {
    const trials = sessions.filter(
      (session) => session.userKey === user.userKey && (session.examId ?? 'general') === exam.id
    );
    const submitted = trials.filter((session) => session.submittedAt);
    const bestFinalPercent = submitted.length
      ? Math.max(...submitted.map((session) => Number(session.summary?.finalPercent ?? 0)))
      : 0;
    const maxAttempts = Number(exam.maxAttempts ?? 3);
    const attemptsUsed = trials.length;
    const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
    const canAttempt = attemptsRemaining > 0;

    return {
      ...toPublicExam(exam),
      attemptsUsed,
      attemptsRemaining,
      maxAttempts,
      canAttempt,
      bestFinalPercent: Number(bestFinalPercent.toFixed(2)),
    };
  });
}

function buildStudentDashboardPayload(user, exams, sessions) {
  const availableExams = exams.filter(
    (exam) => exam.published && examAllowsClass(exam, user.classRoom)
  );
  const examStats = buildExamAttemptStatsForUser(user, availableExams, sessions);
  const trials = sessions
    .filter((session) => studentOwnsSession(user, session))
    .sort((left, right) => right.startedAt - left.startedAt);
  const activeSession =
    trials.find((session) => !session.submittedAt && sessionStatus(session) === 'active') ?? null;

  return {
    user: toPublicUserRecord(user),
    exams: examStats,
    activeSession: activeSession ? toStudentClientSession(activeSession) : null,
    trials: trials.slice(0, 40).map(toStudentTrialRow),
  };
}

function getKeepAliveTarget() {
  if (KEEP_ALIVE_URL) {
    return KEEP_ALIVE_URL;
  }

  return `http://127.0.0.1:${PORT}/api/keep-alive`;
}

function startKeepAliveLoop() {
  if (!KEEP_ALIVE_ENABLED) {
    return;
  }

  const target = getKeepAliveTarget();
  const ping = async () => {
    try {
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'User-Agent': 'salemexams-keepalive/1.0',
        },
      });

      if (!response.ok) {
        console.warn(`Keep-alive ping failed with status ${response.status}: ${target}`);
      }
    } catch (error) {
      console.warn(`Keep-alive ping error: ${error.message}`);
    }
  };

  const interval = setInterval(() => {
    void ping();
  }, KEEP_ALIVE_INTERVAL_MS);

  // Allow the process to exit naturally in environments that support unref.
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  // Initial ping shortly after startup.
  setTimeout(() => {
    void ping();
  }, 3_000);
}

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/keep-alive', (_req, res) => {
  res.json({
    ok: true,
    route: 'keep-alive',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/exam/meta', async (_req, res) => {
  const [questionPool, exams] = await Promise.all([getQuestionPool(), listExams()]);
  const generalExam = exams.find((exam) => exam.id === 'general');

  res.json({
    schoolName: 'Salem Academy',
    durationSeconds: generalExam?.durationSeconds ?? EXAM_DURATION_SECONDS,
    questionCount: generalExam?.questionCount ?? EXAM_QUESTION_COUNT,
    questionPoolCount: questionPool.length,
    classOptions: CLASS_OPTIONS,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
    exams: exams.filter((exam) => exam.published).map((exam) => toPublicExam(exam)),
  });
});

app.post('/api/student/login', async (req, res) => {
  const fullName = normalizeName(req.body?.fullName);
  const classRoom = normalizeName(req.body?.classRoom);
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (fullName.length < 5) {
    res.status(400).json({ error: 'Please enter your full name (at least 5 characters).' });
    return;
  }

  if (!CLASS_OPTIONS.includes(classRoom)) {
    res.status(400).json({ error: 'Please choose a valid class.' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  if (password.length < 3) {
    res.status(400).json({ error: 'Please enter your password.' });
    return;
  }

  const userKey = buildUserKey({ fullName, classRoom, email });
  let user = await getUserByKey(userKey);
  if (!user) {
    try {
      user = await createUserFromDefaultPassword({ fullName, classRoom, email });
    } catch {
      user = await getUserByKey(userKey);
    }
  }

  if (!user) {
    res.status(500).json({ error: 'Could not create your student account right now.' });
    return;
  }

  if (user.disabled) {
    res.status(403).json({ error: 'This account is disabled. Contact admin for help.' });
    return;
  }

  if (!verifyPasswordScrypt(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid password.' });
    return;
  }

  await touchUserLogin(user.id);
  const refreshedUser = (await getUserById(user.id)) ?? user;
  const tokenInfo = issueStudentToken(refreshedUser);
  const [exams, sessions] = await Promise.all([listExams(), getLatestSessions()]);
  const dashboard = buildStudentDashboardPayload(refreshedUser, exams, sessions);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt,
    tokenLifetimeMs: STUDENT_TOKEN_LIFETIME_MS,
    ...dashboard,
  });
});

app.get('/api/student/me', requireStudent, async (req, res) => {
  const [exams, sessions] = await Promise.all([listExams(), getLatestSessions()]);
  const dashboard = buildStudentDashboardPayload(req.student.user, exams, sessions);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    ...dashboard,
  });
});

app.post('/api/student/change-password', requireStudent, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const nextPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!currentPassword || !nextPassword) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }

  if (nextPassword.length < 4) {
    res.status(400).json({ error: 'New password must be at least 4 characters.' });
    return;
  }

  if (!verifyPasswordScrypt(currentPassword, req.student.user.passwordHash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  if (currentPassword === nextPassword) {
    res.status(400).json({ error: 'New password must be different from current password.' });
    return;
  }

  const nextHash = hashPasswordScrypt(nextPassword);
  const updated = await updateUserPassword(req.student.user.id, nextHash, {
    mustChangePassword: false,
  });
  if (!updated) {
    res.status(404).json({ error: 'Student account not found.' });
    return;
  }

  res.json({
    ok: true,
    user: toPublicUserRecord(updated),
  });
});

app.post('/api/student/password-help', async (req, res) => {
  const fullName = normalizeName(req.body?.fullName);
  const classRoom = normalizeName(req.body?.classRoom);
  const email = normalizeEmail(req.body?.email);
  const message = normalizeName(req.body?.message ?? '');

  if (fullName.length < 5) {
    res.status(400).json({ error: 'Please enter your full name.' });
    return;
  }

  if (!CLASS_OPTIONS.includes(classRoom)) {
    res.status(400).json({ error: 'Please choose a valid class.' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const requestRow = await createPasswordAssistanceRequest({
    fullName,
    classRoom,
    email,
    message,
  });

  res.status(201).json({
    ok: true,
    request: requestRow,
    message: 'Password help request sent. Admin will assist you shortly.',
  });
});

app.get('/api/student/trials', requireStudent, async (req, res) => {
  const sessions = await getLatestSessions();
  const trials = sessions
    .filter((session) => studentOwnsSession(req.student.user, session))
    .sort((left, right) => right.startedAt - left.startedAt)
    .map(toStudentTrialRow);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    total: trials.length,
    trials,
  });
});

app.get('/api/student/trials/:sessionId', requireStudent, async (req, res) => {
  const trial = await getLatestSession(req.params.sessionId);
  if (!trial) {
    res.status(404).json({ error: 'Trial not found.' });
    return;
  }

  if (!studentOwnsSession(req.student.user, trial)) {
    res.status(403).json({ error: 'You do not have access to this trial.' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    trial: {
      ...toStudentTrialRow(trial),
      questionReview: buildStudentQuestionReview(trial),
      exam: {
        id: trial.examId ?? 'general',
        title: trial.examTitle ?? 'General Exam Pool',
      },
    },
  });
});

app.post('/api/exam/start', requireStudent, async (req, res) => {
  const requestedExamId = normalizeExamId(req.body?.examId) || 'general';
  const user = req.student.user;
  const fullName = user.fullName;
  const classRoom = user.classRoom;
  const email = user.email;

  const [selectedExam, questionPool, questionMap, sessions] = await Promise.all([
    getExam(requestedExamId),
    getQuestionPool(),
    getQuestionByIdMap(),
    getLatestSessions(),
  ]);

  if (!selectedExam || !selectedExam.published) {
    res.status(404).json({ error: 'Selected exam is not available.' });
    return;
  }

  if (!examAllowsClass(selectedExam, classRoom)) {
    res.status(403).json({ error: `This exam is not available for class ${classRoom}.` });
    return;
  }

  const examQuestionPool = pickExamQuestionSet(selectedExam, questionPool, questionMap);
  const requiredQuestionCount = selectedExam.questionCount ?? EXAM_QUESTION_COUNT;

  if (examQuestionPool.length < requiredQuestionCount) {
    res.status(503).json({
      error: `Exam question pool has ${examQuestionPool.length}. At least ${requiredQuestionCount} questions are required.`,
    });
    return;
  }

  const existingTrials = sessions.filter(
    (session) => studentOwnsSession(user, session) && (session.examId ?? 'general') === selectedExam.id
  );
  const activeTrial = existingTrials.find(
    (session) => !session.submittedAt && sessionStatus(session) === 'active'
  );
  const maxAttempts = Number(selectedExam.maxAttempts ?? 3);
  const attemptsUsed = existingTrials.length;
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
  if (activeTrial) {
    res.status(409).json({
      error: 'You already have an active trial for this exam.',
      attemptsUsed,
      maxAttempts,
      attemptsRemaining,
      session: toStudentClientSession(activeTrial),
    });
    return;
  }

  if (attemptsRemaining <= 0) {
    res.status(409).json({
      error: `Attempt limit reached for ${selectedExam.title}.`,
      attemptsUsed,
      maxAttempts,
      attemptsRemaining,
    });
    return;
  }

  const servedQuestions = shuffleArray(examQuestionPool)
    .slice(0, requiredQuestionCount)
    .map(shuffleQuestionOptions);
  const startedAt = Date.now();
  const studentKey = buildStudentKey(
    {
      fullName,
      classRoom,
      email,
    },
    selectedExam.id
  );
  const trialNumber = existingTrials.length + 1;
  const session = {
    id: randomUUID(),
    examId: selectedExam.id,
    examTitle: selectedExam.title,
    examMaxAttempts: maxAttempts,
    examProctoring: normalizeProctoringPolicy(selectedExam.proctoring ?? {}),
    studentKey,
    userId: user.id,
    userKey: user.userKey,
    trialNumber,
    student: {
      fullName,
      classRoom,
      email,
    },
    startedAt,
    expiresAt: startedAt + selectedExam.durationSeconds * 1000,
    durationSeconds: selectedExam.durationSeconds,
    questionOrder: servedQuestions.map((question) => question.id),
    questionSnapshot: Object.fromEntries(servedQuestions.map((question) => [question.id, question])),
    answers: {},
    flagged: {},
    seen: {},
    violations: [],
    submittedAt: null,
    summary: null,
    feedback: null,
  };

  await saveSession(session);
  res.status(201).json({
    ...toStudentClientSession(session),
    attemptsUsed: trialNumber,
    maxAttempts,
    attemptsRemaining: Math.max(0, maxAttempts - trialNumber),
  });
});

app.get('/api/exam/:sessionId', requireStudent, async (req, res) => {
  const session = await getLatestSession(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  if (!studentOwnsSession(req.student.user, session)) {
    res.status(403).json({ error: 'You do not have access to this session.' });
    return;
  }

  res.json(toStudentClientSession(session));
});

app.post('/api/exam/:sessionId/seen', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedQuestionId = req.body?.questionId;

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
    });
    return;
  }

  const updated = await updateSession(sessionId, (current) => ({
    ...current,
    seen: {
      ...current.seen,
      [questionId]: true,
    },
  }));

  res.json({ ok: true, seen: updated?.seen ?? session.seen });
});

app.post('/api/exam/:sessionId/answer', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedQuestionId = req.body?.questionId;

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
    });
    return;
  }

  let question = resolveQuestionFromSnapshot(session, questionId);
  if (!question) {
    const questionMap = await getQuestionByIdMap();
    const normalizedQuestionId = normalizeQuestionId(questionId);
    question = questionMap.get(questionId) ?? questionMap.get(normalizedQuestionId) ?? null;
  }

  if (!question) {
    res.status(400).json({
      error: 'Question details could not be loaded for this session.',
      code: 'QUESTION_DETAILS_MISSING',
      questionId,
    });
    return;
  }

  const selected = sanitizeSelectedOptions(question, req.body?.selectedOptionIds);

  const updated = await updateSession(sessionId, (current) => ({
    ...current,
    questionSnapshot: {
      ...(current.questionSnapshot ?? {}),
      [questionId]: resolveQuestionFromSnapshot(current, questionId) ?? question,
    },
    answers: {
      ...current.answers,
      [questionId]: selected,
    },
  }));

  res.json({ ok: true, responses: updated?.answers ?? session.answers });
});

app.post('/api/exam/:sessionId/flag', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedQuestionId = req.body?.questionId;
  const flagged = Boolean(req.body?.flagged);

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
    });
    return;
  }

  const updated = await updateSession(sessionId, (current) => ({
    ...current,
    flagged: {
      ...current.flagged,
      [questionId]: flagged,
    },
  }));

  res.json({ ok: true, flagged: updated?.flagged ?? session.flagged });
});

app.post('/api/exam/:sessionId/proctor', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const type = normalizeName(req.body?.type);
  const detail = normalizeName(req.body?.detail);

  if (!type) {
    res.status(400).json({ error: 'Violation type is required.' });
    return;
  }

  const violationPolicy = getViolationPolicy(session, type);
  const violation = {
    id: randomUUID(),
    type: type.slice(0, 80),
    detail: detail.slice(0, 160),
    occurredAt: Date.now(),
    waived: false,
    deduct: violationPolicy.deduct,
    policy: violationPolicy.policy,
    waivedAt: null,
  };

  const updated = await updateSession(sessionId, (current) => ({
    ...current,
    violations: [...current.violations, violation],
  }));

  res.json({
    ok: true,
    violations: updated?.violations ?? session.violations,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
  });
});

app.post('/api/exam/:sessionId/submit', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const latest = await getLatestSession(sessionId);

  if (!latest) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  if (!studentOwnsSession(req.student.user, latest)) {
    res.status(403).json({ error: 'You do not have access to this session.' });
    return;
  }

  const finalized = finalizeSession(latest);
  await saveSession(finalized);

  res.json({
    ok: true,
    session: toStudentClientSession(finalized),
    summary: isResultsReleased(finalized) ? finalized.summary : null,
  });
});

app.post('/api/exam/:sessionId/feedback', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const latest = await getLatestSession(sessionId);

  if (!latest) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  if (!studentOwnsSession(req.student.user, latest)) {
    res.status(403).json({ error: 'You do not have access to this session.' });
    return;
  }

  if (!latest.submittedAt) {
    res.status(409).json({ error: 'Feedback can only be sent after submitting the exam.' });
    return;
  }

  const feedback = sanitizeFeedbackPayload(req.body ?? {});
  if (!feedback) {
    res.status(400).json({ error: 'Please add at least a rating or comment.' });
    return;
  }

  const updated = {
    ...latest,
    feedback,
  };
  await saveSession(updated);

  res.json({
    ok: true,
    feedback: updated.feedback,
    session: toStudentClientSession(updated),
  });
});

app.post('/api/admin/login', (req, res) => {
  if (!parsedAdminPasscodeHash) {
    res.status(503).json({
      error: 'Admin authentication hash is missing. Set ADMIN_PASSCODE_HASH in your environment.',
    });
    return;
  }

  const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
  if (!verifyAdminPasscode(passcode)) {
    res.status(401).json({ error: 'Invalid admin passcode.' });
    return;
  }

  const tokenInfo = issueAdminToken();

  res.json({
    ok: true,
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt,
    tokenLifetimeMs: ADMIN_TOKEN_LIFETIME_MS,
  });
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  const [sessions, questionPool] = await Promise.all([getLatestSessions(), getQuestionPool()]);
  const overview = buildOverview(sessions, questionPool);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    generatedAt: Date.now(),
    overview,
  });
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const search = normalizeName(req.query?.search ?? '').toLowerCase();
  const classRoom = normalizeName(req.query?.classRoom ?? '');
  const statusFilter = normalizeName(req.query?.status ?? '').toLowerCase();
  const examIdFilter = normalizeExamId(req.query?.examId ?? '');

  const sessions = await getLatestSessions();

  const filtered = sessions.filter((session) => {
    const sessionRow = toSessionRow(session);

    if (classRoom && sessionRow.classRoom !== classRoom) {
      return false;
    }

    if (statusFilter && sessionRow.status !== statusFilter) {
      return false;
    }

    if (examIdFilter && sessionRow.examId !== examIdFilter) {
      return false;
    }

    if (search) {
      const haystack =
        `${sessionRow.studentName} ${sessionRow.email} ${sessionRow.id} ${sessionRow.examTitle}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  });

  const rows = filtered
    .map((session) => toSessionRow(session))
    .sort((left, right) => right.startedAt - left.startedAt);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    total: rows.length,
    sessions: rows,
  });
});

app.get('/api/admin/sessions/:sessionId', requireAdmin, async (req, res) => {
  const session = await getLatestSession(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    session: {
      ...toClientSession(session),
      internal: {
        id: session.id,
        status: sessionStatus(session),
        row: toSessionRow(session),
        violations: session.violations ?? [],
        questionReview: buildQuestionReview(session),
      },
    },
  });
});

app.patch('/api/admin/sessions/:sessionId/violations/waive', requireAdmin, async (req, res) => {
  const sessionId = req.params.sessionId;
  const latest = await getLatestSession(sessionId);

  if (!latest) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const waiveAll = Boolean(req.body?.waiveAll);
  const violationIds = sanitizeViolationIds(req.body?.violationIds);
  const waived = req.body?.waived === false ? false : true;

  if (!waiveAll && !violationIds.length) {
    res.status(400).json({ error: 'Provide violationIds or use waiveAll=true.' });
    return;
  }

  const violationIdSet = new Set(violationIds);
  const actionTimestamp = Date.now();

  const updated = await updateSession(sessionId, (current) => {
    const currentViolations = Array.isArray(current.violations) ? current.violations : [];
    let changed = false;

    const nextViolations = currentViolations.map((violation) => {
      const shouldUpdate = waiveAll || violationIdSet.has(violation.id);
      if (!shouldUpdate) {
        return {
          ...violation,
          waived: Boolean(violation.waived),
          waivedAt: violation.waived ? violation.waivedAt ?? null : null,
        };
      }

      if (Boolean(violation.waived) === waived) {
        return {
          ...violation,
          waived: Boolean(violation.waived),
          waivedAt: violation.waived ? violation.waivedAt ?? null : null,
        };
      }

      changed = true;
      return {
        ...violation,
        waived,
        waivedAt: waived ? actionTimestamp : null,
      };
    });

    if (!changed) {
      return current;
    }

    const nextSession = {
      ...current,
      violations: nextViolations,
    };

    if (nextSession.submittedAt) {
      nextSession.summary = evaluateSession(nextSession);
    }

    return nextSession;
  });

  if (!updated) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const normalized = await getLatestSession(sessionId);
  res.json({
    ok: true,
    waived,
    session: toSessionRow(normalized),
    summary: normalized.summary,
    violations: normalized.violations ?? [],
  });
});

app.delete('/api/admin/sessions/:sessionId', requireAdmin, async (req, res) => {
  const removed = await deleteSession(req.params.sessionId);
  if (!removed) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  res.json({ ok: true, deletedCount: 1 });
});

app.delete('/api/admin/sessions', requireAdmin, async (req, res) => {
  const sessionIds = parseSessionIdsFromRequest(req);
  if (!sessionIds.length) {
    res.status(400).json({ error: 'Select at least one session to delete.' });
    return;
  }

  const deletedCount = await deleteSessions(sessionIds);
  res.json({
    ok: true,
    deletedCount,
    requestedCount: sessionIds.length,
  });
});

app.post('/api/admin/sessions/delete-selected', requireAdmin, async (req, res) => {
  const sessionIds = parseSessionIdsFromRequest(req);

  if (!sessionIds.length) {
    res.status(400).json({ error: 'Select at least one session to delete.' });
    return;
  }

  const deletedCount = await deleteSessions(sessionIds);
  res.json({
    ok: true,
    deletedCount,
    requestedCount: sessionIds.length,
  });
});

app.post('/api/admin/sessions/purge', requireAdmin, async (req, res) => {
  const scope = normalizeName(req.body?.scope ?? '').toLowerCase();
  if (!['all', 'submitted', 'active', 'time_up'].includes(scope)) {
    res.status(400).json({ error: 'Purge scope must be one of: all, submitted, active, time_up.' });
    return;
  }

  const sessions = await getLatestSessions();
  const targetIds = sessions
    .filter((session) => {
      if (scope === 'all') {
        return true;
      }
      return sessionStatus(session) === scope;
    })
    .map((session) => session.id);

  const deletedCount = await deleteSessions(targetIds);
  res.json({
    ok: true,
    deletedCount,
    scope,
  });
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const search = normalizeName(req.query?.search ?? '').toLowerCase();
  const classRoom = normalizeName(req.query?.classRoom ?? '');
  const examIdFilter = normalizeExamId(req.query?.examId ?? '');

  const sessions = await getLatestSessions();
  const grouped = new Map();

  for (const session of sessions) {
    const row = toSessionRow(session);
    const key = row.studentKey;
    const existing = grouped.get(key) ?? {
      studentKey: key,
      studentName: row.studentName,
      classRoom: row.classRoom,
      email: row.email,
      examId: row.examId,
      examTitle: row.examTitle,
      totalTrials: 0,
      submittedTrials: 0,
      activeTrials: 0,
      timeUpTrials: 0,
      bestFinalPercent: 0,
      averageFinalPercent: 0,
      latestStartedAt: 0,
      scores: [],
      trials: [],
    };

    existing.totalTrials += 1;
    existing.latestStartedAt = Math.max(existing.latestStartedAt, row.startedAt);

    if (row.status === 'submitted') {
      existing.submittedTrials += 1;
      existing.scores.push(row.finalPercent);
      existing.bestFinalPercent = Math.max(existing.bestFinalPercent, row.finalPercent);
    } else if (row.status === 'active') {
      existing.activeTrials += 1;
    } else {
      existing.timeUpTrials += 1;
    }

    existing.trials.push({
      id: row.id,
      trialNumber: row.trialNumber,
      status: row.status,
      finalPercent: row.finalPercent,
      violationsCount: row.violationsCount,
      totalViolationsCount: row.totalViolationsCount,
      waivedViolationsCount: row.waivedViolationsCount,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
    });

    grouped.set(key, existing);
  }

  const students = [...grouped.values()]
    .map((entry) => ({
      studentKey: entry.studentKey,
      studentName: entry.studentName,
      classRoom: entry.classRoom,
      email: entry.email,
      examId: entry.examId,
      examTitle: entry.examTitle,
      totalTrials: entry.totalTrials,
      submittedTrials: entry.submittedTrials,
      activeTrials: entry.activeTrials,
      timeUpTrials: entry.timeUpTrials,
      bestFinalPercent: Number(entry.bestFinalPercent.toFixed(2)),
      averageFinalPercent: average(entry.scores),
      latestStartedAt: entry.latestStartedAt,
      trials: entry.trials.sort((left, right) => right.startedAt - left.startedAt),
    }))
    .filter((entry) => {
      if (classRoom && entry.classRoom !== classRoom) {
        return false;
      }

      if (examIdFilter && entry.examId !== examIdFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = `${entry.studentName} ${entry.email} ${entry.examTitle} ${entry.studentKey}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => right.latestStartedAt - left.latestStartedAt);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    total: students.length,
    students,
  });
});

app.get('/api/admin/students/:studentKey/trials', requireAdmin, async (req, res) => {
  const studentKey = normalizeName(req.params.studentKey);
  if (!studentKey) {
    res.status(400).json({ error: 'Student key is required.' });
    return;
  }

  const sessions = await getLatestSessions();
  const trials = sessions
    .filter((session) => (session.studentKey ?? '') === studentKey)
    .sort((left, right) => right.startedAt - left.startedAt);

  if (!trials.length) {
    res.status(404).json({ error: 'No trials found for this student.' });
    return;
  }

  const first = trials[0];
  const payload = trials.map((trial) => ({
    id: trial.id,
    exam: {
      id: trial.examId ?? 'general',
      title: trial.examTitle ?? 'General Exam Pool',
    },
    trialNumber: trial.trialNumber ?? 1,
    status: sessionStatus(trial),
    startedAt: trial.startedAt,
    submittedAt: trial.submittedAt,
    expiresAt: trial.expiresAt,
    durationSeconds: trial.durationSeconds,
    summary: trial.summary ?? evaluateSession(trial),
    violations: trial.violations ?? [],
    feedback: trial.feedback ?? null,
    questionReview: buildQuestionReview(trial),
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    student: {
      studentKey,
      studentName: first.student?.fullName ?? 'Unknown',
      classRoom: first.student?.classRoom ?? 'Unknown',
      email: first.student?.email ?? '',
      examId: first.examId ?? 'general',
      examTitle: first.examTitle ?? 'General Exam Pool',
    },
    totalTrials: payload.length,
    trials: payload,
  });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const search = normalizeName(req.query?.search ?? '').toLowerCase();
  const classRoom = normalizeName(req.query?.classRoom ?? '');
  const status = normalizeName(req.query?.status ?? '').toLowerCase();

  const [users, sessions, helpRequests] = await Promise.all([
    listUsers(),
    getLatestSessions(),
    listPasswordAssistanceRequests(),
  ]);
  const openHelpByUserKey = new Map();
  for (const request of helpRequests) {
    if (request.status === 'resolved') {
      continue;
    }
    const key = request.userKey ?? '';
    openHelpByUserKey.set(key, (openHelpByUserKey.get(key) ?? 0) + 1);
  }

  const rows = users
    .map((user) => {
      const ownedSessions = sessions.filter((session) => studentOwnsSession(user, session));
      const submitted = ownedSessions.filter((session) => session.submittedAt);
      const bestFinalPercent = submitted.length
        ? Math.max(...submitted.map((session) => Number(session.summary?.finalPercent ?? 0)))
        : 0;
      const latestTrialAt = ownedSessions.length
        ? Math.max(...ownedSessions.map((session) => Number(session.startedAt) || 0))
        : null;

      return {
        ...toPublicUserRecord(user),
        totalTrials: ownedSessions.length,
        submittedTrials: submitted.length,
        bestFinalPercent: Number(bestFinalPercent.toFixed(2)),
        latestTrialAt,
        openHelpRequests: openHelpByUserKey.get(user.userKey) ?? 0,
      };
    })
    .filter((row) => {
      if (classRoom && row.classRoom !== classRoom) {
        return false;
      }

      if (status === 'disabled' && !row.disabled) {
        return false;
      }
      if (status === 'active' && row.disabled) {
        return false;
      }
      if (status === 'must_change' && !row.mustChangePassword) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = `${row.fullName} ${row.email} ${row.userKey}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => {
      if ((right.latestTrialAt ?? 0) !== (left.latestTrialAt ?? 0)) {
        return (right.latestTrialAt ?? 0) - (left.latestTrialAt ?? 0);
      }
      return left.fullName.localeCompare(right.fullName);
    });

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    total: rows.length,
    users: rows,
  });
});

app.patch('/api/admin/users/:userId', requireAdmin, async (req, res) => {
  const userId = normalizeName(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: 'User ID is required.' });
    return;
  }

  const patch = {};
  if (req.body?.fullName !== undefined) {
    const fullName = normalizeName(req.body.fullName);
    if (fullName.length < 5) {
      res.status(400).json({ error: 'Full name must be at least 5 characters.' });
      return;
    }
    patch.fullName = fullName;
  }
  if (req.body?.classRoom !== undefined) {
    const classRoom = normalizeName(req.body.classRoom);
    if (!CLASS_OPTIONS.includes(classRoom)) {
      res.status(400).json({ error: 'Please choose a valid class.' });
      return;
    }
    patch.classRoom = classRoom;
  }
  if (req.body?.email !== undefined) {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email.' });
      return;
    }
    patch.email = email;
  }
  if (req.body?.disabled !== undefined) {
    patch.disabled = Boolean(req.body.disabled);
  }
  if (req.body?.mustChangePassword !== undefined) {
    patch.mustChangePassword = Boolean(req.body.mustChangePassword);
  }

  if (!Object.keys(patch).length) {
    res.status(400).json({ error: 'No changes provided.' });
    return;
  }

  try {
    const updated = await updateUser(userId, patch);
    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (updated.disabled) {
      revokeStudentTokensForUser(updated.id);
    }

    res.json({
      ok: true,
      user: toPublicUserRecord(updated),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update user.' });
  }
});

app.post('/api/admin/users/:userId/password', requireAdmin, async (req, res) => {
  const userId = normalizeName(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: 'User ID is required.' });
    return;
  }

  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (newPassword.length < 4) {
    res.status(400).json({ error: 'New password must be at least 4 characters.' });
    return;
  }

  const nextHash = hashPasswordScrypt(newPassword);
  const updated = await updateUserPassword(user.id, nextHash, {
    mustChangePassword: req.body?.mustChangePassword !== false,
  });
  revokeStudentTokensForUser(user.id);

  res.json({
    ok: true,
    user: toPublicUserRecord(updated),
  });
});

app.get('/api/admin/password-help', requireAdmin, async (req, res) => {
  const status = normalizeName(req.query?.status ?? '').toLowerCase();
  const search = normalizeName(req.query?.search ?? '').toLowerCase();
  const rows = await listPasswordAssistanceRequests();

  const filtered = rows
    .filter((row) => {
      if (status && status !== 'all' && row.status !== status) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = `${row.fullName} ${row.classRoom} ${row.email} ${row.message}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    total: filtered.length,
    requests: filtered,
  });
});

app.patch('/api/admin/password-help/:requestId/resolve', requireAdmin, async (req, res) => {
  const requestId = normalizeName(req.params.requestId);
  if (!requestId) {
    res.status(400).json({ error: 'Request ID is required.' });
    return;
  }

  const updated = await resolvePasswordAssistanceRequest(requestId, 'admin');
  if (!updated) {
    res.status(404).json({ error: 'Password-help request not found.' });
    return;
  }

  res.json({
    ok: true,
    request: updated,
  });
});

app.get('/api/admin/exams', requireAdmin, async (_req, res) => {
  const [exams, questionPool, questionMap] = await Promise.all([
    listExams(),
    getQuestionPool(),
    getQuestionByIdMap(),
  ]);

  const rows = exams.map((exam) => {
    const availableQuestionCount = pickExamQuestionSet(exam, questionPool, questionMap).length;
    return {
      ...toPublicExam(exam),
      availableQuestionCount,
      isReady: availableQuestionCount >= exam.questionCount,
    };
  });

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    exams: rows,
  });
});

app.get('/api/admin/exams/:examId', requireAdmin, async (req, res) => {
  const examId = normalizeExamId(req.params.examId);
  if (!examId) {
    res.status(400).json({ error: 'Invalid exam ID.' });
    return;
  }

  const [exam, questionPool, questionMap] = await Promise.all([
    getExam(examId),
    getQuestionPool(),
    getQuestionByIdMap(),
  ]);

  if (!exam) {
    res.status(404).json({ error: 'Exam not found.' });
    return;
  }

  const questions = pickExamQuestionSet(exam, questionPool, questionMap);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    exam: {
      ...toPublicExam(exam),
      availableQuestionCount: questions.length,
      isReady: questions.length >= exam.questionCount,
    },
    questions: questions.map(questionToAdminRow),
  });
});

app.post('/api/admin/exams', requireAdmin, async (req, res) => {
  const title = normalizeName(req.body?.title);
  if (title.length < 3) {
    res.status(400).json({ error: 'Exam title must be at least 3 characters.' });
    return;
  }

  const questionDrafts = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!questionDrafts.length) {
    res.status(400).json({ error: 'Add at least one question to create a new exam.' });
    return;
  }

  try {
    const baseExam = await createExam({
      id: req.body?.id,
      title,
      description: req.body?.description,
      mode: 'pool',
      questionCount: Number(req.body?.questionCount) || questionDrafts.length,
      durationSeconds: req.body?.durationSeconds,
      maxAttempts: req.body?.maxAttempts,
      allowedClasses: req.body?.allowedClasses,
      published: req.body?.published,
      proctoring: req.body?.proctoring,
      isDefault: false,
    });

    const createdQuestions = [];
    for (const draft of questionDrafts) {
      const createdQuestion = await addQuestion({
        ...draft,
        sourceExamId: baseExam.id,
      });
      createdQuestions.push(createdQuestion);
    }

    const finalExam = await updateExam(baseExam.id, {
      mode: 'fixed',
      questionIds: createdQuestions.map((question) => question.id),
      questionCount: Math.min(
        Number(req.body?.questionCount) || createdQuestions.length,
        createdQuestions.length
      ),
    });

    res.status(201).json({
      ok: true,
      exam: toPublicExam(finalExam),
      questionsAdded: createdQuestions.length,
      questions: createdQuestions.map(questionToAdminRow),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create exam.' });
  }
});

app.patch('/api/admin/exams/:examId', requireAdmin, async (req, res) => {
  const examId = normalizeExamId(req.params.examId);
  if (!examId) {
    res.status(400).json({ error: 'Invalid exam ID.' });
    return;
  }

  const patch = {};
  if (req.body?.title !== undefined) {
    patch.title = req.body.title;
  }
  if (req.body?.description !== undefined) {
    patch.description = req.body.description;
  }
  if (req.body?.allowedClasses !== undefined) {
    patch.allowedClasses = req.body.allowedClasses;
  }
  if (req.body?.published !== undefined) {
    patch.published = req.body.published;
  }
  if (req.body?.durationSeconds !== undefined) {
    patch.durationSeconds = req.body.durationSeconds;
  }
  if (req.body?.maxAttempts !== undefined) {
    patch.maxAttempts = req.body.maxAttempts;
  }
  if (req.body?.questionCount !== undefined) {
    patch.questionCount = req.body.questionCount;
  }
  if (req.body?.proctoring !== undefined) {
    patch.proctoring = req.body.proctoring;
  }

  try {
    const updated = await updateExam(examId, patch);
    const [questionPool, questionMap] = await Promise.all([getQuestionPool(), getQuestionByIdMap()]);
    const availableQuestionCount = pickExamQuestionSet(updated, questionPool, questionMap).length;

    res.json({
      ok: true,
      exam: {
        ...toPublicExam(updated),
        availableQuestionCount,
        isReady: availableQuestionCount >= updated.questionCount,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update exam.' });
  }
});

app.get('/api/admin/questions', requireAdmin, async (_req, res) => {
  const questionPool = await getQuestionPool();
  const examIdFilter = normalizeExamId(_req.query?.examId ?? '');
  const filteredPool = examIdFilter
    ? questionPool.filter((question) => (question.sourceExamId ?? 'general') === examIdFilter)
    : questionPool;

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    questionCount: filteredPool.length,
    requiredExamQuestionCount: EXAM_QUESTION_COUNT,
    questions: filteredPool.map(questionToAdminRow),
  });
});

app.post('/api/admin/questions', requireAdmin, async (req, res) => {
  try {
    const created = await addQuestion(req.body ?? {});
    const questionPool = await getQuestionPool();

    res.status(201).json({
      ok: true,
      question: questionToAdminRow(created),
      questionCount: questionPool.length,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid question payload.' });
  }
});

app.get('/api/admin/export/sessions.csv', requireAdmin, async (_req, res) => {
  const sessions = await getLatestSessions();

  const rows = sessions
    .map((session) => {
      const summary = session.summary ?? evaluateSession(session);
      return {
        sessionId: session.id,
        examId: session.examId ?? 'general',
        examTitle: session.examTitle ?? 'General Exam Pool',
        trialNumber: session.trialNumber ?? 1,
        studentKey: session.studentKey ?? buildStudentKey(session.student, session.examId),
        fullName: session.student?.fullName ?? '',
        classRoom: session.student?.classRoom ?? '',
        email: session.student?.email ?? '',
        status: sessionStatus(session),
        startedAtIso: new Date(session.startedAt).toISOString(),
        submittedAtIso: session.submittedAt ? new Date(session.submittedAt).toISOString() : '',
        answeredCount: summary.answeredCount,
        correctCount: summary.correctCount,
        rawPercent: summary.rawPercent,
        penaltyPoints: summary.penaltyPoints,
        finalPercent: summary.finalPercent,
        violationsCount: summary.violationsCount,
        totalViolationsCount: summary.totalViolationsCount,
        waivedViolationsCount: summary.waivedViolationsCount,
        feedbackRating: session.feedback?.rating ?? '',
        feedbackComment: session.feedback?.comment ?? '',
        feedbackSubmittedAtIso: session.feedback?.submittedAt
          ? new Date(session.feedback.submittedAt).toISOString()
          : '',
      };
    })
    .sort((left, right) =>
      left.startedAtIso < right.startedAtIso ? 1 : left.startedAtIso > right.startedAtIso ? -1 : 0
    );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sessions-export.csv"');
  res.send(toCsv(rows));
});

app.get('/api/admin/export/sessions.json', requireAdmin, async (_req, res) => {
  const sessions = await getLatestSessions();

  const payload = sessions
    .map((session) => ({
      ...toSessionRow(session),
      startedAtIso: new Date(session.startedAt).toISOString(),
      submittedAtIso: session.submittedAt ? new Date(session.submittedAt).toISOString() : null,
      feedbackSubmittedAtIso: session.feedback?.submittedAt
        ? new Date(session.feedback.submittedAt).toISOString()
        : null,
    }))
    .sort((left, right) => right.startedAt - left.startedAt);

  res.setHeader('Content-Disposition', 'attachment; filename="sessions-export.json"');
  res.json(payload);
});

app.get('/api/admin/export/emails.csv', requireAdmin, async (_req, res) => {
  const sessions = await getLatestSessions();

  const uniqueEmails = [...new Set(
    sessions
      .map((session) => normalizeEmail(session.student?.email ?? ''))
      .filter((email) => isValidEmail(email))
  )];

  const rows = uniqueEmails
    .sort((left, right) => left.localeCompare(right))
    .map((email) => ({ email }));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="emails-only-export.csv"');
  res.send(toCsv(rows));
});

app.get('/api/admin/export/questions.csv', requireAdmin, async (_req, res) => {
  const questionPool = await getQuestionPool();

  const rows = questionPool.map((question) => ({
    id: question.id,
    sourceExamId: question.sourceExamId ?? 'general',
    topic: question.topic,
    type: question.type,
    text: question.text,
    optionA: question.options[0]?.text ?? '',
    optionB: question.options[1]?.text ?? '',
    optionC: question.options[2]?.text ?? '',
    optionD: question.options[3]?.text ?? '',
    correctOptionIds: question.correctOptionIds.join('|'),
  }));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="questions-export.csv"');
  res.send(toCsv(rows));
});

app.get('/api/admin/export/questions.json', requireAdmin, async (_req, res) => {
  const questionPool = await getQuestionPool();

  res.setHeader('Content-Disposition', 'attachment; filename="questions-export.json"');
  res.json(questionPool);
});

const distPath = path.resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Salem Exam API running on http://localhost:${PORT}`);
  if (!parsedAdminPasscodeHash) {
    console.warn('ADMIN_PASSCODE_HASH is not configured. Admin login is disabled until it is set.');
  }
  startKeepAliveLoop();
});
