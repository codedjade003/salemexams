import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  FileQuestion,
  ListPlus,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  UsersRound,
} from 'lucide-react';

import { createAdminExam, deleteAdminExam, fetchAdminExams, fetchAdminQuestions, updateAdminExam } from '../../api';
import { Alert, EmptyState, Field, Modal, Switch } from '../../components/ui';
import { formatDuration, formatNumber, pluralize } from '../../lib/format';
import { useAdmin, useAdminQuery } from '../context';
import { PageHeader } from '../parts';
import { QuestionForm } from '../QuestionForm';
import { EMPTY_QUESTION, formToPayload as questionToPayload, QUESTION_KINDS, validateQuestionForm } from '../questionUtils';

const PROCTOR_RULES = [
  { track: 'tab_switch', deduct: 'deductTabSwitch', label: 'Leaving the exam tab' },
  { track: 'window_blur', deduct: 'deductWindowBlur', label: 'Exam window losing focus' },
  { track: 'fullscreen_exit', deduct: 'deductFullscreenExit', label: 'Leaving full screen' },
  { track: 'right_click', deduct: 'deductRightClick', label: 'Right-click' },
  { track: 'restricted_key', deduct: 'deductRestrictedKey', label: 'Copy, paste and developer shortcuts' },
];

const DEFAULT_PROCTORING = {
  tab_switch: true,
  window_blur: true,
  fullscreen_exit: true,
  right_click: true,
  restricted_key: true,
  deductTabSwitch: true,
  deductWindowBlur: true,
  deductFullscreenExit: true,
  deductRightClick: false,
  deductRestrictedKey: false,
};

function examToForm(exam, classOptions) {
  return {
    title: exam?.title ?? '',
    description: exam?.description ?? '',
    durationMinutes: Math.round((exam?.durationSeconds ?? 1500) / 60),
    maxAttempts: exam?.maxAttempts ?? 3,
    questionCount: exam?.questionCount ?? 40,
    published: exam?.published ?? true,
    archived: exam?.archived ?? false,
    hintsAllowed: exam?.hintsAllowed ?? 0,
    hintClasses: [...(exam?.hintClasses ?? [])],
    hintNote: exam?.hintNote ?? '',
    allowedClasses: exam?.allowedClasses?.length ? [...exam.allowedClasses] : [...classOptions],
    proctoring: { ...DEFAULT_PROCTORING, ...(exam?.proctoring ?? {}) },
  };
}

function formToPayload(form) {
  return {
    title: form.title,
    description: form.description,
    durationSeconds: Math.round(Number(form.durationMinutes) * 60),
    maxAttempts: Number(form.maxAttempts),
    questionCount: Number(form.questionCount),
    published: Boolean(form.published),
    archived: Boolean(form.archived),
    hintsAllowed: Number(form.hintsAllowed) || 0,
    hintClasses: form.hintClasses,
    hintNote: form.hintNote,
    allowedClasses: form.allowedClasses,
    proctoring: form.proctoring,
  };
}

