/**
 * Excel / Spreadsheet Exporter for Voice-to-Data ERP Records
 * Generates an Excel-compatible XML Spreadsheet (.xls/.xlsx) with multiple sheets, styled headers, and data formatting.
 */

import { EntryTableData } from '@/types';

export interface ExportableEntry {
  entryNumber: number;
  mode?: 'template' | 'flexible';
  templateName?: string;
  title?: string;
  fieldValues: Record<string, any>;
  flexibleFields?: Array<{ name: string; value: string | number }>;
  tableTitle?: string;
  tableHeaders?: string[];
  tableRows?: Array<Record<string, any>> | Array<any[]>;
  tables?: EntryTableData[];
  rawTranscript?: string | null;
  createdAt: string;
}

/**
 * Internal representation of a table to be exported as a dedicated sheet
 */
interface SheetTablePlan {
  sheetName: string;
  entryNumber: number;
  headers: string[];
  rows: any[];
  rowCount: number;
}

/**
 * Escapes XML special characters for Excel XML format
 */
export function escapeXml(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Determines whether a cell value is numeric
 */
function isNumericValue(val: any): boolean {
  if (typeof val === 'number') return !isNaN(val);
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed === '') return false;
  // If it has multiple hyphens or colons, it is a date/time string (e.g. 2026-09-18 or 10:30:00)
  if ((trimmed.match(/-/g) || []).length > 1 || trimmed.includes(':')) return false;
  const cleaned = trimmed.replace(/,/g, '');
  return !isNaN(Number(cleaned)) && cleaned !== '';
}

/**
 * Formats a single XML Cell element based on value type
 */
