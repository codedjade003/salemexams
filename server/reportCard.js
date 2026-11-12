// Printable results. Files are opened straight from disk or printed, so everything is
// self-contained: inline styles, no relative URLs, no external fonts.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value, timeZone) {
  if (!value) {
    return '—';
  }

  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function initialsFrom(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return letters || 'SA';
}

function isEmbeddableLogo(url) {
  return /^(https?:\/\/|data:image\/)/i.test(String(url ?? '').trim());
}

function renderLogo(branding) {
  if (isEmbeddableLogo(branding.logoUrl)) {
    return `<img class="logo" src="${escapeHtml(branding.logoUrl)}" alt="" />`;
  }

  return `<div class="logo monogram" aria-hidden="true">${escapeHtml(initialsFrom(branding.schoolName))}</div>`;
}

function resultClass(result) {
  if (result === 'Correct') return 'ok';
  if (result === 'Incorrect') return 'bad';
  return 'muted';
}

const STYLES = `
  :root {
    --brand: #006666; --brand-dark: #034b4b; --brand-tint: #e8f3f2; --gold: #b8913a;
    --ink: #13262b; --ink-soft: #4a5f66; --line: #d9e3e5; --ok: #1f7a46; --ok-tint: #e3f4ea;
    --bad: #b42318; --bad-tint: #fdecea; --muted-tint: #eef2f3;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f3; color: var(--ink);
    font: 13.5px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; }
  .sheet { max-width: 860px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden;
    box-shadow: 0 10px 30px rgba(19, 38, 43, .12); }
  header.band { display: flex; align-items: center; gap: 18px; padding: 24px 32px 20px;
    background: linear-gradient(135deg, var(--brand-dark), var(--brand)); color: #fff;
    border-bottom: 4px solid var(--gold); }
  .logo { width: 60px; height: 60px; border-radius: 12px; object-fit: contain; background: #fff; flex: none; }
  .monogram { display: grid; place-items: center; font: 700 23px/1 Georgia, "Times New Roman", serif;
    color: var(--brand-dark); letter-spacing: .5px; }
  .school { margin: 0; font: 600 25px/1.15 Georgia, "Times New Roman", serif; letter-spacing: .2px; }
  .kicker { margin: 4px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .14em; opacity: .85; }
  main { padding: 24px 32px 28px; }
  h2 { margin: 0 0 10px; font-size: 12.5px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink-soft); }
  .details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0 0 20px;
    border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .details div { padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .details div:nth-child(odd) { border-right: 1px solid var(--line); }
  .details div:nth-last-child(-n+2) { border-bottom: 0; }
  .details dt { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-soft); }
  .details dd { margin: 1px 0 0; font-weight: 600; word-break: break-word; }
  .score { display: grid; grid-template-columns: 190px 1fr; gap: 14px; margin-bottom: 16px; }
  .final { border-radius: 10px; background: var(--brand-tint); border: 1px solid #c5e0de; padding: 14px;
    display: flex; flex-direction: column; justify-content: center; }
  .final span { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: var(--brand-dark); }
  .final strong { font-size: 42px; line-height: 1.1; color: var(--brand-dark); }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stat { border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px; }
  .stat span { display: block; font-size: 12px; color: var(--ink-soft); }
  .stat strong { font-size: 17px; }
  .note { margin: 0 0 18px; padding: 9px 14px; border-left: 3px solid var(--gold); background: #fbf7ec;
    color: #5c4a1c; border-radius: 0 8px 8px 0; font-size: 13px; }
  .q { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 0 0 10px; break-inside: avoid; }
  .q.ok { border-left: 4px solid var(--ok); }
  .q.bad { border-left: 4px solid var(--bad); }
  .q-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 4px; }
  .q-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-soft); }
  .q-text { margin: 0 0 8px; font-weight: 600; white-space: pre-line; }
  pre { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: #f3f6f7; border: 1px solid var(--line);
    font: 12.5px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .answers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .answers.single { grid-template-columns: 1fr; }
  .answers div > span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-soft); }
  .answers p { margin: 2px 0 0; white-space: pre-line; }
  .why { margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed var(--line); color: #2c4148; white-space: pre-line; }
  .why b { color: var(--brand-dark); }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pill.ok { background: var(--ok-tint); color: var(--ok); }
  .pill.bad { background: var(--bad-tint); color: var(--bad); }
  .pill.muted { background: var(--muted-tint); color: var(--ink-soft); }
  table.list { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.list th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-soft);
    background: #f5f8f8; border-bottom: 1px solid var(--line); padding: 8px 10px; }
  table.list td { border-bottom: 1px solid var(--line); padding: 7px 10px; vertical-align: top; }
  table.list td.num, table.list th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.list tr { break-inside: avoid; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 12px 32px 18px; color: var(--ink-soft); font-size: 12px; border-top: 1px solid var(--line); }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 10px 20px; background: var(--ink); color: #fff; font-size: 13px; }
  button { border: 0; border-radius: 8px; background: var(--brand); color: #fff; padding: 9px 16px;
    font: 600 13px/1 inherit; cursor: pointer; }
  @media (max-width: 640px) {
    .details, .score, .stats, .answers { grid-template-columns: 1fr; }
    .details div:nth-child(odd) { border-right: 0; }
    .details div:nth-last-child(2) { border-bottom: 1px solid var(--line); }
    header.band, main, footer { padding-left: 18px; padding-right: 18px; }
  }
  @media print {
    @page { size: A4; margin: 11mm; }
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; border-radius: 0; max-width: none; break-after: page; }
    .sheet:last-of-type { break-after: auto; }
    header.band, .final, .pill, .note, pre, table.list th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
`;

