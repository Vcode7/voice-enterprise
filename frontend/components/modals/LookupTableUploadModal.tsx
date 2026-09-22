'use client';

import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  Layers,
  Table as TableIcon,
  Sparkles,
  FileText,
  ChevronRight,
  Info,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LookupTable, LookupTableRow, LookupTableMergeStats, LookupMergeStrategy } from '@/types';
import {
  readSpreadsheetWorkbook,
  extractDataFromWorksheet,
  summarizeWorkbookSheets,
  getWorksheetRawRows,
  RawSheetRow,
  ParsedWorksheetSummary,
  isExcelFile,
} from '@/lib/utils/spreadsheetParser';
import { apiUrl } from '@/lib/api/apiClient';

interface LookupTableUploadModalProps {
  onClose: () => void;
  onUploaded: (newTable: LookupTable) => void;
  mode?: 'create' | 'append';
  existingTable?: LookupTable;
}

export function LookupTableUploadModal({
  onClose,
  onUploaded,
  mode = 'create',
  existingTable,
}: LookupTableUploadModalProps) {
  const isAppendMode = mode === 'append' && Boolean(existingTable);

  const [tableName, setTableName] = useState(existingTable?.name || '');
  const [description, setDescription] = useState(existingTable?.description || '');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string | null>(null);
  const [isExcel, setIsExcel] = useState(false);

  // Merge options for append mode
  const [selectedKeyColumn, setSelectedKeyColumn] = useState<string>(
    existingTable?.columns?.[0] || ''
  );
  const [mergeStrategy, setMergeStrategy] = useState<LookupMergeStrategy>('update');

  // Workbook & Worksheet states
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [sheetsSummary, setSheetsSummary] = useState<ParsedWorksheetSummary[]>([]);

  // Parsed table state
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState<boolean>(true);
  const [headerRowSelection, setHeaderRowSelection] = useState<number | 'none'>(0);
  const [rawSheetRows, setRawSheetRows] = useState<RawSheetRow[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const processFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    setFileSizeStr(formatFileSize(file.size));

    const excelCheck = isExcelFile(file.name) || isExcelFile(file.type || '');
    setIsExcel(excelCheck);

    const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    if (!tableName) {
      setTableName(baseName);
    }

    try {
      setLoading(true);
      const arrayBuffer = await file.arrayBuffer();
      const wb = readSpreadsheetWorkbook(arrayBuffer);

      if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('No worksheets or valid tabular data found in file.');
      }

      const availableSheets = wb.SheetNames;
      const summaries = summarizeWorkbookSheets(wb, { firstRowIsHeader });
      setWorkbook(wb);
      setSheetNames(availableSheets);
      setSheetsSummary(summaries);

      // Default to first sheet with rows, or first sheet
      const firstValidSheet =
        summaries.find((s) => s.rowCount > 0 && s.columnCount > 0)?.name ||
        availableSheets[0];

      setSelectedSheet(firstValidSheet);

      // Extract data & raw preview from the selected sheet
      const ws = wb.Sheets[firstValidSheet];
      const previewRows = getWorksheetRawRows(ws, 6);
      setRawSheetRows(previewRows);

      const isHeaderEnabled = headerRowSelection !== 'none';
      const rowIndex = headerRowSelection !== 'none' ? headerRowSelection : undefined;
      const { headers, rows } = extractDataFromWorksheet(ws, {
        firstRowIsHeader: isHeaderEnabled,
        headerRowIndex: rowIndex,
      });

      if (headers.length === 0 || rows.length === 0) {
        setError(
          `Sheet "${firstValidSheet}" does not contain valid rows or columns. Please select another sheet or check the file.`
        );
        setParsedHeaders([]);
        setParsedRows([]);
        return;
      }

      setParsedHeaders(headers);
      setParsedRows(rows);
    } catch (err: any) {
      console.error('Spreadsheet parse error:', err);
      setError(err.message || 'Failed to parse file. Please upload a valid CSV or Excel file.');
      setParsedHeaders([]);
      setParsedRows([]);
      setWorkbook(null);
      setSheetNames([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleSelectSheet = (sheetName: string) => {
    if (!workbook || sheetName === selectedSheet) return;

    setError(null);
    setSelectedSheet(sheetName);

    const ws = workbook.Sheets[sheetName];
    if (!ws) {
      setError(`Cannot find sheet "${sheetName}".`);
      return;
    }

    const rawRows = getWorksheetRawRows(ws, 6);
    setRawSheetRows(rawRows);

    const isHeaderEnabled = headerRowSelection !== 'none';
    const rowIndex = headerRowSelection !== 'none' ? headerRowSelection : undefined;
    const { headers, rows } = extractDataFromWorksheet(ws, {
      firstRowIsHeader: isHeaderEnabled,
      headerRowIndex: rowIndex,
    });
    if (headers.length === 0 || rows.length === 0) {
      setError(
        `Selected sheet "${sheetName}" is empty or has no data columns. Please select a sheet with data.`
      );
    }

    setParsedHeaders(headers);
    setParsedRows(rows);
  };

  const applyHeaderRowSelection = (
    selection: number | 'none',
    currentWb?: XLSX.WorkBook | null,
    sheetName?: string
  ) => {
    setHeaderRowSelection(selection);
    const isHeaderEnabled = selection !== 'none';
    const rowIndex = selection !== 'none' ? selection : undefined;
    setFirstRowIsHeader(isHeaderEnabled);

    const activeWb = currentWb || workbook;
    const activeSheet = sheetName || selectedSheet;

    if (activeWb && activeSheet) {
      const ws = activeWb.Sheets[activeSheet];
      if (ws) {
        const { headers, rows } = extractDataFromWorksheet(ws, {
          firstRowIsHeader: isHeaderEnabled,
          headerRowIndex: rowIndex,
        });

        if (headers.length === 0 || rows.length === 0) {
          setError(
            `Sheet "${activeSheet}" does not contain valid data rows with the selected header row.`
          );
        } else {
          setError(null);
          setParsedHeaders(headers);
          setParsedRows(rows);
        }

        const summaries = summarizeWorkbookSheets(activeWb, {
          firstRowIsHeader: isHeaderEnabled,
          headerRowIndex: rowIndex,
        });
        setSheetsSummary(summaries);
      }
    }
  };

  const previewConflictStats = React.useMemo(() => {
    if (!isAppendMode || !existingTable || parsedRows.length === 0) return null;
    const keyCol = selectedKeyColumn || existingTable.columns[0];
    if (!keyCol) return null;

    const existingKeySet = new Set(
      (existingTable.rows || []).map((r) => String(r[keyCol] || '').trim().toLowerCase())
    );

    let matchCount = 0;
    let newCount = 0;

    parsedRows.forEach((r) => {
      const k = String(r[keyCol] || '').trim().toLowerCase();
      if (k && existingKeySet.has(k)) {
        matchCount++;
      } else {
        newCount++;
      }
    });

    const newCols = parsedHeaders.filter((c) => !existingTable.columns.includes(c));

    return {
      matchCount,
      newCount,
      newCols,
    };
  }, [isAppendMode, existingTable, parsedRows, parsedHeaders, selectedKeyColumn]);

  const handleSave = async () => {
    if (!isAppendMode && !tableName.trim()) {
      setError('Please provide a name for this lookup table.');
      return;
    }
    if (parsedHeaders.length === 0 || parsedRows.length === 0) {
      setError('Please upload a CSV or Excel table with at least one column and row of data.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (isAppendMode && existingTable) {
        const keyCol = selectedKeyColumn || existingTable.columns[0] || parsedHeaders[0];
        const payload = {
          columns: parsedHeaders,
          rows: parsedRows,
          key_column: keyCol,
          strategy: mergeStrategy,
        };

        const res = await fetch(apiUrl(`/api/lookup-tables/${existingTable.id}/merge`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.error || 'Failed to merge mapping data.');
        }

        const resData = await res.json();
        onUploaded(resData.table || resData);
        return;
      }

      const rowsPayload: LookupTableRow[] = parsedRows.map((r, idx) => ({
        id: `row_${Date.now()}_${idx}`,
        ...r,
      }));

      // Enrich description if multi-sheet Excel
      let finalDescription = description.trim();
      if (!finalDescription && isExcel && sheetNames.length > 1) {
        finalDescription = `Imported from sheet "${selectedSheet}" of ${fileName}`;
      }

      const payload = {
        name: tableName.trim(),
        description: finalDescription || undefined,
        columns: parsedHeaders,
        rows: rowsPayload,
      };

      const res = await fetch(apiUrl('/api/lookup-tables'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save lookup table.');
      }

      const savedTable: LookupTable = await res.json();
      onUploaded(savedTable);
    } catch (err: any) {
      setError(err.message || 'Failed to save lookup table.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-2xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center border border-primary/30 shadow-sm">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-text">
                  {isAppendMode ? `Add More Mapping Data` : 'Upload Master Lookup Table'}
                </h2>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                  {isAppendMode ? 'Merge & Append' : 'CSV & Excel (.xlsx, .xls)'}
                </span>
              </div>
              <p className="text-xs text-textMuted mt-0.5">
                {isAppendMode
                  ? `Merge additional mapping data into existing table "${existingTable?.name}" without losing existing records.`
                  : 'Upload master catalog or parts data to enable instant voice auto-fill & validation in Template Mode.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {error && (
            <div className="p-3.5 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Table Details OR Target Table Summary */}
          {isAppendMode && existingTable ? (
            <div className="p-3.5 rounded-xl bg-surface border border-primary/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-primary">Target Table: {existingTable.name}</span>
                <span className="font-mono text-textMuted text-[11px]">
                  {existingTable.rows?.length || 0} existing records • {existingTable.columns?.length || 0} columns
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-textSubtle font-bold uppercase mr-1">Existing Columns:</span>
                {existingTable.columns.map((col) => (
                  <span key={col} className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-surfaceMuted text-primary border border-cardBorder">
                    {col}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-textSubtle uppercase tracking-wider">
                  Table Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="e.g. Parts Master Catalog"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-textSubtle uppercase tracking-wider">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 2026 Production Machine & Parts Master"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                />
              </div>
            </div>
          )}

          {/* Upload Dropzone */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-textSubtle uppercase tracking-wider">
                Upload File (CSV or Excel)
              </label>
              <span className="text-[11px] text-primary font-medium">
                Supports .xlsx, .xls, .csv, .tsv
              </span>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-5 sm:p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group ${
                isDragging
                  ? 'border-primary bg-surfaceMuted'
                  : 'border-cardBorder hover:border-primary/50 bg-surface/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="w-12 h-12 rounded-full bg-surface border border-cardBorder flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary/15 group-hover:border-primary/50 transition shadow-inner">
                {isExcel ? <FileSpreadsheet className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
              </div>

              <div>
                <p className="text-xs sm:text-sm font-bold text-text flex items-center justify-center gap-1.5">
                  {fileName ? (
                    <>
                      <span>{fileName}</span>
                      {fileSizeStr && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-surfaceMuted text-textSubtle border border-cardBorder">
                          {fileSizeStr}
                        </span>
                      )}
                    </>
                  ) : (
                    'Click to browse or drop CSV / Excel spreadsheet'
                  )}
                </p>
                <p className="text-[11px] text-textSubtle mt-1">
                  Single or multi-sheet Excel workbooks (.xlsx, .xls) and standard CSV/TSV tables
                </p>
              </div>
            </div>
          </div>

          {/* ⚡ Header Row Selection (Row 1, Row 2, Row 3, Row 4, or No Header) */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-cardBorder space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-cardBorder/60 pb-2.5">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-text flex items-center gap-1.5 flex-wrap">
                  <TableIcon className="w-3.5 h-3.5 text-primary" />
                  <span>Column Header Row Selection</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold border border-primary/30">
                    {headerRowSelection === 'none' ? 'No Header Row' : `Row ${headerRowSelection + 1} is Header`}
                  </span>
                </div>
                <p className="text-[11px] text-textMuted">
                  Select which row in your Excel sheet contains the column names (e.g. Part No, Machine Name).
                </p>
              </div>

              {/* Quick Preset Selector Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {[0, 1, 2, 3].map((rowIdx) => {
                  const isSelected = headerRowSelection === rowIdx;
                  return (
                    <button
                      key={rowIdx}
                      type="button"
                      onClick={() => applyHeaderRowSelection(rowIdx)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-white shadow-sm shadow-primary/20'
                          : 'bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder'
                      }`}
                    >
                      Row {rowIdx + 1}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => applyHeaderRowSelection('none')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    headerRowSelection === 'none'
                      ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/25'
                      : 'bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder'
                  }`}
                  title="Import all rows as data with generic column names (Column 1, 2...)"
                >
                  No Header
                </button>
              </div>
            </div>

            {/* Interactive Row Inspector Cards (if file loaded with rows) */}
            {rawSheetRows.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold text-textSubtle uppercase tracking-wider block">
                  Click a row below to use it as the column header:
                </span>
                <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {rawSheetRows.slice(0, 5).map((row) => {
                    const isSelected = headerRowSelection === row.rowIndex;
                    return (
                      <div
                        key={row.rowIndex}
                        onClick={() => applyHeaderRowSelection(row.rowIndex)}
                        className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                          isSelected
                            ? 'bg-surfaceMuted border-primary text-primary'
                            : 'bg-background hover:bg-surfaceMuted border-cardBorder text-textMuted hover:text-text'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                              isSelected
                                ? 'bg-primary text-white'
                                : 'bg-surfaceMuted text-textSubtle border border-cardBorder'
                            }`}
                          >
                            Row {row.rowNumber}
                          </span>
                          <span className="truncate font-mono text-[11px]">
                            {row.previewText}
                          </span>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {isSelected ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary flex items-center gap-1">
                              <Check className="w-3 h-3 stroke-[3]" />
                              <span>Selected Header</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-textSubtle hover:text-primary font-semibold">
                              Set as Header
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ⚡ MULTI-WORKSHEET SELECTOR (Shown when multiple sheets detected in Excel) */}
          {sheetNames.length > 1 && (
            <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-primary/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">
                    Select Worksheet ({sheetNames.length} Detected)
                  </span>
                </div>
                <span className="text-[11px] text-textMuted flex items-center gap-1">
                  <Info className="w-3 h-3 text-primary" />
                  <span>Choose which sheet to import for autofill</span>
                </span>
              </div>

              {/* Sheet Selection Pills / Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                {sheetsSummary.map((sheet) => {
                  const isSelected = sheet.name === selectedSheet;
                  const hasData = sheet.rowCount > 0 && sheet.columnCount > 0;

                  return (
                    <button
                      key={sheet.name}
                      type="button"
                      onClick={() => handleSelectSheet(sheet.name)}
                      className={`p-2.5 rounded-xl text-left transition flex items-center justify-between border cursor-pointer ${
                        isSelected
                          ? 'bg-primary/15 border-primary text-primary shadow-sm shadow-primary/20'
                          : 'bg-card hover:bg-surfaceMuted border-cardBorder text-textMuted hover:text-text'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet
                            className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-textSubtle'}`}
                          />
                          <span
                            className={`text-xs font-bold truncate ${
                              isSelected ? 'text-primary' : 'text-text'
                            }`}
                          >
                            {sheet.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-textSubtle mt-0.5">
                          {hasData ? (
                            <span>
                              {sheet.rowCount} rows • {sheet.columnCount} cols
                            </span>
                          ) : (
                            <span className="text-amber-400">Empty worksheet</span>
                          )}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-primary text-slate-950 flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Single Sheet Info Badge if Excel with 1 sheet */}
          {sheetNames.length === 1 && isExcel && (
            <div className="px-3.5 py-2 rounded-xl bg-surface border border-cardBorder text-xs text-textMuted flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-primary" />
                <span>
                  Worksheet: <strong className="text-text font-semibold">{sheetNames[0]}</strong>
                </span>
              </div>
              <span className="text-[11px] text-emerald-400 font-medium">Ready to import</span>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedHeaders.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-text flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Detected {parsedHeaders.length} Columns &amp; {parsedRows.length} Records
                  </span>
                  {selectedSheet && sheetNames.length > 1 && (
                    <span className="text-[11px] text-primary font-semibold ml-1">
                      (from &ldquo;{selectedSheet}&rdquo;)
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-textSubtle">Preview (Top 5 rows)</span>
              </div>

              {/* Column Tags */}
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-surface/50 border border-cardBorder max-h-20 overflow-y-auto">
                <span className="text-[10px] text-textSubtle font-bold uppercase py-0.5 mr-1 self-center">
                  Columns in New File:
                </span>
                {parsedHeaders.map((col, idx) => (
                  <span
                    key={col + idx}
                    className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-lg bg-surfaceMuted text-primary border border-cardBorder"
                  >
                    {col}
                  </span>
                ))}
              </div>

              {/* Append Mode: Merge & Conflict Settings */}
              {isAppendMode && existingTable && (
                <div className="p-4 rounded-xl bg-surface border border-primary/30 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                    <Layers className="w-4 h-4 text-primary" />
                    <span>Merge &amp; Duplicate Handling</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Key Column Selector */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-textSubtle uppercase tracking-wider block">
                        Match / Deduplicate on Column
                      </label>
                      <select
                        value={selectedKeyColumn}
                        onChange={(e) => setSelectedKeyColumn(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-background border border-primary/40 text-xs text-text focus:outline-none font-bold"
                      >
                        {existingTable.columns.map((c) => (
                          <option key={c} value={c}>
                            {c} {parsedHeaders.includes(c) ? '✓ (in new file)' : ''}
                          </option>
                        ))}
                        {parsedHeaders
                          .filter((c) => !existingTable.columns.includes(c))
                          .map((c) => (
                            <option key={c} value={c}>
                              {c} (new column)
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-textSubtle">
                        Records sharing the same key value will be checked for updates or conflicts.
                      </p>
                    </div>

                    {/* Conflict Strategy Selector */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-textSubtle uppercase tracking-wider block">
                        Conflict Strategy
                      </label>
                      <div className="space-y-1">
                        {[
                          { id: 'update', label: 'Update Existing (Recommended)', desc: 'Merge new attributes without wiping previous mappings' },
                          { id: 'skip', label: 'Skip Duplicates', desc: 'Keep existing row unchanged, ignore incoming duplicates' },
                          { id: 'append', label: 'Append All', desc: 'Always insert as new separate rows' },
                        ].map((opt) => (
                          <label
                            key={opt.id}
                            className={`flex items-start gap-2 p-1.5 rounded-lg border text-xs cursor-pointer transition ${
                              mergeStrategy === opt.id
                                ? 'bg-primary/15 border-primary/40 text-primary'
                                : 'bg-background border-cardBorder text-textSubtle hover:text-text'
                            }`}
                          >
                            <input
                              type="radio"
                              name="mergeStrategy"
                              value={opt.id}
                              checked={mergeStrategy === opt.id}
                              onChange={() => setMergeStrategy(opt.id as any)}
                              className="mt-0.5 text-primary focus:ring-primary"
                            />
                            <div>
                              <div className="font-bold text-[11px]">{opt.label}</div>
                              <div className="text-[10px] opacity-75">{opt.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Real-time preview analysis banner */}
                  {previewConflictStats && (
                    <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-card border border-cardBorder text-xs">
                      <span className="text-textSubtle font-semibold text-[11px]">Analysis:</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold font-mono text-[10px] border border-emerald-500/30">
                        +{previewConflictStats.newCount} New Rows
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold font-mono text-[10px] border border-amber-500/30">
                        {previewConflictStats.matchCount} Matched on "{selectedKeyColumn}" ({mergeStrategy === 'update' ? 'will update' : mergeStrategy === 'skip' ? 'will skip' : 'will append'})
                      </span>
                      {previewConflictStats.newCols.length > 0 && (
                        <span className="px-2 py-0.5 rounded bg-primary/15 text-primary font-bold font-mono text-[10px] border border-primary/30">
                          +{previewConflictStats.newCols.length} New Columns
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Scrollable Data Table Preview */}
              <div className="max-h-48 overflow-x-auto overflow-y-auto rounded-xl border border-cardBorder bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surfaceMuted border-b border-cardBorder text-textSubtle sticky top-0 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="px-2.5 py-2 w-10 text-center text-textSubtle">#</th>
                      {parsedHeaders.map((col, idx) => (
                        <th key={col + idx} className="px-3 py-2 whitespace-nowrap text-text">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cardBorder/40 font-mono text-[11px]">
                    {parsedRows.slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="hover:bg-surfaceMuted/50 transition">
                        <td className="px-2.5 py-1.5 text-center text-textSubtle font-sans">{idx + 1}</td>
                        {parsedHeaders.map((col, cIdx) => (
                          <td key={col + cIdx} className="px-3 py-1.5 text-textMuted whitespace-nowrap">
                            {row[col] !== undefined && row[col] !== '' ? row[col] : <span className="text-textSubtle italic">-</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-cardBorder/60 shrink-0">
          <div className="text-[11px] text-textSubtle hidden sm:block">
            {parsedRows.length > 0 ? (
              <span>
                {parsedRows.length} incoming records ready {isAppendMode ? 'to merge with master catalog' : 'to be registered in master catalog'}
              </span>
            ) : (
              <span>Upload CSV or Excel file to get started</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || parsedHeaders.length === 0 || parsedRows.length === 0}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-primary/20 transition cursor-pointer disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isAppendMode ? `Merge Mapping Data (${parsedRows.length})` : 'Save Master Table'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
