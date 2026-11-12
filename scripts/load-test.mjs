// Load test: N students (default 40) take the current exam at the same time.
//
//   MONGO_URI=... npm run test:load              # boots a server on a throwaway database
//   BASE_URL=http://host:port MONGO_URI=... MONGO_DB_NAME=... npm run test:load   # against a running server
//
// Every student registers, changes the starting password, starts the exam, answers all questions
// (a mix of single saves, batch saves, changed answers and a final batch sent with the submit),
// logs proctoring events, and submits. Afterwards the script reads each attempt straight from
// MongoDB and fails if any stored answer differs from the last answer that student sent, or if
// the score is not exactly what those answers should earn.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { MongoClient } from 'mongodb';
import { hashPasswordScrypt } from '../server/authUtils.js';
import { CURRENT_EXAM_ID } from '../server/currentExam.js';
import { flattenFlowNodes } from '../server/questionModel.js';

const STUDENTS = Number(process.env.STUDENTS ?? 40);
const THINK_MS = Number(process.env.THINK_MS ?? 40);

function loadEnvFile() {
  try {
    const out = {};
    for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const index = line.indexOf('=');
      if (index > 0 && !line.trim().startsWith('#')) out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

const timings = new Map();
let failedRequests = 0;

async function call(baseUrl, label, pathName, { token, json, method = 'POST', expectStatus } = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const elapsed = performance.now() - started;
  timings.set(label, [...(timings.get(label) ?? []), elapsed]);
  const payload = await response.json().catch(() => ({}));
  if (expectStatus ? response.status !== expectStatus : !response.ok) {
    failedRequests += 1;
    throw new Error(`${label} -> HTTP ${response.status}: ${payload.error ?? 'no error message'}`);
  }
  return payload;
}

/** The right answer for a question, built from the attempt's stored snapshot. */
function correctAnswer(question) {
  if (question.type === 'single' || question.type === 'multi') return [...question.correctOptionIds];
  if (question.type === 'order') return [...question.correctOrder];
  if (question.type === 'flowchart') {
    return flattenFlowNodes(question.flowchart.nodes)
      .filter((node) => node.blank)
      .map((node) => question.pool.find((item) => item.text === node.text).id);
  }
  return {
    code: 'a = float(input())\nb = float(input())\nprint("The sum is", a + b)',
    checks: { passed: question.tests.length, total: question.tests.length },
  };
}

function wrongAnswer(question) {
  if (question.type === 'single' || question.type === 'multi') {
    const wrong = question.options.find((option) => !question.correctOptionIds.includes(option.id));
    return [wrong.id];
  }
  if (question.type === 'order') return [...question.correctOrder].reverse();
  if (question.type === 'flowchart') {
    return correctAnswer(question).map((_id, index, all) => all[(index + 1) % all.length]);
  }
  return { code: 'print(input() + input())', checks: { passed: 0, total: question.tests.length } };
}

async function runStudent(index, { baseUrl, db }) {
  const username = `load${Date.now().toString(36)}${index}`;
  const jitter = () => delay(Math.random() * THINK_MS);

  const registered = await call(baseUrl, 'register', '/api/student/register', {
    json: { firstName: 'Load', lastName: `Student${String.fromCharCode(65 + (index % 26))}`, classRoom: 'SS1 A', username },
  });
  let token = registered.token;
  const changed = await call(baseUrl, 'change-password', '/api/student/change-password', { token, json: { newPassword: 'pass1234' } });
  token = changed.token;
  await call(baseUrl, 'dashboard', '/api/student/me', { token, method: 'GET' });

  const session = await call(baseUrl, 'start', '/api/exam/start', {
    token,
    json: { examId: CURRENT_EXAM_ID, setup: { camera: 'on', fullscreen: true, practiceCompleted: true } },
  });
  const sessionId = session.sessionId;
  if (JSON.stringify(session.questions).match(/correctOptionIds|correctOrder|"tests":\[\]/)) {
    throw new Error('The exam payload sent to the student contains answers.');
  }
  for (const question of session.questions) {
    if (question.type === 'flowchart') {
      const blanks = flattenFlowNodes(question.flowchart.nodes).filter((node) => node.blank);
      if (blanks.some((node) => node.text)) throw new Error('Flowchart blanks reveal their text to the student.');
    }
  }

  const stored = await db.collection('sessions').findOne({ id: sessionId });
  const expected = {};
  let expectedCorrect = 0;
  const plan = session.questions.map((publicQuestion, position) => {
    const question = stored.questionSnapshot[publicQuestion.id];
    // Deterministic mix: every third question wrong, one in ten left blank.
    const mode = (position + index) % 10 === 9 ? 'blank' : (position + index) % 3 === 0 ? 'wrong' : 'right';
    return { question, position, mode };
  });

  const finalBatch = {};
  let batch = {};
  for (const { question, position, mode } of plan) {
    await jitter();
    await call(baseUrl, 'seen', `/api/exam/${sessionId}/seen`, { token, json: { questionId: question.id, questionIndex: position } });
    if (mode === 'blank') continue;
    const answer = mode === 'right' ? correctAnswer(question) : wrongAnswer(question);
    expected[question.id] = answer;
    if (mode === 'right') expectedCorrect += 1;

    if (position >= plan.length - 3) {
      // The last answers are never saved on their own: they travel with the submit request.
      finalBatch[question.id] = answer;
    } else if (position % 4 === 0) {
      // Change of mind: a different answer first, then the intended one.
      await call(baseUrl, 'answer', `/api/exam/${sessionId}/answer`, { token, json: { questionId: question.id, response: wrongAnswer(question) } });
      await call(baseUrl, 'answer', `/api/exam/${sessionId}/answer`, { token, json: { questionId: question.id, response: answer } });
    } else {
      batch[question.id] = answer;
      if (Object.keys(batch).length >= 3) {
        await call(baseUrl, 'answers (batch)', `/api/exam/${sessionId}/answers`, { token, json: { answers: batch } });
        batch = {};
      }
    }
    if (position % 7 === 0) {
      await call(baseUrl, 'flag', `/api/exam/${sessionId}/flag`, { token, json: { questionId: question.id, flagged: true } });
    }
  }
  if (Object.keys(batch).length) {
    await call(baseUrl, 'answers (batch)', `/api/exam/${sessionId}/answers`, { token, json: { answers: batch } });
  }

  // One counted violation (left the tab for 6 s) and one brief focus loss that must not count.
  await call(baseUrl, 'proctor', `/api/exam/${sessionId}/proctor`, {
    token,
    json: { type: 'tab_switch', detail: 'Left the exam for 6s', evidence: { durationMs: 6000, causes: ['tab_switch', 'window_blur'], questionNumber: 3 } },
  });
  await call(baseUrl, 'proctor', `/api/exam/${sessionId}/proctor`, {
    token,
    json: { type: 'window_blur', detail: 'Focus lost for 0.4s', evidence: { durationMs: 400 } },
  });

  const submitted = await call(baseUrl, 'submit', `/api/exam/${sessionId}/submit`, { token, json: { answers: finalBatch } });
  const summary = submitted.session.summary;

  const total = plan.length;
  const rawPercent = Number(((expectedCorrect / total) * 100).toFixed(2));
  const expectedFinal = Number(Math.max(0, rawPercent - Math.min(rawPercent, 2)).toFixed(2));
  const problems = [];
  if (summary.correctCount !== expectedCorrect) problems.push(`correctCount ${summary.correctCount}, expected ${expectedCorrect}`);
  if (summary.answeredCount !== Object.keys(expected).length) problems.push(`answeredCount ${summary.answeredCount}, expected ${Object.keys(expected).length}`);
  if (summary.violationsCount !== 1) problems.push(`counted violations ${summary.violationsCount}, expected 1`);
  if (summary.totalViolationsCount !== 2) problems.push(`logged violations ${summary.totalViolationsCount}, expected 2`);
  if (summary.finalPercent !== expectedFinal) problems.push(`finalPercent ${summary.finalPercent}, expected ${expectedFinal}`);

  const after = await db.collection('sessions').findOne({ id: sessionId });
  for (const [questionId, answer] of Object.entries(expected)) {
    const saved = after.answers?.[questionId];
    const same =
      Array.isArray(answer)
        ? JSON.stringify(saved) === JSON.stringify(answer)
        : saved?.code === answer.code && saved?.checks?.passed === answer.checks.passed;
    if (!same) problems.push(`answer for ${questionId} stored as ${JSON.stringify(saved)}, sent ${JSON.stringify(answer)}`);
  }
  const unexpected = Object.keys(after.answers ?? {}).filter((questionId) => !(questionId in expected));
  if (unexpected.length) problems.push(`unexpected answers stored for ${unexpected.join(', ')}`);

  // After submitting: dispute the counted violation, then check the dashboard still loads.
  const counted = after.violations.find((violation) => violation.type === 'tab_switch');
  await call(baseUrl, 'dispute', `/api/student/trials/${sessionId}/violations/${counted.id}/dispute`, {
    token,
    json: { reason: 'accident', note: 'Load test dispute' },
  });
  await call(baseUrl, 'dashboard', '/api/student/me', { token, method: 'GET' });

  return { index, sessionId, problems, questions: total, answers: Object.keys(expected).length };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function main() {
  const envFile = loadEnvFile();
  const mongoUri = process.env.MONGO_URI ?? envFile.MONGO_URI ?? '';
  if (!mongoUri) throw new Error('MONGO_URI is required.');
  const external = process.env.BASE_URL;
  const dbName = external
    ? process.env.MONGO_DB_NAME ?? envFile.MONGO_DB_NAME
    : `${process.env.MONGO_DB_NAME ?? envFile.MONGO_DB_NAME ?? 'salemexams'}_load_${Date.now()}`;
  const port = 4900 + Math.floor(Math.random() * 90);
  const baseUrl = external ?? `http://127.0.0.1:${port}`;
  const adminPasscode = 'load-test-admin';

  let child = null;
  if (!external) {
    child = spawn(process.execPath, ['server/index.js'], {
      env: {
        ...process.env,
        ...envFile,
        PORT: String(port),
        MONGO_URI: mongoUri,
        MONGO_DB_NAME: dbName,
        ADMIN_PASSCODE_HASH: hashPasswordScrypt(adminPasscode),
        KEEP_ALIVE_ENABLED: 'false',
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) break;
      } catch {
        // not up yet
      }
      await delay(200);
    }
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  try {
    console.log(`[load] ${STUDENTS} students taking "${CURRENT_EXAM_ID}" on ${baseUrl} (db ${dbName})`);
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: STUDENTS }, (_unused, index) => runStudent(index, { baseUrl, db })));
    const seconds = ((performance.now() - started) / 1000).toFixed(1);

    const crashed = results.filter((result) => result.status === 'rejected');
    const completed = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const withProblems = completed.filter((result) => result.problems.length);
    const answersChecked = completed.reduce((sum, result) => sum + result.answers, 0);

    console.log(`\n[load] request timings (ms)`);
    for (const [label, values] of timings) {
      console.log(
        `  ${label.padEnd(18)} n=${String(values.length).padStart(5)}  p50=${percentile(values, 0.5).toFixed(0).padStart(5)}  p95=${percentile(values, 0.95).toFixed(0).padStart(5)}  max=${Math.max(...values).toFixed(0).padStart(5)}`
      );
    }

    if (!external) {
      // Admin views must still work with everything in place.
      const admin = await call(baseUrl, 'admin login', '/api/admin/login', { json: { passcode: adminPasscode } });
      const overview = await call(baseUrl, 'admin overview', '/api/admin/overview', { token: admin.token, method: 'GET' });
      const disputes = await call(baseUrl, 'admin disputes', '/api/admin/disputes', { token: admin.token, method: 'GET' });
      const printStart = performance.now();
      const printed = await fetch(`${baseUrl}/api/admin/report-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ examId: CURRENT_EXAM_ID, attempt: 'best' }),
      });
      const html = await printed.text();
      const cards = (html.match(/class="sheet"/g) ?? []).length;
      console.log(
        `\n[load] admin: overview submitted=${overview.overview.totals.submitted}, open disputes=${disputes.total}, bulk report cards=${cards} (${(html.length / 1024).toFixed(0)} KB in ${(performance.now() - printStart).toFixed(0)} ms)`
      );
      if (cards !== completed.length) withProblems.push({ index: 'admin', problems: [`bulk print produced ${cards} cards, expected ${completed.length}`] });
      if (disputes.total !== completed.length) withProblems.push({ index: 'admin', problems: [`${disputes.total} disputes listed, expected ${completed.length}`] });
    }

    console.log(`\n[load] ${completed.length}/${STUDENTS} students finished in ${seconds}s; ${answersChecked} stored answers compared with what was sent`);
    for (const result of crashed) console.log(`  CRASH: ${result.reason?.message ?? result.reason}`);
    for (const result of withProblems) console.log(`  student ${result.index}: ${result.problems.join('; ')}`);

    if (crashed.length || withProblems.length || failedRequests) {
      console.log(`\n[load] FAIL: ${crashed.length} crashed, ${withProblems.length} with wrong data, ${failedRequests} failed requests`);
      process.exitCode = 1;
    } else {
      console.log('\n[load] PASS: every answer was stored exactly as sent and every score is correct.');
    }
  } finally {
    if (!external) await db.dropDatabase().catch(() => undefined);
    await client.close();
    child?.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error('[load] FAIL:', error.message);
  process.exit(1);
});
