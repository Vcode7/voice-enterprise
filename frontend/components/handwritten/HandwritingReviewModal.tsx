'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Mic,
  MicOff,
  Radio,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Table as TableIcon,
  Maximize2,
  Save,
  Volume2,
} from 'lucide-react';
import {
  HandwritingScanningTemplate,
  OcrPageResult,
  SessionDataEntry,
  HandwritingValueType,
  EntryTableData,
} from '@/types';
import { DEFAULT_HANDWRITING_SCANNING_TEMPLATE } from '@/lib/constants';
import { useWebAudioRecorder } from '@/hooks/useWebAudioRecorder';
import { calculateColumnTotals } from '@/lib/utils/tableTotals';
import { getTableColumnMinWidthPx } from '@/lib/utils/tableColumnWidth';
import { apiUrl } from '@/lib/api/apiClient';

interface HandwritingReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  ocrPages: OcrPageResult[];
  initialPageIndex?: number;
  entries: SessionDataEntry[];
  template: HandwritingScanningTemplate;
  onUpdateEntry: (
    pageIndex: number,
    updatedFields: Record<string, any>,
    updatedTableRows?: any[],
    updatedTables?: EntryTableData[]
  ) => void;
  onImmediateSave: (pageIndex: number) => Promise<void> | void;
  onSaveAll?: () => Promise<void> | void;
  initialMode?: 'review' | 'edit';
}

