import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { CLASS_OPTIONS, EXAM_DURATION_SECONDS, EXAM_QUESTION_COUNT } from './questions.js';
import {
  buildReviewItem,
  describeCorrectAnswer,
  describeResponse,
  isAnswered,
  isResponseCorrect,
  prepareQuestionForSession,
  questionTypeLabel,
  sanitizeResponse,
  sectionRank,
  toPublicQuestion,
} from './questionModel.js';
import {
  addQuestion,
  deleteQuestion,
  deleteQuestionsBySourceExam,
  getQuestion,
  getQuestionByIdMap,
  getQuestionPool,
  getQuestionPoolCount,
  updateQuestion,
} from './questionStore.js';
import {
  attachExamQuestionIds,
  createExam,
  deleteExam,
  findExamsOnlyUsingQuestion,
  getExam,
  listExams,
  removeQuestionFromExams,
  toPublicExam,
  updateExam,
} from './examStore.js';
import {
  buildUserKey,
  createUserWithPassword,
  createPasswordAssistanceRequest,
  getUserByEmail,
  getUserById,
  getUserByKey,
  getUserByUsername,
  initUserStore,
  listPasswordAssistanceRequests,
  listUsers,
  resolvePasswordAssistanceRequest,
  toPublicUserRecord,
  updateUser,
  updateUserPassword,
  touchUserLogin,
} from './userStore.js';
import {
  hashPasswordScryptAsync,
  parseScryptHash,
  verifyPasswordScryptAsync,
} from './authUtils.js';
import { closeDb, getDb } from './db.js';
import { clientIp, createRateLimiter } from './rateLimit.js';
import { renderBulkReportCardsHtml, renderReportCardHtml, renderResultSheetHtml } from './reportCard.js';
import { CURRENT_EXAM, CURRENT_EXAM_ID, CURRENT_EXAM_QUESTIONS, CURRENT_EXAM_SEED_KEY } from './currentExam.js';
import {
  deleteAdminToken,
  getAdminToken,
  saveAdminToken,
} from './adminTokenStore.js';
import {
  countGeneralFeedback,
  createGeneralFeedback,
  listGeneralFeedbackByUser,
} from './generalFeedbackStore.js';
import {
  getBrandingSettings,
  updateBrandingSettings,
} from './settingsStore.js';
import {
  deleteStudentToken,
  deleteStudentTokensByUser,
  getStudentToken,
  saveStudentToken,
} from './studentTokenStore.js';
import {
  countSessions,
  countSessionsByExam,
  deleteSession,
  deleteSessions,
  getSession,
  getSessionRevision,
  initSessionStore,
  insertSession,
  listSessions,
  saveSessionIfRevision,
  SESSION_LIST_PROJECTION,
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
// Writes (answers, submit) are still accepted this long after the timer reaches zero, so answers
// already on their way when time runs out (slow school Wi-Fi, a busy server) are not lost. The
// student's screen locks at 00:00, so this cannot be used to keep answering.
const SUBMIT_GRACE_MS_INPUT = Number(process.env.SUBMIT_GRACE_MS ?? 90_000);
const SUBMIT_GRACE_MS =
  Number.isFinite(SUBMIT_GRACE_MS_INPUT) && SUBMIT_GRACE_MS_INPUT >= 0 ? Math.round(SUBMIT_GRACE_MS_INPUT) : 90_000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// Self-ping loop for hosts that sleep idle apps (e.g. Render free tier). Not needed on a VPS.
// Render sets RENDER=true; there the loop is on by default and pings the public URL.
const IS_RENDER = Boolean(process.env.RENDER);
const KEEP_ALIVE_ENABLED = String(process.env.KEEP_ALIVE_ENABLED ?? (IS_RENDER ? 'true' : 'false')).toLowerCase() === 'true';
// Set when running behind a reverse proxy such as nginx (e.g. "loopback" or "1") so rate limits
// see real client IPs instead of the proxy's.
const TRUST_PROXY = String(process.env.TRUST_PROXY ?? (IS_RENDER ? 'true' : '')).trim();
// Comma-separated list of origins allowed to call the API from another domain. Leave empty when
// the API serves the frontend itself (same origin), which is the recommended setup.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
// Students sign up without choosing a password; they start with this one and must replace it
// the first time they sign in. Admin password resets use it too.
const DEFAULT_STUDENT_PASSWORD = String(process.env.DEFAULT_STUDENT_PASSWORD ?? 'salem').trim() || 'salem';
// IANA time zone used for dates printed on report cards (e.g. "Africa/Lagos"). A VPS is often set
// to UTC or the data centre's zone, which would print the wrong local time for students.
const APP_TIMEZONE = String(process.env.APP_TIMEZONE ?? '').trim();
const KEEP_ALIVE_URL = String(
  process.env.KEEP_ALIVE_URL ??
    (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '')}/api/keep-alive` : '')
).trim();
const KEEP_ALIVE_INTERVAL_MS_INPUT = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? 5 * 60 * 1000);
const KEEP_ALIVE_INTERVAL_MS =
  Number.isFinite(KEEP_ALIVE_INTERVAL_MS_INPUT) && KEEP_ALIVE_INTERVAL_MS_INPUT >= 60_000
    ? KEEP_ALIVE_INTERVAL_MS_INPUT
    : 5 * 60 * 1000;

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

function normalizeUsername(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    : '';
}

function formatStudentContact(email, username) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return normalizedEmail;
  }

  const normalizedUsername = normalizeUsername(username);
  return normalizedUsername ? `@${normalizedUsername}` : '';
}

function toTitleCaseWords(value) {
  const normalized = normalizeName(value);
  if (!normalized) {
    return '';
  }

  return normalized
    .split(' ')
    .map((word) => {
      if (!word) {
        return '';
      }
      return `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ');
}

