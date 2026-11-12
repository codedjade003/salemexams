import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogIn,
  LogOut,
  Menu,
  MessageSquareWarning,
  RefreshCw,
  Settings,
  ShieldCheck,
  UsersRound,
  FileQuestion,
} from 'lucide-react';

import { adminLogin, adminLogout, fetchAdminDisputes, fetchAdminPasswordHelp, fetchMeta } from '../api';
import { Alert, BrandLockup, BrandLogo, ConfirmDialog, Field, PasswordInput, Toasts } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { safeStorageGet, safeStorageRemove, safeStorageSet, useConfirm, useFlashMessage } from '../lib/hooks';
import { AdminContext } from './context';
import AccountsPage from './pages/AccountsPage';
import AttemptsPage from './pages/AttemptsPage';
import DisputesPage from './pages/DisputesPage';
import ExamsPage from './pages/ExamsPage';
import ExportsPage from './pages/ExportsPage';
import HelpRequestsPage from './pages/HelpRequestsPage';
import OverviewPage from './pages/OverviewPage';
import QuestionsPage from './pages/QuestionsPage';
import SettingsPage from './pages/SettingsPage';
import StudentsPage from './pages/StudentsPage';

const ADMIN_TOKEN_KEY = 'salem_admin_token';
const ADMIN_TOKEN_EXPIRES_KEY = 'salem_admin_token_expires_at';

const NAV = [
  {
    group: 'Monitor',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, component: OverviewPage },
      { id: 'attempts', label: 'Attempts', icon: ListChecks, component: AttemptsPage },
      { id: 'students', label: 'Results by student', icon: GraduationCap, component: StudentsPage },
      { id: 'disputes', label: 'Violation disputes', icon: MessageSquareWarning, component: DisputesPage },
    ],
  },
  {
    group: 'People',
    items: [
      { id: 'accounts', label: 'Student accounts', icon: UsersRound, component: AccountsPage },
      { id: 'help', label: 'Password help', icon: LifeBuoy, component: HelpRequestsPage },
    ],
  },
  {
    group: 'Content',
    items: [
      { id: 'exams', label: 'Exams', icon: BookOpen, component: ExamsPage },
      { id: 'questions', label: 'Question bank', icon: FileQuestion, component: QuestionsPage },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'exports', label: 'Exports', icon: Download, component: ExportsPage },
      { id: 'settings', label: 'Settings', icon: Settings, component: SettingsPage },
    ],
  },
];

const PAGES = NAV.flatMap((group) => group.items);

function pageFromHash() {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES.some((page) => page.id === id) ? id : 'overview';
}

function AdminLogin({ branding, onLogin, isLoading, errorMessage }) {
  const [passcode, setPasscode] = useState('');
  return (
    <main className="admin-login">
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin(passcode).then((ok) => {
            if (ok) setPasscode('');
          });
        }}
      >
        <BrandLockup branding={branding} subtitle="Admin dashboard" />
        <h1>Sign in to manage exams</h1>
        <p className="muted" style={{ margin: '0.35rem 0 1.5rem' }}>
          Enter the admin passcode set for this school.
        </p>
        <div className="stack">
          <Field label="Admin passcode" htmlFor="adminPasscode">
            <PasswordInput
              id="adminPasscode"
              required
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isLoading}>
            <LogIn aria-hidden="true" />
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <p className="auth-footer">
          <a href="/">Go to the student portal</a>
        </p>
      </form>
    </main>
  );
}

