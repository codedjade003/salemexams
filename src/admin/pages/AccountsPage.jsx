import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, KeyRound, LifeBuoy, Pencil, UsersRound, Wand2 } from 'lucide-react';

import { fetchAdminUsers, resetAdminUserPassword, updateAdminUser } from '../../api';
import { Alert, EmptyState, Field, Modal, Pagination, Switch } from '../../components/ui';
import { contactLabel, formatPercent, formatRelative, scoreTone } from '../../lib/format';
import { useDebouncedValue, usePagination } from '../../lib/hooks';
import { useAdmin, useAdminQuery } from '../context';
import { ClassFilter, FilterSelect, PageHeader, SearchInput } from '../parts';

function generatePassword() {
  // Easy to read aloud or copy onto paper: no 0/O, 1/l/I.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function EditUserModal({ user, onClose, onSaved }) {
  const { call, notify, classOptions } = useAdmin();
  const nameWords = String(user.fullName ?? '').split(' ');
  const [form, setForm] = useState({
    firstName: user.firstName || nameWords[0] || '',
    middleName: user.firstName ? user.middleName ?? '' : nameWords.slice(1, -1).join(' '),
    lastName: user.lastName || (nameWords.length > 1 ? nameWords.at(-1) : ''),
    classRoom: user.classRoom ?? '',
    email: user.email ?? '',
    username: user.username ?? '',
    mustChangePassword: Boolean(user.mustChangePassword),
    disabled: Boolean(user.disabled),
  });
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await call((token) => updateAdminUser(token, user.id, form), 'Could not save the account.');
    setSaving(false);
    if (result) {
      notify.info(`${result.user?.fullName ?? 'Account'} updated.`);
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit student account"
      subtitle="Past results keep the name and class they were taken under."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-user-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-user-form" className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="First name" htmlFor="edit-firstName">
            <input
              id="edit-firstName"
              className="input"
              required
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
            />
          </Field>
          <Field label="Last name" htmlFor="edit-lastName">
            <input
              id="edit-lastName"
              className="input"
              required
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
            />
          </Field>
        </div>
        <Field label="Middle name" optional htmlFor="edit-middleName">
          <input
            id="edit-middleName"
            className="input"
            value={form.middleName}
            onChange={(event) => setForm((prev) => ({ ...prev, middleName: event.target.value }))}
          />
        </Field>
        <Field label="Class" htmlFor="edit-class">
          <select
            id="edit-class"
            className="select"
            value={form.classRoom}
            onChange={(event) => setForm((prev) => ({ ...prev, classRoom: event.target.value }))}
          >
            {!classOptions.includes(form.classRoom) ? <option value={form.classRoom}>{form.classRoom}</option> : null}
            {classOptions.map((classRoom) => (
              <option key={classRoom} value={classRoom}>
                {classRoom}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Email" optional htmlFor="edit-email">
            <input
              id="edit-email"
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </Field>
          <Field label="Username" optional htmlFor="edit-username">
            <input
              id="edit-username"
              className="input"
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
            />
          </Field>
        </div>
        <hr className="divider" />
        <Switch
          id="edit-must-change"
          checked={form.mustChangePassword}
          onChange={(value) => setForm((prev) => ({ ...prev, mustChangePassword: value }))}
          label="Ask the student to change their password at next sign-in"
        />
        <Switch
          id="edit-disabled"
          checked={form.disabled}
          onChange={(value) => setForm((prev) => ({ ...prev, disabled: value }))}
          label="Disable this account (signs the student out everywhere)"
        />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }) {
  const { call, notify, meta } = useAdmin();
  const startingPassword = meta?.defaultStudentPassword ?? 'salem';
  const [password, setPassword] = useState(startingPassword);
  const [mustChange, setMustChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await call(
      (token) => resetAdminUserPassword(token, user.id, { newPassword: password, mustChangePassword: mustChange }),
      'Could not reset the password.'
    );
    setSaving(false);
    if (result) {
      setDone(true);
      onSaved();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      notify.info('Password copied.');
    } catch {
      notify.error('Copy failed. Select the password and copy it manually.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password for ${user.fullName}`}
      subtitle={`Signs in with ${contactLabel(user)}`}
      footer={
        done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="reset-password-form" className="btn btn-primary" disabled={saving || password.length < 4}>
              {saving ? 'Resetting…' : 'Reset password'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="stack">
          <Alert tone="success" title="Password reset">
            Give the student this password. They have been signed out of all devices.
          </Alert>
          <div className="row-between" style={{ padding: '0.9rem 1rem', borderRadius: 10, background: 'var(--surface-2)' }}>
            <strong className="mono" style={{ fontSize: '1.2rem', letterSpacing: '0.05em' }}>
              {password}
            </strong>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              <Copy aria-hidden="true" /> Copy
            </button>
          </div>
        </div>
      ) : (
        <form id="reset-password-form" className="stack" onSubmit={submit}>
          <Field
            label="New password"
            htmlFor="reset-password"
            hint={`The starting password is “${startingPassword}”. Keep it, or type or generate a different one.`}
          >
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                id="reset-password"
                className="input mono"
                required
                minLength={4}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
                <Wand2 aria-hidden="true" /> Generate
              </button>
            </div>
          </Field>
          <Switch
            id="reset-must-change"
            checked={mustChange}
            onChange={setMustChange}
            label="Ask the student to choose a new password after signing in"
          />
        </form>
      )}
    </Modal>
  );
}

export default function AccountsPage() {
  const { call, notify, classOptions, pageParams } = useAdmin();
  const [search, setSearch] = useState(pageParams.search ?? '');
  const [classRoom, setClassRoom] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ search: debouncedSearch, classRoom, status }), [classRoom, debouncedSearch, status]);
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminUsers(token, filters), JSON.stringify(filters));
  const users = useMemo(() => data?.users ?? [], [data]);
  const pager = usePagination(users, 20, JSON.stringify(filters));

  const toggleDisabled = async (user) => {
    const result = await call((token) => updateAdminUser(token, user.id, { disabled: !user.disabled }), 'Could not update the account.');
    if (result) {
      notify.info(`${user.fullName} ${user.disabled ? 'enabled' : 'disabled'}.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Student accounts"
        description="Everyone who has registered. Edit details, reset passwords, or disable access."
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or username" />
        <ClassFilter value={classRoom} onChange={setClassRoom} classOptions={classOptions} />
        <FilterSelect value={status} onChange={setStatus} label="Account status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="must_change">Must change password</option>
        </FilterSelect>
      </div>

      <div className="card card-flush">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className={`table ${loading ? 'is-loading' : ''}`}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Status</th>
                <th className="col-num">Attempts</th>
                <th className="col-num">Best</th>
                <th>Last sign-in</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="cell-primary">{user.fullName}</span>
                    <span className="cell-sub">{contactLabel(user)}</span>
                  </td>
                  <td>{user.classRoom}</td>
                  <td>
                    <div className="row" style={{ gap: '0.3rem' }}>
                      {user.disabled ? (
                        <span className="badge badge-danger">
                          <Ban aria-hidden="true" /> Disabled
                        </span>
                      ) : (
                        <span className="badge badge-success">
                          <CheckCircle2 aria-hidden="true" /> Active
                        </span>
                      )}
                      {user.mustChangePassword ? <span className="badge badge-warning">New password due</span> : null}
                      {user.openHelpRequests ? (
                        <span className="badge badge-gold">
                          <LifeBuoy aria-hidden="true" /> Needs help
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="col-num">
                    {user.submittedTrials}/{user.totalTrials}
                  </td>
                  <td className="col-num">
                    {user.submittedTrials ? (
                      <span className={`badge ${scoreTone(user.bestFinalPercent)}`}>{formatPercent(user.bestFinalPercent)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="small muted">{user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}</td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setResetting(user)}>
                        <KeyRound aria-hidden="true" /> Reset password
                      </button>
                      <button type="button" className="btn btn-sm btn-icon" onClick={() => setEditing(user)} aria-label="Edit" title="Edit">
                        <Pencil />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm btn-icon ${user.disabled ? '' : 'btn-danger-soft'}`}
                        onClick={() => void toggleDisabled(user)}
                        aria-label={user.disabled ? 'Enable account' : 'Disable account'}
                        title={user.disabled ? 'Enable account' : 'Disable account'}
                      >
                        {user.disabled ? <CheckCircle2 /> : <Ban />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <EmptyState icon={UsersRound} title={loading ? 'Loading accounts…' : 'No accounts found'} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination pager={pager} label="accounts" />

      {editing ? <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
      {resetting ? <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onSaved={reload} /> : null}
    </>
  );
}