/** "aDA o'NEIL-smith" -> "Ada O'Neil-Smith": capitalised after spaces, hyphens and apostrophes. */
function toNameCase(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

const NAME_PART_PATTERN = /^\p{L}[\p{L}'’ -]{0,39}$/u;

/** Reads first/middle/last name fields (or splits a legacy fullName). */
function readNameParts(body) {
  let firstName = toNameCase(body?.firstName);
  let middleName = toNameCase(body?.middleName);
  let lastName = toNameCase(body?.lastName);
  const legacyFullName = toNameCase(body?.fullName);
  if (!firstName && !lastName && legacyFullName) {
    const words = legacyFullName.split(' ');
    firstName = words[0] ?? '';
    lastName = words.length > 1 ? words.at(-1) : '';
    middleName = words.slice(1, -1).join(' ');
  }
  return { firstName, middleName, lastName, fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') };
}

/** Returns an error message for invalid names, or ''. */
function validateNameParts({ firstName, middleName, lastName }) {
  if (firstName.length < 2) return 'Enter your first name.';
  if (lastName.length < 2) return 'Enter your last name (your family name).';
  for (const part of [firstName, middleName, lastName].filter(Boolean)) {
    if (!NAME_PART_PATTERN.test(part)) return 'Names can only use letters, spaces, hyphens and apostrophes.';
  }
  if (middleName && middleName.replace(/[^\p{L}]/gu, '').length < 2) {
    return 'Write your middle name in full, not just the first letter.';
  }
  return '';
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
  const username = normalizeUsername(student?.username);
  const identity = email || (username ? `@${username}` : '');
  const safeExamId = normalizeExamId(examId || student?.examId || '');
  return `${fullName}|${classRoom}|${identity}|${safeExamId}`;
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

  const normalized = {
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
  // Evidence recorded by the browser (how long the student was away, what they were doing) and
  // any dispute. Kept as-is; it was validated when it was written.
  for (const key of ['evidence', 'dispute']) {
    if (value[key] && typeof value[key] === 'object') {
      normalized[key] = value[key];
    }
  }
  return normalized;
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

function isValidUsername(value) {
  return /^[a-z0-9._-]{3,32}$/.test(normalizeUsername(value));
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

const parsedAdminPasscodeHash = parseScryptHash(ADMIN_PASSCODE_HASH);

async function verifyAdminPasscode(passcode) {
  return Boolean(parsedAdminPasscodeHash) && verifyPasswordScryptAsync(passcode, ADMIN_PASSCODE_HASH);
}

function normalizeQuestionId(value) {
  return normalizeName(value).toUpperCase();
}

/**
 * The question ID is authoritative; the position is only a fallback for clients holding a stale
 * or differently-cased ID. (Previously the position won, and because a missing index defaulted
 * to null and Number(null) === 0, a request without an index silently overwrote question 1.)
 */
function resolveSessionQuestionId(session, requestedQuestionId, requestedQuestionIndex) {
  const order = Array.isArray(session?.questionOrder) ? session.questionOrder : [];
  if (!order.length) {
    return null;
  }

  if (requestedQuestionId && order.includes(requestedQuestionId)) {
    return requestedQuestionId;
  }

  const normalizedRequested = normalizeQuestionId(requestedQuestionId);
  if (normalizedRequested) {
    for (const questionId of order) {
      if (normalizeQuestionId(questionId) === normalizedRequested) {
        return questionId;
      }
    }
  }

  const hasIndex =
    requestedQuestionIndex !== null && requestedQuestionIndex !== undefined && requestedQuestionIndex !== '';
  const indexValue = hasIndex ? Number(requestedQuestionIndex) : NaN;
  if (Number.isInteger(indexValue) && indexValue >= 0 && indexValue < order.length) {
    return order[indexValue];
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

/** Admin override for one question (true/false), or null when the automatic mark stands. */
function getManualGrade(session, questionId) {
  const value = session.manualGrades?.[questionId];
  return value === true || value === false ? value : null;
}

function isQuestionCorrect(session, questionId) {
  const manual = getManualGrade(session, questionId);
  if (manual !== null) {
    return manual;
  }
  const question = session.questionSnapshot?.[questionId];
  return question ? isResponseCorrect(question, session.answers?.[questionId]) : false;
}

function evaluateSession(session) {
  let correctCount = 0;
  let answeredCount = 0;

  for (const questionId of session.questionOrder) {
    const question = session.questionSnapshot?.[questionId];
    if (!question) {
      continue;
    }

    if (isAnswered(question, session.answers?.[questionId])) {
      answeredCount += 1;
    }

    if (isQuestionCorrect(session, questionId)) {
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
    .map(toPublicQuestion);

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
    questionReview: buildStudentQuestionReview(session),
    summary: session.summary,
    feedback: session.feedback ?? null,
    hints: buildClientHints(session),
  };
}

/** How many hints a student in `classRoom` gets for `exam` (0 unless the exam enables them). */
function hintLimitFor(exam, classRoom) {
  const allowed = Number(exam?.hintsAllowed) || 0;
  return allowed > 0 && (exam.hintClasses ?? []).includes(classRoom) ? allowed : 0;
}

/** The student's hint budget and the hints already revealed (so they survive a refresh). */
function buildClientHints(session) {
  const revealed = {};
  for (const questionId of Object.keys(session.hintsUsed ?? {})) {
    const hint = session.questionSnapshot?.[questionId]?.hint;
    if (hint) revealed[questionId] = hint;
  }
  const limit = Number(session.hintLimit) || 0;
  return { limit, used: Object.keys(session.hintsUsed ?? {}).length, revealed };
}

/** True once the exam time and the grace period for in-flight answers have both passed. */
function isPastGrace(session, now = Date.now()) {
  return now >= Number(session.expiresAt) + SUBMIT_GRACE_MS;
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
    username: normalizeUsername(session.student?.username ?? ''),
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
    normalizedStudent.username !== (session.student?.username ?? '') ||
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

  if (!next.submittedAt && isPastGrace(next)) {
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
    // Conditional write: if the student saved an answer between our read and this write, keep
    // their write and skip ours (the next read normalizes again). This used to be an
    // unconditional replace that could silently drop a just-saved answer.
    const saved = await saveSessionIfRevision(next, getSessionRevision(session));
    if (saved) {
      return saved;
    }
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

function stripQuestionSnapshot(session) {
  if (!session) {
    return session;
  }

  const { questionSnapshot: _ignoredSnapshot, ...rest } = session;
  return rest;
}

/**
 * Cheap, read-only normalization for list views. Works on documents fetched without the
 * question snapshot and never writes to the database.
 */
function normalizeSessionLite(session, examMap) {
  const student = {
    fullName: normalizeName(session.student?.fullName ?? ''),
    classRoom: normalizeName(session.student?.classRoom ?? ''),
    email: normalizeEmail(session.student?.email ?? ''),
    username: normalizeUsername(session.student?.username ?? ''),
  };
  const examId = normalizeExamId(session.examId) || 'general';
  const exam = examMap?.get(examId) ?? null;
  const examMaxAttemptsInput = Number(session.examMaxAttempts);
  const trialNumberInput = Number(session.trialNumber);

  return {
    ...session,
    student,
    examId,
    examTitle: normalizeName(session.examTitle) || exam?.title || 'General Exam Pool',
    examMaxAttempts:
      Number.isFinite(examMaxAttemptsInput) && examMaxAttemptsInput > 0
        ? Math.round(examMaxAttemptsInput)
        : Number(exam?.maxAttempts ?? 3),
    trialNumber: Number.isFinite(trialNumberInput) && trialNumberInput > 0 ? Math.round(trialNumberInput) : 1,
    studentKey: normalizeName(session.studentKey) || buildStudentKey(student, examId),
    userKey: normalizeName(session.userKey) || buildUserKey(student),
    userId: normalizeName(session.userId) || null,
    durationSeconds: session.durationSeconds ?? EXAM_DURATION_SECONDS,
    answers: session.answers ?? {},
    flagged: session.flagged ?? {},
    seen: session.seen ?? {},
    violations: (Array.isArray(session.violations) ? session.violations : [])
      .map((violation) => normalizeStoredViolation(violation))
      .filter(Boolean),
    questionOrder: Array.isArray(session.questionOrder) ? session.questionOrder : [],
    feedback: normalizeStoredFeedback(session.feedback),
    resultsAvailableAt: session.submittedAt ? getResultsAvailableAt(session) : null,
  };
}

/**
 * Loads sessions for list views (dashboards, admin tables, exports) without question snapshots.
 * Sessions that ran out of time without being submitted (student closed the browser) are
 * finalized here, as the old full-scan did, so they still count towards results.
 */
async function loadSessionList(filter = {}, projection = SESSION_LIST_PROJECTION) {
  const [rows, exams] = await Promise.all([listSessions({ filter, projection }), listExams()]);
  const examMap = new Map(exams.map((exam) => [exam.id, exam]));
  const now = Date.now();
  const needsFullNormalize = rows.filter(
    (session) =>
      (!session.submittedAt && isPastGrace(session, now)) || (session.submittedAt && !session.summary)
  );

  const refreshed = new Map();
  if (needsFullNormalize.length > 0) {
    const fullSessions = await Promise.all(needsFullNormalize.map((session) => getLatestSession(session.id)));
    for (const fullSession of fullSessions) {
      if (fullSession) {
        refreshed.set(fullSession.id, stripQuestionSnapshot(fullSession));
      }
    }
    invalidateLeaderboardCache();
  }

  return rows.map((session) => normalizeSessionLite(refreshed.get(session.id) ?? session, examMap));
}

function studentSessionFilter(user) {
  const clauses = [{ userId: user.id }];
  if (user.userKey) {
    clauses.push({ userKey: user.userKey });
  }
  return { $or: clauses };
}

async function loadStudentTrials(user) {
  const sessions = await loadSessionList(studentSessionFilter(user));
  return sessions
    .filter((session) => studentOwnsSession(user, session))
    .sort((left, right) => right.startedAt - left.startedAt);
}

// Leaderboards are shown on every student dashboard load. Rebuilding them for each request
// meant a full collection scan per login; now they are rebuilt at most every few seconds and
// immediately after a submission or an admin change.
const LEADERBOARD_CACHE_TTL_MS = 10_000;
const LEADERBOARD_PROJECTION = Object.freeze({
  _id: 0,
  id: 1,
  userId: 1,
  userKey: 1,
  studentKey: 1,
  student: 1,
  examId: 1,
  examTitle: 1,
  startedAt: 1,
  expiresAt: 1,
  submittedAt: 1,
  summary: 1,
});
let leaderboardCache = null;
let leaderboardLoad = null;
let leaderboardGeneration = 0;

function invalidateLeaderboardCache() {
  leaderboardCache = null;
  leaderboardGeneration += 1;
}

async function getLeaderboardRows() {
  if (leaderboardCache && leaderboardCache.expiresAt > Date.now()) {
    return leaderboardCache.rows;
  }

  if (!leaderboardLoad) {
    const generation = leaderboardGeneration;
    leaderboardLoad = (async () => {
      const sessions = await loadSessionList({}, LEADERBOARD_PROJECTION);
      const rows = buildStudentLeaderboardRows(sessions);
      if (generation === leaderboardGeneration) {
        leaderboardCache = { rows, expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS };
      }
      return rows;
    })().finally(() => {
      leaderboardLoad = null;
    });
  }

  return leaderboardLoad;
}

async function loadStudentDashboard(user) {
  const [exams, trials, leaderboardRows, generalFeedbackHistory] = await Promise.all([
    listExams(),
    loadStudentTrials(user),
    getLeaderboardRows(),
    listGeneralFeedbackByUser(user.id, 8),
  ]);

  const activeTrial = trials.find((session) => !session.submittedAt && sessionStatus(session) === 'active');
  let activeSession = activeTrial ? await getLatestSession(activeTrial.id) : null;
  if (activeSession?.submittedAt) {
    activeSession = null;
  }

  return {
    generalFeedbackHistory,
    ...buildStudentDashboardPayload(user, exams, trials, leaderboardRows, activeSession),
  };
}

// Serializes exam starts per student so a double-click (or two tabs) cannot create two trials
// at once and exceed the attempt limit. In-process lock: fine for a single Node process.
const examStartLocks = new Map();

function withExamStartLock(key, task) {
  const previous = examStartLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  examStartLocks.set(key, tail);
  void tail.then(() => {
    if (examStartLocks.get(key) === tail) {
      examStartLocks.delete(key);
    }
  });
  return run;
}

async function finalizeIfExpired(sessionId) {
  return updateSession(sessionId, (current) => {
    if (current.submittedAt || !isPastGrace(current)) {
      return current;
    }
    return finalizeSession(current);
  });
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

  if (isPastGrace(session)) {
    const finalized = (await finalizeIfExpired(sessionId)) ?? finalizeSession(session);
    invalidateLeaderboardCache();
    res.status(409).json({ error: 'Exam time is over.', session: toStudentClientSession(finalized) });
    return null;
  }

  return session;
}

async function applyActiveSessionUpdateOrError(sessionId, res, studentUser, updater) {
  let rejectedResponse = null;

  const updated = await updateSession(sessionId, (current) => {
    if (studentUser && !studentOwnsSession(studentUser, current)) {
      rejectedResponse = {
        status: 403,
        payload: { error: 'You do not have access to this session.' },
      };
      return null;
    }

    if (current.submittedAt) {
      rejectedResponse = {
        status: 409,
        payload: { error: 'Exam already submitted.', session: toStudentClientSession(current) },
      };
      return null;
    }

    if (isPastGrace(current)) {
      const finalized = finalizeSession(current);
      rejectedResponse = {
        status: 409,
        payload: { error: 'Exam time is over.', session: toStudentClientSession(finalized) },
      };
      return finalized;
    }

    return updater(current);
  });

  if (rejectedResponse) {
    res.status(rejectedResponse.status).json(rejectedResponse.payload);
    return null;
  }

  if (updated) {
    return updated;
  }

  const latest = await getLatestSession(sessionId);
  if (!latest) {
    res.status(404).json({ error: 'Session not found.' });
    return null;
  }

  if (studentUser && !studentOwnsSession(studentUser, latest)) {
    res.status(403).json({ error: 'You do not have access to this session.' });
    return null;
  }

  if (latest.submittedAt) {
    res.status(409).json({ error: 'Exam already submitted.', session: toStudentClientSession(latest) });
    return null;
  }

  if (isPastGrace(latest)) {
    const finalized = (await finalizeIfExpired(sessionId)) ?? finalizeSession(latest);
    invalidateLeaderboardCache();
    res.status(409).json({ error: 'Exam time is over.', session: toStudentClientSession(finalized) });
    return null;
  }

  res.status(409).json({
    error: 'Could not update session right now. Please retry.',
    session: toStudentClientSession(latest),
  });
  return null;
}

// Expired tokens are removed by MongoDB's TTL indexes (see the token stores) and rejected on
// use below, so no per-request cleanup query is needed.
async function issueAdminToken() {
  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + ADMIN_TOKEN_LIFETIME_MS;

  await saveAdminToken({ token, createdAt, expiresAt });
  return { token, createdAt, expiresAt };
}

async function issueStudentToken(user) {
  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + STUDENT_TOKEN_LIFETIME_MS;

  const tokenRow = {
    token,
    createdAt,
    expiresAt,
    userId: user.id,
    userKey: user.userKey,
  };
  await saveStudentToken(tokenRow);

  return { token, createdAt, expiresAt };
}

async function revokeStudentTokensForUser(userId) {
  if (!userId) {
    return;
  }
  await deleteStudentTokensByUser(userId);
}

function getBearerToken(req) {
  const raw = req.headers.authorization ?? '';
  if (!raw.startsWith('Bearer ')) {
    return '';
  }

  return raw.slice('Bearer '.length).trim();
}

async function requireAdmin(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing admin token.' });
    return;
  }

  const details = await getAdminToken(token);
  if (!details) {
    res.status(401).json({ error: 'Invalid or expired admin token.' });
    return;
  }

  if (Number(details.expiresAt) <= Date.now()) {
    await deleteAdminToken(token);
    res.status(401).json({ error: 'Invalid or expired admin token.' });
    return;
  }

  req.admin = details;
  next();
}

async function requireStudent(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing student token.' });
    return;
  }

  const tokenDetails = await getStudentToken(token);
  if (!tokenDetails) {
    res.status(401).json({ error: 'Invalid or expired student token.' });
    return;
  }

  if (Number(tokenDetails.expiresAt) <= Date.now()) {
    await deleteStudentToken(token);
    res.status(401).json({ error: 'Invalid or expired student token.' });
    return;
  }

  const user = await getUserById(tokenDetails.userId);
  if (!user) {
    await deleteStudentToken(token);
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
    email: formatStudentContact(session.student?.email, session.student?.username),
    username: session.student?.username ?? '',
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    expiresAt: session.expiresAt,
    status,
    remainingSeconds,
    violationsCount: activeViolationsCount,
    totalViolationsCount,
    waivedViolationsCount,
    totalQuestions: session.summary?.totalQuestions ?? (session.questionOrder ?? []).length,
    answeredCount: session.summary?.answeredCount ?? countAnsweredQuestions(session),
    correctCount: session.summary?.correctCount ?? 0,
    rawPercent: session.summary?.rawPercent ?? 0,
    finalPercent: session.summary?.finalPercent ?? 0,
    feedbackRating: session.feedback?.rating ?? null,
    feedbackComment: session.feedback?.comment ?? '',
    feedbackSubmittedAt: session.feedback?.submittedAt ?? null,
  };
}

function hasAnyAnswer(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => entry !== null && entry !== undefined && entry !== '');
  }
  if (value && typeof value === 'object') {
    return Boolean(String(value.code ?? '').trim());
  }
  return false;
}

/** Answered-question count for list views, which load attempts without their questions. */
function countAnsweredQuestions(session) {
  return (session.questionOrder ?? []).filter((questionId) => hasAnyAnswer(session.answers?.[questionId])).length;
}

function toStudentTrialRow(session) {
  const released = isResultsReleased(session);
  // SECURITY: never score an unsubmitted session for the student. Returning a live summary here
  // let a student flip an answer, reload the dashboard and watch correctCount change, revealing
  // every correct answer mid-exam. In-progress trials only report how many questions are answered.
  const summary = session.submittedAt ? session.summary ?? null : null;
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
    summary,
    progress: {
      answeredCount: countAnsweredQuestions(session),
      totalQuestions: (session.questionOrder ?? []).length,
    },
    violations: session.violations ?? [],
    feedback: session.feedback ?? null,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let text = String(value);
  // Neutralize spreadsheet formulas: student-entered names or comments starting with = + - @
  // would otherwise execute when an admin opens the export in Excel or Sheets.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (!/[",\r\n]/.test(text)) {
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
    typeLabel: questionTypeLabel(question),
    answerKey:
      question.type === 'single' || question.type === 'multi'
        ? (question.correctOptionIds ?? [])
            .map((id) => (question.format && question.format !== 'choice' ? question.options?.find((o) => o.id === id)?.text ?? id : id))
            .join(', ')
        : '',
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

function buildQuestionReview(session, { reveal = true } = {}) {
  return (session.questionOrder ?? [])
    .map((questionId, index) => {
      const question = session.questionSnapshot?.[questionId];
      if (!question) {
        return null;
      }

      return {
        ...buildReviewItem(question, session.answers?.[questionId], {
          reveal,
          manualGrade: getManualGrade(session, questionId),
          index: index + 1,
        }),
        hintUsed: Boolean(session.hintsUsed?.[questionId]),
      };
    })
    .filter(Boolean);
}

/** Students see their own answers right away; corrections and explanations after release. */
function buildStudentQuestionReview(session) {
  return buildQuestionReview(session, { reveal: isResultsReleased(session) });
}

function buildReportQuestionRows(session, includeCorrectAnswers) {
  return (session.questionOrder ?? [])
    .map((questionId, index) => {
      const question = session.questionSnapshot?.[questionId];
      if (!question) {
        return null;
      }

      const response = session.answers?.[questionId];
      const correct = isQuestionCorrect(session, questionId);
      const isCode = question.type === 'code';
      return {
        index: index + 1,
        typeLabel: questionTypeLabel(question),
        text: question.text,
        code: question.code && !isCode ? question.code : '',
        selected: describeResponse(question, response) || 'No answer',
        selectedIsCode: isCode,
        checks: isCode ? response?.checks ?? null : null,
        testCount: isCode ? question.tests?.length ?? 0 : 0,
        correct: includeCorrectAnswers ? describeCorrectAnswer(question) : '',
        explanation: includeCorrectAnswers ? question.explanation ?? '' : '',
        result: includeCorrectAnswers ? (correct ? 'Correct' : 'Incorrect') : 'Locked',
        markedByTeacher: getManualGrade(session, questionId) !== null,
        hintUsed: Boolean(session.hintsUsed?.[questionId]),
      };
    })
    .filter(Boolean);
}

function buildReportCardPayload(session, branding, includeCorrectAnswers = false) {
  const summary = session.summary ?? evaluateSession(session);
  const resultsAvailableAt = getResultsAvailableAt(session);

  return {
    branding: {
      schoolName: normalizeName(branding?.schoolName) || 'Salem Academy',
      logoUrl: normalizeName(branding?.logoUrl),
    },
    student: {
      fullName: toTitleCaseWords(session.student?.fullName || ''),
      classRoom: session.student?.classRoom || 'Unknown',
      email: session.student?.email || '',
      username: session.student?.username || '',
      contact: formatStudentContact(session.student?.email, session.student?.username) || '-',
    },
    exam: {
      id: session.examId ?? 'general',
      title: session.examTitle ?? 'General Exam Pool',
      trialNumber: session.trialNumber ?? 1,
      sessionId: session.id,
    },
    submittedAt: session.submittedAt ?? null,
    startedAt: session.startedAt ?? null,
    resultsAvailableAt,
    resultsReleased: isResultsReleased(session),
    includeCorrectAnswers,
    summary,
    activeViolations: getActiveViolations(session),
    totalViolations: session.violations ?? [],
    questions: buildReportQuestionRows(session, includeCorrectAnswers),
    generatedAt: Date.now(),
    timeZone: APP_TIMEZONE || undefined,
  };
}

function buildReportCardFileName(session) {
  const name = toTitleCaseWords(session.student?.fullName || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${name || 'student'}-${session.id}-report-card.html`;
}

function toStudentClientSession(session) {
  return toClientSession(session);
}

function sanitizeViolationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((id) => normalizeName(id)).filter(Boolean))];
}

const KNOWN_VIOLATION_TYPES = ['tab_switch', 'window_blur', 'fullscreen_exit', 'right_click', 'restricted_key'];
// A focus loss shorter than this (a system notification, a mis-click on the taskbar) is logged
// for the teacher but does not cost the student points.
const BRIEF_FOCUS_LOSS_MS = 2000;
const MAX_EVIDENCE_DURATION_MS = 6 * 60 * 60 * 1000;

function boundedInt(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : null;
}

/** Context recorded by the browser with a violation, used as evidence when it is disputed. */
function sanitizeViolationEvidence(input, session) {
  const source = isPlainObject(input) ? input : {};
  const windowStart = Number(session?.startedAt) - 60_000;
  const windowEnd = Number(session?.expiresAt) + SUBMIT_GRACE_MS + 60_000;
  const timestamp = (value) => {
    const number = boundedInt(value, 0, Number.MAX_SAFE_INTEGER);
    return number !== null && number >= windowStart && number <= windowEnd ? number : null;
  };
  const evidence = {
    durationMs: boundedInt(source.durationMs, 0, MAX_EVIDENCE_DURATION_MS),
    startedAt: timestamp(source.startedAt),
    endedAt: timestamp(source.endedAt),
    questionNumber: boundedInt(source.questionNumber, 0, 1000),
    remainingSeconds: boundedInt(source.remainingSeconds, 0, 24 * 60 * 60),
    causes: (Array.isArray(source.causes) ? source.causes : [])
      .map((cause) => normalizeName(cause).toLowerCase())
      .filter((cause) => KNOWN_VIOLATION_TYPES.includes(cause))
      .slice(0, 5),
    note: normalizeName(source.note).slice(0, 200),
  };
  return Object.fromEntries(Object.entries(evidence).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length)));
}

function getViolationPolicy(session, type, evidence = {}) {
  const policy = normalizeProctoringPolicy(session?.examProctoring ?? {});
  if (type === 'window_blur' && Number.isFinite(evidence.durationMs) && evidence.durationMs < BRIEF_FOCUS_LOSS_MS) {
    return { track: true, deduct: false, policy: 'window_blur:brief' };
  }

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
    // Informational events (for example reopening the exam) are logged but never deduct points.
    return {
      track: true,
      deduct: false,
      policy: 'info',
    };
  }

  return {
    track: selected.track !== false,
    deduct: selected.track !== false && selected.deduct !== false,
    policy: selected.track === false ? `${selected.policy}:monitor_only` : selected.policy,
  };
}

/** What the student's pre-exam device check reported (shown to the teacher; never blocks). */
function sanitizeSetupInfo(input) {
  const source = isPlainObject(input) ? input : {};
  const camera = ['on', 'unavailable', 'denied'].includes(source.camera) ? source.camera : 'unknown';
  return {
    camera,
    fullscreen: source.fullscreen === true,
    practiceCompleted: source.practiceCompleted === true,
    checkedAt: Date.now(),
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
      (session) => studentOwnsSession(user, session) && (session.examId ?? 'general') === exam.id
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
      hintsForYou: hintLimitFor(exam, user.classRoom),
      attemptsUsed,
      attemptsRemaining,
      maxAttempts,
      canAttempt,
      bestFinalPercent: Number(bestFinalPercent.toFixed(2)),
    };
  });
}

function buildStudentLeaderboardRows(sessions) {
  const buckets = new Map();

  for (const session of sessions) {
    if (!session?.submittedAt) {
      continue;
    }

    // Group by account ID first: an admin renaming a student changes their userKey, and the
    // student's earlier attempts should stay on the same leaderboard row.
    const identityKey =
      session.userId || session.userKey || session.studentKey || buildStudentKey(session.student, session.examId);
    const existing = buckets.get(identityKey) ?? {
      identityKey,
      userId: session.userId ?? null,
      userKey: session.userKey ?? null,
      studentKey: session.studentKey ?? null,
      studentName: toTitleCaseWords(session.student?.fullName || 'Unknown Student'),
      classRoom: normalizeName(session.student?.classRoom) || 'Unknown',
      submittedTrials: 0,
      bestFinalPercent: 0,
      averageFinalPercent: 0,
      scores: [],
      latestSubmittedAt: 0,
    };

    const finalPercent = Number(session.summary?.finalPercent ?? 0);
    existing.submittedTrials += 1;
    existing.scores.push(finalPercent);
    existing.bestFinalPercent = Math.max(existing.bestFinalPercent, finalPercent);
    existing.latestSubmittedAt = Math.max(existing.latestSubmittedAt, Number(session.submittedAt) || 0);

    buckets.set(identityKey, existing);
  }

  return [...buckets.values()]
    .map((entry) => ({
      identityKey: entry.identityKey,
      userId: entry.userId,
      userKey: entry.userKey,
      studentKey: entry.studentKey,
      studentName: entry.studentName,
      classRoom: entry.classRoom,
      submittedTrials: entry.submittedTrials,
      bestFinalPercent: Number(entry.bestFinalPercent.toFixed(2)),
      averageFinalPercent: Number(average(entry.scores).toFixed(2)),
      latestSubmittedAt: entry.latestSubmittedAt,
    }))
    .sort((left, right) => {
      if (right.bestFinalPercent !== left.bestFinalPercent) {
        return right.bestFinalPercent - left.bestFinalPercent;
      }
      if (right.averageFinalPercent !== left.averageFinalPercent) {
        return right.averageFinalPercent - left.averageFinalPercent;
      }
      if (right.submittedTrials !== left.submittedTrials) {
        return right.submittedTrials - left.submittedTrials;
      }
      if (right.latestSubmittedAt !== left.latestSubmittedAt) {
        return right.latestSubmittedAt - left.latestSubmittedAt;
      }
      return left.studentName.localeCompare(right.studentName);
    });
}

function buildStudentLeaderboardPayload(user, leaderboardRows) {
  const rankedOverall = leaderboardRows.map((entry, index) => ({
    rank: index + 1,
    studentName: entry.studentName,
    classRoom: entry.classRoom,
    bestFinalPercent: entry.bestFinalPercent,
    averageFinalPercent: entry.averageFinalPercent,
    submittedTrials: entry.submittedTrials,
    latestSubmittedAt: entry.latestSubmittedAt,
    isCurrentStudent:
      (entry.userId && entry.userId === user.id) ||
      (entry.userKey && entry.userKey === user.userKey),
  }));

  const classRoom = normalizeName(user.classRoom);
  const classRows = rankedOverall
    .filter((entry) => entry.classRoom === classRoom)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  const currentOverall = rankedOverall.find((entry) => entry.isCurrentStudent) ?? null;
  const currentClass = classRows.find((entry) => entry.isCurrentStudent) ?? null;

  return {
    classRoom,
    overall: rankedOverall.slice(0, 20),
    classTop: classRows.slice(0, 20),
    currentStudent: {
      overallRank: currentOverall?.rank ?? null,
      classRank: currentClass?.rank ?? null,
      bestFinalPercent: currentOverall?.bestFinalPercent ?? 0,
      averageFinalPercent: currentOverall?.averageFinalPercent ?? 0,
      submittedTrials: currentOverall?.submittedTrials ?? 0,
    },
  };
}

function buildStudentDashboardPayload(user, exams, trials, leaderboardRows, activeSession) {
  const availableExams = exams.filter(
    (exam) => exam.published && examAllowsClass(exam, user.classRoom)
  );
  const examStats = buildExamAttemptStatsForUser(user, availableExams, trials);
  const leaderboards = buildStudentLeaderboardPayload(user, leaderboardRows);

  return {
    user: toPublicUserRecord(user),
    exams: examStats,
    leaderboards,
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
app.disable('x-powered-by');

if (TRUST_PROXY) {
  const numeric = Number(TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(numeric) ? numeric : TRUST_PROXY === 'true' ? true : TRUST_PROXY);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        // The school logo is configured as an external URL in Settings.
        'img-src': ["'self'", 'data:', 'https:'],
        // The in-browser Python runtime (Pyodide) is WebAssembly served from this site.
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        // Off so the app still loads over plain http://<server-ip> before TLS is set up.
        // HTTPS is enforced by the reverse proxy (and HSTS) instead.
        'upgrade-insecure-requests': null,
      },
    },
  })
);
app.use(
  cors(
    CORS_ORIGINS.length > 0
      ? {
          origin(origin, callback) {
            callback(null, !origin || CORS_ORIGINS.includes(origin));
          },
        }
      : undefined
  )
);

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const adminLoginLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  count: 'failures',
  key: (req) => `admin:${clientIp(req)}`,
  message: 'Too many failed admin login attempts. Wait 15 minutes and try again.',
});
const studentLoginLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  count: 'failures',
  key: (req) => {
    const identifier = normalizeName(req.body?.identifier ?? req.body?.email ?? req.body?.username).toLowerCase();
    return `student:${clientIp(req)}:${identifier}`;
  },
  message: 'Too many failed attempts for this account. Wait 15 minutes, or ask your teacher to reset your password.',
});
const studentLoginIpLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 150,
  count: 'failures',
  key: (req) => `student-ip:${clientIp(req)}`,
});
const registerLimiter = createRateLimiter({
  windowMs: ONE_HOUR,
  max: 200,
  key: (req) => `register:${clientIp(req)}`,
  message: 'Too many sign-ups from this network. Please try again later.',
});
const passwordHelpLimiter = createRateLimiter({
  windowMs: ONE_HOUR,
  max: 40,
  key: (req) => `help:${clientIp(req)}`,
  message: 'Too many help requests from this network. Please try again later.',
});
app.use(express.json({ limit: '200kb' }));
app.use(express.text({ type: '*/*', limit: '200kb' }));
app.use((req, _res, next) => {
  if (typeof req.body !== 'string') {
    next();
    return;
  }

  const trimmed = req.body.trim();
  if (!trimmed) {
    req.body = {};
    next();
    return;
  }

  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    next();
    return;
  }

  try {
    req.body = JSON.parse(trimmed);
  } catch {
    // Keep raw text body when parse fails. Route validators will return proper 400 responses.
  }

  next();
});

app.get('/api/health', async (_req, res) => {
  const timestamp = new Date().toISOString();
  try {
    await (await getDb()).command({ ping: 1 });
    res.json({ ok: true, db: 'up', timestamp });
  } catch {
    res.status(503).json({ ok: false, db: 'down', timestamp });
  }
});

app.get('/api/keep-alive', (_req, res) => {
  res.json({
    ok: true,
    route: 'keep-alive',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/exam/meta', async (_req, res) => {
  const [questionPoolCount, exams, branding] = await Promise.all([
    getQuestionPoolCount(),
    listExams(),
    getBrandingSettings(),
  ]);
  const generalExam = exams.find((exam) => exam.id === 'general');

  res.json({
    schoolName: branding.schoolName,
    branding,
    defaultStudentPassword: DEFAULT_STUDENT_PASSWORD,
    durationSeconds: generalExam?.durationSeconds ?? EXAM_DURATION_SECONDS,
    questionCount: generalExam?.questionCount ?? EXAM_QUESTION_COUNT,
    questionPoolCount,
    classOptions: CLASS_OPTIONS,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
    exams: exams.filter((exam) => exam.published).map((exam) => toPublicExam(exam)),
  });
});

app.post('/api/student/register', registerLimiter, async (req, res) => {
  const names = readNameParts(req.body);
  const classRoom = normalizeName(req.body?.classRoom);
  const email = normalizeEmail(req.body?.email);
  const username = normalizeUsername(req.body?.username);
  // Older clients may still choose a password at sign-up; new sign-ups start with the default.
  const chosenPassword = typeof req.body?.password === 'string' && req.body.password.length >= 4 ? req.body.password : '';
  const password = chosenPassword || DEFAULT_STUDENT_PASSWORD;

  const nameError = validateNameParts(names);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  if (!CLASS_OPTIONS.includes(classRoom)) {
    res.status(400).json({ error: 'Please choose your class.' });
    return;
  }

  if (!username && !email) {
    res.status(400).json({ error: 'Choose a username.' });
    return;
  }

  if (email && !isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  if (username && !isValidUsername(username)) {
    res.status(400).json({
      error: 'Usernames are 3 to 32 characters: letters, numbers, dots, underscores or hyphens (no spaces).',
    });
    return;
  }

  const fullName = names.fullName;
  let user;
  try {
    user = await createUserWithPassword(
      {
        fullName,
        firstName: names.firstName,
        middleName: names.middleName,
        lastName: names.lastName,
        classRoom,
        email,
        username,
      },
      password,
      { mustChangePassword: !chosenPassword }
    );
  } catch (error) {
    if (error?.code === 'EMAIL_ALREADY_EXISTS') {
      res.status(409).json({ error: 'An account with this email already exists. Please login instead.' });
      return;
    }

    if (error?.code === 'USERNAME_ALREADY_EXISTS') {
      res.status(409).json({
        error: 'That username is already taken. If it is yours, sign in instead; otherwise choose another one.',
      });
      return;
    }

    if (error?.code === 'USER_ALREADY_EXISTS') {
      res.status(409).json({ error: 'An account with these details already exists. Please login instead.' });
      return;
    }

    res.status(400).json({ error: error.message || 'Could not create student account.' });
    return;
  }

  await touchUserLogin(user.id);
  const refreshedUser = { ...user, lastLoginAt: Date.now() };
  const tokenInfo = await issueStudentToken(refreshedUser);
  const dashboard = await loadStudentDashboard(refreshedUser);

  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    ok: true,
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt,
    tokenLifetimeMs: STUDENT_TOKEN_LIFETIME_MS,
    ...dashboard,
  });
});

app.post('/api/student/login', studentLoginIpLimiter, studentLoginLimiter, async (req, res) => {
  const identifier = normalizeName(req.body?.identifier ?? req.body?.email ?? req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!identifier) {
    res.status(400).json({ error: 'Enter your username.' });
    return;
  }

  const asEmail = normalizeEmail(identifier);
  const asUsername = normalizeUsername(identifier);
  const looksLikeEmail = identifier.includes('@');
  if (looksLikeEmail && !isValidEmail(asEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  if (!looksLikeEmail && !isValidUsername(asUsername)) {
    res.status(400).json({
      error: 'Username must be 3-32 characters and use letters, numbers, dot, underscore, or hyphen.',
    });
    return;
  }

  if (!password) {
    res.status(400).json({ error: 'Please enter your password.' });
    return;
  }

  const user = looksLikeEmail ? await getUserByEmail(asEmail) : await getUserByUsername(asUsername);
  if (!user) {
    res.status(404).json({ error: 'No account found with that username. Check the spelling, or register first.' });
    return;
  }

  if (user.disabled) {
    res.status(403).json({ error: 'This account is disabled. Contact admin for help.' });
    return;
  }

  if (!(await verifyPasswordScryptAsync(password, user.passwordHash))) {
    res.status(401).json({ error: 'That password is not right. Try again, or ask your teacher to reset it.' });
    return;
  }

  await touchUserLogin(user.id);
  const refreshedUser = { ...user, lastLoginAt: Date.now() };
  const tokenInfo = await issueStudentToken(refreshedUser);
  const dashboard = await loadStudentDashboard(refreshedUser);

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
  const dashboard = await loadStudentDashboard(req.student.user);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    ...dashboard,
  });
});

// Revokes the token server-side, so a student on a shared lab computer is really signed out.
app.post('/api/student/logout', requireStudent, async (req, res) => {
  await deleteStudentToken(req.student.token.token);
  res.json({ ok: true });
});

app.post('/api/student/change-password', requireStudent, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const nextPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  // Right after sign-up or a teacher reset, the student just signed in with the starting
  // password, so they are not asked for it again.
  const isRequiredChange = Boolean(req.student.user.mustChangePassword);

  if (nextPassword.length < 4) {
    res.status(400).json({ error: 'Your new password must be at least 4 characters.' });
    return;
  }

  if (isRequiredChange && nextPassword.trim().toLowerCase() === DEFAULT_STUDENT_PASSWORD.toLowerCase()) {
    res.status(400).json({ error: 'Choose a password that is different from the starting password.' });
    return;
  }

  if (!isRequiredChange) {
    if (!currentPassword) {
      res.status(400).json({ error: 'Enter your current password.' });
      return;
    }
    // 403, not 401: a wrong current password must not sign the student out.
    if (!(await verifyPasswordScryptAsync(currentPassword, req.student.user.passwordHash))) {
      res.status(403).json({ error: 'Your current password is not right.' });
      return;
    }
    if (currentPassword === nextPassword) {
      res.status(400).json({ error: 'Your new password must be different from your current one.' });
      return;
    }
  }

  const nextHash = await hashPasswordScryptAsync(nextPassword);
  const updated = await updateUserPassword(req.student.user.id, nextHash, {
    mustChangePassword: false,
  });
  if (!updated) {
    res.status(404).json({ error: 'Student account not found.' });
    return;
  }

  await revokeStudentTokensForUser(updated.id);
  const tokenInfo = await issueStudentToken(updated);

  res.json({
    ok: true,
    user: toPublicUserRecord(updated),
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt,
    tokenLifetimeMs: STUDENT_TOKEN_LIFETIME_MS,
  });
});

app.post('/api/student/feedback', requireStudent, async (req, res) => {
  const feedback = sanitizeFeedbackPayload(req.body ?? {});
  if (!feedback) {
    res.status(400).json({ error: 'Please add at least a rating or comment.' });
    return;
  }

  const saved = await createGeneralFeedback({
    user: req.student.user,
    rating: feedback.rating,
    comment: feedback.comment,
  });
  const history = await listGeneralFeedbackByUser(req.student.user.id, 8);

  res.status(201).json({
    ok: true,
    feedback: saved,
    history,
  });
});

app.post('/api/student/password-help', passwordHelpLimiter, async (req, res) => {
  const names = readNameParts(req.body);
  const fullName = names.fullName;
  const classRoom = normalizeName(req.body?.classRoom);
  const email = normalizeEmail(req.body?.email);
  const username = normalizeUsername(req.body?.username);
  const message = normalizeName(req.body?.message ?? '');

  if (names.firstName.length < 2 || names.lastName.length < 2) {
    res.status(400).json({ error: 'Enter your first and last name.' });
    return;
  }

  if (!CLASS_OPTIONS.includes(classRoom)) {
    res.status(400).json({ error: 'Please choose a valid class.' });
    return;
  }

  if (!email && !username) {
    res.status(400).json({ error: 'Enter your username.' });
    return;
  }

  if (email && !isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  if (username && !isValidUsername(username)) {
    res.status(400).json({ error: 'Check your username: 3 to 32 letters or numbers, no spaces.' });
    return;
  }

  const requestRow = await createPasswordAssistanceRequest({
    fullName,
    classRoom,
    email,
    username,
    message,
  });

  res.status(201).json({
    ok: true,
    request: requestRow,
    message: 'Password help request sent. Admin will assist you shortly.',
  });
});

app.get('/api/student/trials', requireStudent, async (req, res) => {
  const trials = (await loadStudentTrials(req.student.user)).map(toStudentTrialRow);

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

app.get('/api/student/trials/:sessionId/report-card', requireStudent, async (req, res) => {
  const trial = await getLatestSession(req.params.sessionId);
  if (!trial) {
    res.status(404).json({ error: 'Trial not found.' });
    return;
  }

  if (!studentOwnsSession(req.student.user, trial)) {
    res.status(403).json({ error: 'You do not have access to this trial.' });
    return;
  }

  // SECURITY: a report card scores the session, so it is only available once submitted.
  if (!trial.submittedAt) {
    res.status(409).json({ error: 'The report card is available after the exam is submitted.' });
    return;
  }

  const branding = await getBrandingSettings();
  const includeCorrectAnswers = isResultsReleased(trial);
  const payload = buildReportCardPayload(trial, branding, includeCorrectAnswers);
  const html = renderReportCardHtml(payload);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${buildReportCardFileName(trial)}"`);
  res.send(html);
});

app.post('/api/exam/start', requireStudent, async (req, res) => {
  await withExamStartLock(req.student.user.id, () => startExamForStudent(req, res));
});

async function startExamForStudent(req, res) {
  const requestedExamId = normalizeExamId(req.body?.examId) || 'general';
  const user = req.student.user;
  const fullName = user.fullName;
  const classRoom = user.classRoom;
  const email = user.email;
  const username = normalizeUsername(user.username ?? '');

  const [selectedExam, questionPool, studentTrials] = await Promise.all([
    getExam(requestedExamId),
    getQuestionPool(),
    loadStudentTrials(user),
  ]);
  const questionMap = new Map(questionPool.map((question) => [question.id, question]));

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

  const existingTrials = studentTrials.filter((session) => (session.examId ?? 'general') === selectedExam.id);
  const activeTrial = existingTrials.find(
    (session) => !session.submittedAt && sessionStatus(session) === 'active'
  );
  const maxAttempts = Number(selectedExam.maxAttempts ?? 3);
  const attemptsUsed = existingTrials.length;
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
  if (activeTrial) {
    const fullActiveTrial = (await getLatestSession(activeTrial.id)) ?? activeTrial;
    res.status(409).json({
      error: 'You already have an active trial for this exam.',
      attemptsUsed,
      maxAttempts,
      attemptsRemaining,
      session: toStudentClientSession(fullActiveTrial),
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

  // Random selection and order per student, but grouped so quick questions come first and the
  // Python program comes last (a student should not meet the longest question first).
  const servedQuestions = shuffleArray(examQuestionPool)
    .slice(0, requiredQuestionCount)
    .map(prepareQuestionForSession)
    .map((question, position) => ({ question, position, rank: sectionRank(question) }))
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .map((entry) => entry.question);
  const startedAt = Date.now();
  const studentKey = buildStudentKey(
    {
      fullName,
      classRoom,
      email,
      username,
    },
    selectedExam.id
  );
  // max+1 rather than count+1 keeps attempt numbers unique after an admin deletes an attempt.
  const trialNumber = existingTrials.reduce((max, session) => Math.max(max, Number(session.trialNumber) || 0), 0) + 1;
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
      username,
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
    lastActivityAt: startedAt,
    setup: sanitizeSetupInfo(req.body?.setup),
    hintLimit: hintLimitFor(selectedExam, classRoom),
    hintsUsed: {},
  };

  const created = await insertSession(session);
  res.status(201).json({
    ...toStudentClientSession(created),
    attemptsUsed: attemptsUsed + 1,
    maxAttempts,
    attemptsRemaining: Math.max(0, maxAttempts - attemptsUsed - 1),
  });
}

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
  const requestedQuestionIndex = req.body?.questionIndex;

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId, requestedQuestionIndex);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
      questionIndex: Number.isFinite(Number(requestedQuestionIndex))
        ? Math.trunc(Number(requestedQuestionIndex))
        : null,
      sessionQuestionOrderSize: Array.isArray(session.questionOrder) ? session.questionOrder.length : 0,
      sessionQuestionOrderSample: Array.isArray(session.questionOrder)
        ? session.questionOrder.slice(0, 3)
        : [],
    });
    return;
  }

  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => ({
    ...current,
    seen: {
      ...current.seen,
      [questionId]: true,
    },
  }));
  if (!updated) {
    return;
  }

  res.json({ ok: true, seen: updated?.seen ?? session.seen });
});

app.post('/api/exam/:sessionId/answer', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedQuestionId = req.body?.questionId;
  const requestedQuestionIndex = req.body?.questionIndex;

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId, requestedQuestionIndex);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
      questionIndex: Number.isFinite(Number(requestedQuestionIndex))
        ? Math.trunc(Number(requestedQuestionIndex))
        : null,
      sessionQuestionOrderSize: Array.isArray(session.questionOrder) ? session.questionOrder.length : 0,
      sessionQuestionOrderSample: Array.isArray(session.questionOrder)
        ? session.questionOrder.slice(0, 3)
        : [],
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

  const selected = sanitizeResponse(question, req.body?.response ?? req.body?.selectedOptionIds) ?? [];

  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => ({
    ...current,
    questionSnapshot: {
      ...(current.questionSnapshot ?? {}),
      [questionId]: resolveQuestionFromSnapshot(current, questionId) ?? question,
    },
    answers: {
      ...current.answers,
      [questionId]: selected,
    },
    lastActivityAt: Date.now(),
  }));
  if (!updated) {
    return;
  }

  res.json({ ok: true, responses: updated?.answers ?? session.answers });
});

