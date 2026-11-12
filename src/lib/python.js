// Page-side controller for the Python worker: start it early, run code with a time limit, and
// check a program against a question's tests.
import { version as pyodideVersion } from 'pyodide/package.json';

const BASE_URL = `${window.location.origin}/pyodide/${pyodideVersion}/`;
const LOAD_TIMEOUT_MS = 90_000; // first download on a slow connection
const RUN_TIMEOUT_MS = 6_000;

let worker = null;
let sequence = 0;
const waiting = new Map();

function resetWorker(reason) {
  worker?.terminate();
  worker = null;
  for (const entry of waiting.values()) {
    clearTimeout(entry.timer);
    entry.resolve(entry.onReset(reason));
  }
  waiting.clear();
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./pythonWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = waiting.get(data.id);
      if (!entry) return;
      if (data.type === 'started') {
        // The runtime is loaded; from here the program itself gets a short time limit.
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => resetWorker('timeout'), RUN_TIMEOUT_MS);
        return;
      }
      clearTimeout(entry.timer);
      waiting.delete(data.id);
      entry.resolve(data);
    };
    worker.onerror = () => resetWorker('crash');
  }
  return worker;
}

// One program at a time: the runtime has a single stdin/stdout, so runs must not overlap.
let queue = Promise.resolve();

function send(message, onReset) {
  const turn = queue.then(
    () =>
      new Promise((resolve) => {
        sequence += 1;
        const id = sequence;
        const timer = setTimeout(() => resetWorker('load-timeout'), LOAD_TIMEOUT_MS);
        waiting.set(id, { resolve, timer, onReset });
        getWorker().postMessage({ ...message, id, baseUrl: BASE_URL });
      })
  );
  queue = turn.catch(() => undefined);
  return turn;
}

/** Starts downloading and booting Python in the background. Resolves true when it is ready. */
export async function preloadPython() {
  const reply = await send({ type: 'init' }, () => ({ type: 'failed' }));
  return reply.type === 'ready';
}

/**
 * Runs a program. Resolves to { ok, display, stdout, error: { message, line } | null }.
 * Never rejects: problems (no connection, endless loop) come back as an error message.
 */
export async function runPython(code, stdin = '') {
  const reply = await send({ type: 'run', code, stdin }, (reason) => ({
    type: 'result',
    result: {
      ok: false,
      display: '',
      stdout: '',
      error: {
        message:
          reason === 'timeout'
            ? 'Your program ran for too long and was stopped. Check for a loop that never ends.'
            : 'Python could not start. Check your internet connection and press Run again.',
        line: null,
      },
      unavailable: reason !== 'timeout',
    },
  }));
  if (reply.type === 'failed') {
    return {
      ok: false,
      display: '',
      stdout: '',
      error: { message: 'Python could not start. Check your internet connection and press Run again.', line: null },
      unavailable: true,
    };
  }
  return reply.result;
}

/** Does `stdout` satisfy one test? Mirrors the three match modes in the question editor. */
export function outputMatches(stdout, test) {
  const output = String(stdout ?? '').trim();
  const expected = String(test.expected ?? '').trim();
  if (test.match === 'exact') return output === expected;
  if (test.match === 'number') {
    const target = Number(expected);
    const numbers = output.match(/-?\d+(?:\.\d+)?/g) ?? [];
    return Number.isFinite(target) && numbers.some((value) => Math.abs(Number(value) - target) < 1e-9);
  }
  return output.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Runs every test. Resolves to { passed, total } or null if Python was unavailable (the answer
 * is then saved unchecked and the teacher marks it).
 */
export async function checkProgram(code, tests) {
  let passed = 0;
  for (const test of tests) {
    const result = await runPython(code, test.input ?? '');
    if (result.unavailable) return null;
    if (result.ok && outputMatches(result.stdout, test)) passed += 1;
  }
  return { passed, total: tests.length };
}