export function HandwritingReviewModal({
  isOpen,
  onClose,
  ocrPages,
  initialPageIndex = 0,
  entries,
  template,
  onUpdateEntry,
  onImmediateSave,
  onSaveAll,
  initialMode = 'review',
}: HandwritingReviewModalProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(initialPageIndex);
  const totalPages = Math.max(ocrPages.length, entries.length, 1);

  // Sync initialPageIndex if modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPageIndex(Math.min(initialPageIndex, totalPages - 1));
    }
  }, [isOpen, initialPageIndex, totalPages]);

  // Active page & entry
  const activePage = ocrPages[currentPageIndex] || {
    pageNumber: currentPageIndex + 1,
    imageUrl: undefined,
    ocrText: '',
  };

  const currentEntry = entries[currentPageIndex] || entries[0] || ({} as SessionDataEntry);

  // Local editable buffer for active page
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, any>>({});
  const [localTableHeaders, setLocalTableHeaders] = useState<string[]>([]);
  const [localTableRows, setLocalTableRows] = useState<any[]>([]);
  const [localTables, setLocalTables] = useState<EntryTableData[]>([]);

  // Feedback banner state
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceSuccessMsg, setVoiceSuccessMsg] = useState<string | null>(null);
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);

  // Zoom control state for document image
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  // Web Audio Recorder hook for Edit by Voice
  const recorder = useWebAudioRecorder();

  // Load entry values into local state when currentPageIndex or currentEntry changes
  useEffect(() => {
    if (!currentEntry) return;

    // Field values
    const fv: Record<string, any> = {};
    (template.fields || []).forEach((f) => {
      fv[f.field_name] = currentEntry.fieldValues?.[f.field_name] !== undefined
        ? String(currentEntry.fieldValues[f.field_name])
        : '';
    });
    // Include any extra fields in currentEntry
    if (currentEntry.fieldValues) {
      Object.entries(currentEntry.fieldValues).forEach(([k, v]) => {
        if (fv[k] === undefined) fv[k] = String(v ?? '');
      });
    }
    setLocalFieldValues(fv);

    // Table headers
    const headers =
      currentEntry.tableHeaders && currentEntry.tableHeaders.length > 0
        ? currentEntry.tableHeaders
        : template.table_columns.map((c) => c.column_name);
    setLocalTableHeaders(headers);

    // Table rows
    const rows = Array.isArray(currentEntry.tableRows) ? currentEntry.tableRows : [];
    setLocalTableRows(rows);

    // Multi-tables initialization
    const rawTmplTables =
      template.tables && template.tables.length > 0
        ? template.tables
        : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [];

    let initialTables: EntryTableData[] = [];
    if (currentEntry.tables && Array.isArray(currentEntry.tables) && currentEntry.tables.length > 0) {
      initialTables = rawTmplTables.map((tmplTable) => {
        const found = currentEntry.tables?.find(
          (t) => t.name?.toLowerCase().trim() === tmplTable.name.toLowerCase().trim()
        );
        const colHeaders = (tmplTable.columns || (tmplTable as any).fields || []).map(
          (f: any) => f.name || f.column_name
        );
        if (found && Array.isArray(found.rows)) {
          return {
            name: tmplTable.name,
            headers: found.headers && found.headers.length > 0 ? found.headers : colHeaders,
            rows: found.rows,
          };
        }
        return {
          name: tmplTable.name,
          headers: colHeaders,
          rows: [],
        };
      });
    } else {
      initialTables = rawTmplTables.map((tmplTable, idx) => {
        const colHeaders = (tmplTable.columns || (tmplTable as any).fields || []).map(
          (f: any) => f.name || f.column_name
        );
        if (idx === 0 && rows.length > 0) {
          return {
            name: tmplTable.name,
            headers: colHeaders.length > 0 ? colHeaders : headers,
            rows,
          };
        }
        return {
          name: tmplTable.name,
          headers: colHeaders,
          rows: [],
        };
      });
    }
    setLocalTables(initialTables);
  }, [currentPageIndex, currentEntry, template]);

  // Sync back to parent when local state changes
  const notifyParentChanges = (
    newFields: Record<string, any>,
    newRows: any[],
    newTables?: EntryTableData[]
  ) => {
    onUpdateEntry(currentPageIndex, newFields, newRows, newTables || localTables);
  };

  // Handle manual field update
  const handleFieldChange = (fieldName: string, value: string) => {
    const updated = { ...localFieldValues, [fieldName]: value };
    setLocalFieldValues(updated);
    notifyParentChanges(updated, localTableRows, localTables);
  };

  // Handle manual table cell update
  const handleTableCellChange = (
    rowIdx: number,
    headerKey: string,
    value: string,
    tableIdx: number = 0
  ) => {
    const updatedTables = [...localTables];
    if (updatedTables[tableIdx]) {
      const targetTable = { ...updatedTables[tableIdx] };
      const updatedRows = [...targetTable.rows];
      const targetRow = updatedRows[rowIdx];

      if (Array.isArray(targetRow)) {
        const colIdx = targetTable.headers.indexOf(headerKey);
        if (colIdx >= 0) {
          const rowCopy = [...targetRow];
          rowCopy[colIdx] = value;
          updatedRows[rowIdx] = rowCopy;
        }
      } else if (typeof targetRow === 'object' && targetRow !== null) {
        updatedRows[rowIdx] = { ...targetRow, [headerKey]: value };
      }

      targetTable.rows = updatedRows;
      updatedTables[tableIdx] = targetTable;
      setLocalTables(updatedTables);

      if (tableIdx === 0) {
        setLocalTableRows(updatedRows);
        notifyParentChanges(localFieldValues, updatedRows, updatedTables);
      } else {
        notifyParentChanges(localFieldValues, localTableRows, updatedTables);
      }
    } else {
      // Fallback single table
      const updatedRows = [...localTableRows];
      const targetRow = updatedRows[rowIdx];

      if (Array.isArray(targetRow)) {
        const colIdx = localTableHeaders.indexOf(headerKey);
        if (colIdx >= 0) {
          const rowCopy = [...targetRow];
          rowCopy[colIdx] = value;
          updatedRows[rowIdx] = rowCopy;
        }
      } else if (typeof targetRow === 'object' && targetRow !== null) {
        updatedRows[rowIdx] = { ...targetRow, [headerKey]: value };
      }

      setLocalTableRows(updatedRows);
      notifyParentChanges(localFieldValues, updatedRows);
    }
  };

  // Add Row to Table
  const handleAddTableRow = (tableIdx: number = 0) => {
    const updatedTables = [...localTables];
    if (updatedTables[tableIdx]) {
      const targetTable = { ...updatedTables[tableIdx] };
      const newRow: Record<string, string> = {};
      targetTable.headers.forEach((h) => {
        newRow[h] = '';
      });
      const updatedRows = [...targetTable.rows, newRow];
      targetTable.rows = updatedRows;
      updatedTables[tableIdx] = targetTable;
      setLocalTables(updatedTables);

      if (tableIdx === 0) {
        setLocalTableRows(updatedRows);
        notifyParentChanges(localFieldValues, updatedRows, updatedTables);
      } else {
        notifyParentChanges(localFieldValues, localTableRows, updatedTables);
      }
    } else {
      const newRow: Record<string, string> = {};
      localTableHeaders.forEach((h) => {
        newRow[h] = '';
      });
      const updated = [...localTableRows, newRow];
      setLocalTableRows(updated);
      notifyParentChanges(localFieldValues, updated);
    }
  };

  // Delete Row from Table
  const handleDeleteTableRow = (rowIdx: number, tableIdx: number = 0) => {
    const updatedTables = [...localTables];
    if (updatedTables[tableIdx]) {
      const targetTable = { ...updatedTables[tableIdx] };
      const updatedRows = targetTable.rows.filter((_, i) => i !== rowIdx);
      targetTable.rows = updatedRows;
      updatedTables[tableIdx] = targetTable;
      setLocalTables(updatedTables);

      if (tableIdx === 0) {
        setLocalTableRows(updatedRows);
        notifyParentChanges(localFieldValues, updatedRows, updatedTables);
      } else {
        notifyParentChanges(localFieldValues, localTableRows, updatedTables);
      }
    } else {
      const updated = localTableRows.filter((_, i) => i !== rowIdx);
      setLocalTableRows(updated);
      notifyParentChanges(localFieldValues, updated);
    }
  };

  // Calculate live column totals
  const columnTotalsResult = useMemo(() => {
    return calculateColumnTotals(template.table_columns, localTableHeaders, localTableRows);
  }, [template.table_columns, localTableHeaders, localTableRows]);

  // ----------------------------------------------------
  // Edit by Voice Handler
  // ----------------------------------------------------
  const handleToggleVoiceEdit = async () => {
    if (recorder.state === 'Recording') {
      // User clicked to stop recording
      setVoiceStatus('Transcribing voice instruction with Groq Whisper...');
      setIsVoiceProcessing(true);
      try {
        const audioBlob = await recorder.stopRecording();
        if (!audioBlob || audioBlob.size === 0) {
          throw new Error('No audio captured. Please speak clearly into your microphone.');
        }

        // 1. Transcribe audio via existing transcription endpoint
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice_correction.webm');

        const transcribeRes = await fetch(apiUrl('/api/groq/transcribe'), {
          method: 'POST',
          body: formData,
        });

        if (!transcribeRes.ok) {
          const err = await transcribeRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to transcribe audio instruction.');
        }

        const { text: transcript } = await transcribeRes.json();
        if (!transcript || !transcript.trim()) {
          throw new Error('No speech detected in audio recording.');
        }

        setVoiceStatus(`Transcribed: "${transcript}". Applying updates via LLM...`);

        // 2. Send instruction to voice-edit LLM endpoint
        const voiceEditRes = await fetch(apiUrl('/api/handwritten/voice-edit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: transcript,
            currentFieldValues: localFieldValues,
            tableHeaders: localTableHeaders,
            tableRows: localTableRows,
            template,
          }),
        });

        if (!voiceEditRes.ok) {
          const err = await voiceEditRes.json().catch(() => ({}));
          throw new Error(err.error || 'LLM voice correction failed.');
        }

        const result = await voiceEditRes.json();

        // 3. Apply returned field updates
        const updatedFields = { ...localFieldValues };
        if (result.field_values && typeof result.field_values === 'object') {
          Object.entries(result.field_values).forEach(([k, v]) => {
            updatedFields[k] = String(v);
          });
          setLocalFieldValues(updatedFields);
        }

        // 4. Apply returned table rows if modified (complete table returned)
        let updatedRows = localTableRows;
        if (result.table_rows && Array.isArray(result.table_rows)) {
          updatedRows = result.table_rows;
          setLocalTableRows(updatedRows);
        }

        // 5. Update parent state
        notifyParentChanges(updatedFields, updatedRows);

        // 6. Save immediately upon LLM response!
        await onImmediateSave(currentPageIndex);

        setIsSavedRecently(true);
        setTimeout(() => setIsSavedRecently(false), 4000);

        setVoiceSuccessMsg(
          result.explanation || `Updated & saved changes from voice: "${transcript}"`
        );
        setTimeout(() => setVoiceSuccessMsg(null), 6000);
      } catch (err: any) {
        console.error('Voice Edit error:', err);
        setVoiceErrorMsg(err.message || 'Could not apply voice correction.');
        setTimeout(() => setVoiceErrorMsg(null), 5000);
      } finally {
        setIsVoiceProcessing(false);
        setVoiceStatus(null);
        recorder.resetRecorder();
      }
    } else {
      // Start recording
      setVoiceErrorMsg(null);
      setVoiceSuccessMsg(null);
      setVoiceStatus('Listening... Speak your correction (e.g. "Part no 98989898")');
      await recorder.startRecording();
    }
  };

  // Navigate Pages
  const goToPage = (newIdx: number) => {
    if (newIdx >= 0 && newIdx < totalPages) {
      setCurrentPageIndex(newIdx);
      setZoomLevel(1.0);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="w-full h-full max-w-[96vw] max-h-[95vh] bg-card border border-cardBorder rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* MODAL HEADER */}
        <div className="p-3 sm:p-4 border-b border-cardBorder bg-surface flex items-center justify-between gap-3 shrink-0">
          {/* Top-Left: Edit by Voice Button & Recording Indicator */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleVoiceEdit}
              disabled={isVoiceProcessing}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-lg disabled:opacity-50 ${
                recorder.state === 'Recording'
                  ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse ring-4 ring-rose-500/30'
                  : 'bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white shadow-primary/20'
              }`}
            >
              {isVoiceProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Processing Voice...</span>
                </>
              ) : recorder.state === 'Recording' ? (
                <>
                  <Radio className="w-4 h-4 text-white animate-ping" />
                  <span>Stop &amp; Apply Correction</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 text-white" />
                  <span>Edit by Voice</span>
                </>
              )}
            </button>

            {/* Audio volume visualizer indicator during recording */}
            {recorder.state === 'Recording' && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-300 text-xs">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span>Recording... {recorder.durationSeconds}s</span>
                <div className="w-12 h-2 bg-rose-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-400 transition-all duration-75"
                    style={{ width: `${Math.min(100, recorder.volumeLevel * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Auto-saved badge */}
            {isSavedRecently && (
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Saved immediately!</span>
              </div>
            )}
          </div>

          {/* Center: Template & Page Title */}
          <div className="text-center hidden lg:block">
            <h2 className="text-sm font-bold text-text flex items-center justify-center gap-2">
              <span>{template.name}</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-mono">
                Page {currentPageIndex + 1} of {totalPages}
              </span>
            </h2>
            <p className="text-[11px] text-textSubtle">
              Verify extracted values against the original document side-by-side.
            </p>
          </div>

          {/* Top-Right: Page Counter & Close */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-textSubtle bg-surfaceMuted px-2 py-1 rounded-lg border border-cardBorder lg:hidden">
              {currentPageIndex + 1} / {totalPages}
            </span>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
              title="Close review modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* VOICE STATUS & FEEDBACK BANNER */}
        {(voiceStatus || voiceSuccessMsg || voiceErrorMsg) && (
          <div className="px-5 py-2 bg-surface border-b border-cardBorder flex items-center justify-between gap-3 text-xs">
            {voiceStatus && (
              <div className="flex items-center gap-2 text-primary animate-pulse font-medium">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <span>{voiceStatus}</span>
              </div>
            )}
            {voiceSuccessMsg && (
              <div className="flex items-center gap-2 text-emerald-300 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{voiceSuccessMsg}</span>
              </div>
            )}
            {voiceErrorMsg && (
              <div className="flex items-center gap-2 text-rose-300 font-medium">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{voiceErrorMsg}</span>
              </div>
            )}
            <button
              onClick={() => {
                setVoiceStatus(null);
                setVoiceSuccessMsg(null);
                setVoiceErrorMsg(null);
              }}
              className="text-textMuted hover:text-text"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* SPLIT MAIN BODY: LEFT (EXTRACTED DATA) & RIGHT (DOCUMENT PAGE IMAGE) */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-cardBorder">
          {/* LEFT SIDE: Extracted Data & Editable Fields (50%) */}
          <div className="w-full md:w-1/2 h-1/2 md:h-full overflow-y-auto p-4 sm:p-5 space-y-5 bg-background">
            {/* Form Fields Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-cardBorder">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <h3 className="text-xs font-bold text-text uppercase tracking-wider">
                    Extracted Form Fields
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surfaceMuted text-primary border border-cardBorder">
                  {Object.values(localFieldValues).filter(Boolean).length} of{' '}
                  {template.fields.length} detected
                </span>
              </div>

              {/* Grid of Editable Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {template.fields.map((field) => (
                  <div
                    key={field.id}
                    className="p-2.5 rounded-xl bg-surface border border-cardBorder focus-within:border-primary/80 transition space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-text truncate" title={field.field_name}>
                        {field.field_name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 font-mono text-[9px]">
                        <span
                          className={`px-1 py-0.2 rounded font-bold ${
                            field.value_type === 'h'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {field.value_type === 'h' ? '✍️ TrOCR' : '🖨️ Paddle'}
                        </span>
                        <span className="text-textSubtle">
                          {field.look_for === 'right' ? '➡️' : field.look_for === 'down' ? '⬇️' : '⬅️'}
                        </span>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={localFieldValues[field.field_name] || ''}
                      onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                      placeholder={`Enter ${field.field_name}`}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-medium focus:outline-none focus:border-primary placeholder:text-textSubtle"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Multi-Tables Section */}
            {localTables.length > 0 ? (
              <div className="space-y-6 pt-3 border-t border-cardBorder">
                {localTables.map((tbl, tblIdx) => {
                  const tableConfig =
                    (template.tables && template.tables[tblIdx]) ||
                    (tblIdx === 0 ? { columns: template.table_columns } : undefined);
                  const totalsInfo = calculateColumnTotals(
                    tableConfig?.columns || [],
                    tbl.headers || [],
                    tbl.rows || []
                  );

                  return (
                    <div key={tblIdx} className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-cardBorder">
                        <div className="flex items-center gap-2">
                          <TableIcon className="w-4 h-4 text-primary" />
                          <h3 className="text-xs font-bold text-text uppercase tracking-wider">
                            {tbl.name || `Table ${tblIdx + 1}`}
                          </h3>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surfaceMuted text-dataColor dark:text-primary border border-cardBorder">
                            {tbl.rows?.length || 0} {tbl.rows?.length === 1 ? 'row' : 'rows'}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleAddTableRow(tblIdx)}
                            className="px-2 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/40 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Row</span>
                          </button>
                        </div>
                      </div>

                      {/* Table with In-Cell Editing & Column Totals Footer */}
                      <div className="w-full overflow-x-auto rounded-xl border border-cardBorder bg-background scrollbar-thin shadow-inner">
                        <table className="min-w-full w-max text-xs text-left border-collapse table-auto">
                          <thead className="sticky top-0 z-10 bg-surfaceMuted shadow-sm">
                            <tr className="bg-surfaceMuted border-b border-cardBorder text-textMuted font-semibold">
                              <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-[10px] font-mono text-textMuted">#</th>
                              {(tbl.headers || []).map((header, colIdx) => {
                                const colConf = tableConfig?.columns?.find(
                                  (c) => c.column_name.toLowerCase() === header.toLowerCase()
                                );
                                const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                                return (
                                  <th
                                    key={colIdx}
                                    style={{ minWidth: `${minPx}px` }}
                                    className="p-2 font-mono text-[11px] whitespace-nowrap"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-text font-semibold">{header}</span>
                                      {colConf?.is_number && (
                                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-normal">
                                          🔢
                                        </span>
                                      )}
                                      {colConf?.calculate_total && (
                                        <span className="text-[9px] px-1 py-0.2 rounded bg-primary/15 text-primary font-normal">
                                          Σ
                                        </span>
                                      )}
                                    </div>
                                  </th>
                                );
                              })}
                              <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {!tbl.rows || tbl.rows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={(tbl.headers?.length || 0) + 2}
                                  className="p-4 text-center text-textMuted italic text-xs"
                                >
                                  No table rows extracted for this page. Click "+ Add Row" to add entries.
                                </td>
                              </tr>
                            ) : (
                              tbl.rows.map((row: any, rIdx: number) => (
                                <tr
                                  key={rIdx}
                                  className="border-b border-cardBorder hover:bg-surfaceMuted/40 transition"
                                >
                                  <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-[10px] font-mono text-textSubtle">
                                    {rIdx + 1}
                                  </td>
                                  {(tbl.headers || []).map((header, cIdx) => {
                                    const colConf = tableConfig?.columns?.find(
                                      (c) => c.column_name.toLowerCase() === header.toLowerCase()
                                    );
                                    const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                                    let cellValue = '';
                                    if (Array.isArray(row)) {
                                      cellValue = row[cIdx] !== undefined ? String(row[cIdx]) : '';
                                    } else if (typeof row === 'object' && row !== null) {
                                      cellValue = row[header] !== undefined ? String(row[header]) : '';
                                    }

                                    return (
                                      <td
                                        key={cIdx}
                                        style={{ minWidth: `${minPx}px` }}
                                        className="p-1.5"
                                      >
                                        <input
                                          type="text"
                                          value={cellValue}
                                          onChange={(e) =>
                                            handleTableCellChange(rIdx, header, e.target.value, tblIdx)
                                          }
                                          className="w-full min-w-[65px] px-2 py-1 rounded bg-background border border-cardBorder text-xs text-text font-mono focus:outline-none focus:border-primary"
                                          placeholder="-"
                                        />
                                      </td>
                                    );
                                  })}
                                  <td className="p-1.5 w-12 min-w-[48px] max-w-[48px] text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTableRow(rIdx, tblIdx)}
                                      className="p-1 text-textSubtle hover:text-danger rounded hover:bg-surfaceMuted transition cursor-pointer"
                                      title="Delete row"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>

                          {/* Column Totals Footer Row */}
                          {totalsInfo.hasTotals && (
                            <tfoot>
                              <tr className="bg-surface border-t-2 border-primary/30 text-xs font-bold">
                                <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-primary font-mono">Σ</td>
                                {(tbl.headers || []).map((header, cIdx) => {
                                  const colConf = tableConfig?.columns?.find(
                                    (c) => c.column_name.toLowerCase() === header.toLowerCase()
                                  );
                                  const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                                  const totalVal = totalsInfo.totals[header];
                                  return (
                                    <td
                                      key={cIdx}
                                      style={{ minWidth: `${minPx}px` }}
                                      className="p-2 font-mono whitespace-nowrap"
                                    >
                                      {totalVal !== undefined ? (
                                        <div className="flex items-center gap-1 text-primary">
                                          <span className="text-[10px] text-primary">Total:</span>
                                          <span className="font-bold text-sm bg-surfaceMuted px-2 py-0.5 rounded border border-primary/30">
                                            {totalVal}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-textMuted font-normal">-</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="p-2 w-12 min-w-[48px] max-w-[48px]"></td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : localTableHeaders.length > 0 ? (
              <div className="space-y-3 pt-3 border-t border-cardBorder">
                <div className="flex items-center justify-between pb-2 border-b border-cardBorder">
                  <div className="flex items-center gap-2">
                    <TableIcon className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-bold text-text uppercase tracking-wider">
                      Extracted Production Table
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surfaceMuted text-dataColor dark:text-primary border border-cardBorder">
                      {localTableRows.length} {localTableRows.length === 1 ? 'row' : 'rows'}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleAddTableRow(0)}
                      className="px-2 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/40 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Row</span>
                    </button>
                  </div>
                </div>

                {/* Table with In-Cell Editing & Column Totals Footer */}
                <div className="w-full overflow-x-auto rounded-xl border border-cardBorder bg-background scrollbar-thin shadow-inner">
                  <table className="min-w-full w-max text-xs text-left border-collapse table-auto">
                    <thead className="sticky top-0 z-10 bg-surfaceMuted shadow-sm">
                      <tr className="bg-surfaceMuted border-b border-cardBorder text-textMuted font-semibold">
                        <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-[10px] font-mono text-textMuted">#</th>
                        {localTableHeaders.map((header, colIdx) => {
                          const colConf = template.table_columns.find(
                            (c) => c.column_name.toLowerCase() === header.toLowerCase()
                          );
                          const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                          return (
                            <th
                              key={colIdx}
                              style={{ minWidth: `${minPx}px` }}
                              className="p-2 font-mono text-[11px] whitespace-nowrap"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-text font-semibold">{header}</span>
                                {colConf?.is_number && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-normal">
                                    🔢
                                  </span>
                                )}
                                {colConf?.calculate_total && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-primary/15 text-primary font-normal">
                                    Σ
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                        <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {localTableRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={localTableHeaders.length + 2}
                            className="p-4 text-center text-textMuted italic text-xs"
                          >
                            No table rows extracted for this page. Click "+ Add Row" to add entries.
                          </td>
                        </tr>
                      ) : (
                        localTableRows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className="border-b border-cardBorder hover:bg-surfaceMuted/40 transition"
                          >
                            <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-[10px] font-mono text-textSubtle">
                              {rIdx + 1}
                            </td>
                            {localTableHeaders.map((header, cIdx) => {
                              const colConf = template.table_columns.find(
                                (c) => c.column_name.toLowerCase() === header.toLowerCase()
                              );
                              const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                              let cellValue = '';
                              if (Array.isArray(row)) {
                                cellValue = row[cIdx] !== undefined ? String(row[cIdx]) : '';
                              } else if (typeof row === 'object' && row !== null) {
                                cellValue = row[header] !== undefined ? String(row[header]) : '';
                              }

                              return (
                                <td
                                  key={cIdx}
                                  style={{ minWidth: `${minPx}px` }}
                                  className="p-1.5"
                                >
                                  <input
                                    type="text"
                                    value={cellValue}
                                    onChange={(e) =>
                                      handleTableCellChange(rIdx, header, e.target.value, 0)
                                    }
                                    className="w-full min-w-[65px] px-2 py-1 rounded bg-background border border-cardBorder text-xs text-text font-mono focus:outline-none focus:border-primary"
                                    placeholder="-"
                                  />
                                </td>
                              );
                            })}
                            <td className="p-1.5 w-12 min-w-[48px] max-w-[48px] text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteTableRow(rIdx, 0)}
                                className="p-1 text-textSubtle hover:text-danger rounded hover:bg-surfaceMuted transition cursor-pointer"
                                title="Delete row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>

                    {/* Column Totals Footer Row */}
                    {columnTotalsResult.hasTotals && (
                      <tfoot>
                        <tr className="bg-surface border-t-2 border-primary/30 text-xs font-bold">
                          <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-primary font-mono">Σ</td>
                          {localTableHeaders.map((header, cIdx) => {
                            const colConf = template.table_columns.find(
                              (c) => c.column_name.toLowerCase() === header.toLowerCase()
                            );
                            const minPx = getTableColumnMinWidthPx(header, colConf?.is_number);
                            const totalVal = columnTotalsResult.totals[header];
                            return (
                              <td
                                key={cIdx}
                                style={{ minWidth: `${minPx}px` }}
                                className="p-2 font-mono whitespace-nowrap"
                              >
                                {totalVal !== undefined ? (
                                  <div className="flex items-center gap-1 text-primary">
                                    <span className="text-[10px] text-primary">Total:</span>
                                    <span className="font-bold text-sm bg-surfaceMuted px-2 py-0.5 rounded border border-primary/30">
                                      {totalVal}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-textMuted font-normal">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2 w-12 min-w-[48px] max-w-[48px]"></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            ) : null}
          </div>

          {/* RIGHT SIDE: Corresponding PDF Page / Document Image (50%) */}
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col bg-card relative overflow-hidden">
            {/* Image Preview Toolbar */}
            <div className="p-2.5 bg-surface border-b border-cardBorder flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2 text-text font-semibold">
                <span>Original Document</span>
                <span className="px-2 py-0.5 rounded bg-surfaceMuted text-primary font-mono text-[10px] border border-cardBorder">
                  Page {currentPageIndex + 1} of {totalPages}
                </span>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.2))}
                  className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-text border border-cardBorder transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-textSubtle w-12 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3.0, z + 0.2))}
                  className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-text border border-cardBorder transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1.0)}
                  className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder transition cursor-pointer ml-1"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Document Image Display Container */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-card">
              {activePage.imageUrl ? (
                <div
                  className="transition-transform duration-100 ease-out origin-top flex items-center justify-center"
                  style={{ transform: `scale(${zoomLevel})` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activePage.imageUrl}
                    alt={`Document Page ${activePage.pageNumber}`}
                    className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl border border-cardBorder bg-white"
                  />
                </div>
              ) : (
                <div className="text-center p-8 space-y-3 max-w-sm">
                  <div className="w-12 h-12 rounded-2xl bg-surface border border-cardBorder text-textSubtle flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-text">No Rendered Image Available</h4>
                    <p className="text-xs text-textSubtle mt-1">
                      Showing raw extracted OCR text for Page {activePage.pageNumber}:
                    </p>
                  </div>
                  <div className="text-left p-3 rounded-xl bg-surface border border-cardBorder font-mono text-[11px] text-text max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {activePage.ocrText || 'No text recorded for this page.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MODAL FOOTER & PAGE NAVIGATION */}
        <div className="p-3 sm:p-4 border-t border-cardBorder bg-surface flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-textMuted">
            <span className="hidden sm:inline">
              Page {currentPageIndex + 1} of {totalPages}
            </span>
            <span className="text-[11px] text-textSubtle hidden md:inline">
              • All edits are continuously auto-saved.
            </span>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-2">
            {currentPageIndex > 0 && (
              <button
                type="button"
                onClick={() => goToPage(currentPageIndex - 1)}
                className="px-3.5 py-2 rounded-xl bg-surface hover:bg-surfaceMuted text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border border-cardBorder"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous Page</span>
              </button>
            )}

            {onSaveAll && (
              <button
                type="button"
                onClick={async () => {
                  await onSaveAll();
                  setIsSavedRecently(true);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-primary/20"
                title="Save all entries to database"
              >
                <Save className="w-4 h-4" />
                <span>Save All</span>
              </button>
            )}

            {currentPageIndex < totalPages - 1 ? (
              <button
                type="button"
                onClick={() => goToPage(currentPageIndex + 1)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-primary/20"
              >
                <span>Next Page</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-600/20"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Done &amp; Close</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