// Reveals the hint for one question, spending one of the student's hints. Asking again for a
// question whose hint is already revealed is free.
app.post('/api/exam/:sessionId/hint', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  let outcome = null;

  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => {
    const questionId = resolveSessionQuestionId(current, req.body?.questionId, null);
    const hint = questionId ? resolveQuestionFromSnapshot(current, questionId)?.hint : '';
    const used = current.hintsUsed ?? {};
    const limit = Number(current.hintLimit) || 0;
    if (!hint) {
      outcome = { status: 404, error: 'There is no hint for this question.' };
      return current;
    }
    if (used[questionId]) {
      outcome = { questionId, hint };
      return current;
    }
    if (Object.keys(used).length >= limit) {
      outcome = { status: 409, error: limit ? 'You have used all your hints.' : 'Hints are not available for this exam.' };
      return current;
    }
    outcome = { questionId, hint };
    return { ...current, hintsUsed: { ...used, [questionId]: Date.now() }, lastActivityAt: Date.now() };
  });
  if (!updated) {
    return;
  }
  if (outcome?.status) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  res.json({ ok: true, questionId: outcome.questionId, hint: outcome.hint, hints: buildClientHints(updated) });
});

/** Merges a { questionId: answer } map into a session's answers (unknown questions are skipped). */
function applyAnswerBatch(current, answersInput) {
  const applied = [];
  const rejected = [];
  const nextAnswers = { ...(current.answers ?? {}) };

  for (const [requestedId, value] of Object.entries(answersInput ?? {}).slice(0, 200)) {
    const questionId = resolveSessionQuestionId(current, requestedId, null);
    const question = questionId ? resolveQuestionFromSnapshot(current, questionId) : null;
    const response = question ? sanitizeResponse(question, value) : null;
    if (!question || response === null) {
      rejected.push(requestedId);
      continue;
    }
    nextAnswers[questionId] = response;
    applied.push(requestedId);
  }

  return { nextAnswers, applied, rejected };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Saves several answers in one write. The browser queues answers locally and sends whatever is
// pending here, retrying until the server confirms, so a dropped connection never loses work.
app.post('/api/exam/:sessionId/answers', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const input = req.body?.answers;
  if (!isPlainObject(input)) {
    res.status(400).json({ error: 'Provide answers as { questionId: answer }.' });
    return;
  }

  let batch = { applied: [], rejected: [] };
  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => {
    batch = applyAnswerBatch(current, input);
    if (!batch.applied.length) {
      return current;
    }
    return { ...current, answers: batch.nextAnswers, lastActivityAt: Date.now() };
  });
  if (!updated) {
    return;
  }

  res.json({ ok: true, applied: batch.applied, rejected: batch.rejected, savedAt: Date.now() });
});

