import { useState } from 'react';
import { Download, LogOut, MessageSquareWarning, ShieldCheck, Star } from 'lucide-react';

import { Alert, BrandLockup, Modal } from '../components/ui';
import { durationLabel, formatDateTime, initials, violationLabel } from '../lib/format';
import { QuestionReviewList } from '../questions/QuestionReview';

export function StudentTopbar({ branding, user, onLogout }) {
  return (
    <header className="topbar">
      <BrandLockup branding={branding} />
      <div className="row" style={{ gap: '0.9rem', flexWrap: 'nowrap' }}>
        {user ? (
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {initials(user.fullName)}
            </span>
            <span className="who">
              <strong className="truncate">{user.fullName}</strong>
              <span>{user.classRoom}</span>
            </span>
          </div>
        ) : null}
        {onLogout ? (
          <button type="button" className="btn btn-sm" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}

const RATING_LABELS = ['Poor', 'Fair', 'Okay', 'Good', 'Excellent'];

export function RatingInput({ value, onChange, label = 'Rating' }) {
  const current = Number(value) || 0;
  return (
    <div className="stack" style={{ '--stack-gap': '0.35rem' }}>
      <div className="rating" role="radiogroup" aria-label={label}>
        {RATING_LABELS.map((ratingLabel, index) => {
          const rating = index + 1;
          return (
            <button
              key={ratingLabel}
              type="button"
              role="radio"
              aria-checked={current === rating}
              aria-label={`${rating} – ${ratingLabel}`}
              className={rating <= current ? 'is-on' : ''}
              onClick={() => onChange(current === rating ? '' : String(rating))}
            >
              <Star aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <span className="hint">{current ? `${current} – ${RATING_LABELS[current - 1]}` : 'No rating selected'}</span>
    </div>
  );
}

const DISPUTE_REASONS = [
  { id: 'accident', label: 'It was an accident' },
  { id: 'not_me', label: 'I didn’t do anything; it happened by itself' },
  { id: 'other', label: 'Something else' },
];

function DisputeForm({ onSend, onCancel }) {
  const [reason, setReason] = useState('accident');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <form
      className="dispute-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        await onSend({ reason, note });
        setSending(false);
      }}
    >
      {DISPUTE_REASONS.map((item) => (
        <label key={item.id} className="check">
          <input type="radio" name="dispute-reason" checked={reason === item.id} onChange={() => setReason(item.id)} />
          {item.label}
        </label>
      ))}
      <textarea
        className="textarea"
        rows={2}
        maxLength={400}
        placeholder="Tell your teacher what happened (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={sending}>
          {sending ? 'Sending…' : 'Send dispute'}
        </button>
      </div>
    </form>
  );
}

/** The proctoring log for one attempt. After submitting, students can dispute an entry. */
export function ViolationsPanel({ sessionId, violations, onDispute }) {
  const [openId, setOpenId] = useState('');
  const visible = (violations ?? []).filter((violation) => violation.type !== 'exam_reopened');

  if (!visible.length) {
    return (
      <p className="muted small">
        <ShieldCheck size={15} style={{ display: 'inline', verticalAlign: '-3px' }} aria-hidden="true" /> No violations were recorded.
        Well done.
      </p>
    );
  }

  return (
    <ul className="violation-list">
      {visible.map((violation) => {
        const dispute = violation.dispute;
        return (
          <li key={violation.id} className={violation.waived ? 'is-waived' : ''} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
            <span>
              <span className="violation-name">{violationLabel(violation.type)}</span>
              <span className="cell-sub">
                {formatDateTime(violation.occurredAt)}
                {violation.evidence?.durationMs ? ` · away for ${durationLabel(violation.evidence.durationMs)}` : ''}
                {violation.evidence?.questionNumber ? ` · on question ${violation.evidence.questionNumber}` : ''}
              </span>
            </span>
            <span className="row" style={{ gap: '0.35rem', justifyContent: 'flex-end' }}>
              {violation.waived ? (
                <span className="badge badge-success">Removed</span>
              ) : violation.deduct === false ? (
                <span className="badge">No points lost</span>
              ) : (
                <span className="badge badge-warning">Counted</span>
              )}
              {dispute ? (
                <span className={`badge ${dispute.status === 'open' ? 'badge-gold' : dispute.status === 'accepted' ? 'badge-success' : ''}`}>
                  {dispute.status === 'open' ? 'Dispute sent' : dispute.status === 'accepted' ? 'Dispute accepted' : 'Dispute not accepted'}
                </span>
              ) : onDispute && !violation.waived && violation.deduct !== false ? (
                <button type="button" className="btn btn-sm" onClick={() => setOpenId(openId === violation.id ? '' : violation.id)}>
                  <MessageSquareWarning aria-hidden="true" /> Dispute
                </button>
              ) : null}
            </span>
            {dispute?.adminNote ? <span className="cell-sub">Teacher’s note: {dispute.adminNote}</span> : null}
            {openId === violation.id ? (
              <DisputeForm
                onCancel={() => setOpenId('')}
                onSend={async (payload) => {
                  if (await onDispute(sessionId, violation.id, payload)) setOpenId('');
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TrialReviewModal({ trial, onClose, onDownloadReport, onDispute }) {
  const locked = trial?.resultsReleased === false;
  return (
    <Modal
      open={Boolean(trial)}
      onClose={onClose}
      size="lg"
      title={trial ? `${trial.exam?.title ?? 'Exam'} · Attempt ${trial.trialNumber ?? 1}` : ''}
      subtitle={trial?.submittedAt ? `Submitted ${formatDateTime(trial.submittedAt)}` : 'Not submitted'}
      footer={
        <>
          {trial?.submittedAt ? (
            <button type="button" className="btn" onClick={() => onDownloadReport(trial.id)}>
              <Download aria-hidden="true" />
              Report card
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {trial ? (
        <div className="stack stack-lg">
          <section className="stack" style={{ '--stack-gap': '0.6rem' }}>
            <h3>Violations</h3>
            <ViolationsPanel sessionId={trial.id} violations={trial.violations} onDispute={trial.submittedAt ? onDispute : null} />
          </section>
          <section className="stack" style={{ '--stack-gap': '0.6rem' }}>
            <h3>Your answers</h3>
            {locked ? (
              <Alert tone="info" title="Corrections are not released yet">
                You can see the answers you chose. Correct answers and explanations open on {formatDateTime(trial.resultsAvailableAt)}.
              </Alert>
            ) : null}
            <QuestionReviewList items={trial.questionReview} />
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
