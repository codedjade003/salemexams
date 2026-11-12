import { useEffect, useMemo, useState } from 'react';
import { Download, ListChecks, Printer, Trash2, X } from 'lucide-react';

import {
  deleteAdminSession,
  deleteAdminSessions,
  downloadAdminPrintout,
  downloadAdminSessionReportCard,
  fetchAdminExams,
  fetchAdminSessions,
  purgeAdminSessions,
} from '../../api';
import { Alert, EmptyState, Field, Modal, Pagination, SessionStatusBadge, Switch } from '../../components/ui';
import { formatClock, formatDateTime, formatPercent, scoreTone } from '../../lib/format';
import { useDebouncedValue, usePagination } from '../../lib/hooks';
import { useAdmin, useAdminQuery } from '../context';
import { ClassFilter, ExamFilter, FilterSelect, PageHeader, SearchInput } from '../parts';

const PURGE_OPTIONS = [
  { scope: 'submitted', label: 'All submitted attempts' },
  { scope: 'time_up', label: 'All timed-out attempts' },
  { scope: 'active', label: 'All in-progress attempts' },
  { scope: 'all', label: 'Every attempt' },
];

/** Choose what to print: full report cards or a one-line-per-student result sheet. */
function PrintModal({ onClose, exams, classOptions, selectedIds, defaults }) {
  const { call, notify } = useAdmin();
  const [scope, setScope] = useState(selectedIds.length ? 'selected' : 'filter');
  const [examId, setExamId] = useState(defaults.examId || exams.find((exam) => !exam.archived)?.id || '');
  const [classRoom, setClassRoom] = useState(defaults.classRoom || '');
  const [attempt, setAttempt] = useState('best');
  const [busy, setBusy] = useState('');

  const print = async (kind) => {
    const body = scope === 'selected' ? { sessionIds: selectedIds, attempt: 'all' } : { examId, classRoom, attempt };
    setBusy(kind);
    const ok = await call(
      (token) =>
        downloadAdminPrintout(
          token,
          kind === 'cards' ? '/api/admin/report-cards' : '/api/admin/result-sheet',
          body,
          `${kind === 'cards' ? 'report-cards' : 'result-sheet'}${classRoom && scope !== 'selected' ? `-${classRoom.replace(/\s+/g, '')}` : ''}.html`
        ).then(() => true),
      'Could not prepare the printout.'
    );
    setBusy('');
    if (ok) {
      notify.info('Downloaded. Open the file and press “Print or save as PDF”.');
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Print results"
      subtitle="Downloads one file you can open and print. Only submitted attempts are included."
      footer={
        <>
          <button type="button" className="btn" onClick={() => void print('sheet')} disabled={Boolean(busy)}>
            {busy === 'sheet' ? 'Preparing…' : 'Result sheet (one line per student)'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void print('cards')} disabled={Boolean(busy)}>
            <Printer aria-hidden="true" />
            {busy === 'cards' ? 'Preparing…' : 'Full report cards'}
          </button>
        </>
      }
    >
      <div className="stack">
        {selectedIds.length ? (
          <div className="segmented" style={{ justifySelf: 'start' }}>
            <button type="button" aria-pressed={scope === 'selected'} onClick={() => setScope('selected')}>
              The {selectedIds.length} selected
            </button>
            <button type="button" aria-pressed={scope === 'filter'} onClick={() => setScope('filter')}>
              A whole exam or class
            </button>
          </div>
        ) : null}
        {scope === 'filter' ? (
          <>
            <div className="form-grid">
              <Field label="Exam" htmlFor="print-exam">
                <select id="print-exam" className="select" value={examId} onChange={(event) => setExamId(event.target.value)}>
                  <option value="">All exams</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Class" htmlFor="print-class">
                <select id="print-class" className="select" value={classRoom} onChange={(event) => setClassRoom(event.target.value)}>
                  <option value="">All classes</option>
                  {classOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="If a student has several attempts" htmlFor="print-attempt">
              <select id="print-attempt" className="select" value={attempt} onChange={(event) => setAttempt(event.target.value)}>
                <option value="best">Print their best attempt</option>
                <option value="latest">Print their latest attempt</option>
                <option value="all">Print every attempt</option>
              </select>
            </Field>
          </>
        ) : null}
        <Alert tone="info">
          Full report cards include every question, the student’s answer, the correct answer and the explanation, and each student starts
          on a new page (about 5 pages each). Printing one class at a time keeps the files manageable.
        </Alert>
      </div>
    </Modal>
  );
}

export default function AttemptsPage() {
  const { call, confirm, notify, classOptions, pageParams } = useAdmin();
  const [search, setSearch] = useState(pageParams.search ?? '');
  const [classRoom, setClassRoom] = useState('');
  const [status, setStatus] = useState('');
  const [examId, setExamId] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [printing, setPrinting] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(
    () => ({ search: debouncedSearch, classRoom, status, examId }),
    [classRoom, debouncedSearch, examId, status]
  );

  const { data, loading, reload } = useAdminQuery((token) => fetchAdminSessions(token, filters), JSON.stringify(filters));
  const { data: examData } = useAdminQuery((token) => fetchAdminExams(token));
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const pager = usePagination(sessions, 25, JSON.stringify(filters));

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(reload, 15_000);
    return () => clearInterval(id);
  }, [live, reload]);

  const visibleIds = pager.rows.map((row) => row.id);
  const selectedSet = new Set(selected.filter((id) => sessions.some((row) => row.id === id)));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const toggleAllVisible = (checked) => {
    setSelected((previous) => {
      const set = new Set(previous);
      for (const id of visibleIds) {
        if (checked) set.add(id);
        else set.delete(id);
      }
      return [...set];
    });
  };

  const handleDeleteOne = async (row) => {
    const ok = await confirm({
      title: 'Delete this attempt?',
      message: `${row.studentName}'s attempt ${row.trialNumber} at ${row.examTitle} will be removed, and the student gets that attempt back. This can’t be undone.`,
      confirmLabel: 'Delete attempt',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    const result = await call((token) => deleteAdminSession(token, row.id), 'Could not delete the attempt.');
    setBusy(false);
    if (result) {
      setSelected((previous) => previous.filter((id) => id !== row.id));
      notify.info('Attempt deleted.');
      reload();
    }
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedSet];
    const ok = await confirm({
      title: `Delete ${ids.length} attempt${ids.length === 1 ? '' : 's'}?`,
      message: 'The selected attempts and their results will be removed. This can’t be undone.',
      confirmLabel: 'Delete selected',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    const result = await call((token) => deleteAdminSessions(token, ids), 'Could not delete the selected attempts.');
    setBusy(false);
    if (result) {
      setSelected(Array.isArray(result.failedIds) ? result.failedIds : []);
      notify.info(`${result.deletedCount ?? ids.length} attempt(s) deleted.`);
      reload();
    }
  };

  const handlePurge = async (option) => {
    if (!option) return;
    const ok = await confirm({
      title: `Delete ${option.label.toLowerCase()}?`,
      message: 'This removes attempts from every class and exam, not just the ones shown. It can’t be undone. Export your results first if you need them.',
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    const result = await call((token) => purgeAdminSessions(token, option.scope), 'Could not delete attempts.');
    setBusy(false);
    if (result) {
      setSelected([]);
      notify.info(`${result.deletedCount ?? 0} attempt(s) deleted.`);
      reload();
    }
  };

  const handleReportCard = async (row) => {
    const result = await call(
      (token) => downloadAdminSessionReportCard(token, row.id, `report-card-${row.studentName.replace(/\s+/g, '-').toLowerCase()}.html`).then(() => true),
      'Could not download the report card.'
    );
    if (result) notify.info('Report card downloaded.');
  };

  const exams = examData?.exams ?? [];
  const hasFilters = Boolean(search || classRoom || status || examId);

  return (
    <>
      <PageHeader
        title="Attempts"
        description="Every exam attempt, live and finished. Turn on live updates while an exam is running."
        actions={
          <>
            <Switch id="live-updates" checked={live} onChange={setLive} label="Live updates" />
            <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)}>
              <Printer aria-hidden="true" /> Print results
            </button>
            <FilterSelect
              value=""
              label="Bulk delete"
              onChange={(scope) => void handlePurge(PURGE_OPTIONS.find((option) => option.scope === scope))}
            >
              <option value="">Bulk delete…</option>
              {PURGE_OPTIONS.map((option) => (
                <option key={option.scope} value={option.scope}>
                  {option.label}
                </option>
              ))}
            </FilterSelect>
          </>
        }
      />

      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, exam or ID" />
        <ClassFilter value={classRoom} onChange={setClassRoom} classOptions={classOptions} />
        <FilterSelect value={status} onChange={setStatus} label="Status">
          <option value="">Any status</option>
          <option value="active">In progress</option>
          <option value="submitted">Submitted</option>
          <option value="time_up">Time up</option>
        </FilterSelect>
        <ExamFilter value={examId} onChange={setExamId} exams={exams} />
        {hasFilters ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('');
              setClassRoom('');
              setStatus('');
              setExamId('');
            }}
          >
            <X aria-hidden="true" /> Clear filters
          </button>
        ) : null}
      </div>

      {selectedSet.size > 0 ? (
        <div className="bulk-bar">
          <strong>{selectedSet.size} selected</strong>
          <button type="button" className="btn btn-sm" onClick={() => setPrinting(true)}>
            <Printer aria-hidden="true" /> Print selected
          </button>
          <button type="button" className="btn btn-sm btn-danger-soft" onClick={handleDeleteSelected} disabled={busy}>
            <Trash2 aria-hidden="true" /> Delete selected
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="card card-flush">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className={`table ${loading ? 'is-loading' : ''}`}>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    className="check"
                    aria-label="Select all on this page"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleAllVisible(event.target.checked)}
                    disabled={!visibleIds.length}
                  />
                </th>
                <th>Student</th>
                <th>Exam</th>
                <th>Status</th>
                <th className="col-num">Result</th>
                <th className="col-num">Violations</th>
                <th>Started</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((row) => (
                <tr key={row.id} className={selectedSet.has(row.id) ? 'is-selected' : ''}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.studentName}`}
                      checked={selectedSet.has(row.id)}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked ? [...previous, row.id] : previous.filter((id) => id !== row.id)
                        )
                      }
                    />
                  </td>
                  <td>
                    <span className="cell-primary">{row.studentName}</span>
                    {row.isTest ? <span className="badge badge-gold you-tag">Test</span> : null}
                    <span className="cell-sub">
                      {row.classRoom} · {row.email || '—'}
                    </span>
                  </td>
                  <td>
                    <span className="truncate" style={{ display: 'block', maxWidth: 220 }} title={row.examTitle}>
                      {row.examTitle}
                    </span>
                    <span className="cell-sub">Attempt {row.trialNumber}</span>
                  </td>
                  <td>
                    <SessionStatusBadge status={row.status} />
                  </td>
                  <td className="col-num">
                    {row.status === 'submitted' ? (
                      <span className={`badge ${scoreTone(row.finalPercent)}`}>{formatPercent(row.finalPercent)}</span>
                    ) : (
                      <span className="small">
                        {row.answeredCount}/{row.totalQuestions || '—'} answered
                        {row.status === 'active' ? <span className="cell-sub">{formatClock(row.remainingSeconds)} left</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="col-num">
                    {row.violationsCount}
                    {row.waivedViolationsCount ? <span className="cell-sub">{row.waivedViolationsCount} waived</span> : null}
                  </td>
                  <td className="small">{formatDateTime(row.startedAt)}</td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-icon"
                        onClick={() => void handleReportCard(row)}
                        aria-label="Download report card"
                        title="Download report card"
                      >
                        <Download />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-danger-soft"
                        onClick={() => void handleDeleteOne(row)}
                        disabled={busy}
                        aria-label="Delete attempt"
                        title="Delete attempt"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!sessions.length ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <EmptyState icon={ListChecks} title={loading ? 'Loading attempts…' : 'No attempts found'}>
                      {hasFilters ? 'Try clearing the filters.' : 'Attempts appear here as soon as students start an exam.'}
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination pager={pager} label="attempts" />
      {printing ? (
        <PrintModal
          onClose={() => setPrinting(false)}
          exams={exams}
          classOptions={classOptions}
          selectedIds={[...selectedSet]}
          defaults={{ examId, classRoom }}
        />
      ) : null}
    </>
  );
}
