import { useRef, useState, useEffect } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, Calendar, ChevronDown, X, Layers } from 'lucide-react';
import { fetchFinancialYears, formatFY, fyDateRange } from '../api';

interface Props {
  onUpload: (sapFiles: File[], as26File: File, financialYear: string) => void;
  isLoading: boolean;
  error?: string;
}

export default function BatchUploadPage({ onUpload, isLoading, error }: Props) {
  const as26InputRef = useRef<HTMLInputElement>(null);
  const sapInputRef  = useRef<HTMLInputElement>(null);

  const [as26File, setAs26File]     = useState<File | null>(null);
  const [sapFiles, setSapFiles]     = useState<File[]>([]);
  const [fyList, setFyList]         = useState<string[]>([]);
  const [selectedFY, setSelectedFY] = useState<string>('FY2023-24');
  const [fyOpen, setFyOpen]         = useState(false);
  const [as26Dragging, setAs26Dragging] = useState(false);
  const [sapDragging, setSapDragging]   = useState(false);

  useEffect(() => {
    fetchFinancialYears()
      .then(({ years, default: def }) => { setFyList(years); setSelectedFY(def); })
      .catch(() => {
        setFyList(['FY2020-21','FY2021-22','FY2022-23','FY2023-24','FY2024-25','FY2025-26']);
        setSelectedFY('FY2023-24');
      });
  }, []);

  const addSapFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    setSapFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !existing.has(f.name))];
    });
  };

  const removeSapFile = (name: string) => {
    setSapFiles(prev => prev.filter(f => f.name !== name));
  };

  const ready = as26File && sapFiles.length > 0 && !isLoading;

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-[#1F3864] text-white px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide mb-4">
          <Layers size={12} /> Batch Multi-Party Reconciliation
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Batch TDS Reconciliation</h1>
        <p className="text-slate-500 text-sm">Upload one 26AS + multiple SAP files for all parties</p>
      </div>

      {/* FY Selector */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
          <Calendar size={12} className="inline mr-1" /> Financial Year
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
              <span className="text-slate-500 font-normal text-xs">{fyDateRange(selectedFY)}</span>
            </span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${fyOpen ? 'rotate-180' : ''}`} />
          </button>
          {fyOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
              {fyList.map((fy) => (
                <button
                  key={fy}
                  type="button"
                  onClick={() => { setSelectedFY(fy); setFyOpen(false); }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors
                    ${fy === selectedFY ? 'bg-blue-50 text-[#1F3864] font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded
                      ${fy === selectedFY ? 'bg-[#1F3864] text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {formatFY(fy)}
                    </span>
                    <span className="text-xs text-slate-400">{fyDateRange(fy)}</span>
                  </span>
                  {fy === selectedFY && <span className="text-[#1F3864] text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 26AS Drop Zone */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
          26AS Master File (single file, all parties)
        </label>
        <div
          className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed
            transition-all duration-200 cursor-pointer
            ${as26File || as26Dragging ? 'bg-emerald-50 border-emerald-400' : 'border-slate-300 bg-white hover:border-slate-400'}`}
          onDragOver={(e) => { e.preventDefault(); setAs26Dragging(true); }}
          onDragLeave={() => setAs26Dragging(false)}
          onDrop={(e) => { e.preventDefault(); setAs26Dragging(false); if (e.dataTransfer.files[0]) setAs26File(e.dataTransfer.files[0]); }}
          onClick={() => as26InputRef.current?.click()}
        >
          <input ref={as26InputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) setAs26File(e.target.files[0]); }} />
          {as26File ? (
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={24} className="text-emerald-600" />
              <div>
                <p className="font-semibold text-slate-800 text-sm">{as26File.name}</p>
                <p className="text-xs text-slate-500">{(as26File.size / 1024).toFixed(1)} KB · ✓ Ready</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <Upload size={28} className="mb-2 text-slate-400" />
              <p className="font-semibold text-slate-700 text-sm">Drop 26AS file here</p>
              <p className="text-xs text-slate-400 mt-1">Single .xlsx file with all parties</p>
            </div>
          )}
        </div>
      </div>

      {/* SAP Files Drop Zone */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
          SAP AR Ledger Files (one per party)
        </label>
        <div
          className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed
            transition-all duration-200 cursor-pointer min-h-[120px]
            ${sapFiles.length > 0 || sapDragging ? 'bg-blue-50 border-blue-400' : 'border-slate-300 bg-white hover:border-slate-400'}`}
          onDragOver={(e) => { e.preventDefault(); setSapDragging(true); }}
          onDragLeave={() => setSapDragging(false)}
          onDrop={(e) => { e.preventDefault(); setSapDragging(false); addSapFiles(e.dataTransfer.files); }}
          onClick={() => sapInputRef.current?.click()}
        >
          <input ref={sapInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
            onChange={(e) => { if (e.target.files) addSapFiles(e.target.files); }} />
          {sapFiles.length === 0 ? (
            <div className="flex flex-col items-center">
              <Upload size={28} className="mb-2 text-slate-400" />
              <p className="font-semibold text-slate-700 text-sm">Drop SAP files here</p>
              <p className="text-xs text-slate-400 mt-1">Multiple .xlsx files — one per party</p>
            </div>
          ) : (
            <div className="w-full">
              <p className="text-xs font-semibold text-[#1F3864] mb-2 text-center">
                {sapFiles.length} SAP file{sapFiles.length > 1 ? 's' : ''} selected
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sapFiles.map(f => (
                  <div key={f.name} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm border border-slate-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileSpreadsheet size={14} className="text-[#1F3864] flex-shrink-0" />
                      <span className="truncate text-slate-700">{f.name}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSapFile(f.name); }}
                      className="ml-2 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2 text-center">Click or drop to add more</p>
            </div>
          )}
        </div>
      </div>

      {/* Hint */}
      <p className="text-center text-xs text-slate-400 mb-5">
        Name each SAP file after the deductor for automatic matching.
        Parties will be auto-mapped and you can review before running.
      </p>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        disabled={!ready}
        onClick={() => ready && onUpload(sapFiles, as26File!, selectedFY)}
        className={`w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200
          ${ready
            ? 'bg-[#1F3864] text-white hover:bg-[#162d52] shadow-lg hover:shadow-xl active:scale-[0.99]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
      >
        {isLoading ? 'Uploading & Mapping…' : `Upload & Auto-Map — ${sapFiles.length} parties`}
      </button>
    </div>
  );
}
