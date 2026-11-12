// Archives all student data to a separate database, then clears it from the live one.
//
//   node scripts/archive-and-reset.mjs            # dry run: shows what would happen, changes nothing
//   node scripts/archive-and-reset.mjs --apply    # archive, verify, then clear
//
// Archived and cleared: student accounts, exam attempts, sign-in tokens, password-help requests
// and general feedback. Kept: exams, questions, settings (branding) and admin sign-ins.
//
// The archive is a normal database on the same cluster, named <db>_archive_<date>. To browse it,
// run the app with MONGO_DB_NAME set to that name. Nothing is deleted from the live database
// until every archived collection has been checked document-for-document by count.
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { MongoClient } from 'mongodb';

const STUDENT_COLLECTIONS = ['users', 'sessions', 'student_tokens', 'password_assistance_requests', 'student_general_feedback'];

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const index = line.indexOf('=');
      if (index > 0 && !line.trim().startsWith('#')) {
        out[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch {
    // no .env: rely on the process environment
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
if (!env.MONGO_URI) {
  console.error('MONGO_URI is not set.');
  process.exit(1);
}
const dnsServers = String(env.MONGO_DNS_SERVERS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

const liveName = env.MONGO_DB_NAME || 'salemexams';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const archiveName = env.ARCHIVE_DB_NAME || `${liveName}_archive_${stamp}`;

const client = new MongoClient(env.MONGO_URI);
await client.connect();
const live = client.db(liveName);
const archive = client.db(archiveName);

try {
  const host = new URL(env.MONGO_URI.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  console.log(`Live database:    ${liveName} on ${host}`);
  console.log(`Archive database: ${archiveName}\n`);

  const counts = {};
  for (const name of STUDENT_COLLECTIONS) counts[name] = await live.collection(name).countDocuments();
  const kept = {};
  for (const name of ['exams', 'questions', 'settings']) kept[name] = await live.collection(name).countDocuments();
  console.table({ ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { documents: v, action: 'archive + clear' }])), ...Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, { documents: v, action: 'keep' }])) });

  const byClass = await live.collection('users').aggregate([{ $group: { _id: '$classRoom', students: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  console.log('Accounts per class:', byClass.map((row) => `${row._id}: ${row.students}`).join(', ') || 'none');

  const now = Date.now();
  const inProgress = await live.collection('sessions').countDocuments({ submittedAt: null, expiresAt: { $gt: now } });
  console.log(`Exams in progress right now: ${inProgress}`);

  if (!apply) {
    console.log('\nDry run only. Nothing was changed. Run again with --apply to archive and clear.');
  } else if (inProgress > 0 && !force) {
    console.log('\nStopped: students are in the middle of an exam. Wait for them to finish (or pass --force).');
    process.exitCode = 1;
  } else {
    for (const name of STUDENT_COLLECTIONS) {
      const target = archive.collection(name);
      if (await target.countDocuments()) {
        throw new Error(`${archiveName}.${name} already has data. Set ARCHIVE_DB_NAME to a new name and run again.`);
      }
      let copied = 0;
      let batch = [];
      for await (const doc of live.collection(name).find({})) {
        batch.push(doc);
        if (batch.length >= 200) {
          await target.insertMany(batch);
          copied += batch.length;
          batch = [];
        }
      }
      if (batch.length) {
        await target.insertMany(batch);
        copied += batch.length;
      }
      const archived = await target.countDocuments();
      if (archived !== counts[name] || copied !== counts[name]) {
        throw new Error(`Archive of ${name} is incomplete (${archived} of ${counts[name]}). Nothing was deleted.`);
      }
      console.log(`archived ${name}: ${archived}`);
    }
    // Exams, questions and settings are copied too, so the archive opens as a complete app.
    for (const name of ['exams', 'questions', 'settings']) {
      const docs = await live.collection(name).find({}).toArray();
      if (docs.length && !(await archive.collection(name).countDocuments())) await archive.collection(name).insertMany(docs);
    }
    await archive.collection('archive_info').insertOne({ archivedAt: new Date(), from: liveName, counts });

    for (const name of STUDENT_COLLECTIONS) {
      const result = await live.collection(name).deleteMany({});
      console.log(`cleared ${name}: ${result.deletedCount}`);
    }
    console.log(`\nDone. The live database has no student data; the archive is "${archiveName}".`);
  }
} finally {
  await client.close();
}
