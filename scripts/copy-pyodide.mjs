// Copies the in-browser Python runtime (Pyodide) from node_modules into public/pyodide/<version>/
// so Vite serves it in development and includes it in the production build. Also writes brotli
// and gzip copies, which the API server sends instead of the originals (13 MB -> about 4 MB).
// Runs automatically before `npm run dev` and `npm run build`.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const sourceDir = path.resolve('node_modules/pyodide');
const { version } = JSON.parse(readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
const rootDir = path.resolve('public/pyodide');
const targetDir = path.join(rootDir, version);
const marker = path.join(targetDir, '.complete');

if (existsSync(marker)) {
  console.log(`[pyodide] ${version} already in public/pyodide`);
  process.exit(0);
}

rmSync(rootDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

for (const file of FILES) {
  const source = path.join(sourceDir, file);
  const target = path.join(targetDir, file);
  await pipeline(createReadStream(source), createWriteStream(target));
  // The stdlib is already a zip; compressing it again gains nothing.
  if (!file.endsWith('.zip')) {
    await pipeline(
      createReadStream(source),
      createBrotliCompress({
        params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: statSync(source).size },
      }),
      createWriteStream(`${target}.br`)
    );
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(`${target}.gz`));
  }
}

await pipeline(async function* () {
  yield 'ok\n';
}, createWriteStream(marker));
console.log(`[pyodide] copied ${version} to public/pyodide/${version}`);
