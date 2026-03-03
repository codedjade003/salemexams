import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { MongoClient } from 'mongodb';

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

function loadEnvFile() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    return parseEnvText(readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

function defaultPasswordFromName(fullName) {
  return String(fullName)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForServer(baseUrl, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // keep retrying until timeout
    }
    await delay(400);
  }

  throw new Error(`Server did not become ready in ${timeoutMs}ms.`);
}

async function requestJson(baseUrl, pathName, options = {}) {
  const { json, headers: inputHeaders = {}, ...rest } = options;
  const headers = new Headers(inputHeaders);

  if (json !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const contentType = response.headers.get('content-type') ?? '';
  let payload;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = {
      error: `Unexpected response with status ${response.status}`,
      raw: text.slice(0, 600),
    };
  }

  if (!response.ok) {
    const reason = payload?.error ?? `HTTP ${response.status}`;
    const error = new Error(`${pathName} failed: ${reason}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function requestJsonExpectError(baseUrl, pathName, expectedStatus, expectedErrorFragment, options = {}) {
  try {
    await requestJson(baseUrl, pathName, options);
  } catch (error) {
    assert(
      error?.status === expectedStatus,
      `Expected ${expectedStatus} for ${pathName}, got ${error?.status ?? 'unknown'}`
    );
    const message = String(error?.payload?.error ?? error?.message ?? '');
    if (expectedErrorFragment) {
      assert(
        message.toLowerCase().includes(String(expectedErrorFragment).toLowerCase()),
        `Expected error for ${pathName} to contain "${expectedErrorFragment}", got "${message}"`
      );
    }
    return error.payload;
  }

  throw new Error(`Expected ${pathName} to fail with ${expectedStatus}, but it succeeded.`);
}

function printStep(message) {
  console.log(`[smoke] ${message}`);
}

async function main() {
  const envFile = loadEnvFile();
  const mongoUri = process.env.MONGO_URI ?? envFile.MONGO_URI ?? '';
  const baseDbName = process.env.MONGO_DB_NAME ?? envFile.MONGO_DB_NAME ?? 'salemexams';
  const mongoDnsServers = process.env.MONGO_DNS_SERVERS ?? envFile.MONGO_DNS_SERVERS ?? '';

  assert(mongoUri, 'MONGO_URI is required for smoke test.');

  const dnsServers = String(mongoDnsServers)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
  }

  const timestamp = Date.now();
  const port = 4700 + Math.floor(Math.random() * 200);
  const smokeDbName = `${baseDbName}_smoke_${timestamp}`;
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn('node', ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...envFile,
      PORT: String(port),
      MONGO_URI: mongoUri,
      MONGO_DB_NAME: smokeDbName,
      RESULT_RELEASE_DELAY_MS: '0',
      KEEP_ALIVE_ENABLED: 'false',
      MONGO_DNS_SERVERS: mongoDnsServers,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLogs = [];
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    serverLogs.push(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    serverLogs.push(text);
  });

  let client = null;
  try {
    printStep(`Booting local server on ${baseUrl} with DB ${smokeDbName}`);
    await waitForServer(baseUrl);
    printStep('Server is healthy');

    const fullName = `Smoke Student ${timestamp}`;
    const classRoom = 'JSS1 A';
    const email = `smoke.${timestamp}@example.com`;
    const password = defaultPasswordFromName(fullName);

    const loginPayload = await requestJson(baseUrl, '/api/student/login', {
      method: 'POST',
      json: { fullName, classRoom, email, password },
    });
    assert(typeof loginPayload.token === 'string' && loginPayload.token.length > 10, 'Login token missing.');
    printStep('Student login passed');

    const authHeaders = {
      Authorization: `Bearer ${loginPayload.token}`,
    };

    const meBeforePasswordChange = await requestJson(baseUrl, '/api/student/me', {
      method: 'GET',
      headers: authHeaders,
    });
    assert(meBeforePasswordChange?.user?.email === email, 'Student profile fetch failed before password change.');

    const newPassword = `${password}9`;
    await requestJson(baseUrl, '/api/student/change-password', {
      method: 'POST',
      headers: authHeaders,
      json: {
        currentPassword: password,
        newPassword,
      },
    });
    printStep('Password change passed');

    await requestJsonExpectError(
      baseUrl,
      '/api/student/login',
      401,
      'invalid password',
      {
        method: 'POST',
        json: { fullName, classRoom, email, password },
      }
    );

    const reloginPayload = await requestJson(baseUrl, '/api/student/login', {
      method: 'POST',
      json: { fullName, classRoom, email, password: newPassword },
    });
    assert(
      typeof reloginPayload.token === 'string' && reloginPayload.token.length > 10,
      'Re-login token missing after password change.'
    );
    printStep('Re-login with new password passed');

    const freshAuthHeaders = {
      Authorization: `Bearer ${reloginPayload.token}`,
    };

    const started = await requestJson(baseUrl, '/api/exam/start', {
      method: 'POST',
      headers: freshAuthHeaders,
      json: { examId: 'general' },
    });
    assert(typeof started.sessionId === 'string', 'Session ID missing from start response.');
    assert(Array.isArray(started.questions) && started.questions.length === 40, 'Expected 40 questions on start.');
    printStep(`Session started: ${started.sessionId}`);

    const targetQuestions = started.questions.slice(0, 5);
    for (let index = 0; index < targetQuestions.length; index += 1) {
      const question = targetQuestions[index];
      assert(question?.id, `Question ${index + 1} has no ID.`);

      await requestJson(baseUrl, `/api/exam/${started.sessionId}/seen`, {
        method: 'POST',
        headers: freshAuthHeaders,
        json: { questionId: question.id, questionIndex: index },
      });

      const selectedOptionIds =
        question.type === 'multi'
          ? question.options.slice(0, 2).map((item) => item.id)
          : [question.options[0].id];

      await requestJson(baseUrl, `/api/exam/${started.sessionId}/answer`, {
        method: 'POST',
        headers: freshAuthHeaders,
        json: {
          questionId: question.id,
          questionIndex: index,
          selectedOptionIds,
        },
      });
    }
    printStep('Seen + answer save passed for first 5 questions');

    await requestJson(baseUrl, `/api/exam/${started.sessionId}/flag`, {
      method: 'POST',
      headers: freshAuthHeaders,
      json: {
        questionId: targetQuestions[0].id,
        questionIndex: 0,
        flagged: true,
      },
    });

    await requestJsonExpectError(
      baseUrl,
      `/api/exam/${started.sessionId}/proctor`,
      400,
      'violation type is required',
      {
        method: 'POST',
        headers: freshAuthHeaders,
        json: { detail: 'missing type test' },
      }
    );

    await requestJson(baseUrl, `/api/exam/${started.sessionId}/proctor`, {
      method: 'POST',
      headers: freshAuthHeaders,
      json: {
        type: 'tab_switch',
        detail: 'smoke test event',
      },
    });
    printStep('Flag + proctor logging passed');

    const submitted = await requestJson(baseUrl, `/api/exam/${started.sessionId}/submit`, {
      method: 'POST',
      headers: freshAuthHeaders,
    });
    assert(submitted?.session?.submittedAt, 'Submit did not return submitted session.');
    printStep('Submit passed');

    await requestJson(baseUrl, `/api/exam/${started.sessionId}/feedback`, {
      method: 'POST',
      headers: freshAuthHeaders,
      json: {
        rating: 4,
        comment: 'Smoke test feedback',
      },
    });
    printStep('Feedback save passed');

    const trials = await requestJson(baseUrl, '/api/student/trials', {
      method: 'GET',
      headers: freshAuthHeaders,
    });
    assert(Array.isArray(trials.trials) && trials.trials.length >= 1, 'No student trials returned.');

    const trial = await requestJson(baseUrl, `/api/student/trials/${started.sessionId}`, {
      method: 'GET',
      headers: freshAuthHeaders,
    });
    assert(Array.isArray(trial?.trial?.questionReview), 'Question review missing from trial response.');
    printStep('Student trials endpoints passed');

    client = new MongoClient(mongoUri, {
      maxPoolSize: 5,
      minPoolSize: 1,
      retryWrites: true,
    });
    await client.connect();
    const db = client.db(smokeDbName);
    const savedSession = await db.collection('sessions').findOne({ id: started.sessionId });
    assert(savedSession, 'Session not found in MongoDB.');

    const answeredCount = Object.values(savedSession.answers ?? {}).filter(
      (value) => Array.isArray(value) && value.length > 0
    ).length;
    assert(answeredCount >= 5, `Expected at least 5 answered questions, got ${answeredCount}.`);
    assert(savedSession.summary && typeof savedSession.summary.finalPercent === 'number', 'Summary not persisted.');
    assert(savedSession.feedback?.rating === 4, 'Feedback rating not persisted.');
    assert(
      (savedSession.feedback?.comment ?? '').includes('Smoke test feedback'),
      'Feedback comment not persisted.'
    );
    printStep('Mongo persistence assertions passed');

    console.log('\n[smoke] PASS: end-to-end exam flow is working.');
    console.log(`[smoke] sessionId=${started.sessionId}`);
    console.log(`[smoke] answeredCount=${answeredCount}`);
    console.log(`[smoke] finalPercent=${savedSession.summary.finalPercent}`);
  } catch (error) {
    console.error('\n[smoke] FAIL:', error?.message || error);
    if (error?.payload) {
      console.error('[smoke] payload:', JSON.stringify(error.payload, null, 2));
    }
    if (serverLogs.length > 0) {
      console.error('\n[smoke] Server logs (tail):');
      const tail = serverLogs.join('').split(/\r?\n/).slice(-30).join('\n');
      console.error(tail);
    }
    process.exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.db(smokeDbName).dropDatabase();
      } catch {
        // ignore cleanup errors
      }
      await client.close().catch(() => undefined);
    } else {
      try {
        const cleanupClient = new MongoClient(mongoUri, {
          maxPoolSize: 3,
          minPoolSize: 1,
          retryWrites: true,
        });
        await cleanupClient.connect();
        await cleanupClient.db(smokeDbName).dropDatabase().catch(() => undefined);
        await cleanupClient.close().catch(() => undefined);
      } catch {
        // ignore cleanup failures
      }
    }

    if (!child.killed) {
      child.kill('SIGTERM');
      await delay(350);
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
  }
}

await main();
