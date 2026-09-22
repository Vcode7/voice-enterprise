'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Receipt,
  Plus,
  Printer,
  Trash2,
  Edit2,
  Search,
  DollarSign,
  Percent,
} from 'lucide-react';
import { Receipt as ReceiptType } from '@/types';
import { formatCurrency } from '@/lib/utils/currencyFormatter';
import { formatDateDisplay } from '@/lib/utils/dateUtils';
import { ReceiptEditModal } from '@/components/modals/ReceiptEditModal';
import { apiUrl } from '@/lib/api/apiClient';

export default function InvoicesPage() {
  const [receipts, setReceipts] = useState<ReceiptType[]>([]);
  const [search, setSearch] = useState('');
  const [editingReceipt, setEditingReceipt] = useState<ReceiptType | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(apiUrl('/api/receipts'));
      const data = await res.json();
      if (Array.isArray(data)) setReceipts(data);
    } catch (e) {
      console.error('Failed to fetch receipts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this invoice?')) return;
    await fetch(apiUrl(`/api/receipts/${id}`), { method: 'DELETE' });
    fetchReceipts();
  };

  const handlePrint = (receipt: ReceiptType, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingReceipt(receipt);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  const filteredReceipts = receipts.filter(
    (r) =>
      r.receiptNumber.toLowerCase().includes(search.toLowerCase()) ||
      (r.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.customerPhone || '').toLowerCase().includes(search.toLowerCase()) ||
      r.items.some((i) => i.name.toLowerCase().includes(search.toLowerCase()))
  );

  const totalInvoiced = receipts.reduce((sum, r) => sum + r.grandTotal, 0);
  const totalTax = receipts.reduce((sum, r) => sum + (r.tax || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight">Voice GST Invoices & Bills</h1>
          <p className="text-xs text-textMuted mt-0.5">
            Manage, edit, and print GST compliant bills.
          </p>
        </div>

        <button
          onClick={() => setEditingReceipt(null)}
          className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-secondary hover:from-secondary hover:to-emerald-400 text-white text-xs font-bold shadow-lg shadow-secondary/20 flex items-center justify-center gap-1.5 transition cursor-pointer self-stretch sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Create Invoice Manually
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold uppercase text-textSubtle">Total Invoices</span>
            <div className="w-8 h-8 rounded-xl bg-secondary/15 text-secondary flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-text mt-1 sm:mt-2">{receipts.length}</div>
          <div className="text-[10px] sm:text-[11px] text-textMuted">Invoices in database</div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold uppercase text-textSubtle">Total Billed</span>
            <div className="w-8 h-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-primary mt-1 sm:mt-2">{formatCurrency(totalInvoiced)}</div>
          <div className="text-[10px] sm:text-[11px] text-textMuted">Across all bills</div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold uppercase text-textSubtle">GST Collected</span>
            <div className="w-8 h-8 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-accent mt-1 sm:mt-2">{formatCurrency(totalTax)}</div>
          <div className="text-[10px] sm:text-[11px] text-textMuted">Tax recorded</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-card border border-cardBorder rounded-2xl p-3 sm:p-4">
        <div className="relative">
          <Search className="w-4 h-4 text-textSubtle absolute left-3.5 top-2.5 sm:top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice number, customer name, phone, or item..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-secondary"
          />
        </div>
      </div>

      {/* Invoices List */}
      {filteredReceipts.length === 0 ? (
        <div className="py-12 text-center text-xs text-textMuted bg-card rounded-2xl border border-cardBorder p-6">
          No invoices recorded yet. Speak items on Studio or click "Create Invoice Manually"!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {filteredReceipts.map((rcpt) => (
            <div
              key={rcpt.id}
              onClick={() => setEditingReceipt(rcpt)}
              className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder hover:border-slate-600 transition space-y-3 sm:space-y-4 cursor-pointer group shadow-sm"
            >
              <div className="flex items-center justify-between pb-2.5 border-b border-cardBorder/60">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-primary font-bold text-xs sm:text-sm">{rcpt.receiptNumber}</span>
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-surfaceMuted text-textMuted border border-cardBorder">
                      {rcpt.format === 'basic_tax' ? 'Basic Tax (A4)' : 'Standard'}
                    </span>
                    {rcpt.taxType === 'gst' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-secondary/15 text-secondary border border-secondary/30">
                        GST ({rcpt.taxPercent}%)
                      </span>
                    )}
                    {rcpt.taxType === 'igst' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                        IGST ({rcpt.taxPercent}%)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-textMuted mt-0.5">
                    Billed to: <span className="font-semibold text-text">{rcpt.customerName || 'Cash Customer'}</span>
                    {rcpt.customerPhone && <span className="text-textSubtle"> ({rcpt.customerPhone})</span>}
                  </p>
                  {rcpt.customerGstin && (
                    <p className="text-[10px] text-textSubtle font-mono mt-0.5">
                      GSTIN: {rcpt.customerGstin}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="text-sm sm:text-base font-extrabold text-text">
                    {formatCurrency(rcpt.grandTotal)}
                  </div>
                  <div className="text-[10px] text-textSubtle mt-0.5">
                    {formatDateDisplay(rcpt.date)}
                  </div>
                </div>
              </div>

              {/* Items summary */}
              <div className="space-y-1">
                {rcpt.items.slice(0, 2).map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-textMuted">
                    <span className="truncate max-w-[200px]">
                      {item.quantity} {item.unit} × {item.name}
                    </span>
                    <span className="font-medium text-text">{formatCurrency(item.lineTotal)}</span>
                  </div>
                ))}
                {rcpt.items.length > 2 && (
                  <div className="text-[10px] text-textSubtle italic">
                    +{rcpt.items.length - 2} more items...
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="pt-2.5 border-t border-cardBorder flex items-center justify-between">
                <span className="text-[10px] sm:text-[11px] text-textSubtle">
                  {rcpt.items.length} item{rcpt.items.length > 1 ? 's' : ''} • Subtotal {formatCurrency(rcpt.subtotal)}
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={(e) => handlePrint(rcpt, e)}
                    className="p-1 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition flex items-center gap-1 text-xs font-semibold px-2 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingReceipt(rcpt);
                    }}
                    className="p-1 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(rcpt.id, e)}
                    className="p-1 rounded-lg bg-surface hover:bg-danger/20 hover:text-danger border border-cardBorder text-textSubtle transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingReceipt !== undefined && (
        <ReceiptEditModal
          existingReceipt={editingReceipt}
          onClose={() => setEditingReceipt(undefined)}
          onSaved={() => {
            setEditingReceipt(undefined);
            fetchReceipts();
          }}
        />
      )}
    </div>
  );
}
