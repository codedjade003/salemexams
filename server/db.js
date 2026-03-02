import { MongoClient } from 'mongodb';

const MONGO_URI = String(process.env.MONGO_URI ?? '').trim();
const MONGO_DB_NAME = String(process.env.MONGO_DB_NAME ?? 'salemexams').trim();

let client = null;
let db = null;
let connectPromise = null;

async function ensureConnected() {
  if (db) {
    return db;
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  if (connectPromise) {
    await connectPromise;
    return db;
  }

  connectPromise = (async () => {
    client = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,
      retryWrites: true,
    });

    await client.connect();
    db = client.db(MONGO_DB_NAME);
  })();

  await connectPromise;
  return db;
}

export async function getDb() {
  return ensureConnected();
}

export async function getCollection(name) {
  const database = await ensureConnected();
  return database.collection(name);
}

export async function closeDb() {
  if (!client) {
    return;
  }

  await client.close();
  client = null;
  db = null;
  connectPromise = null;
}
