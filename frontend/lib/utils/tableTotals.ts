import { HandwritingTableColumnConfig } from '@/types';

/**
 * Calculates sum for any table column configured with `calculate_total: true`.
 * Works with both array-of-objects (`[{ "Col": "10" }]`) and array-of-arrays (`[["10"]]`).
 */
export function calculateColumnTotals(
  columnsConfig: HandwritingTableColumnConfig[] | undefined,
  tableHeaders: string[] = [],
  tableRows: any[] = []
): {
  totals: Record<string, string>;
  hasTotals: boolean;
  totalColumnsCount: number;
} {
  const totals: Record<string, string> = {};
  if (!columnsConfig || columnsConfig.length === 0 || !tableRows || tableRows.length === 0) {
    return { totals, hasTotals: false, totalColumnsCount: 0 };
  }

  // Find columns that have calculate_total enabled
  const totalCols = columnsConfig.filter((col) => col.calculate_total || col.is_number && col.calculate_total);
  if (totalCols.length === 0) {
    return { totals, hasTotals: false, totalColumnsCount: 0 };
  }

  totalCols.forEach((colConfig) => {
    const colName = colConfig.column_name;
    const colIndex = tableHeaders.findIndex(
      (h) => h.toLowerCase().trim() === colName.toLowerCase().trim()
    );

    let sum = 0;
    let foundValidNumber = false;

    tableRows.forEach((row) => {
      let rawVal = '';
      if (Array.isArray(row)) {
        if (colIndex >= 0 && row[colIndex] !== undefined) {
          rawVal = String(row[colIndex]);
        }
      } else if (typeof row === 'object' && row !== null) {
        if (row[colName] !== undefined) {
          rawVal = String(row[colName]);
        } else if (colIndex >= 0 && tableHeaders[colIndex] && row[tableHeaders[colIndex]] !== undefined) {
          rawVal = String(row[tableHeaders[colIndex]]);
        }
      }

      if (rawVal) {
        // Strip non-numeric except minus and dot
        const cleaned = rawVal.replace(/[^0-9.-]/g, '');
        if (cleaned && !isNaN(Number(cleaned))) {
          sum += parseFloat(cleaned);
          foundValidNumber = true;
        }
      }
    });

    if (foundValidNumber) {
      // Format: if integer, show as integer; if float, round to at most 2 decimal places
      const formatted = sum % 1 === 0 ? sum.toLocaleString() : sum.toFixed(2);
      totals[colName] = formatted;
      if (colIndex >= 0 && tableHeaders[colIndex]) {
        totals[tableHeaders[colIndex]] = formatted;
      }
    } else {
      totals[colName] = '0';
      if (colIndex >= 0 && tableHeaders[colIndex]) {
        totals[tableHeaders[colIndex]] = '0';
      }
    }
  });

  return {
    totals,
    hasTotals: Object.keys(totals).length > 0,
    totalColumnsCount: Object.keys(totals).length,
  };
}