app.post('/api/exam/:sessionId/flag', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedQuestionId = req.body?.questionId;
  const requestedQuestionIndex = req.body?.questionIndex;
  const flagged = Boolean(req.body?.flagged);

  const session = await getUpdatableSessionOrError(sessionId, res, req.student.user);
  if (!session) {
    return;
  }

  const questionId = resolveSessionQuestionId(session, requestedQuestionId, requestedQuestionIndex);
  if (!questionId) {
    res.status(400).json({
      error: 'Question is not in this exam session.',
      code: 'QUESTION_NOT_IN_SESSION',
      questionId: requestedQuestionId ?? null,
      questionIndex: Number.isFinite(Number(requestedQuestionIndex))
        ? Math.trunc(Number(requestedQuestionIndex))
        : null,
      sessionQuestionOrderSize: Array.isArray(session.questionOrder) ? session.questionOrder.length : 0,
      sessionQuestionOrderSample: Array.isArray(session.questionOrder)
        ? session.questionOrder.slice(0, 3)
        : [],
    });
    return;
  }

  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => ({
    ...current,
    flagged: {
      ...current.flagged,
      [questionId]: flagged,
    },
  }));
  if (!updated) {
    return;
  }

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

  const evidence = sanitizeViolationEvidence(req.body?.evidence, session);
  if (type === 'exam_reopened') {
    // How long the exam was closed: from the last thing the server heard until now.
    const lastSeen = Number(session.lastActivityAt) || Number(session.startedAt) || Date.now();
    evidence.durationMs = Math.max(0, Date.now() - lastSeen);
  }
  const violationPolicy = getViolationPolicy(session, type, evidence);
  const violation = {
    id: randomUUID(),
    type: type.slice(0, 80),
    detail: detail.slice(0, 160),
    occurredAt: Date.now(),
    waived: false,
    deduct: violationPolicy.deduct,
    policy: violationPolicy.policy,
    waivedAt: null,
    evidence,
  };

  const updated = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) => ({
    ...current,
    violations: [...current.violations, violation],
    lastActivityAt: Date.now(),
  }));
  if (!updated) {
    return;
  }

  res.json({
    ok: true,
    violations: updated?.violations ?? session.violations,
    penaltyPerViolation: PENALTY_PER_VIOLATION,
  });
});

