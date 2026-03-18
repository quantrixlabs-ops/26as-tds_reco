/**
 * NewRunPage — drag-and-drop file upload + FY selector
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Upload,
  FileSpreadsheet,
  X,
  CheckCircle,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { miscApi, runsApi } from '../lib/api';
import { cn, getErrorMessage, formatFY } from '../lib/utils';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

function FileDropZone({
  label,
  accept,
  file,
  onFile,
  onClear,
  hint,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-2">{label}</label>
      {file ? (
        <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3">
          <FileSpreadsheet className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-800 truncate">{file.name}</p>
            <p className="text-xs text-emerald-600">
              {(file.size / 1024).toFixed(0)} KB
            </p>
          </div>
          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
          <button
            type="button"
            onClick={onClear}
            className="p-1 hover:bg-emerald-100 rounded-full text-emerald-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors',
            dragging
              ? 'border-[#1B3A5C] bg-[#1B3A5C]/5'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
          )}
        >
          <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium">
            Drop file here or <span className="text-[#1B3A5C]">browse</span>
          </p>
          {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function NewRunPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [sapFile, setSapFile] = useState<File | null>(null);
  const [as26File, setAs26File] = useState<File | null>(null);
  const [financialYear, setFinancialYear] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: fyData } = useQuery({
    queryKey: ['financial-years'],
    queryFn: miscApi.financialYears,
  });

  useEffect(() => {
    if (fyData && !financialYear) {
      setFinancialYear(fyData.default);
    }
  }, [fyData, financialYear]);

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

      <form onSubmit={handleSubmit}>
        <Card className="space-y-6">
          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Financial year */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              Financial Year
            </label>
            <div className="relative">
              <select
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="w-full appearance-none border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm text-gray-900 bg-white outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10 cursor-pointer"
              >
                {fyOptions.length === 0 && (
                  <option value="">Loading…</option>
                )}
                {fyOptions.map((fy) => (
                  <option key={fy} value={fy}>
                    {formatFY(fy)}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* SAP file */}
          <FileDropZone
            label="SAP AR Ledger (.xlsx)"
            accept=".xlsx,.xls"
            file={sapFile}
            onFile={setSapFile}
            onClear={() => setSapFile(null)}
            hint="Excel file exported from SAP (FBL5N or similar)"
          />

          {/* 26AS file */}
          <FileDropZone
            label="Form 26AS (.xlsx)"
            accept=".xlsx,.xls"
            file={as26File}
            onFile={setAs26File}
            onClear={() => setAs26File(null)}
            hint="26AS Excel download from TRACES / ITD portal"
          />

          {/* Compliance notice */}
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-700 leading-relaxed">
            <strong>Note:</strong> Only Status=F (Final) entries from Form 26AS will be
            processed. The algorithm enforces Section 199 constraints: books_sum must not
            exceed the 26AS credit amount.
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                canSubmit
                  ? 'bg-[#1B3A5C] text-white hover:bg-[#15304d]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              )}
            >
              {submitting && (
                <Spinner size="sm" className="border-white/30 border-t-white" />
              )}
              {submitting ? 'Submitting…' : 'Start Reconciliation'}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              Cancel
            </button>
          </div>
        </Card>
      </form>

      {/* Progress info (while submitting) */}
      {submitting && (
        <Card className="flex items-center gap-4">
          <Spinner size="lg" />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Processing reconciliation…
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Cleaning SAP data, parsing 26AS, running 5-phase match algorithm.
              This may take 30–90 seconds.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
