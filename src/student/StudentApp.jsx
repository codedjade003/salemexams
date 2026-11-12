import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import {
  changeStudentPassword,
  disputeViolation,
  downloadStudentTrialReportCard,
  fetchMeta,
  fetchSession,
  fetchStudentMe,
  fetchStudentTrial,
  logViolation,
  markSeen,
  requestHint,
  requestStudentPasswordHelp,
  saveExamFeedback,
  saveFlag,
  saveStudentGeneralFeedback,
  startSession,
  studentLogin,
  studentLogout,
  studentRegister,
  submitExam,
} from '../api';
import { BrandLogo, FullPageLoader, Toasts } from '../components/ui';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from '../lib/hooks';
import { checkProgram } from '../lib/python';
import { AnswerQueue, clearStoredPending } from './answerQueue';
import AuthScreen from './AuthScreen';
import Dashboard from './Dashboard';
import ExamRoom from './ExamRoom';
import ExamSetup from './ExamSetup';
import PasswordGate from './PasswordGate';
import ResultScreen from './ResultScreen';
import { TOUR_STEPS } from './tourSteps';
import { useProctoring } from './useProctoring';

const ACTIVE_SESSION_KEY = 'salem_exam_active_session';
const ACTIVE_INDEX_KEY = 'salem_exam_active_index';
const STUDENT_TOKEN_KEY = 'salem_student_token';
const STUDENT_TOKEN_EXPIRES_KEY = 'salem_student_token_expires_at';
const TOUR_SEEN_KEY = 'salem_exam_tour_seen';
const STUDENT_IDLE_TIMEOUT_MS_INPUT = Number(import.meta.env.VITE_STUDENT_IDLE_TIMEOUT_MS ?? 3 * 60 * 1000);
const STUDENT_IDLE_TIMEOUT_MS =
  Number.isFinite(STUDENT_IDLE_TIMEOUT_MS_INPUT) && STUDENT_IDLE_TIMEOUT_MS_INPUT >= 30_000
    ? Math.round(STUDENT_IDLE_TIMEOUT_MS_INPUT)
    : 3 * 60 * 1000;
const STUDENT_IDLE_TIMEOUT_MINUTES = Math.max(1, Math.round(STUDENT_IDLE_TIMEOUT_MS / 60_000));

