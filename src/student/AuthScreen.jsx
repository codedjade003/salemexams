import { ArrowLeft, BarChart3, LifeBuoy, LogIn, ShieldCheck, TimerReset, UserPlus } from 'lucide-react';

import { Alert, BrandLockup, Field, PasswordInput } from '../components/ui';

/** "aDA o'NEIL-smith" -> "Ada O'Neil-Smith" (same rule as the server). */
function toNameCase(value) {
  return value.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

/** A text box that writes names in name case as the student types, keeping the cursor in place. */
function NameInput({ id, value, onChange, ...rest }) {
  return (
    <input
      id={id}
      className="input"
      autoCapitalize="words"
      spellCheck={false}
      value={value}
      onChange={(event) => {
        const input = event.target;
        const { selectionStart, selectionEnd } = input;
        onChange(toNameCase(input.value.replace(/\s{2,}/g, ' ')));
        requestAnimationFrame(() => {
          if (document.activeElement === input) input.setSelectionRange(selectionStart, selectionEnd);
        });
      }}
      {...rest}
    />
  );
}

function ClassSelect({ id, value, onChange, classOptions }) {
  return (
    <select id={id} className="select" required value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select your class</option>
      {classOptions.map((classOption) => (
        <option key={classOption} value={classOption}>
          {classOption}
        </option>
      ))}
    </select>
  );
}

function UsernameInput({ id, value, onChange, autoComplete = 'username' }) {
  return (
    <input
      id={id}
      className="input"
      required
      minLength={3}
      maxLength={32}
      autoComplete={autoComplete}
      autoCapitalize="none"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
    />
  );
}

function AuthHero({ branding }) {
  return (
    <aside className="auth-hero">
      <BrandLockup branding={branding} />
      <div className="auth-hero-copy">
        <span className="eyebrow">Student portal</span>
        <h1>Sit your exams with confidence.</h1>
        <p>Sign in to take your computer-based tests, track your attempts and review your results.</p>
      </div>
      <ul className="auth-features">
        <li>
          <span className="feature-icon">
            <TimerReset aria-hidden="true" />
          </span>
          <div>
            <strong>Every answer saved as you go</strong>
            <span>Lost connection or closed the tab? Sign back in and pick up where you left off.</span>
          </div>
        </li>
        <li>
          <span className="feature-icon">
            <BarChart3 aria-hidden="true" />
          </span>
          <div>
            <strong>Results and corrections</strong>
            <span>See your score right away, then corrections with explanations once they are released.</span>
          </div>
        </li>
        <li>
          <span className="feature-icon">
            <ShieldCheck aria-hidden="true" />
          </span>
          <div>
            <strong>Fair for everyone</strong>
            <span>Questions are shuffled for each student and the exam is supervised.</span>
          </div>
        </li>
      </ul>
    </aside>
  );
}

export default function AuthScreen({
  meta,
  authMode,
  setAuthMode,
  loginForm,
  setLoginForm,
  onLogin,
  isLoggingIn,
  registerForm,
  setRegisterForm,
  onRegister,
  isRegistering,
  helpForm,
  setHelpForm,
  onSendHelp,
  isSendingHelp,
  errorMessage,
}) {
  const classOptions = meta?.classOptions ?? [];
  const branding = meta?.branding ?? { schoolName: meta?.schoolName };
  const startingPassword = meta?.defaultStudentPassword ?? 'salem';
  const setRegister = (patch) => setRegisterForm((prev) => ({ ...prev, ...patch }));
  const setHelp = (patch) => setHelpForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="auth-layout">
      <AuthHero branding={branding} />

      <main className="auth-panel">
        <div className="auth-card">
          {authMode === 'help' ? (
            <>
              <button type="button" className="link-button row" style={{ marginBottom: '1.25rem' }} onClick={() => setAuthMode('login')}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
              </button>
              <h2>Forgot your password?</h2>
              <p className="lede">Send a request to your teacher. They will reset your password to “{startingPassword}” so you can sign in and choose a new one.</p>
              <form className="stack" onSubmit={onSendHelp}>
                <div className="form-grid">
                  <Field label="First name" htmlFor="helpFirstName">
                    <NameInput id="helpFirstName" required value={helpForm.firstName} onChange={(firstName) => setHelp({ firstName })} />
                  </Field>
                  <Field label="Last name" htmlFor="helpLastName">
                    <NameInput id="helpLastName" required value={helpForm.lastName} onChange={(lastName) => setHelp({ lastName })} />
                  </Field>
                </div>
                <Field label="Class" htmlFor="helpClass">
                  <ClassSelect id="helpClass" value={helpForm.classRoom} classOptions={classOptions} onChange={(classRoom) => setHelp({ classRoom })} />
                </Field>
                <Field label="Username" htmlFor="helpUsername" hint="The username you signed up with. If you forgot it, type your best guess.">
                  <UsernameInput id="helpUsername" value={helpForm.username} onChange={(username) => setHelp({ username })} />
                </Field>
                <Field label="Message" optional htmlFor="helpMessage">
                  <textarea
                    id="helpMessage"
                    className="textarea"
                    rows={2}
                    maxLength={500}
                    placeholder="Anything your teacher should know"
                    value={helpForm.message}
                    onChange={(event) => setHelp({ message: event.target.value })}
                  />
                </Field>
                {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
                <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isSendingHelp}>
                  <LifeBuoy aria-hidden="true" />
                  {isSendingHelp ? 'Sending request…' : 'Send request'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="lede">
                {authMode === 'login' ? 'Sign in with your username and password.' : 'Sign up once, then sign in for every exam.'}
              </p>

              <div className="segmented" role="tablist" aria-label="Sign in or register">
                <button type="button" role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>
                  Sign in
                </button>
                <button type="button" role="tab" aria-selected={authMode === 'register'} onClick={() => setAuthMode('register')}>
                  Register
                </button>
              </div>

              {authMode === 'login' ? (
                <form className="stack" onSubmit={onLogin}>
                  <Field label="Username" htmlFor="identifier">
                    <input
                      id="identifier"
                      className="input"
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={loginForm.identifier}
                      onChange={(event) => setLoginForm((prev) => ({ ...prev, identifier: event.target.value }))}
                    />
                  </Field>
                  <Field label="Password" htmlFor="password" hint={`First time, or after a reset? Your password is “${startingPassword}”.`}>
                    <PasswordInput
                      id="password"
                      required
                      value={loginForm.password}
                      onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                    />
                  </Field>
                  <div className="row-between">
                    <span />
                    <button type="button" className="link-button small" onClick={() => setAuthMode('help')}>
                      Forgot password?
                    </button>
                  </div>
                  {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
                  <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isLoggingIn}>
                    <LogIn aria-hidden="true" />
                    {isLoggingIn ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              ) : (
                <form className="stack" onSubmit={onRegister}>
                  <Field label="First name" htmlFor="registerFirstName" hint="What everyone calls you, so they don’t mix it up.">
                    <NameInput
                      id="registerFirstName"
                      required
                      minLength={2}
                      autoComplete="given-name"
                      value={registerForm.firstName}
                      onChange={(firstName) => setRegister({ firstName })}
                    />
                  </Field>
                  <Field label="Last name" htmlFor="registerLastName" hint="Your family name.">
                    <NameInput
                      id="registerLastName"
                      required
                      minLength={2}
                      autoComplete="family-name"
                      value={registerForm.lastName}
                      onChange={(lastName) => setRegister({ lastName })}
                    />
                  </Field>
                  <Field label="Middle name" optional htmlFor="registerMiddleName" hint="Write it in full, no abbreviations.">
                    <NameInput
                      id="registerMiddleName"
                      autoComplete="additional-name"
                      value={registerForm.middleName}
                      onChange={(middleName) => setRegister({ middleName })}
                    />
                  </Field>
                  <Field label="Class" htmlFor="registerClassRoom">
                    <ClassSelect
                      id="registerClassRoom"
                      value={registerForm.classRoom}
                      classOptions={classOptions}
                      onChange={(classRoom) => setRegister({ classRoom })}
                    />
                  </Field>
                  <Field
                    label="Username"
                    htmlFor="registerUsername"
                    hint="A nickname you will remember, with no spaces. You sign in with it every time."
                  >
                    <UsernameInput id="registerUsername" value={registerForm.username} onChange={(username) => setRegister({ username })} />
                  </Field>
                  <Alert tone="info">
                    Your starting password is <strong>{startingPassword}</strong>. You will choose your own password on the next screen.
                  </Alert>
                  {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
                  <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isRegistering}>
                    <UserPlus aria-hidden="true" />
                    {isRegistering ? 'Creating account…' : 'Create account'}
                  </button>
                </form>
              )}

              <p className="auth-footer">
                Teacher or administrator? <a href="/admin">Open the admin dashboard</a>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
