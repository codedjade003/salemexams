import { randomUUID } from 'node:crypto';

import { getCollection } from './db.js';
import { hashPasswordScrypt } from './authUtils.js';

const USERS_COLLECTION = 'users';
const HELP_COLLECTION = 'password_assistance_requests';
let initialized = false;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
}

export function buildUserKey({ fullName, classRoom, email }) {
  return `${normalizeText(fullName).toLowerCase()}|${normalizeText(classRoom).toLowerCase()}|${normalizeEmail(email)}`;
}

export function defaultPasswordFromName(fullName) {
  return normalizeText(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function ensureInitialized() {
  if (initialized) {
    return;
  }

  const users = await getCollection(USERS_COLLECTION);
  const requests = await getCollection(HELP_COLLECTION);

  await users.createIndex({ id: 1 }, { unique: true, name: 'idx_user_id' });
  await users.createIndex({ userKey: 1 }, { unique: true, name: 'idx_user_key' });
  await users.createIndex({ email: 1 }, { name: 'idx_user_email' });
  await users.createIndex({ classRoom: 1 }, { name: 'idx_user_class_room' });

  await requests.createIndex({ id: 1 }, { unique: true, name: 'idx_help_id' });
  await requests.createIndex({ userKey: 1, createdAt: -1 }, { name: 'idx_help_user_key_created_at' });
  await requests.createIndex({ status: 1, createdAt: -1 }, { name: 'idx_help_status_created_at' });

  initialized = true;
}

function sanitizeUserInput(payload) {
  const fullName = normalizeText(payload?.fullName);
  const classRoom = normalizeText(payload?.classRoom);
  const email = normalizeEmail(payload?.email);
  return { fullName, classRoom, email };
}

function toPublicUser(user) {
  return {
    id: user.id,
    userKey: user.userKey,
    fullName: user.fullName,
    classRoom: user.classRoom,
    email: user.email,
    mustChangePassword: Boolean(user.mustChangePassword),
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
    passwordUpdatedAt: user.passwordUpdatedAt ?? null,
  };
}

export async function getUserById(userId) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const found = await users.findOne({ id: userId });
  return found ? stripMongoId(found) : null;
}

export async function getUserByKey(userKey) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const found = await users.findOne({ userKey });
  return found ? stripMongoId(found) : null;
}

export async function getUserByEmail(email) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const found = await users.findOne({ email: normalized });
  return found ? stripMongoId(found) : null;
}

export async function listUsers() {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const rows = await users.find({}).sort({ createdAt: -1 }).toArray();
  return rows.map((row) => stripMongoId(row));
}

export async function createUserWithPassword(payload, password, options = {}) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const normalized = sanitizeUserInput(payload);
  const userKey = buildUserKey(normalized);

  if (!normalized.fullName || !normalized.classRoom || !normalized.email) {
    throw new Error('Invalid student details.');
  }

  if (typeof password !== 'string' || password.length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }

  const existingEmail = await users.findOne({ email: normalized.email });
  if (existingEmail) {
    const error = new Error('A student account with this email already exists.');
    error.code = 'EMAIL_ALREADY_EXISTS';
    throw error;
  }

  const existingUserKey = await users.findOne({ userKey });
  if (existingUserKey) {
    const error = new Error('A student account with these details already exists.');
    error.code = 'USER_ALREADY_EXISTS';
    throw error;
  }

  const now = Date.now();
  const user = {
    id: randomUUID(),
    userKey,
    fullName: normalized.fullName,
    classRoom: normalized.classRoom,
    email: normalized.email,
    passwordHash: hashPasswordScrypt(password),
    mustChangePassword: Boolean(options.mustChangePassword),
    disabled: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    passwordUpdatedAt: options.mustChangePassword ? null : now,
  };

  await users.insertOne(user);
  return stripMongoId(user);
}

export async function createUserFromDefaultPassword(payload) {
  const normalized = sanitizeUserInput(payload);
  const defaultPassword = defaultPasswordFromName(normalized.fullName);
  if (!defaultPassword) {
    throw new Error('Invalid student details.');
  }
  return createUserWithPassword(normalized, defaultPassword, { mustChangePassword: true });
}

export async function touchUserLogin(userId) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const now = Date.now();
  await users.updateOne({ id: userId }, { $set: { lastLoginAt: now, updatedAt: now } });
}

export async function updateUserPassword(userId, nextPasswordHash, options = {}) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const now = Date.now();

  await users.updateOne(
    { id: userId },
    {
      $set: {
        passwordHash: nextPasswordHash,
        mustChangePassword: Boolean(options.mustChangePassword),
        passwordUpdatedAt: now,
        updatedAt: now,
      },
    }
  );

  const updated = await users.findOne({ id: userId });
  return updated ? stripMongoId(updated) : null;
}

export async function updateUser(userId, patch) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const existing = await users.findOne({ id: userId });
  if (!existing) {
    return null;
  }

  const normalizedExisting = stripMongoId(existing);
  const normalizedPatch = {};
  if (patch?.fullName !== undefined) {
    normalizedPatch.fullName = normalizeText(patch.fullName);
  }
  if (patch?.classRoom !== undefined) {
    normalizedPatch.classRoom = normalizeText(patch.classRoom);
  }
  if (patch?.email !== undefined) {
    normalizedPatch.email = normalizeEmail(patch.email);
  }
  if (patch?.disabled !== undefined) {
    normalizedPatch.disabled = Boolean(patch.disabled);
  }
  if (patch?.mustChangePassword !== undefined) {
    normalizedPatch.mustChangePassword = Boolean(patch.mustChangePassword);
  }

  const nextUser = {
    ...normalizedExisting,
    ...normalizedPatch,
    updatedAt: Date.now(),
  };
  nextUser.userKey = buildUserKey(nextUser);

  await users.replaceOne({ id: userId }, nextUser);
  return nextUser;
}

export async function createPasswordAssistanceRequest(payload) {
  await ensureInitialized();
  const requests = await getCollection(HELP_COLLECTION);
  const normalized = sanitizeUserInput(payload);

  const request = {
    id: randomUUID(),
    userKey: buildUserKey(normalized),
    fullName: normalized.fullName,
    classRoom: normalized.classRoom,
    email: normalized.email,
    message: normalizeText(payload?.message ?? '').slice(0, 500),
    status: 'open',
    createdAt: Date.now(),
    resolvedAt: null,
    resolvedBy: null,
  };

  await requests.insertOne(request);
  return stripMongoId(request);
}

export async function listPasswordAssistanceRequests() {
  await ensureInitialized();
  const requests = await getCollection(HELP_COLLECTION);
  const rows = await requests.find({}).sort({ createdAt: -1 }).toArray();
  return rows.map((row) => stripMongoId(row));
}

export async function resolvePasswordAssistanceRequest(requestId, resolvedBy = 'admin') {
  await ensureInitialized();
  const requests = await getCollection(HELP_COLLECTION);
  const now = Date.now();

  await requests.updateOne(
    { id: requestId },
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        resolvedBy,
      },
    }
  );

  const updated = await requests.findOne({ id: requestId });
  return updated ? stripMongoId(updated) : null;
}

export function toPublicUserRecord(user) {
  return toPublicUser(user);
}
