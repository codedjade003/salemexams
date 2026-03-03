import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  adminLogin,
  createAdminExam,
  createAdminQuestion,
  deleteAdminSession,
  deleteAdminSessions,
  downloadAdminExport,
  fetchAdminExams,
  fetchAdminPasswordHelp,
  fetchAdminStudentTrials,
  fetchAdminStudents,
  fetchAdminOverview,
  fetchAdminQuestions,
  fetchAdminSessions,
  fetchAdminUsers,
  fetchMeta,
  purgeAdminSessions,
  resetAdminUserPassword,
  resolveAdminPasswordHelp,
  updateAdminUser,
  updateAdminExam,
  waiveAdminSessionViolations,
} from './api';

const ADMIN_TOKEN_KEY = 'salem_admin_token';
const ADMIN_TOKEN_EXPIRES_KEY = 'salem_admin_token_expires_at';
const ADMIN_WIDGETS_KEY = 'salem_admin_widgets';

const TOPIC_OPTIONS = ['basics', 'internet', 'web', 'coding', 'navigation', 'vscode', 'general'];

const DEFAULT_WIDGETS = {
  summaryCards: true,
  scoreDistribution: true,
  violationTypes: true,
  classPerformance: true,
  recentSubmissions: true,
  outstandingStudents: true,
  classLeaderboards: true,
  exportCenter: true,
  candidateSessions: true,
  studentTrials: true,
  userManager: true,
  passwordHelp: true,
  examManager: true,
  questionManager: true,
};

const ANALYTICS_WIDGET_KEYS = [
  'summaryCards',
  'scoreDistribution',
  'violationTypes',
  'classPerformance',
  'recentSubmissions',
  'outstandingStudents',
  'classLeaderboards',
];

const CORE_WIDGET_PRESET = {
  summaryCards: true,
  scoreDistribution: true,
  violationTypes: false,
  classPerformance: true,
  recentSubmissions: true,
  outstandingStudents: true,
  classLeaderboards: false,
  exportCenter: true,
  candidateSessions: true,
  studentTrials: true,
  userManager: true,
  passwordHelp: true,
  examManager: true,
  questionManager: false,
};

const WIDGET_LABELS = {
  summaryCards: 'Summary cards',
  scoreDistribution: 'Score distribution',
  violationTypes: 'Violation types',
  classPerformance: 'Class performance',
  recentSubmissions: 'Recent submissions',
  outstandingStudents: 'Outstanding students',
  classLeaderboards: 'Class leaderboards',
  exportCenter: 'Export center',
  candidateSessions: 'Candidate sessions',
  studentTrials: 'Student trials',
  userManager: 'User manager',
  passwordHelp: 'Password help',
  examManager: 'Exam manager',
  questionManager: 'Question manager',
};

const PURGE_LABELS = {
  submitted: 'submitted sessions',
  active: 'active sessions',
  time_up: 'timed-out sessions',
  all: 'all sessions',
};

const PAGE_SIZE = {
  sessions: 20,
  students: 15,
  users: 12,
  passwordHelp: 12,
  questions: 25,
  exams: 10,
};

const EMPTY_QUESTION_FORM = {
  topic: 'general',
  type: 'single',
  text: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctA: true,
  correctB: false,
  correctC: false,
  correctD: false,
};

const EMPTY_EXAM_FORM = {
  id: '',
  title: '',
  description: '',
  durationSeconds: 1500,
  maxAttempts: 3,
  questionCount: 40,
  published: true,
  allowedClasses: [],
  deductRightClick: false,
  deductRestrictedKey: false,
};

const EMPTY_EXAM_QUESTION_FORM = {
  topic: 'general',
  type: 'single',
  text: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctA: true,
  correctB: false,
  correctC: false,
  correctD: false,
};

function formatDate(value) {
  if (!value) {
    return '-';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return '-';
  }
}

function percentBarValue(value, max) {
  if (!max || max <= 0) {
    return 0;
  }

  return Math.max(4, Math.round((value / max) * 100));
}

function loadStoredWidgets() {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_WIDGETS };
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_WIDGETS_KEY);
    if (!raw) {
      return { ...DEFAULT_WIDGETS };
    }

    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WIDGETS, ...parsed };
  } catch {
    return { ...DEFAULT_WIDGETS };
  }
}

function pageCount(totalItems, pageSize) {
  if (!totalItems || totalItems <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(totalItems / pageSize));
}

function getPagedRows(rows, currentPage, size) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalPages = pageCount(safeRows.length, size);
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const start = (page - 1) * size;
  const end = start + size;

  return {
    page,
    totalPages,
    rows: safeRows.slice(start, end),
    start: safeRows.length ? start + 1 : 0,
    end: Math.min(end, safeRows.length),
    total: safeRows.length,
  };
}

