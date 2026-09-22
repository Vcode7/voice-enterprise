'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Search,
  Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  readSpreadsheetWorkbook,
  summarizeWorkbookSheets,
  extractDataFromWorksheet,
  ParsedWorksheetSummary,
} from '@/lib/utils/spreadsheetParser';

interface FixedValueFileUploaderProps {
  currentColumnName?: string;
  currentValues?: string[];
  currentFileName?: string;
  onLoaded: (columnName: string, values: string[], fileName: string) => void;
}

export function FixedValueFileUploader({
  currentColumnName,
  currentValues = [],
  currentFileName,
  onLoaded,
}: FixedValueFileUploaderProps) {
  const [fileName, setFileName] = useState<string | null>(currentFileName || null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetsSummary, setSheetsSummary] = useState<ParsedWorksheetSummary[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>(currentColumnName || '');
  const [loadedValues, setLoadedValues] = useState<string[]>(currentValues);

  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Extracts columns and unique non-empty values from a target sheet
   */
  const extractSheetData = (
    wb: XLSX.WorkBook,
    sheetName: string,
    fName: string,
    preferredColumn?: string
  ) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      setColumns([]);
      setLoadedValues([]);
      setWarning(`Cannot access worksheet "${sheetName}".`);
      return;
    }

    try {
      // Extract data using smart header detection
      let { headers, rows } = extractDataFromWorksheet(ws, { firstRowIsHeader: true });

      // Fallback: If no rows found with firstRowIsHeader, try without header row (treat all as data)
      if ((!headers || headers.length === 0 || rows.length === 0) && ws['!ref']) {
        const fallback = extractDataFromWorksheet(ws, { firstRowIsHeader: false });
        if (fallback.headers.length > 0 && fallback.rows.length > 0) {
          headers = fallback.headers;
          rows = fallback.rows;
        }
      }

      if (!headers || headers.length === 0 || !rows || rows.length === 0) {
        setColumns([]);
        setLoadedValues([]);
        setWarning(
          `Sheet "${sheetName}" is empty (contains no tabular data rows). Please select another worksheet from the dropdown above.`
        );
        return;
      }

      // Valid data found: clear any warning and populate columns
      setWarning(null);
      setError(null);
      setColumns(headers);

      // Determine which column to pick
      let targetCol = preferredColumn && headers.includes(preferredColumn) ? preferredColumn : '';
      if (!targetCol && selectedColumn && headers.includes(selectedColumn)) {
        targetCol = selectedColumn;
      }
      if (!targetCol) {
        targetCol = headers[0];
      }

      setSelectedColumn(targetCol);

      // Extract unique non-empty values from this column
      extractColumnValues(rows, targetCol, fName);
    } catch (err: any) {
      console.error('Failed to extract data from sheet:', err);
      setWarning(`Error reading sheet "${sheetName}": ${err.message || 'Unknown error'}`);
    }
  };

  /**
   * Pulls unique non-empty values for a given column from the parsed rows
   */
  const extractColumnValues = (rows: Record<string, string>[], col: string, fName: string) => {
    if (!col || !rows || rows.length === 0) return;

    const rawValues = rows
      .map((r) => String(r[col] !== undefined && r[col] !== null ? r[col] : '').trim())
      .filter((v) => v !== '');

    const uniqueValues = Array.from(new Set(rawValues));

    if (uniqueValues.length === 0) {
      setLoadedValues([]);
      setWarning(`Column "${col}" contains no non-empty values. Please select another column.`);
      return;
    }

    setWarning(null);
    setError(null);
    setLoadedValues(uniqueValues);
    onLoaded(col, uniqueValues, fName);
  };

  /**
   * Handles user file selection (Excel / CSV)
   */
  const processFile = async (file: File) => {
    setError(null);
    setWarning(null);
    setLoading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = readSpreadsheetWorkbook(arrayBuffer);

      if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('Spreadsheet contains no worksheets or valid data.');
      }

      const availableSheets = wb.SheetNames;
      const summaries = summarizeWorkbookSheets(wb, { firstRowIsHeader: true });

      setWorkbook(wb);
      setSheetNames(availableSheets);
      setSheetsSummary(summaries);
      setFileName(file.name);

      // Intelligently select the first worksheet that actually has data
      const firstValidSheet =
        summaries.find((s) => s.rowCount > 0 && s.columnCount > 0)?.name ||
        availableSheets[0];

      setSelectedSheet(firstValidSheet);

      // Extract columns and values from the selected sheet
      extractSheetData(wb, firstValidSheet, file.name, currentColumnName);
    } catch (err: any) {
      console.error('Fixed value file error:', err);
      setError(
        err.message ||
          'Failed to parse file. Please make sure it is a valid .xlsx, .xls, or .csv spreadsheet.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // reset file input value so re-selecting same file triggers onChange
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleSheetChange = (sheet: string) => {
    if (!workbook || sheet === selectedSheet) return;
    setSelectedSheet(sheet);
    setWarning(null);
    setError(null);
    extractSheetData(workbook, sheet, fileName || 'file.xlsx', selectedColumn);
  };

  const handleColumnChange = (col: string) => {
    setSelectedColumn(col);
    if (!workbook || !selectedSheet) return;

    const ws = workbook.Sheets[selectedSheet];
    if (!ws) return;

    let { rows } = extractDataFromWorksheet(ws, { firstRowIsHeader: true });
    if ((!rows || rows.length === 0) && ws['!ref']) {
      const fallback = extractDataFromWorksheet(ws, { firstRowIsHeader: false });
      rows = fallback.rows;
    }

    extractColumnValues(rows, col, fileName || 'file.xlsx');
  };

  // Filtered values for the preview badge list
  const filteredValues = useMemo(() => {
    if (!filterQuery.trim()) return loadedValues;
    const q = filterQuery.toLowerCase().trim();
    return loadedValues.filter((v) => v.toLowerCase().includes(q));
  }, [loadedValues, filterQuery]);

  return (
    <div className="space-y-2.5 p-3 rounded-xl bg-surface border border-cardBorder text-xs">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Error Alert */}
      {error && (
        <div className="p-2.5 rounded-lg bg-danger/15 border border-danger/30 text-danger text-[11px] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Warning / Non-fatal Notice (e.g. empty sheet, choose another) */}
      {warning && (
        <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="leading-snug">{warning}</div>
        </div>
      )}

      {/* Upload Trigger / Current File Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
          {fileName ? (
            <div className="min-w-0">
              <span className="text-text font-bold text-xs truncate max-w-[200px] sm:max-w-xs block">
                {fileName}
              </span>
              {sheetNames.length > 1 && (
                <span className="text-[10px] text-primary/80 flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  <span>{sheetNames.length} worksheets detected</span>
                </span>
              )}
            </div>
          ) : (
            <span className="text-textSubtle text-xs">Upload spreadsheet to load allowed fixed values</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Parsing...</span>
            </>
          ) : (
            <>
              <Upload className="w-3 h-3" />
              <span>{fileName ? 'Replace File' : 'Upload .xlsx / .csv'}</span>
            </>
          )}
        </button>
      </div>

      {/* Multi-Sheet & Column Selector Section */}
      {/* We display the controls whenever a file with sheets is loaded, even if the first sheet is empty! */}
      {sheetNames.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-cardBorder">
          {/* Worksheet Selector (Always visible for multi-sheet workbooks) */}
          {sheetNames.length > 1 && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center gap-1">
                <Layers className="w-3 h-3 text-primary" />
                <span>Worksheet ({sheetNames.length})</span>
              </label>
              <select
                value={selectedSheet}
                onChange={(e) => handleSheetChange(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              >
                {sheetNames.map((sName) => {
                  const summary = sheetsSummary.find((s) => s.name === sName);
                  const count = summary?.rowCount ?? 0;
                  const label = count > 0 ? `${sName} (${count} rows)` : `${sName} (Empty)`;
                  return (
                    <option key={sName} value={sName}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Column Selector */}
          <div className={sheetNames.length > 1 ? 'space-y-1' : 'space-y-1 sm:col-span-2'}>
            <label className="text-[10px] font-bold text-primary uppercase tracking-wider block">
              Select Column for Fixed Values
            </label>
            {columns.length > 0 ? (
              <select
                value={selectedColumn}
                onChange={(e) => handleColumnChange(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-primary/40 text-xs text-text font-bold focus:outline-none focus:border-primary"
              >
                {columns.map((c) => (
                  <option key={c} value={c} className="bg-card text-text">
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-2.5 py-1.5 rounded-lg bg-surfaceMuted/60 border border-cardBorder text-textSubtle text-xs italic">
                No columns available in "{selectedSheet}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Values Summary & Badges Preview */}
      {loadedValues.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-cardBorder">
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
            <span className="font-bold text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>
                Loaded {loadedValues.length} unique allowed values from "{selectedColumn}"
                {selectedSheet && sheetNames.length > 1 ? ` (${selectedSheet})` : ''}
              </span>
            </span>

            {/* Quick Search if more than 8 values */}
            {loadedValues.length > 8 && (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter values..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="px-2 py-0.5 pl-5 rounded bg-background border border-cardBorder text-[10px] text-text placeholder-textSubtle focus:outline-none focus:border-primary w-28 sm:w-36"
                />
                <Search className="w-3 h-3 text-textSubtle absolute left-1.5 top-1.5" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-2 rounded-lg bg-surface border border-cardBorder">
            {filteredValues.slice(0, 30).map((val, idx) => (
              <span
                key={val + idx}
                className="text-[10px] px-2 py-0.5 rounded bg-surfaceMuted hover:bg-card border border-cardBorder text-primary font-mono select-all transition"
                title={val}
              >
                {val}
              </span>
            ))}
            {filteredValues.length > 30 && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-surfaceMuted text-textSubtle italic border border-cardBorder">
                +{filteredValues.length - 30} more...
              </span>
            )}
            {filteredValues.length === 0 && (
              <span className="text-[10px] text-textSubtle italic p-1">
                No values matching "{filterQuery}"
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
