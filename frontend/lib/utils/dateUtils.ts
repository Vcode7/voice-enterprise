export const getTodayString = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const getYesterdayString = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

export const isThisMonth = (dateStr: string): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

export const isThisWeek = (dateStr: string): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - d.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= 7;
};

export const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Normalizes diverse handwritten or parsed date formats (e.g. "13/8/26", "13-08-2026", "Aug 13, 2026")
 * into standard ISO "YYYY-MM-DD" format required by HTML5 date inputs (<input type="date">) and databases.
 */
export function normalizeToIsoDate(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  // 1. Already in standard YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 3. DD/MM/YY or DD/MM/YYYY or DD-MM-YY or DD-MM-YYYY or DD.MM.YY
  // e.g. 13/8/26, 13/08/2026, 05-09-26
  const dmyMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    let [, dStr, mStr, yStr] = dmyMatch;
    let d = parseInt(dStr, 10);
    let m = parseInt(mStr, 10);
    let y = parseInt(yStr, 10);

    // If 2-digit year (e.g. 26 -> 2026, 99 -> 1999)
    if (yStr.length === 2) {
      y = y < 50 ? 2000 + y : 1900 + y;
    }

    // Heuristic: If month > 12 and day <= 12, user might have used MM/DD/YYYY
    if (m > 12 && d <= 12) {
      const temp = m;
      m = d;
      d = temp;
    }

    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 4. Fallback to JavaScript Date.parse if it's textual (e.g. "13 Aug 2026", "Aug 13, 2026")
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return trimmed;
}