function formatCellXml(val: any, styleId?: string): string {
  const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : '';

  if (val === null || val === undefined || val === '') {
    return `<Cell${styleAttr}><Data ss:Type="String"></Data></Cell>`;
  }

  if (typeof val === 'number') {
    return isNaN(val)
      ? `<Cell${styleAttr}><Data ss:Type="String"></Data></Cell>`
      : `<Cell${styleAttr}><Data ss:Type="Number">${val}</Data></Cell>`;
  }

  const strVal = String(val).trim();
  if (isNumericValue(strVal)) {
    const num = Number(strVal.replace(/,/g, ''));
    return `<Cell${styleAttr}><Data ss:Type="Number">${num}</Data></Cell>`;
  }

  return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>`;
}

/**
 * Extracts column headers from rows when headers are not explicitly provided
 */
function extractHeadersFromRows(rows: any[]): string[] {
  if (!rows || rows.length === 0) return ['Column 1'];

  const firstRow = rows[0];
  if (Array.isArray(firstRow)) {
    const maxLen = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
    return Array.from({ length: maxLen }, (_, i) => `Column ${i + 1}`);
  }

  if (typeof firstRow === 'object' && firstRow !== null) {
    const keySet = new Set<string>();
    rows.forEach((r) => {
      if (typeof r === 'object' && r !== null && !Array.isArray(r)) {
        Object.keys(r).forEach((k) => keySet.add(k));
      }
    });
    const keys = Array.from(keySet);
    return keys.length > 0 ? keys : ['Value'];
  }

  return ['Value'];
}

/**
 * Retrieves a cell value from a table row given header name and column index
 */
function getRowCellValue(row: any, headerName: string, colIdx: number): any {
  if (row === null || row === undefined) return '';

  if (Array.isArray(row)) {
    return row[colIdx] !== undefined ? row[colIdx] : '';
  }

  if (typeof row === 'object') {
    // 1. Exact key match
    if (row[headerName] !== undefined) return row[headerName];

    // 2. Normalized key match (lowercase alphanumeric)
    const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetNorm = norm(headerName);

    for (const key of Object.keys(row)) {
      if (norm(key) === targetNorm) {
        return row[key];
      }
    }

    // 3. Positional fallback if header starts with "Column" or "Col"
    const keys = Object.keys(row);
    if (
      keys[colIdx] !== undefined &&
      (headerName.toLowerCase().startsWith('column ') || headerName.toLowerCase().startsWith('col '))
    ) {
      return row[keys[colIdx]];
    }
  }

  return '';
}

/**
 * Generates the complete Excel XML content string for the provided entries
 */
export function generateExcelXml(entries: ExportableEntry[], sessionTitle = 'Voice_ERP_Report'): string {
  if (!entries || entries.length === 0) {
    return '';
  }

  // 1. Gather all unique field names across entries for the main summary sheet
  const allFieldKeys = new Set<string>();
  entries.forEach((e) => {
    if (e.flexibleFields && e.flexibleFields.length > 0) {
      e.flexibleFields.forEach((f) => allFieldKeys.add(f.name));
    } else if (e.fieldValues) {
      Object.keys(e.fieldValues).forEach((k) => allFieldKeys.add(k));
    }
  });
  const fieldNamesList = Array.from(allFieldKeys);

  // 2. Plan table sheets per entry
  const usedSheetNames = new Set<string>();
  usedSheetNames.add('ERP_Entries_Summary');

  const tablePlans: SheetTablePlan[] = [];

  entries.forEach((e, entryIdx) => {
    const entryNum = e.entryNumber || entryIdx + 1;

    // Collect all valid tables for this entry
    const entryTables: Array<{ headers?: string[]; rows: any[] }> = [];

    if (e.tables && e.tables.length > 0) {
      e.tables.forEach((t) => {
        if (t.rows && t.rows.length > 0) {
          entryTables.push({
            headers: t.headers && t.headers.length > 0 ? t.headers : undefined,
            rows: t.rows,
          });
        }
      });
    } else if (e.tableRows && e.tableRows.length > 0) {
      entryTables.push({
        headers: e.tableHeaders && e.tableHeaders.length > 0 ? e.tableHeaders : undefined,
        rows: e.tableRows,
      });
    }

    entryTables.forEach((tbl, tblIdx) => {
      // Base sheet name: 'table-1' for entry 1 (or single entry), 'table-2' for entry 2, etc.
      let baseName: string;
      if (entries.length === 1) {
        baseName = tblIdx === 0 ? 'table-1' : `table-1-${tblIdx + 1}`;
      } else {
        baseName = tblIdx === 0 ? `table-${entryNum}` : `table-${entryNum}-${tblIdx + 1}`;
      }

      // Sanitize Excel sheet name (max 31 chars, no prohibited characters: \ / ? * : [ ])
      let safeSheetName = baseName.replace(/[\\/*?:\[\]]/g, '_').slice(0, 31);
      let uniqueName = safeSheetName;
      let counter = 2;
      while (usedSheetNames.has(uniqueName.toLowerCase())) {
        uniqueName = `${safeSheetName.slice(0, 28)}_${counter++}`;
      }
      usedSheetNames.add(uniqueName.toLowerCase());

      const headers = tbl.headers && tbl.headers.length > 0
        ? tbl.headers
        : extractHeadersFromRows(tbl.rows);

      tablePlans.push({
        sheetName: uniqueName,
        entryNumber: entryNum,
        headers,
        rows: tbl.rows,
        rowCount: tbl.rows.length,
      });
    });
  });

  const hasAnyTableRows = tablePlans.length > 0;

  // 3. Build Summary Sheet Rows
  let summaryRowsXml = `
    <Row ss:StyleID="HeaderStyle">
      <Cell><Data ss:Type="String">Entry #</Data></Cell>
      <Cell><Data ss:Type="String">Date &amp; Time</Data></Cell>
      ${fieldNamesList.map((f) => `<Cell><Data ss:Type="String">${escapeXml(f)}</Data></Cell>`).join('')}
      ${hasAnyTableRows ? '<Cell><Data ss:Type="String">Table Sheet</Data></Cell>' : ''}
      ${hasAnyTableRows ? '<Cell><Data ss:Type="String">Table Rows</Data></Cell>' : ''}
    </Row>
  `;

  entries.forEach((e, entryIdx) => {
    const formattedDate = new Date(e.createdAt).toLocaleString();
    const entryNum = e.entryNumber || entryIdx + 1;

    // Build fields cells
    let fieldCellsXml = '';
    fieldNamesList.forEach((fieldName) => {
      let val = '';
      if (e.flexibleFields && e.flexibleFields.length > 0) {
        const found = e.flexibleFields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
        val = found ? String(found.value) : '';
      } else if (e.fieldValues) {
        val = e.fieldValues[fieldName] !== undefined ? String(e.fieldValues[fieldName]) : '';
      }
      fieldCellsXml += formatCellXml(val);
    });

    // Build Table Sheet reference cell and Table Rows count cell
    let tableSheetCellXml = '';
    let tableRowsCountCellXml = '';

    if (hasAnyTableRows) {
      const entryPlans = tablePlans.filter((p) => p.entryNumber === entryNum);
      if (entryPlans.length > 0) {
        const firstSheet = entryPlans[0].sheetName;
        const totalRows = entryPlans.reduce((sum, p) => sum + p.rowCount, 0);

        if (entryPlans.length === 1) {
          // Single table: direct hyperlink to the table sheet
          tableSheetCellXml = `<Cell ss:StyleID="LinkStyle" ss:HRef="#&apos;${escapeXml(firstSheet)}&apos;!A1"><Data ss:Type="String">${escapeXml(firstSheet)}</Data></Cell>`;
        } else {
          // Multiple tables: list sheet names
          const sheetNamesStr = entryPlans.map((p) => p.sheetName).join(', ');
          tableSheetCellXml = `<Cell><Data ss:Type="String">${escapeXml(sheetNamesStr)}</Data></Cell>`;
        }
        tableRowsCountCellXml = `<Cell><Data ss:Type="Number">${totalRows}</Data></Cell>`;
      } else {
        tableSheetCellXml = `<Cell><Data ss:Type="String">-</Data></Cell>`;
        tableRowsCountCellXml = `<Cell><Data ss:Type="Number">0</Data></Cell>`;
      }
    }

    summaryRowsXml += `
      <Row>
        <Cell><Data ss:Type="Number">${entryNum}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(formattedDate)}</Data></Cell>
        ${fieldCellsXml}
        ${tableSheetCellXml}
        ${tableRowsCountCellXml}
      </Row>
    `;
  });

  // 4. Build Dedicated Table Sheets (Row 1: headers only, Rows 2+: values only, no extra metadata)
  let tableWorksheetsXml = '';

  tablePlans.forEach((plan) => {
    // Header row ONLY
    const headerRowXml = `
    <Row ss:StyleID="HeaderStyle">
      ${plan.headers.map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}
    </Row>`;

    // Data rows ONLY
    let dataRowsXml = '';
    plan.rows.forEach((row) => {
      let rowCellsXml = '';
      plan.headers.forEach((h, colIdx) => {
        const val = getRowCellValue(row, h, colIdx);
        rowCellsXml += formatCellXml(val);
      });
      dataRowsXml += `
    <Row>
      ${rowCellsXml}
    </Row>`;
    });

    tableWorksheetsXml += `
  <Worksheet ss:Name="${escapeXml(plan.sheetName)}">
    <Table>
      ${headerRowXml}
      ${dataRowsXml}
    </Table>
  </Worksheet>`;
  });

  // 5. Construct XML Workbook
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D1D5DB"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#0284C7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="LinkStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0284C7" ss:Underline="Single"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="ERP_Entries_Summary">
  <Table>
   ${summaryRowsXml}
  </Table>
 </Worksheet>
${tableWorksheetsXml}
</Workbook>`;
}

/**
 * Exports multiple Voice-to-Data entries into an Excel (.xls compatible) file
 */
export function exportEntriesToExcel(entries: ExportableEntry[], sessionTitle = 'Voice_ERP_Report') {
  if (!entries || entries.length === 0) {
    alert('No entries to export.');
    return;
  }

  const xmlContent = generateExcelXml(entries, sessionTitle);

  // Trigger download in browser
  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = `${now.getHours()}${now.getMinutes()}`;
  const filename = `${sessionTitle}_${dateStr}_${timeStr}.xls`;

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
