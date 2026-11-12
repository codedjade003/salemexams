// Question types and everything that depends on them: validation, per-attempt shuffling, what a
// student may see, answer sanitizing, grading, and how answers read in reviews and report cards.
//
// Types
//   single / multi  multiple choice (format: choice | true_false | yes_no), 2–6 options
//   order           put steps in order; `items` are stored in the correct order
//   flowchart       fill blank shapes; `flowchart.nodes` with optional one-level decision branches
//   code            write a Python program; graded by running `tests` in the student's browser
// Any choice question may carry a `code` snippet (Python is runnable; codeLanguage 'text' is not).

export const QUESTION_TYPES = ['single', 'multi', 'order', 'flowchart', 'code'];
export const CHOICE_FORMATS = ['choice', 'true_false', 'yes_no'];
export const FLOW_SHAPES = ['terminal', 'io', 'process', 'decision'];
export const MATCH_MODES = ['number', 'contains', 'exact'];

const LETTERS = 'ABCDEFGHIJ'.split('');
const FIXED_OPTIONS = { true_false: ['True', 'False'], yes_no: ['Yes', 'No'] };
const SHAPE_LABELS = { terminal: 'Start/Stop', io: 'Input/Output', process: 'Process', decision: 'Decision' };

export const MAX_CODE_LENGTH = 5000;

// ----------------------------------------------------------------- text helpers

function normalizeLine(value, max = 300) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function normalizeMultiline(value, max = 2000) {
  if (typeof value !== 'string') return '';
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' '));
  const kept = [];
  for (const line of lines) {
    if (!line && !kept.at(-1)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim().slice(0, max);
}

/** Keeps indentation (Python needs it); normalizes newlines and tabs. */
export function normalizeCode(value, max = MAX_CODE_LENGTH) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .slice(0, max);
}