app.post('/api/exam/:sessionId/submit', requireStudent, async (req, res) => {
  const sessionId = req.params.sessionId;
  // The browser sends any answers it has not confirmed yet with the submission itself, so the
  // last few answers are saved and marked in the same write.
  const finalAnswers = isPlainObject(req.body?.answers) ? req.body.answers : null;
  const finalized = await applyActiveSessionUpdateOrError(sessionId, res, req.student.user, (current) =>
    finalizeSession(finalAnswers ? { ...current, answers: applyAnswerBatch(current, finalAnswers).nextAnswers } : current)
  );
  if (!finalized) {
    return;
  }

  invalidateLeaderboardCache();

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

  if (!latest.submittedAt && !isPastGrace(latest)) {
    res.status(409).json({
      error: 'Feedback can only be sent after submitting the exam.',
      session: toStudentClientSession(latest),
    });
    return;
  }

  const feedback = sanitizeFeedbackPayload(req.body ?? {});
  if (!feedback) {
    res.status(400).json({ error: 'Please add at least a rating or comment.' });
    return;
  }

  const updated = await updateSession(sessionId, (current) => ({
    ...(current.submittedAt ? current : finalizeSession(current)),
    feedback,
  }));
  if (!updated) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  res.json({
    ok: true,
    feedback: updated.feedback,
    session: toStudentClientSession(updated),
  });
});

