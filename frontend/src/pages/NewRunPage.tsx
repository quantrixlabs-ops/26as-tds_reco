/**
 * NewRunPage — Single or Batch reconciliation upload
 * Toggle between Single (1 SAP + 1 26AS) and Batch (N SAP + 1 26AS)
 * Batch mode has a 2-step flow: Upload → Review Mappings → Run
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, X, CheckCircle, AlertCircle,
  ChevronDown, Layers, FileText, ChevronRight, ArrowLeft,
  Check, AlertTriangle, HelpCircle,
} from 'lucide-react';
import {
  runsApi, miscApi,
  type BatchMapping, type BatchParty,
} from '../lib/api';
import { cn, getErrorMessage, formatFY } from '../lib/utils';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

// ── Shared sub-components ─────────────────────────────────────────────────────

function FYSelector({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-2">
        Financial Year
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm text-gray-900 bg-white outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10 cursor-pointer"
        >
          {options.length === 0 && <option value="">Loading…</option>}
          {options.map((fy) => (
            <option key={fy} value={fy}>{formatFY(fy)}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

function FileDropZone({
  label, accept, file, onFile, onClear, hint, multiple, files, onFiles,
}: {
  label: string;
  accept: string;
  file?: File | null;
  onFile?: (f: File) => void;
  onClear?: () => void;
  hint?: string;
  multiple?: boolean;
  files?: File[];
  onFiles?: (f: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (multiple && onFiles) {
        onFiles(Array.from(e.dataTransfer.files));
      } else if (onFile) {
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }
    },
    [multiple, onFile, onFiles],
  );

  // Single-file mode
  if (!multiple) {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-2">{label}</label>
        {file ? (
          <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800 truncate">{file.name}</p>
              <p className="text-xs text-emerald-600">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
            <button type="button" onClick={onClear} className="p-1 hover:bg-emerald-100 rounded-full text-emerald-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors',
              dragging ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
            )}
          >
            <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">
              Drop file here or <span className="text-[#1B3A5C]">browse</span>
            </p>
            {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
            <input ref={inputRef} type="file" accept={accept} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f && onFile) onFile(f); e.target.value = ''; }} />
          </div>
        )}
      </div>
    );
  }

  // Multi-file mode
  const fileList = files ?? [];
  const addFiles = (incoming: File[]) => {
    if (!onFiles) return;
    const existing = new Set(fileList.map((f) => f.name));
    const newOnes = incoming.filter((f) => !existing.has(f.name));
    onFiles([...fileList, ...newOnes]);
  };
  const removeFile = (name: string) => {
    if (onFiles) onFiles(fileList.filter((f) => f.name !== name));
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-2">{label}</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
        className={cn(
          'border-2 border-dashed rounded-xl transition-colors',
          dragging ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-200',
        )}
      >
        {fileList.length > 0 ? (
          <div className="p-3 space-y-1.5">
            {fileList.map((f) => (
              <div key={f.name} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-3 py-2">
                <FileSpreadsheet className="h-4 w-4 text-[#1B3A5C] shrink-0" />
                <span className="text-sm text-gray-700 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => removeFile(f.name)} className="text-gray-300 hover:text-red-500 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full text-xs text-[#1B3A5C] hover:underline py-1.5 text-center"
            >
              + Add more files
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            className="px-6 py-8 text-center cursor-pointer hover:bg-gray-50 rounded-xl transition-colors"
          >
            <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">
              Drop files here or <span className="text-[#1B3A5C]">browse</span>
            </p>
            {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
          </div>
        )}
        <input ref={inputRef} type="file" accept={accept} multiple className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ''; }} />
      </div>
      {fileList.length > 0 && (
        <p className="text-xs text-gray-500 mt-1.5">{fileList.length} file{fileList.length > 1 ? 's' : ''} selected</p>
      )}
    </div>
  );
}

// ── Status badge for batch mapping ────────────────────────────────────────────

function MappingStatusBadge({ status, score }: { status: string; score: number | null }) {
  if (status === 'AUTO_CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check className="h-3 w-3" /> Auto ({score?.toFixed(0)}%)
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="h-3 w-3" /> Review ({score?.toFixed(0)}%)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
      <HelpCircle className="h-3 w-3" /> No match
    </span>
  );
}

// ── Single mode ───────────────────────────────────────────────────────────────

function SingleUploadForm({ fyOptions }: { fyOptions: string[] }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sapFile, setSapFile] = useState<File | null>(null);
  const [as26File, setAs26File] = useState<File | null>(null);
  const [financialYear, setFinancialYear] = useState(fyOptions[0] ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fyOptions.length && !financialYear) setFinancialYear(fyOptions[0]);
  }, [fyOptions, financialYear]);

  const canSubmit = sapFile && as26File && financialYear && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sapFile || !as26File || !financialYear) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await runsApi.create(sapFile, as26File, financialYear);
      toast('Run submitted', `Run #${result.run_number} is processing`, 'success');
      navigate(`/runs/${result.run_id}`);
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      toast('Submission failed', msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="space-y-6">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <FYSelector value={financialYear} onChange={setFinancialYear} options={fyOptions} />

        <FileDropZone
          label="SAP AR Ledger (.xlsx)"
          accept=".xlsx,.xls"
          file={sapFile}
          onFile={setSapFile}
          onClear={() => setSapFile(null)}
          hint="Excel file exported from SAP (FBL5N or similar)"
        />

        <FileDropZone
          label="Form 26AS (.xlsx)"
          accept=".xlsx,.xls"
          file={as26File}
          onFile={setAs26File}
          onClear={() => setAs26File(null)}
          hint="26AS Excel download from TRACES / ITD portal"
        />

        <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-700 leading-relaxed">
          <strong>Note:</strong> Only Status=F (Final) entries from Form 26AS will be processed.
          The algorithm enforces Section 199 constraints: books_sum must not exceed the 26AS credit amount.
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors',
              canSubmit ? 'bg-[#1B3A5C] text-white hover:bg-[#15304d]' : 'bg-gray-100 text-gray-400 cursor-not-allowed',
            )}
          >
            {submitting && <Spinner size="sm" className="border-white/30 border-t-white" />}
            {submitting ? 'Submitting…' : 'Start Reconciliation'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancel
          </button>
        </div>
      </Card>

      {submitting && (
        <Card className="flex items-center gap-4 mt-4">
          <Spinner size="lg" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Processing reconciliation…</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Cleaning SAP data, parsing 26AS, running 5-phase match algorithm. This may take 30–90 seconds.
            </p>
          </div>
        </Card>
      )}
    </form>
  );
}

// ── Batch mode ────────────────────────────────────────────────────────────────

type BatchStep = 'upload' | 'review';

function BatchUploadForm({ fyOptions }: { fyOptions: string[] }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<BatchStep>('upload');
  const [sapFiles, setSapFiles] = useState<File[]>([]);
  const [as26File, setAs26File] = useState<File | null>(null);
  const [financialYear, setFinancialYear] = useState(fyOptions[0] ?? '');

  // Preview step state
  const [mappings, setMappings] = useState<BatchMapping[]>([]);
  const [allParties, setAllParties] = useState<BatchParty[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { deductor_name: string; tan: string }>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState('');

  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fyOptions.length && !financialYear) setFinancialYear(fyOptions[0]);
  }, [fyOptions, financialYear]);

  const canPreview = sapFiles.length > 0 && as26File && financialYear && !previewing;

  const handlePreview = async () => {
    if (!as26File || sapFiles.length === 0) return;
    setError(null);
    setPreviewing(true);
    try {
      const result = await runsApi.batchPreview(sapFiles, as26File);
      setMappings(result.mappings);
      setAllParties(result.all_parties);
      // Seed overrides from auto-confirmed
      const seed: Record<string, { deductor_name: string; tan: string }> = {};
      for (const m of result.mappings) {
        if (m.confirmed_name && m.confirmed_tan) {
          seed[m.sap_filename] = { deductor_name: m.confirmed_name, tan: m.confirmed_tan };
        }
      }
      setOverrides(seed);
      setStep('review');
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      toast('Preview failed', msg, 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const setOverride = (filename: string, party: BatchParty) => {
    setOverrides((prev) => ({ ...prev, [filename]: { deductor_name: party.deductor_name, tan: party.tan } }));
    setOpenDropdown(null);
  };

  const clearOverride = (filename: string) => {
    setOverrides((prev) => { const n = { ...prev }; delete n[filename]; return n; });
  };

  const resolvedCount = mappings.filter((m) => !!overrides[m.sap_filename]).length;
  const needsReview = mappings.filter((m) => m.status !== 'AUTO_CONFIRMED').length;

  const handleRunAll = async () => {
    if (!as26File) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await runsApi.batchRun(sapFiles, as26File, financialYear, overrides);
      const failed = result.runs.filter((r) => r.status === 'FAILED').length;
      if (failed > 0) {
        toast(
          'Batch complete with errors',
          `${result.total - failed} succeeded, ${failed} failed`,
          'error',
        );
      } else {
        toast('Batch complete', `${result.total} reconciliations finished`, 'success');
      }
      navigate('/runs');
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      toast('Batch run failed', msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <Card className="space-y-6">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <FYSelector value={financialYear} onChange={setFinancialYear} options={fyOptions} />

        <FileDropZone
          label="Form 26AS (.xlsx) — single file covering all parties"
          accept=".xlsx,.xls"
          file={as26File}
          onFile={setAs26File}
          onClear={() => setAs26File(null)}
          hint="26AS Excel from TRACES / ITD portal"
        />

        <FileDropZone
          label="SAP AR Ledger files — one file per party"
          accept=".xlsx,.xls"
          multiple
          files={sapFiles}
          onFiles={setSapFiles}
          hint="Name each file after the deductor (e.g. ACME_LIMITED.xlsx) for auto-mapping"
        />

        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 leading-relaxed">
          <strong>Auto-mapping:</strong> Each SAP filename is fuzzy-matched against 26AS deductor names.
          You'll review and confirm mappings before running. Files with scores ≥ 95% are auto-confirmed.
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled={!canPreview}
            onClick={handlePreview}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors',
              canPreview ? 'bg-[#1B3A5C] text-white hover:bg-[#15304d]' : 'bg-gray-100 text-gray-400 cursor-not-allowed',
            )}
          >
            {previewing && <Spinner size="sm" className="border-white/30 border-t-white" />}
            {previewing ? 'Detecting parties…' : (
              <>Preview Mappings <ChevronRight className="h-4 w-4" /></>
            )}
          </button>
        </div>
      </Card>
    );
  }

  // ── Step 2: Review mappings ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep('upload')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 font-medium"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="text-emerald-600 font-semibold">{resolvedCount} ready</span>
          {needsReview > 0 && <span className="text-amber-600 font-semibold">{needsReview} need review</span>}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">Party Mappings — {mappings.length} files</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Review auto-detected matches. Use the dropdown to change any mapping.
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {mappings.map((m) => {
            const override = overrides[m.sap_filename];
            const displayName = override?.deductor_name ?? m.confirmed_name ?? '—';
            const displayTan = override?.tan ?? m.confirmed_tan ?? '';
            const isResolved = !!override;

            return (
              <div key={m.sap_filename} className="px-4 py-3 flex items-start gap-3">
                {/* File info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="text-xs font-mono text-gray-600 truncate">{m.sap_filename}</span>
                  </div>
                  <p className="text-xs text-gray-400">Identity: {m.identity_string}</p>
                </div>

                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-gray-300 mt-1 shrink-0" />

                {/* Matched deductor + override dropdown */}
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center gap-2 mb-1">
                    <MappingStatusBadge status={isResolved ? 'AUTO_CONFIRMED' : m.status} score={m.fuzzy_score} />
                  </div>
                  <p className={cn('text-sm font-medium truncate', isResolved ? 'text-gray-900' : 'text-gray-400 italic')}>
                    {displayName}
                  </p>
                  {displayTan && <p className="text-xs text-gray-400">{displayTan}</p>}

                  {/* Override button */}
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = openDropdown === m.sap_filename ? null : m.sap_filename;
                        setOpenDropdown(next);
                        setDropdownSearch('');
                      }}
                      className="text-xs text-[#1B3A5C] hover:underline"
                    >
                      {isResolved ? 'Change' : 'Select deductor'}
                    </button>
                    {isResolved && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => clearOverride(m.sap_filename)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Clear
                        </button>
                      </>
                    )}
                  </div>

                  {/* Dropdown */}
                  {openDropdown === m.sap_filename && (
                    <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                      {/* Search input */}
                      <div className="px-3 py-2 border-b border-gray-100">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Search deductor…"
                          value={dropdownSearch}
                          onChange={(e) => setDropdownSearch(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10 placeholder-gray-400"
                        />
                      </div>
                      {/* Filtered list */}
                      <div className="max-h-44 overflow-y-auto">
                        {allParties
                          .filter((p) =>
                            dropdownSearch === '' ||
                            p.deductor_name.toLowerCase().includes(dropdownSearch.toLowerCase()) ||
                            p.tan.toLowerCase().includes(dropdownSearch.toLowerCase()),
                          )
                          .map((p) => (
                            <button
                              key={`${p.deductor_name}|${p.tan}`}
                              type="button"
                              onClick={() => setOverride(m.sap_filename, p)}
                              className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                            >
                              <p className="font-medium text-gray-800 truncate">{p.deductor_name}</p>
                              <p className="text-xs text-gray-400">{p.tan} · {p.entry_count} entries</p>
                            </button>
                          ))}
                        {allParties.filter((p) =>
                          dropdownSearch === '' ||
                          p.deductor_name.toLowerCase().includes(dropdownSearch.toLowerCase()) ||
                          p.tan.toLowerCase().includes(dropdownSearch.toLowerCase()),
                        ).length === 0 && (
                          <p className="px-3 py-4 text-sm text-gray-400 text-center">No match for "{dropdownSearch}"</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={resolvedCount === 0 || submitting}
          onClick={handleRunAll}
          className={cn(
            'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors',
            resolvedCount > 0 && !submitting
              ? 'bg-[#1B3A5C] text-white hover:bg-[#15304d]'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed',
          )}
        >
          {submitting && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {submitting ? 'Running all…' : `Run All — ${resolvedCount} parties`}
        </button>
        {resolvedCount < mappings.length && (
          <p className="text-xs text-amber-600">
            {mappings.length - resolvedCount} file{mappings.length - resolvedCount > 1 ? 's' : ''} skipped (no mapping set)
          </p>
        )}
      </div>

      {submitting && (
        <Card className="flex items-center gap-4">
          <Spinner size="lg" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Running batch reconciliation…</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Processing {resolvedCount} parties sequentially. This may take 1–3 minutes.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

type Mode = 'single' | 'batch';

export default function NewRunPage() {
  const [mode, setMode] = useState<Mode>('single');

  const { data: fyData } = useQuery({
    queryKey: ['financial-years'],
    queryFn: miscApi.financialYears,
  });

  const fyOptions = fyData?.years ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">New Reconciliation Run</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload SAP AR Ledger and Form 26AS to begin TDS reconciliation
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            mode === 'single'
              ? 'bg-white text-[#1B3A5C] shadow-sm'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <FileText className="h-4 w-4" />
          Single Party
        </button>
        <button
          type="button"
          onClick={() => setMode('batch')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            mode === 'batch'
              ? 'bg-white text-[#1B3A5C] shadow-sm'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <Layers className="h-4 w-4" />
          Batch Multi-Party
        </button>
      </div>

      {/* Mode description */}
      {mode === 'single' ? (
        <p className="text-xs text-gray-400 -mt-3">
          One SAP file + one 26AS → single reconciliation run
        </p>
      ) : (
        <p className="text-xs text-gray-400 -mt-3">
          Multiple SAP files + one 26AS → auto-map parties → run all in one go
        </p>
      )}

      {/* Form */}
      {mode === 'single' ? (
        <SingleUploadForm fyOptions={fyOptions} />
      ) : (
        <BatchUploadForm fyOptions={fyOptions} />
      )}
    </div>
  );
}