export default function AdminApp() {
  const [meta, setMeta] = useState(null);
  const [token, setToken] = useState(() => {
    const saved = safeStorageGet(ADMIN_TOKEN_KEY) ?? '';
    const expiresAt = Number(safeStorageGet(ADMIN_TOKEN_EXPIRES_KEY) ?? '0');
    return saved && expiresAt > Date.now() ? saved : '';
  });
  const [tokenExpiresAt, setTokenExpiresAt] = useState(() => Number(safeStorageGet(ADMIN_TOKEN_EXPIRES_KEY) ?? '0'));
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [infoMessage, setInfoMessage] = useFlashMessage(3500);
  const [errorMessage, setErrorMessage] = useFlashMessage(7000);
  const [page, setPage] = useState(pageFromHash);
  const [pageParams, setPageParams] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [openHelpCount, setOpenHelpCount] = useState(0);
  const [openDisputeCount, setOpenDisputeCount] = useState(0);
  const { confirm, dialogProps } = useConfirm();

  const branding = useMemo(
    () => meta?.branding ?? { schoolName: meta?.schoolName ?? 'Salem Academy', logoUrl: '' },
    [meta]
  );

  useEffect(() => {
    document.title = `Admin · ${branding.schoolName || 'Salem Academy'}`;
  }, [branding.schoolName]);

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await fetchMeta());
    } catch {
      // The dashboard still works without metadata; class lists fall back to empty.
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const clearAuth = useCallback(() => {
    safeStorageRemove(ADMIN_TOKEN_KEY);
    safeStorageRemove(ADMIN_TOKEN_EXPIRES_KEY);
    setToken('');
    setTokenExpiresAt(0);
  }, []);

  useEffect(() => {
    if (!token || !tokenExpiresAt) return undefined;
    const timeoutMs = tokenExpiresAt - Date.now();
    const expire = () => {
      clearAuth();
      setLoginError('Your admin session expired. Please sign in again.');
    };
    if (timeoutMs <= 0) {
      expire();
      return undefined;
    }
    const id = setTimeout(expire, timeoutMs);
    return () => clearTimeout(id);
  }, [clearAuth, token, tokenExpiresAt]);

  const call = useCallback(
    async (fn, fallbackMessage = 'Something went wrong. Please try again.') => {
      try {
        return await fn(token);
      } catch (error) {
        if (error?.status === 401) {
          clearAuth();
          setLoginError('Your admin session expired. Please sign in again.');
          return undefined;
        }
        setErrorMessage(error?.message || fallbackMessage);
        return undefined;
      }
    },
    [clearAuth, setErrorMessage, token]
  );

  const refreshHelpCount = useCallback(async () => {
    if (!token) return;
    try {
      const [help, disputes] = await Promise.all([fetchAdminPasswordHelp(token, { status: 'open' }), fetchAdminDisputes(token, 'open')]);
      setOpenHelpCount(help.total ?? help.requests?.length ?? 0);
      setOpenDisputeCount(disputes.total ?? 0);
    } catch {
      // The badges are informational; ignore failures.
    }
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    void refreshHelpCount();
    const id = setInterval(() => void refreshHelpCount(), 60_000);
    return () => clearInterval(id);
  }, [refreshHelpCount, token]);

  const navigate = useCallback((pageId, params = {}) => {
    setPageParams(params);
    if (window.location.hash !== `#/${pageId}`) {
      window.location.hash = `/${pageId}`;
    } else {
      setPage(pageId);
    }
    window.scrollTo(0, 0);
  }, []);

  const handleLogin = async (passcode) => {
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const payload = await adminLogin(passcode);
      safeStorageSet(ADMIN_TOKEN_KEY, payload.token);
      safeStorageSet(ADMIN_TOKEN_EXPIRES_KEY, String(payload.expiresAt));
      setToken(payload.token);
      setTokenExpiresAt(payload.expiresAt);
      return true;
    } catch (error) {
      setLoginError(error.message || 'Sign-in failed.');
      return false;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    void adminLogout(token).catch(() => undefined);
    clearAuth();
    setLoginError('');
  };

  const contextValue = useMemo(
    () => ({
      token,
      meta,
      branding,
      classOptions: meta?.classOptions ?? [],
      call,
      notify: { info: setInfoMessage, error: setErrorMessage },
      confirm,
      navigate,
      pageParams,
      refreshKey,
      refreshHelpCount,
      refreshBadges: refreshHelpCount,
      reloadMeta: loadMeta,
    }),
    [branding, call, confirm, loadMeta, meta, navigate, pageParams, refreshHelpCount, refreshKey, setErrorMessage, setInfoMessage, token]
  );

  if (!token) {
    return <AdminLogin branding={branding} onLogin={handleLogin} isLoading={isLoggingIn} errorMessage={loginError} />;
  }

  const current = PAGES.find((item) => item.id === page) ?? PAGES[0];
  const PageComponent = current.component;

  return (
    <AdminContext.Provider value={contextValue}>
      <div className={`admin-shell ${navOpen ? 'nav-open' : ''}`}>
        <aside className="sidebar" aria-label="Admin navigation">
          <BrandLockup branding={branding} subtitle="Admin" href="#/overview" />
          {NAV.map((group) => (
            <nav key={group.group} className="nav-group" aria-label={group.group}>
              <span className="nav-group-label">{group.group}</span>
              {group.items.map(({ id, label, icon: Icon }) => (
                <a key={id} className="nav-item" href={`#/${id}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPageParams({})}>
                  <Icon aria-hidden="true" />
                  {label}
                  {id === 'help' && openHelpCount > 0 ? <span className="count-pill">{openHelpCount}</span> : null}
                  {id === 'disputes' && openDisputeCount > 0 ? <span className="count-pill">{openDisputeCount}</span> : null}
                </a>
              ))}
            </nav>
          ))}
          <div className="sidebar-footer">
            <a className="nav-item" href="/" target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Student portal
            </a>
            <button type="button" className="nav-item" onClick={handleLogout}>
              <LogOut aria-hidden="true" />
              Sign out
            </button>
            <span className="hint">
              <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden="true" /> Signed in
              until {formatDateTime(tokenExpiresAt)}
            </span>
          </div>
        </aside>
        <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

        <div className="admin-main">
          <header className="admin-topbar">
            <button type="button" className="btn btn-ghost btn-icon menu-button" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu />
            </button>
            <span className="row grow" style={{ gap: '0.5rem' }}>
              <BrandLogo branding={branding} size={28} />
              <strong>{current.label}</strong>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setRefreshKey((value) => value + 1);
                void refreshHelpCount();
              }}
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </button>
          </header>
          <main className="admin-content">
            <PageComponent key={current.id} />
          </main>
        </div>
      </div>
      <Toasts
        info={infoMessage}
        error={errorMessage}
        onDismissInfo={() => setInfoMessage('')}
        onDismissError={() => setErrorMessage('')}
      />
      <ConfirmDialog {...dialogProps} />
    </AdminContext.Provider>
  );
}
