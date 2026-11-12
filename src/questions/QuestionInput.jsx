import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, GripVertical } from 'lucide-react';

import { checkProgram } from '../lib/python';
import { Flowchart } from './Flowchart';
import { CodeEditor, CodeSnippet } from './PythonRunner';

function ChoiceInput({ question, response, onChange, disabled }) {
  const selected = Array.isArray(response) ? response : [];
  const isMulti = question.type === 'multi';
  const plain = question.format === 'true_false' || question.format === 'yes_no';

  const pick = (optionId) => {
    if (!isMulti) {
      onChange([optionId]);
      return;
    }
    onChange(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]);
  };

  return (
    <div className={`options ${plain ? 'options-pair' : ''}`} role={isMulti ? 'group' : 'radiogroup'} aria-label="Answers">
      {(question.options ?? []).map((option) => {
        const chosen = selected.includes(option.id);
        return (
          <label key={option.id} className={`option ${chosen ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}>
            <input
              type={isMulti ? 'checkbox' : 'radio'}
              name={question.id}
              checked={chosen}
              disabled={disabled}
              onChange={() => pick(option.id)}
            />
            <span className="option-letter" aria-hidden="true">
              {plain ? option.text[0] : option.id}
            </span>
            <span className="option-text">{option.text}</span>
            <CheckCircle2 className="option-check" aria-hidden="true" />
          </label>
        );
      })}
    </div>
  );
}

function OrderInput({ question, response, onChange, disabled }) {
  const items = question.items ?? [];
  const answered = Array.isArray(response) && response.length === items.length;
  const order = answered ? response : items.map((item) => item.id);
  const textById = new Map(items.map((item) => [item.id, item.text]));
  const [dragIndex, setDragIndex] = useState(null);

  const move = (from, to) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="stack" style={{ '--stack-gap': '0.6rem' }}>
      <ol className="order-list">
        {order.map((id, index) => (
          <li
            key={id}
            className={`order-item ${dragIndex === index ? 'is-dragging' : ''}`}
            draggable={!disabled}
            onDragStart={(event) => {
              setDragIndex(index);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null) move(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <GripVertical className="order-grip" aria-hidden="true" />
            <span className="order-number">{index + 1}</span>
            <span className="order-text">{textById.get(id)}</span>
            <span className="order-buttons">
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => move(index, index - 1)}
                disabled={disabled || index === 0}
                aria-label={`Move step ${index + 1} up`}
              >
                <ArrowUp />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => move(index, index + 1)}
                disabled={disabled || index === order.length - 1}
                aria-label={`Move step ${index + 1} down`}
              >
                <ArrowDown />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {!answered ? (
        <div className="row-between">
          <span className="hint">Drag the steps, or use the arrows, until they are in the right order.</span>
          <button type="button" className="btn btn-sm" onClick={() => onChange(order)} disabled={disabled}>
            This order is correct
          </button>
        </div>
      ) : (
        <span className="hint">
          <CheckCircle2 size={14} style={{ display: 'inline', verticalAlign: '-2px' }} aria-hidden="true" /> Order saved. You can
          still change it.
        </span>
      )}
    </div>
  );
}

function FlowchartInput({ question, response, onChange, disabled }) {
  const pool = question.pool ?? [];
  const selected = Array.isArray(response) ? response : [];

  const setSlot = (slot, poolId) => {
    const total = Math.max(selected.length, slot + 1);
    const next = Array.from({ length: total }, (_unused, index) => selected[index] ?? null);
    next[slot] = poolId || null;
    onChange(next);
  };

  return (
    <div className="stack">
      <div className="fc-pool">
        <span className="hint">Steps to place:</span>
        {pool.map((item) => (
          <span key={item.id} className={`badge ${selected.includes(item.id) ? 'badge-brand' : ''}`}>
            {item.text}
          </span>
        ))}
      </div>
      <Flowchart
        nodes={question.flowchart?.nodes ?? []}
        renderBlank={(node) => (
          <select
            className="select select-sm fc-select"
            aria-label={`Step for empty shape ${node.slot + 1}`}
            value={selected[node.slot] ?? ''}
            disabled={disabled}
            onChange={(event) => setSlot(node.slot, event.target.value)}
          >
            <option value="">Choose a step…</option>
            {pool.map((item) => (
              <option key={item.id} value={item.id}>
                {item.text}
              </option>
            ))}
          </select>
        )}
      />
    </div>
  );
}

function CodeInput({ question, response, onChange, disabled, onBlockedPaste }) {
  const starter = question.starterCode ?? '';
  const code = typeof response?.code === 'string' ? response.code : starter;
  const tests = question.tests ?? [];
  // `checkedCode` is the program text the saved checks belong to.
  const latest = useRef({ code, checkedCode: response?.checks ? code : null });
  const onChangeRef = useRef(onChange);
  const timer = useRef(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const runChecks = useRef(async (codeToCheck) => {
    if (!tests.length) return;
    const checks = await checkProgram(codeToCheck, tests);
    // Only keep the result if the student has not typed since.
    if (checks && latest.current.code === codeToCheck) {
      latest.current.checkedCode = codeToCheck;
      onChangeRef.current({ code: codeToCheck, checks });
    }
  });

  useEffect(
    () => () => {
      // Leaving the question: check the final version of the program if it has not been yet.
      clearTimeout(timer.current);
      const { code: finalCode, checkedCode } = latest.current;
      if (finalCode.trim() && finalCode !== starter && checkedCode !== finalCode) {
        void runChecks.current(finalCode);
      }
    },
    [starter]
  );

  const handleChange = (next) => {
    latest.current = { code: next, checkedCode: null };
    onChange({ code: next, checks: null });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void runChecks.current(next), 1500);
  };

  return (
    <CodeEditor
      value={code}
      onChange={handleChange}
      sampleInput={question.codeSampleInput ?? ''}
      disabled={disabled}
      onBlockedPaste={onBlockedPaste}
    />
  );
}

/** Answer area for any question type. `response` and `onChange` use the server's answer format. */
export function QuestionInput({ question, response, onChange, disabled = false, onBlockedPaste }) {
  if (!question) return null;
  const hasSnippet = Boolean(question.code) && question.type !== 'code';

  return (
    <div className="stack">
      {hasSnippet ? (
        <CodeSnippet code={question.code} language={question.codeLanguage} sampleInput={question.codeSampleInput} />
      ) : null}
      {question.type === 'order' ? (
        <OrderInput question={question} response={response} onChange={onChange} disabled={disabled} />
      ) : question.type === 'flowchart' ? (
        <FlowchartInput question={question} response={response} onChange={onChange} disabled={disabled} />
      ) : question.type === 'code' ? (
        <CodeInput key={question.id} question={question} response={response} onChange={onChange} disabled={disabled} onBlockedPaste={onBlockedPaste} />
      ) : (
        <ChoiceInput question={question} response={response} onChange={onChange} disabled={disabled} />
      )}
    </div>
  );
}
