import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Circle,
  Clock,
  Expand,
  FileQuestion,
  Lightbulb,
  MousePointerClick,
  PlayCircle,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { Alert } from '../components/ui';
import { formatDuration } from '../lib/format';
import { safeStorageGet, safeStorageSet } from '../lib/hooks';
import { preloadPython } from '../lib/python';
import { gradePracticeQuestion, PRACTICE_QUESTIONS, questionHint } from '../questions/helpers';
import { QuestionInput } from '../questions/QuestionInput';
import { StudentTopbar } from './shared';
import { useProctoring } from './useProctoring';

const PRACTICE_DONE_KEY = 'salem_practice_done';
const STEPS = ['Get ready', 'Exam rules', 'Practice', 'Start'];

function CheckRow({ done, title, children, action }) {
  return (
    <li className={`check-row ${done ? 'is-done' : ''}`}>
      {done ? <CheckCircle2 className="check-icon" aria-hidden="true" /> : <Circle className="check-icon" aria-hidden="true" />}
      <div className="grow">
        <strong>{title}</strong>
        {children ? <span>{children}</span> : null}
      </div>
      {action}
    </li>
  );
}

function StepDevice({ onContinue, cameraState, onRequestCamera, onSkipCamera, isFullscreen, onEnterFullscreen, videoRef }) {
  const [closedTabs, setClosedTabs] = useState(false);
  const [closedAssistants, setClosedAssistants] = useState(false);
  const cameraReady = cameraState === 'on' || cameraState === 'unavailable';
  const ready = closedTabs && closedAssistants && isFullscreen && cameraReady;

  return (
    <>
      <div className="card-body stack">
        <div>
          <h2>Get your computer ready</h2>
          <p className="muted small">Finish all four before you continue. The exam timer has not started.</p>
        </div>
        <ul className="check-list">
          <CheckRow
            done={closedTabs}
            title="Close every other tab and program"
            action={
              <label className="check">
                <input type="checkbox" checked={closedTabs} onChange={(event) => setClosedTabs(event.target.checked)} />
                Done
              </label>
            }
          >
            Only this exam should be open.
          </CheckRow>
          <CheckRow
            done={closedAssistants}
            title="Close AI assistants and side panels"
            action={
              <label className="check">
                <input type="checkbox" checked={closedAssistants} onChange={(event) => setClosedAssistants(event.target.checked)} />
                Done
              </label>
            }
          >
            For example Copilot, Gemini or ChatGPT in the browser’s sidebar.
          </CheckRow>
          <CheckRow
            done={isFullscreen}
            title="Turn on full screen"
            action={
              !isFullscreen ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={onEnterFullscreen}>
                  <Expand aria-hidden="true" /> Go full screen
                </button>
              ) : null
            }
          >
            The exam must stay in full screen.
          </CheckRow>
          <CheckRow
            done={cameraReady}
            title="Turn on your camera and microphone"
            action={
              cameraState === 'on' ? (
                <video ref={videoRef} className="camera-preview" autoPlay muted playsInline />
              ) : cameraState !== 'unavailable' ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={onRequestCamera} disabled={cameraState === 'asking'}>
                  <Camera aria-hidden="true" /> {cameraState === 'asking' ? 'Waiting…' : 'Turn on'}
                </button>
              ) : null
            }
          >
            {cameraState === 'denied'
              ? 'Access was blocked. Click the camera icon in the address bar, choose Allow, then press Turn on again.'
              : cameraState === 'unavailable'
                ? 'No camera was found on this computer. Your teacher will be told.'
                : cameraState === 'missing'
                  ? 'No camera or microphone was detected. Plug one in and press Turn on, or use the link below.'
                  : 'Required for this exam. Choose Allow when your browser asks.'}
            {cameraState === 'denied' || cameraState === 'missing' ? (
              <button type="button" className="link-button small" style={{ display: 'block', marginTop: '0.25rem' }} onClick={onSkipCamera}>
                This computer has no camera or microphone
              </button>
            ) : null}
          </CheckRow>
        </ul>
      </div>
      <div className="card-footer">
        <button type="button" className="btn btn-primary btn-lg" onClick={onContinue} disabled={!ready}>
          Continue <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

