import { useId } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react';

import { Field } from '../components/ui';
import { Flowchart } from '../questions/Flowchart';
import { FLOW_SHAPES, OPTION_LETTERS, QUESTION_KINDS } from './questionUtils';

function OptionsEditor({ value, set }) {
  const multi = value.kind === 'multi';
  const toggle = (letter) => {
    if (!multi) {
      set({ correctOptionIds: [letter] });
      return;
    }
    const next = new Set(value.correctOptionIds);
    if (next.has(letter)) next.delete(letter);
    else next.add(letter);
    set({ correctOptionIds: OPTION_LETTERS.filter((item) => next.has(item)) });
  };

  return (
    <div className="field">
      <span className="label">Options</span>
      <span className="hint">Click a letter to mark the correct answer{multi ? 's' : ''}. Students see the options in a random order.</span>
      <div className="stack" style={{ '--stack-gap': '0.5rem', marginTop: '0.3rem' }}>
        {value.optionTexts.map((text, index) => {
          const letter = OPTION_LETTERS[index];
          const correct = value.correctOptionIds.includes(letter);
          return (
            <div key={letter} className="option-editor" style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}>
              <button
                type="button"
                className="correct-toggle"
                aria-pressed={correct}
                aria-label={`Option ${letter} is ${correct ? 'correct' : 'not correct'}`}
                onClick={() => toggle(letter)}
              >
                {correct ? <Check size={18} aria-hidden="true" /> : letter}
              </button>
              <input
                className="input"
                aria-label={`Option ${letter}`}
                placeholder={`Option ${letter}`}
                value={text}
                onChange={(event) => {
                  const optionTexts = [...value.optionTexts];
                  optionTexts[index] = event.target.value;
                  set({ optionTexts });
                }}
              />
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                aria-label={`Remove option ${letter}`}
                disabled={value.optionTexts.length <= 2}
                onClick={() =>
                  set({
                    optionTexts: value.optionTexts.filter((_item, itemIndex) => itemIndex !== index),
                    correctOptionIds: value.correctOptionIds
                      .map((id) => OPTION_LETTERS.indexOf(id))
                      .filter((position) => position !== index)
                      .map((position) => OPTION_LETTERS[position > index ? position - 1 : position]),
                  })
                }
              >
                <Trash2 />
              </button>
            </div>
          );
        })}
        {value.optionTexts.length < 6 ? (
          <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => set({ optionTexts: [...value.optionTexts, ''] })}>
            <Plus aria-hidden="true" /> Add option
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PairEditor({ value, set }) {
  const labels = value.kind === 'true_false' ? ['True', 'False'] : ['Yes', 'No'];
  const current = value.correctOptionIds[0] === 'B' ? 'B' : 'A';
  return (
    <div className="field">
      <span className="label">Correct answer</span>
      <div className="segmented" style={{ justifySelf: 'start' }}>
        {labels.map((label, index) => (
          <button key={label} type="button" aria-pressed={current === OPTION_LETTERS[index]} onClick={() => set({ correctOptionIds: [OPTION_LETTERS[index]] })}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListEditor({ label, hint, items, onChange, placeholder, min = 0, max = 10, ordered = false }) {
  const move = (from, to) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return (
    <div className="field">
      <span className="label">{label}</span>
      {hint ? <span className="hint">{hint}</span> : null}
      <div className="stack" style={{ '--stack-gap': '0.4rem', marginTop: '0.3rem' }}>
        {items.map((text, index) => (
          <div key={index} className="row" style={{ flexWrap: 'nowrap', gap: '0.4rem' }}>
            {ordered ? <span className="order-number">{index + 1}</span> : null}
            <input
              className="input grow"
              placeholder={placeholder}
              aria-label={`${label} ${index + 1}`}
              value={text}
              onChange={(event) => onChange(items.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
            />
            {ordered ? (
              <>
                <button type="button" className="btn btn-icon btn-ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
                  <ArrowUp />
                </button>
                <button type="button" className="btn btn-icon btn-ghost" aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>
                  <ArrowDown />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              aria-label="Remove"
              disabled={items.length <= min}
              onClick={() => onChange(items.filter((_item, itemIndex) => itemIndex !== index))}
            >
              <Trash2 />
            </button>
          </div>
        ))}
        {items.length < max ? (
          <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ''])}>
            <Plus aria-hidden="true" /> Add
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NodeRows({ nodes, onChange, allowDecision }) {
  const update = (index, patch) => onChange(nodes.map((node, nodeIndex) => (nodeIndex === index ? { ...node, ...patch } : node)));
  const move = (from, to) => {
    if (to < 0 || to >= nodes.length) return;
    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="stack" style={{ '--stack-gap': '0.45rem' }}>
      {nodes.map((node, index) => (
        <div key={index} className="node-row">
          <div className="row" style={{ flexWrap: 'nowrap', gap: '0.4rem' }}>
            <select
              className="select select-sm"
              style={{ width: 140, flex: 'none' }}
              aria-label="Shape"
              value={node.shape}
              onChange={(event) => {
                const shape = event.target.value;
                update(index, shape === 'decision' ? { shape, yes: node.yes ?? [], no: node.no ?? [] } : { shape, yes: undefined, no: undefined });
              }}
            >
              {FLOW_SHAPES.filter((shape) => allowDecision || shape.id !== 'decision').map((shape) => (
                <option key={shape.id} value={shape.id}>
                  {shape.label}
                </option>
              ))}
            </select>
            <input
              className="input input-sm grow"
              placeholder={node.blank ? 'Correct answer for this blank' : 'Text shown in the shape'}
              aria-label="Shape text"
              value={node.text}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <label className="check small" title="Students must fill this shape">
              <input type="checkbox" checked={node.blank} onChange={(event) => update(index, { blank: event.target.checked })} />
              Blank
            </label>
            <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
              <ArrowUp />
            </button>
            <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label="Move down" disabled={index === nodes.length - 1} onClick={() => move(index, index + 1)}>
              <ArrowDown />
            </button>
            <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label="Remove shape" onClick={() => onChange(nodes.filter((_node, nodeIndex) => nodeIndex !== index))}>
              <Trash2 />
            </button>
          </div>
          {node.shape === 'decision' ? (
            <div className="node-branches">
              {['yes', 'no'].map((branch) => (
                <div key={branch}>
                  <span className="review-label">If {branch}</span>
                  <NodeRows nodes={node[branch] ?? []} onChange={(next) => update(index, { [branch]: next })} allowDecision={false} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        style={{ justifySelf: 'start' }}
        onClick={() => onChange([...nodes, { shape: 'process', text: '', blank: false }])}
      >
        <Plus aria-hidden="true" /> Add shape
      </button>
    </div>
  );
}

function withSlots(nodes, counter = { slot: 0 }) {
  return nodes.map((node) => {
    const next = { ...node };
    if (node.blank) {
      next.slot = counter.slot;
      counter.slot += 1;
    }
    if (node.shape === 'decision') {
      next.yes = withSlots(node.yes ?? [], counter);
      next.no = withSlots(node.no ?? [], counter);
    }
    return next;
  });
}

function FlowchartEditor({ value, set }) {
  return (
    <div className="stack">
      <div className="field">
        <span className="label">Shapes, from top to bottom</span>
        <span className="hint">
          Tick “Blank” for shapes students must fill and type the correct step there. A decision splits into a Yes and a No branch
          that join again.
        </span>
        <NodeRows nodes={value.nodes} onChange={(nodes) => set({ nodes })} allowDecision />
      </div>
      <ListEditor
        label="Extra wrong steps"
        hint="Optional. These appear in the list of steps to choose from but fit nowhere."
        items={value.distractors}
        onChange={(distractors) => set({ distractors })}
        placeholder="A step that does not belong"
        max={5}
      />
      <div className="field">
        <span className="label">Preview (answers shown)</span>
        <Flowchart nodes={withSlots(value.nodes)} renderBlank={(node) => <span>{node.text || '(blank)'}</span>} />
      </div>
    </div>
  );
}

function CodeQuestionEditor({ value, set }) {
  const updateTest = (index, patch) => set({ tests: value.tests.map((test, testIndex) => (testIndex === index ? { ...test, ...patch } : test)) });
  return (
    <div className="stack">
      <Field label="Starting code" optional hint="What students see in the editor when they open the question.">
        <textarea className="textarea mono" rows={4} spellCheck={false} value={value.starterCode} onChange={(event) => set({ starterCode: event.target.value })} />
      </Field>
      <Field label="Example input for the Run button" optional hint="One answer per line, pre-filled in the student’s input box.">
        <textarea className="textarea mono" rows={2} spellCheck={false} value={value.codeSampleInput} onChange={(event) => set({ codeSampleInput: event.target.value })} />
      </Field>
      <div className="field">
        <span className="label">Automatic checks</span>
        <span className="hint">
          Each check runs the student’s program with the input you give and compares what it prints. The program is correct when every
          check passes. You can still overrule the mark when reviewing an attempt.
        </span>
        <div className="stack" style={{ '--stack-gap': '0.5rem', marginTop: '0.3rem' }}>
          {value.tests.map((test, index) => (
            <div key={index} className="test-row">
              <textarea
                className="textarea mono"
                rows={2}
                spellCheck={false}
                placeholder="Input (one per line)"
                aria-label={`Check ${index + 1} input`}
                value={test.input}
                onChange={(event) => updateTest(index, { input: event.target.value })}
              />
              <input
                className="input mono"
                placeholder="Expected output"
                aria-label={`Check ${index + 1} expected output`}
                value={test.expected}
                onChange={(event) => updateTest(index, { expected: event.target.value })}
              />
              <select className="select" aria-label="How to compare" value={test.match} onChange={(event) => updateTest(index, { match: event.target.value })}>
                <option value="number">Prints this number</option>
                <option value="contains">Output contains this text</option>
                <option value="exact">Output is exactly this</option>
              </select>
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                aria-label="Remove check"
                disabled={value.tests.length <= 1}
                onClick={() => set({ tests: value.tests.filter((_test, testIndex) => testIndex !== index) })}
              >
                <Trash2 />
              </button>
            </div>
          ))}
          {value.tests.length < 6 ? (
            <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => set({ tests: [...value.tests, { input: '', expected: '', match: 'contains' }] })}>
              <Plus aria-hidden="true" /> Add check
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Editor for every question type. `value` is the form model from questionUtils. */
export function QuestionForm({ value, onChange, topics = [] }) {
  const id = useId();
  const set = (patch) => onChange({ ...value, ...patch });
  const isChoice = ['choice', 'multi', 'true_false', 'yes_no'].includes(value.kind);

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Question type" htmlFor={`${id}-kind`}>
          <select
            id={`${id}-kind`}
            className="select"
            value={value.kind}
            onChange={(event) => {
              const kind = event.target.value;
              set({ kind, correctOptionIds: kind === 'multi' ? value.correctOptionIds : value.correctOptionIds.slice(0, 1) });
            }}
          >
            {QUESTION_KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topic" htmlFor={`${id}-topic`} hint="Groups questions in the bank.">
          <input id={`${id}-topic`} className="input" list={`${id}-topics`} value={value.topic} onChange={(event) => set({ topic: event.target.value })} />
          <datalist id={`${id}-topics`}>
            {topics.map((topic) => (
              <option key={topic} value={topic} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Question" htmlFor={`${id}-text`}>
        <textarea id={`${id}-text`} className="textarea" rows={3} value={value.text} onChange={(event) => set({ text: event.target.value })} />
      </Field>

      {isChoice ? (
        <Field
          label="Code shown with the question"
          optional
          hint="Python code gets a Run button so students can see what it does. Leave empty for ordinary questions."
        >
          <textarea className="textarea mono" rows={3} spellCheck={false} value={value.code} onChange={(event) => set({ code: event.target.value })} />
          {value.code.trim() ? (
            <div className="form-grid" style={{ marginTop: '0.5rem' }}>
              <select className="select" aria-label="Code language" value={value.codeLanguage} onChange={(event) => set({ codeLanguage: event.target.value })}>
                <option value="python">Python (students can run it)</option>
                <option value="text">Pseudocode or plain text (display only)</option>
              </select>
              <input
                className="input mono"
                placeholder="Example input for Run, e.g. 4 then 3 on separate lines"
                aria-label="Example input"
                value={value.codeSampleInput.replace(/\n/g, ' | ')}
                onChange={(event) => set({ codeSampleInput: event.target.value.replace(/\s*\|\s*/g, '\n') })}
              />
            </div>
          ) : null}
        </Field>
      ) : null}

      {value.kind === 'choice' || value.kind === 'multi' ? <OptionsEditor value={value} set={set} /> : null}
      {value.kind === 'true_false' || value.kind === 'yes_no' ? <PairEditor value={value} set={set} /> : null}
      {value.kind === 'order' ? (
        <ListEditor
          label="Steps, in the correct order"
          hint="Students see these shuffled and must put them back in this order."
          items={value.items}
          onChange={(items) => set({ items })}
          placeholder="A step"
          min={2}
          ordered
        />
      ) : null}
      {value.kind === 'flowchart' ? <FlowchartEditor value={value} set={set} /> : null}
      {value.kind === 'code' ? <CodeQuestionEditor value={value} set={set} /> : null}

      <Field label="Explanation" optional hint="Shown with the corrections after results are released, and printed on report cards.">
        <textarea className="textarea" rows={3} value={value.explanation} onChange={(event) => set({ explanation: event.target.value })} />
      </Field>
      <Field label="Hint" optional hint="Only shown when a student spends a hint, and only in exams that give their class hints.">
        <textarea className="textarea" rows={2} value={value.hint} onChange={(event) => set({ hint: event.target.value })} />
      </Field>
    </div>
  );
}
