// Runs student Python in a Web Worker using Pyodide (CPython compiled to WebAssembly), so a
// slow or endless program never freezes the exam page; the page can simply terminate the worker.

let pyodidePromise = null;

function loadRuntime(baseUrl) {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const { loadPyodide } = await import(/* @vite-ignore */ `${baseUrl}pyodide.mjs`);
      return loadPyodide({ indexURL: baseUrl });
    })();
    pyodidePromise.catch(() => {
      pyodidePromise = null;
    });
  }
  return pyodidePromise;
}

/** Turns a Python traceback into { message, line } a student can act on. */
function describeError(error) {
  const text = String(error?.message ?? error ?? '').trim();
  const lines = text.split('\n').filter(Boolean);
  const message = lines.at(-1) ?? 'Something went wrong.';
  let line = null;
  for (const entry of lines) {
    const match = /File "<exec>", line (\d+)/.exec(entry);
    if (match) line = Number(match[1]);
  }
  return { message, line };
}

async function run(pyodide, code, stdin) {
  const decoder = new TextDecoder();
  const inputs = String(stdin ?? '').split(/\r?\n/);
  // A trailing newline in the input box should not count as an extra empty answer.
  while (inputs.length && inputs.at(-1) === '') inputs.pop();
  let display = ''; // what a terminal would show: prompts, typed input, output
  let stdout = ''; // program output only (used for marking)

  const writer = (target) => ({
    write(buffer) {
      const text = decoder.decode(buffer, { stream: true });
      display += text;
      if (target === 'stdout') stdout += text;
      return buffer.length;
    },
  });
  pyodide.setStdout(writer('stdout'));
  pyodide.setStderr(writer('stderr'));
  pyodide.setStdin({
    stdin() {
      if (!inputs.length) return null; // EOF: input() raises EOFError
      const line = inputs.shift();
      display += `${line}\n`; // echo, as if the user had typed it
      return line;
    },
  });

  // A fresh namespace per run, so variables from an earlier run can't hide a NameError.
  const namespace = pyodide.globals.get('dict')();
  try {
    await pyodide.runPythonAsync(code, { globals: namespace });
    return { ok: true, display, stdout, error: null };
  } catch (error) {
    const described = describeError(error);
    if (/EOFError/.test(described.message)) {
      described.message = 'Your program asked for more input than you gave it. Add another line in the input box.';
    }
    return { ok: false, display, stdout, error: described };
  } finally {
    namespace.destroy();
  }
}

self.onmessage = async ({ data }) => {
  try {
    const pyodide = await loadRuntime(data.baseUrl);
    if (data.type === 'init') {
      self.postMessage({ id: data.id, type: 'ready' });
      return;
    }
    self.postMessage({ id: data.id, type: 'started' });
    const result = await run(pyodide, data.code, data.stdin);
    self.postMessage({ id: data.id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'failed', message: String(error?.message ?? error) });
  }
};
