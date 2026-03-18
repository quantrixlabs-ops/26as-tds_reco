import { useState, useEffect } from 'react';
import {
  CheckCircle, AlertTriangle, XCircle, Search,
  Layers, FileSpreadsheet, ArrowRight,
} from 'lucide-react';
import type { PartyMapping, As26Party } from '../api';
import { fetchBatchParties } from '../api';

interface Props {
  batchId: string;
  mappings: PartyMapping[];
  unmappedSapFiles: string[];
  uncoveredParties: { deductor_name: string; tan: string; entry_count: number }[];
  onConfirm: (mappings: PartyMapping[]) => void;
  isLoading: boolean;
}

export default function BatchMappingPage({
  batchId, mappings: initialMappings, unmappedSapFiles: _unmappedSapFiles, uncoveredParties,
  onConfirm, isLoading,
}: Props) {
  const [mappings, setMappings] = useState<PartyMapping[]>(initialMappings);
  const [parties, setParties]   = useState<As26Party[]>([]);
  const [editIdx, setEditIdx]   = useState<number | null>(null);
  const [searchQ, setSearchQ]   = useState('');

  useEffect(() => {
    fetchBatchParties(batchId).then(setParties).catch(() => {});
  }, [batchId]);

  // ── Mapping actions ──────────────────────────────────────────────────────

  /** User picks a 26AS party from dropdown for row idx */
  const assignParty = (idx: number, party: As26Party) => {
    setMappings(prev => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        deductor_name: party.deductor_name,
        tan: party.tan,
        fuzzy_score: 100,
        status: 'CONFIRMED',
      };
      return next;
    });
    setEditIdx(null);
    setSearchQ('');
  };

  /** User accepts the auto-suggested match for an UNMATCHED row */
  const acceptSuggestion = (idx: number) => {
    setMappings(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], status: 'CONFIRMED' };
      return next;
    });
  };

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredParties = searchQ
    ? parties.filter(p =>
        p.deductor_name.toLowerCase().includes(searchQ.toLowerCase()) ||
        p.tan.toLowerCase().includes(searchQ.toLowerCase())
      )
    : parties;

  // ── Stats ────────────────────────────────────────────────────────────────

  const autoCount      = mappings.filter(m => m.status === 'AUTO').length;
  const confirmedCount = mappings.filter(m => m.status === 'CONFIRMED').length;
  const unmatchedCount = mappings.filter(m => m.status === 'UNMATCHED').length;
  const readyCount     = autoCount + confirmedCount;

  // ALL mappings must be AUTO or CONFIRMED before reco can start
  const allReady = unmatchedCount === 0;

  // Build set of TANs that have a SAP file assigned
  const mappedTans = new Set(mappings.map(m => m.tan).filter(Boolean));

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-[#1F3864] text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <Layers size={12} /> Party Mapping Review
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Review &amp; Confirm Party Assignments</h2>
        <p className="text-slate-500 text-sm">
          {mappings.length} SAP files · {readyCount} ready ·{' '}
          {unmatchedCount > 0 ? (
            <span className="text-red-600 font-semibold">{unmatchedCount} need manual assignment</span>
          ) : (
            <span className="text-emerald-600 font-semibold">All confirmed ✓</span>
          )}
        </p>
      </div>

      {/* ── 26AS Party Coverage ───────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
          26AS Party Coverage
          <span className="text-xs font-normal text-slate-400">
            Green = SAP uploaded · Red = No SAP file
          </span>
        </h3>
        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
          {parties.map(p => {
            const hasSap = mappedTans.has(p.tan);
            return (
              <div
                key={p.tan}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  hasSap
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-red-50 border-red-300 text-red-700'
                }`}
              >
                {hasSap
                  ? <CheckCircle size={11} className="text-emerald-500 flex-shrink-0" />
                  : <XCircle size={11} className="text-red-400 flex-shrink-0" />
                }
                <span className="max-w-[160px] truncate">{p.deductor_name}</span>
                <span className="text-[10px] font-mono opacity-60">({p.entry_count})</span>
              </div>
            );
          })}
          {parties.length === 0 && (
            <p className="text-xs text-slate-400">Loading 26AS parties...</p>
          )}
        </div>
      </div>

      {/* ── SAP → 26AS Mapping Table ──────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm mb-6">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">
            SAP File → 26AS Party Assignments
          </h3>
          <span className="text-xs text-slate-400">
            {readyCount}/{mappings.length} ready
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {mappings.map((m, idx) => {
            const isUnmatched = m.status === 'UNMATCHED';
            const isEditing = editIdx === idx;

            return (
              <div
                key={m.sap_filename}
                className={`px-5 py-4 ${
                  isUnmatched
                    ? 'bg-red-50/50 border-l-4 border-l-red-400'
                    : 'bg-white border-l-4 border-l-emerald-400'
                }`}
              >
                {/* Row: # | SAP File → Deductor | Actions */}
                <div className="flex items-center gap-4">
                  {/* Index */}
                  <span className="text-xs text-slate-400 w-5 text-right flex-shrink-0">{idx + 1}</span>

                  {/* SAP File */}
                  <div className="flex items-center gap-2 min-w-[180px] max-w-[220px] flex-shrink-0">
                    <FileSpreadsheet size={14} className="text-[#1F3864] flex-shrink-0" />
                    <span className="font-mono text-xs text-slate-700 truncate" title={m.sap_filename}>
                      {m.sap_filename}
                    </span>
                  </div>

                  <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />

                  {/* Deductor Assignment */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      /* ── Search dropdown ──────────────────────────── */
                      <div className="relative">
                        <div className="flex items-center gap-1.5 bg-white border-2 border-blue-400 rounded-lg px-3 py-2">
                          <Search size={14} className="text-blue-400 flex-shrink-0" />
                          <input
                            autoFocus
                            value={searchQ}
                            onChange={(e) => setSearchQ(e.target.value)}
                            placeholder="Type deductor name or TAN..."
                            className="text-sm outline-none flex-1 min-w-[200px]"
                          />
                          <button
                            onClick={() => { setEditIdx(null); setSearchQ(''); }}
                            className="text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
                          {filteredParties.length === 0 ? (
                            <p className="text-xs text-slate-400 px-4 py-3">No matches found</p>
                          ) : (
                            filteredParties.slice(0, 25).map(p => (
                              <button
                                key={p.tan}
                                onClick={() => assignParty(idx, p)}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors border-b border-slate-50 flex items-center gap-3"
                              >
                                <span className="font-semibold text-slate-800 truncate flex-1">{p.deductor_name}</span>
                                <span className="text-slate-400 font-mono text-xs flex-shrink-0">{p.tan}</span>
                                <span className="text-slate-400 text-xs flex-shrink-0">({p.entry_count})</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      /* ── Display matched deductor ─────────────────── */
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold text-sm ${m.deductor_name ? 'text-slate-800' : 'text-red-400'}`}>
                          {m.deductor_name || '— Not assigned —'}
                        </span>
                        {m.tan && (
                          <span className="font-mono text-xs text-slate-400">{m.tan}</span>
                        )}
                        {!isUnmatched && (
                          <span className="text-xs text-slate-400">({m.fuzzy_score.toFixed(0)}% match)</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Status + Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Status badge */}
                    {m.status === 'AUTO' && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Auto
                      </span>
                    )}
                    {m.status === 'CONFIRMED' && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Confirmed
                      </span>
                    )}
                    {m.status === 'UNMATCHED' && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2.5 py-1 rounded-full animate-pulse">
                        <AlertTriangle size={10} /> Needs Assignment
                      </span>
                    )}

                    {/* Action buttons */}
                    {isUnmatched && !isEditing && m.deductor_name && (
                      <button
                        onClick={() => acceptSuggestion(idx)}
                        className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold transition-colors px-2 py-1 rounded hover:bg-emerald-50 border border-emerald-200"
                        title={`Accept "${m.deductor_name}" as the match`}
                      >
                        Accept
                      </button>
                    )}
                    {!isEditing && (
                      <button
                        onClick={() => { setEditIdx(idx); setSearchQ(''); }}
                        className="text-xs text-[#1F3864] hover:text-blue-800 font-semibold transition-colors px-2 py-1 rounded hover:bg-blue-50 border border-blue-200"
                      >
                        {isUnmatched ? 'Assign' : 'Change'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Warning for UNMATCHED with bad guess */}
                {isUnmatched && m.deductor_name && m.fuzzy_score < 70 && !isEditing && (
                  <p className="text-xs text-red-500 mt-2 ml-10 pl-1">
                    ⚠ Low confidence match ({m.fuzzy_score.toFixed(0)}%) — likely incorrect. Please click <strong>Assign</strong> to search for the correct party.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Uncovered 26AS Parties ────────────────────────────────── */}
      {uncoveredParties.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="font-semibold text-amber-800 text-sm">
              {uncoveredParties.length} 26AS Parties Without SAP Files
            </h3>
          </div>
          <p className="text-xs text-amber-600 mb-3">
            These parties have entries in 26AS but no SAP file was uploaded. They will be skipped.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-32 overflow-y-auto">
            {uncoveredParties.slice(0, 20).map(p => (
              <div key={p.tan} className="text-xs text-amber-700 bg-amber-100/50 rounded px-2 py-1 truncate">
                {p.deductor_name} <span className="font-mono opacity-60">({p.entry_count})</span>
              </div>
            ))}
            {uncoveredParties.length > 20 && (
              <div className="text-xs text-amber-500 px-2 py-1">
                ...and {uncoveredParties.length - 20} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── UNMATCHED Warning Banner ─────────────────────────────── */}
      {unmatchedCount > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 rounded-xl p-4 mb-4">
          <XCircle size={20} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-700">
              {unmatchedCount} SAP file{unmatchedCount > 1 ? 's' : ''} need manual assignment
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Click <strong>"Assign"</strong> or <strong>"Accept"</strong> on each red row above before running reconciliation.
            </p>
          </div>
        </div>
      )}

      {/* ── Run Button ────────────────────────────────────────────── */}
      <button
        disabled={!allReady || isLoading}
        onClick={() => allReady && onConfirm(mappings)}
        className={`w-full py-4 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200
          ${allReady && !isLoading
            ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg hover:shadow-xl active:scale-[0.99]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
      >
        {isLoading
          ? 'Running Reconciliation for all parties…'
          : allReady
            ? `✓ Run Reconciliation — ${mappings.length} Parties`
            : `Assign all parties first (${unmatchedCount} remaining)`}
      </button>
    </div>
  );
}