app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  if (!parsedAdminPasscodeHash) {
    res.status(503).json({
      error: 'Admin authentication hash is missing. Set ADMIN_PASSCODE_HASH in your environment.',
    });
    return;
  }

  const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
  if (!(await verifyAdminPasscode(passcode))) {
    res.status(401).json({ error: 'Invalid admin passcode.' });
    return;
  }

  const tokenInfo = await issueAdminToken();

  res.json({
    ok: true,
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt,
    tokenLifetimeMs: ADMIN_TOKEN_LIFETIME_MS,
  });
});

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
  await deleteAdminToken(req.admin.token);
  res.json({ ok: true });
});

app.get('/api/admin/settings/branding', requireAdmin, async (_req, res) => {
  const branding = await getBrandingSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    branding,
  });
});

app.patch('/api/admin/settings/branding', requireAdmin, async (req, res) => {
  const patch = {
    schoolName: req.body?.schoolName,
    logoUrl: req.body?.logoUrl,
  };
  const branding = await updateBrandingSettings(patch);

  res.json({
    ok: true,
    branding,
  });
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  const [sessions, questionPool, generalFeedbackCount] = await Promise.all([
    loadSessionList(),
    getQuestionPool(),
    countGeneralFeedback(),
  ]);
  const overview = buildOverview(sessions, questionPool);
  overview.totals.generalFeedbackCount = generalFeedbackCount;

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

  const sessions = await loadSessionList();

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

app.get('/api/admin/sessions/:sessionId/report-card', requireAdmin, async (req, res) => {
  const session = await getLatestSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const branding = await getBrandingSettings();
  const payload = buildReportCardPayload(session, branding, true);
  const html = renderReportCardHtml(payload);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${buildReportCardFileName(session)}"`);
  res.send(html);
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

  invalidateLeaderboardCache();
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

  invalidateLeaderboardCache();
  res.json({ ok: true, deletedCount: 1 });
});

app.delete('/api/admin/sessions', requireAdmin, async (req, res) => {
  const sessionIds = parseSessionIdsFromRequest(req);
  if (!sessionIds.length) {
    res.status(400).json({ error: 'Select at least one session to delete.' });
    return;
  }

  const deletedCount = await deleteSessions(sessionIds);
  invalidateLeaderboardCache();
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
  invalidateLeaderboardCache();
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

  const sessions = await loadSessionList();
  const targetIds = sessions
    .filter((session) => {
      if (scope === 'all') {
        return true;
      }
      return sessionStatus(session) === scope;
    })
    .map((session) => session.id);

  const deletedCount = await deleteSessions(targetIds);
  invalidateLeaderboardCache();
  res.json({
    ok: true,
    deletedCount,
    scope,
  });
});

// ---------------------------------------------------------------- violation disputes

const DISPUTE_REASONS = ['accident', 'not_me', 'other'];

// A student may dispute a violation after submitting (so it never costs exam time).
app.post('/api/student/trials/:sessionId/violations/:violationId/dispute', requireStudent, async (req, res) => {
  const { sessionId, violationId } = req.params;
  const reason = DISPUTE_REASONS.includes(req.body?.reason) ? req.body.reason : '';
  const note = normalizeName(req.body?.note ?? '').slice(0, 400);
  if (!reason) {
    res.status(400).json({ error: 'Choose a reason for your dispute.' });
    return;
  }

  let problem = null;
  const updated = await updateSession(sessionId, (current) => {
    problem = null;
    if (!studentOwnsSession(req.student.user, current)) {
      problem = { status: 403, error: 'You do not have access to this attempt.' };
      return current;
    }
    if (!current.submittedAt) {
      problem = { status: 409, error: 'You can dispute violations after you submit the exam.' };
      return current;
    }
    const violation = (current.violations ?? []).find((item) => item.id === violationId);
    if (!violation) {
      problem = { status: 404, error: 'Violation not found.' };
      return current;
    }
    if (violation.dispute) {
      problem = { status: 409, error: 'You have already disputed this violation.' };
      return current;
    }
    return {
      ...current,
      violations: current.violations.map((item) =>
        item.id === violationId ? { ...item, dispute: { status: 'open', reason, note, submittedAt: Date.now() } } : item
      ),
    };
  });

  if (!updated) {
    res.status(404).json({ error: 'Attempt not found.' });
    return;
  }
  if (problem) {
    res.status(problem.status).json({ error: problem.error });
    return;
  }

  res.status(201).json({ ok: true, violations: updated.violations ?? [] });
});

app.get('/api/admin/disputes', requireAdmin, async (req, res) => {
  const status = normalizeName(req.query?.status ?? 'open').toLowerCase();
  const sessions = await loadSessionList({ 'violations.dispute.status': { $exists: true } });
  const disputes = [];
  for (const session of sessions) {
    for (const violation of session.violations ?? []) {
      if (!violation.dispute) continue;
      const isOpen = violation.dispute.status === 'open';
      if ((status === 'open' && !isOpen) || (status === 'resolved' && isOpen)) continue;
      disputes.push({
        sessionId: session.id,
        violationId: violation.id,
        studentName: session.student?.fullName ?? 'Unknown',
        classRoom: session.student?.classRoom ?? '',
        examTitle: session.examTitle,
        trialNumber: session.trialNumber,
        type: violation.type,
        detail: violation.detail,
        occurredAt: violation.occurredAt,
        deduct: violation.deduct !== false,
        waived: Boolean(violation.waived),
        evidence: violation.evidence ?? {},
        dispute: violation.dispute,
        finalPercent: session.summary?.finalPercent ?? null,
        totalViolations: (session.violations ?? []).length,
      });
    }
  }
  disputes.sort((left, right) => (right.dispute.submittedAt ?? 0) - (left.dispute.submittedAt ?? 0));

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, total: disputes.length, disputes });
});

