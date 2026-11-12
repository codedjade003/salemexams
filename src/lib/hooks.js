import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

/** Client-side pagination that resets to page 1 whenever `resetKey` changes. */
export function usePagination(rows, pageSize, resetKey = '') {
  const [page, setPage] = useState(1);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
  const totalPages = Math.max(1, Math.ceil(safeRows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    page: currentPage,
    totalPages,
    total: safeRows.length,
    start: safeRows.length ? start + 1 : 0,
    end: Math.min(start + pageSize, safeRows.length),
    rows: safeRows.slice(start, start + pageSize),
    setPage,
  };
}

/** Ticks every `intervalMs` while `enabled`, returning the current timestamp. */
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  return now;
}

/** Calls `handler` when Escape is pressed while `active`. */
export function useEscapeKey(active, handler) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') handlerRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/** Auto-dismissing message state: [message, setMessage]. */
export function useFlashMessage(timeoutMs = 3500) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return undefined;
    const id = setTimeout(() => setMessage(''), timeoutMs);
    return () => clearTimeout(id);
  }, [message, timeoutMs]);

  return [message, setMessage];
}

/**
 * Promise-based confirm dialog state. Render <ConfirmDialog {...dialogProps} /> once and call
 * `await confirm({ title, message, confirmLabel, tone })` anywhere.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setRequest({ ...options, resolve });
      }),
    []
  );

  const close = useCallback(
    (result) => {
      request?.resolve(result);
      setRequest(null);
    },
    [request]
  );

  return {
    confirm,
    dialogProps: {
      open: Boolean(request),
      title: request?.title,
      message: request?.message,
      confirmLabel: request?.confirmLabel,
      tone: request?.tone,
      onConfirm: () => close(true),
      onCancel: () => close(false),
    },
  };
}

export function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); nothing to do.
  }
}

export function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
