'use client';

import React, { useState } from 'react';
import { X, CheckCircle2, Eye, LayoutTemplate, Printer } from 'lucide-react';
import { Receipt, UserSettings, InvoiceFormatType } from '@/types';
import { StandardInvoiceView } from './StandardInvoiceView';
import { BasicTaxInvoiceView } from './BasicTaxInvoiceView';
import { DEFAULT_SETTINGS } from '@/lib/constants';

interface InvoiceFormatPreviewModalProps {
  currentFormat: InvoiceFormatType;
  settings?: UserSettings;
  sampleReceipt?: Receipt;
  onSelectFormat: (format: InvoiceFormatType) => void;
  onClose: () => void;
}

const SAMPLE_DEMO_RECEIPT: Receipt = {
  id: 'demo_receipt_preview',
  receiptNumber: 'INV-2026-0042',
  date: '2026-08-20',
  customerName: 'Sharma Enterprise & Traders',
  customerPhone: '+91 98450 12345',
  customerAddress: '45 Industrial Area, Phase II, Bengaluru',
  customerGstin: '29ABCDE1234F1Z5',
  items: [
    { id: '1', name: 'Premium Basmati Rice (Grade A)', hsnCode: '1006', quantity: 5, unit: 'bags', unitPrice: 1200, lineTotal: 6000 },
    { id: '2', name: 'Sunflower Refined Cooking Oil', hsnCode: '1512', quantity: 10, unit: 'litres', unitPrice: 140, lineTotal: 1400 },
    { id: '3', name: 'Spices & Organic Seasoning Pack', hsnCode: '0910', quantity: 2, unit: 'boxes', unitPrice: 300, lineTotal: 600 },
  ],
  subtotal: 8000,
  discount: 200,
  tax: 1404,
  taxPercent: 18,
  taxType: 'gst',
  cgst: 702,
  sgst: 702,
  igst: 0,
  grandTotal: 9204,
  currency: 'INR',
  createdAt: new Date().toISOString(),
};

export function InvoiceFormatPreviewModal({
  currentFormat = 'standard',
  settings = DEFAULT_SETTINGS,
  sampleReceipt = SAMPLE_DEMO_RECEIPT,
  onSelectFormat,
  onClose,
}: InvoiceFormatPreviewModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<InvoiceFormatType>(currentFormat);

  const handleApply = () => {
    onSelectFormat(selectedFormat);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-cardBorder flex items-center justify-between bg-surface shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-text flex items-center gap-2">
              <LayoutTemplate className="w-5 h-5 text-primary" />
              Invoice Format Selector & Live Preview
            </h2>
            <p className="text-xs text-textMuted mt-0.5">
              Choose between modern vibrant styling or formal clean black-and-white A4 Tax Invoice.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selector Pills */}
        <div className="p-4 bg-surfaceMuted/50 border-b border-cardBorder flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setSelectedFormat('standard')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                selectedFormat === 'standard'
                  ? 'bg-primary text-white shadow-lg shadow-primary/25 border border-primary/40'
                  : 'bg-card text-textMuted hover:text-text border border-cardBorder'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>Standard Modern Invoice</span>
              {selectedFormat === 'standard' && <CheckCircle2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setSelectedFormat('basic_tax')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                selectedFormat === 'basic_tax'
                  ? 'bg-neutral-100 text-neutral-950 shadow-lg shadow-white/10 border border-neutral-300'
                  : 'bg-card text-textMuted hover:text-text border border-cardBorder'
              }`}
            >
              <Printer className="w-4 h-4" />
              <span>Basic Tax Invoice (A4 B&W)</span>
              {selectedFormat === 'basic_tax' && <CheckCircle2 className="w-3.5 h-3.5 text-neutral-900" />}
            </button>
          </div>

          <span className="text-[11px] text-textSubtle">
            {selectedFormat === 'standard'
              ? '✨ Features dark glassmorphism, accent badges, and clean rounded card structure.'
              : '📄 Formal GST Tax Invoice layout with classic grid borders, HSN table, and Bank details.'}
          </span>
        </div>

        {/* Live Preview Area */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-background">
          {selectedFormat === 'standard' ? (
            <StandardInvoiceView receipt={sampleReceipt} settings={settings} />
          ) : (
            <BasicTaxInvoiceView receipt={sampleReceipt} settings={settings} />
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-cardBorder bg-surface flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-cardBorder text-textMuted hover:text-text hover:bg-surfaceMuted text-xs font-semibold transition"
          >
            Cancel
          </button>

          <button
            onClick={handleApply}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-primary/25 flex items-center gap-1.5 transition cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Apply Selected Format</span>
          </button>
        </div>
      </div>
    </div>
  );
}