function renderQuestion(row) {
  const tone = resultClass(row.result);
  const answer = row.selectedIsCode
    ? `<pre>${escapeHtml(row.selected)}</pre>${
        row.testCount
          ? `<p>${row.checks ? `Automatic checks passed: ${row.checks.passed} of ${row.checks.total}` : 'Automatic checks were not run.'}</p>`
          : ''
      }`
    : `<p>${escapeHtml(row.selected)}</p>`;
  const showCorrect = Boolean(row.correct);
  return `
    <article class="q ${tone}">
      <div class="q-head">
        <span class="q-kind">Question ${row.index} · ${escapeHtml(row.typeLabel)}${row.hintUsed ? ' · hint used' : ''}</span>
        <span class="pill ${tone}">${escapeHtml(row.result)}${row.markedByTeacher ? ' · marked by teacher' : ''}</span>
      </div>
      <p class="q-text">${escapeHtml(row.text)}</p>
      ${row.code ? `<pre>${escapeHtml(row.code)}</pre>` : ''}
      <div class="answers ${showCorrect && !row.selectedIsCode ? '' : 'single'}">
        <div><span>Student’s answer</span>${answer}</div>
        ${showCorrect ? `<div><span>Correct answer</span><p>${escapeHtml(row.correct)}</p></div>` : ''}
      </div>
      ${row.explanation ? `<p class="why"><b>Explanation:</b> ${escapeHtml(row.explanation)}</p>` : ''}
    </article>`;
}

