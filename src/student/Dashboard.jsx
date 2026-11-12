import {
  AlertTriangle,
  Archive,
  BookOpenCheck,
  Clock,
  Download,
  Eye,
  FileQuestion,
  KeyRound,
  ListChecks,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Trophy,
  UserRound,
} from 'lucide-react';

import { Alert, EmptyState, Field, PasswordInput, SessionStatusBadge } from '../components/ui';
import { contactLabel, formatDateTime, formatDuration, formatPercent, formatRelative } from '../lib/format';
import { RatingInput, StudentTopbar, TrialReviewModal } from './shared';

const TABS = [
  { id: 'exams', label: 'Exams', icon: BookOpenCheck },
  { id: 'results', label: 'My results', icon: ListChecks },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'account', label: 'Account', icon: UserRound },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function ExamCard({ exam, isActive, onOpen, onResume, disabled }) {
  const attempts = Math.max(1, Number(exam.maxAttempts) || 1);
  const used = Math.min(attempts, Number(exam.attemptsUsed) || 0);
  return (
    <article className={`card exam-card ${exam.archived ? 'is-archived' : ''}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          {exam.archived ? (
            <span className="badge archive-badge">
              <Archive aria-hidden="true" /> Archived · practice only
            </span>
          ) : null}
          <h3>{exam.title}</h3>
          {exam.description ? <p className="description clamp-2">{exam.description}</p> : null}
        </div>
        {isActive ? (
          <span className="badge badge-gold">In progress</span>
        ) : !exam.canAttempt ? (
          <span className="badge">No attempts left</span>
        ) : null}
      </div>

      <div className="exam-facts">
        <div>
          <span>
            <FileQuestion aria-hidden="true" /> Questions
          </span>
          <strong>{exam.questionCount}</strong>
        </div>
        <div>
          <span>
            <Clock aria-hidden="true" /> Time
          </span>
          <strong>{formatDuration(exam.durationSeconds)}</strong>
        </div>
        <div>
          <span>
            <Trophy aria-hidden="true" /> Best
          </span>
          <strong>{used ? formatPercent(exam.bestFinalPercent) : '—'}</strong>
        </div>
      </div>

      <div className="card-actions">
        <div className="stack" style={{ '--stack-gap': '0.3rem' }}>
          <div className="attempt-dots" aria-hidden="true">
            {Array.from({ length: Math.min(attempts, 10) }, (_, index) => (
              <span key={index} className={index < used ? 'is-used' : ''} />
            ))}
          </div>
          <span className="hint">
            {used} of {attempts} attempt{attempts === 1 ? '' : 's'} used
          </span>
        </div>
        {isActive ? (
          <button type="button" className="btn btn-gold" onClick={onResume}>
            <RotateCcw aria-hidden="true" />
            Resume
          </button>
        ) : (
          <button
            type="button"
            className={`btn ${exam.archived ? '' : 'btn-primary'}`}
            onClick={() => onOpen(exam.id)}
            disabled={disabled || !exam.canAttempt}
          >
            <PlayCircle aria-hidden="true" />
            {exam.archived ? 'Practise' : used ? 'Try again' : 'Start'}
          </button>
        )}
      </div>
    </article>
  );
}

function ResultsTab({ trials, onReview, onDownload, isReviewLoading }) {
  if (!trials.length) {
    return (
      <div className="card">
        <EmptyState icon={ListChecks} title="No attempts yet">
          When you finish an exam, your score and corrections will appear here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="card card-flush">
      <div className="card-header" style={{ paddingBottom: '1rem' }}>
        <div>
          <h2>My results</h2>
          <p className="subtitle">Scores include any proctoring penalties.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Exam</th>
              <th>Status</th>
              <th className="col-num">Score</th>
              <th className="col-num">Violations</th>
              <th>Corrections</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {trials.map((trial) => {
              const submitted = Boolean(trial.submittedAt);
              return (
                <tr key={trial.id}>
                  <td>
                    <span className="cell-primary">{trial.exam?.title ?? 'Exam'}</span>
                    <span className="cell-sub">
                      Attempt {trial.trialNumber ?? 1} · {formatDateTime(trial.startedAt)}
                    </span>
                  </td>
                  <td>
                    <SessionStatusBadge status={trial.status} />
                  </td>
                  <td className="col-num">
                    {submitted ? (
                      <strong>{formatPercent(trial.summary?.finalPercent ?? 0)}</strong>
                    ) : (
                      <span className="muted">
                        {trial.progress?.answeredCount ?? 0}/{trial.progress?.totalQuestions ?? 0} answered
                      </span>
                    )}
                  </td>
                  <td className="col-num">{trial.summary?.totalViolationsCount ?? trial.violations?.length ?? 0}</td>
                  <td>
                    {!submitted ? (
                      <span className="muted">—</span>
                    ) : trial.resultsReleased ? (
                      <span className="badge badge-success">Available</span>
                    ) : (
                      <span className="badge" title={formatDateTime(trial.resultsAvailableAt)}>
                        Opens {formatRelative(trial.resultsAvailableAt)}
                      </span>
                    )}
                  </td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onReview(trial.id)}
                        disabled={isReviewLoading || !submitted}
                      >
                        <Eye aria-hidden="true" />
                        Review
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon"
                        onClick={() => onDownload(trial.id)}
                        disabled={!submitted}
                        aria-label="Download report card"
                        title="Download report card"
                      >
                        <Download />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankMedal({ rank }) {
  return <span className={`rank-medal ${rank <= 3 ? `is-${rank}` : ''}`}>{rank}</span>;
}

function LeaderboardTable({ title, subtitle, rows, showClass }) {
  return (
    <div className="card card-flush">
      <div className="card-header" style={{ paddingBottom: '1rem' }}>
        <div>
          <h2>{title}</h2>
          <p className="subtitle">{subtitle}</p>
        </div>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Rank</th>
                <th>Student</th>
                {showClass ? <th>Class</th> : null}
                <th className="col-num">Best</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((entry) => (
                <tr key={`${entry.rank}-${entry.studentName}-${entry.classRoom}`} className={entry.isCurrentStudent ? 'is-you' : ''}>
                  <td>
                    <RankMedal rank={entry.rank} />
                  </td>
                  <td>
                    <span className="cell-primary">{entry.studentName}</span>
                    {entry.isCurrentStudent ? <span className="badge badge-gold you-tag">You</span> : null}
                    <span className="cell-sub">
                      {entry.submittedTrials} attempt{entry.submittedTrials === 1 ? '' : 's'}
                    </span>
                  </td>
                  {showClass ? <td>{entry.classRoom}</td> : null}
                  <td className="col-num">
                    <strong>{formatPercent(entry.bestFinalPercent)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Trophy} title="No rankings yet">
          Rankings appear once students submit exams.
        </EmptyState>
      )}
    </div>
  );
}

function AccountTab({
  user,
  authExpiresAt,
  changePasswordForm,
  setChangePasswordForm,
  onChangePassword,
  isSavingPassword,
  generalFeedbackForm,
  setGeneralFeedbackForm,
  onSaveGeneralFeedback,
  isSavingGeneralFeedback,
  generalFeedbackHistory,
}) {
  return (
    <div className="two-col">
      <div className="stack">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Profile</h2>
              <p className="subtitle">Ask your teacher if any of these details are wrong.</p>
            </div>
          </div>
          <div className="card-body">
            <dl className="stack" style={{ '--stack-gap': '0.75rem', margin: 0 }}>
              {[
                ['Full name', user?.fullName],
                ['Class', user?.classRoom],
                ['Signs in with', contactLabel(user)],
                ['Signed in until', formatDateTime(authExpiresAt)],
              ].map(([label, value]) => (
                <div key={label} className="row-between">
                  <dt className="muted small">{label}</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <form className="card" onSubmit={onChangePassword} id="change-password">
          <div className="card-header">
            <div>
              <h2>Change password</h2>
              <p className="subtitle">You will stay signed in on this device.</p>
            </div>
            <KeyRound size={20} className="muted" aria-hidden="true" />
          </div>
          <div className="card-body stack">
            <Field label="Current password" htmlFor="currentPassword">
              <PasswordInput
                id="currentPassword"
                required
                value={changePasswordForm.currentPassword}
                onChange={(event) => setChangePasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              />
            </Field>
            <div className="form-grid">
              <Field label="New password" htmlFor="newPassword" hint="At least 4 characters.">
                <PasswordInput
                  id="newPassword"
                  required
                  minLength={4}
                  autoComplete="new-password"
                  value={changePasswordForm.newPassword}
                  onChange={(event) => setChangePasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="confirmPassword">
                <PasswordInput
                  id="confirmPassword"
                  required
                  minLength={4}
                  autoComplete="new-password"
                  value={changePasswordForm.confirmPassword}
                  onChange={(event) =>
                    setChangePasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
          <div className="card-footer">
            <button type="submit" className="btn btn-primary" disabled={isSavingPassword}>
              {isSavingPassword ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>

      <form className="card" onSubmit={onSaveGeneralFeedback}>
        <div className="card-header">
          <div>
            <h2>Send feedback</h2>
            <p className="subtitle">Tell your teachers how the exam portal is working for you.</p>
          </div>
          <MessageSquare size={20} className="muted" aria-hidden="true" />
        </div>
        <div className="card-body stack">
          <Field label="How would you rate it?">
            <RatingInput
              value={generalFeedbackForm.rating}
              onChange={(rating) => setGeneralFeedbackForm((previous) => ({ ...previous, rating }))}
            />
          </Field>
          <Field label="Comment" optional htmlFor="generalComment">
            <textarea
              id="generalComment"
              className="textarea"
              rows={3}
              maxLength={600}
              value={generalFeedbackForm.comment}
              onChange={(event) => setGeneralFeedbackForm((previous) => ({ ...previous, comment: event.target.value }))}
            />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={isSavingGeneralFeedback}>
              {isSavingGeneralFeedback ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
          {generalFeedbackHistory.length ? (
            <>
              <hr className="divider" />
              <h3 className="small muted">Your recent feedback</h3>
              <ul className="feedback-history">
                {generalFeedbackHistory.map((entry) => (
                  <li key={entry.id}>
                    <div className="row-between">
                      <strong>{entry.rating ? `${entry.rating} / 5` : 'No rating'}</strong>
                      <span className="hint">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    {entry.comment ? <p style={{ marginTop: '0.25rem' }}>{entry.comment}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function Dashboard(props) {
  const {
    branding,
    dashboard,
    tab,
    setTab,
    onOpenExam,
    onResume,
    onRefresh,
    isRefreshing,
    onLogout,
    onReviewTrial,
    onDownloadReport,
    onDispute,
    isReviewLoading,
    trialReview,
    onCloseReview,
    isStarting,
  } = props;

  const user = dashboard?.user;
  const exams = dashboard?.exams ?? [];
  const currentExams = exams.filter((exam) => !exam.archived);
  const archivedExams = exams.filter((exam) => exam.archived);
  const trials = dashboard?.trials ?? [];
  const leaderboards = dashboard?.leaderboards ?? {};
  const current = leaderboards.currentStudent ?? {};
  const activeSession = dashboard?.activeSession ?? null;
  const firstName = String(user?.fullName ?? '').split(' ')[0] || 'there';

  return (
    <div className="student-app">
      <StudentTopbar branding={branding} user={user} onLogout={onLogout} />

      <main className="page">
        <section className="welcome">
          <div>
            <h1>
              {greeting()}, {firstName}
            </h1>
            <p>
              {user?.classRoom} · {currentExams.length} current exam{currentExams.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="welcome-stats">
            <div className="welcome-stat">
              <span>Best score</span>
              <strong>{current.submittedTrials ? formatPercent(current.bestFinalPercent) : '—'}</strong>
            </div>
            <div className="welcome-stat">
              <span>Class rank</span>
              <strong>{current.classRank ? `#${current.classRank}` : '—'}</strong>
            </div>
            <div className="welcome-stat">
              <span>School rank</span>
              <strong>{current.overallRank ? `#${current.overallRank}` : '—'}</strong>
            </div>
          </div>
        </section>

        {user?.mustChangePassword ? (
          <div style={{ marginBottom: '1.25rem' }}>
            <Alert
              tone="warning"
              title="Please change your password"
              action={
                <button type="button" className="btn btn-sm btn-warning-soft" onClick={() => setTab('account')}>
                  Change now
                </button>
              }
            >
              Your password was set by a teacher. Choose a new one that only you know.
            </Alert>
          </div>
        ) : null}

        {activeSession ? (
          <div className="resume-banner">
            <AlertTriangle aria-hidden="true" />
            <div className="grow">
              <strong>{activeSession.exam?.title ?? 'Your exam'} is still in progress.</strong>
              <div className="small">The timer keeps running, so resume as soon as you can.</div>
            </div>
            <button type="button" className="btn btn-gold" onClick={onResume}>
              <RotateCcw aria-hidden="true" />
              Resume exam
            </button>
          </div>
        ) : null}

        <div className="row-between dash-tabs" style={{ alignItems: 'flex-end' }}>
          <div className="tabs grow" role="tablist" aria-label="Dashboard sections">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                <Icon aria-hidden="true" />
                {label}
                {id === 'results' && trials.length ? <span className="badge">{trials.length}</span> : null}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
        </div>

        {tab === 'exams' ? (
          <div className="stack stack-lg">
            {currentExams.length ? (
              <div className="exam-grid">
                {currentExams.map((exam) => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    isActive={activeSession?.exam?.id === exam.id}
                    onOpen={onOpenExam}
                    onResume={onResume}
                    disabled={isStarting || Boolean(activeSession)}
                  />
                ))}
              </div>
            ) : (
              <div className="card">
                <EmptyState icon={BookOpenCheck} title="No exams right now">
                  There are no current exams for {user?.classRoom || 'your class'}. Check back later.
                </EmptyState>
              </div>
            )}

            {archivedExams.length ? (
              <section className="archive-section">
                <div className="section-title">
                  <div>
                    <h2>
                      <Archive size={18} style={{ display: 'inline', verticalAlign: '-3px' }} aria-hidden="true" /> Past exams for practice
                    </h2>
                    <p>
                      These are older exams, not your current one. Try them in your spare time if you would like a result for them too.
                    </p>
                  </div>
                </div>
                <div className="exam-grid">
                  {archivedExams.map((exam) => (
                    <ExamCard
                      key={exam.id}
                      exam={exam}
                      isActive={activeSession?.exam?.id === exam.id}
                      onOpen={onOpenExam}
                      onResume={onResume}
                      disabled={isStarting || Boolean(activeSession)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'results' ? (
          <ResultsTab trials={trials} onReview={onReviewTrial} onDownload={onDownloadReport} isReviewLoading={isReviewLoading} />
        ) : null}

        {tab === 'leaderboard' ? (
          <div className="two-col">
            <LeaderboardTable
              title={`Top in ${leaderboards.classRoom || 'your class'}`}
              subtitle="Best score across all exams"
              rows={leaderboards.classTop ?? []}
            />
            <LeaderboardTable title="Top in the school" subtitle="Best score across all exams" rows={leaderboards.overall ?? []} showClass />
          </div>
        ) : null}

        {tab === 'account' ? (
          <AccountTab {...props} user={user} generalFeedbackHistory={dashboard?.generalFeedbackHistory ?? []} />
        ) : null}
      </main>

      <TrialReviewModal trial={trialReview} onClose={onCloseReview} onDownloadReport={onDownloadReport} onDispute={onDispute} />
    </div>
  );
}
