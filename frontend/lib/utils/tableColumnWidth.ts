/**
 * Utility to calculate content-based column widths and min-widths for data tables.
 * Ensures table headers and cell values are never cramped or truncated,
 * and enables smooth horizontal scrolling when tables exceed available viewport width.
 */

/**
 * Returns minimum width in pixels for a column based on its header name,
 * data type, and expected content length.
 */
export function getTableColumnMinWidthPx(header: string, isNumber?: boolean): number {
  if (!header) return 100;
  const h = header.trim().toLowerCase();

  // Row number or index
  if (h === '#' || h === 'no' || h === 'sr' || h === 'sr.' || h === 'sl' || h === 'id') {
    return 48;
  }

  // Action column (delete, edit)
  if (h === 'action' || h === 'actions' || h === '') {
    return 48;
  }

  // Short defect codes / manufacturing status acronyms (e.g. STRUP, BD, SS, SM, BM, ST, WL, SC, PC, AB, PH, FS, TOTAL, OK, NG)
  const shortDefectCodes = [
    'strup', 'bd', 'ss', 'sm', 'bm', 'st', 'wl', 'sc', 'pc', 'ab', 'ph', 'fs',
    'ok', 'ng', 'rej', 'def', 'scrap', 'total', 'tot'
  ];
  if (shortDefectCodes.includes(h) || (header.length <= 4 && !h.includes('time') && !h.includes('date'))) {
    return h === 'strup' || h === 'total' ? 95 : 85;
  }

  // Time / Hour / Interval columns
  if (
    h.includes('time') ||
    h.includes('hour') ||
    h.includes('interval') ||
    h.includes('start') ||
    h.includes('end')
  ) {
    return 130;
  }

  // Date / Shift / Machine / Batch / Part Number
  if (
    h.includes('date') ||
    h.includes('shift') ||
    h.includes('batch') ||
    h.includes('machine') ||
    h.includes('part') ||
    h.includes('cavity') ||
    h.includes('cavities')
  ) {
    return 135;
  }

  // Production quantities, metrics, rejection, weights
  if (
    h.includes('qty') ||
    h.includes('quantity') ||
    h.includes('planned') ||
    h.includes('produced') ||
    h.includes('rejection') ||
    h.includes('weight') ||
    h.includes('cycle') ||
    h.includes('target') ||
    h.includes('actual') ||
    h.includes('count') ||
    isNumber
  ) {
    return 130;
  }

  // Descriptive text, remarks, defect reasons, operator names
  if (
    h.includes('remark') ||
    h.includes('desc') ||
    h.includes('reason') ||
    h.includes('note') ||
    h.includes('comment') ||
    h.includes('operator') ||
    h.includes('material') ||
    h.includes('item')
  ) {
    return 185;
  }

  // Dynamic calculation based on header length
  // Assumes ~8.5px per character + padding & icon room
  const calculated = Math.round(header.length * 9.5 + 40);
  return Math.max(110, Math.min(240, calculated));
}

/**
 * Returns Tailwind CSS min-w class and inline style minWidth for a column.
 */
export function getTableColumnWidthStyle(header: string, isNumber?: boolean): {
  minWidth: string;
  width?: string;
} {
  const minPx = getTableColumnMinWidthPx(header, isNumber);
  return {
    minWidth: `${minPx}px`,
  };
}
