const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function apiRequest(path, options = {}) {
  const hasBody = options.body !== undefined && options.body !== null;
  const headers = new Headers(options.headers ?? {});
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Exam saves pass `timeoutMs` so a request that hangs on bad Wi-Fi is abandoned and retried
  // instead of blocking every save behind it.
  const { timeoutMs, ...fetchOptions } = options;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller?.signal,
    });
  } catch {
    clearTimeout(timer);
    const error = new Error("Can't reach the exam server. Check your connection and try again.");
    error.status = 0;
    error.isNetworkError = true;
    throw error;
  }

  clearTimeout(timer);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({ error: 'Unexpected server response.' }))
    : { error: response.status >= 500 ? 'The server had a problem. Please try again.' : 'Unexpected server response.' };

  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  return payload;
}

function withAdminHeaders(token, headers = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
}

function withStudentHeaders(token, headers = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
}

export function fetchMeta() {
  return apiRequest('/api/exam/meta');
}

export function studentLogin(payload) {
  return apiRequest('/api/student/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function studentRegister(payload) {
  return apiRequest('/api/student/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchStudentMe(token) {
  return apiRequest('/api/student/me', {
    headers: withStudentHeaders(token),
  });
}

export function changeStudentPassword(token, payload) {
  return apiRequest('/api/student/change-password', {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function requestStudentPasswordHelp(payload) {
  return apiRequest('/api/student/password-help', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveStudentGeneralFeedback(token, payload) {
  return apiRequest('/api/student/feedback', {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchStudentTrials(token) {
  return apiRequest('/api/student/trials', {
    headers: withStudentHeaders(token),
  });
}

export function fetchStudentTrial(token, sessionId) {
  return apiRequest(`/api/student/trials/${encodeURIComponent(sessionId)}`, {
    headers: withStudentHeaders(token),
  });
}

export async function downloadStudentTrialReportCard(token, sessionId, downloadName) {
  const response = await fetch(
    `${API_BASE}/api/student/trials/${encodeURIComponent(sessionId)}/report-card`,
    {
      headers: withStudentHeaders(token),
    }
  );

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function startSession(token, data) {
  return apiRequest('/api/exam/start', {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify(data),
  });
}

export function fetchSession(token, sessionId) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}`, {
    headers: withStudentHeaders(token),
  });
}

export function markSeen(token, sessionId, questionId, questionIndex = null) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/seen`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ questionId, questionIndex }),
  });
}

export function saveAnswer(token, sessionId, questionId, selectedOptionIds, questionIndex = null) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/answer`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ questionId, selectedOptionIds, questionIndex }),
  });
}

export function saveFlag(token, sessionId, questionId, flagged, questionIndex = null) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/flag`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ questionId, flagged, questionIndex }),
  });
}

export function logViolation(token, sessionId, type, detail, evidence = {}) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/proctor`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ type, detail, evidence }),
    timeoutMs: 15_000,
  });
}

/** Spends a hint on a question (free if that question's hint is already revealed). */
export function requestHint(token, sessionId, questionId) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/hint`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ questionId }),
    timeoutMs: 15_000,
  });
}

/** Saves several answers at once: { questionId: answer }. */
export function saveAnswersBatch(token, sessionId, answers) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/answers`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ answers }),
    timeoutMs: 15_000,
  });
}

/** Submits the exam, carrying any answers the server has not confirmed yet. */
export function submitExam(token, sessionId, answers = {}) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/submit`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify({ answers }),
    timeoutMs: 20_000,
  });
}

export function disputeViolation(token, sessionId, violationId, payload) {
  return apiRequest(
    `/api/student/trials/${encodeURIComponent(sessionId)}/violations/${encodeURIComponent(violationId)}/dispute`,
    {
      method: 'POST',
      headers: withStudentHeaders(token),
      body: JSON.stringify(payload),
    }
  );
}

