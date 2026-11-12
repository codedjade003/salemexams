import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { MongoClient } from 'mongodb';
import { hashPasswordScrypt } from '../server/authUtils.js';

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

function withStudentHeaders(token, headers = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
}

function withAdminHeaders(token, headers = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
}

async function requestText(baseUrl, pathName, options = {}) {
  const { headers: inputHeaders = {}, ...rest } = options;
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...rest,
    headers: new Headers(inputHeaders),
  });

  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`${pathName} failed: HTTP ${response.status}`);
    error.status = response.status;
    error.payload = { body: body.slice(0, 600) };
    throw error;
  }

  return {
    status: response.status,
    body,
    headers: response.headers,
  };
}

function buildStudentApi(baseUrl, token) {
  return {
    fetchMe() {
      return requestJson(baseUrl, '/api/student/me', {
        method: 'GET',
        headers: withStudentHeaders(token),
      });
    },
    changePassword(payload) {
      return requestJson(baseUrl, '/api/student/change-password', {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    startExam(payload) {
      return requestJson(baseUrl, '/api/exam/start', {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    fetchSession(sessionId) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: withStudentHeaders(token),
      });
    },
    markSeen(sessionId, payload) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/seen`, {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    saveAnswer(sessionId, payload) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/answer`, {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    saveFlag(sessionId, payload) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/flag`, {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    logProctor(sessionId, payload) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/proctor`, {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    submit(sessionId) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/submit`, {
        method: 'POST',
        headers: withStudentHeaders(token),
      });
    },
    saveFeedback(sessionId, payload) {
      return requestJson(baseUrl, `/api/exam/${encodeURIComponent(sessionId)}/feedback`, {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
    listTrials() {
      return requestJson(baseUrl, '/api/student/trials', {
        method: 'GET',
        headers: withStudentHeaders(token),
      });
    },
    getTrial(sessionId) {
      return requestJson(baseUrl, `/api/student/trials/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: withStudentHeaders(token),
      });
    },
    saveGeneralFeedback(payload) {
      return requestJson(baseUrl, '/api/student/feedback', {
        method: 'POST',
        headers: withStudentHeaders(token),
        json: payload,
      });
    },
  };
}

function buildAdminApi(baseUrl, token) {
  return {
    fetchUsers(filters = {}) {
      const params = new URLSearchParams();
      if (filters.search) {
        params.set('search', filters.search);
      }
      if (filters.classRoom) {
        params.set('classRoom', filters.classRoom);
      }
      if (filters.status) {
        params.set('status', filters.status);
      }

      const query = params.toString();
      return requestJson(baseUrl, `/api/admin/users${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: withAdminHeaders(token),
      });
    },
    resetUserPassword(userId, payload) {
      return requestJson(baseUrl, `/api/admin/users/${encodeURIComponent(userId)}/password`, {
        method: 'POST',
        headers: withAdminHeaders(token),
        json: payload,
      });
    },
    fetchBranding() {
      return requestJson(baseUrl, '/api/admin/settings/branding', {
        method: 'GET',
        headers: withAdminHeaders(token),
      });
    },
    updateBranding(payload) {
      return requestJson(baseUrl, '/api/admin/settings/branding', {
        method: 'PATCH',
        headers: withAdminHeaders(token),
        json: payload,
      });
    },
    downloadSessionReportCard(sessionId) {
      return requestText(baseUrl, `/api/admin/sessions/${encodeURIComponent(sessionId)}/report-card`, {
        method: 'GET',
        headers: withAdminHeaders(token),
      });
    },
  };
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
  const smokeAdminPasscode = `smoke-admin-${timestamp}`;
  const smokeAdminPasscodeHash = hashPasswordScrypt(smokeAdminPasscode);

  const serverEnv = {
    ...process.env,
    ...envFile,
    ADMIN_PASSCODE_HASH: smokeAdminPasscodeHash,
    PORT: String(port),
    MONGO_URI: mongoUri,
    MONGO_DB_NAME: smokeDbName,
    RESULT_RELEASE_DELAY_MS: '0',
    KEEP_ALIVE_ENABLED: 'false',
    MONGO_DNS_SERVERS: mongoDnsServers,
    SESSION_UPDATE_DELAY_MS: '60',
  };

  let child = null;
  const serverLogs = [];
  async function startServer() {
    child = spawn('node', ['server/index.js'], {
      cwd: process.cwd(),
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      serverLogs.push(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      serverLogs.push(text);
    });

    await waitForServer(baseUrl);
  }

  async function stopServer() {
    if (!child || child.killed) {
      return;
    }

    child.kill('SIGTERM');
    await delay(350);
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }

  let client = null;
  try {
    printStep(`Booting local server on ${baseUrl} with DB ${smokeDbName}`);
    await startServer();
    printStep('Server is healthy');

    const classRoom = 'SS3 A';
    const username = `smoke_user_${timestamp}`;
    const password = 'salem';

    await requestJsonExpectError(baseUrl, '/api/student/register', 400, 'in full', {
      method: 'POST',
      json: { firstName: 'Smoke', middleName: 'T', lastName: 'Tester', classRoom, username },
    });
    const registerPayload = await requestJson(baseUrl, '/api/student/register', {
      method: 'POST',
      json: { firstName: 'sMOKE', middleName: 'mary-jane', lastName: "o'TESTER", classRoom, username },
    });
    assert(typeof registerPayload.token === 'string' && registerPayload.token.length > 10, 'Register token missing.');
    assert(
      registerPayload.user?.fullName === "Smoke Mary-Jane O'Tester",
      `Names should be stored in name case, got "${registerPayload.user?.fullName}".`
    );
    assert(registerPayload.user?.mustChangePassword === true, 'New accounts must be asked to change the starting password.');
    printStep('Student registration passed (names capitalised, starting password must be changed)');

    const loginPayload = await requestJson(baseUrl, '/api/student/login', {
      method: 'POST',
      json: { identifier: username, password },
    });
    assert(typeof loginPayload.token === 'string' && loginPayload.token.length > 10, 'Login token missing.');
    printStep('Student login passed');

    const studentApi = buildStudentApi(baseUrl, loginPayload.token);
    const meBeforePasswordChange = await studentApi.fetchMe();
    assert(meBeforePasswordChange?.user?.username === username, 'Student profile fetch failed before password change.');

    const newPassword = 'mine9';
    await requestJsonExpectError(baseUrl, '/api/student/change-password', 400, 'different from the starting password', {
      method: 'POST',
      headers: withStudentHeaders(loginPayload.token),
      json: { newPassword: 'SALEM' },
    });
    // While a change is required the student is not asked for the starting password again.
    const changed = await studentApi.changePassword({ newPassword });
    assert(changed?.user?.mustChangePassword === false, 'Password change should clear the must-change flag.');
    printStep('Password change passed');

    await requestJsonExpectError(
      baseUrl,
      '/api/student/login',
      401,
      'password is not right',
      {
        method: 'POST',
        json: { identifier: username, password },
      }
    );

    const reloginPayload = await requestJson(baseUrl, '/api/student/login', {
      method: 'POST',
      json: { identifier: username, password: newPassword },
    });
    assert(
      typeof reloginPayload.token === 'string' && reloginPayload.token.length > 10,
      'Re-login token missing after password change.'
    );
    printStep('Re-login with new password passed');

    const examApi = buildStudentApi(baseUrl, reloginPayload.token);
    const dashboard = await examApi.fetchMe();
    assert(Array.isArray(dashboard?.leaderboards?.overall), 'Student dashboard should include overall leaderboard.');
    assert(Array.isArray(dashboard?.leaderboards?.classTop), 'Student dashboard should include class leaderboard.');
    const availableExams = Array.isArray(dashboard?.exams) ? dashboard.exams : [];
    assert(availableExams.length >= 1, 'No exam available for the student.');
    const selectedExam = availableExams.find((exam) => exam.id === 'general') ?? availableExams[0];
    assert(selectedExam?.id, 'Selected exam is invalid.');
    printStep(`Selected exam from dashboard: ${selectedExam.id} (${selectedExam.title ?? 'Untitled'})`);

    const generalFeedbackPayload = await examApi.saveGeneralFeedback({
      rating: 5,
      comment: 'Dashboard feedback from smoke test',
    });
    assert(
      Array.isArray(generalFeedbackPayload?.history) && generalFeedbackPayload.history.length >= 1,
      'General dashboard feedback was not saved.'
    );
    printStep('Student general dashboard feedback save passed');

    printStep('Restarting API process to verify student token persistence...');
    await stopServer();
    await startServer();

    const afterRestartDashboard = await examApi.fetchMe();
    assert(afterRestartDashboard?.user?.username === username, 'Token did not survive restart.');
    printStep('Student token is still valid after server restart');

    const started = await examApi.startExam({ examId: selectedExam.id });
    assert(started?.exam?.id === selectedExam.id, 'Started exam does not match selected dashboard exam.');
    assert(started?.exam?.id === 'general', 'Smoke flow must run against General Exam Pool in this environment.');
    assert(typeof started.sessionId === 'string', 'Session ID missing from start response.');
    assert(Array.isArray(started.questions) && started.questions.length === 40, 'Expected 40 questions on start.');
    printStep(`Session started: ${started.sessionId} (${started.exam?.title ?? selectedExam.title})`);

    const concurrentQuestions = started.questions.slice(5, 7);
    assert(concurrentQuestions.length === 2, 'Need at least two questions for concurrent save test.');
    await Promise.all(
      concurrentQuestions.map((question, index) =>
        examApi.saveAnswer(started.sessionId, {
          questionId: question.id,
          questionIndex: index + 5,
          selectedOptionIds: [question.options[0].id],
        })
      )
    );
    const afterConcurrentSaves = await examApi.fetchSession(started.sessionId);
    for (const question of concurrentQuestions) {
      const savedAnswer = afterConcurrentSaves?.responses?.[question.id] ?? [];
      assert(
        savedAnswer.length === 1 && savedAnswer[0] === question.options[0].id,
        `Concurrent save lost the answer for question ${question.id}.`
      );
    }
    printStep('Concurrent answer writes retained all responses');

    const targetQuestions = started.questions.slice(0, 5);
    for (let index = 0; index < targetQuestions.length; index += 1) {
      const question = targetQuestions[index];
      assert(question?.id, `Question ${index + 1} has no ID.`);

      await examApi.markSeen(started.sessionId, { questionId: question.id, questionIndex: index });

      const selectedOptionIds =
        question.type === 'multi'
          ? question.options.slice(0, 2).map((item) => item.id)
          : [question.options[0].id];

      await examApi.saveAnswer(started.sessionId, {
        questionId: question.id,
        questionIndex: index,
        selectedOptionIds,
      });
    }
    printStep('Seen + answer save passed for first 5 questions');

    // Regression guard: the question ID decides where an answer goes. A missing index used to
    // resolve to position 0, so answers without an index all overwrote question 1.
    const idOnlyQuestions = started.questions.slice(10, 13);
    let idOnlyResult;
    for (const question of idOnlyQuestions) {
      idOnlyResult = await examApi.saveAnswer(started.sessionId, {
        questionId: question.id,
        selectedOptionIds: [question.options[1].id],
      });
    }
    const mismatched = started.questions[13];
    idOnlyResult = await examApi.saveAnswer(started.sessionId, {
      questionId: mismatched.id,
      questionIndex: 0,
      selectedOptionIds: [mismatched.options[2].id],
    });
    for (const question of idOnlyQuestions) {
      assert(
        idOnlyResult.responses?.[question.id]?.[0] === question.options[1].id,
        `Answer sent without questionIndex was not stored under ${question.id}.`
      );
    }
    assert(
      idOnlyResult.responses?.[mismatched.id]?.[0] === mismatched.options[2].id,
      'Question ID must win over a conflicting questionIndex.'
    );
    const firstQuestion = started.questions[0];
    const firstExpected =
      firstQuestion.type === 'multi'
        ? firstQuestion.options.slice(0, 2).map((item) => item.id)
        : [firstQuestion.options[0].id];
    assert(
      JSON.stringify(idOnlyResult.responses?.[firstQuestion.id]) === JSON.stringify(firstExpected),
      'A conflicting questionIndex overwrote question 1.'
    );
    printStep('Answers are stored under the question ID, with or without an index');

    await examApi.saveFlag(started.sessionId, {
      questionId: targetQuestions[0].id,
      questionIndex: 0,
      flagged: true,
    });

    await requestJson(baseUrl, `/api/exam/${started.sessionId}/proctor`, {
      method: 'POST',
      headers: withStudentHeaders(reloginPayload.token),
      body: JSON.stringify({
        type: 'window_blur',
        detail: 'legacy request without content-type header',
      }),
    });
    printStep('Legacy proctor payload (no content-type) accepted');

    await requestJsonExpectError(
      baseUrl,
      `/api/exam/${started.sessionId}/proctor`,
      400,
      'violation type is required',
      {
        method: 'POST',
        headers: withStudentHeaders(reloginPayload.token),
        json: { detail: 'missing type test' },
      }
    );

    await examApi.logProctor(started.sessionId, {
      type: 'tab_switch',
      detail: 'smoke test event',
    });
    printStep('Flag + proctor logging passed');

    // Regression guard: an in-progress attempt must never expose a score. Previously the dashboard
    // and trial endpoints returned a live correctCount, which let students discover answers.
    const midExamDashboard = await examApi.fetchMe();
    const midExamTrial = (midExamDashboard.trials ?? []).find((row) => row.id === started.sessionId);
    assert(midExamTrial, 'Active trial missing from dashboard.');
    assert(midExamTrial.summary === null, 'Dashboard must not expose a score for an active attempt.');
    assert(midExamTrial.progress?.answeredCount >= 1, 'Active trial should report answered progress.');
    const midExamTrials = await examApi.listTrials();
    assert(
      (midExamTrials.trials ?? []).every((row) => row.status !== 'active' || row.summary === null),
      '/api/student/trials must not expose a score for an active attempt.'
    );
    const midExamTrialDetail = await examApi.getTrial(started.sessionId);
    assert(midExamTrialDetail.trial.summary === null, 'Trial detail must not expose a score mid-exam.');
    await requestJsonExpectError(
      baseUrl,
      `/api/student/trials/${encodeURIComponent(started.sessionId)}/report-card`,
      409,
      'after the exam is submitted',
      { method: 'GET', headers: withStudentHeaders(reloginPayload.token) }
    );
    await requestJsonExpectError(baseUrl, '/api/exam/start', 409, 'already have an active trial', {
      method: 'POST',
      headers: withStudentHeaders(reloginPayload.token),
      json: { examId: selectedExam.id },
    });
    printStep('No score is exposed while the exam is in progress');

    const preSubmitFeedback = await requestJsonExpectError(
      baseUrl,
      `/api/exam/${started.sessionId}/feedback`,
      409,
      'after submitting',
      {
        method: 'POST',
        headers: withStudentHeaders(reloginPayload.token),
        json: { rating: 3, comment: 'pre-submit feedback should be blocked' },
      }
    );
    assert(
      typeof preSubmitFeedback?.session?.sessionId === 'string',
      '409 feedback response should include current session payload.'
    );
    printStep('Pre-submit feedback conflict is returned with session payload');

    const submitted = await examApi.submit(started.sessionId);
    assert(submitted?.session?.submittedAt, 'Submit did not return submitted session.');
    printStep('Submit passed');

    await examApi.saveFeedback(started.sessionId, {
      rating: 4,
      comment: 'Smoke test feedback',
    });
    printStep('Feedback save passed');

    const studentReportCard = await requestText(
      baseUrl,
      `/api/student/trials/${encodeURIComponent(started.sessionId)}/report-card`,
      {
        method: 'GET',
        headers: withStudentHeaders(reloginPayload.token),
      }
    );
    assert(
      studentReportCard.body.includes(started.sessionId),
      'Student report card should include session ID.'
    );
    assert(
      studentReportCard.body.toLowerCase().includes('final score'),
      'Student report card should include score summary.'
    );
    printStep('Student report card download endpoint passed');

    const trials = await examApi.listTrials();
    assert(Array.isArray(trials.trials) && trials.trials.length >= 1, 'No student trials returned.');

    const trial = await examApi.getTrial(started.sessionId);
    assert(Array.isArray(trial?.trial?.questionReview), 'Question review missing from trial response.');
    printStep('Student trials endpoints passed');

    const adminLoginPayload = await requestJson(baseUrl, '/api/admin/login', {
      method: 'POST',
      json: { passcode: smokeAdminPasscode },
    });
    assert(
      typeof adminLoginPayload?.token === 'string' && adminLoginPayload.token.length > 10,
      'Admin login token missing.'
    );
    const adminApi = buildAdminApi(baseUrl, adminLoginPayload.token);
    printStep('Admin login passed');

    const brandingBefore = await adminApi.fetchBranding();
    assert(brandingBefore?.branding?.schoolName, 'Admin branding fetch did not return school name.');

    const brandingName = `Smoke Academy ${timestamp}`;
    const brandingLogo = 'https://example.com/smoke-logo.png';
    const brandingAfter = await adminApi.updateBranding({
      schoolName: brandingName,
      logoUrl: brandingLogo,
    });
    assert(
      brandingAfter?.branding?.schoolName === brandingName,
      'Admin branding school name did not update.'
    );
    assert(brandingAfter?.branding?.logoUrl === brandingLogo, 'Admin branding logo URL did not update.');

    const metaAfterBranding = await requestJson(baseUrl, '/api/exam/meta', { method: 'GET' });
    assert(metaAfterBranding?.schoolName === brandingName, 'Meta schoolName should reflect branding update.');

    const adminReportCard = await adminApi.downloadSessionReportCard(started.sessionId);
    assert(adminReportCard.body.includes(brandingName), 'Admin report card should include updated school name.');
    assert(adminReportCard.body.includes(started.sessionId), 'Admin report card should include session ID.');
    printStep('Admin branding + report card endpoints passed');

    const usersPayload = await adminApi.fetchUsers({ search: username });
    const matchedUser = (usersPayload?.users ?? []).find((row) => row.username === username);
    assert(matchedUser?.id, 'Admin users list did not include smoke student.');

    const adminResetPassword = `${newPassword}x`;
    const resetPayload = await adminApi.resetUserPassword(matchedUser.id, {
      newPassword: adminResetPassword,
      mustChangePassword: true,
    });
    assert(resetPayload?.user?.mustChangePassword === true, 'Admin reset should force password change.');

    await requestJsonExpectError(baseUrl, '/api/student/me', 401, 'invalid or expired student token', {
      method: 'GET',
      headers: withStudentHeaders(reloginPayload.token),
    });

    await requestJsonExpectError(
      baseUrl,
      '/api/student/login',
      401,
      'password is not right',
      {
        method: 'POST',
        json: { identifier: username, password: newPassword },
      }
    );

    const postResetLogin = await requestJson(baseUrl, '/api/student/login', {
      method: 'POST',
      json: { identifier: username, password: adminResetPassword },
    });
    assert(postResetLogin?.user?.mustChangePassword === true, 'Post-reset login should require password change.');
    printStep('Admin password reset flow passed');

    const adminHeaders = withAdminHeaders(adminLoginPayload.token);
    const createdQuestion = await requestJson(baseUrl, '/api/admin/questions', {
      method: 'POST',
      headers: adminHeaders,
      json: {
        sourceExamId: 'general',
        topic: 'general',
        type: 'single',
        text: 'Smoke question: which key confirms a dialog?',
        optionTexts: ['Enter', 'Shift', 'Tab', 'Alt'],
        correctOptionIds: ['A'],
      },
    });
    const questionId = createdQuestion?.question?.id;
    assert(questionId, 'Admin question create failed.');
    const editedQuestion = await requestJson(baseUrl, `/api/admin/questions/${questionId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      json: { text: 'Smoke question (edited): which key confirms a dialog?', correctOptionIds: ['A'] },
    });
    assert(editedQuestion?.question?.text?.includes('(edited)'), 'Admin question edit failed.');
    await requestJson(baseUrl, `/api/admin/questions/${questionId}`, { method: 'DELETE', headers: adminHeaders });
    await requestJsonExpectError(baseUrl, `/api/admin/questions/${questionId}`, 404, 'not found', {
      method: 'DELETE',
      headers: adminHeaders,
    });
    await requestJsonExpectError(baseUrl, '/api/admin/exams/general', 400, 'cannot be deleted', {
      method: 'DELETE',
      headers: adminHeaders,
    });
    printStep('Admin question create/edit/delete passed');

    await requestJson(baseUrl, '/api/student/logout', {
      method: 'POST',
      headers: withStudentHeaders(postResetLogin.token),
    });
    await requestJsonExpectError(baseUrl, '/api/student/me', 401, 'invalid or expired', {
      method: 'GET',
      headers: withStudentHeaders(postResetLogin.token),
    });
    await requestJson(baseUrl, '/api/admin/logout', { method: 'POST', headers: adminHeaders });
    await requestJsonExpectError(baseUrl, '/api/admin/overview', 401, 'invalid or expired', {
      method: 'GET',
      headers: adminHeaders,
    });
    await requestJsonExpectError(baseUrl, '/api/does-not-exist', 404, 'not found', { method: 'GET' });
    printStep('Logout revokes tokens server-side; unknown API routes return JSON 404');

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

    const savedGeneralFeedback = await db.collection('student_general_feedback').findOne({ userId: matchedUser.id });
    assert(savedGeneralFeedback, 'General dashboard feedback not found in MongoDB.');
    assert(
      (savedGeneralFeedback.comment ?? '').includes('Dashboard feedback from smoke test'),
      'General dashboard feedback comment not persisted.'
    );

    const brandingSettingsRow = await db.collection('settings').findOne({ key: 'branding' });
    assert(
      brandingSettingsRow?.value?.schoolName?.startsWith('Smoke Academy '),
      'Branding settings were not persisted.'
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

    await stopServer();
  }
}

await main();
