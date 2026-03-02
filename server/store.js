import { getCollection } from './db.js';

const COLLECTION_NAME = 'sessions';
let initialized = false;

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

  const collection = await getCollection(COLLECTION_NAME);
  await collection.createIndex({ id: 1 }, { unique: true, name: 'idx_session_id' });
  await collection.createIndex({ studentKey: 1 }, { name: 'idx_session_student_key' });
  await collection.createIndex({ examId: 1 }, { name: 'idx_session_exam_id' });
  await collection.createIndex({ startedAt: -1 }, { name: 'idx_session_started_at' });

  initialized = true;
}

export async function getSession(sessionId) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const session = await collection.findOne({ id: sessionId });
  return session ? stripMongoId(session) : null;
}

export async function listSessions() {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const sessions = await collection.find({}).toArray();
  return sessions.map(stripMongoId);
}

export async function saveSession(session) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  await collection.replaceOne(
    { id: session.id },
    { ...session },
    { upsert: true }
  );

  return session;
}

export async function updateSession(sessionId, updater) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const existing = await collection.findOne({ id: sessionId });
  if (!existing) {
    return null;
  }

  const nextValue = updater(stripMongoId(existing));
  if (!nextValue) {
    return null;
  }

  await collection.replaceOne({ id: sessionId }, { ...nextValue }, { upsert: false });
  return nextValue;
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
