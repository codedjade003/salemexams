const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatDateTime(value) {
  if (!value) return '—';
  try {
    return dateTimeFormat.format(new Date(value));
  } catch {
    return '—';
  }
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    return dateFormat.format(new Date(value));
  } catch {
    return '—';
  }
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return '—';
  const diffSeconds = Math.round((Number(value) - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return 'just now';
  if (abs < 45 * 60) return relativeFormat.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 22 * 3600) return relativeFormat.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 6 * 86400) return relativeFormat.format(Math.round(diffSeconds / 86400), 'day');
  return formatDate(value);
}

/** 1500 -> "25:00", 3725 -> "1:02:05" */
export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(hours ? 2 : 2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 1500 -> "25 min", 5400 -> "1 h 30 min" */
export function formatDuration(totalSeconds) {
  const minutes = Math.round((totalSeconds || 0) / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${numberFormat.format(number)}%`;
}

export function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? numberFormat.format(number) : '—';
}

export function contactLabel(user) {
  if (!user) return '—';
  return user.email || (user.username ? `@${user.username}` : '—');
}

export function initials(name) {
  return (
    String(name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('') || '?'
  );
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : plural}`;
}

export const VIOLATION_LABELS = {
  exam_reopened: 'Exam closed and reopened',
  tab_switch: 'Left the exam tab',
  window_blur: 'Window lost focus',
  fullscreen_exit: 'Exited full screen',
  right_click: 'Right-click',
  restricted_key: 'Blocked shortcut key',
};

export function violationLabel(type) {
  return VIOLATION_LABELS[type] ?? String(type ?? 'Unknown').replace(/_/g, ' ');
}

export const SESSION_STATUS_LABELS = {
  active: 'In progress',
  submitted: 'Submitted',
  time_up: 'Time up',
};

/** Badge tone for a score: strong (>= 70), fair (>= 40), weak. */
export function scoreTone(percent) {
  const value = Number(percent) || 0;
  if (value >= 70) return 'badge-success';
  if (value >= 40) return 'badge-brand';
  return 'badge-danger';
}

/** 3400 -> "3.4 seconds", 150000 -> "3 minutes" */
export function durationLabel(durationMs) {
  if (!Number.isFinite(durationMs)) return '';
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}
