import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  CloudOff,
  CloudUpload,
  Eraser,
  Expand,
  Flag,
  Grid3x3,
  Lightbulb,
  ListChecks,
  Send,
  ShieldAlert,
} from 'lucide-react';

import { Modal } from '../components/ui';
import { formatClock } from '../lib/format';
import { isAnsweredLocal, questionHint } from '../questions/helpers';
import { QuestionInput } from '../questions/QuestionInput';
import { TOUR_STEPS } from './tourSteps';

function questionStatus(question, seen, responses, flagged) {
  if (flagged[question.id]) return 'flagged';
  if (isAnsweredLocal(question, responses[question.id])) return 'answered';
  if (seen[question.id]) return 'unanswered';
  return 'unread';
}

function emptyResponse(question) {
  if (question.type === 'code') return { code: question.starterCode ?? '', checks: null };
  return [];
}

function SaveState({ syncState }) {
  if (syncState.status === 'retrying') {
    return (
      <span className="save-state is-offline" aria-live="polite">
        <CloudOff aria-hidden="true" /> No connection. {syncState.pending} answer{syncState.pending === 1 ? '' : 's'} kept on this
        computer
      </span>
    );
  }
  if (syncState.pending > 0) {
    return (
      <span className="save-state" aria-live="polite">
        <CloudUpload aria-hidden="true" /> Saving…
      </span>
    );
  }
  return (
    <span className="save-state" aria-live="polite">
      <CheckCircle2 aria-hidden="true" /> All answers saved
    </span>
  );
}

