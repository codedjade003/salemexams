// Client-side helpers that mirror server/questionModel.js for display and for the practice test
// (which is marked in the browser and never sent to the server).

export function isAnsweredLocal(question, response) {
  if (!question || !response) return false;
  if (question.type === 'code') {
    const code = String(response.code ?? '').trim();
    return Boolean(code) && code !== String(question.starterCode ?? '').trim();
  }
  if (question.type === 'flowchart') return Array.isArray(response) && response.some(Boolean);
  return Array.isArray(response) && response.length > 0;
}

export function questionHint(question) {
  if (!question) return '';
  if (question.type === 'order') return 'Put the steps in the right order.';
  if (question.type === 'flowchart') return 'Choose the right step for each empty shape. The shape tells you what kind of step fits.';
  if (question.type === 'code') return 'Write your program, then press Run to test it. Your work is saved as you type.';
  if (question.type === 'multi') return 'Select all that apply. More than one answer is correct.';
  return 'Choose one answer.';
}

export function flattenNodes(nodes) {
  const flat = [];
  for (const node of nodes ?? []) {
    flat.push(node);
    if (node.shape === 'decision') flat.push(...(node.yes ?? []), ...(node.no ?? []));
  }
  return flat;
}

// ----------------------------------------------------------------- practice test

// Three ungraded questions that let students try the unusual question types before the timer
// starts. `answer` holds what the browser needs to mark them.
export const PRACTICE_QUESTIONS = [
  {
    id: 'PRACTICE-1',
    type: 'order',
    text: 'Practice: put the steps for brushing your teeth in the right order.',
    items: [
      { id: 'A', text: 'Brush all your teeth' },
      { id: 'B', text: 'Put toothpaste on the toothbrush' },
      { id: 'C', text: 'Rinse your mouth' },
    ],
    answer: { order: ['B', 'A', 'C'] },
    explanation: 'Toothpaste goes on the brush first, then you brush, then you rinse.',
  },
  {
    id: 'PRACTICE-2',
    type: 'flowchart',
    text: 'Practice: complete the flowchart for a program that says hello to the user.',
    flowchart: {
      nodes: [
        { id: 'N1', shape: 'terminal', text: 'Start' },
        { id: 'N2', shape: 'io', blank: true, slot: 0 },
        { id: 'N3', shape: 'io', blank: true, slot: 1 },
        { id: 'N4', shape: 'terminal', text: 'Stop' },
      ],
    },
    pool: [
      { id: 'P1', text: 'Print "Hello", name' },
      { id: 'P2', text: 'Input name' },
    ],
    answer: { slots: ['Input name', 'Print "Hello", name'] },
    explanation: 'The program must ask for the name before it can print it.',
  },
  {
    id: 'PRACTICE-3',
    type: 'code',
    text: 'Practice: this program asks for your name and says hello. Press Run to see it work, then change "Hello" to "Welcome" and run it again.',
    starterCode: 'name = input("What is your name? ")\nprint("Hello", name)\n',
    codeSampleInput: 'Ada',
    tests: [{ input: 'Ada', expected: 'Welcome', match: 'contains' }],
    explanation: 'After your change, line 2 should be print("Welcome", name).',
  },
];

export function gradePracticeQuestion(question, response) {
  if (question.type === 'order') {
    return Array.isArray(response) && response.join() === question.answer.order.join();
  }
  if (question.type === 'flowchart') {
    const textById = new Map(question.pool.map((item) => [item.id, item.text]));
    return question.answer.slots.every((text, index) => textById.get(response?.[index]) === text);
  }
  if (question.type === 'code') {
    return Boolean(response?.checks) && response.checks.passed === response.checks.total;
  }
  return false;
}
