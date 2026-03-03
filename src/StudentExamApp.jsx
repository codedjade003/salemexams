
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  changeStudentPassword,
  downloadStudentTrialReportCard,
  fetchMeta,
  fetchSession,
  fetchStudentMe,
  fetchStudentTrial,
  logViolation,
  markSeen,
  requestStudentPasswordHelp,
  saveAnswer,
  saveExamFeedback,
  saveFlag,
  saveStudentGeneralFeedback,
  startSession,
  studentLogin,
  studentRegister,
  submitExam,
} from './api';

const ACTIVE_SESSION_KEY = 'salem_exam_active_session';
const ACTIVE_INDEX_KEY = 'salem_exam_active_index';
const STUDENT_TOKEN_KEY = 'salem_student_token';
const STUDENT_TOKEN_EXPIRES_KEY = 'salem_student_token_expires_at';

const TOUR_STEPS = [
  {
    selector: '.tour-timer',
    dock: 'bottom',
    title: 'Timer',
    text: 'Your exam auto-submits at 00:00.',
  },
  {
    selector: '.tour-violation',
    dock: 'bottom',
    title: 'Violation Counter',
    text: 'Violations are logged and can reduce marks.',
  },
  {
    selector: '.tour-question',
    dock: 'bottom',
    title: 'Question Area',
    text: 'Read one question at a time and choose answer(s).',
  },
  {
    selector: '.tour-palette',
    dock: 'top',
    title: 'Question Palette',
    text: 'Jump to any question using this menu.',
  },
];

function formatTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds || 0);
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '-';
  }
}

function formatOptionList(question, optionIds) {
  const selected = Array.isArray(optionIds) ? optionIds : [];
  if (!selected.length) {
    return 'No answer';
  }

  return selected
    .map((optionId) => {
      const option = (question?.options ?? []).find((item) => item.id === optionId);
      return option ? `${optionId}. ${option.text}` : optionId;
    })
    .join(' | ');
}

function getQuestionStatus(questionId, seen, responses, flagged) {
  if (!seen[questionId]) return 'unread';
  if (flagged[questionId]) return 'flagged';
  return (responses[questionId] ?? []).length > 0 ? 'answered' : 'unanswered';
}

