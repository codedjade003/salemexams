import { useMemo, useState } from 'react';
import { CheckCheck, LifeBuoy, UserSearch } from 'lucide-react';

import { fetchAdminPasswordHelp, resolveAdminPasswordHelp } from '../../api';
import { EmptyState, Pagination } from '../../components/ui';
import { contactLabel, formatDateTime, formatRelative } from '../../lib/format';
import { useDebouncedValue, usePagination } from '../../lib/hooks';
import { useAdmin, useAdminQuery } from '../context';
import { PageHeader, SearchInput } from '../parts';

export default function HelpRequestsPage() {
  const { call, notify, navigate, refreshHelpCount } = useAdmin();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ search: debouncedSearch, status }), [debouncedSearch, status]);
  const { data, loading, reload } = useAdminQuery((token) => fetchAdminPasswordHelp(token, filters), JSON.stringify(filters));
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const pager = usePagination(requests, 20, JSON.stringify(filters));

  const resolve = async (request) => {
    const result = await call((token) => resolveAdminPasswordHelp(token, request.id), 'Could not update the request.');
    if (result) {
      notify.info('Marked as resolved.');
      reload();
      void refreshHelpCount();
    }
  };

  return (
    <>
      <PageHeader
        title="Password help"
        description="Students who forgot their password. Find their account, reset the password, then mark the request resolved."
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, class or message" />
        <div className="segmented" role="tablist" aria-label="Request status">
          {[
            ['open', 'Open'],
            ['resolved', 'Resolved'],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card card-flush">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className={`table ${loading ? 'is-loading' : ''}`}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Message</th>
                <th>Requested</th>
                <th>Status</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((request) => (
                <tr key={request.id}>
                  <td>
                    <span className="cell-primary">{request.fullName}</span>
                    <span className="cell-sub">
                      {request.classRoom} · {contactLabel(request)}
                    </span>
                  </td>
                  <td style={{ maxWidth: 340 }}>
                    <span className="clamp-2 small">{request.message || <span className="muted">No message</span>}</span>
                  </td>
                  <td className="small" title={formatDateTime(request.createdAt)}>
                    {formatRelative(request.createdAt)}
                  </td>
                  <td>
                    {request.status === 'resolved' ? (
                      <span className="badge badge-success">Resolved</span>
                    ) : (
                      <span className="badge badge-gold">Open</span>
                    )}
                  </td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => navigate('accounts', { search: request.email || request.username || request.fullName })}
                      >
                        <UserSearch aria-hidden="true" /> Find account
                      </button>
                      {request.status !== 'resolved' ? (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void resolve(request)}>
                          <CheckCheck aria-hidden="true" /> Resolve
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!requests.length ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    <EmptyState icon={LifeBuoy} title={loading ? 'Loading…' : status === 'open' ? 'No open requests' : 'No requests found'}>
                      {status === 'open' ? 'Nobody is waiting for a password reset.' : null}
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination pager={pager} label="requests" />
    </>
  );
}