const PRACTICE_TASKS = [
  { id: 'fullscreen_exit', text: 'Press Esc to leave full screen, then return to full screen' },
  { id: 'away', text: 'Switch to another tab or window (Alt + Tab), wait a moment, then come back' },
  { id: 'right_click', text: 'Right-click anywhere on this page' },
];

function StepRules({ exam, penalty, onContinue, onBack, isFullscreen, onEnterFullscreen, events }) {
  const proctoring = exam.proctoring ?? {};
  const counted = [];
  const loggedOnly = [];
  const add = (enabled, deducts, text) => {
    if (enabled === false) return;
    (deducts ? counted : loggedOnly).push(text);
  };
  add(
    proctoring.tab_switch !== false || proctoring.window_blur !== false,
    proctoring.deductTabSwitch !== false || proctoring.deductWindowBlur !== false,
    'Leaving the exam: switching tabs, opening another program, or clicking outside the browser'
  );
  add(proctoring.fullscreen_exit, proctoring.deductFullscreenExit !== false, 'Leaving full screen (for example pressing Esc)');
  add(proctoring.right_click, proctoring.deductRightClick === true, 'Right-clicking');
  add(proctoring.restricted_key, proctoring.deductRestrictedKey === true, 'Copy, paste and print shortcuts (Ctrl + C, Ctrl + V, Ctrl + P…)');

  const done = new Set(events.map((event) => (event.type === 'tab_switch' || event.type === 'window_blur' ? 'away' : event.type)));

  return (
    <>
      <div className="card-body stack stack-lg">
        <div>
          <h2>How the exam is supervised</h2>
          <p className="muted small">
            The exam notices certain actions and counts them as violations. Each counted violation takes {penalty} points off your
            final score. If one is recorded by mistake, you can dispute it after you submit and your teacher will review it.
          </p>
        </div>

        <div className="two-col">
          <div className="rule-box is-bad">
            <h3>
              <ShieldAlert aria-hidden="true" /> Counts as a violation
            </h3>
            <ul>
              {counted.map((text) => (
                <li key={text}>{text}</li>
              ))}
              {!counted.length ? <li>Nothing deducts points in this exam.</li> : null}
            </ul>
            {loggedOnly.length ? (
              <>
                <h3 style={{ marginTop: '0.9rem' }}>Noted for your teacher (no points lost)</h3>
                <ul>
                  {loggedOnly.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                  <li>Losing focus for less than 2 seconds, such as a pop-up from the computer</li>
                </ul>
              </>
            ) : null}
          </div>
          <div className="rule-box is-good">
            <h3>
              <ShieldCheck aria-hidden="true" /> Completely fine
            </h3>
            <ul>
              <li>Moving the mouse, scrolling and clicking anywhere on the exam</li>
              <li>Using the question map, flags and the Run button</li>
              <li>Messages from the exam itself, like “Submit your exam?”</li>
              <li>Thinking for a long time on one question</li>
              <li>Closing the exam by accident: sign in again and you continue where you stopped (the timer keeps running)</li>
            </ul>
          </div>
        </div>

        <div className="practice-zone">
          <div className="row-between">
            <div>
              <h3>
                <MousePointerClick size={17} style={{ display: 'inline', verticalAlign: '-3px' }} aria-hidden="true" /> Try it now
              </h3>
              <p className="muted small">Break the rules on purpose and watch the counter. Nothing here is recorded.</p>
            </div>
            <div className="practice-counter" aria-live="polite">
              <strong>{events.length}</strong>
              <span>practice violation{events.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <ul className="check-list compact">
            {PRACTICE_TASKS.map((task) => (
              <CheckRow key={task.id} done={done.has(task.id)} title={task.text} />
            ))}
          </ul>
          {!isFullscreen ? (
            <button type="button" className="btn btn-gold" onClick={onEnterFullscreen}>
              <Expand aria-hidden="true" /> Return to full screen
            </button>
          ) : null}
          {events.length ? (
            <ul className="practice-log">
              {events
                .slice(-4)
                .reverse()
                .map((event) => (
                  <li key={event.at}>
                    <span className={`badge ${event.counts ? 'badge-warning' : ''}`}>{event.counts ? 'Would count' : 'Noted only'}</span>
                    {event.detail}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="card-footer" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onContinue}>
          {done.size >= PRACTICE_TASKS.length ? 'Continue' : 'I understand, continue'} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function StepPractice({ onContinue, onBack, violationCount }) {
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [checked, setChecked] = useState(false);
  const question = PRACTICE_QUESTIONS[index];
  const doneBefore = Boolean(safeStorageGet(PRACTICE_DONE_KEY));
  const results = PRACTICE_QUESTIONS.map((item) => gradePracticeQuestion(item, responses[item.id]));

  const finish = () => {
    safeStorageSet(PRACTICE_DONE_KEY, '1');
    onContinue(true);
  };

  return (
    <>
      <div className="card-body stack">
        <div className="row-between">
          <div>
            <h2>Practice test</h2>
            <p className="muted small">
              Three practice questions so the real exam holds no surprises. They are not marked and no time is counted.
            </p>
          </div>
          <span className="badge">
            <ShieldAlert aria-hidden="true" /> {violationCount} practice violation{violationCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="segmented" role="tablist" aria-label="Practice questions">
          {PRACTICE_QUESTIONS.map((item, itemIndex) => (
            <button key={item.id} type="button" role="tab" aria-selected={index === itemIndex} onClick={() => setIndex(itemIndex)}>
              Question {itemIndex + 1}
              {checked ? (results[itemIndex] ? ' ✓' : ' ✗') : ''}
            </button>
          ))}
        </div>

        <div className="practice-question">
          <p className="question-text" style={{ whiteSpace: 'pre-line' }}>
            {question.text}
          </p>
          <p className="question-hint">{questionHint(question)}</p>
          <QuestionInput
            key={question.id}
            question={question}
            response={responses[question.id]}
            onChange={(response) => {
              setChecked(false);
              setResponses((previous) => ({ ...previous, [question.id]: response }));
            }}
          />
          {checked ? (
            <div className={`alert ${results[index] ? 'alert-success' : 'alert-warning'}`} style={{ marginTop: '1rem' }}>
              {results[index] ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              <span>
                <strong>{results[index] ? 'Correct. ' : 'Not quite. '}</strong>
                {question.explanation}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="card-footer" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Back
        </button>
        <div className="row">
          {doneBefore && !checked ? (
            <button type="button" className="btn btn-ghost" onClick={() => onContinue(false)}>
              Skip practice
            </button>
          ) : null}
          {index < PRACTICE_QUESTIONS.length - 1 ? (
            <button type="button" className="btn" onClick={() => setIndex(index + 1)}>
              Next question <ArrowRight aria-hidden="true" />
            </button>
          ) : null}
          {!checked ? (
            <button type="button" className="btn btn-primary" onClick={() => setChecked(true)}>
              Check my answers
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={finish}>
              Finish practice <ArrowRight aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function StepStart({ exam, penalty, onBack, onStart, isStarting, errorMessage }) {
  const attemptNumber = (Number(exam.attemptsUsed) || 0) + 1;
  return (
    <>
      <div className="card-body stack stack-lg">
        <div>
          <h2>You are ready</h2>
          <p className="muted small">The timer starts the moment you press Start exam. Good luck!</p>
        </div>
        <div className="instructions-facts" style={{ marginTop: 0 }}>
          <div className="fact">
            <span>
              <FileQuestion aria-hidden="true" /> Questions
            </span>
            <strong>{exam.questionCount}</strong>
          </div>
          <div className="fact">
            <span>
              <Clock aria-hidden="true" /> Time allowed
            </span>
            <strong>{formatDuration(exam.durationSeconds)}</strong>
          </div>
          <div className="fact">
            <span>
              <Repeat aria-hidden="true" /> Attempt
            </span>
            <strong>
              {attemptNumber} of {exam.maxAttempts}
            </strong>
          </div>
          <div className="fact">
            <span>
              <ShieldAlert aria-hidden="true" /> Each violation
            </span>
            <strong>−{penalty} pts</strong>
          </div>
        </div>
        {exam.hintsForYou > 0 ? (
          <Alert tone="info" title={`You have ${exam.hintsForYou} hints`}>
            {exam.hintNote || 'Press “Show a hint” on a question to use one. Choose carefully: you cannot get a hint back.'}
          </Alert>
        ) : null}
        <ul className="rule-list">
          <li>
            <span className="rule-icon">
              <CheckCircle2 aria-hidden="true" />
            </span>
            <div>
              <strong>Every answer is saved as you go</strong>
              <span>If the internet drops, keep working. Your answers are kept on this computer and sent when it returns.</span>
            </div>
          </li>
          <li>
            <span className="rule-icon">
              <Lightbulb aria-hidden="true" />
            </span>
            <div>
              <strong>Easy questions come first</strong>
              <span>The flowchart and Python questions are at the end. Do not spend too long on one question.</span>
            </div>
          </li>
        </ul>
        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      </div>
      <div className="card-footer" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={onBack} disabled={isStarting}>
          <ArrowLeft aria-hidden="true" /> Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart} disabled={isStarting}>
          <PlayCircle aria-hidden="true" />
          {isStarting ? 'Starting…' : 'Start exam'}
        </button>
      </div>
    </>
  );
}

/**
 * Everything that happens before the timer starts: device check, the rules with a live practice
 * counter, a three-question practice test, then the start button.
 */
export default function ExamSetup({
  branding,
  user,
  exam,
  penaltyPerViolation = 2,
  onBack,
  onStart,
  isStarting,
  errorMessage,
  isFullscreen,
  onEnterFullscreen,
  cameraState,
  cameraStream,
  onRequestCamera,
  onSkipCamera,
}) {
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState([]);
  const [practiceCompleted, setPracticeCompleted] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    // Download Python in the background so the first Run in the exam is quick.
    void preloadPython();
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, step]);

  useProctoring({
    active: step === 1 || step === 2,
    onViolation: ({ type, detail, evidence }) => {
      const proctoring = exam?.proctoring ?? {};
      const brief = type === 'window_blur' && (evidence?.durationMs ?? 0) < 2000;
      const counts =
        !brief &&
        ((type === 'tab_switch' && proctoring.deductTabSwitch !== false) ||
          (type === 'window_blur' && proctoring.deductWindowBlur !== false) ||
          (type === 'fullscreen_exit' && proctoring.deductFullscreenExit !== false) ||
          (type === 'right_click' && proctoring.deductRightClick === true) ||
          (type === 'restricted_key' && proctoring.deductRestrictedKey === true));
      setEvents((previous) => [...previous, { type, detail, counts, at: Date.now() + Math.random() }]);
    },
  });

  if (!exam) return null;

  return (
    <div className="student-app">
      <StudentTopbar branding={branding} user={user} />
      <main className="page page-narrow">
        <div className="row-between" style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </button>
          <strong className="truncate">{exam.title}</strong>
        </div>

        <ol className="setup-steps" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? 'is-active' : index < step ? 'is-done' : ''} aria-current={index === step ? 'step' : undefined}>
              <b>{index < step ? '✓' : index + 1}</b>
              {label}
            </li>
          ))}
        </ol>

        <article className="card">
          {step === 0 ? (
            <StepDevice
              onContinue={() => setStep(1)}
              cameraState={cameraState}
              onRequestCamera={onRequestCamera}
              onSkipCamera={onSkipCamera}
              isFullscreen={isFullscreen}
              onEnterFullscreen={onEnterFullscreen}
              videoRef={videoRef}
            />
          ) : step === 1 ? (
            <StepRules
              exam={exam}
              penalty={penaltyPerViolation}
              onContinue={() => setStep(2)}
              onBack={() => setStep(0)}
              isFullscreen={isFullscreen}
              onEnterFullscreen={onEnterFullscreen}
              events={events}
            />
          ) : step === 2 ? (
            <StepPractice
              onContinue={(completed) => {
                setPracticeCompleted(completed);
                setStep(3);
              }}
              onBack={() => setStep(1)}
              violationCount={events.length}
            />
          ) : (
            <StepStart
              exam={exam}
              penalty={penaltyPerViolation}
              onBack={() => setStep(2)}
              onStart={() => onStart({ practiceCompleted })}
              isStarting={isStarting}
              errorMessage={errorMessage}
            />
          )}
        </article>
      </main>
    </div>
  );
}