function ExamSettingsFields({ form, setForm, classOptions, questionCountHint }) {
  const set = (patch) => setForm((previous) => ({ ...previous, ...patch }));
  const toggleClass = (classRoom) => {
    const next = new Set(form.allowedClasses);
    if (next.has(classRoom)) next.delete(classRoom);
    else next.add(classRoom);
    set({ allowedClasses: classOptions.filter((option) => next.has(option)) });
  };

  return (
    <div className="stack stack-lg">
      <div className="stack">
        <Field label="Title" htmlFor="exam-title">
          <input id="exam-title" className="input" required minLength={3} value={form.title} onChange={(event) => set({ title: event.target.value })} />
        </Field>
        <Field label="Description" optional htmlFor="exam-description" hint="Shown to students on the exam card.">
          <textarea
            id="exam-description"
            className="textarea"
            rows={2}
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
        <div className="grid-3" style={{ gap: '1rem' }}>
          <Field label="Time allowed (minutes)" htmlFor="exam-duration">
            <input
              id="exam-duration"
              className="input"
              type="number"
              min={1}
              max={180}
              required
              value={form.durationMinutes}
              onChange={(event) => set({ durationMinutes: event.target.value })}
            />
          </Field>
          <Field label="Attempts per student" htmlFor="exam-attempts">
            <input
              id="exam-attempts"
              className="input"
              type="number"
              min={1}
              max={50}
              required
              value={form.maxAttempts}
              onChange={(event) => set({ maxAttempts: event.target.value })}
            />
          </Field>
          <Field label="Questions per attempt" htmlFor="exam-count" hint={questionCountHint}>
            <input
              id="exam-count"
              className="input"
              type="number"
              min={1}
              max={500}
              required
              value={form.questionCount}
              onChange={(event) => set({ questionCount: event.target.value })}
            />
          </Field>
        </div>
        <Switch id="exam-published" checked={form.published} onChange={(value) => set({ published: value })} label="Published (visible to students)" />
        <Switch
          id="exam-archived"
          checked={form.archived}
          onChange={(value) => set({ archived: value })}
          label="Archived (shown to students as an old exam for optional practice)"
        />
      </div>

      <div className="field">
        <div className="row-between">
          <span className="label">Classes that can take it</span>
          <div className="row" style={{ gap: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ allowedClasses: [...classOptions] })}>
              Select all
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ allowedClasses: [] })}>
              Clear
            </button>
          </div>
        </div>
        <div className="chip-group">
          {classOptions.map((classRoom) => (
            <button
              key={classRoom}
              type="button"
              className="chip"
              aria-pressed={form.allowedClasses.includes(classRoom)}
              onClick={() => toggleClass(classRoom)}
            >
              {form.allowedClasses.includes(classRoom) ? <CheckCircle2 aria-hidden="true" /> : null}
              {classRoom}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Hints</span>
        <span className="hint">
          Each question can have a hint (edit it in the question bank). Students only see a hint when they spend one. Set the number
          to 0 to turn hints off.
        </span>
        <div className="form-grid" style={{ marginTop: '0.4rem' }}>
          <Field label="Hints per student" htmlFor="exam-hints">
            <input
              id="exam-hints"
              className="input"
              type="number"
              min={0}
              max={20}
              value={form.hintsAllowed}
              onChange={(event) => set({ hintsAllowed: event.target.value })}
            />
          </Field>
          <Field label="Message shown to those students" optional htmlFor="exam-hint-note">
            <input id="exam-hint-note" className="input" maxLength={300} value={form.hintNote} onChange={(event) => set({ hintNote: event.target.value })} />
          </Field>
        </div>
        {Number(form.hintsAllowed) > 0 ? (
          <>
            <span className="hint">Classes that get hints ({form.hintClasses.length} selected):</span>
            <div className="chip-group">
              {classOptions.map((classRoom) => {
                const on = form.hintClasses.includes(classRoom);
                return (
                  <button
                    key={classRoom}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        hintClasses: on
                          ? form.hintClasses.filter((item) => item !== classRoom)
                          : classOptions.filter((item) => item === classRoom || form.hintClasses.includes(item)),
                      })
                    }
                  >
                    {on ? <CheckCircle2 aria-hidden="true" /> : null}
                    {classRoom}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <div className="field">
        <span className="label">Proctoring</span>
        <span className="hint">
          Logged events are visible to you. Events that deduct points remove a few percentage points each and can be waived later.
        </span>
        <div className="table-wrap" style={{ marginTop: '0.4rem' }}>
          <table className="table proctor-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Log it</th>
                <th>Deduct points</th>
              </tr>
            </thead>
            <tbody>
              {PROCTOR_RULES.map((rule) => (
                <tr key={rule.track}>
                  <td>{rule.label}</td>
                  <td>
                    <Switch
                      id={`track-${rule.track}`}
                      checked={form.proctoring[rule.track] !== false}
                      onChange={(value) =>
                        set({
                          proctoring: {
                            ...form.proctoring,
                            [rule.track]: value,
                            [rule.deduct]: value ? form.proctoring[rule.deduct] : false,
                          },
                        })
                      }
                      label={<span className="sr-only">Log {rule.label}</span>}
                    />
                  </td>
                  <td>
                    <Switch
                      id={`deduct-${rule.track}`}
                      checked={form.proctoring[rule.track] !== false && Boolean(form.proctoring[rule.deduct])}
                      disabled={form.proctoring[rule.track] === false}
                      onChange={(value) => set({ proctoring: { ...form.proctoring, [rule.deduct]: value } })}
                      label={<span className="sr-only">Deduct points for {rule.label}</span>}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EditExamModal({ exam, onClose, onSaved }) {
  const { call, notify, classOptions } = useAdmin();
  const [form, setForm] = useState(() => examToForm(exam, classOptions));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!form.allowedClasses.length) {
      setError('Choose at least one class.');
      return;
    }
    setError('');
    setSaving(true);
    const result = await call((token) => updateAdminExam(token, exam.id, formToPayload(form)), 'Could not save the exam.');
    setSaving(false);
    if (result) {
      notify.info(`${result.exam?.title ?? 'Exam'} saved.`);
      onSaved();
      onClose();
    }
  };

  const hint =
    exam.mode === 'fixed'
      ? `This exam has ${exam.availableQuestionCount} question(s).`
      : `${exam.availableQuestionCount} question(s) in the pool; each student gets a random set.`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Edit ${exam.title}`}
      subtitle="Changes apply to attempts started from now on."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-exam-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save exam'}
          </button>
        </>
      }
    >
      <form id="edit-exam-form" onSubmit={submit} className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ExamSettingsFields form={form} setForm={setForm} classOptions={classOptions} questionCountHint={hint} />
      </form>
    </Modal>
  );
}

function CreateExamModal({ onClose, onCreated, topics }) {
  const { call, notify, classOptions } = useAdmin();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => ({ ...examToForm(null, classOptions), questionCount: 10 }));
  const [draft, setDraft] = useState(EMPTY_QUESTION);
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const goToQuestions = (event) => {
    event.preventDefault();
    if (form.title.trim().length < 3) {
      setError('Give the exam a title (at least 3 characters).');
      return;
    }
    if (!form.allowedClasses.length) {
      setError('Choose at least one class.');
      return;
    }
    setError('');
    setStep(2);
  };

  const addDraft = () => {
    const problem = validateQuestionForm(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setQuestions((previous) => [...previous, draft]);
    setDraft({ ...EMPTY_QUESTION, topic: draft.topic, kind: draft.kind });
  };

  const create = async () => {
    if (!questions.length) {
      setError('Add at least one question.');
      return;
    }
    setError('');
    setSaving(true);
    const payload = {
      ...formToPayload(form),
      questionCount: Math.min(Number(form.questionCount) || questions.length, questions.length),
      questions: questions.map(questionToPayload),
    };
    const result = await call((token) => createAdminExam(token, payload), 'Could not create the exam.');
    setSaving(false);
    if (result) {
      notify.info(`${result.exam?.title ?? 'Exam'} created with ${pluralize(result.questionsAdded ?? questions.length, 'question')}.`);
      onCreated();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New exam"
      subtitle={step === 1 ? 'Set up the exam, then add its questions.' : `${form.title} · ${pluralize(questions.length, 'question')} added`}
      footer={
        step === 1 ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="create-exam-form" className="btn btn-primary">
              Next: add questions
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={saving || !questions.length}>
              {saving ? 'Creating…' : `Create exam (${questions.length})`}
            </button>
          </>
        )
      }
    >
      <div className="steps" aria-hidden="true">
        <span className={step === 1 ? 'is-active' : ''}>
          <b>1</b> Details
        </span>
        <span className="sep" />
        <span className={step === 2 ? 'is-active' : ''}>
          <b>2</b> Questions
        </span>
      </div>
      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {step === 1 ? (
        <form id="create-exam-form" onSubmit={goToQuestions}>
          <ExamSettingsFields
            form={form}
            setForm={setForm}
            classOptions={classOptions}
            questionCountHint="Capped at the number of questions you add."
          />
        </form>
      ) : (
        <div className="stack stack-lg">
          {questions.length ? (
            <div className="stack" style={{ '--stack-gap': '0.5rem' }}>
              {questions.map((question, index) => (
                <div key={`${index}-${question.text}`} className="question-draft">
                  <span className="q-index" style={{ fontWeight: 700, color: 'var(--ink-600)' }}>
                    {index + 1}
                  </span>
                  <div>
                    <strong className="small">{question.text}</strong>
                    <span className="cell-sub">
                      {QUESTION_KINDS.find((kind) => kind.id === question.kind)?.label} · {question.topic}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon btn-danger-soft"
                    aria-label="Remove question"
                    onClick={() => setQuestions((previous) => previous.filter((_item, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Alert tone="info">Add questions one at a time. You can add more later from the question bank.</Alert>
          )}
          <div className="card" style={{ padding: '1rem', background: 'var(--surface-2)' }}>
            <QuestionForm value={draft} onChange={setDraft} topics={topics} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn btn-primary" onClick={addDraft}>
                <ListPlus aria-hidden="true" /> Add question
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ExamsPage() {
  const { call, notify, confirm, navigate } = useAdmin();
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminExams(token));
  const { data: questionData } = useAdminQuery((token) => fetchAdminQuestions(token));
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const exams = data?.exams ?? [];
  const topics = useMemo(
    () => [...new Set((questionData?.questions ?? []).map((question) => question.topic).filter(Boolean))].sort(),
    [questionData]
  );

  const togglePublished = async (exam, published) => {
    const result = await call((token) => updateAdminExam(token, exam.id, { published }), 'Could not update the exam.');
    if (result) {
      notify.info(`${exam.title} ${published ? 'published' : 'unpublished'}.`);
      reload();
    }
  };

  const remove = async (exam) => {
    const ok = await confirm({
      title: `Delete ${exam.title}?`,
      message: 'The exam and the questions written for it will be deleted. This can’t be undone.',
      confirmLabel: 'Delete exam',
      tone: 'danger',
    });
    if (!ok) return;
    const result = await call((token) => deleteAdminExam(token, exam.id), 'Could not delete the exam.');
    if (result) {
      notify.info(`${exam.title} deleted.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Exams"
        description="Control what students can take, for how long, and how strictly it’s supervised."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New exam
          </button>
        }
      />

      {!exams.length ? (
        <div className="card">
          <EmptyState icon={BookOpen} title={loading ? 'Loading exams…' : 'No exams yet'} />
        </div>
      ) : (
        <div className="grid-2">
          {exams.map((exam) => (
            <article key={exam.id} className="card exam-card">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="row" style={{ gap: '0.4rem', marginBottom: '0.4rem' }}>
                    {exam.published ? <span className="badge badge-success">Published</span> : <span className="badge">Draft</span>}
                    {exam.archived ? <span className="badge archive-badge" style={{ marginBottom: 0 }}>Archived</span> : null}
                    {exam.hintsAllowed > 0 && exam.hintClasses?.length ? (
                      <span className="badge badge-gold">
                        {exam.hintsAllowed} hints · {exam.hintClasses.length} classes
                      </span>
                    ) : null}
                    {!exam.isReady ? (
                      <span className="badge badge-warning">
                        <AlertTriangle aria-hidden="true" /> Needs questions
                      </span>
                    ) : null}
                  </div>
                  <h3>{exam.title}</h3>
                  {exam.description ? <p className="description clamp-2">{exam.description}</p> : null}
                </div>
                <Switch
                  id={`publish-${exam.id}`}
                  checked={exam.published}
                  onChange={(value) => void togglePublished(exam, value)}
                  label={<span className="sr-only">Published</span>}
                />
              </div>

              <div className="exam-facts" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                <div>
                  <span>
                    <FileQuestion aria-hidden="true" /> Questions
                  </span>
                  <strong title={`${exam.questionCount} per attempt, ${exam.availableQuestionCount} available`}>
                    {exam.questionCount}
                    <span className="of"> / {exam.availableQuestionCount}</span>
                  </strong>
                </div>
                <div>
                  <span>
                    <Clock aria-hidden="true" /> Time
                  </span>
                  <strong>{formatDuration(exam.durationSeconds)}</strong>
                </div>
                <div>
                  <span>
                    <Repeat aria-hidden="true" /> Attempts
                  </span>
                  <strong>{exam.maxAttempts}</strong>
                </div>
                <div>
                  <span>
                    <UsersRound aria-hidden="true" /> Classes
                  </span>
                  <strong>{exam.allowedClasses?.length ?? 0}</strong>
                </div>
              </div>

              {!exam.isReady ? (
                <p className="small" style={{ color: 'var(--warning-700)' }}>
                  Students can’t start this exam: it serves {exam.questionCount} questions but only {exam.availableQuestionCount}{' '}
                  exist. Add questions or lower the number per attempt.
                </p>
              ) : null}

              <div className="card-actions">
                <span className="hint">
                  {formatNumber(exam.sessionCount ?? 0)} attempt{exam.sessionCount === 1 ? '' : 's'} so far
                </span>
                <div className="row" style={{ gap: '0.4rem' }}>
                  <button type="button" className="btn btn-sm" onClick={() => navigate('questions', { examId: exam.id })}>
                    <FileQuestion aria-hidden="true" /> Questions
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(exam)}>
                    <Pencil aria-hidden="true" /> Edit
                  </button>
                  {!exam.isDefault ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-icon btn-danger-soft"
                      onClick={() => void remove(exam)}
                      disabled={(exam.sessionCount ?? 0) > 0}
                      aria-label="Delete exam"
                      title={(exam.sessionCount ?? 0) > 0 ? 'Exams with attempts can’t be deleted. Unpublish instead.' : 'Delete exam'}
                    >
                      <Trash2 />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? <EditExamModal exam={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
      {creating ? <CreateExamModal onClose={() => setCreating(false)} onCreated={reload} topics={topics} /> : null}
    </>
  );
}
