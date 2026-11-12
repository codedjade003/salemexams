import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Shared admin state: { token, meta, call, notify, confirm, navigate, pageParams, refreshKey,
 * refreshHelpCount }. `call(fn, fallbackMessage)` runs `fn(token)`, shows errors as toasts,
 * signs out on 401, and resolves to `undefined` on failure.
 */
export const AdminContext = createContext(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error('useAdmin must be used inside the admin dashboard.');
  }
  return value;
}

/**
 * Loads data with `loader(token)` and reloads when `key` changes or the global refresh button
 * is pressed. While reloading, the previous data stays on screen (no layout jump).
 */
export function useAdminQuery(loader, key = '') {
  const { call, refreshKey } = useAdmin();
  const loaderRef = useRef(loader);
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${key}|${refreshKey}|${reloadKey}`;
  const [state, setState] = useState({ data: null, settledKey: null, loadedOnce: false });

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let alive = true;
    call((token) => loaderRef.current(token)).then((result) => {
      if (!alive) return;
      setState((previous) => ({
        data: result === undefined ? previous.data : result,
        settledKey: requestKey,
        loadedOnce: true,
      }));
    });
    return () => {
      alive = false;
    };
  }, [call, requestKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  return {
    data: state.data,
    loadedOnce: state.loadedOnce,
    // Loading until the response for the current request arrives.
    loading: state.settledKey !== requestKey,
    reload,
  };
}
