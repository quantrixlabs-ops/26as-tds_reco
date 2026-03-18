import { useState } from 'react';
import UploadPage from './components/UploadPage';
import ProcessingSpinner from './components/ProcessingSpinner';
import AlignmentPage from './components/AlignmentPage';
import ResultsPage from './components/ResultsPage';
import BatchUploadPage from './components/BatchUploadPage';
import BatchMappingPage from './components/BatchMappingPage';
import BatchResultsPage from './components/BatchResultsPage';
import {
  reconcile, confirmAlignment,
  batchUpload, batchConfirm,
} from './api';
import type {
  CleaningReport, DeductorCandidate, RecoResult, ReconcileResponse,
  PartyMapping, BatchMappingResponse, BatchResultResponse,
} from './api';

// ── Page state machine ────────────────────────────────────────────────────────
type Page =
  | 'upload' | 'processing' | 'alignment' | 'results'
  | 'batch-upload' | 'batch-processing' | 'batch-mapping' | 'batch-running' | 'batch-results';

type Mode = 'single' | 'batch';

interface AlignmentState {
  alignmentId: string;
  identityString: string;
  candidates: DeductorCandidate[];
  cleaningReport: CleaningReport;
}

interface ResultsState {
  result: RecoResult;
  cleaning: CleaningReport;
}

interface BatchMappingState {
  batchId: string;
  mappings: PartyMapping[];
  unmappedSapFiles: string[];
  uncoveredParties: { deductor_name: string; tan: string; entry_count: number }[];
  financialYear: string;
}