function normalizeExamId(value) {
  return normalizeLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// ----------------------------------------------------------------- validation

function validateChoice(question, type) {
  const format = CHOICE_FORMATS.includes(question.format) ? question.format : 'choice';
  let optionTexts = FIXED_OPTIONS[format]
    ? [...FIXED_OPTIONS[format]]
    : (Array.isArray(question.optionTexts) ? question.optionTexts : (question.options ?? []).map((option) => option?.text)).map(
        (text) => normalizeLine(text, 400)
      );
  // Blank options at the end of the list are ignored (the editor shows spare empty rows).
  while (optionTexts.length && !optionTexts.at(-1)) optionTexts = optionTexts.slice(0, -1);

  if (optionTexts.length < 2 || optionTexts.length > 6 || optionTexts.some((text) => !text)) {
    throw new Error('Multiple choice questions need 2 to 6 options, and none can be empty.');
  }

  const options = optionTexts.map((text, index) => ({ id: LETTERS[index], text }));
  const validIds = new Set(options.map((option) => option.id));
  const correctOptionIds = [
    ...new Set((Array.isArray(question.correctOptionIds) ? question.correctOptionIds : []).map((id) => String(id).toUpperCase())),
  ].filter((id) => validIds.has(id));

  if (!correctOptionIds.length) {
    throw new Error('Mark at least one correct option.');
  }
  if (type === 'single' && correctOptionIds.length !== 1) {
    throw new Error('A one-answer question must have exactly one correct option.');
  }

  return {
    format,
    options,
    correctOptionIds,
    // True/False and Yes/No always keep their natural order.
    lockOptionOrder: format !== 'choice' || question.lockOptionOrder === true,
  };
}

function validateOrder(question) {
  const items = (Array.isArray(question.items) ? question.items : [])
    .map((item) => normalizeLine(typeof item === 'string' ? item : item?.text, 300))
    .filter(Boolean);
  if (items.length < 2 || items.length > 10) {
    throw new Error('An ordering question needs 2 to 10 steps.');
  }
  return { items: items.map((text, index) => ({ id: `S${index + 1}`, text })) };
}

function validateFlowNode(node, allowDecision) {
  const shape = FLOW_SHAPES.includes(node?.shape) ? node.shape : null;
  if (!shape) throw new Error('Each flowchart shape must be Start/Stop, Input/Output, Process or Decision.');
  if (shape === 'decision' && !allowDecision) throw new Error('A decision cannot be inside another decision’s branch.');
  const text = normalizeLine(node.text, 160);
  if (!text) throw new Error('Every flowchart shape needs text.');

  const result = { shape, text, blank: node.blank === true };
  if (shape === 'decision') {
    const branch = (value) => (Array.isArray(value) ? value : []).slice(0, 4).map((child) => validateFlowNode(child, false));
    result.yes = branch(node.yes);
    result.no = branch(node.no);
  }
  return result;
}

/** Flowchart nodes in reading order: each main node, then its Yes branch, then its No branch. */
export function flattenFlowNodes(nodes) {
  const flat = [];
  for (const node of nodes ?? []) {
    flat.push(node);
    if (node.shape === 'decision') {
      flat.push(...(node.yes ?? []), ...(node.no ?? []));
    }
  }
  return flat;
}

function validateFlowchart(question) {
  const source = question.flowchart ?? {};
  const nodes = (Array.isArray(source.nodes) ? source.nodes : []).slice(0, 12).map((node) => validateFlowNode(node, true));
  const flat = flattenFlowNodes(nodes);
  if (flat.length < 2 || flat.length > 16) {
    throw new Error('A flowchart needs 2 to 16 shapes.');
  }
  const blanks = flat.filter((node) => node.blank);
  if (!blanks.length) {
    throw new Error('Mark at least one flowchart shape as a blank for students to fill in.');
  }
  flat.forEach((node, index) => {
    node.id = `N${index + 1}`;
  });
  const distractors = (Array.isArray(source.distractors) ? source.distractors : [])
    .map((text) => normalizeLine(text, 160))
    .filter(Boolean)
    .slice(0, 5);
  return { flowchart: { nodes, distractors } };
}

function validateCodeQuestion(question) {
  const tests = (Array.isArray(question.tests) ? question.tests : [])
    .map((test) => ({
      input: normalizeCode(String(test?.input ?? ''), 500),
      expected: normalizeLine(String(test?.expected ?? ''), 200),
      match: MATCH_MODES.includes(test?.match) ? test.match : 'contains',
    }))
    .filter((test) => test.expected)
    .slice(0, 6);
  if (!tests.length) {
    throw new Error('A coding question needs at least one test with an expected output.');
  }
  return {
    starterCode: normalizeCode(question.starterCode ?? '', 2000),
    tests,
  };
}

export function validateQuestion(question, generatedId = '') {
  if (!question || typeof question !== 'object') {
    throw new Error('Invalid question payload.');
  }

  const type = normalizeLine(question.type).toLowerCase();
  if (!QUESTION_TYPES.includes(type)) {
    throw new Error('Unknown question type.');
  }

  const text = normalizeMultiline(question.text, 2000);
  if (text.length < 5) {
    throw new Error('Question text must be at least 5 characters.');
  }

  const id = normalizeLine(question.id) || generatedId;
  if (!/^Q\d{3,}$/i.test(id)) {
    throw new Error('Question ID must look like Q001.');
  }

  const base = {
    id: id.toUpperCase(),
    topic: normalizeLine(question.topic, 40).toLowerCase() || 'general',
    type,
    text,
    explanation: normalizeMultiline(question.explanation ?? '', 2000),
    // Shown only when a student spends one of their hints (if the exam allows hints for them).
    hint: normalizeMultiline(question.hint ?? '', 600),
    code: normalizeCode(question.code ?? '', 3000),
    codeLanguage: question.codeLanguage === 'text' ? 'text' : 'python',
    codeSampleInput: normalizeCode(question.codeSampleInput ?? '', 500),
    sourceExamId: normalizeExamId(question.sourceExamId) || 'general',
  };

  if (type === 'single' || type === 'multi') return { ...base, ...validateChoice(question, type) };
  if (type === 'order') return { ...base, ...validateOrder(question) };
  if (type === 'flowchart') return { ...base, ...validateFlowchart(question) };
  return { ...base, ...validateCodeQuestion(question) };
}

// ----------------------------------------------------------------- per-attempt preparation

/**
 * Shuffles a question for one attempt. Labels are reassigned by display position, so the ids a
 * student's browser sees never reveal the correct answer.
 */
export function prepareQuestionForSession(question) {
  if (question.type === 'single' || question.type === 'multi') {
    if (question.lockOptionOrder) return structuredClone(question);
    const shuffled = shuffle(question.options);
    return {
      ...structuredClone(question),
      options: shuffled.map((option, index) => ({ id: LETTERS[index], text: option.text })),
      correctOptionIds: shuffled
        .map((option, index) => ((question.correctOptionIds ?? []).includes(option.id) ? LETTERS[index] : null))
        .filter(Boolean),
    };
  }

  if (question.type === 'order') {
    let shuffled = shuffle(question.items);
    for (let tries = 0; tries < 6 && shuffled.every((item, index) => item.id === question.items[index].id); tries += 1) {
      shuffled = shuffle(question.items);
    }
    const labelById = new Map(shuffled.map((item, index) => [item.id, LETTERS[index]]));
    return {
      ...structuredClone(question),
      items: shuffled.map((item, index) => ({ id: LETTERS[index], text: item.text })),
      correctOrder: question.items.map((item) => labelById.get(item.id)),
    };
  }

  if (question.type === 'flowchart') {
    const blanks = flattenFlowNodes(question.flowchart.nodes).filter((node) => node.blank);
    const pool = shuffle([...blanks.map((node) => node.text), ...(question.flowchart.distractors ?? [])]).map(
      (text, index) => ({ id: `P${index + 1}`, text })
    );
    return { ...structuredClone(question), pool };
  }

  return structuredClone(question);
}

/** Display order of question kinds within an attempt: quick questions first, coding last. */
export function sectionRank(question) {
  if (question.type === 'order') return 1;
  if (question.type === 'flowchart') return 2;
  if (question.type === 'code') return 4;
  return question.code && question.codeLanguage !== 'text' ? 3 : 0;
}

function maskFlowNodes(nodes, reveal, counter = { slot: 0 }) {
  return nodes.map((node) => {
    const masked = { id: node.id, shape: node.shape };
    if (node.blank) {
      masked.blank = true;
      masked.slot = counter.slot;
      counter.slot += 1;
      if (reveal) masked.text = node.text;
    } else {
      masked.text = node.text;
    }
    if (node.shape === 'decision') {
      masked.yes = maskFlowNodes(node.yes ?? [], reveal, counter);
      masked.no = maskFlowNodes(node.no ?? [], reveal, counter);
    }
    return masked;
  });
}

/** What the student's browser receives while taking the exam: no answers. */
export function toPublicQuestion(question) {
  const base = {
    id: question.id,
    topic: question.topic,
    type: question.type,
    format: question.format ?? 'choice',
    text: question.text,
    code: question.code ?? '',
    codeLanguage: question.codeLanguage ?? 'python',
    codeSampleInput: question.codeSampleInput ?? '',
    hasHint: Boolean(question.hint),
  };

  if (question.type === 'order') return { ...base, items: question.items };
  if (question.type === 'flowchart') {
    return { ...base, flowchart: { nodes: maskFlowNodes(question.flowchart.nodes, false) }, pool: question.pool ?? [] };
  }
  if (question.type === 'code') {
    // Tests run in the student's browser to check the program, so their inputs and expected
    // outputs are sent too. The admin can always review the code and override the mark.
    return { ...base, starterCode: question.starterCode ?? '', tests: question.tests ?? [] };
  }
  return { ...base, options: question.options ?? [] };
}

// ----------------------------------------------------------------- answers

export function flowSlotCount(question) {
  return flattenFlowNodes(question.flowchart?.nodes).filter((node) => node.blank).length;
}

/** Cleans a submitted answer for `question`. Returns null when the value is unusable. */
export function sanitizeResponse(question, value) {
  if (question.type === 'single' || question.type === 'multi') {
    if (!Array.isArray(value)) return [];
    const allowed = new Set((question.options ?? []).map((option) => option.id));
    const unique = [...new Set(value.filter((optionId) => allowed.has(optionId)))];
    return question.type === 'single' ? unique.slice(0, 1) : unique;
  }

  if (question.type === 'order') {
    if (!Array.isArray(value)) return [];
    const ids = (question.items ?? []).map((item) => item.id);
    const isPermutation = value.length === ids.length && new Set(value).size === ids.length && value.every((id) => ids.includes(id));
    return isPermutation ? [...value] : [];
  }

  if (question.type === 'flowchart') {
    if (!Array.isArray(value)) return [];
    const poolIds = new Set((question.pool ?? []).map((item) => item.id));
    const slots = flowSlotCount(question);
    return Array.from({ length: slots }, (_unused, index) => (poolIds.has(value[index]) ? value[index] : null));
  }

  if (question.type === 'code') {
    const code = normalizeCode(typeof value?.code === 'string' ? value.code : '', MAX_CODE_LENGTH);
    const total = Number(value?.checks?.total);
    const passed = Number(value?.checks?.passed);
    const checks =
      Number.isInteger(total) && Number.isInteger(passed) && total > 0 && passed >= 0 && passed <= total
        ? { passed, total, checkedAt: Date.now() }
        : null;
    return { code, checks };
  }

  return null;
}

export function isAnswered(question, response) {
  if (!response) return false;
  if (question.type === 'code') {
    const code = normalizeCode(response.code ?? '');
    return Boolean(code) && code !== normalizeCode(question.starterCode ?? '');
  }
  if (question.type === 'flowchart') return Array.isArray(response) && response.some(Boolean);
  return Array.isArray(response) && response.length > 0;
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

/** Automatic marking (an admin override, if any, is applied by the caller). */
export function isResponseCorrect(question, response) {
  if (!question) return false;
  if (question.type === 'single' || question.type === 'multi') {
    return sameSet(Array.isArray(response) ? response : [], question.correctOptionIds ?? []);
  }
  if (question.type === 'order') {
    const expected = question.correctOrder ?? [];
    return Array.isArray(response) && expected.length > 0 && response.length === expected.length && response.every((id, index) => id === expected[index]);
  }
  if (question.type === 'flowchart') {
    const blanks = flattenFlowNodes(question.flowchart?.nodes).filter((node) => node.blank);
    const textById = new Map((question.pool ?? []).map((item) => [item.id, item.text]));
    // Compared by text, so two blanks with the same wording can be filled either way round.
    return Array.isArray(response) && blanks.length > 0 && blanks.every((node, index) => textById.get(response[index]) === node.text);
  }
  if (question.type === 'code') {
    const checks = response?.checks;
    return Boolean(checks) && checks.total === (question.tests ?? []).length && checks.passed === checks.total && isAnswered(question, response);
  }
  return false;
}

// ----------------------------------------------------------------- reviews and report text

export function questionTypeLabel(question) {
  if (question.type === 'order') return 'Put in order';
  if (question.type === 'flowchart') return 'Flowchart';
  if (question.type === 'code') return 'Python program';
  if (question.format === 'true_false') return 'True or false';
  if (question.format === 'yes_no') return 'Yes or no';
  if (question.code && question.codeLanguage !== 'text') return 'Find the bug';
  return question.type === 'multi' ? 'Multiple answers' : 'Multiple choice';
}

function describeOptions(question, ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return '';
  return list
    .map((id) => {
      const option = (question.options ?? []).find((item) => item.id === id);
      return option ? (question.format === 'choice' ? `${id}. ${option.text}` : option.text) : id;
    })
    .join('; ');
}

function describeOrder(question, ids) {
  if (!Array.isArray(ids) || !ids.length) return '';
  const textById = new Map((question.items ?? []).map((item) => [item.id, item.text]));
  return ids.map((id, index) => `${index + 1}. ${textById.get(id) ?? '?'}`).join('\n');
}

function describeFlowchart(question, texts) {
  const blanks = flattenFlowNodes(question.flowchart?.nodes).filter((node) => node.blank);
  if (!texts.some(Boolean)) return '';
  return blanks.map((node, index) => `${SHAPE_LABELS[node.shape]}: ${texts[index] || '(empty)'}`).join('\n');
}

/** Human-readable "your answer" for report cards and admin views. */
export function describeResponse(question, response) {
  if (question.type === 'single' || question.type === 'multi') return describeOptions(question, response);
  if (question.type === 'order') return describeOrder(question, response);
  if (question.type === 'flowchart') {
    const textById = new Map((question.pool ?? []).map((item) => [item.id, item.text]));
    return describeFlowchart(question, (Array.isArray(response) ? response : []).map((id) => textById.get(id) ?? ''));
  }
  if (question.type === 'code') return isAnswered(question, response) ? normalizeCode(response.code) : '';
  return '';
}

export function describeCorrectAnswer(question) {
  if (question.type === 'single' || question.type === 'multi') return describeOptions(question, question.correctOptionIds);
  if (question.type === 'order') return describeOrder(question, question.correctOrder ?? []);
  if (question.type === 'flowchart') {
    return describeFlowchart(question, flattenFlowNodes(question.flowchart?.nodes).filter((node) => node.blank).map((node) => node.text));
  }
  if (question.type === 'code') {
    return `A program that passes all ${question.tests?.length ?? 0} checks (see explanation).`;
  }
  return '';
}

/**
 * One question's review. With `reveal` false (corrections not released yet) it contains only the
 * student's own answer: no correct answers, no explanation, no marking.
 */
export function buildReviewItem(question, response, { reveal, manualGrade, index }) {
  const autoCorrect = isResponseCorrect(question, response);
  const hasOverride = manualGrade === true || manualGrade === false;
  const item = {
    index,
    questionId: question.id,
    type: question.type,
    format: question.format ?? 'choice',
    typeLabel: questionTypeLabel(question),
    topic: question.topic,
    text: question.text,
    code: question.code ?? '',
    codeLanguage: question.codeLanguage ?? 'python',
    codeSampleInput: question.codeSampleInput ?? '',
    answered: isAnswered(question, response),
    answerText: describeResponse(question, response),
    correctText: reveal ? describeCorrectAnswer(question) : '',
    explanation: reveal ? question.explanation ?? '' : '',
    isCorrect: reveal ? (hasOverride ? manualGrade : autoCorrect) : null,
    autoCorrect: reveal ? autoCorrect : null,
    manualGrade: reveal && hasOverride ? manualGrade : null,
  };

  if (question.type === 'single' || question.type === 'multi') {
    item.options = question.options ?? [];
    item.selectedOptionIds = Array.isArray(response) ? response : [];
    item.correctOptionIds = reveal ? question.correctOptionIds ?? [] : [];
  } else if (question.type === 'order') {
    item.items = question.items ?? [];
    item.selectedOrder = Array.isArray(response) ? response : [];
    item.correctOrder = reveal ? question.correctOrder ?? [] : [];
  } else if (question.type === 'flowchart') {
    const textById = new Map((question.pool ?? []).map((entry) => [entry.id, entry.text]));
    item.flowchart = { nodes: maskFlowNodes(question.flowchart?.nodes ?? [], reveal) };
    item.selectedSlotTexts = (Array.isArray(response) ? response : []).map((id) => textById.get(id) ?? '');
  } else if (question.type === 'code') {
    item.studentCode = typeof response?.code === 'string' ? response.code : '';
    item.checks = response?.checks ?? null;
    item.testCount = question.tests?.length ?? 0;
    item.tests = reveal ? question.tests ?? [] : [];
  }

  return item;
}
