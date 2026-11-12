import { ArrowLeft, Download, LockKeyhole, MessageSquare } from 'lucide-react';

import { Alert, Field, StatCard } from '../components/ui';
import { formatClock, formatDateTime, formatPercent } from '../lib/format';
import { QuestionReviewList } from '../questions/QuestionReview';
import { RatingInput, StudentTopbar, ViolationsPanel } from './shared';

function ScoreRing({ percent, label }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="score-ring">
      <svg viewBox="0 0 168 168" aria-hidden="true">
        <circle className="ring-track" cx="84" cy="84" r={radius} fill="none" strokeWidth="12" />
        <circle
          className="ring-fill"
          cx="84"
          cy="84"
          r={radius}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="ring-label">
        <strong>{formatPercent(clamped)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function ResultScreen({
  branding,
  user,
  session,
  resultsLocked,
  resultReleaseInSeconds,
  feedbackForm,
  setFeedbackForm,
  onSaveFeedback,
  isSavingFeedback,
  onDownloadReport,
  onDispute,
  onBackToDashboard,
  onLogout,
}) {
  const summary = session?.summary ?? {};
  const total = summary.totalQuestions ?? session?.questions?.length ?? 0;
  const reviewRows =
    Array.isArray(session?.questionReview) && session.questionReview.length > 0
      ? session.questionReview
      : (session?.questions ?? []).map((question, index) => ({
          index: index + 1,
          questionId: question.id,
          text: question.text,
          options: question.options,
          selectedOptionIds: session.responses?.[question.id] ?? [],
          correctOptionIds: [],
          isCorrect: null,
        }));

  return (
    <div className="student-app">
      <StudentTopbar branding={branding} user={user ?? session?.student} onLogout={onLogout} />
      <main className="page" style={{ maxWidth: 980 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBackToDashboard} style={{ marginBottom: '1rem' }}>
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </button>

        <div className="stack stack-lg">
          <section className="card">
            <div className="result-hero">
              <ScoreRing percent={summary.finalPercent} label="Final score" />
              <div className="stack" style={{ '--stack-gap': '0.6rem' }}>
                <span className="badge badge-success" style={{ justifySelf: 'start' }}>
                  Exam submitted
                </span>
                <h1>{session?.exam?.title ?? 'Exam'}</h1>
                <p className="muted">
                  Attempt {session?.trialNumber ?? 1} · Submitted {formatDateTime(session?.submittedAt)}
                </p>
                <div className="row" style={{ marginTop: '0.4rem' }}>
                  <button type="button" className="btn btn-primary" onClick={() => onDownloadReport(session.sessionId)}>
                    <Download aria-hidden="true" />
                    Download report card
                  </button>
                  <button type="button" className="btn" onClick={onBackToDashboard}>
                    Back to dashboard
                  </button>
                </div>
              </div>
            </div>
            <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="stat-grid">
                <StatCard label="Correct answers" value={`${summary.correctCount ?? 0} / ${total}`} />
                <StatCard label="Questions answered" value={`${summary.answeredCount ?? 0} / ${total}`} />
                <StatCard label="Score before penalties" value={formatPercent(summary.rawPercent ?? 0)} />
                <StatCard
                  label="Proctoring penalty"
                  value={summary.penaltyPoints ? `−${summary.penaltyPoints} pts` : 'None'}
                  meta={`${summary.violationsCount ?? 0} counted · ${summary.totalViolationsCount ?? 0} logged`}
                />
              </div>
            </div>
          </section>

          {resultsLocked ? (
            <Alert tone="info" title={`Corrections open in ${formatClock(resultReleaseInSeconds)}`}>
              You can see the answers you chose now. Correct answers and explanations will appear here automatically at{' '}
              {formatDateTime(session?.resultsAvailableAt)}.
            </Alert>
          ) : null}

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Violations</h2>
                <p className="subtitle">
                  If one was recorded by mistake, press Dispute and tell your teacher what happened. They will review it.
                </p>
              </div>
            </div>
            <div className="card-body">
              <ViolationsPanel sessionId={session?.sessionId} violations={session?.violations} onDispute={onDispute} />
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Answer review</h2>
                <p className="subtitle">
                  {resultsLocked
                    ? 'Your answers. Corrections are not released yet.'
                    : 'Your answers, the correct answers, and an explanation for each question.'}
                </p>
              </div>
              {resultsLocked ? <LockKeyhole size={20} className="muted" aria-hidden="true" /> : null}
            </div>
            <div className="card-body">
              <QuestionReviewList items={reviewRows} />
            </div>
          </section>

          <form className="card" onSubmit={onSaveFeedback}>
            <div className="card-header">
              <div>
                <h2>How did this exam go?</h2>
                <p className="subtitle">Optional. Your feedback helps your teachers improve future exams.</p>
              </div>
              <MessageSquare size={20} className="muted" aria-hidden="true" />
            </div>
            <div className="card-body stack">
              <Field label="Rating">
                <RatingInput value={feedbackForm.rating} onChange={(rating) => setFeedbackForm((prev) => ({ ...prev, rating }))} />
              </Field>
              <Field label="Comment" optional htmlFor="feedbackComment">
                <textarea
                  id="feedbackComment"
                  className="textarea"
                  rows={3}
                  maxLength={600}
                  value={feedbackForm.comment}
                  onChange={(event) => setFeedbackForm((prev) => ({ ...prev, comment: event.target.value }))}
                />
              </Field>
            </div>
            <div className="card-footer" style={{ justifyContent: 'space-between' }}>
              <span className="hint">{session?.feedback ? `Saved ${formatDateTime(session.feedback.submittedAt)}` : ''}</span>
              <button type="submit" className="btn btn-primary" disabled={isSavingFeedback}>
                {isSavingFeedback ? 'Saving…' : session?.feedback ? 'Update feedback' : 'Send feedback'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
