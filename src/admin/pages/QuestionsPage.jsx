import { useMemo, useState } from 'react';
import { FileQuestion, Pencil, Plus, Trash2 } from 'lucide-react';

import { createAdminQuestion, deleteAdminQuestion, fetchAdminExams, fetchAdminQuestions, updateAdminQuestion } from '../../api';
import { Alert, EmptyState, Field, Modal, Pagination } from '../../components/ui';
import { useDebouncedValue, usePagination } from '../../lib/hooks';
import { useAdmin, useAdminQuery } from '../context';
import { ExamFilter, FilterSelect, PageHeader, SearchInput } from '../parts';
import { QuestionForm } from '../QuestionForm';
import { EMPTY_QUESTION, formToPayload, questionToForm, validateQuestionForm } from '../questionUtils';

function QuestionModal({ question, exams, defaultExamId, topics, onClose, onSaved }) {
  const { call, notify } = useAdmin();
  const isEdit = Boolean(question);
  const [form, setForm] = useState(() => (question ? questionToForm(question) : EMPTY_QUESTION));
  const [examId, setExamId] = useState(question?.sourceExamId ?? defaultExamId ?? 'general');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const problem = validateQuestionForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    const payload = formToPayload(form);
    const result = await call(
      (token) =>
        isEdit ? updateAdminQuestion(token, question.id, payload) : createAdminQuestion(token, { ...payload, sourceExamId: examId }),
      'Could not save the question.'
    );
    setSaving(false);
    if (result) {
      notify.info(isEdit ? `Question ${question.id} updated.` : `Question ${result.question?.id ?? ''} added.`);
      onSaved();
      if (isEdit) {
        onClose();
      } else {
        setForm({ ...EMPTY_QUESTION, topic: form.topic, kind: form.kind });
      }
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit question ${question.id}` : 'Add a question'}
      subtitle={isEdit ? 'Attempts already taken keep the original wording.' : 'The form stays open so you can add several in a row.'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {isEdit ? 'Cancel' : 'Done'}
          </button>
          <button type="submit" form="question-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save question' : 'Add question'}
          </button>
        </>
      }
    >
      <form id="question-form" onSubmit={submit} className="stack">
        {!isEdit ? (
          <Field label="Exam" htmlFor="question-exam" hint="The main pool feeds the general exam. Custom exams use their own questions.">
            <select id="question-exam" className="select" value={examId} onChange={(event) => setExamId(event.target.value)}>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <QuestionForm value={form} onChange={setForm} topics={topics} />
      </form>
    </Modal>
  );
}

export default function QuestionsPage() {
  const { call, notify, confirm, pageParams } = useAdmin();
  const [search, setSearch] = useState('');
  const [examId, setExamId] = useState(pageParams.examId ?? '');
  const [topic, setTopic] = useState('');
  const [type, setType] = useState('');
  const [modal, setModal] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 200);
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminQuestions(token));
  const { data: examData, reload: reloadExams } = useAdminQuery((token) => fetchAdminExams(token));
  const exams = useMemo(() => examData?.exams ?? [], [examData]);
  const examTitles = useMemo(() => new Map(exams.map((exam) => [exam.id, exam.title])), [exams]);
  const allQuestions = useMemo(() => data?.questions ?? [], [data]);
  const topics = useMemo(() => [...new Set(allQuestions.map((question) => question.topic).filter(Boolean))].sort(), [allQuestions]);
  const typeLabels = useMemo(() => [...new Set(allQuestions.map((question) => question.typeLabel).filter(Boolean))].sort(), [allQuestions]);

  const questions = useMemo(
    () =>
      allQuestions.filter((question) => {
        if (examId && (question.sourceExamId ?? 'general') !== examId) return false;
        if (topic && question.topic !== topic) return false;
        if (type && question.typeLabel !== type) return false;
        if (debouncedSearch) {
          const haystack = `${question.id} ${question.text} ${(question.options ?? []).map((option) => option.text).join(' ')}`.toLowerCase();
          if (!haystack.includes(debouncedSearch)) return false;
        }
        return true;
      }),
    [allQuestions, debouncedSearch, examId, topic, type]
  );
  const pager = usePagination(questions, 25, `${examId}|${topic}|${type}|${debouncedSearch}`);

  const remove = async (question) => {
    const ok = await confirm({
      title: `Delete question ${question.id}?`,
      message: 'It will no longer be served in new attempts. Past attempts keep their copy.',
      confirmLabel: 'Delete question',
      tone: 'danger',
    });
    if (!ok) return;
    const result = await call((token) => deleteAdminQuestion(token, question.id), 'Could not delete the question.');
    if (result) {
      notify.info(`Question ${question.id} deleted.`);
      reload();
      reloadExams();
    }
  };

  return (
    <>
      <PageHeader
        title="Question bank"
        description={`${allQuestions.length} questions across ${exams.length} exam${exams.length === 1 ? '' : 's'}.`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModal({ question: null })}>
            <Plus aria-hidden="true" /> Add question
          </button>
        }
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search question text or ID" />
        <ExamFilter value={examId} onChange={setExamId} exams={exams} />
        <FilterSelect value={topic} onChange={setTopic} label="Topic">
          <option value="">All topics</option>
          {topics.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={type} onChange={setType} label="Question type">
          <option value="">Any type</option>
          {typeLabels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="card card-flush">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className={`table ${loading ? 'is-loading' : ''}`}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>ID</th>
                <th>Question</th>
                <th>Exam</th>
                <th>Type</th>
                <th>Topic</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((question) => (
                <tr key={question.id}>
                  <td className="mono muted">{question.id}</td>
                  <td style={{ maxWidth: 420 }}>
                    <span className="clamp-2" title={question.text}>
                      {question.text}
                    </span>
                  </td>
                  <td className="small">{examTitles.get(question.sourceExamId ?? 'general') ?? question.sourceExamId}</td>
                  <td className="small">
                    {question.typeLabel}
                    {question.answerKey ? <span className="cell-sub">Answer: {question.answerKey}</span> : null}
                  </td>
                  <td>
                    <span className="badge">{question.topic}</span>
                    {!question.explanation ? <span className="cell-sub">No explanation</span> : null}
                  </td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <button type="button" className="btn btn-sm btn-icon" onClick={() => setModal({ question })} aria-label="Edit question" title="Edit">
                        <Pencil />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-danger-soft"
                        onClick={() => void remove(question)}
                        aria-label="Delete question"
                        title="Delete"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!questions.length ? (
                <tr>
                  <td colSpan={6} className="table-empty">
                    <EmptyState icon={FileQuestion} title={loading ? 'Loading questions…' : 'No questions match'} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination pager={pager} label="questions" />

      {modal ? (
        <QuestionModal
          question={modal.question}
          exams={exams}
          defaultExamId={examId || 'general'}
          topics={topics}
          onClose={() => setModal(null)}
          onSaved={() => {
            reload();
            reloadExams();
          }}
        />
      ) : null}
    </>
  );
}