export default function ExamRoom({
  session,
  currentIndex,
  setCurrentIndex,
  onAnswer,
  onToggleFlag,
  onRequestSubmit,
  submitDialogOpen,
  onCancelSubmit,
  onConfirmSubmit,
  isSubmitting,
  syncState,
  isFullscreen,
  onEnterFullscreen,
  tourRunning,
  tourIndex,
  setTourIndex,
  onFinishTour,
  onStartTour,
  onUseHint,
  hintLoading,
  needsResume,
  onResume,
  onBlockedPaste,
}) {
  const [paletteCollapsed, setPaletteCollapsed] = useState(true);

  const questions = session?.questions ?? [];
  const activeQuestion = questions[currentIndex] ?? null;
  const responses = session?.responses ?? {};
  const flagged = session?.flagged ?? {};
  const seen = session?.seen ?? {};
  const answeredCount = questions.filter((question) => isAnsweredLocal(question, responses[question.id])).length;
  const flaggedCount = questions.filter((question) => flagged[question.id]).length;
  const unansweredCount = questions.length - answeredCount;
  const violationCount = (session?.violations ?? []).filter((violation) => violation.deduct !== false && !violation.waived).length;
  const remaining = session?.remainingSeconds ?? 0;
  const timeUp = remaining <= 0;
  const locked = isSubmitting || timeUp;
  const timerTone = remaining <= 60 ? 'is-danger' : remaining <= 300 ? 'is-warning' : '';
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const tourStep = TOUR_STEPS[tourIndex];
  const isFlagged = Boolean(activeQuestion && flagged[activeQuestion.id]);
  const hints = session?.hints ?? { limit: 0, used: 0, revealed: {} };
  const hintsLeft = Math.max(0, hints.limit - hints.used);
  const revealedHint = activeQuestion ? hints.revealed?.[activeQuestion.id] : '';

  return (
    <main className="exam-shell">
      <header className="exam-topbar">
        <div className="exam-title">
          <strong className="truncate">{session?.exam?.title ?? 'Exam'}</strong>
          <span className="truncate">
            {session?.student?.fullName} · {session?.student?.classRoom} · Attempt {session?.trialNumber ?? 1}
            {session?.exam?.maxAttempts ? ` of ${session.exam.maxAttempts}` : ''}
          </span>
        </div>

        <div className={`timer tour-timer ${timerTone}`} role="timer" aria-live="off" aria-label={`Time left ${formatClock(remaining)}`}>
          <Clock aria-hidden="true" />
          <span className="timer-label">Time left</span>
          {formatClock(remaining)}
        </div>

        <div className="actions">
          <SaveState syncState={syncState} />
          {!isFullscreen ? (
            <button type="button" className="btn btn-gold btn-sm" onClick={onEnterFullscreen}>
              <Expand aria-hidden="true" />
              Full screen
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onStartTour} aria-label="Show exam tips" title="Show exam tips">
            <CircleHelp />
          </button>
        </div>
      </header>

      <div className="exam-statusbar tour-status">
        <span className="item">
          <ListChecks aria-hidden="true" />
          <strong>
            {answeredCount}/{questions.length}
          </strong>
          answered
        </span>
        <span className="progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
        <span className="item">
          <Flag aria-hidden="true" />
          <strong>{flaggedCount}</strong> flagged
        </span>
        <span className={`item ${violationCount ? 'is-alert' : ''}`}>
          <ShieldAlert aria-hidden="true" />
          <strong>{violationCount}</strong> violation{violationCount === 1 ? '' : 's'}
        </span>
        {hints.limit > 0 ? (
          <span className="item">
            <Lightbulb aria-hidden="true" />
            <strong>{hintsLeft}</strong> hint{hintsLeft === 1 ? '' : 's'} left
          </span>
        ) : null}
      </div>

      <div className="exam-body">
        <section className="card question-card tour-question" aria-labelledby="question-text">
          <div className="question-meta">
            <span className="question-number">
              Question {currentIndex + 1} of {questions.length}
            </span>
            {isFlagged ? (
              <span className="badge badge-gold">
                <Flag aria-hidden="true" /> Flagged
              </span>
            ) : null}
          </div>
          <h1 id="question-text" className="question-text">
            {activeQuestion?.text}
          </h1>
          <p className="question-hint">{questionHint(activeQuestion)}</p>

          {activeQuestion ? (
            <QuestionInput
              key={activeQuestion.id}
              question={activeQuestion}
              response={responses[activeQuestion.id]}
              onChange={(response) => onAnswer(activeQuestion, response)}
              disabled={locked}
              onBlockedPaste={onBlockedPaste}
            />
          ) : null}

          {revealedHint ? (
            <p className="hint-box">
              <Lightbulb aria-hidden="true" />
              <span>
                <strong>Hint: </strong>
                {revealedHint}
              </span>
            </p>
          ) : hints.limit > 0 && activeQuestion?.hasHint ? (
            <div className="hint-offer">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onUseHint(activeQuestion)}
                disabled={locked || hintLoading || hintsLeft <= 0}
              >
                <Lightbulb aria-hidden="true" />
                {hintsLeft > 0 ? `Show a hint (${hintsLeft} left)` : 'No hints left'}
              </button>
              {hintsLeft > 0 ? <span className="hint">Uses one of your hints for this question.</span> : null}
            </div>
          ) : null}

          <div className="question-nav">
            <button
              type="button"
              className="btn"
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              disabled={isSubmitting || currentIndex === 0}
            >
              <ChevronLeft aria-hidden="true" />
              <span className="btn-label">Previous</span>
            </button>
            <div className="row">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => activeQuestion && onAnswer(activeQuestion, emptyResponse(activeQuestion))}
                disabled={locked}
              >
                <Eraser aria-hidden="true" />
                <span className="btn-label">Clear</span>
              </button>
              <button
                type="button"
                className={`btn ${isFlagged ? 'is-flagged' : ''}`}
                onClick={onToggleFlag}
                disabled={locked}
                aria-pressed={isFlagged}
              >
                <Flag aria-hidden="true" />
                <span className="btn-label">{isFlagged ? 'Unflag' : 'Flag'}</span>
              </button>
            </div>
            {currentIndex >= questions.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={onRequestSubmit} disabled={isSubmitting}>
                <span className="btn-label">Finish</span>
                <Send aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
                disabled={isSubmitting}
              >
                <span className="btn-label">Next</span>
                <ChevronRight aria-hidden="true" />
              </button>
            )}
          </div>
        </section>

        <aside className={`card palette-card tour-palette ${paletteCollapsed ? 'is-collapsed' : ''}`} aria-label="Question map">
          <div className="palette-head">
            <h2>Question map</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm palette-toggle"
              onClick={() => setPaletteCollapsed((value) => !value)}
              aria-expanded={!paletteCollapsed}
            >
              <Grid3x3 aria-hidden="true" />
              {paletteCollapsed ? 'Show' : 'Hide'}
              <ChevronDown aria-hidden="true" style={{ transform: paletteCollapsed ? 'none' : 'rotate(180deg)' }} />
            </button>
          </div>
          <div className="palette-collapsible">
            <div className="palette-grid">
              {questions.map((question, index) => {
                const status = questionStatus(question, seen, responses, flagged);
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`palette-btn ${status} ${index === currentIndex ? 'current' : ''}`}
                    onClick={() => setCurrentIndex(index)}
                    disabled={isSubmitting}
                    aria-label={`Question ${index + 1}, ${status}`}
                    aria-current={index === currentIndex ? 'step' : undefined}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <div className="palette-legend" aria-hidden="true">
              <span>
                <i className="answered" />
                Answered
              </span>
              <span>
                <i className="unanswered" />
                Not answered
              </span>
              <span>
                <i className="flagged" />
                Flagged
              </span>
              <span>
                <i />
                Not opened
              </span>
            </div>
          </div>
          <div className="palette-submit">
            <button type="button" className="btn btn-primary btn-block" onClick={onRequestSubmit} disabled={isSubmitting}>
              <Send aria-hidden="true" />
              {isSubmitting ? 'Submitting…' : 'Submit exam'}
            </button>
          </div>
        </aside>
      </div>

      <Modal
        open={submitDialogOpen}
        onClose={isSubmitting ? undefined : onCancelSubmit}
        title="Submit your exam?"
        subtitle="You can’t change your answers after submitting."
        footer={
          <>
            <button type="button" className="btn" onClick={onCancelSubmit} disabled={isSubmitting}>
              Keep working
            </button>
            <button type="button" className="btn btn-primary" onClick={onConfirmSubmit} disabled={isSubmitting} data-autofocus>
              <Send aria-hidden="true" />
              {isSubmitting ? 'Submitting…' : 'Submit now'}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="stat">
              <span className="stat-label">Answered</span>
              <span className="stat-value">{answeredCount}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Not answered</span>
              <span className="stat-value">{unansweredCount}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Flagged</span>
              <span className="stat-value">{flaggedCount}</span>
            </div>
          </div>
          {unansweredCount > 0 ? (
            <div className="alert alert-warning">
              <AlertTriangle aria-hidden="true" />
              <span>
                You still have {unansweredCount} unanswered question{unansweredCount === 1 ? '' : 's'}. You have{' '}
                {formatClock(remaining)} left.
              </span>
            </div>
          ) : null}
        </div>
      </Modal>

      {needsResume && !isSubmitting ? (
        <div className="resume-gate" role="dialog" aria-modal="true" aria-label="Continue your exam">
          <div className="card resume-gate-card">
            <span className="confirm-icon" aria-hidden="true">
              <Clock />
            </span>
            <h2>Your exam is still running</h2>
            <p className="muted">
              You have <strong>{formatClock(remaining)}</strong> left and all your saved answers are here. Press continue to carry on in
              full screen.
            </p>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onResume} data-autofocus>
              <Expand aria-hidden="true" /> Continue my exam
            </button>
          </div>
        </div>
      ) : null}

      {tourRunning && tourStep && !needsResume ? (
        <div className={`tour-overlay ${tourStep.dock === 'top' ? 'dock-top' : 'dock-bottom'}`}>
          <div className="tour-card" role="dialog" aria-label="Exam tips">
            <div className="row-between">
              <span className="tour-step">
                Tip {tourIndex + 1} of {TOUR_STEPS.length}
              </span>
              <span className="tour-dots" aria-hidden="true">
                {TOUR_STEPS.map((step, index) => (
                  <span key={step.selector} className={index === tourIndex ? 'is-active' : ''} />
                ))}
              </span>
            </div>
            <h3>{tourStep.title}</h3>
            <p>{tourStep.text}</p>
            <div className="row-between" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onFinishTour}>
                Skip tips
              </button>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={tourIndex === 0}
                  onClick={() => setTourIndex((index) => Math.max(0, index - 1))}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    if (tourIndex >= TOUR_STEPS.length - 1) {
                      onFinishTour();
                      return;
                    }
                    setTourIndex((index) => Math.min(index + 1, TOUR_STEPS.length - 1));
                  }}
                >
                  {tourIndex >= TOUR_STEPS.length - 1 ? 'Start answering' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
