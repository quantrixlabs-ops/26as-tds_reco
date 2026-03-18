import { useRef, useState, useEffect } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, Calendar, ChevronDown } from 'lucide-react';
import { fetchFinancialYears, formatFY, fyDateRange } from '../api';

interface Props {
  onUpload: (sapFile: File, as26File: File, financialYear: string) => void;
  isLoading: boolean;
  error?: string;
}

interface DropZoneProps {
  label: string;
  subtitle: string;
  file: File | null;
  onFile: (f: File) => void;
  accentColor: string;
  bgClass: string;
  borderClass: string;
}

function DropZone({ label, subtitle, file, onFile, accentColor, bgClass, borderClass }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed
        transition-all duration-200 cursor-pointer min-h-[200px]
        ${file || dragging ? `${bgClass} ${borderClass}` : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'}
      `}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
      />
      {file ? (
        <>
          <FileSpreadsheet size={36} className="mb-3" style={{ color: accentColor }} />
          <p className="font-semibold text-slate-800 text-center text-sm leading-snug break-all px-2">{file.name}</p>
          <p className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
          <p className="text-xs mt-2 font-semibold" style={{ color: accentColor }}>✓ Ready</p>
        </>
      ) : (
        <>
          <Upload size={32} className="mb-3 text-slate-400" />
          <p className="font-semibold text-slate-700 text-sm">{label}</p>
          <p className="text-xs text-slate-400 mt-1 text-center">{subtitle}</p>
          <p className="text-xs text-slate-400 mt-3">Drop here or click to browse</p>
        </>
      )}
    </div>
  );
}

export default function UploadPage({ onUpload, isLoading, error }: Props) {
  const [sapFile, setSapFile]       = useState<File | null>(null);
  const [as26File, setAs26File]     = useState<File | null>(null);
  const [fyList, setFyList]         = useState<string[]>([]);
  const [selectedFY, setSelectedFY] = useState<string>('FY2023-24');
  const [fyOpen, setFyOpen]         = useState(false);

  useEffect(() => {
    fetchFinancialYears()
      .then(({ years, default: def }) => {
        setFyList(years);
        setSelectedFY(def);
      })
      .catch(() => {
        // Fallback list if backend not reachable yet
        setFyList(['FY2020-21','FY2021-22','FY2022-23','FY2023-24','FY2024-25','FY2025-26']);
        setSelectedFY('FY2023-24');
      });
  }, []);

  const ready = sapFile && as26File && !isLoading;

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-[#1F3864] text-white px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide mb-4">
          HRA &amp; Co. / Akurat Advisory
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">TDS Reconciliation</h1>
        <p className="text-slate-500 text-sm">Single Party — One SAP + One 26AS</p>
      </div>

      {/* FY Selector */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
          <Calendar size={12} className="inline mr-1" />
          Financial Year
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFyOpen(!fyOpen)}
            className="w-full flex items-center justify-between bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 hover:border-[#1F3864] hover:ring-2 hover:ring-blue-100 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="bg-[#1F3864] text-white text-xs font-bold px-2.5 py-1 rounded-lg">
                {formatFY(selectedFY)}
              </span>
              <span className="text-slate-500 font-normal text-xs">
                {fyDateRange(selectedFY)}
              </span>
            </span>
            <ChevronDown
              size={16}
              className={`text-slate-400 transition-transform ${fyOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {fyOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
              {fyList.map((fy) => (
                <button
                  key={fy}
                  type="button"
                  onClick={() => { setSelectedFY(fy); setFyOpen(false); }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors
                    ${fy === selectedFY
                      ? 'bg-blue-50 text-[#1F3864] font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                    }`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded
                      ${fy === selectedFY ? 'bg-[#1F3864] text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {formatFY(fy)}
                    </span>
                    <span className="text-xs text-slate-400">{fyDateRange(fy)}</span>
                  </span>
                  {fy === selectedFY && <span className="text-[#1F3864] text-xs">✓ Selected</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drop zones */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <DropZone
          label="SAP AR Ledger"
          subtitle="Upload your SAP export (.xlsx)"
          file={sapFile}
          onFile={setSapFile}
          accentColor="#1F3864"
          bgClass="bg-blue-50"
          borderClass="border-blue-400"
        />
        <DropZone
          label="26AS Master File"
          subtitle="Upload the 26AS Excel (.xlsx)"
          file={as26File}
          onFile={setAs26File}
          accentColor="#059669"
          bgClass="bg-emerald-50"
          borderClass="border-emerald-400"
        />
      </div>

      {/* Hint */}
      <p className="text-center text-xs text-slate-400 mb-5">
        Name your SAP file after the deductor (e.g.{' '}
        <code className="bg-slate-100 px-1 rounded text-slate-600 font-mono">
          BHUSHAN_POWER_&amp;_STEEL_LIMITED.XLSX
        </code>
        ) for automatic matching.
        <br />
        <span className="text-slate-400">
          Only <strong className="text-slate-600">RV</strong> and{' '}
          <strong className="text-slate-600">DR</strong> document types are reconciled.
          Dates are filtered to <strong className="text-slate-600">{fyDateRange(selectedFY)}</strong>.
        </span>
      </p>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Button */}
      <button
        disabled={!ready}
        onClick={() => ready && onUpload(sapFile!, as26File!, selectedFY)}
        className={`
          w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200
          ${ready
            ? 'bg-[#1F3864] text-white hover:bg-[#162d52] shadow-lg hover:shadow-xl active:scale-[0.99]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }
        `}
      >
        {isLoading ? 'Processing…' : `Upload & Reconcile — ${formatFY(selectedFY)}`}
      </button>
    </div>
  );
}
