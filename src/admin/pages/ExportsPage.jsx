import { useState } from 'react';
import { FileJson, FileSpreadsheet, FileQuestion } from 'lucide-react';

import { downloadAdminExport } from '../../api';
import { useAdmin } from '../context';
import { PageHeader } from '../parts';

const EXPORTS = [
  {
    title: 'Results',
    description: 'One row per attempt: student, class, exam, score, penalties, violations and feedback.',
    icon: FileSpreadsheet,
    files: [
      { label: 'CSV (Excel)', path: '/api/admin/export/sessions.csv', name: 'salem-results.csv' },
      { label: 'JSON', path: '/api/admin/export/sessions.json', name: 'salem-results.json' },
    ],
  },
  {
    title: 'Question bank',
    description: 'Every question with its options and answer key. Useful as a backup.',
    icon: FileQuestion,
    files: [
      { label: 'CSV (Excel)', path: '/api/admin/export/questions.csv', name: 'salem-questions.csv' },
      { label: 'JSON', path: '/api/admin/export/questions.json', name: 'salem-questions.json' },
    ],
  },
];

export default function ExportsPage() {
  const { call, notify } = useAdmin();
  const [busy, setBusy] = useState('');

  const download = async (file) => {
    setBusy(file.path);
    const ok = await call((token) => downloadAdminExport(token, file.path, file.name).then(() => true), 'Export failed.');
    setBusy('');
    if (ok) notify.info(`${file.name} downloaded.`);
  };

  return (
    <>
      <PageHeader title="Exports" description="Download your data. Files are generated fresh each time." />
      <div className="grid-2">
        {EXPORTS.map(({ title, description, icon: Icon, files }) => (
          <article key={title} className="card export-card">
            <span className="export-icon">
              <Icon aria-hidden="true" />
            </span>
            <div>
              <h2>{title}</h2>
              <p className="muted small" style={{ marginTop: '0.3rem' }}>
                {description}
              </p>
            </div>
            <div className="row">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`btn btn-sm ${file.label.startsWith('CSV') ? 'btn-primary' : ''}`}
                  onClick={() => void download(file)}
                  disabled={busy === file.path}
                >
                  {file.label.startsWith('JSON') ? <FileJson aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
                  {busy === file.path ? 'Preparing…' : file.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