export function saveExamFeedback(token, sessionId, payload) {
  return apiRequest(`/api/exam/${encodeURIComponent(sessionId)}/feedback`, {
    method: 'POST',
    headers: withStudentHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function adminLogin(passcode) {
  return apiRequest('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export function fetchAdminOverview(token) {
  return apiRequest('/api/admin/overview', {
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminBrandingSettings(token) {
  return apiRequest('/api/admin/settings/branding', {
    headers: withAdminHeaders(token),
  });
}

export function updateAdminBrandingSettings(token, payload) {
  return apiRequest('/api/admin/settings/branding', {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchAdminSessions(
  token,
  { search = '', classRoom = '', status = '', examId = '' } = {}
) {
  const params = new URLSearchParams();
  if (search) {
    params.set('search', search);
  }
  if (classRoom) {
    params.set('classRoom', classRoom);
  }
  if (status) {
    params.set('status', status);
  }
  if (examId) {
    params.set('examId', examId);
  }

  const queryString = params.toString();
  return apiRequest(`/api/admin/sessions${queryString ? `?${queryString}` : ''}`, {
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminSession(token, sessionId) {
  return apiRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    headers: withAdminHeaders(token),
  });
}

export async function downloadAdminSessionReportCard(token, sessionId, downloadName) {
  const response = await fetch(
    `${API_BASE}/api/admin/sessions/${encodeURIComponent(sessionId)}/report-card`,
    {
      headers: withAdminHeaders(token),
    }
  );

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function waiveAdminSessionViolations(token, sessionId, payload) {
  return apiRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/violations/waive`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchAdminStudents(
  token,
  { search = '', classRoom = '', examId = '' } = {}
) {
  const params = new URLSearchParams();
  if (search) {
    params.set('search', search);
  }
  if (classRoom) {
    params.set('classRoom', classRoom);
  }
  if (examId) {
    params.set('examId', examId);
  }

  const queryString = params.toString();
  return apiRequest(`/api/admin/students${queryString ? `?${queryString}` : ''}`, {
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminStudentTrials(token, studentKey) {
  return apiRequest(`/api/admin/students/${encodeURIComponent(studentKey)}/trials`, {
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminUsers(
  token,
  { search = '', classRoom = '', status = '' } = {}
) {
  const params = new URLSearchParams();
  if (search) {
    params.set('search', search);
  }
  if (classRoom) {
    params.set('classRoom', classRoom);
  }
  if (status) {
    params.set('status', status);
  }

  const queryString = params.toString();
  return apiRequest(`/api/admin/users${queryString ? `?${queryString}` : ''}`, {
    headers: withAdminHeaders(token),
  });
}

export function updateAdminUser(token, userId, payload) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function resetAdminUserPassword(token, userId, payload) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    method: 'POST',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchAdminPasswordHelp(token, { search = '', status = 'open' } = {}) {
  const params = new URLSearchParams();
  if (search) {
    params.set('search', search);
  }
  if (status) {
    params.set('status', status);
  }

  const queryString = params.toString();
  return apiRequest(`/api/admin/password-help${queryString ? `?${queryString}` : ''}`, {
    headers: withAdminHeaders(token),
  });
}

export function resolveAdminPasswordHelp(token, requestId) {
  return apiRequest(`/api/admin/password-help/${encodeURIComponent(requestId)}/resolve`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminExams(token) {
  return apiRequest('/api/admin/exams', {
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminExam(token, examId) {
  return apiRequest(`/api/admin/exams/${encodeURIComponent(examId)}`, {
    headers: withAdminHeaders(token),
  });
}

export function createAdminExam(token, payload) {
  return apiRequest('/api/admin/exams', {
    method: 'POST',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateAdminExam(token, examId, payload) {
  return apiRequest(`/api/admin/exams/${encodeURIComponent(examId)}`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchAdminQuestions(token) {
  return apiRequest('/api/admin/questions', {
    headers: withAdminHeaders(token),
  });
}

export function deleteAdminSession(token, sessionId) {
  return apiRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: withAdminHeaders(token),
  });
}

export async function deleteAdminSessions(token, sessionIds) {
  const uniqueIds = Array.isArray(sessionIds)
    ? [...new Set(sessionIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    : [];

  if (!uniqueIds.length) {
    const error = new Error('Select at least one session to delete.');
    error.status = 400;
    throw error;
  }

  try {
    return await apiRequest('/api/admin/sessions', {
      method: 'DELETE',
      headers: withAdminHeaders(token),
      body: JSON.stringify({ sessionIds: uniqueIds }),
    });
  } catch (error) {
    if (![404, 405, 501].includes(error?.status)) {
      throw error;
    }
  }

  try {
    return await apiRequest('/api/admin/sessions/delete-selected', {
      method: 'POST',
      headers: withAdminHeaders(token),
      body: JSON.stringify({ sessionIds: uniqueIds }),
    });
  } catch (error) {
    if (![404, 405, 501].includes(error?.status)) {
      throw error;
    }
  }

  const results = await Promise.allSettled(uniqueIds.map((sessionId) => deleteAdminSession(token, sessionId)));
  const deletedCount = results.filter((item) => item.status === 'fulfilled').length;
  const failedIds = results
    .map((item, index) => (item.status === 'rejected' ? uniqueIds[index] : null))
    .filter(Boolean);

  if (deletedCount === 0) {
    throw new Error('Could not delete selected sessions. Try individual delete or refresh.');
  }

  return {
    ok: true,
    deletedCount,
    requestedCount: uniqueIds.length,
    failedIds,
  };
}

export function purgeAdminSessions(token, scope) {
  return apiRequest('/api/admin/sessions/purge', {
    method: 'POST',
    headers: withAdminHeaders(token),
    body: JSON.stringify({ scope }),
  });
}

export function createAdminQuestion(token, payload) {
  return apiRequest('/api/admin/questions', {
    method: 'POST',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function downloadAdminExport(token, path, downloadName) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: withAdminHeaders(token),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Ignore response parsing errors for failed download responses.
    }

    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

// Server-side sign-out: revokes the token so it can't be reused on a shared lab computer.
// Best effort — the client clears its own copy regardless of the outcome.
export function studentLogout(token) {
  return apiRequest('/api/student/logout', {
    method: 'POST',
    headers: withStudentHeaders(token),
  });
}

export function adminLogout(token) {
  return apiRequest('/api/admin/logout', {
    method: 'POST',
    headers: withAdminHeaders(token),
  });
}

export function updateAdminQuestion(token, questionId, payload) {
  return apiRequest(`/api/admin/questions/${encodeURIComponent(questionId)}`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteAdminQuestion(token, questionId) {
  return apiRequest(`/api/admin/questions/${encodeURIComponent(questionId)}`, {
    method: 'DELETE',
    headers: withAdminHeaders(token),
  });
}

export function deleteAdminExam(token, examId) {
  return apiRequest(`/api/admin/exams/${encodeURIComponent(examId)}`, {
    method: 'DELETE',
    headers: withAdminHeaders(token),
  });
}

export function fetchAdminDisputes(token, status = 'open') {
  return apiRequest(`/api/admin/disputes?status=${encodeURIComponent(status)}`, {
    headers: withAdminHeaders(token),
  });
}

export function resolveAdminDispute(token, sessionId, violationId, payload) {
  return apiRequest(
    `/api/admin/sessions/${encodeURIComponent(sessionId)}/violations/${encodeURIComponent(violationId)}/dispute`,
    {
      method: 'PATCH',
      headers: withAdminHeaders(token),
      body: JSON.stringify(payload),
    }
  );
}

/** Overrides the automatic mark for one question; `correct: null` restores it. */
export function setAdminGrade(token, sessionId, questionId, correct) {
  return apiRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/grades`, {
    method: 'PATCH',
    headers: withAdminHeaders(token),
    body: JSON.stringify({ questionId, correct }),
  });
}

/** Downloads a printable HTML document produced by a POST endpoint (bulk report cards, result sheet). */
export async function downloadAdminPrintout(token, path, body, downloadName) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: withAdminHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
