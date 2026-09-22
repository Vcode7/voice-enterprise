import * as XLSX from 'xlsx';

export interface ParsedWorksheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  sampleHeaders: string[];
}

export interface ParsedSpreadsheetResult {
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  rows: Record<string, string>[];
  allSheetsSummary: ParsedWorksheetSummary[];
  isExcel: boolean;
}

/**
 * Checks whether a filename or mime type indicates an Excel file (.xlsx, .xls, etc.)
 */
export function isExcelFile(filenameOrType: string): boolean {
  const lower = filenameOrType.toLowerCase();
  return (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.xlsm') ||
    lower.endsWith('.xlsb') ||
    lower.includes('spreadsheetml') ||
    lower.includes('ms-excel')
  );
}

/**
 * Reads a workbook from an ArrayBuffer, Uint8Array, or binary string
 */
export function readSpreadsheetWorkbook(data: ArrayBuffer | Uint8Array | string): XLSX.WorkBook {
  if (typeof data === 'string') {
    return XLSX.read(data, { type: 'string', raw: false });
  }
  return XLSX.read(data, { type: 'array', raw: false });
}

export interface ExtractWorksheetOptions {
  firstRowIsHeader?: boolean;
  headerRowIndex?: number; // 0-based row index (0 = Row 1, 1 = Row 2, 2 = Row 3, etc.)
}

export interface RawSheetRow {
  rowIndex: number;
  rowNumber: number;
  cells: string[];
  previewText: string;
}

/**
 * Extracts raw first N rows from a worksheet for header selection preview
 */
export function getWorksheetRawRows(
  worksheet: XLSX.WorkSheet,
  maxRows: number = 6
): RawSheetRow[] {
  if (!worksheet) return [];

  const rawGrid = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!rawGrid || rawGrid.length === 0) return [];

  const result: RawSheetRow[] = [];
  const limit = Math.min(rawGrid.length, maxRows);

  for (let i = 0; i < limit; i++) {
    const row = rawGrid[i];
    if (!Array.isArray(row)) continue;

    const cells = row.map((cell) => (cell !== null && cell !== undefined ? String(cell).trim() : ''));
    const nonEmptyCells = cells.filter(Boolean);
    const previewText = nonEmptyCells.slice(0, 4).join(', ') + (nonEmptyCells.length > 4 ? ', ...' : '');

    result.push({
      rowIndex: i,
      rowNumber: i + 1,
      cells,
      previewText: previewText || '(Empty row)',
    });
  }

  return result;
}

/**
 * Extracts clean headers and structured rows from a specific worksheet
 */
export function extractDataFromWorksheet(
  worksheet: XLSX.WorkSheet,
  options: ExtractWorksheetOptions = { firstRowIsHeader: true }
): { headers: string[]; rows: Record<string, string>[] } {
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const firstRowIsHeader = options.firstRowIsHeader ?? true;

  // Extract raw 2D grid
  const rawGrid = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!rawGrid || rawGrid.length === 0) {
    return { headers: [], rows: [] };
  }

  if (firstRowIsHeader) {
    let headerRowIndex = -1;

    // If explicit headerRowIndex provided (e.g. 0 for Row 1, 1 for Row 2, 2 for Row 3)
    if (typeof options.headerRowIndex === 'number' && options.headerRowIndex >= 0) {
      if (options.headerRowIndex < rawGrid.length) {
        headerRowIndex = options.headerRowIndex;
      }
    }

    // If not specified or invalid, intelligently find header row (inspecting top rows for max populated columns)
    if (headerRowIndex === -1) {
      let bestIdx = -1;
      let maxCells = 0;
      const searchLimit = Math.min(rawGrid.length, 6);

      for (let i = 0; i < searchLimit; i++) {
        const row = rawGrid[i];
        if (!Array.isArray(row)) continue;
        const nonEmptyCount = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '').length;
        if (nonEmptyCount > maxCells) {
          maxCells = nonEmptyCount;
          bestIdx = i;
        }
      }
      headerRowIndex = bestIdx !== -1 ? bestIdx : -1;
    }

    if (headerRowIndex === -1) {
      return { headers: [], rows: [] };
    }

    const rawHeaders = (rawGrid[headerRowIndex] || []) as any[];
    const seenHeaders = new Map<string, number>();
    const headers: string[] = [];

    rawHeaders.forEach((rawH, idx) => {
      let cleanHeader = rawH !== null && rawH !== undefined ? String(rawH).trim() : '';
      if (!cleanHeader) {
        cleanHeader = `Column ${idx + 1}`;
      }

      // Handle duplicates
      const lower = cleanHeader.toLowerCase();
      const count = seenHeaders.get(lower) || 0;
      if (count > 0) {
        cleanHeader = `${cleanHeader} (${count + 1})`;
      }
      seenHeaders.set(lower, count + 1);
      headers.push(cleanHeader);
    });

    // Extract subsequent data rows
    const rows: Record<string, string>[] = [];
    for (let i = headerRowIndex + 1; i < rawGrid.length; i++) {
      const row = rawGrid[i];
      if (!Array.isArray(row)) continue;

      const rowHasData = row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
      if (!rowHasData) continue;

      const rowObj: Record<string, string> = {};
      headers.forEach((h, colIdx) => {
        const val = row[colIdx];
        rowObj[h] = val !== null && val !== undefined ? String(val).trim() : '';
      });
      rows.push(rowObj);
    }

    return { headers, rows };
  } else {
    // When first row is NOT header: generate generic Column 1, Column 2... and keep all rows as data
    let maxCols = 0;
    for (const row of rawGrid) {
      if (Array.isArray(row) && row.length > maxCols) {
        maxCols = row.length;
      }
    }

    if (maxCols === 0) {
      return { headers: [], rows: [] };
    }

    const headers: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      headers.push(`Column ${c + 1}`);
    }

    const rows: Record<string, string>[] = [];
    for (let i = 0; i < rawGrid.length; i++) {
      const row = rawGrid[i];
      if (!Array.isArray(row)) continue;

      const rowHasData = row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
      if (!rowHasData) continue;

      const rowObj: Record<string, string> = {};
      headers.forEach((h, colIdx) => {
        const val = row[colIdx];
        rowObj[h] = val !== null && val !== undefined ? String(val).trim() : '';
      });
      rows.push(rowObj);
    }

    return { headers, rows };
  }
}

