import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Info,
  Inbox,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';

import { useEscapeKey } from '../lib/hooks';
import { formatNumber, initials, SESSION_STATUS_LABELS } from '../lib/format';

/* ------------------------------------------------------------------ brand */

function isAbsoluteImage(url) {
  return /^(https?:\/\/|data:image\/)/i.test(String(url ?? '').trim());
}

export function BrandLogo({ branding, size = 40 }) {
  const [failedUrl, setFailedUrl] = useState('');
  const logoUrl = branding?.logoUrl;
  const showImage = isAbsoluteImage(logoUrl) && failedUrl !== logoUrl;

  return (
    <span className="brand-logo" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {showImage ? (
        <img src={logoUrl} alt="" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        initials(branding?.schoolName || 'Salem Academy')
      )}
    </span>
  );
}

export function BrandLockup({ branding, subtitle = 'Computer-Based Testing', href }) {
  const content = (
    <>
      <BrandLogo branding={branding} />
      <span className="truncate">
        <span className="brand-name">{branding?.schoolName || 'Salem Academy'}</span>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </span>
    </>
  );

  return href ? (
    <a className="brand-lockup" href={href}>
      {content}
    </a>
  ) : (
    <div className="brand-lockup">{content}</div>
  );
}

/* ------------------------------------------------------------------ feedback */