function renderCardSection(payload) {
  const { branding, student, exam, summary = {}, timeZone } = payload;
  const totalQuestions = Number(summary.totalQuestions ?? 0);
  const violationsCount = Number(summary.violationsCount ?? 0);
  const totalViolationsCount = Number(summary.totalViolationsCount ?? violationsCount);
  const penaltyPoints = Number(summary.penaltyPoints ?? 0);

  const correctionsNote = payload.includeCorrectAnswers
    ? 'This report includes the correct answer and an explanation for every question.'
    : `Correct answers and explanations will be available from ${escapeHtml(formatDate(payload.resultsAvailableAt, timeZone))}. Download the report again after that time to see them.`;

  return `
  <div class="sheet">
    <header class="band">
      ${renderLogo(branding)}
      <div>
        <p class="school">${escapeHtml(branding.schoolName)}</p>
        <p class="kicker">Computer-Based Test · Statement of Result</p>
      </div>
    </header>
    <main>
      <h2>Candidate</h2>
      <dl class="details">
        <div><dt>Student</dt><dd>${escapeHtml(student.fullName)}</dd></div>
        <div><dt>Class</dt><dd>${escapeHtml(student.classRoom)}</dd></div>
        <div><dt>Exam</dt><dd>${escapeHtml(exam.title)}</dd></div>
        <div><dt>Attempt</dt><dd>#${escapeHtml(exam.trialNumber)}</dd></div>
        <div><dt>Started</dt><dd>${escapeHtml(formatDate(payload.startedAt, timeZone))}</dd></div>
        <div><dt>Submitted</dt><dd>${escapeHtml(formatDate(payload.submittedAt, timeZone))}</dd></div>
      </dl>

      <h2>Result</h2>
      <section class="score">
        <div class="final"><span>Final score</span><strong>${Number(summary.finalPercent ?? 0)}%</strong></div>
        <div class="stats">
          <div class="stat"><span>Correct answers</span><strong>${Number(summary.correctCount ?? 0)} / ${totalQuestions}</strong></div>
          <div class="stat"><span>Questions answered</span><strong>${Number(summary.answeredCount ?? 0)} / ${totalQuestions}</strong></div>
          <div class="stat"><span>Score before penalties</span><strong>${Number(summary.rawPercent ?? 0)}%</strong></div>
          <div class="stat"><span>Proctoring penalty</span><strong>${penaltyPoints ? `−${penaltyPoints} pts` : 'None'}</strong>
            <span>${violationsCount} counted · ${totalViolationsCount} logged</span></div>
        </div>
      </section>
      <p class="note">${correctionsNote}</p>

      <h2>Questions, answers and explanations</h2>
      ${payload.questions.map(renderQuestion).join('') || '<p>No question review available.</p>'}
    </main>
    <footer>
      <span>Reference ${escapeHtml(exam.sessionId)} · Generated ${escapeHtml(formatDate(payload.generatedAt, timeZone))}</span>
    </footer>
  </div>`;
}

function renderDocument(title, body, toolbarText) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
  <div class="toolbar no-print">
    <span>${escapeHtml(toolbarText)}</span>
    <button type="button" onclick="window.print()">Print or save as PDF</button>
  </div>
  ${body}
</body>
</html>`;
}

export function renderReportCardHtml(payload) {
  return renderDocument(
    `${payload.student.fullName} — ${payload.exam.title} report card`,
    renderCardSection(payload),
    `${payload.student.fullName} · ${payload.exam.title}`
  );
}

/** Many report cards in one document; each student starts on a new page when printed. */
export function renderBulkReportCardsHtml(payloads, title) {
  return renderDocument(
    title,
    payloads.map(renderCardSection).join('\n'),
    `${payloads.length} report card${payloads.length === 1 ? '' : 's'} · each student starts on a new page`
  );
}

/** One-page-per-class style summary: a row per student. */
export function renderResultSheetHtml({ branding, title, subtitle, rows, generatedAt, timeZone }) {
  const body = `
  <div class="sheet">
    <header class="band">
      ${renderLogo(branding)}
      <div>
        <p class="school">${escapeHtml(branding.schoolName)}</p>
        <p class="kicker">Computer-Based Test · Result Sheet</p>
      </div>
    </header>
    <main>
      <h2>${escapeHtml(title)}</h2>
      <p class="note">${escapeHtml(subtitle)}</p>
      <table class="list">
        <thead><tr><th class="num">#</th><th>Student</th><th>Class</th><th>Exam</th><th class="num">Attempt</th>
          <th class="num">Correct</th><th class="num">Penalty</th><th class="num">Final score</th></tr></thead>
        <tbody>
          ${
            rows
              .map(
                (row, index) => `<tr><td class="num">${index + 1}</td><td><strong>${escapeHtml(row.fullName)}</strong></td>
                <td>${escapeHtml(row.classRoom)}</td><td>${escapeHtml(row.examTitle)}</td><td class="num">${escapeHtml(row.trialNumber)}</td>
                <td class="num">${row.correctCount} / ${row.totalQuestions}</td>
                <td class="num">${row.penaltyPoints ? `−${row.penaltyPoints}` : '0'}</td>
                <td class="num"><strong>${row.finalPercent}%</strong></td></tr>`
              )
              .join('') || '<tr><td colspan="8">No submitted attempts match.</td></tr>'
          }
        </tbody>
      </table>
    </main>
    <footer><span>${rows.length} student result${rows.length === 1 ? '' : 's'} · Generated ${escapeHtml(formatDate(generatedAt, timeZone))}</span></footer>
  </div>`;
  return renderDocument(title, body, title);
}
