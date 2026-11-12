import { useMemo, useState } from 'react';
import { Camera, ChevronRight, Download, GraduationCap, Lightbulb, ShieldCheck, ShieldOff } from 'lucide-react';

import {
  downloadAdminSessionReportCard,
  fetchAdminExams,
  fetchAdminStudents,
  fetchAdminStudentTrials,
  setAdminGrade,
  waiveAdminSessionViolations,
} from '../../api';
import { EmptyState, Modal, Pagination, SessionStatusBadge, StatCard } from '../../components/ui';
import { durationLabel, formatDateTime, formatPercent, formatRelative, scoreTone, violationLabel } from '../../lib/format';
import { useDebouncedValue, usePagination } from '../../lib/hooks';
import { QuestionReviewList } from '../../questions/QuestionReview';
import { useAdmin, useAdminQuery } from '../context';
import { ClassFilter, ExamFilter, PageHeader, SearchInput } from '../parts';

function TrialBlock({ trial, onChanged }) {
  const { call, notify } = useAdmin();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const summary = trial.summary ?? {};
  const violations = trial.violations ?? [];

  const update = async (mode, waived) => {
    if (mode === 'selected' && !selected.length) {
      notify.error('Select at least one violation first.');
      return;
    }
    setBusy(true);
    const result = await call(
      (token) =>
        waiveAdminSessionViolations(token, trial.id, {
          waiveAll: mode === 'all',
          violationIds: mode === 'selected' ? selected : [],
          waived,
        }),
      'Could not update violations.'
    );
    setBusy(false);
    if (result) {
      setSelected([]);
      notify.info(waived ? 'Violations waived. The score has been recalculated.' : 'Violations restored.');
      onChanged();
    }
  };

  const grade = async (item, correct) => {
    setBusy(true);
    const result = await call((token) => setAdminGrade(token, trial.id, item.questionId, correct), 'Could not change the mark.');
    setBusy(false);
    if (result) {
      notify.info(correct === null ? 'Automatic mark restored.' : `Question ${item.index} marked ${correct ? 'correct' : 'incorrect'}.`);
      onChanged();
    }
  };

  const CAMERA_LABELS = { on: 'Camera and microphone on', unavailable: 'No camera on this computer', denied: 'Camera not turned on' };

  const downloadReport = async () => {
    const ok = await call(
      (token) => downloadAdminSessionReportCard(token, trial.id, `report-card-${trial.id.slice(0, 8)}.html`).then(() => true),
      'Could not download the report card.'
    );
    if (ok) notify.info('Report card downloaded.');
  };

  return (
    <article className="trial-block">
      <div className="trial-block-head">
        <div className="row">
          <strong>Attempt {trial.trialNumber}</strong>
          <SessionStatusBadge status={trial.status} />
          {trial.submittedAt ? (
            <span className={`badge ${scoreTone(summary.finalPercent)}`}>{formatPercent(summary.finalPercent)}</span>
          ) : null}
          <span className="hint">Started {formatDateTime(trial.startedAt)}</span>
          {trial.setup?.camera && trial.setup.camera !== 'unknown' ? (
            <span className={`badge ${trial.setup.camera === 'on' ? '' : 'badge-warning'}`}>
              <Camera aria-hidden="true" /> {CAMERA_LABELS[trial.setup.camera]}
            </span>
          ) : null}
          {trial.hintLimit ? (
            <span className="badge badge-gold">
              <Lightbulb aria-hidden="true" /> {trial.hintsUsed} of {trial.hintLimit} hints used
            </span>
          ) : null}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void downloadReport()}>
          <Download aria-hidden="true" /> Report card
        </button>
      </div>
      <div className="trial-block-body stack">
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <StatCard label="Correct" value={`${summary.correctCount ?? 0}/${summary.totalQuestions ?? 0}`} />
          <StatCard label="Answered" value={`${summary.answeredCount ?? 0}/${summary.totalQuestions ?? 0}`} />
          <StatCard label="Before penalties" value={formatPercent(summary.rawPercent ?? 0)} />
          <StatCard
            label="Penalty"
            value={summary.penaltyPoints ? `−${summary.penaltyPoints} pts` : '0 pts'}
            meta={`${summary.violationsCount ?? 0} counted`}
          />
        </div>

        <div className="stack" style={{ '--stack-gap': '0.6rem' }}>
          <div className="row-between">
            <h3>Proctoring log</h3>
            {violations.length ? (
              <div className="row">
                <button type="button" className="btn btn-sm" disabled={busy || !selected.length} onClick={() => void update('selected', true)}>
                  <ShieldOff aria-hidden="true" /> Waive selected
                </button>
                <button type="button" className="btn btn-sm" disabled={busy || !selected.length} onClick={() => void update('selected', false)}>
                  Restore selected
                </button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void update('all', true)}>
                  Waive all
                </button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void update('all', false)}>
                  Restore all
                </button>
              </div>
            ) : null}
          </div>
          {violations.length ? (
            <ul className="violation-list">
              {violations.map((violation) => (
                <li key={violation.id} className={violation.waived ? 'is-waived' : ''}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${violationLabel(violation.type)} at ${formatDateTime(violation.occurredAt)}`}
                    checked={selected.includes(violation.id)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked ? [...previous, violation.id] : previous.filter((id) => id !== violation.id)
                      )
                    }
                  />
                  <span>
                    <span className="violation-name">{violationLabel(violation.type)}</span>
                    <span className="cell-sub">
                      {formatDateTime(violation.occurredAt)}
                      {violation.evidence?.durationMs !== undefined ? ` · away ${durationLabel(violation.evidence.durationMs)}` : ''}
                      {violation.evidence?.questionNumber ? ` · on question ${violation.evidence.questionNumber}` : ''}
                      {violation.dispute ? ` · dispute ${violation.dispute.status}` : ''}
                    </span>
                  </span>
                  {violation.waived ? (
                    <span className="badge">Waived</span>
                  ) : violation.deduct === false ? (
                    <span className="badge">Logged only</span>
                  ) : (
                    <span className="badge badge-warning">Counted</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              <ShieldCheck size={15} style={{ display: 'inline', verticalAlign: '-3px' }} aria-hidden="true" /> No proctoring
              events were logged for this attempt.
            </p>
          )}
        </div>

        {trial.feedback ? (
          <div className="alert">
            <span className="badge badge-gold">{trial.feedback.rating ? `${trial.feedback.rating}/5` : 'Feedback'}</span>
            <span>{trial.feedback.comment || 'No comment.'}</span>
          </div>
        ) : null}

        <details>
          <summary className="link-button" style={{ cursor: 'pointer' }}>
            Show answers ({trial.questionReview?.length ?? 0} questions)
          </summary>
          <div style={{ marginTop: '0.75rem' }}>
            <QuestionReviewList
              items={trial.questionReview}
              renderActions={(item) => (
                <>
                  <span className="hint grow">
                    {item.manualGrade !== null ? 'You set this mark.' : item.type === 'code' ? 'Checked automatically in the student’s browser.' : 'Marked automatically.'}
                    {item.hintUsed ? ' The student used a hint here.' : ''}
                  </span>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void grade(item, true)}>
                    Mark correct
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void grade(item, false)}>
                    Mark incorrect
                  </button>
                  {item.manualGrade !== null ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void grade(item, null)}>
                      Use automatic mark
                    </button>
                  ) : null}
                </>
              )}
            />
          </div>
        </details>
      </div>
    </article>
  );
}

function StudentTrialsModal({ studentKey, onClose, onChanged }) {
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminStudentTrials(token, studentKey), studentKey);
  const student = data?.student;
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={student ? student.studentName : 'Loading…'}
      subtitle={student ? `${student.classRoom} · ${student.examTitle} · ${data.totalTrials} attempt(s)` : ''}
    >
      {loading && !data ? (
        <EmptyState title="Loading attempts…" />
      ) : (
        (data?.trials ?? []).map((trial) => (
          <TrialBlock
            key={trial.id}
            trial={trial}
            onChanged={() => {
              reload();
              onChanged();
            }}
          />
        ))
      )}
    </Modal>
  );
}

export default function StudentsPage() {
  const { classOptions } = useAdmin();
  const [search, setSearch] = useState('');
  const [classRoom, setClassRoom] = useState('');
  const [examId, setExamId] = useState('');
  const [openKey, setOpenKey] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ search: debouncedSearch, classRoom, examId }), [classRoom, debouncedSearch, examId]);
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminStudents(token, filters), JSON.stringify(filters));
  const { data: examData } = useAdminQuery((token) => fetchAdminExams(token));
  const students = useMemo(() => data?.students ?? [], [data]);
  const pager = usePagination(students, 20, JSON.stringify(filters));

  return (
    <>
      <PageHeader
        title="Results by student"
        description="Each student’s attempts at each exam. Open a row to review answers or waive proctoring penalties."
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or email" />
        <ClassFilter value={classRoom} onChange={setClassRoom} classOptions={classOptions} />
        <ExamFilter value={examId} onChange={setExamId} exams={examData?.exams ?? []} />
      </div>

      <div className="card card-flush">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className={`table ${loading ? 'is-loading' : ''}`}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Exam</th>
                <th className="col-num">Attempts</th>
                <th className="col-num">Best</th>
                <th className="col-num">Average</th>
                <th>Last attempt</th>
                <th className="col-actions">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((row) => (
                <tr key={row.studentKey} style={{ cursor: 'pointer' }} onClick={() => setOpenKey(row.studentKey)}>
                  <td>
                    <span className="cell-primary">{row.studentName}</span>
                    <span className="cell-sub">
                      {row.classRoom} · {row.email || '—'}
                    </span>
                  </td>
                  <td>{row.examTitle}</td>
                  <td className="col-num">
                    {row.submittedTrials}/{row.totalTrials}
                    {row.activeTrials ? <span className="cell-sub">{row.activeTrials} in progress</span> : null}
                  </td>
                  <td className="col-num">
                    {row.submittedTrials ? (
                      <span className={`badge ${scoreTone(row.bestFinalPercent)}`}>{formatPercent(row.bestFinalPercent)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="col-num">{row.submittedTrials ? formatPercent(row.averageFinalPercent) : '—'}</td>
                  <td className="small muted">{formatRelative(row.latestStartedAt)}</td>
                  <td className="col-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenKey(row.studentKey);
                      }}
                    >
                      Open <ChevronRight aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {!students.length ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <EmptyState icon={GraduationCap} title={loading ? 'Loading…' : 'No results yet'}>
                      Students appear here after their first attempt.
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination pager={pager} label="students" />

      {openKey ? <StudentTrialsModal studentKey={openKey} onClose={() => setOpenKey('')} onChanged={reload} /> : null}
    </>
  );
}
