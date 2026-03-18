/**
 * RunDetailPage — full run detail with tabs: Matched / Unmatched 26AS / Unmatched Books / Exceptions / Audit Trail
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import {
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Activity,
} from 'lucide-react';
import {
  runsApi,
  type MatchedPair,
  type Unmatched26AS,
  type UnmatchedBook,
  type Exception,
  type RunSummary,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { Card, StatCard } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, type Column } from '../components/ui/Table';
import { FullPageSpinner } from '../components/ui/Spinner';
import {
  cn,
  formatDate,
  formatDateTime,
  formatCurrency,
  formatPct,
  runStatusVariant,
  runStatusLabel,
  confidenceVariant,
  severityVariant,
  formatFY,
  getErrorMessage,
  truncate,
} from '../lib/utils';

// ── Metadata card ─────────────────────────────────────────────────────────────

function MetadataCard({ run }: { run: RunSummary }) {
  return (
    <Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Run Number</p>
          <p className="font-mono text-gray-900 font-semibold">#{run.run_number}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Financial Year</p>
          <p className="font-medium text-gray-900">{formatFY(run.financial_year)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Deductor</p>
          <p className="font-medium text-gray-900 truncate">{run.deductor_name}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">TAN</p>
          <p className="font-mono text-gray-900">{run.tan}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Status</p>
          <Badge variant={runStatusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Algorithm</p>
          <p className="text-gray-700 font-mono text-xs">{run.algorithm_version ?? 'v5'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Created</p>
          <p className="text-gray-700">{formatDateTime(run.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Completed</p>
          <p className="text-gray-700">{formatDateTime(run.completed_at)}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-gray-400 mb-0.5">SAP File Hash (SHA-256)</p>
          <p className="font-mono text-xs text-gray-500 break-all">{run.sap_file_hash}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-gray-400 mb-0.5">26AS File Hash (SHA-256)</p>
          <p className="font-mono text-xs text-gray-500 break-all">{run.as26_file_hash}</p>
        </div>
      </div>
    </Card>
  );
}

// ── Matched pairs tab ─────────────────────────────────────────────────────────

function MatchedTab({ runId }: { runId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'matched'],
    queryFn: () => runsApi.matched(runId),
  });

  const cols: Column<MatchedPair>[] = [
    {
      key: 'as26_index',
      header: '26AS #',
      render: (r) => <span className="font-mono text-xs text-gray-500">#{r.as26_index}</span>,
    },
    {
      key: 'as26_date',
      header: 'Date',
      render: (r) => <span className="text-xs">{formatDate(r.as26_date)}</span>,
    },
    {
      key: 'section',
      header: 'Section',
      render: (r) => <span className="font-mono text-xs">{r.section}</span>,
    },
    {
      key: 'as26_amount',
      header: '26AS Amount',
      align: 'right',
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.as26_amount)}</span>,
    },
    {
      key: 'books_sum',
      header: 'Books Sum',
      align: 'right',
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.books_sum)}</span>,
    },
    {
      key: 'variance_pct',
      header: 'Variance',
      align: 'right',
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            'font-mono text-xs',
            r.variance_pct > 3 ? 'text-red-600' : r.variance_pct > 1 ? 'text-amber-600' : 'text-gray-700',
          )}
        >
          {formatPct(r.variance_pct)}
        </span>
      ),
    },
    {
      key: 'match_type',
      header: 'Type',
      render: (r) => <span className="font-mono text-xs text-gray-600">{r.match_type}</span>,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      render: (r) => (
        <Badge variant={confidenceVariant(r.confidence)} size="sm">
          {r.confidence}
        </Badge>
      ),
    },
    {
      key: 'invoice_refs',
      header: 'Invoices',
      render: (r) => (
        <span className="text-xs text-gray-500" title={r.invoice_refs.join(', ')}>
          {r.invoice_count} inv
        </span>
      ),
    },
  ];

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-500">
          {data.length} matched pairs · books_sum ≤ 26AS amount (Section 199)
        </p>
      </div>
      <Table
        columns={cols}
        data={data}
        keyExtractor={(_r, i) => `matched-${i}`}
        loading={isLoading}
        emptyMessage="No matched pairs found"
      />
    </Card>
  );
}

// ── Unmatched 26AS tab ────────────────────────────────────────────────────────

function Unmatched26ASTab({ runId }: { runId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'unmatched-26as'],
    queryFn: () => runsApi.unmatched26as(runId),
  });

  const cols: Column<Unmatched26AS>[] = [
    {
      key: 'index',
      header: '#',
      render: (r) => <span className="font-mono text-xs text-gray-400">#{r.index}</span>,
    },
    { key: 'deductor_name', header: 'Deductor', render: (r) => <span className="text-sm">{truncate(r.deductor_name, 30)}</span> },
    { key: 'tan', header: 'TAN', render: (r) => <span className="font-mono text-xs">{r.tan}</span> },
    { key: 'section', header: 'Section', render: (r) => <span className="font-mono text-xs">{r.section}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-xs">{formatDate(r.date)}</span> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.amount)}</span>,
    },
    {
      key: 'reason_code',
      header: 'Reason',
      render: (r) => (
        <div>
          <span className="font-mono text-xs text-red-600">{r.reason_code}</span>
          <p className="text-xs text-gray-400">{r.reason_label}</p>
        </div>
      ),
    },
  ];

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-xs text-gray-500">{data.length} unmatched 26AS entries</p>
      </div>
      <Table
        columns={cols}
        data={data}
        keyExtractor={(_r, i) => `u26-${i}`}
        loading={isLoading}
        emptyMessage="All 26AS entries matched"
      />
    </Card>
  );
}

// ── Unmatched Books tab ───────────────────────────────────────────────────────

function UnmatchedBooksTab({ runId }: { runId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'unmatched-books'],
    queryFn: () => runsApi.unmatchedBooks(runId),
  });

  const cols: Column<UnmatchedBook>[] = [
    { key: 'invoice_ref', header: 'Invoice Ref', render: (r) => <span className="font-mono text-xs">{r.invoice_ref}</span> },
    { key: 'clearing_doc', header: 'Clearing Doc', render: (r) => <span className="font-mono text-xs text-gray-500">{r.clearing_doc}</span> },
    { key: 'doc_date', header: 'Doc Date', render: (r) => <span className="text-xs">{formatDate(r.doc_date)}</span> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.amount)}</span>,
    },
    { key: 'doc_type', header: 'Doc Type', render: (r) => <span className="font-mono text-xs">{r.doc_type}</span> },
    {
      key: 'sgl_flag',
      header: 'SGL Flag',
      render: (r) =>
        r.sgl_flag ? (
          <Badge variant="yellow" size="sm">{r.sgl_flag}</Badge>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
    },
  ];

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-500">{data.length} unmatched SAP book entries</p>
      </div>
      <Table
        columns={cols}
        data={data}
        keyExtractor={(_r, i) => `ub-${i}`}
        loading={isLoading}
        emptyMessage="No unmatched book entries"
      />
    </Card>
  );
}

// ── Exceptions tab ────────────────────────────────────────────────────────────

function ExceptionsTab({ runId, canReview }: { runId: string; canReview: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'exceptions'],
    queryFn: () => runsApi.exceptions(runId),
  });

  const [reviewing, setReviewing] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [actionInput, setActionInput] = useState('ACKNOWLEDGED');

  const reviewMut = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: string; notes: string }) =>
      runsApi.reviewException(runId, id, action, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', runId, 'exceptions'] });
      setReviewing(null);
      toast('Exception reviewed', undefined, 'success');
    },
    onError: (err) => toast('Review failed', getErrorMessage(err), 'error'),
  });

  const cols: Column<Exception>[] = [
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (r) => (
        <Badge variant={severityVariant(r.severity)} size="sm">
          {r.severity}
        </Badge>
      ),
    },
    { key: 'category', header: 'Category', render: (r) => <span className="text-xs font-medium text-gray-700">{r.category}</span> },
    {
      key: 'description',
      header: 'Description',
      render: (r) => <span className="text-xs text-gray-600">{truncate(r.description, 60)}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) =>
        r.amount != null ? (
          <span className="font-mono text-xs">{formatCurrency(r.amount)}</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        ),
    },
    {
      key: 'reviewed',
      header: 'Status',
      render: (r) =>
        r.reviewed ? (
          <Badge variant="green" size="sm">{r.review_action ?? 'Reviewed'}</Badge>
        ) : (
          <Badge variant="yellow" size="sm">Pending</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        !r.reviewed && canReview ? (
          reviewing === r.id ? (
            <div className="flex items-center gap-2">
              <select
                className="text-xs border border-gray-300 rounded px-2 py-1 outline-none"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
              >
                <option value="ACKNOWLEDGED">Acknowledge</option>
                <option value="WAIVED">Waive</option>
                <option value="ESCALATED">Escalate</option>
              </select>
              <input
                className="text-xs border border-gray-300 rounded px-2 py-1 w-24 outline-none"
                placeholder="Notes…"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
              <button
                onClick={() =>
                  reviewMut.mutate({ id: r.id, action: actionInput, notes: noteInput })
                }
                disabled={reviewMut.isPending}
                className="text-xs bg-[#1B3A5C] text-white px-2 py-1 rounded hover:bg-[#15304d]"
              >
                {reviewMut.isPending ? '…' : 'Save'}
              </button>
              <button
                onClick={() => setReviewing(null)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setReviewing(r.id);
                setNoteInput('');
                setActionInput('ACKNOWLEDGED');
              }}
              className="text-xs text-[#1B3A5C] font-medium hover:underline"
            >
              Review
            </button>
          )
        ) : null,
    },
  ];

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-500">
          {data.filter((e) => !e.reviewed).length} unreviewed exceptions
        </p>
      </div>
      <Table
        columns={cols}
        data={data}
        keyExtractor={(r) => r.id}
        loading={isLoading}
        emptyMessage="No exceptions found"
      />
    </Card>
  );
}

// ── Audit Trail tab ───────────────────────────────────────────────────────────

function AuditTrailTab({ runId }: { runId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'audit'],
    queryFn: () => runsApi.auditTrail(runId),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <Card>
      <div className="space-y-4">
        {data.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No audit events yet</p>
        )}
        {data.map((event) => (
          <div key={event.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-[#1B3A5C] mt-1" />
              <div className="w-px flex-1 bg-gray-100 mt-1" />
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{event.event_type}</span>
                <Badge variant="gray" size="sm">{event.actor_role}</Badge>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {event.actor} · {formatDateTime(event.timestamp)}
              </p>
              {event.notes && (
                <p className="text-xs text-gray-600 mt-1 italic">"{event.notes}"</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('matched');

  const { data: run, isLoading, refetch } = useQuery({
    queryKey: ['runs', id],
    queryFn: () => runsApi.get(id!),
    refetchInterval: (query) => {
      const d = query.state.data as RunSummary | undefined;
      return d?.status === 'PROCESSING' ? 5000 : false;
    },
  });

  const reviewMut = useMutation({
    mutationFn: ({ action, notes }: { action: 'APPROVED' | 'REJECTED'; notes?: string }) =>
      runsApi.review(id!, action, notes),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['runs', id] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      toast(
        vars.action === 'APPROVED' ? 'Run approved' : 'Run rejected',
        undefined,
        vars.action === 'APPROVED' ? 'success' : 'info',
      );
    },
    onError: (err) => toast('Review failed', getErrorMessage(err), 'error'),
  });

  const [rejectNotes, setRejectNotes] = useState('');
  const [showReject, setShowReject] = useState(false);

  if (isLoading || !run) return <FullPageSpinner message="Loading run…" />;

  const canReview =
    (user?.role === 'REVIEWER' || user?.role === 'ADMIN') &&
    run.status === 'PENDING_REVIEW' &&
    run.created_by !== user?.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/runs')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">
                Run #{run.run_number}
              </h1>
              <Badge variant={runStatusVariant(run.status)}>
                {runStatusLabel(run.status)}
              </Badge>
              {run.constraint_violations > 0 && (
                <Badge variant="red" size="sm">
                  {run.constraint_violations} violations
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {run.deductor_name} · {run.tan} · {formatFY(run.financial_year)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Refresh */}
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {/* Download */}
          {run.status !== 'PROCESSING' && run.status !== 'FAILED' && (
            <a
              href={runsApi.downloadUrl(run.id)}
              download
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          )}

          {/* Reviewer actions */}
          {canReview && (
            <>
              <button
                onClick={() => reviewMut.mutate({ action: 'APPROVED' })}
                disabled={reviewMut.isPending}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                Approve
              </button>
              <button
                onClick={() => setShowReject(!showReject)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
            </>
          )}
        </div>
      </div>

      {/* Reject panel */}
      {showReject && canReview && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm font-semibold text-red-800 mb-2">Rejection notes</p>
          <textarea
            className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500 bg-white resize-none"
            rows={3}
            placeholder="Reason for rejection (required)…"
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              disabled={!rejectNotes.trim() || reviewMut.isPending}
              onClick={() =>
                reviewMut.mutate({ action: 'REJECTED', notes: rejectNotes })
              }
              className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {reviewMut.isPending ? 'Submitting…' : 'Confirm Rejection'}
            </button>
            <button
              onClick={() => setShowReject(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {/* Metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Match Rate"
          value={formatPct(run.match_rate_pct)}
          accentColor={
            run.match_rate_pct >= 95
              ? 'text-emerald-600'
              : run.match_rate_pct >= 80
              ? 'text-amber-600'
              : 'text-red-600'
          }
        />
        <StatCard
          label="Matched"
          value={`${run.matched_count} / ${run.total_26as_entries}`}
          sub="26AS entries"
          accentColor="text-[#1B3A5C]"
        />
        <StatCard
          label="Unmatched 26AS"
          value={run.unmatched_26as_count}
          accentColor={run.unmatched_26as_count > 0 ? 'text-red-600' : 'text-emerald-600'}
        />
        <StatCard
          label="Violations"
          value={run.constraint_violations}
          accentColor={run.constraint_violations > 0 ? 'text-red-600' : 'text-emerald-600'}
        />
        <StatCard
          label="Control Total"
          value={run.control_total_balanced ? 'Balanced' : 'Off'}
          accentColor={run.control_total_balanced ? 'text-emerald-600' : 'text-red-600'}
        />
      </div>

      {/* Confidence breakdown */}
      <Card>
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-xs text-gray-400 mb-1">High Confidence</p>
            <div className="flex items-center gap-1.5">
              <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{
                    width: `${run.matched_count > 0 ? (run.high_confidence_count / run.matched_count) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-emerald-600">
                {run.high_confidence_count}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Medium Confidence</p>
            <div className="flex items-center gap-1.5">
              <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full"
                  style={{
                    width: `${run.matched_count > 0 ? (run.medium_confidence_count / run.matched_count) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-amber-600">
                {run.medium_confidence_count}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Low Confidence</p>
            <div className="flex items-center gap-1.5">
              <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-orange-400 rounded-full"
                  style={{
                    width: `${run.matched_count > 0 ? (run.low_confidence_count / run.matched_count) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-orange-600">
                {run.low_confidence_count}
              </span>
            </div>
          </div>
          {run.has_pan_issues && (
            <Badge variant="red">PAN issues detected</Badge>
          )}
          {run.has_rate_mismatches && (
            <Badge variant="orange">Rate mismatches</Badge>
          )}
        </div>
      </Card>

      {/* Metadata card */}
      <MetadataCard run={run} />

      {/* Tabs */}
      <TabsPrimitive.Root value={tab} onValueChange={setTab}>
        <TabsPrimitive.List className="flex gap-1 border-b border-gray-200 mb-4">
          {[
            { value: 'matched', label: 'Matched Pairs', icon: <CheckCircle className="h-3.5 w-3.5" />, count: run.matched_count },
            { value: 'unmatched-26as', label: 'Unmatched 26AS', icon: <AlertTriangle className="h-3.5 w-3.5" />, count: run.unmatched_26as_count },
            { value: 'unmatched-books', label: 'Unmatched Books', icon: <BookOpen className="h-3.5 w-3.5" /> },
            { value: 'exceptions', label: 'Exceptions', icon: <ClipboardList className="h-3.5 w-3.5" /> },
            { value: 'audit', label: 'Audit Trail', icon: <Activity className="h-3.5 w-3.5" /> },
          ].map((t) => (
            <TabsPrimitive.Trigger
              key={t.value}
              value={t.value}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                tab === t.value
                  ? 'border-[#1B3A5C] text-[#1B3A5C]'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {t.icon}
              {t.label}
              {t.count != null && t.count > 0 && (
                <span
                  className={cn(
                    'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    tab === t.value
                      ? 'bg-[#1B3A5C] text-white'
                      : 'bg-gray-100 text-gray-600',
                  )}
                >
                  {t.count}
                </span>
              )}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <TabsPrimitive.Content value="matched">
          <MatchedTab runId={id!} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="unmatched-26as">
          <Unmatched26ASTab runId={id!} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="unmatched-books">
          <UnmatchedBooksTab runId={id!} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="exceptions">
          <ExceptionsTab runId={id!} canReview={canReview} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="audit">
          <AuditTrailTab runId={id!} />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}