/**
 * Summarizes all worksheets inside a workbook
 */
export function summarizeWorkbookSheets(
  workbook: XLSX.WorkBook,
  options: ExtractWorksheetOptions = { firstRowIsHeader: true }
): ParsedWorksheetSummary[] {
  const summaries: ParsedWorksheetSummary[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;

    const { headers, rows } = extractDataFromWorksheet(ws, options);
    summaries.push({
      name: sheetName,
      rowCount: rows.length,
      columnCount: headers.length,
      sampleHeaders: headers.slice(0, 4),
    });
  }

  return summaries;
}

/**
 * Parses a specific sheet from an XLSX.WorkBook
 */
export function parseSheetFromWorkbook(
  workbook: XLSX.WorkBook,
  targetSheetName?: string,
  isExcel = true,
  options: ExtractWorksheetOptions = { firstRowIsHeader: true }
): ParsedSpreadsheetResult {
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return {
      sheetNames: [],
      selectedSheet: '',
      headers: [],
      rows: [],
      allSheetsSummary: [],
      isExcel,
    };
  }

  const selectedSheet =
    targetSheetName && sheetNames.includes(targetSheetName)
      ? targetSheetName
      : sheetNames[0];

  const ws = workbook.Sheets[selectedSheet];
  const { headers, rows } = extractDataFromWorksheet(ws, options);
  const allSheetsSummary = summarizeWorkbookSheets(workbook, options);

  return {
    sheetNames,
    selectedSheet,
    headers,
    rows,
    allSheetsSummary,
    isExcel,
  };
}

/**
 * Parses a File object (CSV, TSV, XLSX, XLS) from browser file input
 */
export async function parseSpreadsheetFile(
  file: File,
  targetSheetName?: string,
  options: ExtractWorksheetOptions = { firstRowIsHeader: true }
): Promise<ParsedSpreadsheetResult> {
  const fileName = file.name || '';
  const isExcel = isExcelFile(fileName) || isExcelFile(file.type || '');

  const arrayBuffer = await file.arrayBuffer();
  const workbook = readSpreadsheetWorkbook(arrayBuffer);

  return parseSheetFromWorkbook(workbook, targetSheetName, isExcel, options);
}

/**
 * Parses a Node.js Buffer or ArrayBuffer
 */
export function parseSpreadsheetBuffer(
  buffer: ArrayBuffer | Uint8Array,
  targetSheetName?: string,
  filename = 'file.xlsx',
  options: ExtractWorksheetOptions = { firstRowIsHeader: true }
): ParsedSpreadsheetResult {
  const isExcel = isExcelFile(filename);
  const workbook = readSpreadsheetWorkbook(buffer);
  return parseSheetFromWorkbook(workbook, targetSheetName, isExcel, options);
}
