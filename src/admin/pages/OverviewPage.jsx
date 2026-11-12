import { useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Star, TrendingUp, UsersRound } from 'lucide-react';

import { fetchAdminOverview } from '../../api';
import { BarChart, EmptyState, StatCard } from '../../components/ui';
import { formatNumber, formatPercent, formatRelative, violationLabel } from '../../lib/format';
import { useAdmin, useAdminQuery } from '../context';
import { CardSection, PageHeader } from '../parts';

export default function OverviewPage() {
  const { navigate } = useAdmin();
  const { data, loading, loadedOnce } = useAdminQuery((token) => fetchAdminOverview(token));
  const [leaderboardClass, setLeaderboardClass] = useState('');
  const overview = data?.overview;
  const totals = overview?.totals ?? {};

  if (!loadedOnce) {
    return (
      <>
        <PageHeader title="Overview" description="A snapshot of exam activity across the school." />
        <div className="card">
          <EmptyState icon={Activity} title="Loading overview…" />
        </div>
      </>
    );
  }

  const classLeaderboards = overview?.classLeaderboards ?? [];
  const selectedLeaderboard =
    classLeaderboards.find((item) => item.classRoom === leaderboardClass) ?? classLeaderboards[0] ?? null;

  return (
    <div className="stack stack-lg" style={{ opacity: loading ? 0.7 : 1, transition: 'opacity 150ms' }}>
      <PageHeader
        title="Overview"
        description={`A snapshot of exam activity across the school. Updated ${formatRelative(data?.generatedAt)}.`}
      />

      <div className="stat-grid">
        <StatCard
          icon={ClipboardList}
          label="Attempts"
          value={formatNumber(totals.candidates ?? 0)}
          meta={`${formatNumber(totals.uniqueStudents ?? 0)} students · ${formatNumber(totals.averageTrialsPerStudent ?? 0)} each`}
        />
        <StatCard
          icon={CheckCircle2}
          label="Submitted"
          value={formatNumber(totals.submitted ?? 0)}
          meta={`${formatPercent(totals.completionRate ?? 0)} completion`}
        />
        <StatCard icon={Activity} label="In progress now" value={formatNumber(totals.active ?? 0)} meta="Live attempts" />
        <StatCard
          icon={TrendingUp}
          label="Average score"
          value={formatPercent(totals.averageScore ?? 0)}
          meta={`${formatPercent(totals.averageRawScore ?? 0)} before penalties`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Below 40%"
          value={formatNumber(totals.lowScoreCount ?? 0)}
          meta={`${formatNumber(totals.averageViolations ?? 0)} violations per attempt`}
        />
        <StatCard
          icon={Star}
          label="Average rating"
          value={totals.feedbackCount ? `${formatNumber(totals.averageRating)} / 5` : '—'}
          meta={`${formatNumber(totals.feedbackCount ?? 0)} exam · ${formatNumber(totals.generalFeedbackCount ?? 0)} general`}
        />
      </div>

      <div className="grid-2">
        <CardSection title="Score distribution" subtitle="Submitted attempts by final score">
          <BarChart
            data={(overview?.scoreDistribution ?? []).map((item) => ({ label: `${item.band}%`, value: item.count }))}
            valueLabel="Attempts"
            labelWidth={72}
          />
        </CardSection>
        <CardSection title="Class performance" subtitle="Average final score per class">
          <BarChart
            data={(overview?.classPerformance ?? []).map((item) => ({
              label: item.classRoom,
              value: item.averageScore,
              detail: `${item.count} attempt${item.count === 1 ? '' : 's'}`,
            }))}
            valueLabel="Average score"
            formatValue={formatPercent}
            max={100}
            labelWidth={72}
          />
        </CardSection>
      </div>

      <div className="grid-2">
        <CardSection
          title="Recent submissions"
          flush
          actions={
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('attempts')}>
              View all <ArrowRight aria-hidden="true" />
            </button>
          }
        >
          {(overview?.recentSubmissions ?? []).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th className="col-num">Score</th>
                    <th className="col-num">Violations</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentSubmissions.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="cell-primary">{row.studentName}</span>
                        <span className="cell-sub">{row.classRoom}</span>
                      </td>
                      <td className="col-num">
                        <strong>{formatPercent(row.finalPercent)}</strong>
                      </td>
                      <td className="col-num">{row.violationsCount}</td>
                      <td className="muted">{formatRelative(row.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No submissions yet" />
          )}
        </CardSection>

        <CardSection title="Top students" subtitle="Best score across all exams" flush>
          {(overview?.outstandingStudents ?? []).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Student</th>
                    <th className="col-num">Best</th>
                    <th className="col-num">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.outstandingStudents.map((row, index) => (
                    <tr key={row.studentKey}>
                      <td className="num muted">{index + 1}</td>
                      <td>
                        <span className="cell-primary">{row.studentName}</span>
                        <span className="cell-sub">
                          {row.classRoom} · {row.submittedTrials} submitted
                        </span>
                      </td>
                      <td className="col-num">
                        <strong>{formatPercent(row.bestFinalPercent)}</strong>
                      </td>
                      <td className="col-num">{formatPercent(row.averageFinalPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No rankings yet" />
          )}
        </CardSection>
      </div>

      <div className="grid-2">
        <CardSection title="Proctoring events" subtitle="All logged violations by type, including waived ones">
          <BarChart
            data={(overview?.violationBreakdown ?? []).map((item) => ({ label: violationLabel(item.type), value: item.count }))}
            valueLabel="Events"
            labelWidth={150}
          />
        </CardSection>

        <CardSection title="Recent exam feedback" subtitle="What students said after submitting">
          {(overview?.recentFeedback ?? []).length ? (
            <ul className="list-plain">
              {overview.recentFeedback.map((row) => (
                <li key={row.id} style={{ alignItems: 'flex-start' }}>
                  <span className="badge badge-gold" style={{ minWidth: 52, justifyContent: 'center' }}>
                    <Star aria-hidden="true" />
                    {row.rating ?? '–'}
                  </span>
                  <div className="grow">
                    <div className="row-between">
                      <strong className="small">
                        {row.studentName} <span className="muted">· {row.classRoom}</span>
                      </strong>
                      <span className="hint">{formatRelative(row.submittedAt)}</span>
                    </div>
                    {row.comment ? <p className="small" style={{ marginTop: '0.2rem' }}>{row.comment}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No feedback yet" />
          )}
        </CardSection>
      </div>

      <CardSection
        title="Class leaderboards"
        subtitle="Top five students in each class"
        flush
        actions={
          classLeaderboards.length ? (
            <select
              className="select select-sm"
              style={{ width: 'auto' }}
              aria-label="Class"
              value={selectedLeaderboard?.classRoom ?? ''}
              onChange={(event) => setLeaderboardClass(event.target.value)}
            >
              {classLeaderboards.map((item) => (
                <option key={item.classRoom} value={item.classRoom}>
                  {item.classRoom}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        {selectedLeaderboard ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Student</th>
                  <th className="col-num">Submitted</th>
                  <th className="col-num">Best</th>
                  <th className="col-num">Average</th>
                </tr>
              </thead>
              <tbody>
                {selectedLeaderboard.leaders.map((row, index) => (
                  <tr key={row.studentKey}>
                    <td className="num muted">{index + 1}</td>
                    <td className="cell-primary">{row.studentName}</td>
                    <td className="col-num">{row.submittedTrials}</td>
                    <td className="col-num">
                      <strong>{formatPercent(row.bestFinalPercent)}</strong>
                    </td>
                    <td className="col-num">{formatPercent(row.averageFinalPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={UsersRound} title="No class results yet" />
        )}
      </CardSection>
    </div>
  );
}
