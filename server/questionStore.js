import { DEFAULT_QUESTION_BANK } from './questions.js';
import { getCollection } from './db.js';

const COLLECTION_NAME = 'questions';
let initialized = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeExamId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractNumericId(questionId) {
  const match = /^Q(\d+)$/i.exec(questionId ?? '');
  return match ? Number(match[1]) : 0;
}

async function getNextQuestionId(collection) {
  const all = await collection.find({}, { projection: { id: 1 } }).toArray();
  const maxId = all.reduce((max, item) => {
    const parsed = extractNumericId(item.id);
    return parsed > max ? parsed : max;
  }, 0);

  return `Q${String(maxId + 1).padStart(3, '0')}`;
}

function sanitizeOptionTexts(optionTexts) {
  if (!Array.isArray(optionTexts)) {
    return [];
  }

  return optionTexts.slice(0, 4).map((text) => normalizeText(text));
}

function sanitizeCorrectOptionIds(correctOptionIds) {
  if (!Array.isArray(correctOptionIds)) {
    return [];
  }

  const validIds = new Set(['A', 'B', 'C', 'D']);
  return [...new Set(correctOptionIds.map((id) => String(id).toUpperCase()))].filter((id) =>
    validIds.has(id)
  );
}

function validateQuestion(question, generatedId = '') {
  if (!question || typeof question !== 'object') {
    throw new Error('Invalid question payload.');
  }

  const text = normalizeText(question.text);
  if (text.length < 5) {
    throw new Error('Question text must be at least 5 characters.');
  }

  const type = normalizeText(question.type).toLowerCase();
  if (!['single', 'multi'].includes(type)) {
    throw new Error('Question type must be single or multi.');
  }

  const topic = normalizeText(question.topic).toLowerCase() || 'general';

  const optionTexts = sanitizeOptionTexts(
    question.optionTexts ?? question.options?.map((option) => option?.text)
  );
  if (optionTexts.length !== 4 || optionTexts.some((item) => item.length < 1)) {
    throw new Error('Question must have 4 options.');
  }

  const options = optionTexts.map((textValue, index) => ({
    id: ['A', 'B', 'C', 'D'][index],
    text: textValue,
  }));

  const correctOptionIds = sanitizeCorrectOptionIds(question.correctOptionIds);
  if (correctOptionIds.length < 1) {
    throw new Error('Select at least one correct option.');
  }

  if (type === 'single' && correctOptionIds.length !== 1) {
    throw new Error('Single-choice question must have exactly one correct option.');
  }

  const id = normalizeText(question.id) || generatedId;
  if (!/^Q\d{3,}$/i.test(id)) {
    throw new Error('Question ID must look like Q001.');
  }

  const sourceExamId = normalizeExamId(question.sourceExamId) || 'general';

  return {
    id: id.toUpperCase(),
    topic,
    type,
    text,
    options,
    correctOptionIds,
    sourceExamId,
  };
}

function stripMongoId(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id: _ignoredId, ...rest } = value;
  return rest;
}

async function ensureInitialized() {
  if (initialized) {
    return;
  }

  const collection = await getCollection(COLLECTION_NAME);
  await collection.createIndex({ id: 1 }, { unique: true, name: 'idx_question_id' });
  await collection.createIndex({ sourceExamId: 1 }, { name: 'idx_question_source_exam_id' });

  const count = await collection.estimatedDocumentCount();
  if (count === 0) {
    const defaults = DEFAULT_QUESTION_BANK.map((item) =>
      validateQuestion({ ...item, sourceExamId: item.sourceExamId ?? 'general' }, item.id)
    );

    if (defaults.length > 0) {
      await collection.insertMany(defaults);
    }
  }

  initialized = true;
}

export async function getQuestionPool() {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const questions = await collection.find({}).toArray();
  return questions.map((item) => clone(stripMongoId(item)));
}

export async function getQuestionByIdMap() {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);
  const questions = await collection.find({}).toArray();
  return new Map(questions.map((question) => [question.id, clone(stripMongoId(question))]));
}

export async function addQuestion(payload) {
  await ensureInitialized();
  const collection = await getCollection(COLLECTION_NAME);

  const generatedId = normalizeText(payload?.id) || (await getNextQuestionId(collection));
  const nextQuestion = validateQuestion(payload, generatedId);

  const existing = await collection.findOne({ id: nextQuestion.id });
  if (existing) {
    throw new Error('Question ID already exists.');
  }

  await collection.insertOne(nextQuestion);
  return clone(nextQuestion);
}

export async function replaceQuestionPool(nextQuestions) {
  await ensureInitialized();

  if (!Array.isArray(nextQuestions) || nextQuestions.length === 0) {
    throw new Error('Question pool cannot be empty.');
  }

  const sanitized = nextQuestions.map((question) => validateQuestion(question, question.id));
  const idSet = new Set(sanitized.map((question) => question.id));

  if (idSet.size !== sanitized.length) {
    throw new Error('Question IDs must be unique.');
  }

  const collection = await getCollection(COLLECTION_NAME);
  await collection.deleteMany({});
  await collection.insertMany(sanitized);

  return clone(sanitized);
}