export default function App() {
  const [page, setPage]               = useState<Page>('upload');
  const [mode, setMode]               = useState<Mode>('single');
  const [uploadError, setUploadError] = useState<string | undefined>();
  const [alignState, setAlignState]   = useState<AlignmentState | null>(null);
  const [resultsState, setResultsState] = useState<ResultsState | null>(null);
  const [confirming, setConfirming]   = useState(false);

  // Batch state
  const [batchMappingState, setBatchMappingState] = useState<BatchMappingState | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResultResponse | null>(null);

  // ── Single-party handlers ────────────────────────────────────────────────
  const handleResponse = (res: ReconcileResponse) => {
    if (res.status === 'complete' && res.reco_summary && res.cleaning_report) {
      setResultsState({ result: res.reco_summary, cleaning: res.cleaning_report });
      setPage('results');
    } else if ((res.status === 'pending' || res.status === 'no_match') && res.alignment_id) {
      setAlignState({
        alignmentId: res.alignment_id,
        identityString: res.identity_string || '',
        candidates: res.top_candidates || [],
        cleaningReport: res.cleaning_report!,
      });
      setPage('alignment');
    }
  };

  const handleUpload = async (sapFile: File, as26File: File, financialYear: string) => {
    setUploadError(undefined);
    setPage('processing');
    try {
      const res = await reconcile(sapFile, as26File, financialYear);
      handleResponse(res);
    } catch (e: any) {
      setPage('upload');
      setUploadError(e.message || 'An unexpected error occurred. Please try again.');
    }
  };

  const handleConfirm = async (deductorName: string, tan: string) => {
    if (!alignState) return;
    setConfirming(true);
    try {
      const res = await confirmAlignment(alignState.alignmentId, deductorName, tan);
      handleResponse(res);
    } catch (e: any) {
      setUploadError(e.message || 'Confirmation failed. Please try again.');
      setPage('upload');
    } finally {
      setConfirming(false);
    }
  };

  // ── Batch handlers ─────────────────────────────────────────────────────────
  const handleBatchUpload = async (sapFiles: File[], as26File: File, financialYear: string) => {
    setUploadError(undefined);
    setPage('batch-processing');
    try {
      const res: BatchMappingResponse = await batchUpload(sapFiles, as26File, financialYear);
      setBatchMappingState({
        batchId: res.batch_id,
        mappings: res.mappings,
        unmappedSapFiles: res.unmapped_sap_files,
        uncoveredParties: res.uncovered_26as_parties,
        financialYear: res.financial_year,
      });
      setPage('batch-mapping');
    } catch (e: any) {
      setPage('batch-upload');
      setUploadError(e.message || 'Batch upload failed. Please try again.');
    }
  };

  const handleBatchConfirm = async (mappings: PartyMapping[]) => {
    if (!batchMappingState) return;
    setConfirming(true);
    setPage('batch-running');
    try {
      const res: BatchResultResponse = await batchConfirm({
        batch_id: batchMappingState.batchId,
        confirmed_mappings: mappings,
      });
      setBatchResult(res);
      setPage('batch-results');
    } catch (e: any) {
      setUploadError(e.message || 'Batch reconciliation failed. Please try again.');
      setPage('batch-mapping');
    } finally {
      setConfirming(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setPage(mode === 'batch' ? 'batch-upload' : 'upload');
    setUploadError(undefined);
    setAlignState(null);
    setResultsState(null);
    setBatchMappingState(null);
    setBatchResult(null);
    setConfirming(false);
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setPage(newMode === 'batch' ? 'batch-upload' : 'upload');
    setUploadError(undefined);
    setAlignState(null);
    setResultsState(null);
    setBatchMappingState(null);
    setBatchResult(null);
    setConfirming(false);
  };

  // Show mode toggle only on upload pages
  const showModeToggle = page === 'upload' || page === 'batch-upload';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#1F3864] rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">TDS</span>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-tight">TDS Reco</p>
              <p className="text-xs text-slate-400 leading-tight">
                {mode === 'batch' ? 'Batch Multi-Party' : 'Single Party'} · FY 2023-24
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          {showModeToggle && (
            <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
              <button
                onClick={() => switchMode('single')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  mode === 'single'
                    ? 'bg-white text-[#1F3864] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Single Party
              </button>
              <button
                onClick={() => switchMode('batch')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  mode === 'batch'
                    ? 'bg-white text-[#1F3864] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Batch
              </button>
            </div>
          )}

          <p className="text-xs text-slate-400 hidden sm:block">
            HRA &amp; Co. / Akurat Advisory
          </p>
        </div>
      </header>

      <main>
        {/* Single-party flow */}
        {page === 'upload' && (
          <UploadPage
            onUpload={(sap, as26, fy) => handleUpload(sap, as26, fy)}
            isLoading={false}
            error={uploadError}
          />
        )}
        {page === 'processing' && <ProcessingSpinner />}
        {page === 'alignment' && alignState && (
          <AlignmentPage
            identityString={alignState.identityString}
            candidates={alignState.candidates}
            alignmentId={alignState.alignmentId}
            onConfirm={handleConfirm}
            isLoading={confirming}
          />
        )}
        {page === 'results' && resultsState && (
          <ResultsPage
            result={resultsState.result}
            cleaning={resultsState.cleaning}
            onReset={handleReset}
          />
        )}

        {/* Batch flow */}
        {page === 'batch-upload' && (
          <BatchUploadPage
            onUpload={handleBatchUpload}
            isLoading={false}
            error={uploadError}
          />
        )}
        {(page === 'batch-processing' || page === 'batch-running') && <ProcessingSpinner />}
        {page === 'batch-mapping' && batchMappingState && (
          <BatchMappingPage
            batchId={batchMappingState.batchId}
            mappings={batchMappingState.mappings}
            unmappedSapFiles={batchMappingState.unmappedSapFiles}
            uncoveredParties={batchMappingState.uncoveredParties}
            onConfirm={handleBatchConfirm}
            isLoading={confirming}
          />
        )}
        {page === 'batch-results' && batchResult && (
          <BatchResultsPage
            result={batchResult}
            onReset={handleReset}
          />
        )}
      </main>

      <footer className="text-center py-6 text-xs text-slate-400">
        TDS Reconciliation System · Section 199 Income Tax Act ·
        HRA &amp; Co. / Akurat Advisory
      </footer>
    </div>
  );
}
