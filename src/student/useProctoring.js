import { useEffect, useRef } from 'react';

const SETTLE_MS = 1000; // ignore focus changes while the page is still entering full screen
const SPURIOUS_MS = 300; // focus flickers shorter than this are not reported at all
const FULLSCREEN_DEBOUNCE_MS = 700;
const REPEAT_GUARD_MS = 2000;

function seconds(durationMs) {
  const value = durationMs / 1000;
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`;
}

/**
 * Watches for the things an exam supervisor would notice, and reports each *incident* once.
 *
 * Leaving the exam is one incident however the browser reports it: switching tabs fires a blur,
 * a visibility change and often a full-screen exit, which used to count as three violations.
 * The incident is reported when the student comes back, with how long they were away, so a
 * teacher reviewing a dispute can tell a half-second slip from two minutes in another tab.
 *
 * `onViolation({ type, detail, evidence })` is called for: tab_switch, window_blur,
 * fullscreen_exit, right_click and restricted_key. The same hook drives the practice counter in
 * the pre-exam setup and the real exam.
 */
export function useProctoring({ active, onViolation }) {
  const handlerRef = useRef(onViolation);

  useEffect(() => {
    handlerRef.current = onViolation;
  });

  useEffect(() => {
    if (!active) return undefined;

    const activatedAt = Date.now();
    let away = null; // { startedAt, causes: Set }
    let lastReturnAt = 0;
    let fullscreenTimer = null;
    const lastReported = new Map();

    const report = (type, detail, evidence = {}) => {
      const now = Date.now();
      if (now - (lastReported.get(type) ?? 0) < REPEAT_GUARD_MS && type !== 'tab_switch' && type !== 'window_blur') return;
      lastReported.set(type, now);
      handlerRef.current?.({ type, detail, evidence });
    };

    const isAwayNow = () => document.hidden || !document.hasFocus();

    const beginAway = (cause) => {
      if (Date.now() - activatedAt < SETTLE_MS) return;
      if (!away) away = { startedAt: Date.now(), causes: new Set() };
      away.causes.add(cause);
    };

    const endAway = () => {
      if (!away || isAwayNow()) return;
      const incident = away;
      away = null;
      const endedAt = Date.now();
      lastReturnAt = endedAt;
      const durationMs = endedAt - incident.startedAt;
      if (durationMs < SPURIOUS_MS) return;
      const type = incident.causes.has('tab_switch') ? 'tab_switch' : 'window_blur';
      report(type, `${type === 'tab_switch' ? 'Left the exam tab' : 'Exam window lost focus'} for ${seconds(durationMs)}`, {
        durationMs,
        startedAt: incident.startedAt,
        endedAt,
        causes: [...incident.causes],
      });
    };

    const onVisibility = () => {
      if (document.hidden) beginAway('tab_switch');
      else setTimeout(endAway, 60);
    };
    const onBlur = () => beginAway('window_blur');
    const onFocus = () => setTimeout(endAway, 60);

    const onFullscreen = () => {
      if (document.fullscreenElement) return;
      if (away) {
        // Part of leaving the exam: one incident, not two.
        away.causes.add('fullscreen_exit');
        return;
      }
      clearTimeout(fullscreenTimer);
      fullscreenTimer = setTimeout(() => {
        if (document.fullscreenElement) return;
        if (away) {
          away.causes.add('fullscreen_exit');
          return;
        }
        if (Date.now() - lastReturnAt < 1500) return; // just came back from a reported absence
        report('fullscreen_exit', 'Left full screen', { causes: ['fullscreen_exit'] });
      }, FULLSCREEN_DEBOUNCE_MS);
    };

    const onContextMenu = (event) => {
      event.preventDefault();
      report('right_click', 'Right-click is blocked during the exam');
    };

    const onKeyDown = (event) => {
      const key = String(event.key ?? '').toLowerCase();
      const control = event.ctrlKey || event.metaKey;
      const inEditor = Boolean(event.target?.closest?.('[data-allow-clipboard]'));
      // Inside the exam's own code editor, select-all/copy/cut/paste work (paste is limited to
      // text copied from the editor itself).
      if (inEditor && control && ['a', 'c', 'x', 'v', 'z', 'y'].includes(key)) return;
      const blocked =
        key === 'f12' ||
        key === 'printscreen' ||
        (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (control && ['u', 's', 'c', 'v', 'x', 'p'].includes(key));
      if (!blocked) return;
      event.preventDefault();
      report('restricted_key', `Blocked shortcut: ${control ? 'Ctrl+' : ''}${event.key}`);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(fullscreenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}