function PaginationControls({
  page,
  totalPages,
  start,
  end,
  total,
  label,
  onPrev,
  onNext,
}) {
  return (
    <div className="pagination-row">
      <p className="muted">
        {total > 0 ? `Showing ${start}-${end} of ${total} ${label}` : `No ${label}`}
      </p>

      {totalPages > 1 && (
        <div className="pagination-controls">
          <span className="pagination-chip">
            Page {page} / {totalPages}
          </span>
          <button type="button" className="btn btn-outline btn-xs" onClick={onPrev} disabled={page <= 1}>
            Prev
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={onNext}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function AdminPage() {
  const [meta, setMeta] = useState(null);
  const [token, setToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
  const [passcode, setPasscode] = useState('');
  const [widgets, setWidgets] = useState(loadStoredWidgets);
  const [selectedSessionIds, setSelectedSessionIds] = useState([]);

  const [overview, setOverview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [users, setUsers] = useState([]);
  const [passwordHelpRequests, setPasswordHelpRequests] = useState([]);
  const [studentTrials, setStudentTrials] = useState(null);
  const [studentTrialLoading, setStudentTrialLoading] = useState(false);
  const [trialReviewOpen, setTrialReviewOpen] = useState(false);
  const [trialSelectedViolations, setTrialSelectedViolations] = useState({});

  const [filters, setFilters] = useState({ search: '', classRoom: '', status: '', examId: '' });
  const [studentFilters, setStudentFilters] = useState({ search: '', classRoom: '', examId: '' });
  const [userFilters, setUserFilters] = useState({ search: '', classRoom: '', status: '' });
  const [helpFilters, setHelpFilters] = useState({ search: '', status: 'open' });
  const [userPasswordDrafts, setUserPasswordDrafts] = useState({});
  const [pages, setPages] = useState({
    sessions: 1,
    students: 1,
    users: 1,
    passwordHelp: 1,
    questions: 1,
    exams: 1,
  });

  const [questionForm, setQuestionForm] = useState(EMPTY_QUESTION_FORM);
  const [examForm, setExamForm] = useState(EMPTY_EXAM_FORM);
  const [examQuestionForm, setExamQuestionForm] = useState(EMPTY_EXAM_QUESTION_FORM);
  const [examQuestionDrafts, setExamQuestionDrafts] = useState([]);
  const [generalExamEdit, setGeneralExamEdit] = useState({
    title: '',
    durationSeconds: 1500,
    maxAttempts: 3,
    questionCount: 40,
    published: true,
    allowedClasses: [],
    deductRightClick: false,
    deductRestrictedKey: false,
  });

  const [loading, setLoading] = useState({
    login: false,
    overview: false,
    sessions: false,
    questions: false,
    exams: false,
    students: false,
    users: false,
    passwordHelp: false,
    addQuestion: false,
    addExam: false,
    updateExam: false,
    deleting: false,
  });

  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const updateLoading = useCallback((field, value) => {
    setLoading((previous) => ({ ...previous, [field]: value }));
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_EXPIRES_KEY);
    setToken('');
    setTokenExpiresAt(0);
    setOverview(null);
    setSessions([]);
    setSelectedSessionIds([]);
    setQuestions([]);
    setExams([]);
    setStudents([]);
    setUsers([]);
    setPasswordHelpRequests([]);
    setUserPasswordDrafts({});
    setStudentTrials(null);
    setTrialReviewOpen(false);
    setTrialSelectedViolations({});
    setFilters({ search: '', classRoom: '', status: '', examId: '' });
    setStudentFilters({ search: '', classRoom: '', examId: '' });
    setUserFilters({ search: '', classRoom: '', status: '' });
    setHelpFilters({ search: '', status: 'open' });
  }, []);

  const handleUnauthorized = useCallback(
    (error) => {
      if (error?.status !== 401) {
        return false;
      }

      clearAuth();
      setErrorMessage('Your admin session has expired. Please login again.');
      return true;
    },
    [clearAuth]
  );

  const loadOverview = useCallback(
    async (activeToken) => {
      updateLoading('overview', true);
      try {
        const payload = await fetchAdminOverview(activeToken);
        setOverview(payload.overview);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load dashboard overview.');
        }
      } finally {
        updateLoading('overview', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadSessions = useCallback(
    async (activeToken, activeFilters) => {
      updateLoading('sessions', true);
      try {
        const payload = await fetchAdminSessions(activeToken, activeFilters);
        setSessions(payload.sessions ?? []);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load candidate sessions.');
        }
      } finally {
        updateLoading('sessions', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadQuestions = useCallback(
    async (activeToken) => {
      updateLoading('questions', true);
      try {
        const payload = await fetchAdminQuestions(activeToken);
        setQuestions(payload.questions ?? []);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load question pool.');
        }
      } finally {
        updateLoading('questions', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadExams = useCallback(
    async (activeToken) => {
      updateLoading('exams', true);
      try {
        const payload = await fetchAdminExams(activeToken);
        const rows = payload.exams ?? [];
        setExams(rows);

        const generalExam = rows.find((exam) => exam.id === 'general');
        if (generalExam) {
          setGeneralExamEdit({
            title: generalExam.title,
            durationSeconds: generalExam.durationSeconds,
            maxAttempts: generalExam.maxAttempts ?? 3,
            questionCount: generalExam.questionCount,
            published: generalExam.published,
            allowedClasses: generalExam.allowedClasses ?? [],
            deductRightClick: Boolean(generalExam.proctoring?.deductRightClick),
            deductRestrictedKey: Boolean(generalExam.proctoring?.deductRestrictedKey),
          });
        }
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load exams.');
        }
      } finally {
        updateLoading('exams', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadStudents = useCallback(
    async (activeToken, activeFilters) => {
      updateLoading('students', true);
      try {
        const payload = await fetchAdminStudents(activeToken, activeFilters);
        setStudents(payload.students ?? []);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load student trials.');
        }
      } finally {
        updateLoading('students', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadUsers = useCallback(
    async (activeToken, activeFilters) => {
      updateLoading('users', true);
      try {
        const payload = await fetchAdminUsers(activeToken, activeFilters);
        setUsers(payload.users ?? []);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load users.');
        }
      } finally {
        updateLoading('users', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  const loadPasswordHelp = useCallback(
    async (activeToken, activeFilters) => {
      updateLoading('passwordHelp', true);
      try {
        const payload = await fetchAdminPasswordHelp(activeToken, activeFilters);
        setPasswordHelpRequests(payload.requests ?? []);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load password-help requests.');
        }
      } finally {
        updateLoading('passwordHelp', false);
      }
    },
    [handleUnauthorized, updateLoading]
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const metadata = await fetchMeta();
        if (!active) {
          return;
        }

        setMeta(metadata);
      } catch {
        if (active) {
          setErrorMessage('Could not load exam metadata.');
        }
      }

      const savedToken = localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
      const savedExpiresAt = Number(localStorage.getItem(ADMIN_TOKEN_EXPIRES_KEY) ?? '0');

      if (savedToken && Number.isFinite(savedExpiresAt) && savedExpiresAt > Date.now()) {
        if (!active) {
          return;
        }

        setToken(savedToken);
        setTokenExpiresAt(savedExpiresAt);
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadOverview(token);
    void loadQuestions(token);
    void loadExams(token);
  }, [loadExams, loadOverview, loadQuestions, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadSessions(token, filters);
    setPages((previous) => ({ ...previous, sessions: 1 }));
  }, [filters, loadSessions, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadStudents(token, studentFilters);
    setPages((previous) => ({ ...previous, students: 1 }));
  }, [loadStudents, studentFilters, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadUsers(token, userFilters);
    setPages((previous) => ({ ...previous, users: 1 }));
  }, [loadUsers, token, userFilters]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadPasswordHelp(token, helpFilters);
    setPages((previous) => ({ ...previous, passwordHelp: 1 }));
  }, [helpFilters, loadPasswordHelp, token]);

  useEffect(() => {
    if (!infoMessage) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setInfoMessage('');
    }, 3500);

    return () => clearTimeout(timeoutId);
  }, [infoMessage]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_WIDGETS_KEY, JSON.stringify(widgets));
    } catch {
      // ignore storage write errors
    }
  }, [widgets]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionIds([]);
      return;
    }

    const validIds = new Set(sessions.map((session) => session.id));
    setSelectedSessionIds((previous) => previous.filter((id) => validIds.has(id)));
  }, [sessions]);

  useEffect(() => {
    setPages((previous) => {
      const next = {
        ...previous,
        sessions: Math.min(previous.sessions, pageCount(sessions.length, PAGE_SIZE.sessions)),
        students: Math.min(previous.students, pageCount(students.length, PAGE_SIZE.students)),
        users: Math.min(previous.users, pageCount(users.length, PAGE_SIZE.users)),
        passwordHelp: Math.min(
          previous.passwordHelp,
          pageCount(passwordHelpRequests.length, PAGE_SIZE.passwordHelp)
        ),
        questions: Math.min(previous.questions, pageCount(questions.length, PAGE_SIZE.questions)),
        exams: Math.min(previous.exams, pageCount(exams.length, PAGE_SIZE.exams)),
      };

      const unchanged =
        next.sessions === previous.sessions &&
        next.students === previous.students &&
        next.users === previous.users &&
        next.passwordHelp === previous.passwordHelp &&
        next.questions === previous.questions &&
        next.exams === previous.exams;

      return unchanged ? previous : next;
    });
  }, [sessions.length, students.length, users.length, passwordHelpRequests.length, questions.length, exams.length]);

  useEffect(() => {
    const classOptions = meta?.classOptions ?? [];
    if (!classOptions.length) {
      return;
    }

    setExamForm((previous) => {
      if (previous.allowedClasses.length > 0) {
        return previous;
      }

      return {
        ...previous,
        allowedClasses: classOptions,
      };
    });
  }, [meta?.classOptions]);

  const handleLogin = async (event) => {
    event.preventDefault();

    setErrorMessage('');
    updateLoading('login', true);

    try {
      const payload = await adminLogin(passcode);
      localStorage.setItem(ADMIN_TOKEN_KEY, payload.token);
      localStorage.setItem(ADMIN_TOKEN_EXPIRES_KEY, String(payload.expiresAt));

      setToken(payload.token);
      setTokenExpiresAt(payload.expiresAt);
      setPasscode('');
      setInfoMessage('Admin login successful.');
    } catch (error) {
      setErrorMessage(error.message || 'Login failed.');
    } finally {
      updateLoading('login', false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    setInfoMessage('Logged out of admin dashboard.');
  };

  const handleRefreshAll = async () => {
    if (!token) {
      return;
    }

    setErrorMessage('');
    await Promise.all([
      loadOverview(token),
      loadSessions(token, filters),
      loadQuestions(token),
      loadExams(token),
      loadStudents(token, studentFilters),
      loadUsers(token, userFilters),
      loadPasswordHelp(token, helpFilters),
    ]);
    setInfoMessage('Dashboard refreshed.');
  };

  const handleExport = async (path, fileName) => {
    if (!token) {
      return;
    }

    setErrorMessage('');

    try {
      await downloadAdminExport(token, path, fileName);
      setInfoMessage(`${fileName} downloaded.`);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Export failed.');
      }
    }
  };

  const handleCreateQuestion = async (event) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const correctOptionIds = [
      questionForm.correctA ? 'A' : null,
      questionForm.correctB ? 'B' : null,
      questionForm.correctC ? 'C' : null,
      questionForm.correctD ? 'D' : null,
    ].filter(Boolean);

    const payload = {
      topic: questionForm.topic,
      type: questionForm.type,
      text: questionForm.text,
      optionTexts: [
        questionForm.optionA,
        questionForm.optionB,
        questionForm.optionC,
        questionForm.optionD,
      ],
      correctOptionIds,
    };

    updateLoading('addQuestion', true);
    setErrorMessage('');

    try {
      await createAdminQuestion(token, payload);
      setQuestionForm((previous) => ({
        ...EMPTY_QUESTION_FORM,
        topic: previous.topic,
        type: previous.type,
      }));

      await Promise.all([loadQuestions(token), loadOverview(token)]);
      setInfoMessage('New question added to pool.');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not add question.');
      }
    } finally {
      updateLoading('addQuestion', false);
    }
  };

  const toggleClassInList = useCallback((value, classRoom) => {
    const set = new Set(Array.isArray(value) ? value : []);
    if (set.has(classRoom)) {
      set.delete(classRoom);
    } else {
      set.add(classRoom);
    }

    return [...set];
  }, []);

  const mapQuestionFormToPayload = useCallback((form) => {
    const correctOptionIds = [
      form.correctA ? 'A' : null,
      form.correctB ? 'B' : null,
      form.correctC ? 'C' : null,
      form.correctD ? 'D' : null,
    ].filter(Boolean);

    return {
      topic: form.topic,
      type: form.type,
      text: form.text,
      optionTexts: [form.optionA, form.optionB, form.optionC, form.optionD],
      correctOptionIds,
    };
  }, []);

  const handleAddExamQuestionDraft = (event) => {
    event.preventDefault();

    const payload = mapQuestionFormToPayload(examQuestionForm);
    if (payload.text.trim().length < 5) {
      setErrorMessage('Draft question text must be at least 5 characters.');
      return;
    }

    if (payload.optionTexts.some((item) => item.trim().length === 0)) {
      setErrorMessage('Each draft question must have 4 options.');
      return;
    }

    if (payload.correctOptionIds.length === 0) {
      setErrorMessage('Select at least one correct option for draft question.');
      return;
    }

    if (payload.type === 'single' && payload.correctOptionIds.length !== 1) {
      setErrorMessage('Single-choice draft question must have one correct option.');
      return;
    }

    setExamQuestionDrafts((previous) => [...previous, payload]);
    setExamQuestionForm((previous) => ({
      ...EMPTY_EXAM_QUESTION_FORM,
      topic: previous.topic,
      type: previous.type,
    }));
    setInfoMessage('Draft question added to new exam.');
    setErrorMessage('');
  };

  const handleRemoveExamQuestionDraft = (index) => {
    setExamQuestionDrafts((previous) => previous.filter((_item, itemIndex) => itemIndex !== index));
  };

  const handleCreateExam = async (event) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    if (examQuestionDrafts.length === 0) {
      setErrorMessage('Add at least one draft question before creating an exam.');
      return;
    }

    if (examForm.allowedClasses.length === 0) {
      setErrorMessage('Select at least one class for the exam.');
      return;
    }

    updateLoading('addExam', true);
    setErrorMessage('');

    try {
      const payload = await createAdminExam(token, {
        id: examForm.id || undefined,
        title: examForm.title,
        description: examForm.description,
        durationSeconds: Number(examForm.durationSeconds),
        maxAttempts: Number(examForm.maxAttempts) || 3,
        questionCount: Number(examForm.questionCount) || examQuestionDrafts.length,
        published: Boolean(examForm.published),
        allowedClasses: examForm.allowedClasses,
        proctoring: {
          right_click: true,
          restricted_key: true,
          deductRightClick: Boolean(examForm.deductRightClick),
          deductRestrictedKey: Boolean(examForm.deductRestrictedKey),
        },
        questions: examQuestionDrafts,
      });

      setExamForm((previous) => ({
        ...EMPTY_EXAM_FORM,
        durationSeconds: previous.durationSeconds,
        maxAttempts: previous.maxAttempts,
        questionCount: previous.questionCount,
        deductRightClick: previous.deductRightClick,
        deductRestrictedKey: previous.deductRestrictedKey,
      }));
      setExamQuestionForm(EMPTY_EXAM_QUESTION_FORM);
      setExamQuestionDrafts([]);

      await Promise.all([
        loadExams(token),
        loadOverview(token),
        loadQuestions(token),
      ]);
      setInfoMessage(`Exam created: ${payload.exam?.title ?? 'New exam'}.`);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not create exam.');
      }
    } finally {
      updateLoading('addExam', false);
    }
  };

  const handleSaveGeneralExam = async (event) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    if (generalExamEdit.allowedClasses.length === 0) {
      setErrorMessage('General exam must allow at least one class.');
      return;
    }

    updateLoading('updateExam', true);
    setErrorMessage('');

    try {
      const payload = await updateAdminExam(token, 'general', {
        title: generalExamEdit.title,
        durationSeconds: Number(generalExamEdit.durationSeconds),
        maxAttempts: Number(generalExamEdit.maxAttempts) || 3,
        questionCount: Number(generalExamEdit.questionCount),
        published: Boolean(generalExamEdit.published),
        allowedClasses: generalExamEdit.allowedClasses,
        proctoring: {
          right_click: true,
          restricted_key: true,
          deductRightClick: Boolean(generalExamEdit.deductRightClick),
          deductRestrictedKey: Boolean(generalExamEdit.deductRestrictedKey),
        },
      });
      await Promise.all([loadExams(token), loadOverview(token)]);
      setInfoMessage(`Saved: ${payload.exam?.title ?? 'General exam'}.`);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not update general exam.');
      }
    } finally {
      updateLoading('updateExam', false);
    }
  };

  const handleOpenStudentTrials = useCallback(
    async (student) => {
      if (!token || !student?.studentKey) {
        return;
      }

      setStudentTrialLoading(true);
      setErrorMessage('');

      try {
        const payload = await fetchAdminStudentTrials(token, student.studentKey);
        setStudentTrials(payload);
        setTrialReviewOpen(true);
        setTrialSelectedViolations({});
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load student trials.');
        }
      } finally {
        setStudentTrialLoading(false);
      }
    },
    [handleUnauthorized, token]
  );

  const handleCloseStudentTrials = () => {
    setTrialReviewOpen(false);
    setStudentTrials(null);
    setTrialSelectedViolations({});
  };

  const handleToggleTrialViolation = (sessionId, violationId, checked) => {
    setTrialSelectedViolations((previous) => {
      const current = new Set(previous[sessionId] ?? []);
      if (checked) {
        current.add(violationId);
      } else {
        current.delete(violationId);
      }

      return {
        ...previous,
        [sessionId]: [...current],
      };
    });
  };

  const handleWaiveTrialViolations = async (sessionId, mode, waived) => {
    if (!token || !sessionId) {
      return;
    }

    const selectedIds = trialSelectedViolations[sessionId] ?? [];
    if (mode === 'selected' && selectedIds.length === 0) {
      setErrorMessage('Select at least one violation to update.');
      return;
    }

    updateLoading('deleting', true);
    setErrorMessage('');

    try {
      await waiveAdminSessionViolations(token, sessionId, {
        waiveAll: mode === 'all',
        violationIds: mode === 'selected' ? selectedIds : [],
        waived,
      });

      if (!studentTrials?.student?.studentKey) {
        return;
      }

      const refreshed = await fetchAdminStudentTrials(token, studentTrials.student.studentKey);
      setStudentTrials(refreshed);
      setTrialSelectedViolations((previous) => ({
        ...previous,
        [sessionId]: [],
      }));

      await Promise.all([
        refreshOverviewAndSessions(token),
        loadStudents(token, studentFilters),
      ]);
      setInfoMessage(`Violations updated for trial ${sessionId.slice(0, 8)}.`);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not update violations.');
      }
    } finally {
      updateLoading('deleting', false);
    }
  };

  const refreshOverviewAndSessions = useCallback(
    async (activeToken) => {
      if (!activeToken) {
        return;
      }

      await Promise.all([
        loadOverview(activeToken),
        loadSessions(activeToken, filters),
        loadStudents(activeToken, studentFilters),
        loadUsers(activeToken, userFilters),
        loadPasswordHelp(activeToken, helpFilters),
      ]);
    },
    [filters, helpFilters, loadOverview, loadPasswordHelp, loadSessions, loadStudents, loadUsers, studentFilters, userFilters]
  );

  const handleToggleWidget = useCallback((widgetKey) => {
    setWidgets((previous) => ({
      ...previous,
      [widgetKey]: !previous[widgetKey],
    }));
  }, []);

  const handleWidgetPreset = useCallback((preset) => {
    if (preset === 'all') {
      setWidgets({ ...DEFAULT_WIDGETS });
      return;
    }

    if (preset === 'core') {
      setWidgets({ ...CORE_WIDGET_PRESET });
      return;
    }

    if (preset === 'analytics-all') {
      setWidgets((previous) => {
        const next = { ...previous };
        for (const key of ANALYTICS_WIDGET_KEYS) {
          next[key] = true;
        }
        return next;
      });
      return;
    }

    if (preset === 'analytics-relevant') {
      setWidgets((previous) => ({
        ...previous,
        summaryCards: true,
        scoreDistribution: true,
        violationTypes: false,
        classPerformance: true,
        recentSubmissions: true,
      }));
    }
  }, []);

  const pagedSessions = useMemo(
    () => getPagedRows(sessions, pages.sessions, PAGE_SIZE.sessions),
    [pages.sessions, sessions]
  );
  const pagedStudents = useMemo(
    () => getPagedRows(students, pages.students, PAGE_SIZE.students),
    [pages.students, students]
  );
  const pagedUsers = useMemo(
    () => getPagedRows(users, pages.users, PAGE_SIZE.users),
    [pages.users, users]
  );
  const pagedPasswordHelp = useMemo(
    () => getPagedRows(passwordHelpRequests, pages.passwordHelp, PAGE_SIZE.passwordHelp),
    [pages.passwordHelp, passwordHelpRequests]
  );
  const pagedQuestions = useMemo(
    () => getPagedRows(questions, pages.questions, PAGE_SIZE.questions),
    [pages.questions, questions]
  );
  const pagedExams = useMemo(
    () => getPagedRows(exams, pages.exams, PAGE_SIZE.exams),
    [exams, pages.exams]
  );

  const handlePagePrevious = useCallback((key) => {
    setPages((previous) => ({
      ...previous,
      [key]: Math.max(1, (previous[key] ?? 1) - 1),
    }));
  }, []);

  const handlePageNext = useCallback((key, totalPages) => {
    setPages((previous) => ({
      ...previous,
      [key]: Math.min(totalPages, (previous[key] ?? 1) + 1),
    }));
  }, []);

  const visibleSessionIds = useMemo(
    () => pagedSessions.rows.map((session) => session.id),
    [pagedSessions.rows]
  );
  const visibleSessionIdSet = useMemo(() => new Set(visibleSessionIds), [visibleSessionIds]);
  const selectedVisibleCount = useMemo(
    () => selectedSessionIds.filter((id) => visibleSessionIdSet.has(id)).length,
    [selectedSessionIds, visibleSessionIdSet]
  );
  const allVisibleSelected = useMemo(
    () => visibleSessionIds.length > 0 && selectedVisibleCount === visibleSessionIds.length,
    [selectedVisibleCount, visibleSessionIds.length]
  );

  const handleToggleSessionSelection = useCallback((sessionId, checked) => {
    setSelectedSessionIds((previous) => {
      if (checked) {
        if (previous.includes(sessionId)) {
          return previous;
        }

        return [...previous, sessionId];
      }

      return previous.filter((id) => id !== sessionId);
    });
  }, []);

  const handleToggleAllVisible = useCallback(
    (checked) => {
      setSelectedSessionIds((previous) => {
        if (checked) {
          return [...new Set([...previous, ...visibleSessionIds])];
        }

        const visibleIdSet = new Set(visibleSessionIds);
        return previous.filter((id) => !visibleIdSet.has(id));
      });
    },
    [visibleSessionIds]
  );

  const handleDeleteSingleSession = useCallback(
    async (session) => {
      if (!token || !session?.id) {
        return;
      }

      const confirmed = window.confirm(
        `Delete session for ${session.studentName}? This action cannot be undone.`
      );
      if (!confirmed) {
        return;
      }

      setErrorMessage('');
      updateLoading('deleting', true);

      try {
        await deleteAdminSession(token, session.id);
        setSelectedSessionIds((previous) => previous.filter((id) => id !== session.id));
        await refreshOverviewAndSessions(token);
        setInfoMessage('Session deleted.');
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not delete session.');
        }
      } finally {
        updateLoading('deleting', false);
      }
    },
    [handleUnauthorized, refreshOverviewAndSessions, token, updateLoading]
  );

  const handleDeleteSelectedSessions = useCallback(async () => {
    if (!token) {
      return;
    }

    if (!selectedSessionIds.length) {
      setErrorMessage('Select at least one session to delete.');
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedSessionIds.length} selected session(s)? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage('');
    updateLoading('deleting', true);

    try {
      const payload = await deleteAdminSessions(token, selectedSessionIds);
      const failedIds = Array.isArray(payload.failedIds) ? payload.failedIds : [];
      setSelectedSessionIds(failedIds);
      await refreshOverviewAndSessions(token);
      const deletedCount = Number(payload.deletedCount ?? 0);
      const requestedCount = Number(payload.requestedCount ?? selectedSessionIds.length);
      if (failedIds.length > 0 || deletedCount < requestedCount) {
        setInfoMessage(
          `${deletedCount} selected session(s) deleted. ${Math.max(
            failedIds.length,
            requestedCount - deletedCount
          )} could not be deleted.`
        );
      } else {
        setInfoMessage(`${deletedCount} selected session(s) deleted.`);
      }
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not delete selected sessions.');
      }
    } finally {
      updateLoading('deleting', false);
    }
  }, [
    handleUnauthorized,
    refreshOverviewAndSessions,
    selectedSessionIds,
    token,
    updateLoading,
  ]);

  const handlePurgeSessions = useCallback(
    async (scope) => {
      if (!token) {
        return;
      }

      const label = PURGE_LABELS[scope] ?? 'sessions';
      const confirmed = window.confirm(`Purge ${label}? This action cannot be undone.`);
      if (!confirmed) {
        return;
      }

      setErrorMessage('');
      updateLoading('deleting', true);

      try {
        const payload = await purgeAdminSessions(token, scope);
        setSelectedSessionIds([]);
        await refreshOverviewAndSessions(token);
        setInfoMessage(`Purge complete: ${payload.deletedCount ?? 0} session(s) removed.`);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not purge sessions.');
        }
      } finally {
        updateLoading('deleting', false);
      }
    },
    [handleUnauthorized, refreshOverviewAndSessions, token, updateLoading]
  );

  const handleToggleUserDisabled = useCallback(
    async (user) => {
      if (!token || !user?.id) {
        return;
      }

      setErrorMessage('');
      updateLoading('users', true);
      try {
        const payload = await updateAdminUser(token, user.id, {
          disabled: !user.disabled,
        });
        await Promise.all([
          loadUsers(token, userFilters),
          loadPasswordHelp(token, helpFilters),
        ]);
        setInfoMessage(
          `${payload.user?.fullName ?? 'User'} ${payload.user?.disabled ? 'disabled' : 'enabled'}.`
        );
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not update user status.');
        }
      } finally {
        updateLoading('users', false);
      }
    },
    [
      handleUnauthorized,
      helpFilters,
      loadPasswordHelp,
      loadUsers,
      token,
      updateLoading,
      userFilters,
    ]
  );

  const handleForcePasswordChange = useCallback(
    async (user) => {
      if (!token || !user?.id) {
        return;
      }

      setErrorMessage('');
      updateLoading('users', true);
      try {
        await updateAdminUser(token, user.id, {
          mustChangePassword: !user.mustChangePassword,
        });
        await loadUsers(token, userFilters);
        setInfoMessage('Password-change flag updated.');
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not update password-change flag.');
        }
      } finally {
        updateLoading('users', false);
      }
    },
    [handleUnauthorized, loadUsers, token, updateLoading, userFilters]
  );

  const handleEditUser = useCallback(
    async (user) => {
      if (!token || !user?.id) {
        return;
      }

      const fullName = window.prompt('Full name', user.fullName ?? '');
      if (fullName === null) {
        return;
      }
      const classRoom = window.prompt('Class', user.classRoom ?? '');
      if (classRoom === null) {
        return;
      }
      const email = window.prompt('Email', user.email ?? '');
      if (email === null) {
        return;
      }

      setErrorMessage('');
      updateLoading('users', true);
      try {
        await updateAdminUser(token, user.id, { fullName, classRoom, email });
        await loadUsers(token, userFilters);
        setInfoMessage('User details updated.');
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not update user details.');
        }
      } finally {
        updateLoading('users', false);
      }
    },
    [handleUnauthorized, loadUsers, token, updateLoading, userFilters]
  );

  const handleResetUserPassword = useCallback(
    async (user) => {
      if (!token || !user?.id) {
        return;
      }

      const draftPassword = userPasswordDrafts[user.id] ?? '';
      if (!draftPassword || draftPassword.length < 4) {
        setErrorMessage('Enter a new password (at least 4 characters) for this user.');
        return;
      }

      setErrorMessage('');
      updateLoading('users', true);
      try {
        await resetAdminUserPassword(token, user.id, {
          newPassword: draftPassword,
          mustChangePassword: true,
        });
        setUserPasswordDrafts((previous) => ({ ...previous, [user.id]: '' }));
        await Promise.all([
          loadUsers(token, userFilters),
          loadPasswordHelp(token, helpFilters),
        ]);
        setInfoMessage(`Password reset for ${user.fullName}.`);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not reset user password.');
        }
      } finally {
        updateLoading('users', false);
      }
    },
    [
      handleUnauthorized,
      helpFilters,
      loadPasswordHelp,
      loadUsers,
      token,
      updateLoading,
      userFilters,
      userPasswordDrafts,
    ]
  );

  const handleResolveHelpRequest = useCallback(
    async (request) => {
      if (!token || !request?.id) {
        return;
      }

      setErrorMessage('');
      updateLoading('passwordHelp', true);
      try {
        await resolveAdminPasswordHelp(token, request.id);
        await loadPasswordHelp(token, helpFilters);
        setInfoMessage('Password-help request marked as resolved.');
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not resolve password-help request.');
        }
      } finally {
        updateLoading('passwordHelp', false);
      }
    },
    [handleUnauthorized, helpFilters, loadPasswordHelp, token, updateLoading]
  );

  const scoreDistribution = useMemo(
    () => overview?.scoreDistribution ?? [],
    [overview?.scoreDistribution]
  );
  const scoreDistributionMax = useMemo(
    () => Math.max(1, ...scoreDistribution.map((item) => item.count)),
    [scoreDistribution]
  );

  const violationBreakdown = useMemo(
    () => overview?.violationBreakdown ?? [],
    [overview?.violationBreakdown]
  );
  const violationMax = useMemo(
    () => Math.max(1, ...violationBreakdown.map((item) => item.count)),
    [violationBreakdown]
  );
  const visibleAnalyticsCount = useMemo(
    () => ANALYTICS_WIDGET_KEYS.filter((key) => widgets[key]).length,
    [widgets]
  );
  const showScoreAndViolation = widgets.scoreDistribution || widgets.violationTypes;
  const showClassAndRecent = widgets.classPerformance || widgets.recentSubmissions;

  if (!token) {
    return (
      <main className="center-screen">
        <div className="card-panel wide admin-login-card">
          <h1>Admin Dashboard Login</h1>
          <p className="muted">Open this page with `/admin` and use your admin passcode.</p>

          <form className="form-stack" onSubmit={handleLogin}>
            <label htmlFor="adminPasscode">Admin Passcode</label>
            <input
              id="adminPasscode"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              required
              placeholder="Enter admin passcode"
            />

            {errorMessage && <p className="error-text">{errorMessage}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading.login}>
              {loading.login ? 'Signing in...' : 'Login'}
            </button>
          </form>

          <div className="inline-actions">
            <a className="btn btn-outline" href="/">
              Go to Student Exam
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      {infoMessage && <div className="toast info">{infoMessage}</div>}
      {errorMessage && <div className="toast error">{errorMessage}</div>}

      <header className="admin-header">
        <div>
          <h1>Salem Exam Admin</h1>
          <p>
            Session expires: <strong>{formatDate(tokenExpiresAt)}</strong>
          </p>
          <p>
            Exam serves <strong>{meta?.questionCount ?? 40}</strong> questions per candidate.
          </p>
        </div>

        <div className="inline-actions">
          <button type="button" className="btn btn-outline" onClick={handleRefreshAll}>
            Refresh Data
          </button>
          <a className="btn btn-secondary" href="/">
            Student View
          </a>
          <button type="button" className="btn btn-danger" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>Dashboard Widget Controls</h2>
          <span className="muted">
            Visible analytics widgets: {visibleAnalyticsCount}/{ANALYTICS_WIDGET_KEYS.length}
          </span>
        </div>

        <div className="inline-actions">
          <button type="button" className="btn btn-outline" onClick={() => handleWidgetPreset('analytics-all')}>
            Show All Analytics
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleWidgetPreset('analytics-relevant')}
          >
            Relevant Analytics
          </button>
          <button type="button" className="btn btn-outline" onClick={() => handleWidgetPreset('core')}>
            Core View
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => handleWidgetPreset('all')}>
            Reset Defaults
          </button>
        </div>

        <div className="widget-grid">
          {Object.entries(WIDGET_LABELS).map(([widgetKey, label]) => (
            <label key={widgetKey} className={`widget-toggle ${widgets[widgetKey] ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(widgets[widgetKey])}
                onChange={() => handleToggleWidget(widgetKey)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      {widgets.summaryCards && (
      <section className="admin-cards-grid">
        <article className="result-box">
          <span>Total Candidates</span>
          <strong>{overview?.totals?.candidates ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Submitted</span>
          <strong>{overview?.totals?.submitted ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Active</span>
          <strong>{overview?.totals?.active ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Completion Rate</span>
          <strong>{overview?.totals?.completionRate ?? 0}%</strong>
        </article>
        <article className="result-box">
          <span>Avg Final Score</span>
          <strong>{overview?.totals?.averageScore ?? 0}%</strong>
        </article>
        <article className="result-box">
          <span>Avg Violations</span>
          <strong>{overview?.totals?.averageViolations ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Feedback Count</span>
          <strong>{overview?.totals?.feedbackCount ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Average Rating</span>
          <strong>{overview?.totals?.averageRating ?? 0}/5</strong>
        </article>
        <article className="result-box">
          <span>Unique Students</span>
          <strong>{overview?.totals?.uniqueStudents ?? 0}</strong>
        </article>
        <article className="result-box">
          <span>Repeat Candidates</span>
          <strong>{overview?.totals?.repeatCandidates ?? 0}</strong>
        </article>
      </section>
      )}

      {showScoreAndViolation && (
      <section className={`admin-grid-2 ${!widgets.scoreDistribution || !widgets.violationTypes ? 'single-column' : ''}`}>
        {widgets.scoreDistribution && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Score Distribution</h2>
            {loading.overview && <span className="muted">Loading...</span>}
          </div>

          <div className="chart-stack">
            {scoreDistribution.map((item) => (
              <div key={item.band} className="chart-row">
                <span className="chart-label">{item.band}</span>
                <div className="chart-track">
                  <div
                    className="chart-fill"
                    style={{ width: `${percentBarValue(item.count, scoreDistributionMax)}%` }}
                  />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>
        )}

        {widgets.violationTypes && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Violation Types</h2>
            {loading.overview && <span className="muted">Loading...</span>}
          </div>

          <div className="chart-stack">
            {violationBreakdown.length === 0 && <p className="muted">No violations logged yet.</p>}
            {violationBreakdown.map((item) => (
              <div key={item.type} className="chart-row">
                <span className="chart-label">{item.type}</span>
                <div className="chart-track">
                  <div
                    className="chart-fill warn"
                    style={{ width: `${percentBarValue(item.count, violationMax)}%` }}
                  />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>
        )}
      </section>
      )}

      {showClassAndRecent && (
      <section className={`admin-grid-2 ${!widgets.classPerformance || !widgets.recentSubmissions ? 'single-column' : ''}`}>
        {widgets.classPerformance && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Class Performance</h2>
          </div>

          <div className="table-wrap medium">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Candidates</th>
                  <th>Avg Score</th>
                  <th>Avg Violations</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.classPerformance ?? []).map((item) => (
                  <tr key={item.classRoom}>
                    <td>{item.classRoom}</td>
                    <td>{item.count}</td>
                    <td>{item.averageScore}%</td>
                    <td>{item.averageViolations}</td>
                  </tr>
                ))}
                {!overview?.classPerformance?.length && (
                  <tr>
                    <td colSpan={4}>No submitted sessions yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
        )}

        {widgets.recentSubmissions && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Recent Submissions</h2>
          </div>

          <div className="table-wrap medium">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Final</th>
                  <th>Violations</th>
                  <th>Rating</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentSubmissions ?? []).map((item) => (
                  <tr key={item.id}>
                    <td title={item.studentName}>
                      <span className="truncate-line">{item.studentName}</span>
                    </td>
                    <td title={item.classRoom}>
                      <span className="truncate-line">{item.classRoom}</span>
                    </td>
                    <td>{item.finalPercent}%</td>
                    <td>{item.violationsCount}</td>
                    <td>{item.feedbackRating ?? '-'}</td>
                    <td>{formatDate(item.submittedAt)}</td>
                  </tr>
                ))}
                {!overview?.recentSubmissions?.length && (
                  <tr>
                    <td colSpan={6}>No submissions yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
        )}
      </section>
      )}

      {(widgets.outstandingStudents || widgets.classLeaderboards) && (
      <section className={`admin-grid-2 ${!widgets.outstandingStudents || !widgets.classLeaderboards ? 'single-column' : ''}`}>
        {widgets.outstandingStudents && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Outstanding Students Overall</h2>
          </div>

          <div className="table-wrap medium">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Exam</th>
                  <th>Best %</th>
                  <th>Avg %</th>
                  <th>Trials</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.outstandingStudents ?? []).map((student) => (
                  <tr key={student.studentKey}>
                    <td title={student.studentName}>
                      <span className="truncate-line">{student.studentName}</span>
                    </td>
                    <td>{student.classRoom}</td>
                    <td title={student.bestExamTitle}>
                      <span className="truncate-line">{student.bestExamTitle ?? '-'}</span>
                    </td>
                    <td>{student.bestFinalPercent}%</td>
                    <td>{student.averageFinalPercent}%</td>
                    <td>{student.totalTrials}</td>
                  </tr>
                ))}
                {!overview?.outstandingStudents?.length && (
                  <tr>
                    <td colSpan={6}>No submitted trials yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
        )}

        {widgets.classLeaderboards && (
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Leaderboards Per Class</h2>
          </div>

          <div className="leaderboard-grid">
            {(overview?.classLeaderboards ?? []).map((item) => (
              <article key={item.classRoom} className="leaderboard-card">
                <h3>{item.classRoom}</h3>
                <ol>
                  {item.leaders.map((leader) => (
                    <li key={leader.studentKey}>
                      <span className="truncate-line">{leader.studentName}</span>
                      <strong>{leader.bestFinalPercent}%</strong>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
            {!overview?.classLeaderboards?.length && <p className="muted">No leaderboard data yet.</p>}
          </div>
        </article>
        )}
      </section>
      )}

      {widgets.exportCenter && (
      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>Export Center</h2>
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleExport('/api/admin/export/sessions.csv', 'sessions-export.csv')}
          >
            Export Sessions CSV
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleExport('/api/admin/export/sessions.json', 'sessions-export.json')}
          >
            Export Sessions JSON
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleExport('/api/admin/export/emails.csv', 'emails-only-export.csv')}
          >
            Export Emails Only CSV
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleExport('/api/admin/export/questions.csv', 'questions-export.csv')}
          >
            Export Questions CSV
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => handleExport('/api/admin/export/questions.json', 'questions-export.json')}
          >
            Export Questions JSON
          </button>
        </div>
      </section>
      )}

      {widgets.candidateSessions && (
      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>Candidate Sessions</h2>
          <span className="muted">{sessions.length} row(s)</span>
        </div>

        <div className="admin-action-row">
          <p className="muted">Selected: {selectedSessionIds.length}</p>
          <div className="inline-actions admin-action-buttons">
            <button
              type="button"
              className="btn btn-danger"
              disabled={loading.deleting || selectedSessionIds.length === 0}
              onClick={handleDeleteSelectedSessions}
            >
              {loading.deleting ? 'Working...' : 'Delete Selected'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={selectedSessionIds.length === 0 || loading.deleting}
              onClick={() => setSelectedSessionIds([])}
            >
              Clear Selection
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={loading.deleting}
              onClick={() => handlePurgeSessions('submitted')}
            >
              Purge Submitted
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={loading.deleting}
              onClick={() => handlePurgeSessions('time_up')}
            >
              Purge Timed-out
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={loading.deleting}
              onClick={() => handlePurgeSessions('active')}
            >
              Purge Active
            </button>
            <button
              type="button"
              className="btn btn-warning"
              disabled={loading.deleting}
              onClick={() => handlePurgeSessions('all')}
            >
              Purge All
            </button>
          </div>
        </div>

        <div className="admin-filters">
          <input
            type="search"
            placeholder="Search by name, email or session ID"
            value={filters.search}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, search: event.target.value }))
            }
          />

          <select
            value={filters.classRoom}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, classRoom: event.target.value }))
            }
          >
            <option value="">All classes</option>
            {(meta?.classOptions ?? []).map((classOption) => (
              <option key={classOption} value={classOption}>
                {classOption}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
          >
            <option value="">All status</option>
            <option value="submitted">Submitted</option>
            <option value="active">Active</option>
            <option value="time_up">Time Up</option>
          </select>

          <select
            value={filters.examId}
            onChange={(event) => setFilters((previous) => ({ ...previous, examId: event.target.value }))}
          >
            <option value="">All exams</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap large">
          <table className="sessions-table">
            <thead>
              <tr>
                <th className="cell-tight">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => handleToggleAllVisible(event.target.checked)}
                    aria-label="Select all visible sessions"
                  />
                </th>
                <th>Session ID</th>
                <th>Exam</th>
                <th>Trial</th>
                <th>Name</th>
                <th>Class</th>
                <th>Email</th>
                <th>Status</th>
                <th>Final %</th>
                <th>Violations</th>
                <th>Rating</th>
                <th>Feedback</th>
                <th>Started</th>
                <th>Submitted</th>
                <th className="cell-tight">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedSessions.rows.map((session) => (
                <tr key={session.id}>
                  <td className="cell-tight">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.includes(session.id)}
                      onChange={(event) =>
                        handleToggleSessionSelection(session.id, event.target.checked)
                      }
                      aria-label={`Select session ${session.id}`}
                    />
                  </td>
                  <td className="mono" title={session.id}>
                    <span className="truncate-line">{session.id}</span>
                  </td>
                  <td title={session.examTitle}>
                    <span className="truncate-line">{session.examTitle}</span>
                  </td>
                  <td>#{session.trialNumber ?? 1}</td>
                  <td title={session.studentName}>
                    <span className="truncate-line">{session.studentName}</span>
                  </td>
                  <td title={session.classRoom}>
                    <span className="truncate-line">{session.classRoom}</span>
                  </td>
                  <td title={session.email || '-'}>
                    <span className="truncate-line">{session.email || '-'}</span>
                  </td>
                  <td>
                    <span className={`status-pill ${session.status}`}>{session.status}</span>
                  </td>
                  <td>{session.finalPercent}%</td>
                  <td>{session.violationsCount}</td>
                  <td>{session.feedbackRating ?? '-'}</td>
                  <td title={session.feedbackComment || '-'}>
                    <span className="truncate-line">{session.feedbackComment || '-'}</span>
                  </td>
                  <td>{formatDate(session.startedAt)}</td>
                  <td>{formatDate(session.submittedAt)}</td>
                  <td className="cell-tight">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      disabled={loading.deleting}
                      onClick={() => handleDeleteSingleSession(session)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!sessions.length && (
                <tr>
                  <td colSpan={15}>
                    {loading.sessions ? 'Loading sessions...' : 'No sessions found for this filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pagedSessions.page}
          totalPages={pagedSessions.totalPages}
          start={pagedSessions.start}
          end={pagedSessions.end}
          total={pagedSessions.total}
          label="sessions"
          onPrev={() => handlePagePrevious('sessions')}
          onNext={() => handlePageNext('sessions', pagedSessions.totalPages)}
        />

        <p className="muted">Selected on screen: {selectedVisibleCount}</p>
      </section>
      )}

      {widgets.studentTrials && (
      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>Student Trial Groups</h2>
          <span className="muted">{students.length} student(s)</span>
        </div>

        <div className="admin-filters">
          <input
            type="search"
            placeholder="Search by name, email or exam"
            value={studentFilters.search}
            onChange={(event) =>
              setStudentFilters((previous) => ({ ...previous, search: event.target.value }))
            }
          />

          <select
            value={studentFilters.classRoom}
            onChange={(event) =>
              setStudentFilters((previous) => ({ ...previous, classRoom: event.target.value }))
            }
          >
            <option value="">All classes</option>
            {(meta?.classOptions ?? []).map((classOption) => (
              <option key={classOption} value={classOption}>
                {classOption}
              </option>
            ))}
          </select>

          <select
            value={studentFilters.examId}
            onChange={(event) =>
              setStudentFilters((previous) => ({ ...previous, examId: event.target.value }))
            }
          >
            <option value="">All exams</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap large">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Exam</th>
                <th>Total Trials</th>
                <th>Submitted</th>
                <th>Best %</th>
                <th>Avg %</th>
                <th>Latest</th>
                <th className="cell-tight">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedStudents.rows.map((student) => (
                <tr key={student.studentKey}>
                  <td title={student.studentName}>
                    <span className="truncate-line">{student.studentName}</span>
                  </td>
                  <td>{student.classRoom}</td>
                  <td title={student.examTitle}>
                    <span className="truncate-line">{student.examTitle}</span>
                  </td>
                  <td>{student.totalTrials}</td>
                  <td>{student.submittedTrials}</td>
                  <td>{student.bestFinalPercent}%</td>
                  <td>{student.averageFinalPercent}%</td>
                  <td>{formatDate(student.latestStartedAt)}</td>
                  <td className="cell-tight">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => handleOpenStudentTrials(student)}
                      disabled={studentTrialLoading}
                    >
                      {studentTrialLoading ? 'Loading...' : 'View Trials'}
                    </button>
                  </td>
                </tr>
              ))}
              {!students.length && (
                <tr>
                  <td colSpan={9}>{loading.students ? 'Loading students...' : 'No student trial groups found.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pagedStudents.page}
          totalPages={pagedStudents.totalPages}
          start={pagedStudents.start}
          end={pagedStudents.end}
          total={pagedStudents.total}
          label="students"
          onPrev={() => handlePagePrevious('students')}
          onNext={() => handlePageNext('students', pagedStudents.totalPages)}
        />
      </section>
      )}

      {widgets.userManager && (
      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>User Management</h2>
          <span className="muted">{users.length} user(s)</span>
        </div>

        <div className="admin-filters">
          <input
            type="search"
            placeholder="Search by name or email"
            value={userFilters.search}
            onChange={(event) =>
              setUserFilters((previous) => ({ ...previous, search: event.target.value }))
            }
          />

          <select
            value={userFilters.classRoom}
            onChange={(event) =>
              setUserFilters((previous) => ({ ...previous, classRoom: event.target.value }))
            }
          >
            <option value="">All classes</option>
            {(meta?.classOptions ?? []).map((classOption) => (
              <option key={classOption} value={classOption}>
                {classOption}
              </option>
            ))}
          </select>

          <select
            value={userFilters.status}
            onChange={(event) =>
              setUserFilters((previous) => ({ ...previous, status: event.target.value }))
            }
          >
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="must_change">Must Change Password</option>
          </select>
        </div>

        <div className="table-wrap large">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Class</th>
                <th>Email</th>
                <th>Trials</th>
                <th>Best %</th>
                <th>Last Login</th>
                <th>Flags</th>
                <th>Help</th>
                <th>Reset Password</th>
                <th className="cell-tight">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.rows.map((user) => (
                <tr key={user.id}>
                  <td title={user.fullName}>
                    <span className="truncate-line">{user.fullName}</span>
                  </td>
                  <td>{user.classRoom}</td>
                  <td title={user.email}>
                    <span className="truncate-line">{user.email}</span>
                  </td>
                  <td>{user.totalTrials ?? 0}</td>
                  <td>{user.bestFinalPercent ?? 0}%</td>
                  <td>{formatDate(user.lastLoginAt)}</td>
                  <td>
                    {user.disabled ? 'Disabled' : 'Active'}
                    <br />
                    {user.mustChangePassword ? 'Must change password' : 'Password OK'}
                  </td>
                  <td>{user.openHelpRequests ?? 0}</td>
                  <td>
                    <input
                      type="password"
                      value={userPasswordDrafts[user.id] ?? ''}
                      placeholder="new password"
                      onChange={(event) =>
                        setUserPasswordDrafts((previous) => ({
                          ...previous,
                          [user.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      disabled={loading.users}
                      onClick={() => handleResetUserPassword(user)}
                    >
                      Reset
                    </button>
                  </td>
                  <td className="cell-tight">
                    <div className="inline-actions compact">
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        disabled={loading.users}
                        onClick={() => handleEditUser(user)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        disabled={loading.users}
                        onClick={() => handleForcePasswordChange(user)}
                      >
                        {user.mustChangePassword ? 'Clear Force' : 'Force Change'}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-xs ${user.disabled ? 'btn-secondary' : 'btn-warning'}`}
                        disabled={loading.users}
                        onClick={() => handleToggleUserDisabled(user)}
                      >
                        {user.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={10}>{loading.users ? 'Loading users...' : 'No users found.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pagedUsers.page}
          totalPages={pagedUsers.totalPages}
          start={pagedUsers.start}
          end={pagedUsers.end}
          total={pagedUsers.total}
          label="users"
          onPrev={() => handlePagePrevious('users')}
          onNext={() => handlePageNext('users', pagedUsers.totalPages)}
        />
      </section>
      )}

      {widgets.passwordHelp && (
      <section className="card-panel wide admin-card">
        <div className="panel-title-row">
          <h2>Password Help Requests</h2>
          <span className="muted">{passwordHelpRequests.length} request(s)</span>
        </div>

        <div className="admin-filters">
          <input
            type="search"
            placeholder="Search by name, class, email or message"
            value={helpFilters.search}
            onChange={(event) =>
              setHelpFilters((previous) => ({ ...previous, search: event.target.value }))
            }
          />
          <select
            value={helpFilters.status}
            onChange={(event) =>
              setHelpFilters((previous) => ({ ...previous, status: event.target.value }))
            }
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="table-wrap medium">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Email</th>
                <th>Message</th>
                <th>Status</th>
                <th>Created</th>
                <th>Resolved</th>
                <th className="cell-tight">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedPasswordHelp.rows.map((request) => (
                <tr key={request.id}>
                  <td title={request.fullName}>
                    <span className="truncate-line">{request.fullName}</span>
                  </td>
                  <td>{request.classRoom}</td>
                  <td title={request.email}>
                    <span className="truncate-line">{request.email}</span>
                  </td>
                  <td title={request.message}>
                    <span className="truncate-2">{request.message || '-'}</span>
                  </td>
                  <td>{request.status}</td>
                  <td>{formatDate(request.createdAt)}</td>
                  <td>{formatDate(request.resolvedAt)}</td>
                  <td className="cell-tight">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      disabled={loading.passwordHelp || request.status === 'resolved'}
                      onClick={() => handleResolveHelpRequest(request)}
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
              {!passwordHelpRequests.length && (
                <tr>
                  <td colSpan={8}>
                    {loading.passwordHelp ? 'Loading password-help requests...' : 'No requests found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pagedPasswordHelp.page}
          totalPages={pagedPasswordHelp.totalPages}
          start={pagedPasswordHelp.start}
          end={pagedPasswordHelp.end}
          total={pagedPasswordHelp.total}
          label="requests"
          onPrev={() => handlePagePrevious('passwordHelp')}
          onNext={() => handlePageNext('passwordHelp', pagedPasswordHelp.totalPages)}
        />
      </section>
      )}

      {trialReviewOpen && studentTrials && (
        <div className="modal-backdrop" onClick={handleCloseStudentTrials}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title-row">
              <h2>Trial Review: {studentTrials.student?.studentName}</h2>
              <button type="button" className="btn btn-outline btn-xs" onClick={handleCloseStudentTrials}>
                Close
              </button>
            </div>
            <p className="muted">
              {studentTrials.student?.classRoom} | {studentTrials.student?.examTitle} |{' '}
              {studentTrials.student?.email}
            </p>

            <div className="trial-list">
              {(studentTrials.trials ?? []).map((trial) => (
                <article key={trial.id} className="trial-card">
                  <div className="panel-title-row">
                    <h3>
                      Trial #{trial.trialNumber} - {trial.status}
                    </h3>
                    <span className="muted">{trial.id.slice(0, 8)}</span>
                  </div>

                  <div className="result-grid">
                    <div className="result-box">
                      <span>Final</span>
                      <strong>{trial.summary?.finalPercent ?? 0}%</strong>
                    </div>
                    <div className="result-box">
                      <span>Raw</span>
                      <strong>{trial.summary?.rawPercent ?? 0}%</strong>
                    </div>
                    <div className="result-box">
                      <span>Active Violations</span>
                      <strong>{trial.summary?.violationsCount ?? 0}</strong>
                    </div>
                    <div className="result-box">
                      <span>Waived Violations</span>
                      <strong>{trial.summary?.waivedViolationsCount ?? 0}</strong>
                    </div>
                  </div>

                  <div className="inline-actions compact">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => handleWaiveTrialViolations(trial.id, 'selected', true)}
                      disabled={loading.deleting}
                    >
                      Waive Selected
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => handleWaiveTrialViolations(trial.id, 'selected', false)}
                      disabled={loading.deleting}
                    >
                      Unwaive Selected
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => handleWaiveTrialViolations(trial.id, 'all', true)}
                      disabled={loading.deleting}
                    >
                      Waive All
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => handleWaiveTrialViolations(trial.id, 'all', false)}
                      disabled={loading.deleting}
                    >
                      Unwaive All
                    </button>
                  </div>

                  <div className="table-wrap medium">
                    <table>
                      <thead>
                        <tr>
                          <th className="cell-tight">Pick</th>
                          <th>Violation Type</th>
                          <th>Detail</th>
                          <th>Status</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(trial.violations ?? []).map((violation) => (
                          <tr key={violation.id}>
                            <td className="cell-tight">
                              <input
                                type="checkbox"
                                checked={(trialSelectedViolations[trial.id] ?? []).includes(violation.id)}
                                onChange={(event) =>
                                  handleToggleTrialViolation(trial.id, violation.id, event.target.checked)
                                }
                              />
                            </td>
                            <td>{violation.type}</td>
                            <td title={violation.detail}>
                              <span className="truncate-line">{violation.detail || '-'}</span>
                            </td>
                            <td>{violation.waived ? 'Waived' : 'Active'}</td>
                            <td>{formatDate(violation.occurredAt)}</td>
                          </tr>
                        ))}
                        {!trial.violations?.length && (
                          <tr>
                            <td colSpan={5}>No violations logged for this trial.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <details className="trial-review-details">
                    <summary>Review Answers ({trial.questionReview?.length ?? 0})</summary>
                    <div className="table-wrap large">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Question</th>
                            <th>Selected</th>
                            <th>Correct</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(trial.questionReview ?? []).map((item) => (
                            <tr key={`${trial.id}-${item.questionId}`}>
                              <td>{item.index}</td>
                              <td title={item.text}>
                                <span className="truncate-2">{item.text}</span>
                              </td>
                              <td>{(item.selectedOptionIds ?? []).join(', ') || '-'}</td>
                              <td>{(item.correctOptionIds ?? []).join(', ') || '-'}</td>
                              <td>{item.isCorrect ? 'Correct' : 'Wrong'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {widgets.examManager && (
      <section className="admin-grid-2 exam-manager-grid equal-height-grid">
        <article className="card-panel wide admin-card exam-general-card">
          <div className="panel-title-row">
            <h2>General Exam Settings</h2>
            {loading.updateExam && <span className="muted">Saving...</span>}
          </div>

          <form className="form-stack" onSubmit={handleSaveGeneralExam}>
            <label htmlFor="generalTitle">General Exam Name</label>
            <input
              id="generalTitle"
              value={generalExamEdit.title}
              onChange={(event) =>
                setGeneralExamEdit((previous) => ({ ...previous, title: event.target.value }))
              }
              required
            />

            <label htmlFor="generalDuration">Duration (seconds)</label>
            <input
              id="generalDuration"
              type="number"
              min={60}
              max={10800}
              value={generalExamEdit.durationSeconds}
              onChange={(event) =>
                setGeneralExamEdit((previous) => ({
                  ...previous,
                  durationSeconds: Number(event.target.value),
                }))
              }
            />

            <label htmlFor="generalMaxAttempts">Max Attempts</label>
            <input
              id="generalMaxAttempts"
              type="number"
              min={1}
              max={50}
              value={generalExamEdit.maxAttempts}
              onChange={(event) =>
                setGeneralExamEdit((previous) => ({
                  ...previous,
                  maxAttempts: Number(event.target.value),
                }))
              }
            />

            <label htmlFor="generalQuestionCount">Question Count</label>
            <input
              id="generalQuestionCount"
              type="number"
              min={1}
              max={500}
              value={generalExamEdit.questionCount}
              onChange={(event) =>
                setGeneralExamEdit((previous) => ({
                  ...previous,
                  questionCount: Number(event.target.value),
                }))
              }
            />

            <label>Right Click and Special Keys</label>
            <div className="class-chip-grid">
              <label className={`widget-toggle ${generalExamEdit.deductRightClick ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={generalExamEdit.deductRightClick}
                  onChange={(event) =>
                    setGeneralExamEdit((previous) => ({
                      ...previous,
                      deductRightClick: event.target.checked,
                    }))
                  }
                />
                <span>Right click: {generalExamEdit.deductRightClick ? 'Deduct marks' : 'Lock only'}</span>
              </label>
              <label className={`widget-toggle ${generalExamEdit.deductRestrictedKey ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={generalExamEdit.deductRestrictedKey}
                  onChange={(event) =>
                    setGeneralExamEdit((previous) => ({
                      ...previous,
                      deductRestrictedKey: event.target.checked,
                    }))
                  }
                />
                <span>
                  Special keys: {generalExamEdit.deductRestrictedKey ? 'Deduct marks' : 'Lock only'}
                </span>
              </label>
            </div>
            <p className="muted">
              Default behavior is lock-only for right click and special keys. Turn on deduction only for stricter exams.
            </p>

            <label>Allowed Classes</label>
            <div className="class-chip-grid">
              {(meta?.classOptions ?? []).map((classOption) => (
                <label key={classOption} className="widget-toggle">
                  <input
                    type="checkbox"
                    checked={generalExamEdit.allowedClasses.includes(classOption)}
                    onChange={() =>
                      setGeneralExamEdit((previous) => ({
                        ...previous,
                        allowedClasses: toggleClassInList(previous.allowedClasses, classOption),
                      }))
                    }
                  />
                  <span>{classOption}</span>
                </label>
              ))}
            </div>

            <label className="widget-toggle on">
              <input
                type="checkbox"
                checked={generalExamEdit.published}
                onChange={(event) =>
                  setGeneralExamEdit((previous) => ({ ...previous, published: event.target.checked }))
                }
              />
              <span>Published</span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={loading.updateExam}>
              {loading.updateExam ? 'Saving...' : 'Save General Exam'}
            </button>
          </form>
        </article>

        <article className="card-panel wide admin-card exam-create-card">
          <div className="panel-title-row">
            <h2>Create New Exam With Questions</h2>
            <span className="muted">Draft questions: {examQuestionDrafts.length}</span>
          </div>

          <form className="form-stack" onSubmit={handleCreateExam}>
            <label htmlFor="newExamId">Exam ID (optional)</label>
            <input
              id="newExamId"
              value={examForm.id}
              onChange={(event) => setExamForm((previous) => ({ ...previous, id: event.target.value }))}
              placeholder="example: first-term-jss1"
            />

            <label htmlFor="newExamTitle">Exam Title</label>
            <input
              id="newExamTitle"
              value={examForm.title}
              onChange={(event) =>
                setExamForm((previous) => ({ ...previous, title: event.target.value }))
              }
              required
            />

            <label htmlFor="newExamDescription">Description</label>
            <input
              id="newExamDescription"
              value={examForm.description}
              onChange={(event) =>
                setExamForm((previous) => ({ ...previous, description: event.target.value }))
              }
              placeholder="Optional short note"
            />

            <label htmlFor="newExamDuration">Duration (seconds)</label>
            <input
              id="newExamDuration"
              type="number"
              min={60}
              max={10800}
              value={examForm.durationSeconds}
              onChange={(event) =>
                setExamForm((previous) => ({
                  ...previous,
                  durationSeconds: Number(event.target.value),
                }))
              }
            />

            <label htmlFor="newExamMaxAttempts">Max Attempts</label>
            <input
              id="newExamMaxAttempts"
              type="number"
              min={1}
              max={50}
              value={examForm.maxAttempts}
              onChange={(event) =>
                setExamForm((previous) => ({
                  ...previous,
                  maxAttempts: Number(event.target.value),
                }))
              }
            />

            <label htmlFor="newExamQuestionCount">Question Count</label>
            <input
              id="newExamQuestionCount"
              type="number"
              min={1}
              max={500}
              value={examForm.questionCount}
              onChange={(event) =>
                setExamForm((previous) => ({
                  ...previous,
                  questionCount: Number(event.target.value),
                }))
              }
            />

            <label>Right Click and Special Keys</label>
            <div className="class-chip-grid">
              <label className={`widget-toggle ${examForm.deductRightClick ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={examForm.deductRightClick}
                  onChange={(event) =>
                    setExamForm((previous) => ({
                      ...previous,
                      deductRightClick: event.target.checked,
                    }))
                  }
                />
                <span>Right click: {examForm.deductRightClick ? 'Deduct marks' : 'Lock only'}</span>
              </label>
              <label className={`widget-toggle ${examForm.deductRestrictedKey ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={examForm.deductRestrictedKey}
                  onChange={(event) =>
                    setExamForm((previous) => ({
                      ...previous,
                      deductRestrictedKey: event.target.checked,
                    }))
                  }
                />
                <span>Special keys: {examForm.deductRestrictedKey ? 'Deduct marks' : 'Lock only'}</span>
              </label>
            </div>
            <p className="muted">
              Lock-only is recommended for practice; enable deduction for strict assessments.
            </p>

            <label>Allowed Classes</label>
            <div className="class-chip-grid">
              {(meta?.classOptions ?? []).map((classOption) => (
                <label key={classOption} className="widget-toggle">
                  <input
                    type="checkbox"
                    checked={examForm.allowedClasses.includes(classOption)}
                    onChange={() =>
                      setExamForm((previous) => ({
                        ...previous,
                        allowedClasses: toggleClassInList(previous.allowedClasses, classOption),
                      }))
                    }
                  />
                  <span>{classOption}</span>
                </label>
              ))}
            </div>

            <label className="widget-toggle on">
              <input
                type="checkbox"
                checked={examForm.published}
                onChange={(event) =>
                  setExamForm((previous) => ({ ...previous, published: event.target.checked }))
                }
              />
              <span>Publish Immediately</span>
            </label>

            <fieldset className="exam-draft-box">
              <legend>Add Draft Question</legend>
              <div className="form-stack">
                <label htmlFor="draftTopic">Topic</label>
                <select
                  id="draftTopic"
                  value={examQuestionForm.topic}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, topic: event.target.value }))
                  }
                >
                  {TOPIC_OPTIONS.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>

                <label htmlFor="draftType">Type</label>
                <select
                  id="draftType"
                  value={examQuestionForm.type}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, type: event.target.value }))
                  }
                >
                  <option value="single">Single Choice</option>
                  <option value="multi">Multi Choice</option>
                </select>

                <label htmlFor="draftText">Question Text</label>
                <input
                  id="draftText"
                  value={examQuestionForm.text}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, text: event.target.value }))
                  }
                />

                <label htmlFor="draftA">Option A</label>
                <input
                  id="draftA"
                  value={examQuestionForm.optionA}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, optionA: event.target.value }))
                  }
                />
                <label htmlFor="draftB">Option B</label>
                <input
                  id="draftB"
                  value={examQuestionForm.optionB}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, optionB: event.target.value }))
                  }
                />
                <label htmlFor="draftC">Option C</label>
                <input
                  id="draftC"
                  value={examQuestionForm.optionC}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, optionC: event.target.value }))
                  }
                />
                <label htmlFor="draftD">Option D</label>
                <input
                  id="draftD"
                  value={examQuestionForm.optionD}
                  onChange={(event) =>
                    setExamQuestionForm((previous) => ({ ...previous, optionD: event.target.value }))
                  }
                />
              </div>

              <label>Correct Answers</label>
              <div className="checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={examQuestionForm.correctA}
                    onChange={(event) =>
                      setExamQuestionForm((previous) => ({ ...previous, correctA: event.target.checked }))
                    }
                  />
                  A
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={examQuestionForm.correctB}
                    onChange={(event) =>
                      setExamQuestionForm((previous) => ({ ...previous, correctB: event.target.checked }))
                    }
                  />
                  B
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={examQuestionForm.correctC}
                    onChange={(event) =>
                      setExamQuestionForm((previous) => ({ ...previous, correctC: event.target.checked }))
                    }
                  />
                  C
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={examQuestionForm.correctD}
                    onChange={(event) =>
                      setExamQuestionForm((previous) => ({ ...previous, correctD: event.target.checked }))
                    }
                  />
                  D
                </label>
              </div>

              <div className="inline-actions">
                <button type="button" className="btn btn-outline" onClick={handleAddExamQuestionDraft}>
                  Add Draft Question
                </button>
              </div>
            </fieldset>

            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Question</th>
                    <th>Type</th>
                    <th>Answer Key</th>
                    <th className="cell-tight">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {examQuestionDrafts.map((draft, index) => (
                    <tr key={`draft-${index + 1}`}>
                      <td>{index + 1}</td>
                      <td title={draft.text}>
                        <span className="truncate-2">{draft.text}</span>
                      </td>
                      <td>{draft.type}</td>
                      <td>{draft.correctOptionIds.join(', ')}</td>
                      <td className="cell-tight">
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          onClick={() => handleRemoveExamQuestionDraft(index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!examQuestionDrafts.length && (
                    <tr>
                      <td colSpan={5}>No draft questions yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading.addExam}>
              {loading.addExam ? 'Creating Exam...' : 'Create Exam'}
            </button>
          </form>
        </article>

        <article className="card-panel wide admin-card exam-manager-full">
          <div className="panel-title-row">
            <h2>Published / Draft Exams</h2>
            {loading.exams && <span className="muted">Loading...</span>}
          </div>

          <div className="table-wrap medium published-exams-wrap">
            <table className="published-exams-table">
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Q Needed</th>
                  <th>Q Available</th>
                  <th>Classes</th>
                </tr>
              </thead>
              <tbody>
                {pagedExams.rows.map((exam) => (
                  <tr key={exam.id}>
                    <td title={exam.title}>
                      <span className="truncate-line">{exam.title}</span>
                    </td>
                    <td className="mono">{exam.id}</td>
                    <td>{exam.published ? 'Published' : 'Draft'}</td>
                    <td>{exam.maxAttempts ?? 3}</td>
                    <td>{exam.questionCount}</td>
                    <td>{exam.availableQuestionCount ?? 0}</td>
                    <td
                      className="published-exams-classes-cell"
                      title={(exam.allowedClasses ?? []).join(', ')}
                    >
                      <span className="truncate-line">{(exam.allowedClasses ?? []).join(', ')}</span>
                    </td>
                  </tr>
                ))}
                {!exams.length && (
                  <tr>
                    <td colSpan={7}>No exams available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PaginationControls
            page={pagedExams.page}
            totalPages={pagedExams.totalPages}
            start={pagedExams.start}
            end={pagedExams.end}
            total={pagedExams.total}
            label="exams"
            onPrev={() => handlePagePrevious('exams')}
            onNext={() => handlePageNext('exams', pagedExams.totalPages)}
          />
        </article>
      </section>
      )}

      {widgets.questionManager && (
      <section className="admin-grid-2 equal-height-grid">
        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Add Question to Pool</h2>
            <span className="muted">Current pool: {questions.length}</span>
          </div>

          <form className="form-stack" onSubmit={handleCreateQuestion}>
            <label htmlFor="topic">Topic</label>
            <select
              id="topic"
              value={questionForm.topic}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, topic: event.target.value }))
              }
            >
              {TOPIC_OPTIONS.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>

            <label htmlFor="qtype">Type</label>
            <select
              id="qtype"
              value={questionForm.type}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, type: event.target.value }))
              }
            >
              <option value="single">Single Choice</option>
              <option value="multi">Multi Choice</option>
            </select>

            <label htmlFor="qtext">Question Text</label>
            <input
              id="qtext"
              value={questionForm.text}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, text: event.target.value }))
              }
              required
              placeholder="Enter a simple question"
            />

            <label htmlFor="optA">Option A</label>
            <input
              id="optA"
              value={questionForm.optionA}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, optionA: event.target.value }))
              }
              required
            />
            <label htmlFor="optB">Option B</label>
            <input
              id="optB"
              value={questionForm.optionB}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, optionB: event.target.value }))
              }
              required
            />
            <label htmlFor="optC">Option C</label>
            <input
              id="optC"
              value={questionForm.optionC}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, optionC: event.target.value }))
              }
              required
            />
            <label htmlFor="optD">Option D</label>
            <input
              id="optD"
              value={questionForm.optionD}
              onChange={(event) =>
                setQuestionForm((previous) => ({ ...previous, optionD: event.target.value }))
              }
              required
            />

            <label>Correct Answer(s)</label>
            <div className="checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={questionForm.correctA}
                  onChange={(event) =>
                    setQuestionForm((previous) => ({ ...previous, correctA: event.target.checked }))
                  }
                />{' '}
                A
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={questionForm.correctB}
                  onChange={(event) =>
                    setQuestionForm((previous) => ({ ...previous, correctB: event.target.checked }))
                  }
                />{' '}
                B
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={questionForm.correctC}
                  onChange={(event) =>
                    setQuestionForm((previous) => ({ ...previous, correctC: event.target.checked }))
                  }
                />{' '}
                C
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={questionForm.correctD}
                  onChange={(event) =>
                    setQuestionForm((previous) => ({ ...previous, correctD: event.target.checked }))
                  }
                />{' '}
                D
              </label>
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading.addQuestion}>
              {loading.addQuestion ? 'Adding...' : 'Add Question'}
            </button>
          </form>
        </article>

        <article className="card-panel wide admin-card">
          <div className="panel-title-row">
            <h2>Question Pool</h2>
            {loading.questions && <span className="muted">Loading...</span>}
          </div>

          <div className="table-wrap tall">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Source Exam</th>
                  <th>Topic</th>
                  <th>Type</th>
                  <th>Question</th>
                  <th>Answer Key</th>
                </tr>
              </thead>
              <tbody>
                {pagedQuestions.rows.map((question) => (
                  <tr key={question.id}>
                    <td className="mono" title={question.id}>
                      <span className="truncate-line">{question.id}</span>
                    </td>
                    <td title={question.sourceExamId ?? 'general'}>
                      <span className="truncate-line">{question.sourceExamId ?? 'general'}</span>
                    </td>
                    <td title={question.topic}>
                      <span className="truncate-line">{question.topic}</span>
                    </td>
                    <td title={question.type}>
                      <span className="truncate-line">{question.type}</span>
                    </td>
                    <td title={question.text}>
                      <span className="truncate-2">{question.text}</span>
                    </td>
                    <td>{question.answerKey}</td>
                  </tr>
                ))}
                {!questions.length && (
                  <tr>
                    <td colSpan={6}>No questions available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PaginationControls
            page={pagedQuestions.page}
            totalPages={pagedQuestions.totalPages}
            start={pagedQuestions.start}
            end={pagedQuestions.end}
            total={pagedQuestions.total}
            label="questions"
            onPrev={() => handlePagePrevious('questions')}
            onNext={() => handlePageNext('questions', pagedQuestions.totalPages)}
          />
        </article>
      </section>
      )}
    </main>
  );
}

export default AdminPage;
