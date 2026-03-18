/**
 * RunHistoryPage — filterable/searchable list of all reconciliation runs
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, RefreshCw, PlusCircle } from 'lucide-react';
import { runsApi, type RunSummary, type RunStatus } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, type Column } from '../components/ui/Table';
import { FullPageSpinner } from '../components/ui/Spinner';
import {
  formatDate,
  formatPct,
  runStatusVariant,
  runStatusLabel,
  formatFY,
  cn,
} from '../lib/utils';

const STATUS_OPTIONS: Array<{ value: RunStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PENDING_REVIEW', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FAILED', label: 'Failed' },
];

const FY_OPTIONS = [
  '', 'FY2020-21', 'FY2021-22', 'FY2022-23', 'FY2023-24', 'FY2024-25', 'FY2025-26',
];

export default function RunHistoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>(
    (searchParams.get('status') as RunStatus | '') || '',
  );
  const [fyFilter, setFyFilter] = useState('');

  const { data: runs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['runs'],
    queryFn: runsApi.list,
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    return runs
      .filter((r) => {
        if (statusFilter && r.status !== statusFilter) return false;
        if (fyFilter && r.financial_year !== fyFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (
            !r.deductor_name.toLowerCase().includes(q) &&
            !r.tan.toLowerCase().includes(q) &&
            !String(r.run_number).includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [runs, search, statusFilter, fyFilter]);

  const columns: Column<RunSummary>[] = [
    {
      key: 'run_number',
      header: 'Run #',
      sortable: true,
      render: (r) => (
        <span className="font-mono text-xs text-gray-500 font-medium">#{r.run_number}</span>
      ),
    },
    {
      key: 'deductor_name',
      header: 'Deductor',
      sortable: true,
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-gray-900 truncate max-w-[220px]">
            {r.deductor_name}
          </p>
          <p className="text-xs text-gray-400 font-mono">{r.tan}</p>
        </div>
      ),
    },
    {
      key: 'financial_year',
      header: 'FY',
      sortable: true,
      render: (r) => (
        <span className="text-xs font-medium text-gray-600">{formatFY(r.financial_year)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={runStatusVariant(r.status)}>{runStatusLabel(r.status)}</Badge>
      ),
    },
    {
      key: 'match_rate_pct',
      header: 'Match Rate',
      align: 'right',
      sortable: true,
      render: (r) =>
        r.status === 'PROCESSING' ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <span
            className={cn(
              'font-semibold text-sm',
              r.match_rate_pct >= 95
                ? 'text-emerald-600'
                : r.match_rate_pct >= 80
                ? 'text-amber-600'
                : 'text-red-600',
            )}
          >
            {formatPct(r.match_rate_pct)}
          </span>
        ),
    },
    {
      key: 'matched_count',
      header: 'Matched',
      align: 'right',
      sortable: true,
      render: (r) => (
        <span className="text-xs text-gray-600">
          {r.matched_count} / {r.total_26as_entries}
        </span>
      ),
    },
    {
      key: 'constraint_violations',
      header: 'Violations',
      align: 'center',
      sortable: true,
      render: (r) =>
        r.constraint_violations > 0 ? (
          <Badge variant="red" size="sm">{r.constraint_violations}</Badge>
        ) : (
          <span className="text-xs text-emerald-500 font-semibold">0</span>
        ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (r) => (
        <span className="text-xs text-gray-400">{formatDate(r.created_at)}</span>
      ),
    },
  ];

  if (isLoading) return <FullPageSpinner message="Loading runs…" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reconciliation History</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {runs.length} total run{runs.length !== 1 ? 's' : ''}
            {filtered.length !== runs.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
          <button
            onClick={() => navigate('/runs/new')}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B3A5C] text-white text-sm font-semibold rounded-lg hover:bg-[#15304d] transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            New Run
          </button>
        </div>
      </div>

      {/* Filters */}
      <Card padding={false}>
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search deductor, TAN, run #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10"
            />
          </div>

          <SlidersHorizontal className="h-4 w-4 text-gray-400 shrink-0" />

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RunStatus | '')}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#1B3A5C] bg-white text-gray-700"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* FY filter */}
          <select
            value={fyFilter}
            onChange={(e) => setFyFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#1B3A5C] bg-white text-gray-700"
          >
            <option value="">All FYs</option>
            {FY_OPTIONS.filter(Boolean).map((fy) => (
              <option key={fy} value={fy}>
                {formatFY(fy)}
              </option>
            ))}
          </select>

          {(search || statusFilter || fyFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setFyFilter('');
              }}
              className="text-xs text-gray-400 hover:text-gray-600 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>

        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => navigate(`/runs/${r.id}`)}
          emptyMessage={
            search || statusFilter || fyFilter
              ? 'No runs match your filters'
              : 'No runs yet. Click "New Run" to get started.'
          }
        />
      </Card>
    </div>
  );
}
