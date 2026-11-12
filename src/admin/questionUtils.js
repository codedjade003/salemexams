// Form model for the question editor. `kind` is the editor's single "type" choice; it maps to
// the server's type + format.

export const QUESTION_KINDS = [
  { id: 'choice', label: 'Multiple choice (one answer)' },
  { id: 'multi', label: 'Multiple choice (several answers)' },
  { id: 'true_false', label: 'True or false' },
  { id: 'yes_no', label: 'Yes or no' },
  { id: 'order', label: 'Put steps in order' },
  { id: 'flowchart', label: 'Flowchart (fill the shapes)' },
  { id: 'code', label: 'Python program' },
];

export const FLOW_SHAPES = [
  { id: 'terminal', label: 'Start / Stop' },
  { id: 'io', label: 'Input / Output' },
  { id: 'process', label: 'Process' },
  { id: 'decision', label: 'Decision' },
];

const LETTERS = 'ABCDEF'.split('');

export const EMPTY_QUESTION = {
  kind: 'choice',
  topic: 'general',
  text: '',
  explanation: '',
  hint: '',
  code: '',
  codeLanguage: 'python',
  codeSampleInput: '',
  optionTexts: ['', '', '', ''],
  correctOptionIds: ['A'],
  items: ['', '', ''],
  nodes: [
    { shape: 'terminal', text: 'Start', blank: false },
    { shape: 'io', text: '', blank: true },
    { shape: 'process', text: '', blank: true },
    { shape: 'terminal', text: 'Stop', blank: false },
  ],
  distractors: [],
  starterCode: '',
  tests: [{ input: '', expected: '', match: 'contains' }],
};

function kindOf(question) {
  if (question.type === 'order' || question.type === 'flowchart' || question.type === 'code') return question.type;
  if (question.type === 'multi') return 'multi';
  if (question.format === 'true_false' || question.format === 'yes_no') return question.format;
  return 'choice';
}

const cleanNode = (node) => ({
  shape: node.shape,
  text: node.text ?? '',
  blank: Boolean(node.blank),
  ...(node.shape === 'decision' ? { yes: (node.yes ?? []).map(cleanNode), no: (node.no ?? []).map(cleanNode) } : {}),
});

export function questionToForm(question) {
  return {
    ...EMPTY_QUESTION,
    kind: kindOf(question),
    topic: question.topic ?? 'general',
    text: question.text ?? '',
    explanation: question.explanation ?? '',
    hint: question.hint ?? '',
    code: question.code ?? '',
    codeLanguage: question.codeLanguage ?? 'python',
    codeSampleInput: question.codeSampleInput ?? '',
    optionTexts: question.options?.length ? question.options.map((option) => option.text) : EMPTY_QUESTION.optionTexts,
    correctOptionIds: question.correctOptionIds?.length ? [...question.correctOptionIds] : ['A'],
    items: question.items?.length ? question.items.map((item) => item.text) : EMPTY_QUESTION.items,
    nodes: question.flowchart?.nodes?.length ? question.flowchart.nodes.map(cleanNode) : EMPTY_QUESTION.nodes,
    distractors: [...(question.flowchart?.distractors ?? [])],
    starterCode: question.starterCode ?? '',
    tests: question.tests?.length ? question.tests.map((test) => ({ ...test })) : EMPTY_QUESTION.tests,
  };
}

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...(node.shape === 'decision' ? [...(node.yes ?? []), ...(node.no ?? [])] : [])]);
}

/** Returns an error message, or '' when the question is valid. Mirrors the server's rules. */
export function validateQuestionForm(form) {
  if (form.text.trim().length < 5) return 'Write the question (at least 5 characters).';
  if (form.kind === 'choice' || form.kind === 'multi') {
    const filled = form.optionTexts.filter((text) => text.trim());
    if (filled.length < 2) return 'Add at least two options.';
    const lastFilled = form.optionTexts.findLastIndex((text) => text.trim());
    if (form.optionTexts.slice(0, lastFilled + 1).some((text) => !text.trim())) return 'Fill in every option, or remove the empty one in the middle.';
    const valid = form.correctOptionIds.filter((id) => LETTERS.indexOf(id) <= lastFilled);
    if (!valid.length) return 'Mark the correct option.';
    if (form.kind === 'choice' && valid.length !== 1) return 'A one-answer question needs exactly one correct option.';
  }
  if (form.kind === 'order' && form.items.filter((text) => text.trim()).length < 2) return 'Add at least two steps.';
  if (form.kind === 'flowchart') {
    const flat = flatten(form.nodes);
    if (flat.length < 2) return 'Add at least two shapes.';
    if (flat.some((node) => !node.text.trim())) return 'Every shape needs its text (blank shapes need the correct answer).';
    if (!flat.some((node) => node.blank)) return 'Mark at least one shape as a blank for students to fill.';
  }
  if (form.kind === 'code' && !form.tests.some((test) => test.expected.trim())) return 'Add at least one check with an expected output.';
  return '';
}

/** Builds the API payload from the form. */
export function formToPayload(form) {
  const base = {
    topic: form.topic,
    text: form.text,
    explanation: form.explanation,
    hint: form.hint,
  };
  if (form.kind === 'order') return { ...base, type: 'order', items: form.items.filter((text) => text.trim()) };
  if (form.kind === 'flowchart') {
    return { ...base, type: 'flowchart', flowchart: { nodes: form.nodes, distractors: form.distractors.filter((text) => text.trim()) } };
  }
  if (form.kind === 'code') {
    return {
      ...base,
      type: 'code',
      starterCode: form.starterCode,
      codeSampleInput: form.codeSampleInput,
      tests: form.tests.filter((test) => test.expected.trim()),
    };
  }
  const snippet = { code: form.code, codeLanguage: form.codeLanguage, codeSampleInput: form.codeSampleInput };
  if (form.kind === 'true_false' || form.kind === 'yes_no') {
    return { ...base, ...snippet, type: 'single', format: form.kind, correctOptionIds: [form.correctOptionIds[0] === 'B' ? 'B' : 'A'] };
  }
  return {
    ...base,
    ...snippet,
    type: form.kind === 'multi' ? 'multi' : 'single',
    format: 'choice',
    optionTexts: form.optionTexts,
    correctOptionIds: form.correctOptionIds,
  };
}

export const OPTION_LETTERS = LETTERS;