// Accepting a dispute waives the violation (the score is recalculated); rejecting keeps it.
app.patch('/api/admin/sessions/:sessionId/violations/:violationId/dispute', requireAdmin, async (req, res) => {
  const { sessionId, violationId } = req.params;
  const decision = req.body?.decision === 'accept' ? 'accepted' : req.body?.decision === 'reject' ? 'rejected' : '';
  if (!decision) {
    res.status(400).json({ error: 'Decision must be "accept" or "reject".' });
    return;
  }
  const adminNote = normalizeName(req.body?.adminNote ?? '').slice(0, 400);
  const now = Date.now();
  let found = false;

  const updated = await updateSession(sessionId, (current) => {
    found = false;
    const violations = (current.violations ?? []).map((item) => {
      if (item.id !== violationId || !item.dispute) return item;
      found = true;
      return {
        ...item,
        waived: decision === 'accepted' ? true : item.waived,
        waivedAt: decision === 'accepted' ? now : item.waivedAt ?? null,
        dispute: { ...item.dispute, status: decision, adminNote, resolvedAt: now },
      };
    });
    if (!found) return current;
    const next = { ...current, violations };
    if (next.submittedAt) next.summary = evaluateSession(next);
    return next;
  });

  if (!updated || !found) {
    res.status(404).json({ error: 'Dispute not found.' });
    return;
  }

  invalidateLeaderboardCache();
  res.json({ ok: true, decision, summary: updated.summary ?? null });
});

// ---------------------------------------------------------------- teacher mark overrides

// Lets the teacher overrule the automatic mark for one question (most useful for the Python
// program, which is checked in the student's browser). `correct: null` restores the automatic mark.
app.patch('/api/admin/sessions/:sessionId/grades', requireAdmin, async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedId = normalizeName(req.body?.questionId);
  const correct = req.body?.correct === true ? true : req.body?.correct === false ? false : null;
  let found = false;

  const updated = await updateSession(sessionId, (current) => {
    const questionId = resolveSessionQuestionId(current, requestedId, null);
    found = Boolean(questionId);
    if (!questionId) return current;
    const manualGrades = { ...(current.manualGrades ?? {}) };
    if (correct === null) delete manualGrades[questionId];
    else manualGrades[questionId] = correct;
    const next = { ...current, manualGrades };
    if (next.submittedAt) next.summary = evaluateSession(next);
    return next;
  });

  if (!updated || !found) {
    res.status(404).json({ error: 'Attempt or question not found.' });
    return;
  }

  invalidateLeaderboardCache();
  res.json({ ok: true, summary: updated.summary ?? null });
});

// ---------------------------------------------------------------- bulk printing

const MAX_BULK_REPORT_CARDS = 250;

/** Submitted attempts chosen by id list or by exam/class filters, one or all per student. */
async function selectSubmittedSessions(body) {
  const ids = parseSessionIdsInput(body?.sessionIds).slice(0, 1000);
  const examId = normalizeExamId(body?.examId ?? '');
  const classRoom = normalizeName(body?.classRoom ?? '');
  const attempt = ['best', 'latest', 'all'].includes(body?.attempt) ? body.attempt : 'all';

  const filter = ids.length ? { id: { $in: ids } } : {};
  let sessions = (await loadSessionList(filter)).filter((session) => session.submittedAt);
  if (!ids.length) {
    if (examId) sessions = sessions.filter((session) => (session.examId ?? 'general') === examId);
    if (classRoom) sessions = sessions.filter((session) => session.student?.classRoom === classRoom);
  }

  if (attempt !== 'all') {
    const chosen = new Map();
    for (const session of sessions) {
      const key = `${session.userId || session.userKey || session.studentKey}|${session.examId}`;
      const existing = chosen.get(key);
      const better =
        !existing ||
        (attempt === 'best'
          ? (session.summary?.finalPercent ?? 0) > (existing.summary?.finalPercent ?? 0)
          : (session.submittedAt ?? 0) > (existing.submittedAt ?? 0));
      if (better) chosen.set(key, session);
    }
    sessions = [...chosen.values()];
  }

  return sessions.sort(
    (left, right) =>
      String(left.student?.classRoom).localeCompare(String(right.student?.classRoom)) ||
      String(left.student?.fullName).localeCompare(String(right.student?.fullName)) ||
      (left.trialNumber ?? 1) - (right.trialNumber ?? 1)
  );
}