export function Spinner({ large = false, label }) {
  return (
    <span role="status" className="row" style={{ gap: '0.5rem' }}>
      <span className={`spinner ${large ? 'spinner-lg' : ''}`} aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function FullPageLoader({ label = 'Loading…' }) {
  return (
    <main className="center-page">
      <div className="stack" style={{ justifyItems: 'center' }}>
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p className="muted">{label}</p>
      </div>
    </main>
  );
}

export function Toasts({ info, error, onDismissInfo, onDismissError }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {info ? (
        <div className="toast is-info" role="status">
          <CheckCircle2 aria-hidden="true" />
          <span>{info}</span>
          {onDismissInfo ? (
            <button type="button" onClick={onDismissInfo} aria-label="Dismiss">
              <X />
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="toast is-error" role="alert">
          <XCircle aria-hidden="true" />
          <span>{error}</span>
          {onDismissError ? (
            <button type="button" onClick={onDismissError} aria-label="Dismiss">
              <X />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ALERT_ICONS = {
  info: Info,
  warning: AlertTriangle,
  danger: XCircle,
  success: CheckCircle2,
};

export function Alert({ tone = 'info', title, children, action }) {
  const Icon = ALERT_ICONS[tone] ?? Info;
  return (
    <div className={`alert ${tone !== 'info' ? `alert-${tone}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden="true" />
      <div className="grow stack" style={{ '--stack-gap': '0.2rem' }}>
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty-state">
      <span className="icon" aria-hidden="true">
        <Icon />
      </span>
      {title ? <h3>{title}</h3> : null}
      {children ? <p className="small">{children}</p> : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ data display */

export function StatCard({ label, value, meta, icon: Icon }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {Icon ? <Icon aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {meta ? <span className="stat-meta">{meta}</span> : null}
    </div>
  );
}

const STATUS_TONES = {
  active: { tone: 'badge-brand', icon: Loader2 },
  submitted: { tone: 'badge-success', icon: CheckCircle2 },
  time_up: { tone: 'badge-warning', icon: Clock },
};

export function SessionStatusBadge({ status }) {
  const config = STATUS_TONES[status] ?? { tone: '', icon: Info };
  const Icon = config.icon;
  return (
    <span className={`badge ${config.tone}`}>
      <Icon aria-hidden="true" />
      {SESSION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Pagination({ pager, label }) {
  if (!pager.total) return null;
  return (
    <div className="pagination">
      <span>
        Showing <strong className="num">{pager.start}</strong>–<strong className="num">{pager.end}</strong> of{' '}
        <strong className="num">{pager.total}</strong> {label}
      </span>
      {pager.totalPages > 1 ? (
        <div className="row">
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={() => pager.setPage(pager.page - 1)}
            disabled={pager.page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </button>
          <span className="num">
            Page {pager.page} of {pager.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={() => pager.setPage(pager.page + 1)}
            disabled={pager.page >= pager.totalPages}
            aria-label="Next page"
          >
            <ChevronRight />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Round axis: about four steps of 1, 2, 2.5 or 5 × 10^n (whole numbers only), e.g. 0–2,000 by 500. */
function niceScale(rawMax) {
  const roughStep = rawMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  const niceResidual = residual > 5 ? 10 : residual > 2.5 ? 5 : residual > 2 ? 2.5 : residual > 1 ? 2 : 1;
  const candidate = niceResidual * magnitude;
  // Counts can't be fractional: 0.25/0.5 become 1, and 2.5 becomes 5.
  const step = Number.isInteger(candidate) ? candidate : candidate < 1 ? 1 : 5;
  const maxValue = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let tick = 0; tick <= maxValue; tick += step) ticks.push(tick);
  return { maxValue, ticks };
}

/**
 * Single-series horizontal bar chart. Hover/focus shows the value; a table view keeps every
 * value reachable without hovering.
 */
export function BarChart({ data, valueLabel = 'Count', formatValue = formatNumber, labelWidth = 96, max }) {
  const [hovered, setHovered] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const chartId = useId();
  const { maxValue, ticks } = niceScale(Math.max(max ?? 0, ...data.map((item) => Number(item.value) || 0), 1));

  if (!data.length) {
    return <EmptyState title="No data yet">Results will appear here once students submit exams.</EmptyState>;
  }

  return (
    <div className="stack" style={{ '--stack-gap': '0.5rem' }}>
      <div className="row-between">
        <span className="hint" id={`${chartId}-desc`}>
          {valueLabel} by category
        </span>
        <button type="button" className="chart-toggle" onClick={() => setShowTable((value) => !value)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="col-num">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td className="col-num">{formatValue(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ '--bar-label-width': `${labelWidth}px`, '--grid-step': `${100 / Math.max(1, ticks.length - 1)}%` }}>
          <div className="bar-chart" role="list" aria-describedby={`${chartId}-desc`}>
            {data.map((item, index) => {
              const value = Number(item.value) || 0;
              const width = (value / maxValue) * 100;
              return (
                <div
                  key={item.label}
                  className="bar-row"
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${item.label}: ${formatValue(value)}`}
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                >
                  <span className="bar-label truncate" title={item.label}>
                    {item.label}
                  </span>
                  <span className="bar-track">
                    <span className="bar" style={{ width: `${Math.max(width, value > 0 ? 1 : 0)}%` }} />
                    <span className="bar-value">{formatValue(value)}</span>
                    {hovered === index ? (
                      <span className="chart-tooltip" style={{ '--tip-x': `${Math.min(Math.max(width, 12), 88)}%` }}>
                        <strong>{formatValue(value)}</strong>
                        <span>
                          {item.label}
                          {item.detail ? ` · ${item.detail}` : ''}
                        </span>
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="chart-axis-labels" aria-hidden="true">
            <span />
            <span className="ticks">
              {ticks.map((tick, index) => (
                <span key={`${tick}-${index}`}>{formatValue(tick)}</span>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, optional, hint, error, htmlFor, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label} {optional ? <span className="optional">(optional)</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete = 'current-password', ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-with-action">
      <input
        id={id}
        className="input"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled = false, id }) {
  return (
    <label className="switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" aria-hidden="true" />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({ open, onClose, title, subtitle, size = '', children, footer, labelledBy }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEscapeKey(open && Boolean(onClose), onClose);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const node = dialogRef.current;
    const focusable = node?.querySelector('[data-autofocus], input, select, textarea, button:not([data-close])');
    (focusable ?? node)?.focus?.();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${size ? `modal-${size}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        tabIndex={-1}
      >
        {title ? (
          <div className="modal-header">
            <div className="grow">
              <h2 id={titleId}>{title}</h2>
              {subtitle ? <p className="subtitle">{subtitle}</p> : null}
            </div>
            {onClose ? (
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} data-close aria-label="Close">
                <X />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'default', onConfirm, onCancel }) {
  const danger = tone === 'danger';
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy={titleId}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={`confirm-icon ${danger ? 'is-danger' : ''}`} aria-hidden="true">
        {danger ? <AlertTriangle /> : <Info />}
      </div>
      <h2 id={titleId} style={{ marginBottom: '0.4rem' }}>
        {title}
      </h2>
      {message ? <div className="muted">{message}</div> : null}
    </Modal>
  );
}
