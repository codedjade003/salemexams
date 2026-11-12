// Keeps every answer safe until the server confirms it.
//
// An answer is written to this queue (and to localStorage) the moment the student gives it.
// The queue sends everything pending in one request, and keeps retrying with growing pauses
// while the connection is down. Because pending answers live in localStorage, they survive a
// refresh, a crashed tab, or being signed out: when the same exam is opened again on this
// computer they are sent before anything else.
import { saveAnswersBatch } from '../api';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from '../lib/hooks';

const STORAGE_PREFIX = 'salem_pending_answers:';
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

export function readStoredPending(sessionId) {
  try {
    const parsed = JSON.parse(safeStorageGet(`${STORAGE_PREFIX}${sessionId}`) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function clearStoredPending(sessionId) {
  safeStorageRemove(`${STORAGE_PREFIX}${sessionId}`);
}

export class AnswerQueue {
  /**
   * @param {object} options
   * @param {string} options.sessionId
   * @param {() => string} options.getToken
   * @param {(state: { pending: number, status: 'saved' | 'saving' | 'retrying' }) => void} options.onState
   * @param {(error: Error) => void} options.onFatal  Called for errors retrying cannot fix
   *   (exam already submitted, signed out). The queue stops; answers stay in localStorage.
   */
  constructor({ sessionId, getToken, onState, onFatal }) {
    this.sessionId = sessionId;
    this.getToken = getToken;
    this.onState = onState;
    this.onFatal = onFatal;
    this.pending = new Map(); // questionId -> { value, version }
    this.version = 0;
    this.inFlight = null;
    this.timer = null;
    this.failures = 0;
    this.stopped = false;

    for (const [questionId, value] of Object.entries(readStoredPending(sessionId))) {
      this.version += 1;
      this.pending.set(questionId, { value, version: this.version });
    }
  }

  /** Answers not yet confirmed by the server, as { questionId: answer }. */
  snapshot() {
    return Object.fromEntries([...this.pending].map(([questionId, entry]) => [questionId, entry.value]));
  }

  get size() {
    return this.pending.size;
  }

  persist() {
    if (this.pending.size) {
      safeStorageSet(`${STORAGE_PREFIX}${this.sessionId}`, JSON.stringify(this.snapshot()));
    } else {
      clearStoredPending(this.sessionId);
    }
  }

  emit(status) {
    this.onState?.({ pending: this.pending.size, status });
  }

  /** Records an answer and schedules a save. `delayMs` groups quick changes into one request. */
  set(questionId, value, delayMs = 250) {
    this.version += 1;
    this.pending.set(questionId, { value, version: this.version });
    this.persist();
    this.emit(this.failures ? 'retrying' : 'saving');
    this.schedule(delayMs);
  }

  schedule(delayMs) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  /** Sends everything pending. Resolves true when the queue is empty. Never rejects. */
  async flush() {
    if (this.stopped) return this.pending.size === 0;
    if (this.inFlight) return this.inFlight;
    if (!this.pending.size) {
      this.emit('saved');
      return true;
    }

    clearTimeout(this.timer);
    this.inFlight = this.send().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async send() {
    const batch = [...this.pending].map(([questionId, entry]) => ({ questionId, ...entry }));
    try {
      const reply = await saveAnswersBatch(
        this.getToken(),
        this.sessionId,
        Object.fromEntries(batch.map((entry) => [entry.questionId, entry.value]))
      );
      const settled = new Set([...(reply.applied ?? []), ...(reply.rejected ?? [])]);
      for (const entry of batch) {
        // Keep an answer that was changed again while this request was on its way.
        if (settled.has(entry.questionId) && this.pending.get(entry.questionId)?.version === entry.version) {
          this.pending.delete(entry.questionId);
        }
      }
      this.failures = 0;
      this.persist();
      if (this.pending.size) {
        this.emit('saving');
        this.schedule(100);
        return false;
      }
      this.emit('saved');
      return true;
    } catch (error) {
      const retryable = error?.isNetworkError || error?.status === 429 || error?.status >= 500 || error?.status === 0;
      if (!retryable) {
        // 401 (signed out) or 409 (exam over): retrying will not help. Answers stay stored.
        this.stopped = true;
        this.onFatal?.(error);
        return false;
      }
      this.failures += 1;
      this.emit('retrying');
      this.schedule(RETRY_DELAYS_MS[Math.min(this.failures - 1, RETRY_DELAYS_MS.length - 1)]);
      return false;
    }
  }

  /** Tries to empty the queue for up to `maxWaitMs`. Resolves true if everything was saved. */
  async drain(maxWaitMs) {
    const deadline = Date.now() + maxWaitMs;
    while (!this.stopped && this.pending.size && Date.now() < deadline) {
      if (await this.flush()) return true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return this.pending.size === 0;
  }

  /** Marks everything as saved (used after a submit that carried the pending answers). */
  clear() {
    this.pending.clear();
    this.persist();
    this.emit('saved');
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
