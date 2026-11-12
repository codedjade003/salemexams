import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

import { runPython } from '../lib/python';

// Text copied inside the exam's own code editor. Pasting is only allowed for this text, so
// students can move their own code around but cannot paste an answer from somewhere else.
let lastEditorCopy = '';

function Lines({ code }) {
  const lines = String(code ?? '').split('\n');
  return (
    <pre className="code-view">
      {lines.map((line, index) => (
        <span key={index} className="code-line">
          <span className="ln" aria-hidden="true">
            {index + 1}
          </span>
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function RunPanel({ getCode, sampleInput, needsInput }) {
  const [stdin, setStdin] = useState(sampleInput ?? '');
  const [state, setState] = useState({ status: 'idle', result: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = async () => {
    setState({ status: 'running', result: null });
    const result = await runPython(getCode(), stdin);
    if (alive.current) setState({ status: 'done', result });
  };

  const result = state.result;
  return (
    <div className="run-panel">
      <div className="run-controls">
        {needsInput ? (
          <label className="run-input">
            <span>What the user types (one answer per line)</span>
            <textarea
              className="textarea mono"
              rows={2}
              value={stdin}
              spellCheck={false}
              data-allow-clipboard
              onChange={(event) => setStdin(event.target.value)}
            />
          </label>
        ) : null}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void run()} disabled={state.status === 'running'}>
          <Play aria-hidden="true" />
          {state.status === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>
      {state.status === 'running' ? (
        <p className="hint">Starting Python… the first run can take a few seconds.</p>
      ) : null}
      {result ? (
        <div className="run-output" aria-live="polite">
          <span className="run-output-label">Output</span>
          <pre>{result.display || (result.ok ? '(your program printed nothing)' : '')}</pre>
          {result.error ? (
            <p className="run-error">
              {result.error.line ? <strong>Line {result.error.line}: </strong> : null}
              {result.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A read-only code listing. Python snippets get a Run button so students can see what happens. */
export function CodeSnippet({ code, language = 'python', sampleInput = '', runnable = true }) {
  if (!code) return null;
  const canRun = runnable && language === 'python';
  return (
    <div className="code-block">
      <Lines code={code} />
      {canRun ? <RunPanel getCode={() => code} sampleInput={sampleInput} needsInput={/\binput\s*\(/.test(code)} /> : null}
    </div>
  );
}

/** Editable Python with line numbers, Tab indentation and a Run panel. */
export function CodeEditor({ value, onChange, sampleInput = '', disabled = false, onBlockedPaste }) {
  const gutterRef = useRef(null);
  const valueRef = useRef(value);
  const lineCount = Math.max(8, String(value ?? '').split('\n').length + 1);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const target = event.target;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => target.setSelectionRange(selectionStart + 4, selectionStart + 4));
  };

  const rememberCopy = (event) => {
    const target = event.target;
    lastEditorCopy = target.value.slice(target.selectionStart, target.selectionEnd);
  };

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    if (text && text !== lastEditorCopy) {
      event.preventDefault();
      onBlockedPaste?.();
    }
  };

  return (
    <div className="code-block">
      <div className="code-editor">
        <div className="code-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_unused, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <textarea
          className="code-input"
          value={value}
          rows={lineCount}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Your Python program"
          data-allow-clipboard
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCopy={rememberCopy}
          onCut={rememberCopy}
          onPaste={handlePaste}
          onScroll={(event) => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.target.scrollTop;
          }}
        />
      </div>
      <RunPanel getCode={() => valueRef.current} sampleInput={sampleInput} needsInput />
    </div>
  );
}