const EMPTY_LEADERBOARDS = { classRoom: '', overall: [], classTop: [], currentStudent: null };
const EMPTY_SYNC = { pending: 0, status: 'saved' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toDashboard(payload) {
  return {
    user: payload.user,
    exams: payload.exams ?? [],
    activeSession: payload.activeSession ?? null,
    trials: payload.trials ?? [],
    leaderboards: payload.leaderboards ?? EMPTY_LEADERBOARDS,
    generalFeedbackHistory: payload.generalFeedbackHistory ?? [],
  };
}

// Only a missing/expired token (401) or a disabled account ends the session. Other 403s (for
// example "this exam is not available for your class") are ordinary errors.
function isAuthFailure(error) {
  if (!error) return false;
  if (error.status === 401) return true;
  return error.status === 403 && /disabled/i.test(String(error.message ?? ''));
}

function isRetryable(error) {
  return Boolean(error?.isNetworkError) || error?.status === 0 || error?.status === 429 || error?.status >= 500;
}

function StudentApp() {
  const [meta, setMeta] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [authToken, setAuthToken] = useState('');
  const [authExpiresAt, setAuthExpiresAt] = useState(0);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardTab, setDashboardTab] = useState('exams');

  const [authMode, setAuthMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ firstName: '', middleName: '', lastName: '', classRoom: '', username: '' });
  const [helpForm, setHelpForm] = useState({ firstName: '', lastName: '', classRoom: '', username: '', message: '' });
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const [selectedExamId, setSelectedExamId] = useState('');
  const [session, setSession] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tourRunning, setTourRunning] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [trialReview, setTrialReview] = useState(null);
  const [needsResume, setNeedsResume] = useState(false);
  const [syncState, setSyncState] = useState(EMPTY_SYNC);
  const [cameraState, setCameraState] = useState('idle');
  const [cameraStream, setCameraStream] = useState(null);

  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [isSavingGeneralFeedback, setIsSavingGeneralFeedback] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSendingHelp, setIsSendingHelp] = useState(false);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [feedbackForm, setFeedbackForm] = useState({ rating: '', comment: '' });
  const [generalFeedbackForm, setGeneralFeedbackForm] = useState({ rating: '', comment: '' });
  const [resultReleaseNow, setResultReleaseNow] = useState(Date.now());

  const seenSyncBlockedRef = useRef(new Set());
  const autoSubmitTriggeredRef = useRef(false);
  const submitInProgressRef = useRef(false);
  const queueRef = useRef(null);
  const sessionRef = useRef(null);
  const tokenRef = useRef('');
  const cameraStreamRef = useRef(null);
  const fatalSyncRef = useRef(null);
  const submitRef = useRef(null);

  useEffect(() => {
    sessionRef.current = session;
    tokenRef.current = authToken;
  });

  const branding = useMemo(
    () => meta?.branding ?? { schoolName: meta?.schoolName ?? 'Salem Academy', logoUrl: '' },
    [meta]
  );

  useEffect(() => {
    document.title = `${branding.schoolName || 'Salem Academy'} · Exams`;
  }, [branding.schoolName]);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraState((state) => (state === 'on' ? 'idle' : state));
  }, []);

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('missing');
      return false;
    }
    setCameraState('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      setCameraState('on');
      return true;
    } catch (error) {
      setCameraState(['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(error?.name) ? 'missing' : 'denied');
      return false;
    }
  }, []);

  const clearStoredSession = useCallback(() => {
    safeStorageRemove(ACTIVE_SESSION_KEY);
    safeStorageRemove(ACTIVE_INDEX_KEY);
  }, []);

  const storeToken = useCallback((token, expiresAt) => {
    safeStorageSet(STUDENT_TOKEN_KEY, token);
    safeStorageSet(STUDENT_TOKEN_EXPIRES_KEY, String(expiresAt));
    setAuthToken(token);
    setAuthExpiresAt(expiresAt);
  }, []);

  // Signing out never deletes unsent answers: they stay in this browser until the same exam is
  // opened again, so a student who is signed out mid-exam loses nothing.
  const clearAuth = useCallback(() => {
    safeStorageRemove(STUDENT_TOKEN_KEY);
    safeStorageRemove(STUDENT_TOKEN_EXPIRES_KEY);
    setAuthToken('');
    setAuthExpiresAt(0);
    setDashboard(null);
    setSession(null);
    setSelectedExamId('');
    setCurrentIndex(0);
    setDashboardTab('exams');
    setTrialReview(null);
    setSubmitDialogOpen(false);
    setTourRunning(false);
    setNeedsResume(false);
    clearStoredSession();
    stopCamera();
  }, [clearStoredSession, stopCamera]);

  const handleUnauthorized = useCallback(
    (error) => {
      if (!isAuthFailure(error)) {
        return false;
      }
      clearAuth();
      setPhase('setup');
      setErrorMessage(
        error.status === 403 ? error.message : 'You were signed out. Sign in again to continue; your exam and answers are saved.'
      );
      return true;
    },
    [clearAuth]
  );

  const refreshDashboard = useCallback(async (token) => {
    if (!token) return null;
    const payload = await fetchStudentMe(token);
    const nextDashboard = toDashboard(payload);
    setDashboard(nextDashboard);
    return nextDashboard;
  }, []);

  const refreshDashboardSafely = useCallback(
    async (token, fallbackMessage = 'Could not refresh your dashboard.') => {
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

  /** Shows a session from the server: the exam room if it is still running, otherwise results. */
  const applyServerSession = useCallback(
    async (serverSession, { resumed = true } = {}) => {
      if (!serverSession) return;
      setSession(serverSession);
      setSelectedExamId(serverSession.exam?.id ?? '');
      if (serverSession.submittedAt || serverSession.remainingSeconds <= 0) {
        clearStoredSession();
        clearStoredPending(serverSession.sessionId);
        setResultReleaseNow(Date.now());
        setNeedsResume(false);
        stopCamera();
        setPhase('result');
      } else {
        if (safeStorageGet(ACTIVE_SESSION_KEY) === serverSession.sessionId) {
          const storedIndex = Number(safeStorageGet(ACTIVE_INDEX_KEY));
          const lastIndex = Math.max(0, (serverSession.questions?.length ?? 1) - 1);
          setCurrentIndex(Number.isInteger(storedIndex) && storedIndex >= 0 ? Math.min(storedIndex, lastIndex) : 0);
        } else {
          setCurrentIndex(0);
        }
        safeStorageSet(ACTIVE_SESSION_KEY, serverSession.sessionId);
        autoSubmitTriggeredRef.current = false;
        submitInProgressRef.current = false;
        if (resumed) setNeedsResume(true);
        setPhase('exam');
      }
      if (tokenRef.current) {
        try {
          await refreshDashboard(tokenRef.current);
        } catch {
          // best effort
        }
      }
    },
    [clearStoredSession, refreshDashboard, stopCamera]
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

  const prefillFormsFromUser = useCallback((user) => {
    if (!user) return;
    setLoginForm({ identifier: user.username || user.email || '', password: '' });
    setHelpForm((prev) => ({
      ...prev,
      firstName: user.firstName || prev.firstName,
      lastName: user.lastName || prev.lastName,
      classRoom: user.classRoom ?? prev.classRoom,
      username: user.username ?? prev.username,
    }));
    setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
  }, []);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      try {
        const metadata = await fetchMeta();
        if (!alive) return;
        setMeta(metadata);

        const savedToken = safeStorageGet(STUDENT_TOKEN_KEY) ?? '';
        const savedExpiresAt = Number(safeStorageGet(STUDENT_TOKEN_EXPIRES_KEY) ?? '0');
        const tokenValid = savedToken && Number.isFinite(savedExpiresAt) && savedExpiresAt > Date.now();

        if (!tokenValid) {
          setPhase('setup');
          return;
        }

        storeToken(savedToken, savedExpiresAt);
        tokenRef.current = savedToken;
        try {
          const next = await refreshDashboard(savedToken);
          if (!alive) return;
          prefillFormsFromUser(next?.user);

          if (next?.activeSession) {
            await applyServerSession(next.activeSession);
            return;
          }

          const savedSessionId = safeStorageGet(ACTIVE_SESSION_KEY);
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
          if (isAuthFailure(error)) {
            clearAuth();
            setErrorMessage('Please sign in again.');
          } else {
            clearAuth();
            setErrorMessage(error.message || 'Could not load your dashboard.');
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
  }, [applyServerSession, clearAuth, clearStoredSession, prefillFormsFromUser, refreshDashboard, storeToken]);

  useEffect(() => {
    if (!authToken || !Number.isFinite(authExpiresAt) || authExpiresAt <= 0) {
      return undefined;
    }

    const expire = () => {
      clearAuth();
      setPhase('setup');
      setErrorMessage('Your session timed out. Please sign in again.');
    };

    const timeoutMs = authExpiresAt - Date.now();
    if (timeoutMs <= 0) {
      expire();
      return undefined;
    }

    const timeoutId = setTimeout(expire, timeoutMs);
    return () => clearTimeout(timeoutId);
  }, [authExpiresAt, authToken, clearAuth]);

  // Idle sign-out on shared lab computers (never during an exam or its setup).
  useEffect(() => {
    const shouldTrackIdle = Boolean(authToken) && ['setup', 'result'].includes(phase);
    if (!shouldTrackIdle) {
      return undefined;
    }

    let timeoutId;
    const handleIdleTimeout = () => {
      void studentLogout(authToken).catch(() => undefined);
      clearAuth();
      setPhase('setup');
      setAuthMode('login');
      setInfoMessage(`Signed out after ${STUDENT_IDLE_TIMEOUT_MINUTES} minute(s) of inactivity.`);
    };

    const resetIdleTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleIdleTimeout, STUDENT_IDLE_TIMEOUT_MS);
    };

    const events = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    resetIdleTimer();

    return () => {
      clearTimeout(timeoutId);
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
    };
  }, [authToken, clearAuth, phase]);

  useEffect(() => {
    if (!infoMessage) return undefined;
    const id = setTimeout(() => setInfoMessage(''), 4200);
    return () => clearTimeout(id);
  }, [infoMessage]);

  // Errors on the sign-in forms and the start step stay visible inline; elsewhere they are toasts.
  useEffect(() => {
    const shownInline = (phase === 'setup' && !authToken) || phase === 'exam-setup';
    if (!errorMessage || shownInline) return undefined;
    const id = setTimeout(() => setErrorMessage(''), 7000);
    return () => clearTimeout(id);
  }, [authToken, errorMessage, phase]);

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

  // Only a submitted exam clears the saved place. (Clearing whenever there was no session wiped
  // it on every page load, before the resume code could read which question the student was on.)
  useEffect(() => {
    if (!session) return;
    if (session.submittedAt) {
      clearStoredSession();
      return;
    }
    safeStorageSet(ACTIVE_SESSION_KEY, session.sessionId);
  }, [clearStoredSession, session]);

  useEffect(() => {
    if (phase !== 'exam') return;
    safeStorageSet(ACTIVE_INDEX_KEY, String(currentIndex));
  }, [phase, currentIndex]);

  // Countdown. The server decides when time is really up; this only drives the display.
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

  // The answer queue lives for as long as one exam is open in the exam room.
  const activeSessionId = phase === 'exam' && session && !session.submittedAt ? session.sessionId : '';
  useEffect(() => {
    if (!activeSessionId) return undefined;

    const queue = new AnswerQueue({
      sessionId: activeSessionId,
      getToken: () => tokenRef.current,
      onState: setSyncState,
      onFatal: (error) => fatalSyncRef.current?.(error),
    });
    queueRef.current = queue;

    // Answers given before a refresh or sign-out that never reached the server: show them again
    // and send them first.
    const stored = queue.snapshot();
    if (Object.keys(stored).length) {
      setSession((current) => (current ? { ...current, responses: { ...current.responses, ...stored } } : current));
      void queue.flush();
    } else {
      setSyncState(EMPTY_SYNC);
    }

    const onOnline = () => void queue.flush();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      queue.stop();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [activeSessionId]);

  useEffect(() => {
    fatalSyncRef.current = async (error) => {
      if (await adoptSessionFromError(error)) return;
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not save your answers.');
      }
    };
  });

  const activeQuestion = useMemo(() => {
    if (!session?.questions?.length) return null;
    return session.questions[currentIndex] ?? null;
  }, [currentIndex, session]);

  const selectedExam = useMemo(
    () => dashboard?.exams?.find((exam) => exam.id === selectedExamId) ?? null,
    [dashboard?.exams, selectedExamId]
  );
  const resultsLocked = Boolean(session?.submittedAt && session?.resultsReleased === false);
  const resultReleaseInSeconds =
    resultsLocked && session?.resultsAvailableAt
      ? Math.max(0, Math.ceil((session.resultsAvailableAt - resultReleaseNow) / 1000))
      : 0;

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
          setInfoMessage('Corrections and explanations are now available.');
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

  /** Runs the automatic checks for a Python answer that was typed but not checked yet. */
  const finishCodeChecks = useCallback(async () => {
    const current = sessionRef.current;
    for (const question of current?.questions ?? []) {
      if (question.type !== 'code') continue;
      const response = current.responses?.[question.id];
      const code = String(response?.code ?? '');
      if (!code.trim() || code.trim() === String(question.starterCode ?? '').trim() || response?.checks) continue;
      // Never hold up a submission for long: unchecked programs are marked by the teacher.
      const checks = await Promise.race([checkProgram(code, question.tests ?? []), sleep(8000).then(() => null)]);
      if (checks) {
        const next = { code, checks };
        queueRef.current?.set(question.id, next, 0);
        setSession((previous) => (previous ? { ...previous, responses: { ...previous.responses, [question.id]: next } } : previous));
      }
    }
  }, []);

  const handleSubmit = useCallback(
    async (trigger = 'manual') => {
      const current = sessionRef.current;
      if (!current || isSubmitting || !tokenRef.current) return;
      if (trigger === 'manual') {
        setSubmitDialogOpen(true);
        return;
      }

      submitInProgressRef.current = true;
      setIsSubmitting(true);
      setErrorMessage('');
      // Automatic submission keeps trying for as long as the server still accepts late answers.
      const deadline = Date.now() + (trigger === 'auto' ? 85_000 : 30_000);
      try {
        await finishCodeChecks();
        let payload;
        for (;;) {
          try {
            // Anything the server has not confirmed travels with the submission itself.
            payload = await submitExam(tokenRef.current, current.sessionId, queueRef.current?.snapshot() ?? {});
            break;
          } catch (error) {
            if (!isRetryable(error) || Date.now() >= deadline) throw error;
            setInfoMessage('Connection problem. Your answers are safe; trying again…');
            await sleep(2500);
          }
        }
        queueRef.current?.clear();
        clearStoredPending(current.sessionId);
        setResultReleaseNow(Date.now());
        setSession(payload.session);
        setSubmitDialogOpen(false);
        setTourRunning(false);
        setNeedsResume(false);
        setPhase('result');
        clearStoredSession();
        stopCamera();
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
        void refreshDashboardSafely(tokenRef.current);
      } catch (error) {
        submitInProgressRef.current = false;
        setSubmitDialogOpen(false);
        if (await adoptSessionFromError(error)) return;
        if (handleUnauthorized(error)) return;
        if (isRetryable(error)) {
          setErrorMessage(
            'No connection to the exam server. Your answers are saved on this computer. Stay on this page; it will keep trying.'
          );
          // Try again shortly; the server finalises the attempt itself if this never gets through.
          setTimeout(() => {
            if (sessionRef.current && !sessionRef.current.submittedAt) void submitRef.current?.('auto');
          }, 6000);
        } else {
          setErrorMessage(error.message || 'Could not submit your exam. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [adoptSessionFromError, clearStoredSession, finishCodeChecks, handleUnauthorized, isSubmitting, refreshDashboardSafely, stopCamera]
  );

  useEffect(() => {
    submitRef.current = handleSubmit;
  });

  useEffect(() => {
    if (phase !== 'exam' || !session || session.submittedAt) return;
    if (session.remainingSeconds > 0 || autoSubmitTriggeredRef.current) return;
    autoSubmitTriggeredRef.current = true;
    setInfoMessage('Time is up. Submitting your exam now…');
    void handleSubmit('auto');
  }, [handleSubmit, phase, session]);

  useEffect(() => {
    if (phase !== 'exam') {
      submitInProgressRef.current = false;
      setSubmitDialogOpen(false);
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'exam' || !session || !activeQuestion || !authToken) return;
    const questionId = activeQuestion.id;
    if (seenSyncBlockedRef.current.has(questionId)) return;
    if (session.seen[questionId]) return;

    setSession((prev) => (prev ? { ...prev, seen: { ...prev.seen, [questionId]: true } } : prev));

    // "Seen" only colours the question map, so a failed save is not worth interrupting the student.
    void markSeen(authToken, session.sessionId, questionId, currentIndex).catch(async (error) => {
      if (isRetryable(error) || error?.status === 400) {
        seenSyncBlockedRef.current.add(questionId);
        return;
      }
      if (!(await adoptSessionFromError(error))) handleUnauthorized(error);
    });
  }, [activeQuestion, adoptSessionFromError, authToken, currentIndex, handleUnauthorized, phase, session]);

  const startExamFullscreen = useCallback(async () => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    // requestFullscreen is called synchronously so it still counts as part of the user's click.
    await document.documentElement.requestFullscreen().catch(() => {
      setInfoMessage('Press “Full screen” at the top if your screen did not switch.');
    });
  }, []);

  const reportViolation = useCallback(
    ({ type, detail, evidence = {} }) => {
      const current = sessionRef.current;
      if (submitInProgressRef.current || !current || current.submittedAt || !tokenRef.current) return;
      const now = Date.now();
      const context = {
        ...evidence,
        questionNumber: Number(safeStorageGet(ACTIVE_INDEX_KEY) ?? 0) + 1,
        remainingSeconds: current.remainingSeconds,
      };

      const send = async (attempt = 0) => {
        try {
          const payload = await logViolation(tokenRef.current, current.sessionId, type, detail, context);
          if (payload?.violations) {
            setSession((prev) => (prev ? { ...prev, violations: payload.violations } : prev));
            const recorded = payload.violations.at(-1);
            if (recorded?.type !== 'exam_reopened') {
              setInfoMessage(
                recorded?.deduct === false
                  ? `Noted, no points lost: ${detail}.`
                  : `Violation recorded: ${detail}. You can dispute it after you submit.`
              );
            }
          }
        } catch (error) {
          if (isRetryable(error) && attempt < 4) {
            setTimeout(() => void send(attempt + 1), 3000 * (attempt + 1));
            return;
          }
          if (!(await adoptSessionFromError(error))) handleUnauthorized(error);
        }
      };

      // Shown at once so the counter reacts immediately; replaced by the server's list.
      if (type !== 'exam_reopened') {
        setSession((prev) =>
          prev ? { ...prev, violations: [...prev.violations, { id: `local-${now}`, type, detail, occurredAt: now, deduct: false }] } : prev
        );
      }
      void send();
    },
    [adoptSessionFromError, handleUnauthorized]
  );

  // Supervision only runs while the student is actually in the exam (not behind the resume gate).
  useProctoring({
    active: phase === 'exam' && Boolean(session) && !session?.submittedAt && !needsResume,
    onViolation: reportViolation,
  });

  useEffect(() => {
    if (!tourRunning || phase !== 'exam') return undefined;
    const step = TOUR_STEPS[tourIndex];
    if (!step) return undefined;
    const target = document.querySelector(step.selector);
    if (!target) return undefined;

    target.setAttribute('data-tour-active', 'true');
    // Bring the highlighted part into view without jumping the page around.
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

    return () => target.removeAttribute('data-tour-active');
  }, [phase, tourIndex, tourRunning]);

  const finishTour = useCallback(() => {
    setTourRunning(false);
    setTourIndex(0);
    safeStorageSet(TOUR_SEEN_KEY, '1');
  }, []);

  const startTour = useCallback(() => {
    setTourIndex(0);
    setTourRunning(true);
  }, []);

  const enterAfterAuth = async (payload, welcome) => {
    storeToken(payload.token, payload.expiresAt);
    tokenRef.current = payload.token;
    setDashboard(toDashboard(payload));
    setDashboardTab('exams');
    prefillFormsFromUser(payload.user);
    setInfoMessage(welcome);
    if (payload.activeSession) {
      // An exam in progress always comes first, even before a required password change.
      await applyServerSession(payload.activeSession);
    } else {
      setPhase('setup');
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsLoggingIn(true);

    try {
      const payload = await studentLogin({ identifier: loginForm.identifier, password: loginForm.password });
      await enterAfterAuth(payload, `Signed in as ${payload.user?.fullName ?? 'student'}.`);
    } catch (error) {
      setErrorMessage(error.message || 'Could not sign in.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsRegistering(true);

    try {
      const payload = await studentRegister(registerForm);
      setAuthMode('login');
      await enterAfterAuth(payload, 'Your account is ready.');
    } catch (error) {
      setErrorMessage(error.message || 'Could not create your account.');
    } finally {
      setIsRegistering(false);
    }
  };

  const resetExamUiState = () => {
    setTourRunning(false);
    setTourIndex(0);
    setSubmitDialogOpen(false);
    setTrialReview(null);
    setNeedsResume(false);
    autoSubmitTriggeredRef.current = false;
    submitInProgressRef.current = false;
    stopCamera();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  const handleLogout = () => {
    if (authToken) {
      void studentLogout(authToken).catch(() => undefined);
    }
    clearAuth();
    setPhase('setup');
    setAuthMode('login');
    resetExamUiState();
    setErrorMessage('');
    setInfoMessage('You have been signed out.');
  };

  const handleOpenExam = (examId) => {
    setErrorMessage('');
    setSelectedExamId(examId);
    setPhase('exam-setup');
    window.scrollTo(0, 0);
  };

  // The attempt (and its timer) is only created here, after the setup steps.
  const beginExam = async ({ practiceCompleted }) => {
    if (!authToken || !selectedExamId || isStarting) return;
    setErrorMessage('');
    setIsStarting(true);
    void startExamFullscreen();

    try {
      const created = await startSession(authToken, {
        examId: selectedExamId,
        setup: {
          camera: cameraState === 'on' ? 'on' : cameraState === 'unavailable' ? 'unavailable' : 'denied',
          fullscreen: Boolean(document.fullscreenElement),
          practiceCompleted: Boolean(practiceCompleted),
        },
      });
      autoSubmitTriggeredRef.current = false;
      submitInProgressRef.current = false;
      setSubmitDialogOpen(false);
      setNeedsResume(false);
      setSession(created);
      setCurrentIndex(0);
      safeStorageSet(ACTIVE_SESSION_KEY, created.sessionId);
      safeStorageSet(ACTIVE_INDEX_KEY, '0');
      setPhase('exam');
      if (!safeStorageGet(TOUR_SEEN_KEY)) {
        startTour();
      }
      void refreshDashboardSafely(authToken);
    } catch (error) {
      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not start the exam.');
      }
      void refreshDashboardSafely(authToken);
    } finally {
      setIsStarting(false);
    }
  };

  // Coming back to a running exam: return to full screen, turn the camera back on, and tell the
  // teacher how long the exam was closed (logged only; it never costs points).
  const handleResume = () => {
    void startExamFullscreen();
    if (!cameraStreamRef.current && sessionRef.current?.setupCamera !== 'unavailable') {
      void requestCamera();
    }
    setNeedsResume(false);
    reportViolation({ type: 'exam_reopened', detail: 'Exam reopened after being closed or refreshed' });
  };

  const handleAnswer = (question, response) => {
    const current = sessionRef.current;
    if (!current || !authToken || submitInProgressRef.current || current.submittedAt) return;
    // The screen locks at 00:00. A finished automatic check for a Python answer is still kept.
    const isCheckResult = question.type === 'code' && Boolean(response?.checks);
    if (current.remainingSeconds <= 0 && !isCheckResult) return;

    setSession((previous) =>
      previous ? { ...previous, responses: { ...previous.responses, [question.id]: response } } : previous
    );
    queueRef.current?.set(question.id, response, question.type === 'code' ? 900 : 250);
  };

  const handleToggleFlag = () => {
    if (!session || !activeQuestion || !authToken || submitInProgressRef.current) return;

    const nextFlagged = !session.flagged[activeQuestion.id];
    setSession((current) =>
      current ? { ...current, flagged: { ...current.flagged, [activeQuestion.id]: nextFlagged } } : current
    );

    void saveFlag(authToken, session.sessionId, activeQuestion.id, nextFlagged, currentIndex).catch(async (error) => {
      if (isRetryable(error) || error?.status === 400) return; // a flag is a personal bookmark
      if (!(await adoptSessionFromError(error))) handleUnauthorized(error);
    });
  };

  const handleUseHint = async (question) => {
    if (!session || !authToken || hintLoading) return;
    setHintLoading(true);
    try {
      const payload = await requestHint(authToken, session.sessionId, question.id);
      setSession((current) => (current ? { ...current, hints: payload.hints } : current));
    } catch (error) {
      if (!(await adoptSessionFromError(error)) && !handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not load the hint. Try again.');
      }
    } finally {
      setHintLoading(false);
    }
  };

  const handleBackToDashboard = async () => {
    setSession(null);
    setCurrentIndex(0);
    setAuthMode('login');
    setPhase('setup');
    setErrorMessage('');
    clearStoredSession();
    resetExamUiState();

    if (authToken) {
      try {
        await refreshDashboard(authToken);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setErrorMessage(error.message || 'Could not refresh your dashboard.');
        }
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const refreshed = await refreshDashboardSafely(authToken);
    setIsRefreshing(false);
    if (refreshed) setInfoMessage('Dashboard updated.');
  };

  const handleSaveFeedback = async (event) => {
    event.preventDefault();
    if (!session?.sessionId || !session.submittedAt || isSavingFeedback || !authToken) return;

    const rating = feedbackForm.rating ? Number(feedbackForm.rating) : null;
    const comment = feedbackForm.comment.trim();
    if (!rating && !comment) {
      setErrorMessage('Choose a rating or write a comment first.');
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
      setInfoMessage('Thank you. Your feedback was saved.');
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
      setAuthMode('login');
      setInfoMessage('Request sent. Your teacher will reset your password.');
    } catch (error) {
      setErrorMessage(error.message || 'Could not send your request.');
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
      setErrorMessage('Choose a rating or write a comment first.');
      return;
    }

    setErrorMessage('');
    setIsSavingGeneralFeedback(true);

    try {
      const payload = await saveStudentGeneralFeedback(authToken, { rating, comment });
      setGeneralFeedbackForm({ rating: '', comment: '' });
      setDashboard((previous) =>
        previous ? { ...previous, generalFeedbackHistory: payload?.history ?? previous.generalFeedbackHistory ?? [] } : previous
      );
      setInfoMessage('Feedback sent. Thank you!');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not send feedback.');
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
      await downloadStudentTrialReportCard(authToken, trialId, `report-card-${String(trialId).slice(0, 8)}.html`);
      setInfoMessage('Report card downloaded. Open it to print or save as PDF.');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not download the report card.');
      }
    }
  };

  const savePassword = async ({ currentPassword, newPassword, confirmPassword }) => {
    if (!authToken) return false;
    if (newPassword !== confirmPassword) {
      setErrorMessage('The two passwords do not match.');
      return false;
    }

    setErrorMessage('');
    setIsSavingPassword(true);
    try {
      const payload = await changeStudentPassword(authToken, { currentPassword, newPassword });
      const activeToken = typeof payload?.token === 'string' && payload.token ? payload.token : authToken;
      if (activeToken !== authToken) {
        storeToken(payload.token, payload.expiresAt);
        tokenRef.current = payload.token;
      }
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setInfoMessage('Password saved.');
      await refreshDashboard(activeToken);
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not change your password.');
      }
      return false;
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    await savePassword(changePasswordForm);
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
        setErrorMessage(error.message || 'Could not load this attempt.');
      }
    } finally {
      setIsReviewLoading(false);
    }
  };

  const handleDispute = async (sessionId, violationId, payload) => {
    if (!authToken) return false;
    try {
      const reply = await disputeViolation(authToken, sessionId, violationId, payload);
      setSession((current) => (current && current.sessionId === sessionId ? { ...current, violations: reply.violations } : current));
      setTrialReview((current) => (current && current.id === sessionId ? { ...current, violations: reply.violations } : current));
      setInfoMessage('Dispute sent. Your teacher will review it.');
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setErrorMessage(error.message || 'Could not send your dispute.');
      }
      return false;
    }
  };

  const showFormErrorsInline = (phase === 'setup' && !authToken) || phase === 'exam-setup';
  const toasts = (
    <Toasts
      info={infoMessage}
      error={showFormErrorsInline ? '' : errorMessage}
      onDismissInfo={() => setInfoMessage('')}
      onDismissError={() => setErrorMessage('')}
    />
  );

  if (phase === 'loading') {
    return <FullPageLoader label="Loading your exam portal…" />;
  }

  if (phase === 'error') {
    return (
      <main className="center-page">
        <div className="card" style={{ width: 'min(440px, 100%)' }}>
          <div className="card-body stack" style={{ justifyItems: 'center', textAlign: 'center', padding: '2rem' }}>
            <BrandLogo branding={branding} size={52} />
            <h1 style={{ fontSize: '1.3rem' }}>We couldn’t load the exam portal</h1>
            <p className="muted">{errorMessage || 'Something went wrong while loading the app.'}</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (phase === 'setup' && !authToken) {
    return (
      <>
        {toasts}
        <AuthScreen
          meta={meta}
          authMode={authMode}
          setAuthMode={(mode) => {
            setErrorMessage('');
            setAuthMode(mode);
          }}
          loginForm={loginForm}
          setLoginForm={setLoginForm}
          onLogin={handleLogin}
          isLoggingIn={isLoggingIn}
          registerForm={registerForm}
          setRegisterForm={setRegisterForm}
          onRegister={handleRegister}
          isRegistering={isRegistering}
          helpForm={helpForm}
          setHelpForm={setHelpForm}
          onSendHelp={handleSendPasswordHelp}
          isSendingHelp={isSendingHelp}
          errorMessage={errorMessage}
        />
      </>
    );
  }

  if (phase === 'setup' && dashboard?.user?.mustChangePassword) {
    return (
      <>
        <Toasts info={infoMessage} error="" onDismissInfo={() => setInfoMessage('')} />
        <PasswordGate
          branding={branding}
          user={dashboard.user}
          startingPassword={meta?.defaultStudentPassword ?? 'salem'}
          onSave={(newPassword, confirmPassword) => savePassword({ currentPassword: '', newPassword, confirmPassword })}
          isSaving={isSavingPassword}
          errorMessage={errorMessage}
          onLogout={handleLogout}
        />
      </>
    );
  }

  if (phase === 'setup') {
    return (
      <>
        {toasts}
        <Dashboard
          branding={branding}
          dashboard={dashboard}
          authExpiresAt={authExpiresAt}
          tab={dashboardTab}
          setTab={setDashboardTab}
          onOpenExam={handleOpenExam}
          onResume={() => void applyServerSession(dashboard?.activeSession)}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          isStarting={isStarting}
          onLogout={handleLogout}
          onReviewTrial={handleOpenTrialReview}
          onDownloadReport={handleDownloadReportCard}
          onDispute={handleDispute}
          isReviewLoading={isReviewLoading}
          trialReview={trialReview}
          onCloseReview={() => setTrialReview(null)}
          generalFeedbackForm={generalFeedbackForm}
          setGeneralFeedbackForm={setGeneralFeedbackForm}
          onSaveGeneralFeedback={handleSaveGeneralFeedback}
          isSavingGeneralFeedback={isSavingGeneralFeedback}
          changePasswordForm={changePasswordForm}
          setChangePasswordForm={setChangePasswordForm}
          onChangePassword={handleChangePassword}
          isSavingPassword={isSavingPassword}
        />
      </>
    );
  }

  if (phase === 'exam-setup') {
    return (
      <>
        {toasts}
        <ExamSetup
          branding={branding}
          user={dashboard?.user}
          exam={selectedExam}
          penaltyPerViolation={meta?.penaltyPerViolation}
          onBack={() => {
            setErrorMessage('');
            stopCamera();
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            setPhase('setup');
          }}
          onStart={beginExam}
          isStarting={isStarting}
          errorMessage={errorMessage}
          isFullscreen={isFullscreen}
          onEnterFullscreen={startExamFullscreen}
          cameraState={cameraState}
          cameraStream={cameraStream}
          onRequestCamera={() => void requestCamera()}
          onSkipCamera={() => setCameraState('unavailable')}
        />
      </>
    );
  }

  if (phase === 'result' && session) {
    return (
      <>
        {toasts}
        <ResultScreen
          branding={branding}
          user={dashboard?.user}
          session={session}
          resultsLocked={resultsLocked}
          resultReleaseInSeconds={resultReleaseInSeconds}
          feedbackForm={feedbackForm}
          setFeedbackForm={setFeedbackForm}
          onSaveFeedback={handleSaveFeedback}
          isSavingFeedback={isSavingFeedback}
          onDownloadReport={handleDownloadReportCard}
          onDispute={handleDispute}
          onBackToDashboard={() => void handleBackToDashboard()}
          onLogout={handleLogout}
        />
      </>
    );
  }

  return (
    <>
      {toasts}
      <ExamRoom
        session={session}
        currentIndex={currentIndex}
        setCurrentIndex={setCurrentIndex}
        onAnswer={handleAnswer}
        onToggleFlag={handleToggleFlag}
        onRequestSubmit={() => void handleSubmit('manual')}
        submitDialogOpen={submitDialogOpen}
        onCancelSubmit={() => setSubmitDialogOpen(false)}
        onConfirmSubmit={() => void handleSubmit('confirmed')}
        isSubmitting={isSubmitting}
        syncState={syncState}
        isFullscreen={isFullscreen}
        onEnterFullscreen={startExamFullscreen}
        tourRunning={tourRunning}
        tourIndex={tourIndex}
        setTourIndex={setTourIndex}
        onFinishTour={finishTour}
        onStartTour={startTour}
        onUseHint={handleUseHint}
        hintLoading={hintLoading}
        needsResume={needsResume}
        onResume={handleResume}
        onBlockedPaste={() => reportViolation({ type: 'restricted_key', detail: 'Tried to paste text copied from outside the exam' })}
      />
    </>
  );
}

export default StudentApp;
