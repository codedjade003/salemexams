import { useState } from 'react';
import { ExternalLink, FlaskConical, Trash2 } from 'lucide-react';

import { createAdminTestStudent, deleteAdminTestData, fetchAdminTestData } from '../../api';
import { Alert, Field } from '../../components/ui';
import { safeStorageSet } from '../../lib/hooks';
import { useAdmin, useAdminQuery } from '../context';
import { CardSection, PageHeader } from '../parts';

// The student portal reads its sign-in from these keys (same site, so admin can set them).
const STUDENT_TOKEN_KEY = 'salem_student_token';
const STUDENT_TOKEN_EXPIRES_KEY = 'salem_student_token_expires_at';

export default function TestModePage() {
  const { call, notify, confirm, classOptions } = useAdmin();
  const { data, reload } = useAdminQuery((token) => fetchAdminTestData(token));
  const [classRoom, setClassRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const chosenClass = classRoom || classOptions[0] || '';

  const open = async () => {
    setBusy(true);
    const result = await call((token) => createAdminTestStudent(token, chosenClass), 'Could not start test mode.');
    setBusy(false);
    if (!result) return;
    safeStorageSet(STUDENT_TOKEN_KEY, result.token);
    safeStorageSet(STUDENT_TOKEN_EXPIRES_KEY, String(result.expiresAt));
    window.open('/', '_blank', 'noopener');
    notify.info(`Student portal opened as a ${chosenClass} test student.`);
    reload();
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete all test data?',
      message: 'Every test student and their attempts will be removed. Real students are not affected.',
      confirmLabel: 'Delete test data',
      tone: 'danger',
    });
    if (!ok) return;
    const result = await call((token) => deleteAdminTestData(token), 'Could not delete test data.');
    if (result) {
      notify.info(`Deleted ${result.students} test student(s) and ${result.attempts} attempt(s).`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Test mode"
        description="Take an exam yourself, exactly as a student in a class would, without affecting any results."
      />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <CardSection title="Try the student portal" subtitle="Opens in a new tab, already signed in as a test student.">
          <div className="stack">
            <Field label="See what this class sees" htmlFor="test-class" hint="The exams, time limits and hints depend on the class.">
              <select id="test-class" className="select" value={chosenClass} onChange={(event) => setClassRoom(event.target.value)}>
                {classOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="btn btn-primary" onClick={() => void open()} disabled={busy || !chosenClass} style={{ justifySelf: 'start' }}>
              <ExternalLink aria-hidden="true" />
              {busy ? 'Opening…' : 'Open as a test student'}
            </button>
            <Alert tone="info">
              Test attempts are marked “Test” in Attempts and can be reviewed, printed and disputed like real ones, so you can check the
              whole workflow. They never appear on the leaderboard, in the overview numbers, in exports or in class printouts, and test
              students can retake an exam as many times as they like.
            </Alert>
          </div>
        </CardSection>

        <CardSection title="Clean up" subtitle="Remove everything created in test mode.">
          <div className="stack">
            <p>
              <FlaskConical size={16} style={{ display: 'inline', verticalAlign: '-3px' }} aria-hidden="true" />{' '}
              <strong>{data?.students ?? 0}</strong> test student(s) and <strong>{data?.attempts ?? 0}</strong> test attempt(s) exist.
            </p>
            <button
              type="button"
              className="btn btn-danger-soft"
              onClick={() => void remove()}
              disabled={!data || (!data.students && !data.attempts)}
              style={{ justifySelf: 'start' }}
            >
              <Trash2 aria-hidden="true" /> Delete all test data
            </button>
          </div>
        </CardSection>
      </div>
    </>
  );
}
