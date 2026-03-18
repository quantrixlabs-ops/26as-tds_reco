import { useState } from 'react';
import {
  Download, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Layers, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { BatchResultResponse, PartyRecoSummary } from '../api';
import { batchDownloadUrl, formatFY } from '../api';

interface Props {
  result: BatchResultResponse;
  onReset: () => void;
}

function matchColor(pct: number): string {
  if (pct >= 95) return 'text-emerald-600';
  if (pct >= 75) return 'text-amber-600';
  return 'text-red-600';
}

function matchBg(pct: number): string {
  if (pct >= 95) return 'bg-emerald-50';
  if (pct >= 75) return 'bg-amber-50';
  return 'bg-red-50';
}

export default function BatchResultsPage({ result, onReset }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const successParties = result.party_summaries.filter(p => p.status === 'SUCCESS');
  const failedParties  = result.party_summaries.filter(p => p.status === 'ERROR');

  const totalMatched = successParties.reduce((s, p) => s + p.matched_count, 0);
  const total26as    = successParties.reduce((s, p) => s + p.total_26as_entries, 0);
  const overallRate  = total26as > 0 ? (totalMatched / total26as * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="inline-flex items-center gap-2 bg-[#1F3864] text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">
            <Layers size={12} /> Batch Reconciliation Complete
          </div>
          <h2 className="text-2xl font-bold text-slate-900">
            {result.total_parties} Parties Reconciled
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            {formatFY(result.financial_year)} · {result.completed} success, {result.failed} failed
          </p>
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors border border-slate-200 rounded-xl px-4 py-2 hover:border-slate-300"
        >
          <RefreshCw size={14} /> New Batch
        </button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Overall Match Rate</p>
          <p className={`text-2xl font-bold ${matchColor(overallRate)}`}>{overallRate.toFixed(1)}%</p>
          <p className="text-xs text-slate-400 mt-1">{totalMatched} / {total26as} entries</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Parties</p>
          <p className="text-2xl font-bold text-slate-900">{result.total_parties}</p>
          <p className="text-xs text-slate-400 mt-1">
            {result.completed} success · {result.failed} failed
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Unmatched 26AS</p>
          <p className="text-2xl font-bold text-amber-600">
            {successParties.reduce((s, p) => s + p.unmatched_26as_count, 0)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Violations</p>
          <p className={`text-2xl font-bold ${
            successParties.reduce((s, p) => s + p.constraint_violations, 0) > 0 ? 'text-red-600' : 'text-emerald-600'
          }`}>
            {successParties.reduce((s, p) => s + p.constraint_violations, 0)}
          </p>
        </div>
      </div>

      {/* Party Results Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1F3864] text-white text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Deductor</th>
                <th className="px-4 py-3 text-center">TAN</th>
                <th className="px-4 py-3 text-center">Match Rate</th>
                <th className="px-4 py-3 text-center">Matched</th>
                <th className="px-4 py-3 text-center">Unmatched</th>
                <th className="px-4 py-3 text-center">Violations</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Detail</th>
              </tr>
            </thead>
            <tbody>
              {result.party_summaries.map((p, idx) => (
                <>
                  <tr
                    key={p.tan + idx}
                    className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                  >
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-[200px] truncate">
                      {p.deductor_name}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-600">{p.tan}</td>
                    <td className="px-4 py-3 text-center">
                      {p.status === 'SUCCESS' ? (
                        <span className={`font-bold ${matchColor(p.match_rate_pct)}`}>
                          {p.match_rate_pct.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-700">
                      {p.status === 'SUCCESS' ? `${p.matched_count}/${p.total_26as_entries}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.status === 'SUCCESS' ? (
                        <span className={p.unmatched_26as_count > 0 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                          {p.unmatched_26as_count}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.status === 'SUCCESS' ? (
                        <span className={p.constraint_violations > 0 ? 'text-red-600 font-bold' : 'text-emerald-600'}>
                          {p.constraint_violations}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.status === 'SUCCESS' ? (
                        <CheckCircle size={16} className="text-emerald-500 inline" />
                      ) : (
                        <XCircle size={16} className="text-red-500 inline" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                        className="text-slate-400 hover:text-slate-700 transition-colors"
                      >
                        {expandedIdx === idx ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                  </tr>
                  {expandedIdx === idx && (
                    <tr key={`detail-${idx}`} className="bg-slate-50">
                      <td colSpan={9} className="px-8 py-4">
                        {p.status === 'ERROR' ? (
                          <p className="text-sm text-red-600">{p.error_message}</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div>
                              <span className="text-slate-500">SAP File:</span>
                              <span className="ml-1 font-mono text-slate-700">{p.sap_filename}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">HIGH:</span>
                              <span className="ml-1 font-semibold text-emerald-600">{p.high_confidence_count}</span>
                              <span className="text-slate-400 mx-1">·</span>
                              <span className="text-slate-500">MED:</span>
                              <span className="ml-1 font-semibold text-amber-600">{p.medium_confidence_count}</span>
                              <span className="text-slate-400 mx-1">·</span>
                              <span className="text-slate-500">LOW:</span>
                              <span className="ml-1 font-semibold text-red-600">{p.low_confidence_count}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">Avg Var:</span>
                              <span className="ml-1 font-semibold">{p.avg_variance_pct.toFixed(2)}%</span>
                            </div>
                            <div>
                              <span className="text-slate-500">Cross-FY:</span>
                              <span className="ml-1 font-semibold">{p.cross_fy_match_count}</span>
                              <span className="text-slate-400 mx-1">·</span>
                              <span className="text-slate-500">Unmatched Books:</span>
                              <span className="ml-1 font-semibold">{p.unmatched_books_count}</span>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Failed parties warning */}
      {failedParties.length > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 rounded-xl p-4 mb-6">
          <XCircle size={20} className="text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-700">
              {failedParties.length} Party Reconciliation{failedParties.length > 1 ? 's' : ''} Failed
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {failedParties.map(p => p.deductor_name || p.sap_filename).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Download Button */}
      <a
        href={batchDownloadUrl(result.batch_id)}
        download
        className="flex items-center justify-center gap-3 w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-semibold text-sm shadow-lg hover:shadow-xl transition-all active:scale-[0.99]"
      >
        <Download size={18} />
        Download Combined Excel ({result.completed} parties)
      </a>

      <p className="text-center text-xs text-slate-400 mt-3">
        Master Summary + Per-Party Tabs (Matched · Unmatched · Variance)
      </p>
    </div>
  );
}
