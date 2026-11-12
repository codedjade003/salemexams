import { useState } from 'react';
import { Check, MessageSquareWarning, X } from 'lucide-react';

import { fetchAdminDisputes, resolveAdminDispute } from '../../api';
import { EmptyState } from '../../components/ui';
import { durationLabel, formatDateTime, formatRelative, violationLabel } from '../../lib/format';
import { useAdmin, useAdminQuery } from '../context';
import { PageHeader } from '../parts';

const REASONS = {
  accident: 'It was an accident',
  not_me: 'I didn’t do anything; it happened by itself',
  other: 'Something else',
};

function Evidence({ dispute }) {
  const evidence = dispute.evidence ?? {};
  const facts = [
    ['What was detected', violationLabel(dispute.type)],
    ['When', formatDateTime(dispute.occurredAt)],
    evidence.durationMs !== undefined ? ['Time away', durationLabel(evidence.durationMs)] : null,
    evidence.causes?.length > 1 ? ['Also detected', evidence.causes.filter((cause) => cause !== dispute.type).map(violationLabel).join(', ')] : null,
    evidence.questionNumber ? ['Was on question', evidence.questionNumber] : null,
    evidence.remainingSeconds !== undefined ? ['Time left in exam', `${Math.floor(evidence.remainingSeconds / 60)} min ${evidence.remainingSeconds % 60} s`] : null,
    ['Violations in this attempt', dispute.totalViolations],
  ].filter(Boolean);

  return (
    <dl className="evidence-grid">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DisputeCard({ dispute, onResolved }) {
  const { call, notify } = useAdmin();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const open = dispute.dispute.status === 'open';
  const brief = Number.isFinite(dispute.evidence?.durationMs) && dispute.evidence.durationMs < 5000;

  const decide = async (decision) => {
    setBusy(true);
    const result = await call(
      (token) => resolveAdminDispute(token, dispute.sessionId, dispute.violationId, { decision, adminNote: note }),
      'Could not save your decision.'
    );
    setBusy(false);
    if (result) {
      notify.info(decision === 'accept' ? 'Violation removed and the score recalculated.' : 'Dispute rejected; the violation stays.');
      onResolved();
    }
  };

  return (
    <article className="card dispute-card">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>{dispute.studentName}</h3>
          <p className="muted small">
            {dispute.classRoom} · {dispute.examTitle} · attempt {dispute.trialNumber}
            {dispute.finalPercent !== null ? ` · score ${dispute.finalPercent}%` : ''}
          </p>
        </div>
        {open ? (
          <span className="badge badge-gold">Waiting for you</span>
        ) : dispute.dispute.status === 'accepted' ? (
          <span className="badge badge-success">Accepted</span>
        ) : (
          <span className="badge">Rejected</span>
        )}
      </div>

      <blockquote className="dispute-quote">
        <strong>{REASONS[dispute.dispute.reason] ?? 'Dispute'}</strong>
        {dispute.dispute.note ? <p>“{dispute.dispute.note}”</p> : null}
        <span className="hint">Sent {formatRelative(dispute.dispute.submittedAt)}</span>
      </blockquote>

      <Evidence dispute={dispute} />
      {brief ? (
        <p className="small" style={{ color: 'var(--success-700)' }}>
          The student was away for under 5 seconds, which is consistent with an accident.
        </p>
      ) : null}

      {open ? (
        <div className="stack" style={{ '--stack-gap': '0.5rem' }}>
          <input
            className="input input-sm"
            placeholder="Note to the student (optional)"
            aria-label="Note to the student"
            maxLength={400}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={() => void decide('reject')} disabled={busy}>
              <X aria-hidden="true" /> Keep the violation
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void decide('accept')} disabled={busy}>
              <Check aria-hidden="true" /> Accept and remove it
            </button>
          </div>
        </div>
      ) : dispute.dispute.adminNote ? (
        <p className="small muted">Your note: {dispute.dispute.adminNote}</p>
      ) : null}
    </article>
  );
}

export default function DisputesPage() {
  const { refreshBadges } = useAdmin();
  const [status, setStatus] = useState('open');
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminDisputes(token, status), status);
  const disputes = data?.disputes ?? [];

  return (
    <>
      <PageHeader
        title="Violation disputes"
        description="Students who say a violation was a mistake. Accepting removes the violation and restores the points."
      />
      <div className="filter-bar">
        <div className="segmented" role="tablist" aria-label="Dispute status">
          {[
            ['open', 'Waiting'],
            ['resolved', 'Decided'],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {disputes.length ? (
        <div className="grid-2" style={{ opacity: loading ? 0.6 : 1 }}>
          {disputes.map((dispute) => (
            <DisputeCard
              key={`${dispute.sessionId}-${dispute.violationId}`}
              dispute={dispute}
              onResolved={() => {
                reload();
                void refreshBadges();
              }}
            />
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState icon={MessageSquareWarning} title={loading ? 'Loading…' : status === 'open' ? 'No disputes waiting' : 'No disputes'}>
            {status === 'open' ? 'When a student disputes a violation it appears here.' : null}
          </EmptyState>
        </div>
      )}
    </>
  );
}
