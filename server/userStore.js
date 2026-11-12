import { randomUUID } from 'node:crypto';

import { getCollection } from './db.js';
import { hashPasswordScryptAsync } from './authUtils.js';

const USERS_COLLECTION = 'users';
const HELP_COLLECTION = 'password_assistance_requests';
let initialized = false;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeUsername(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text.replace(/[^a-z0-9._-]/g, '').slice(0, 32);
}

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
}

export function buildUserKey({ fullName, classRoom, email, username }) {
  const emailPart = normalizeEmail(email);
  const usernamePart = normalizeUsername(username);
  const identityPart = emailPart || (usernamePart ? `@${usernamePart}` : '');
  return `${normalizeText(fullName).toLowerCase()}|${normalizeText(classRoom).toLowerCase()}|${identityPart}`;
}

export function defaultPasswordFromName(fullName) {
  return normalizeText(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function createUniqueIndexSafely(collection, keys, name, partialFilterExpression) {
  try {
    await collection.createIndex(keys, { unique: true, name, partialFilterExpression });
  } catch (error) {
    console.warn(
      `[users] Could not create unique index ${name} (existing duplicate values?): ${error?.message ?? error}`
    );
  }
}

function duplicateKeyError(error) {
  if (error?.code !== 11000) {
    return null;
  }

  const keyPattern = error?.keyPattern ?? {};
  if (keyPattern.email) {
    const duplicate = new Error('A student account with this email already exists.');
    duplicate.code = 'EMAIL_ALREADY_EXISTS';
    return duplicate;
  }
  if (keyPattern.username) {
    const duplicate = new Error('A student account with this username already exists.');
    duplicate.code = 'USERNAME_ALREADY_EXISTS';
    return duplicate;
  }

  const duplicate = new Error('A student account with these details already exists.');
  duplicate.code = 'USER_ALREADY_EXISTS';
  return duplicate;
}

let initializingPromise = null;

export async function initUserStore() {
  await ensureInitialized();
}

async function ensureInitialized() {
  if (initialized) {
    return;
  }

  if (!initializingPromise) {
    initializingPromise = runInitialization().finally(() => {
      if (!initialized) {
        initializingPromise = null;
      }
    });
  }

  await initializingPromise;
}

async function runInitialization() {

  const users = await getCollection(USERS_COLLECTION);
  const requests = await getCollection(HELP_COLLECTION);

  await users.createIndex({ id: 1 }, { unique: true, name: 'idx_user_id' });
  await users.createIndex({ userKey: 1 }, { unique: true, name: 'idx_user_key' });
  await users.createIndex({ email: 1 }, { name: 'idx_user_email' });
  await users.createIndex({ username: 1 }, { name: 'idx_user_username' });
  await users.createIndex({ classRoom: 1 }, { name: 'idx_user_class_room' });
  // Database-level guarantee that two accounts can't share an email/username, even when two
  // registrations race. Blank values are excluded. If existing data already has duplicates the
  // index can't be built; the app keeps working on its pre-checks and logs a warning instead.
  await createUniqueIndexSafely(users, { email: 1 }, 'uniq_user_email', { email: { $type: 'string', $gt: '' } });
  await createUniqueIndexSafely(users, { username: 1 }, 'uniq_user_username', {
    username: { $type: 'string', $gt: '' },
  });

  await requests.createIndex({ id: 1 }, { unique: true, name: 'idx_help_id' });
  await requests.createIndex({ userKey: 1, createdAt: -1 }, { name: 'idx_help_user_key_created_at' });
  await requests.createIndex({ status: 1, createdAt: -1 }, { name: 'idx_help_status_created_at' });

  initialized = true;
}

function sanitizeUserInput(payload) {
  const fullName = normalizeText(payload?.fullName);
  const classRoom = normalizeText(payload?.classRoom);
  const email = normalizeEmail(payload?.email);
  const username = normalizeUsername(payload?.username);
  return {
    fullName,
    classRoom,
    email,
    username,
    firstName: normalizeText(payload?.firstName),
    middleName: normalizeText(payload?.middleName),
    lastName: normalizeText(payload?.lastName),
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    userKey: user.userKey,
    fullName: user.fullName,
    firstName: user.firstName ?? '',
    middleName: user.middleName ?? '',
    lastName: user.lastName ?? '',
    classRoom: user.classRoom,
    email: user.email,
    username: user.username ?? '',
    mustChangePassword: Boolean(user.mustChangePassword),
    isTest: Boolean(user.isTest),
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

export async function getUserByUsername(username) {
  await ensureInitialized();
  const users = await getCollection(USERS_COLLECTION);
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return null;
  }

  const found = await users.findOne({ username: normalized });
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

  if (!normalized.fullName || !normalized.classRoom) {
    throw new Error('Invalid student details.');
  }

  if (!normalized.email && !normalized.username) {
    throw new Error('Provide at least an email or a username.');
  }

  if (typeof password !== 'string' || password.length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }

  if (normalized.email) {
    const existingEmail = await users.findOne({ email: normalized.email });
    if (existingEmail) {
      const error = new Error('A student account with this email already exists.');
      error.code = 'EMAIL_ALREADY_EXISTS';
      throw error;
    }
  }

  if (normalized.username) {
    const existingUsername = await users.findOne({ username: normalized.username });
    if (existingUsername) {
      const error = new Error('A student account with this username already exists.');
      error.code = 'USERNAME_ALREADY_EXISTS';
      throw error;
    }
  }

  const existingUserKey = await users.findOne({ userKey });
  if (existingUserKey) {
    const error = new Error('A student account with these details already exists.');
    error.code = 'USER_ALREADY_EXISTS';
    throw error;
  }

  if (!normalized.email) {
    normalized.email = '';
  }
  if (!normalized.username) {
    normalized.username = '';
  }

  const now = Date.now();
  const user = {
    id: randomUUID(),
    userKey,
    fullName: normalized.fullName,
    firstName: normalized.firstName,
    middleName: normalized.middleName,
    lastName: normalized.lastName,
    classRoom: normalized.classRoom,
    email: normalized.email,
    username: normalized.username,
    passwordHash: await hashPasswordScryptAsync(password),
    mustChangePassword: Boolean(options.mustChangePassword),
    // Test students are created from the admin dashboard; their data never counts in results.
    isTest: Boolean(options.isTest),
    disabled: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    passwordUpdatedAt: options.mustChangePassword ? null : now,
  };

  try {
    await users.insertOne({ ...user });
  } catch (error) {
    throw duplicateKeyError(error) ?? error;
  }
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
  for (const key of ['firstName', 'middleName', 'lastName']) {
    if (patch?.[key] !== undefined) {
      normalizedPatch[key] = normalizeText(patch[key]);
    }
  }
  if (patch?.classRoom !== undefined) {
    normalizedPatch.classRoom = normalizeText(patch.classRoom);
  }
  if (patch?.email !== undefined) {
    normalizedPatch.email = normalizeEmail(patch.email);
  }
  if (patch?.username !== undefined) {
    normalizedPatch.username = normalizeUsername(patch.username);
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
  if (!nextUser.email && !nextUser.username) {
    throw new Error('User must have at least an email or username.');
  }
  nextUser.userKey = buildUserKey(nextUser);

  if (normalizedPatch.email && normalizedPatch.email !== normalizedExisting.email) {
    const existingEmailOwner = await users.findOne({ email: normalizedPatch.email });
    if (existingEmailOwner && existingEmailOwner.id !== userId) {
      throw new Error('Another user already has this email.');
    }
  }

  if (normalizedPatch.username && normalizedPatch.username !== normalizedExisting.username) {
    const existingUsernameOwner = await users.findOne({ username: normalizedPatch.username });
    if (existingUsernameOwner && existingUsernameOwner.id !== userId) {
      throw new Error('Another user already has this username.');
    }
  }

  try {
    await users.replaceOne({ id: userId }, nextUser);
  } catch (error) {
    const duplicate = duplicateKeyError(error);
    if (duplicate) {
      throw new Error(duplicate.message.replace('A student account', 'Another account'));
    }
    throw error;
  }
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
    username: normalized.username,
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
