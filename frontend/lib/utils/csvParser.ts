import { Transaction, Receipt } from '../../types';

export const transactionsToCsv = (transactions: Transaction[]): string => {
  const headers = [
    'ID',
    'Date',
    'Amount',
    'Currency',
    'Transaction Type',
    'Category',
    'Merchant / Payee',
    'Payment Method',
    'Description',
    'Spoken Transcript',
    'Created At',
  ];

  const escapeCsv = (str: string | null | undefined): string => {
    if (!str) return '""';
    const clean = String(str).replace(/"/g, '""');
    return `"${clean}"`;
  };

  const rows = transactions.map((t) => [
    escapeCsv(t.id),
    escapeCsv(t.date),
    t.amount,
    escapeCsv(t.currency),
    escapeCsv(t.transactionType),
    escapeCsv(t.category),
    escapeCsv(t.merchant),
    escapeCsv(t.paymentMethod),
    escapeCsv(t.description),
    escapeCsv(t.transcript),
    escapeCsv(t.createdAt),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
};

export const receiptsToCsv = (receipts: Receipt[]): string => {
  const headers = [
    'ID',
    'Receipt Number',
    'Date',
    'Customer Name',
    'Customer Phone',
    'Items Count',
    'Subtotal',
    'Discount',
    'Tax',
    'Tax Percent',
    'Tax Type',
    'Grand Total',
    'Currency',
    'Items JSON',
    'Created At',
  ];

  const escapeCsv = (str: string | null | undefined): string => {
    if (!str) return '""';
    const clean = String(str).replace(/"/g, '""');
    return `"${clean}"`;
  };

  const rows = receipts.map((r) => [
    escapeCsv(r.id),
    escapeCsv(r.receiptNumber),
    escapeCsv(r.date),
    escapeCsv(r.customerName),
    escapeCsv(r.customerPhone),
    r.items.length,
    r.subtotal,
    r.discount,
    r.tax,
    r.taxPercent,
    escapeCsv(r.taxType),
    r.grandTotal,
    escapeCsv(r.currency),
    escapeCsv(JSON.stringify(r.items)),
    escapeCsv(r.createdAt),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
};

export const parseCsvText = (csvText: string): { headers: string[]; rows: Record<string, string>[] } => {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('---'));

  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawValues = parseLine(lines[i]);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rawValues[idx] ?? '';
    });
    rows.push(rowObj);
  }

  return { headers, rows };
};
