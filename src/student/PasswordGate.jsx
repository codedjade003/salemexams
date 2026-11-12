import { useState } from 'react';
import { KeyRound } from 'lucide-react';

import { Alert, Field, PasswordInput } from '../components/ui';
import { StudentTopbar } from './shared';

/** Shown once after sign-up or a teacher reset: the student replaces the starting password. */
export default function PasswordGate({ branding, user, startingPassword, onSave, isSaving, errorMessage, onLogout }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  return (
    <div className="student-app">
      <StudentTopbar branding={branding} user={user} onLogout={onLogout} />
      <main className="page" style={{ maxWidth: 520 }}>
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(newPassword, confirmPassword);
          }}
        >
          <div className="card-body stack">
            <span className="confirm-icon" aria-hidden="true">
              <KeyRound />
            </span>
            <div>
              <h1 style={{ fontSize: '1.4rem' }}>Choose your own password</h1>
              <p className="muted" style={{ marginTop: '0.35rem' }}>
                Hi {user?.firstName || user?.fullName?.split(' ')[0]}. Your account started with the password “{startingPassword}”.
                Pick a new one that only you know. You will use it with your username <strong>{user?.username}</strong> every time
                you sign in.
              </p>
            </div>
            <Field label="New password" htmlFor="gate-new" hint="At least 4 characters. Choose something you will remember.">
              <PasswordInput
                id="gate-new"
                required
                minLength={4}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Type it again" htmlFor="gate-confirm">
              <PasswordInput
                id="gate-confirm"
                required
                minLength={4}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save and continue'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
