import { setTimeout as delay } from 'node:timers/promises';

import { getCollection } from './db.js';

const COLLECTION_NAME = 'sessions';
let initialized = false;
let initializingPromise = null;
const SESSION_UPDATE_MAX_RETRIES_INPUT = Number(process.env.SESSION_UPDATE_MAX_RETRIES ?? 8);
const SESSION_UPDATE_MAX_RETRIES =
  Number.isFinite(SESSION_UPDATE_MAX_RETRIES_INPUT) && SESSION_UPDATE_MAX_RETRIES_INPUT >= 1
    ? Math.round(SESSION_UPDATE_MAX_RETRIES_INPUT)
    : 8;
const SESSION_UPDATE_DELAY_MS_INPUT = Number(process.env.SESSION_UPDATE_DELAY_MS ?? 0);
const SESSION_UPDATE_DELAY_MS =
  Number.isFinite(SESSION_UPDATE_DELAY_MS_INPUT) && SESSION_UPDATE_DELAY_MS_INPUT > 0
    ? Math.round(SESSION_UPDATE_DELAY_MS_INPUT)
    : 0;

// List views never need the per-question snapshot (the largest part of a session document),
// so excluding it keeps dashboard and admin queries small as the collection grows.
export const SESSION_LIST_PROJECTION = Object.freeze({ _id: 0, questionSnapshot: 0 });

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
}

export function getSessionRevision(session) {
  const revisionInput = Number(session?.revision);
  return Number.isFinite(revisionInput) && revisionInput >= 1 ? Math.trunc(revisionInput) : 0;
}

function buildRevisionFilter(sessionId, revision) {
  if (revision <= 0) {
    return {
      id: sessionId,
      $or: [{ revision: { $exists: false } }, { revision: 0 }],
    };
  }

  return { id: sessionId, revision };
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
    await collection.createIndex({ id: 1 }, { unique: true, name: 'idx_session_id' });
    await collection.createIndex({ studentKey: 1 }, { name: 'idx_session_student_key' });
    await collection.createIndex({ examId: 1 }, { name: 'idx_session_exam_id' });
    await collection.createIndex({ startedAt: -1 }, { name: 'idx_session_started_at' });
    await collection.createIndex({ userId: 1, startedAt: -1 }, { name: 'idx_session_user_id' });
    await collection.createIndex({ userKey: 1, startedAt: -1 }, { name: 'idx_session_user_key' });
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

export async function initSessionStore() {
  await ensureInitialized();
}

export async function getSession(sessionId) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const session = await collection.findOne({ id: sessionId });
  return session ? stripMongoId(session) : null;
}

/**
 * Lists sessions matching `filter`. Pass `projection: SESSION_LIST_PROJECTION` for list views.
 */
export async function listSessions({ filter = {}, projection = null } = {}) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const cursor = projection ? collection.find(filter, { projection }) : collection.find(filter);
  const sessions = await cursor.toArray();
  return sessions.map(stripMongoId);
}

export async function insertSession(session) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const nextSession = {
    ...session,
    revision: 1,
  };

  await collection.insertOne({ ...nextSession });
  return nextSession;
}

/**
 * Persists `session` only if nobody else wrote it since `expectedRevision` was read.
 * Returns the stored session, or null when a concurrent write won (the caller's copy is stale).
 */
export async function saveSessionIfRevision(session, expectedRevision) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const nextSession = {
    ...session,
    revision: Math.max(0, Math.trunc(Number(expectedRevision) || 0)) + 1,
  };

  const result = await collection.replaceOne(
    buildRevisionFilter(session.id, Math.max(0, Math.trunc(Number(expectedRevision) || 0))),
    nextSession,
    { upsert: false }
  );

  return result.matchedCount === 1 ? nextSession : null;
}

/**
 * Optimistic read-modify-write. `updater(current)` returns the next session, `null` to abort,
 * or `current` itself to signal "no change" (nothing is written).
 */
export async function updateSession(sessionId, updater) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  for (let attempt = 0; attempt < SESSION_UPDATE_MAX_RETRIES; attempt += 1) {
    const existing = await collection.findOne({ id: sessionId });
    if (!existing) {
      return null;
    }

    const current = stripMongoId(existing);
    const currentRevision = getSessionRevision(current);
    const nextValue = updater(current);
    if (!nextValue) {
      return null;
    }

    if (nextValue === current) {
      return current;
    }

    const nextSession = {
      ...nextValue,
      revision: currentRevision + 1,
    };

    if (SESSION_UPDATE_DELAY_MS > 0) {
      await delay(SESSION_UPDATE_DELAY_MS);
    }

    const result = await collection.replaceOne(
      buildRevisionFilter(sessionId, currentRevision),
      nextSession,
      { upsert: false }
    );

    if (result.matchedCount === 1) {
      return nextSession;
    }
  }

  throw new Error(`Could not update session ${sessionId} after repeated concurrent write conflicts.`);
}

export async function countSessions(filter = {}) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  return collection.countDocuments(filter);
}

/** Returns Map<examId, number of sessions>. Sessions without an examId count as 'general'. */
export async function countSessionsByExam() {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const rows = await collection
    .aggregate([{ $group: { _id: { $ifNull: ['$examId', 'general'] }, count: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
}

export async function deleteSession(sessionId) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const result = await collection.deleteOne({ id: sessionId });
  return result.deletedCount > 0;
}

export async function deleteSessions(sessionIds) {
  await ensureInitialized();
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return 0;
  }

  const collection = await getCollection(COLLECTION_NAME);
  const result = await collection.deleteMany({ id: { $in: sessionIds } });
  return result.deletedCount ?? 0;
}