// One printable document with a full report card (answers, corrections, explanations) per attempt.
app.post('/api/admin/report-cards', requireAdmin, async (req, res) => {
  const selected = await selectSubmittedSessions(req.body ?? {});
  if (!selected.length) {
    res.status(404).json({ error: 'No submitted attempts match that selection.' });
    return;
  }
  if (selected.length > MAX_BULK_REPORT_CARDS) {
    res.status(400).json({
      error: `That is ${selected.length} report cards. Print up to ${MAX_BULK_REPORT_CARDS} at a time: filter by class, or choose one attempt per student.`,
    });
    return;
  }

  const branding = await getBrandingSettings();
  const payloads = [];
  // Full attempts (with questions) are loaded a few at a time to keep memory flat.
  for (let index = 0; index < selected.length; index += 10) {
    const chunk = await Promise.all(selected.slice(index, index + 10).map((session) => getLatestSession(session.id)));
    for (const session of chunk) {
      if (session?.submittedAt) payloads.push(buildReportCardPayload(session, branding, true));
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="report-cards.html"');
  res.send(renderBulkReportCardsHtml(payloads, `${branding.schoolName} report cards`));
});

// A compact class list: one row per student result.
app.post('/api/admin/result-sheet', requireAdmin, async (req, res) => {
  const selected = await selectSubmittedSessions(req.body ?? {});
  const branding = await getBrandingSettings();
  const classRoom = normalizeName(req.body?.classRoom ?? '');
  const examId = normalizeExamId(req.body?.examId ?? '');
  const exam = examId ? await getExam(examId) : null;
  const attemptLabel = { best: 'best attempt per student', latest: 'latest attempt per student' }[req.body?.attempt] ?? 'all attempts';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="result-sheet.html"');
  res.send(
    renderResultSheetHtml({
      branding: { schoolName: branding.schoolName, logoUrl: branding.logoUrl },
      title: `${exam?.title ?? 'All exams'} · ${classRoom || 'All classes'}`,
      subtitle: `Showing ${attemptLabel}. Final scores include proctoring penalties.`,
      rows: selected.map((session) => ({
        fullName: toTitleCaseWords(session.student?.fullName ?? ''),
        classRoom: session.student?.classRoom ?? '',
        examTitle: session.examTitle,
        trialNumber: session.trialNumber ?? 1,
        correctCount: session.summary?.correctCount ?? 0,
        totalQuestions: session.summary?.totalQuestions ?? 0,
        penaltyPoints: session.summary?.penaltyPoints ?? 0,
        finalPercent: session.summary?.finalPercent ?? 0,
      })),
      generatedAt: Date.now(),
      timeZone: APP_TIMEZONE || undefined,
    })
  );
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const search = normalizeName(req.query?.search ?? '').toLowerCase();
  const classRoom = normalizeName(req.query?.classRoom ?? '');
  const examIdFilter = normalizeExamId(req.query?.examId ?? '');

  const sessions = await loadSessionList();
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

  const storedTrials = await listSessions({ filter: { studentKey } });
  const trials = (await Promise.all(storedTrials.map((session) => normalizeSession(session))))
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
    setup: trial.setup ?? null,
    hintsUsed: Object.keys(trial.hintsUsed ?? {}).length,
    hintLimit: Number(trial.hintLimit) || 0,
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
    loadSessionList(),
    listPasswordAssistanceRequests(),
  ]);
  const sessionsByUserId = new Map();
  const sessionsByUserKey = new Map();
  for (const session of sessions) {
    if (session.userId) {
      sessionsByUserId.set(session.userId, [...(sessionsByUserId.get(session.userId) ?? []), session]);
    } else if (session.userKey) {
      sessionsByUserKey.set(session.userKey, [...(sessionsByUserKey.get(session.userKey) ?? []), session]);
    }
  }
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
      const ownedSessions = [
        ...(sessionsByUserId.get(user.id) ?? []),
        ...(sessionsByUserKey.get(user.userKey) ?? []),
      ];
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

      const haystack = `${row.fullName} ${row.email} ${row.username ?? ''} ${row.userKey}`.toLowerCase();
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
  if (req.body?.firstName !== undefined || req.body?.lastName !== undefined || req.body?.fullName !== undefined) {
    const names = readNameParts(req.body);
    const nameError = validateNameParts(names);
    if (nameError) {
      res.status(400).json({ error: nameError.replace(/your /g, 'the ') });
      return;
    }
    Object.assign(patch, names);
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
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email.' });
      return;
    }
    patch.email = email;
  }
  if (req.body?.username !== undefined) {
    const username = normalizeUsername(req.body.username);
    if (username && !isValidUsername(username)) {
      res.status(400).json({
        error: 'Username must be 3-32 characters and use letters, numbers, dot, underscore, or hyphen.',
      });
      return;
    }
    patch.username = username;
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
      await revokeStudentTokensForUser(updated.id);
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

  // Resets go back to the starting password unless the teacher types a different one.
  const newPassword =
    typeof req.body?.newPassword === 'string' && req.body.newPassword ? req.body.newPassword : DEFAULT_STUDENT_PASSWORD;
  if (newPassword.length < 4) {
    res.status(400).json({ error: 'New password must be at least 4 characters.' });
    return;
  }

  const nextHash = await hashPasswordScryptAsync(newPassword);
  const updated = await updateUserPassword(user.id, nextHash, {
    mustChangePassword: req.body?.mustChangePassword !== false,
  });
  await revokeStudentTokensForUser(user.id);

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

      const haystack =
        `${row.fullName} ${row.classRoom} ${row.email ?? ''} ${row.username ?? ''} ${row.message}`.toLowerCase();
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
  const [exams, questionPool, sessionCounts] = await Promise.all([
    listExams(),
    getQuestionPool(),
    countSessionsByExam(),
  ]);
  const questionMap = new Map(questionPool.map((question) => [question.id, question]));

  const rows = exams.map((exam) => {
    const availableQuestionCount = pickExamQuestionSet(exam, questionPool, questionMap).length;
    return {
      ...toPublicExam(exam),
      availableQuestionCount,
      isReady: availableQuestionCount >= exam.questionCount,
      sessionCount: sessionCounts.get(exam.id) ?? 0,
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

  const [exam, questionPool] = await Promise.all([getExam(examId), getQuestionPool()]);
  const questionMap = new Map(questionPool.map((question) => [question.id, question]));

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
      archived: req.body?.archived,
      hintsAllowed: req.body?.hintsAllowed,
      hintClasses: req.body?.hintClasses,
      hintNote: req.body?.hintNote,
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
  for (const key of ['archived', 'hintsAllowed', 'hintClasses', 'hintNote']) {
    if (req.body?.[key] !== undefined) {
      patch[key] = req.body[key];
    }
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
    const questionPool = await getQuestionPool();
    const questionMap = new Map(questionPool.map((question) => [question.id, question]));
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

app.delete('/api/admin/exams/:examId', requireAdmin, async (req, res) => {
  const examId = normalizeExamId(req.params.examId);
  if (!examId) {
    res.status(400).json({ error: 'Invalid exam ID.' });
    return;
  }

  if (examId === 'general') {
    res.status(400).json({ error: 'The general exam pool cannot be deleted. Unpublish it instead.' });
    return;
  }

  const exam = await getExam(examId);
  if (!exam) {
    res.status(404).json({ error: 'Exam not found.' });
    return;
  }

  // Attempts reference their exam, so an exam with results is never deleted: unpublishing hides
  // it from students while keeping every result and report card intact.
  const attempts = await countSessions({ examId });
  if (attempts > 0) {
    res.status(409).json({
      error: `This exam has ${attempts} recorded attempt(s). Unpublish it instead so results stay intact.`,
      code: 'EXAM_HAS_ATTEMPTS',
    });
    return;
  }

  await deleteExam(examId);
  const deletedQuestions = await deleteQuestionsBySourceExam(examId);
  res.json({ ok: true, deletedQuestions });
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
    const sourceExamId = normalizeExamId(req.body?.sourceExamId) || 'general';
    const exam = await getExam(sourceExamId);
    if (!exam) {
      res.status(400).json({ error: 'Choose an existing exam for this question.' });
      return;
    }

    const created = await addQuestion({ ...(req.body ?? {}), sourceExamId: exam.id });
    // Custom exams serve a fixed list of question IDs, so the new question must be added to it.
    if (exam.mode === 'fixed') {
      await attachExamQuestionIds(exam.id, [created.id]);
    }

    res.status(201).json({
      ok: true,
      question: questionToAdminRow(created),
      questionCount: await getQuestionPoolCount(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid question payload.' });
  }
});

app.patch('/api/admin/questions/:questionId', requireAdmin, async (req, res) => {
  // A question's ID and owning exam are fixed; everything else can be edited. Exams already
  // taken keep their own snapshot, so edits only affect new attempts.
  const { id: _ignoredId, sourceExamId: _ignoredSourceExamId, ...payload } = req.body ?? {};
  try {
    const updated = await updateQuestion(req.params.questionId, payload);
    if (!updated) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }

    res.json({ ok: true, question: questionToAdminRow(updated) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid question payload.' });
  }
});

app.delete('/api/admin/questions/:questionId', requireAdmin, async (req, res) => {
  const question = await getQuestion(req.params.questionId);
  if (!question) {
    res.status(404).json({ error: 'Question not found.' });
    return;
  }

  const blockingExams = await findExamsOnlyUsingQuestion(question.id);
  if (blockingExams.length > 0) {
    res.status(409).json({
      error: `This is the only question in "${blockingExams[0].title}". Add another question to that exam first, or delete the exam.`,
    });
    return;
  }

  await removeQuestionFromExams(question.id);
  await deleteQuestion(question.id);
  res.json({ ok: true, questionCount: await getQuestionPoolCount() });
});

app.get('/api/admin/export/sessions.csv', requireAdmin, async (_req, res) => {
  const sessions = await loadSessionList();

  const rows = sessions
    .map((session) => {
      // In-progress attempts have no score yet: leave score columns blank rather than show 0.
      const summary = session.submittedAt ? session.summary ?? {} : {};
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
        answeredCount: summary.answeredCount ?? countAnsweredQuestions(session),
        correctCount: summary.correctCount ?? '',
        rawPercent: summary.rawPercent ?? '',
        penaltyPoints: summary.penaltyPoints ?? '',
        finalPercent: summary.finalPercent ?? '',
        violationsCount: summary.violationsCount ?? getActiveViolations(session).length,
        totalViolationsCount: summary.totalViolationsCount ?? (session.violations ?? []).length,
        waivedViolationsCount: summary.waivedViolationsCount ?? getWaivedViolations(session).length,
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
  const sessions = await loadSessionList();

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

app.get('/api/admin/export/questions.csv', requireAdmin, async (_req, res) => {
  const questionPool = await getQuestionPool();

  const rows = questionPool.map((question) => ({
    id: question.id,
    sourceExamId: question.sourceExamId ?? 'general',
    topic: question.topic,
    text: question.text,
    type: questionTypeLabel(question),
    optionA: question.options?.[0]?.text ?? '',
    optionB: question.options?.[1]?.text ?? '',
    optionC: question.options?.[2]?.text ?? '',
    optionD: question.options?.[3]?.text ?? '',
    correctOptionIds: (question.correctOptionIds ?? []).join('|'),
    correctAnswer: describeCorrectAnswer(
      question.type === 'order' ? { ...question, correctOrder: (question.items ?? []).map((item) => item.id) } : question
    ),
    explanation: question.explanation ?? '',
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

// Unknown API routes get a JSON 404 instead of falling through to the SPA's index.html.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((error, req, res, next) => {
  // Malformed JSON bodies and oversized payloads arrive here with a 4xx status from body-parser.
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) {
    console.error(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} failed:`,
      error?.stack || error?.message || error
    );
  }

  if (res.headersSent) {
    next(error);
    return;
  }

  const message =
    status >= 500
      ? 'Internal server error. Please retry.'
      : error?.type === 'entity.too.large'
        ? 'Request is too large.'
        : error?.expose && error?.message
          ? error.message
          : 'Request failed.';

  res.status(status).json({ error: message });
});

const distPath = path.resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  // Vite fingerprints everything under /assets, so those files can be cached for a year.
  // index.html must always be revalidated so a new deploy is picked up immediately.
  app.use(
    '/assets',
    express.static(path.join(distPath, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false })
  );
  // The Python runtime is ~13 MB; the build stores brotli/gzip copies so each student downloads
  // about a third of that, without spending server CPU on compression.
  const pyodidePath = path.join(distPath, 'pyodide');
  app.use(
    '/pyodide',
    (req, res, next) => {
      const relative = path.normalize(decodeURIComponent(req.path));
      if (relative.includes('..')) {
        next();
        return;
      }
      const file = path.join(pyodidePath, relative);
      const accepted = String(req.headers['accept-encoding'] ?? '');
      for (const [encoding, extension] of [
        ['br', '.br'],
        ['gzip', '.gz'],
      ]) {
        if (accepted.includes(encoding) && existsSync(`${file}${extension}`)) {
          res.type(path.extname(file));
          res.setHeader('Content-Encoding', encoding);
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.sendFile(`${file}${extension}`);
          return;
        }
      }
      next();
    },
    express.static(pyodidePath, { immutable: true, maxAge: '1y', fallthrough: false })
  );
  app.use(express.static(distPath, { index: false, maxAge: '1h' }));

  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else if (IS_PRODUCTION) {
  console.warn('dist/ not found: run "npm run build" so the server can serve the frontend.');
}

/**
 * First start after this release: adds the current exam with its 40 questions and marks the old
 * general pool as an archived practice exam. Runs once (a settings flag records it), so later
 * edits or deletions made in the admin dashboard are never overwritten.
 */
async function ensureCurrentExamSeeded() {
  const settings = (await getDb()).collection('settings');
  if (await settings.findOne({ key: CURRENT_EXAM_SEED_KEY })) {
    return;
  }

  if (!(await getExam(CURRENT_EXAM_ID))) {
    const exam = await createExam({
      ...CURRENT_EXAM,
      mode: 'pool',
      questionCount: CURRENT_EXAM_QUESTIONS.length,
      allowedClasses: CLASS_OPTIONS,
    });
    const created = [];
    for (const question of CURRENT_EXAM_QUESTIONS) {
      created.push(await addQuestion({ ...question, sourceExamId: exam.id }));
    }
    await updateExam(exam.id, {
      mode: 'fixed',
      questionIds: created.map((question) => question.id),
      questionCount: created.length,
    });
    console.log(`Seeded exam "${CURRENT_EXAM.title}" with ${created.length} questions.`);
  }

  const general = await getExam('general');
  if (general && !general.archived) {
    await updateExam('general', {
      archived: true,
      title: general.title === 'General Exam Pool' ? 'Computer Basics (Archived)' : general.title,
      description: 'An older practice exam on computer basics. Try it in your spare time; it is not the current exam.',
      allowedClasses: CLASS_OPTIONS,
    });
  }

  await settings.updateOne(
    { key: CURRENT_EXAM_SEED_KEY },
    { $set: { key: CURRENT_EXAM_SEED_KEY, value: { seededAt: Date.now() }, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function startServer() {
  if (!String(process.env.MONGO_URI ?? '').trim()) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    // Build indexes before accepting traffic so the first exam rush doesn't pay for it.
    await Promise.all([initSessionStore(), initUserStore(), listExams(), getQuestionPoolCount()]);
    await ensureCurrentExamSeeded();
  } catch (error) {
    console.error(`Could not connect to MongoDB: ${error?.message ?? error}`);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Salem Exam API running on http://localhost:${PORT}`);
    if (!parsedAdminPasscodeHash) {
      console.warn('ADMIN_PASSCODE_HASH is not configured. Admin login is disabled until it is set.');
    }
    if (IS_PRODUCTION && !TRUST_PROXY) {
      console.warn('TRUST_PROXY is not set. Behind a reverse proxy, set it so rate limits see real client IPs.');
    }
    startKeepAliveLoop();
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`${signal} received: finishing in-flight requests, then exiting.`);
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    server.close(async () => {
      await closeDb().catch(() => undefined);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void startServer();
