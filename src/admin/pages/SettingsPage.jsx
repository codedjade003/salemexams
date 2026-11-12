import { useState } from 'react';

import { fetchAdminBrandingSettings, updateAdminBrandingSettings } from '../../api';
import { BrandLockup, Field } from '../../components/ui';
import { useAdmin, useAdminQuery } from '../context';
import { CardSection, PageHeader } from '../parts';

export default function SettingsPage() {
  const { data } = useAdminQuery((token) => fetchAdminBrandingSettings(token));
  // Remount the form once the saved settings arrive so it starts from them.
  return <BrandingSettings key={data ? 'loaded' : 'loading'} initial={data?.branding} loading={!data} />;
}

function BrandingSettings({ initial, loading }) {
  const { call, notify, reloadMeta } = useAdmin();
  const [form, setForm] = useState({ schoolName: initial?.schoolName ?? '', logoUrl: initial?.logoUrl ?? '' });
  const [saving, setSaving] = useState(false);

  const logoLooksValid = !form.logoUrl || /^https:\/\//i.test(form.logoUrl.trim());

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await call((token) => updateAdminBrandingSettings(token, form), 'Could not save settings.');
    setSaving(false);
    if (result) {
      notify.info('Branding saved.');
      void reloadMeta();
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="How the school appears to students and on report cards." />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <CardSection title="School branding" subtitle="Shown in the portal header and on every report card.">
          <form className="stack" onSubmit={submit}>
            <Field label="School name" htmlFor="school-name">
              <input
                id="school-name"
                className="input"
                required
                maxLength={120}
                value={form.schoolName}
                disabled={loading}
                onChange={(event) => setForm((previous) => ({ ...previous, schoolName: event.target.value }))}
              />
            </Field>
            <Field
              label="Logo URL"
              optional
              htmlFor="logo-url"
              hint="A square image on an https:// address. Leave empty to show the school initials."
              error={logoLooksValid ? '' : 'Use a full https:// address so the logo also appears on downloaded report cards.'}
            >
              <input
                id="logo-url"
                className="input"
                type="url"
                maxLength={500}
                placeholder="https://"
                value={form.logoUrl}
                onChange={(event) => setForm((previous) => ({ ...previous, logoUrl: event.target.value }))}
              />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save branding'}
              </button>
            </div>
          </form>
        </CardSection>

        <CardSection title="Preview" subtitle="How the header will look.">
          <div className="logo-preview">
            <BrandLockup branding={form} subtitle="Computer-Based Testing" />
          </div>
        </CardSection>
      </div>
    </>
  );
}