function StudentExamApp() {
  const [meta, setMeta] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [authToken, setAuthToken] = useState('');
  const [authExpiresAt, setAuthExpiresAt] = useState(0);
  const [dashboard, setDashboard] = useState(null);

  const [authMode, setAuthMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    fullName: '',
    classRoom: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [helpForm, setHelpForm] = useState({ fullName: '', classRoom: '', email: '', message: '' });
  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [selectedExamId, setSelectedExamId] = useState('');
  const [session, setSession] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tourRunning, setTourRunning] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [trialReview, setTrialReview] = useState(null);

  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [isSavingGeneralFeedback, setIsSavingGeneralFeedback] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSendingHelp, setIsSendingHelp] = useState(false);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [submitConfirmArmed, setSubmitConfirmArmed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [feedbackForm, setFeedbackForm] = useState({ rating: '', comment: '' });
  const [generalFeedbackForm, setGeneralFeedbackForm] = useState({ rating: '', comment: '' });
  const [resultReleaseNow, setResultReleaseNow] = useState(Date.now());

  const violationThrottleRef = useRef(new Map());
  const seenSyncBlockedRef = useRef(new Set());
  const autoSubmitTriggeredRef = useRef(false);
  const submitInProgressRef = useRef(false);

  const clearStoredSession = useCallback(() => {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    localStorage.removeItem(ACTIVE_INDEX_KEY);
  }, []);

  const storeToken = useCallback((token, expiresAt) => {
    localStorage.setItem(STUDENT_TOKEN_KEY, token);
    localStorage.setItem(STUDENT_TOKEN_EXPIRES_KEY, String(expiresAt));
    setAuthToken(token);
    setAuthExpiresAt(expiresAt);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(STUDENT_TOKEN_KEY);
    localStorage.removeItem(STUDENT_TOKEN_EXPIRES_KEY);
    setAuthToken('');
    setAuthExpiresAt(0);
    setDashboard(null);
    setSession(null);
    setSelectedExamId('');
    setCurrentIndex(0);
    clearStoredSession();
  }, [clearStoredSession]);

  const handleUnauthorized = useCallback(
    (error) => {
      if (!error || (error.status !== 401 && error.status !== 403)) {
        return false;
      }
      clearAuth();
      setPhase('setup');
      setErrorMessage('Your session expired. Login again.');
      return true;
    },
    [clearAuth]
  );

  const refreshDashboard = useCallback(async (token) => {
    if (!token) return null;
    const payload = await fetchStudentMe(token);
    const nextDashboard = {
      user: payload.user,
      exams: payload.exams ?? [],
      activeSession: payload.activeSession ?? null,
      trials: payload.trials ?? [],
      leaderboards: payload.leaderboards ?? { classRoom: '', overall: [], classTop: [], currentStudent: null },
      generalFeedbackHistory: payload.generalFeedbackHistory ?? [],
    };
    setDashboard(nextDashboard);
    setSelectedExamId((prev) => {
      const same = nextDashboard.exams.find((exam) => exam.id === prev);
      if (same) return prev;
      return nextDashboard.exams.find((exam) => exam.id === 'general')?.id ?? nextDashboard.exams[0]?.id ?? '';
    });
    return nextDashboard;
  }, []);

  const refreshDashboardSafely = useCallback(
    async (token, fallbackMessage = 'Could not refresh dashboard.') => {
      if (!token) return null;
      try {
        return await refreshDashboard(token);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || fallbackMessage);
        }
        return null;
      }
    },
    [handleUnauthorized, refreshDashboard]
  );

  const applyServerSession = useCallback(
    async (serverSession) => {
      if (!serverSession) return;
      setSession(serverSession);
      setSelectedExamId(serverSession.exam?.id ?? '');
      if (serverSession.submittedAt || serverSession.remainingSeconds <= 0) {
        clearStoredSession();
        setPhase('result');
      } else {
        localStorage.setItem(ACTIVE_SESSION_KEY, serverSession.sessionId);
        setPhase('exam');
      }
      if (authToken) {
        try {
          await refreshDashboard(authToken);
        } catch {
          // best effort
        }
      }
    },
    [authToken, clearStoredSession, refreshDashboard]
  );

  const adoptSessionFromError = useCallback(
    async (error) => {
      const serverSession = error?.payload?.session;
      if (!serverSession) return false;
      await applyServerSession(serverSession);
      return true;
    },
    [applyServerSession]
  );

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      try {
        const metadata = await fetchMeta();
        if (!alive) return;
        setMeta(metadata);

        const savedToken = localStorage.getItem(STUDENT_TOKEN_KEY) ?? '';
        const savedExpiresAt = Number(localStorage.getItem(STUDENT_TOKEN_EXPIRES_KEY) ?? '0');
        const tokenValid = savedToken && Number.isFinite(savedExpiresAt) && savedExpiresAt > Date.now();

        if (!tokenValid) {
          setPhase('setup');
          return;
        }

        storeToken(savedToken, savedExpiresAt);
        try {
          const next = await refreshDashboard(savedToken);
          if (!alive) return;

          if (next?.user) {
            setLoginForm((prev) => ({
              ...prev,
              email: next.user.email ?? '',
              password: '',
            }));
            setRegisterForm((prev) => ({
              ...prev,
              fullName: next.user.fullName ?? '',
              classRoom: next.user.classRoom ?? '',
              email: next.user.email ?? '',
              password: '',
              confirmPassword: '',
            }));
            setHelpForm((prev) => ({
              ...prev,
              fullName: next.user.fullName ?? '',
              classRoom: next.user.classRoom ?? '',
              email: next.user.email ?? '',
            }));
          }

          if (next?.activeSession) {
            await applyServerSession(next.activeSession);
            setInfoMessage('Resumed your active exam session.');
            return;
          }

          const savedSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
          if (savedSessionId) {
            try {
              const existing = await fetchSession(savedToken, savedSessionId);
              if (!alive) return;
              await applyServerSession(existing);
              return;
            } catch {
              clearStoredSession();
            }
          }

          setPhase('setup');
        } catch (error) {
          if (!alive) return;
          clearAuth();
          if (!handleUnauthorized(error)) {
            setErrorMessage(error.message || 'Could not load student dashboard.');
          }
          setPhase('setup');
        }
      } catch (error) {
        if (!alive) return;
        setErrorMessage(error.message || 'Could not load exam settings.');
        setPhase('error');
      }
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, [applyServerSession, clearAuth, clearStoredSession, handleUnauthorized, refreshDashboard, storeToken]);

  useEffect(() => {
    if (!infoMessage) return undefined;
    const id = setTimeout(() => setInfoMessage(''), 3200);
    return () => clearTimeout(id);
  }, [infoMessage]);

  useEffect(() => {
    const rating = session?.feedback?.rating ? String(session.feedback.rating) : '';
    const comment = session?.feedback?.comment ?? '';
    setFeedbackForm({ rating, comment });
  }, [session?.feedback?.comment, session?.feedback?.rating, session?.sessionId]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    seenSyncBlockedRef.current.clear();
  }, [session?.sessionId]);

  useEffect(() => {
    if (!session || session.submittedAt) {
      clearStoredSession();
      return;
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, session.sessionId);
  }, [clearStoredSession, session]);

  useEffect(() => {
    if (phase !== 'exam') return;
    localStorage.setItem(ACTIVE_INDEX_KEY, String(currentIndex));
  }, [phase, currentIndex]);

  useEffect(() => {
    if (phase !== 'exam' || !session?.sessionId || session.submittedAt) return undefined;

    const id = setInterval(() => {
      setSession((prev) => {
        if (!prev || prev.submittedAt) return prev;
        const nextRemaining = Math.max(0, Math.ceil((prev.expiresAt - Date.now()) / 1000));
        if (nextRemaining === prev.remainingSeconds) return prev;
        return { ...prev, remainingSeconds: nextRemaining };
      });
    }, 1000);

    return () => clearInterval(id);
  }, [phase, session?.sessionId, session?.submittedAt]);

  const activeQuestion = useMemo(() => {
    if (!session?.questions?.length) return null;
    return session.questions[currentIndex] ?? null;
  }, [currentIndex, session]);

  const selectedExam = useMemo(
    () => dashboard?.exams?.find((exam) => exam.id === selectedExamId) ?? null,
    [dashboard?.exams, selectedExamId]
  );
  const leaderboardOverall = dashboard?.leaderboards?.overall ?? [];
  const leaderboardClassTop = dashboard?.leaderboards?.classTop ?? [];
  const currentLeaderboard = dashboard?.leaderboards?.currentStudent ?? null;
  const generalFeedbackHistory = dashboard?.generalFeedbackHistory ?? [];
  const resultsLocked = Boolean(session?.submittedAt && session?.resultsReleased === false);
  const resultReleaseInSeconds =
    resultsLocked && session?.resultsAvailableAt
      ? Math.max(0, Math.ceil((session.resultsAvailableAt - resultReleaseNow) / 1000))
      : 0;

  useEffect(() => {
    if (!submitConfirmArmed) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setSubmitConfirmArmed(false);
    }, 6000);

    return () => clearTimeout(timeoutId);
  }, [submitConfirmArmed]);

  useEffect(() => {
    if (!resultsLocked) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setResultReleaseNow(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, [resultsLocked]);

  useEffect(() => {
    if (!resultsLocked || resultReleaseInSeconds > 0 || !authToken || !session?.sessionId) {
      return;
    }

    let cancelled = false;
    const loadUnlockedSession = async () => {
      try {
        const latest = await fetchSession(authToken, session.sessionId);
        if (cancelled) {
          return;
        }

        setSession(latest);
        if (latest?.resultsReleased) {
          setInfoMessage('Corrections are now available.');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not load released corrections yet.');
        }
      }
    };

    void loadUnlockedSession();

    return () => {
      cancelled = true;
    };
  }, [authToken, handleUnauthorized, resultReleaseInSeconds, resultsLocked, session?.sessionId]);

  const handleSubmit = useCallback(
    async (trigger = 'manual') => {
      if (!session || isSubmitting || !authToken) return;
      if (trigger === 'manual' && !submitConfirmArmed) {
        setSubmitConfirmArmed(true);
        setInfoMessage('Click Submit Exam again within 6 seconds to confirm.');
        return;
      }

      setSubmitConfirmArmed(false);
      submitInProgressRef.current = true;
      setIsSubmitting(true);
      setErrorMessage('');
      try {
        const payload = await submitExam(authToken, session.sessionId);
        setSession(payload.session);
        setPhase('result');
        clearStoredSession();
        void refreshDashboardSafely(authToken);
      } catch (error) {
        submitInProgressRef.current = false;
        if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not submit exam right now.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      adoptSessionFromError,
      authToken,
      clearStoredSession,
      handleUnauthorized,
      isSubmitting,
      refreshDashboardSafely,
      submitConfirmArmed,
      session,
    ]
  );

  useEffect(() => {
    if (phase !== 'exam' || !session || session.submittedAt) return;
    if (session.remainingSeconds > 0 || autoSubmitTriggeredRef.current) return;
    autoSubmitTriggeredRef.current = true;
    setInfoMessage('Time is up. Submitting your exam now...');
    void handleSubmit('auto');
  }, [handleSubmit, phase, session]);

  useEffect(() => {
    if (phase !== 'exam') {
      submitInProgressRef.current = false;
      setSubmitConfirmArmed(false);
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'exam' || !session || !activeQuestion || !authToken) return;
    const questionId = activeQuestion.id;
    if (seenSyncBlockedRef.current.has(questionId)) return;
    if (session.seen[questionId]) return;

    setSession((prev) => (prev ? { ...prev, seen: { ...prev.seen, [questionId]: true } } : prev));

    void markSeen(authToken, session.sessionId, questionId, currentIndex).catch(async (error) => {
      if (
        error?.status === 400 &&
        ['QUESTION_NOT_IN_SESSION', 'QUESTION_DETAILS_MISSING'].includes(error?.payload?.code)
      ) {
        seenSyncBlockedRef.current.add(questionId);
        setInfoMessage('Sync warning: question read-state could not be saved for this item.');
        return;
      }

      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not save read status.');
      }
    });
  }, [activeQuestion, adoptSessionFromError, authToken, currentIndex, handleUnauthorized, phase, session]);

  const startExamFullscreen = useCallback(async () => {
    if (document.fullscreenElement) return;
    await document.documentElement.requestFullscreen().catch(() => {
      setInfoMessage('Please click "Go Full Screen" if full screen did not start.');
    });
  }, []);

  const reportViolation = useCallback(
    (type, detail) => {
      if (submitInProgressRef.current) return;
      if (!session || session.submittedAt || phase !== 'exam' || !authToken) return;
      const now = Date.now();
      const recent = violationThrottleRef.current.get(type) ?? 0;
      if (now - recent < 2000) return;
      violationThrottleRef.current.set(type, now);

      setSession((prev) =>
        prev
          ? {
              ...prev,
              violations: [...prev.violations, { id: `local-${now}`, type, detail, occurredAt: now }],
            }
          : prev
      );

      void logViolation(authToken, session.sessionId, type, detail)
        .then((payload) => {
          if (!payload?.violations) return;
          setSession((prev) => (prev ? { ...prev, violations: payload.violations } : prev));
        })
        .catch(async (error) => {
          if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
            setErrorMessage(error.message || 'Could not sync proctoring log.');
          }
        });
    },
    [adoptSessionFromError, authToken, handleUnauthorized, phase, session]
  );

  useEffect(() => {
    if (phase !== 'exam' || !session || session.submittedAt) return undefined;

    const onVisibilityChange = () => {
      if (document.hidden) reportViolation('tab_switch', 'You left the exam tab');
    };
    const onWindowBlur = () => reportViolation('window_blur', 'Exam window lost focus');
    const onFullscreenExit = () => {
      if (!document.fullscreenElement) reportViolation('fullscreen_exit', 'You exited full screen mode');
    };
    const onContextMenu = (event) => {
      event.preventDefault();
      reportViolation('right_click', 'Right click is blocked during exam');
    };
    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      const blocked =
        key === 'f12' ||
        key === 'printscreen' ||
        (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (event.ctrlKey && ['u', 's', 'c', 'v', 'x', 'p'].includes(key)) ||
        (event.metaKey && ['c', 'v', 'x', 's', 'p'].includes(key));
      if (!blocked) return;
      event.preventDefault();
      reportViolation('restricted_key', `Blocked key: ${event.key}`);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('fullscreenchange', onFullscreenExit);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('fullscreenchange', onFullscreenExit);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [phase, reportViolation, session]);

  useEffect(() => {
    if (!tourRunning || phase !== 'exam') return undefined;
    const step = TOUR_STEPS[tourIndex];
    if (!step) return undefined;
    const target = document.querySelector(step.selector);
    if (!target) return undefined;

    target.setAttribute('data-tour-active', 'true');
    target.scrollIntoView({
      behavior: 'smooth',
      block: step.dock === 'top' ? 'start' : 'center',
      inline: 'nearest',
    });

    return () => target.removeAttribute('data-tour-active');
  }, [phase, tourIndex, tourRunning]);

  const finishTour = useCallback(() => {
    setTourRunning(false);
    setTourIndex(0);
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsLoggingIn(true);

    try {
      const payload = await studentLogin({
        email: loginForm.email,
        password: loginForm.password,
      });
      storeToken(payload.token, payload.expiresAt);
      const nextDashboard = {
        user: payload.user,
        exams: payload.exams ?? [],
        activeSession: payload.activeSession ?? null,
        trials: payload.trials ?? [],
        leaderboards: payload.leaderboards ?? { classRoom: '', overall: [], classTop: [], currentStudent: null },
        generalFeedbackHistory: payload.generalFeedbackHistory ?? [],
      };
      setDashboard(nextDashboard);
      setSelectedExamId(
        nextDashboard.exams.find((exam) => exam.id === 'general')?.id ?? nextDashboard.exams[0]?.id ?? ''
      );
      setHelpForm((prev) => ({
        ...prev,
        fullName: payload.user?.fullName ?? prev.fullName,
        classRoom: payload.user?.classRoom ?? prev.classRoom,
        email: payload.user?.email ?? loginForm.email,
      }));
      setRegisterForm((prev) => ({
        ...prev,
        fullName: payload.user?.fullName ?? prev.fullName,
        classRoom: payload.user?.classRoom ?? prev.classRoom,
        email: payload.user?.email ?? prev.email,
        password: '',
        confirmPassword: '',
      }));
      setLoginForm((prev) => ({ ...prev, password: '' }));
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setInfoMessage('Login successful.');

      if (payload.activeSession) {
        await applyServerSession(payload.activeSession);
      } else {
        setPhase('setup');
      }
    } catch (error) {
      setErrorMessage(error.message || 'Could not login.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    if (registerForm.password !== registerForm.confirmPassword) {
      setErrorMessage('Password and confirmation do not match.');
      return;
    }

    setErrorMessage('');
    setIsRegistering(true);

    try {
      const payload = await studentRegister({
        fullName: registerForm.fullName,
        classRoom: registerForm.classRoom,
        email: registerForm.email,
        password: registerForm.password,
      });
      storeToken(payload.token, payload.expiresAt);

      const nextDashboard = {
        user: payload.user,
        exams: payload.exams ?? [],
        activeSession: payload.activeSession ?? null,
        trials: payload.trials ?? [],
        leaderboards: payload.leaderboards ?? { classRoom: '', overall: [], classTop: [], currentStudent: null },
        generalFeedbackHistory: payload.generalFeedbackHistory ?? [],
      };

      setDashboard(nextDashboard);
      setSelectedExamId(
        nextDashboard.exams.find((exam) => exam.id === 'general')?.id ?? nextDashboard.exams[0]?.id ?? ''
      );
      setHelpForm((prev) => ({
        ...prev,
        fullName: payload.user?.fullName ?? registerForm.fullName,
        classRoom: payload.user?.classRoom ?? registerForm.classRoom,
        email: payload.user?.email ?? registerForm.email,
      }));
      setLoginForm({
        email: payload.user?.email ?? registerForm.email,
        password: '',
      });
      setRegisterForm((prev) => ({
        ...prev,
        password: '',
        confirmPassword: '',
      }));
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPhase('setup');
      setAuthMode('login');
      setInfoMessage('Registration successful. You are now signed in.');
    } catch (error) {
      setErrorMessage(error.message || 'Could not register.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    setPhase('setup');
    setAuthMode('login');
    setTourRunning(false);
    setTourIndex(0);
    setSubmitConfirmArmed(false);
    setTrialReview(null);
    autoSubmitTriggeredRef.current = false;
    submitInProgressRef.current = false;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    setInfoMessage('Logged out.');
  };

  const handleStartSession = async () => {
    if (!authToken || !selectedExamId || isStarting) return;
    setErrorMessage('');
    setIsStarting(true);

    try {
      const created = await startSession(authToken, { examId: selectedExamId });
      autoSubmitTriggeredRef.current = false;
      setSubmitConfirmArmed(false);
      setSession(created);
      setCurrentIndex(0);
      setPhase('instructions');
      localStorage.setItem(ACTIVE_SESSION_KEY, created.sessionId);
      localStorage.setItem(ACTIVE_INDEX_KEY, '0');
      await refreshDashboard(authToken);
    } catch (error) {
      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not start exam session.');
      }
      void refreshDashboardSafely(authToken);
    } finally {
      setIsStarting(false);
    }
  };

  const beginExam = async () => {
    setPhase('exam');
    setTourRunning(true);
    setTourIndex(0);
    await startExamFullscreen();
  };

  const handlePickOption = (question, optionId) => {
    if (!session || !authToken) return;

    const previous = session.responses[question.id] ?? [];
    const selected =
      question.type === 'single'
        ? [optionId]
        : previous.includes(optionId)
          ? previous.filter((id) => id !== optionId)
          : [...previous, optionId];

    setSession((current) =>
      current
        ? {
            ...current,
            responses: {
              ...current.responses,
              [question.id]: selected,
            },
          }
        : current
    );

    void saveAnswer(authToken, session.sessionId, question.id, selected, currentIndex).catch(async (error) => {
      if (
        error?.status === 400 &&
        ['QUESTION_NOT_IN_SESSION', 'QUESTION_DETAILS_MISSING'].includes(error?.payload?.code)
      ) {
        try {
          const latest = await fetchSession(authToken, session.sessionId);
          const fallbackQuestion = latest?.questions?.[currentIndex] ?? null;
          if (!fallbackQuestion?.id) {
            setSession(latest);
            return;
          }

          const latestPrevious = latest.responses?.[fallbackQuestion.id] ?? [];
          const fallbackSelected =
            fallbackQuestion.type === 'single'
              ? [optionId]
              : latestPrevious.includes(optionId)
                ? latestPrevious.filter((id) => id !== optionId)
                : [...latestPrevious, optionId];

          const retry = await saveAnswer(
            authToken,
            latest.sessionId,
            fallbackQuestion.id,
            fallbackSelected,
            currentIndex
          );

          setSession({
            ...latest,
            responses: retry?.responses ?? {
              ...(latest.responses ?? {}),
              [fallbackQuestion.id]: fallbackSelected,
            },
          });
          setInfoMessage('Session synced. Answer saved.');
          return;
        } catch {
          // fall through to standard error handling
        }
      }

      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not save answer.');
      }
    });
  };

  const handleClearAnswer = () => {
    if (!session || !activeQuestion || !authToken) return;

    setSession((current) =>
      current
        ? {
            ...current,
            responses: {
              ...current.responses,
              [activeQuestion.id]: [],
            },
          }
        : current
    );

    void saveAnswer(authToken, session.sessionId, activeQuestion.id, [], currentIndex).catch(async (error) => {
      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not clear answer.');
      }
    });
  };

  const handleToggleFlag = () => {
    if (!session || !activeQuestion || !authToken) return;

    const nextFlagged = !session.flagged[activeQuestion.id];
    setSession((current) =>
      current
        ? {
            ...current,
            flagged: {
              ...current.flagged,
              [activeQuestion.id]: nextFlagged,
            },
          }
        : current
    );

    void saveFlag(
      authToken,
      session.sessionId,
      activeQuestion.id,
      nextFlagged,
      currentIndex
    ).catch(async (error) => {
      if (
        error?.status === 400 &&
        ['QUESTION_NOT_IN_SESSION', 'QUESTION_DETAILS_MISSING'].includes(error?.payload?.code)
      ) {
        try {
          const latest = await fetchSession(authToken, session.sessionId);
          setSession(latest);
          return;
        } catch {
          // fall through to standard error handling
        }
      }

      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not update flag status.');
      }
    });
  };

  const handleBackToDashboard = async () => {
    setSession(null);
    setCurrentIndex(0);
    setTourRunning(false);
    setTourIndex(0);
    setAuthMode('login');
    setSubmitConfirmArmed(false);
    setPhase('setup');
    clearStoredSession();
    autoSubmitTriggeredRef.current = false;
    submitInProgressRef.current = false;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }

    if (authToken) {
      try {
        await refreshDashboard(authToken);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not refresh dashboard.');
        }
      }
    }
  };

  const handleSaveFeedback = async (event) => {
    event.preventDefault();
    if (!session?.sessionId || !session.submittedAt || isSavingFeedback || !authToken) return;

    const rating = feedbackForm.rating ? Number(feedbackForm.rating) : null;
    const comment = feedbackForm.comment.trim();
    if (!rating && !comment) {
      setInfoMessage('Feedback skipped.');
      return;
    }

    setIsSavingFeedback(true);
    setErrorMessage('');

    try {
      const payload = await saveExamFeedback(authToken, session.sessionId, { rating, comment });
      if (payload?.session) {
        setSession(payload.session);
      } else if (payload?.feedback) {
        setSession((previous) => (previous ? { ...previous, feedback: payload.feedback } : previous));
      }
      setInfoMessage('Thanks. Feedback saved.');
      await refreshDashboard(authToken);
    } catch (error) {
      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not save feedback right now.');
      }
    } finally {
      setIsSavingFeedback(false);
    }
  };

  const handleSendPasswordHelp = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSendingHelp(true);

    try {
      await requestStudentPasswordHelp(helpForm);
      setHelpForm((prev) => ({ ...prev, message: '' }));
      setInfoMessage('Help request sent to admin.');
    } catch (error) {
      setErrorMessage(error.message || 'Could not send password-help request.');
    } finally {
      setIsSendingHelp(false);
    }
  };

  const handleSaveGeneralFeedback = async (event) => {
    event.preventDefault();
    if (!authToken || isSavingGeneralFeedback) {
      return;
    }

    const rating = generalFeedbackForm.rating ? Number(generalFeedbackForm.rating) : null;
    const comment = generalFeedbackForm.comment.trim();
    if (!rating && !comment) {
      setInfoMessage('Please add a rating or comment.');
      return;
    }

    setErrorMessage('');
    setIsSavingGeneralFeedback(true);

    try {
      const payload = await saveStudentGeneralFeedback(authToken, { rating, comment });
      setGeneralFeedbackForm({ rating: '', comment: '' });
      setDashboard((previous) =>
        previous
          ? {
              ...previous,
              generalFeedbackHistory: payload?.history ?? previous.generalFeedbackHistory ?? [],
            }
          : previous
      );
      setInfoMessage('Feedback sent. Thank you.');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not save feedback.');
      }
    } finally {
      setIsSavingGeneralFeedback(false);
    }
  };

  const handleDownloadReportCard = async (trialId) => {
    if (!authToken || !trialId) {
      return;
    }

    setErrorMessage('');
    try {
      await downloadStudentTrialReportCard(authToken, trialId, `report-card-${trialId}.html`);
      setInfoMessage('Report card downloaded.');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not download report card.');
      }
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    if (!authToken) return;
    if (!changePasswordForm.currentPassword || !changePasswordForm.newPassword) {
      setErrorMessage('Enter current password and a new password.');
      return;
    }
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setErrorMessage('New password and confirmation do not match.');
      return;
    }

    setErrorMessage('');
    setIsSavingPassword(true);

    try {
      const payload = await changeStudentPassword(authToken, {
        currentPassword: changePasswordForm.currentPassword,
        newPassword: changePasswordForm.newPassword,
      });
      const activeToken =
        typeof payload?.token === 'string' && payload.token && Number(payload?.expiresAt) > 0
          ? payload.token
          : authToken;
      if (activeToken !== authToken) {
        storeToken(payload.token, payload.expiresAt);
      }
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setInfoMessage('Password changed successfully.');
      await refreshDashboard(activeToken);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not change password.');
      }
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleOpenTrialReview = async (trialId) => {
    if (!authToken || !trialId) return;
    setIsReviewLoading(true);
    setErrorMessage('');
    try {
      const payload = await fetchStudentTrial(authToken, trialId);
      setTrialReview(payload.trial);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not load trial review.');
      }
    } finally {
      setIsReviewLoading(false);
    }
  };

  if (phase === 'loading') {
    return (
      <main className="center-screen">
        <div className="card-panel">
          <h1>Salem Academy CBT</h1>
          <p>Loading exam setup...</p>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="center-screen">
        <div className="card-panel">
          <h1>Unable to Load App</h1>
          <p>{errorMessage || 'Something went wrong while loading the exam app.'}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'setup') {
    if (!authToken) {
      return (
        <main className="center-screen">
          <div className="card-panel wide">
            <h1>Salem Academy CBT</h1>
            <p className="muted">Login with email and password, or register a new student account.</p>

            <div className="inline-actions">
              <button
                type="button"
                className={`btn ${authMode === 'login' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={`btn ${authMode === 'register' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>

            {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="form-stack">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                />

                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                />

                {errorMessage && <p className="error-text">{errorMessage}</p>}

                <button type="submit" className="btn btn-primary" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Signing In...' : 'Login'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="form-stack">
                <label htmlFor="registerFullName">Full Name</label>
                <input
                  id="registerFullName"
                  required
                  minLength={5}
                  value={registerForm.fullName}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, fullName: event.target.value }))}
                />

                <label htmlFor="registerClassRoom">Class</label>
                <select
                  id="registerClassRoom"
                  required
                  value={registerForm.classRoom}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, classRoom: event.target.value }))}
                >
                  <option value="">Select class</option>
                  {meta?.classOptions?.map((classOption) => (
                    <option key={classOption} value={classOption}>
                      {classOption}
                    </option>
                  ))}
                </select>

                <label htmlFor="registerEmail">Email</label>
                <input
                  id="registerEmail"
                  type="email"
                  required
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, email: event.target.value }))}
                />

                <label htmlFor="registerPassword">Password</label>
                <input
                  id="registerPassword"
                  type="password"
                  required
                  minLength={4}
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, password: event.target.value }))}
                />

                <label htmlFor="registerConfirmPassword">Confirm Password</label>
                <input
                  id="registerConfirmPassword"
                  type="password"
                  required
                  minLength={4}
                  value={registerForm.confirmPassword}
                  onChange={(event) =>
                    setRegisterForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                  }
                />

                {errorMessage && <p className="error-text">{errorMessage}</p>}

                <button type="submit" className="btn btn-primary" disabled={isRegistering}>
                  {isRegistering ? 'Creating Account...' : 'Create Account'}
                </button>
              </form>
            )}

            <details className="feedback-panel">
              <summary>
                <strong>Forgot password? Request admin help</strong>
              </summary>

              <form className="form-stack" onSubmit={handleSendPasswordHelp}>
                <label htmlFor="helpFullName">Full Name</label>
                <input
                  id="helpFullName"
                  required
                  value={helpForm.fullName}
                  onChange={(event) => setHelpForm((prev) => ({ ...prev, fullName: event.target.value }))}
                />

                <label htmlFor="helpClass">Class</label>
                <select
                  id="helpClass"
                  required
                  value={helpForm.classRoom}
                  onChange={(event) => setHelpForm((prev) => ({ ...prev, classRoom: event.target.value }))}
                >
                  <option value="">Select class</option>
                  {meta?.classOptions?.map((classOption) => (
                    <option key={classOption} value={classOption}>
                      {classOption}
                    </option>
                  ))}
                </select>

                <label htmlFor="helpEmail">Email</label>
                <input
                  id="helpEmail"
                  type="email"
                  required
                  value={helpForm.email}
                  onChange={(event) => setHelpForm((prev) => ({ ...prev, email: event.target.value }))}
                />

                <label htmlFor="helpMessage">Message (Optional)</label>
                <textarea
                  id="helpMessage"
                  rows={3}
                  value={helpForm.message}
                  onChange={(event) => setHelpForm((prev) => ({ ...prev, message: event.target.value }))}
                />

                <button type="submit" className="btn btn-outline" disabled={isSendingHelp}>
                  {isSendingHelp ? 'Sending...' : 'Send Help Request'}
                </button>
              </form>
            </details>
          </div>
        </main>
      );
    }

    return (
      <main className="center-screen">
        <div className="card-panel wide">
          <h1>Student Dashboard</h1>
          <p>
            <strong>{dashboard?.user?.fullName}</strong> | {dashboard?.user?.classRoom} | {dashboard?.user?.email}
          </p>
          <p className="muted">
            Session expires: <strong>{formatDateTime(authExpiresAt)}</strong>
          </p>
          {dashboard?.user?.mustChangePassword && (
            <p className="error-text">Please change your password now for account security.</p>
          )}

          <div className="feedback-panel">
            <h3>Start Exam</h3>
            <div className="form-stack">
              <label htmlFor="examId">Exam</label>
              <select id="examId" value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)}>
                <option value="">Select exam</option>
                {(dashboard?.exams ?? []).map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title}
                  </option>
                ))}
              </select>
            </div>

            {selectedExam && (
              <div className="result-grid">
                <div className="result-box">
                  <span>Attempts Used</span>
                  <strong>
                    {selectedExam.attemptsUsed}/{selectedExam.maxAttempts}
                  </strong>
                </div>
                <div className="result-box">
                  <span>Attempts Left</span>
                  <strong>{selectedExam.attemptsRemaining}</strong>
                </div>
                <div className="result-box">
                  <span>Best Score</span>
                  <strong>{selectedExam.bestFinalPercent ?? 0}%</strong>
                </div>
                <div className="result-box">
                  <span>Duration</span>
                  <strong>{formatTime(selectedExam.durationSeconds ?? 0)}</strong>
                </div>
              </div>
            )}

            <div className="inline-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartSession}
                disabled={isStarting || !selectedExam || !selectedExam.canAttempt}
              >
                {isStarting ? 'Starting...' : 'Start New Trial'}
              </button>

              {dashboard?.activeSession && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void applyServerSession(dashboard.activeSession)}
                >
                  Resume Active Trial
                </button>
              )}

              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void refreshDashboardSafely(authToken)}
              >
                Refresh Dashboard
              </button>
            </div>
            {selectedExam && !selectedExam.canAttempt && <p className="error-text">Attempt limit reached.</p>}
          </div>

          <div className="feedback-panel">
            <h3>Leaderboard</h3>
            <p className="muted">
              Overall rank: <strong>{currentLeaderboard?.overallRank ?? '-'}</strong> | Class rank:{' '}
              <strong>{currentLeaderboard?.classRank ?? '-'}</strong>
            </p>
            <div className="result-grid">
              <div className="result-box">
                <span>Best Score</span>
                <strong>{currentLeaderboard?.bestFinalPercent ?? 0}%</strong>
              </div>
              <div className="result-box">
                <span>Average Score</span>
                <strong>{currentLeaderboard?.averageFinalPercent ?? 0}%</strong>
              </div>
              <div className="result-box">
                <span>Submitted Trials</span>
                <strong>{currentLeaderboard?.submittedTrials ?? 0}</strong>
              </div>
            </div>

            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th colSpan={4}>Class Top ({dashboard?.leaderboards?.classRoom || '-'})</th>
                  </tr>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Best %</th>
                    <th>Trials</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardClassTop.slice(0, 10).map((entry) => (
                    <tr key={`class-${entry.rank}-${entry.studentName}`}>
                      <td>{entry.rank}</td>
                      <td>
                        {entry.studentName}
                        {entry.isCurrentStudent ? ' (You)' : ''}
                      </td>
                      <td>{entry.bestFinalPercent}%</td>
                      <td>{entry.submittedTrials}</td>
                    </tr>
                  ))}
                  {!leaderboardClassTop.length && (
                    <tr>
                      <td colSpan={4}>No class leaderboard data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th colSpan={5}>Overall Top</th>
                  </tr>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Class</th>
                    <th>Best %</th>
                    <th>Trials</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardOverall.slice(0, 10).map((entry) => (
                    <tr key={`overall-${entry.rank}-${entry.studentName}-${entry.classRoom}`}>
                      <td>{entry.rank}</td>
                      <td>
                        {entry.studentName}
                        {entry.isCurrentStudent ? ' (You)' : ''}
                      </td>
                      <td>{entry.classRoom}</td>
                      <td>{entry.bestFinalPercent}%</td>
                      <td>{entry.submittedTrials}</td>
                    </tr>
                  ))}
                  {!leaderboardOverall.length && (
                    <tr>
                      <td colSpan={5}>No leaderboard data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form className="feedback-panel" onSubmit={handleSaveGeneralFeedback}>
            <h3>General Feedback</h3>
            <p className="muted">Share general app feedback directly from your dashboard.</p>
            <div className="feedback-grid">
              <div>
                <label htmlFor="generalRating">Rating (1 to 5)</label>
                <select
                  id="generalRating"
                  value={generalFeedbackForm.rating}
                  onChange={(event) =>
                    setGeneralFeedbackForm((previous) => ({ ...previous, rating: event.target.value }))
                  }
                >
                  <option value="">No rating</option>
                  <option value="1">1 - Poor</option>
                  <option value="2">2 - Fair</option>
                  <option value="3">3 - Okay</option>
                  <option value="4">4 - Good</option>
                  <option value="5">5 - Excellent</option>
                </select>
              </div>
              <div>
                <label htmlFor="generalComment">Comment</label>
                <textarea
                  id="generalComment"
                  rows={3}
                  maxLength={600}
                  value={generalFeedbackForm.comment}
                  onChange={(event) =>
                    setGeneralFeedbackForm((previous) => ({ ...previous, comment: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="inline-actions">
              <button type="submit" className="btn btn-outline" disabled={isSavingGeneralFeedback}>
                {isSavingGeneralFeedback ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Rating</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {generalFeedbackHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.rating ?? '-'}</td>
                      <td title={entry.comment || '-'}>
                        <span className="truncate-2">{entry.comment || '-'}</span>
                      </td>
                    </tr>
                  ))}
                  {!generalFeedbackHistory.length && (
                    <tr>
                      <td colSpan={3}>No general feedback sent yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </form>

          <form className="feedback-panel" onSubmit={handleChangePassword}>
            <h3>Change Password</h3>
            <div className="feedback-grid">
              <div>
                <label htmlFor="currentPassword">Current Password</label>
                <input
                  id="currentPassword"
                  type="password"
                  value={changePasswordForm.currentPassword}
                  onChange={(event) =>
                    setChangePasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  value={changePasswordForm.newPassword}
                  onChange={(event) =>
                    setChangePasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="form-stack">
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={changePasswordForm.confirmPassword}
                onChange={(event) =>
                  setChangePasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                }
              />
            </div>

            <div className="inline-actions">
              <button type="submit" className="btn btn-outline" disabled={isSavingPassword}>
                {isSavingPassword ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </form>

          <div className="feedback-panel">
            <h3>Previous Trials</h3>
            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th>Exam</th>
                    <th>Trial</th>
                    <th>Status</th>
                    <th>Final %</th>
                    <th>Violations</th>
                    <th>Started</th>
                    <th>Corrections</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.trials ?? []).map((trial) => (
                    <tr key={trial.id}>
                      <td title={trial.exam?.title}>
                        <span className="truncate-line">{trial.exam?.title ?? '-'}</span>
                      </td>
                      <td>#{trial.trialNumber ?? 1}</td>
                      <td>{trial.status}</td>
                      <td>{`${trial.summary?.finalPercent ?? 0}%`}</td>
                      <td>{trial.summary?.totalViolationsCount ?? trial.summary?.violationsCount ?? 0}</td>
                      <td>{formatDateTime(trial.startedAt)}</td>
                      <td>
                        {trial.resultsReleased
                          ? 'Open'
                          : `Opens ${formatDateTime(trial.resultsAvailableAt)}`}
                      </td>
                      <td className="cell-tight">
                        <div className="inline-actions compact">
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => handleOpenTrialReview(trial.id)}
                            disabled={isReviewLoading}
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => void handleDownloadReportCard(trial.id)}
                          >
                            Report
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!(dashboard?.trials ?? []).length && (
                    <tr>
                      <td colSpan={8}>No trials yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {errorMessage && <p className="error-text">{errorMessage}</p>}
          <div className="inline-actions">
            <button type="button" className="btn btn-danger" onClick={handleLogout}>
              Logout
            </button>
          </div>

          {trialReview && (
            <div className="modal-backdrop" onClick={() => setTrialReview(null)}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-title-row">
                  <h2>
                    Trial Review: {trialReview.exam?.title} #{trialReview.trialNumber}
                  </h2>
                  <button type="button" className="btn btn-outline btn-xs" onClick={() => setTrialReview(null)}>
                    Close
                  </button>
                </div>
                {trialReview.resultsReleased === false && (
                  <p className="muted">
                    Corrections are locked until <strong>{formatDateTime(trialReview.resultsAvailableAt)}</strong>.
                    You can still see the answers you selected.
                  </p>
                )}

                <div className="table-wrap large">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Question</th>
                        <th>Selected</th>
                        {trialReview.resultsReleased !== false && <th>Correct</th>}
                        {trialReview.resultsReleased !== false && <th>Result</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(trialReview.questionReview ?? []).map((item) => (
                        <tr key={`${trialReview.id}-${item.questionId}`}>
                          <td>{item.index}</td>
                          <td title={item.text}>
                            <span className="truncate-2">{item.text}</span>
                          </td>
                          <td>{(item.selectedOptionIds ?? []).join(', ') || '-'}</td>
                          {trialReview.resultsReleased !== false && (
                            <td>{(item.correctOptionIds ?? []).join(', ') || '-'}</td>
                          )}
                          {trialReview.resultsReleased !== false && (
                            <td>
                              {item.isCorrect === null || item.isCorrect === undefined
                                ? 'Locked'
                                : item.isCorrect
                                  ? 'Correct'
                                  : 'Wrong'}
                            </td>
                          )}
                        </tr>
                      ))}
                      {!(trialReview.questionReview ?? []).length && (
                        <tr>
                          <td colSpan={trialReview.resultsReleased === false ? 3 : 5}>No review data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (phase === 'instructions') {
    return (
      <main className="center-screen">
        <div className="card-panel wide">
          <h1>Exam Instructions</h1>
          <p>
            Candidate: <strong>{session?.student.fullName}</strong> | Class: <strong>{session?.student.classRoom}</strong>
          </p>
          <p>
            Exam: <strong>{session?.exam?.title ?? 'General Exam Pool'}</strong> | Trial{' '}
            <strong>
              #{session?.trialNumber ?? 1}
              {session?.exam?.maxAttempts ? `/${session.exam.maxAttempts}` : ''}
            </strong>
          </p>
          <p className="muted">Results will be sent to {session?.student.email} before end of day.</p>

          <ul className="rules-list">
            <li>Total questions: {session?.questions?.length ?? meta?.questionCount ?? 40}</li>
            <li>Time allowed: {formatTime(session?.durationSeconds ?? meta?.durationSeconds ?? 1500)}</li>
            <li>Questions are in random order for each student.</li>
            <li>Use the palette to jump between questions.</li>
            <li>Violation warning: each active violation can reduce score by {meta?.penaltyPerViolation ?? 2}%.</li>
          </ul>

          <div className="inline-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void handleBackToDashboard()}>
              Back to Dashboard
            </button>
            <button type="button" className="btn btn-primary" onClick={beginExam}>
              Start Exam
            </button>
          </div>

          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </div>
      </main>
    );
  }

  if (phase === 'result' && session) {
    const summary = session.summary;
    const resultReviewRows = Array.isArray(session.questionReview) && session.questionReview.length > 0
      ? session.questionReview
      : (session.questions ?? []).map((question, index) => ({
          index: index + 1,
          questionId: question.id,
          text: question.text,
          options: question.options,
          selectedOptionIds: session.responses?.[question.id] ?? [],
          correctOptionIds: [],
          isCorrect: null,
        }));

    return (
      <main className="center-screen">
        <div className="card-panel wide">
          <h1>Exam Submitted</h1>
          <p>
            Student: <strong>{session.student.fullName}</strong> | Class: <strong>{session.student.classRoom}</strong>
          </p>
          <p>
            Exam: <strong>{session.exam?.title ?? 'General Exam Pool'}</strong> | Trial{' '}
            <strong>#{session.trialNumber ?? 1}</strong>
          </p>

          <div className="result-grid">
            <div className="result-box">
              <span>Answered</span>
              <strong>
                {summary?.answeredCount ?? 0}/{summary?.totalQuestions ?? 40}
              </strong>
            </div>
            <div className="result-box">
              <span>Correct</span>
              <strong>
                {summary?.correctCount ?? 0}/{summary?.totalQuestions ?? 40}
              </strong>
            </div>
            <div className="result-box">
              <span>Raw Score</span>
              <strong>{summary?.rawPercent ?? 0}%</strong>
            </div>
            <div className="result-box">
              <span>Active Violations</span>
              <strong>{summary?.violationsCount ?? 0}</strong>
            </div>
            <div className="result-box">
              <span>Total Violations</span>
              <strong>{summary?.totalViolationsCount ?? 0}</strong>
            </div>
            <div className="result-box final">
              <span>Final Score</span>
              <strong>{summary?.finalPercent ?? 0}%</strong>
            </div>
          </div>

          {resultsLocked && (
            <div className="feedback-panel">
              <h3>Corrections Locked</h3>
              <p className="muted">
                Results and corrections will open in <strong>{formatTime(resultReleaseInSeconds)}</strong>.
              </p>
              <p className="muted">
                Opens at <strong>{formatDateTime(session.resultsAvailableAt)}</strong>.
              </p>
            </div>
          )}

          <p className="muted">
            Results will be sent to <strong>{session.student.email}</strong> before end of day.
          </p>

          <div className="feedback-panel">
            <h3>Answer Review</h3>
            <div className="table-wrap medium">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Question</th>
                    <th>Your Answer</th>
                    {!resultsLocked && <th>Correct Answer</th>}
                    {!resultsLocked && <th>Result</th>}
                  </tr>
                </thead>
                <tbody>
                  {resultReviewRows.map((item) => (
                    <tr key={`${session.sessionId}-${item.questionId}`}>
                      <td>{item.index}</td>
                      <td title={item.text}>
                        <span className="truncate-2">{item.text}</span>
                      </td>
                      <td title={formatOptionList(item, item.selectedOptionIds)}>
                        <span className="truncate-2">{formatOptionList(item, item.selectedOptionIds)}</span>
                      </td>
                      {!resultsLocked && (
                        <td title={formatOptionList(item, item.correctOptionIds)}>
                          <span className="truncate-2">{formatOptionList(item, item.correctOptionIds)}</span>
                        </td>
                      )}
                      {!resultsLocked && (
                        <td>
                          {item.isCorrect === null || item.isCorrect === undefined
                            ? '-'
                            : item.isCorrect
                              ? 'Correct'
                              : 'Wrong'}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!resultReviewRows.length && (
                    <tr>
                      <td colSpan={resultsLocked ? 3 : 5}>No review data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form className="feedback-panel" onSubmit={handleSaveFeedback}>
            <h3>Optional Rating & Feedback</h3>
            <div className="feedback-grid">
              <div>
                <label htmlFor="feedbackRating">Rating (1 to 5)</label>
                <select
                  id="feedbackRating"
                  value={feedbackForm.rating}
                  onChange={(event) => setFeedbackForm((prev) => ({ ...prev, rating: event.target.value }))}
                >
                  <option value="">No rating</option>
                  <option value="1">1 - Poor</option>
                  <option value="2">2 - Fair</option>
                  <option value="3">3 - Okay</option>
                  <option value="4">4 - Good</option>
                  <option value="5">5 - Excellent</option>
                </select>
              </div>

              <div>
                <label htmlFor="feedbackComment">Comment</label>
                <textarea
                  id="feedbackComment"
                  value={feedbackForm.comment}
                  onChange={(event) => setFeedbackForm((prev) => ({ ...prev, comment: event.target.value }))}
                  maxLength={600}
                  rows={3}
                />
              </div>
            </div>

            <div className="inline-actions">
              <button type="submit" className="btn btn-outline" disabled={isSavingFeedback}>
                {isSavingFeedback ? 'Saving...' : 'Save Feedback'}
              </button>
              {session.feedback && (
                <p className="muted">Saved at {formatDateTime(session.feedback.submittedAt)}</p>
              )}
            </div>
          </form>

          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void handleDownloadReportCard(session.sessionId)}
            >
              Download Report Card
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleBackToDashboard()}>
              Back to Dashboard
            </button>
            <button type="button" className="btn btn-danger" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </main>
    );
  }

  const responses = session?.responses ?? {};
  const flagged = session?.flagged ?? {};
  const seen = session?.seen ?? {};
  const answeredCount = session?.questions
    ? session.questions.filter((question) => (responses[question.id] ?? []).length > 0).length
    : 0;
  const unansweredCount = (session?.questions?.length ?? 0) - answeredCount;
  const violationCount = session?.violations?.length ?? 0;

  return (
    <main className="exam-shell">
      {infoMessage && <div className="toast info">{infoMessage}</div>}
      {errorMessage && <div className="toast error">{errorMessage}</div>}

      <header className="exam-header">
        <div>
          <h1>Salem Academy CBT</h1>
          <p>
            {session?.student.fullName} | {session?.student.classRoom}
          </p>
          <p>
            {session?.exam?.title ?? 'General Exam Pool'} | Trial #{session?.trialNumber ?? 1}
            {session?.exam?.maxAttempts ? `/${session.exam.maxAttempts}` : ''}
          </p>
        </div>

        <div className="header-status">
          <div className="stat-pill tour-timer">
            <span>Time Left</span>
            <strong>{formatTime(session?.remainingSeconds ?? 0)}</strong>
          </div>

          <div className="stat-pill tour-violation">
            <span>Violations</span>
            <strong>{violationCount}</strong>
          </div>

          <div className="stat-pill">
            <span>Answered</span>
            <strong>{answeredCount}</strong>
          </div>

          <div className="stat-pill">
            <span>Unanswered</span>
            <strong>{unansweredCount}</strong>
          </div>

          <button type="button" className="btn btn-outline" onClick={startExamFullscreen}>
            {isFullscreen ? 'Fullscreen Active' : 'Go Full Screen'}
          </button>

          <button
            type="button"
            className={`btn ${submitConfirmArmed ? 'btn-warning' : 'btn-danger'}`}
            onClick={() => void handleSubmit('manual')}
          >
            {isSubmitting ? 'Submitting...' : submitConfirmArmed ? 'Confirm Submit' : 'Submit Exam'}
          </button>
        </div>
      </header>

      <section className="question-area tour-question">
        <p className="question-number">
          Question {currentIndex + 1} of {session?.questions.length ?? 0}
        </p>
        <h2>{activeQuestion?.text}</h2>
        <p className="muted">
          {activeQuestion?.type === 'multi'
            ? 'This question has more than one correct answer. Pick all that apply.'
            : 'Pick one answer.'}
        </p>

        <div className="options-list">
          {activeQuestion?.options.map((option) => {
            const chosen = (responses[activeQuestion.id] ?? []).includes(option.id);
            const controlType = activeQuestion.type === 'single' ? 'radio' : 'checkbox';

            return (
              <label key={option.id} className={`option-card ${chosen ? 'selected' : ''}`}>
                <input
                  type={controlType}
                  name={activeQuestion.id}
                  checked={chosen}
                  onChange={() => handlePickOption(activeQuestion, option.id)}
                />
                <span className="option-label">
                  {option.id}. {option.text}
                </span>
              </label>
            );
          })}
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={currentIndex === 0}
          >
            Previous
          </button>

          <button type="button" className="btn btn-outline" onClick={handleClearAnswer}>
            Clear Answer
          </button>

          <button
            type="button"
            className={`btn ${flagged[activeQuestion?.id] ? 'btn-warning' : 'btn-outline'}`}
            onClick={handleToggleFlag}
          >
            {flagged[activeQuestion?.id] ? 'Unflag' : 'Flag'}
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCurrentIndex((index) => Math.min((session?.questions.length ?? 1) - 1, index + 1))}
            disabled={currentIndex >= (session?.questions.length ?? 1) - 1}
          >
            Next
          </button>
        </div>
      </section>

      <section className="palette-panel tour-palette">
        <div className="palette-header">
          <h3>Question Menu</h3>
          <p>Jump to any question</p>
        </div>

        <div className="palette-grid">
          {session?.questions.map((question, index) => {
            const status = getQuestionStatus(question.id, seen, responses, flagged);
            const isCurrent = index === currentIndex;

            return (
              <button
                key={question.id}
                type="button"
                className={`palette-btn ${status} ${isCurrent ? 'current' : ''}`}
                onClick={() => setCurrentIndex(index)}
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        <div className="legend-row">
          <span><i className="legend-dot answered" />Answered</span>
          <span><i className="legend-dot unanswered" />Unanswered</span>
          <span><i className="legend-dot flagged" />Flagged</span>
          <span><i className="legend-dot unread" />Unread</span>
        </div>
      </section>

      {tourRunning && (
        <div className={`tour-overlay ${TOUR_STEPS[tourIndex]?.dock === 'top' ? 'dock-top' : 'dock-bottom'}`}>
          <div className="tour-card">
            <p className="tour-step">
              Step {tourIndex + 1} of {TOUR_STEPS.length}
            </p>
            <h3>{TOUR_STEPS[tourIndex]?.title}</h3>
            <p>{TOUR_STEPS[tourIndex]?.text}</p>

            <div className="inline-actions">
              <button type="button" className="btn btn-secondary" onClick={finishTour}>
                Skip Tour
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={tourIndex === 0}
                onClick={() => setTourIndex((index) => Math.max(0, index - 1))}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (tourIndex >= TOUR_STEPS.length - 1) {
                    finishTour();
                    return;
                  }
                  setTourIndex((index) => Math.min(index + 1, TOUR_STEPS.length - 1));
                }}
              >
                {tourIndex >= TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

export default StudentExamApp;
