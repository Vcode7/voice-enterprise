'use client';

import React from 'react';
import { Receipt, UserSettings } from '@/types';
import { formatCurrency } from '@/lib/utils/currencyFormatter';
import { formatDateDisplay } from '@/lib/utils/dateUtils';
import { numberToWords } from '@/lib/utils/numberToWords';

interface InvoiceViewProps {
  receipt: Receipt;
  settings?: UserSettings;
}

export function StandardInvoiceView({ receipt, settings }: InvoiceViewProps) {
  const businessName = settings?.businessName || 'My Enterprise / Shop';
  const businessPhone = settings?.businessPhone || '+91 98765 43210';
  const businessAddress = settings?.businessAddress || '123 Market Street, Main City';
  const gstin = settings?.gstin || '22AAAAA0000A1Z5';
  const bank = settings?.bankDetails;

  return (
    <div className="bg-white text-slate-900 border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 max-w-3xl mx-auto shadow-xl print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-5 border-b-2 border-primary gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-primary tracking-tight">{businessName}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{businessAddress}</p>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
            <span>Phone: <strong className="text-slate-800">{businessPhone}</strong></span>
            <span>•</span>
            <span>GSTIN: <strong className="font-mono text-slate-800">{gstin}</strong></span>
          </div>
        </div>

        <div className="sm:text-right">
          <div className="text-lg font-extrabold text-slate-900 uppercase tracking-wide">
            {receipt.taxType !== 'none' ? 'TAX INVOICE' : 'RECEIPT'}
          </div>
          <div className="text-sm font-bold font-mono text-primary mt-0.5">{receipt.receiptNumber}</div>
          <div className="text-xs text-slate-500 mt-0.5">Date: {formatDateDisplay(receipt.date)}</div>
        </div>
      </div>

      {/* Bill To & Tax Meta Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Billed To (Customer Details)
          </span>
          <h3 className="text-sm font-bold text-slate-900">{receipt.customerName || 'Cash Customer'}</h3>
          {receipt.customerPhone && (
            <p className="text-xs text-slate-600 mt-0.5">Phone: {receipt.customerPhone}</p>
          )}
          {receipt.customerAddress && (
            <p className="text-xs text-slate-600 mt-0.5">Address: {receipt.customerAddress}</p>
          )}
          {receipt.customerGstin && (
            <p className="text-xs text-slate-700 mt-0.5 font-mono">
              <strong>GSTIN / UIN:</strong> {receipt.customerGstin}
            </p>
          )}
        </div>

        <div className="sm:text-right space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Tax Details
          </span>
          <div className="text-xs text-slate-600">
            Tax Type:{' '}
            <strong className="text-slate-800 uppercase">
              {receipt.taxType === 'gst' ? 'GST (CGST + SGST)' : receipt.taxType === 'igst' ? 'IGST (Inter-state)' : 'None (0%)'}
            </strong>
          </div>
          {receipt.taxType !== 'none' && (
            <div className="text-xs text-slate-600">
              Tax Rate: <strong className="text-slate-800">{receipt.taxPercent || 0}%</strong>
            </div>
          )}
        </div>
      </div>

      {/* Line Items Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100 text-[10px] font-bold uppercase text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3 w-8 text-center">#</th>
              <th className="p-3">Item Description</th>
              <th className="p-3 w-24 text-center">HSN/SAC</th>
              <th className="p-3 w-20 text-center">Qty / Unit</th>
              <th className="p-3 w-24 text-right">Unit Price</th>
              <th className="p-3 w-28 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {receipt.items.map((item, idx) => (
              <tr key={item.id || idx}>
                <td className="p-3 text-center text-slate-500 font-medium">{idx + 1}</td>
                <td className="p-3 font-semibold text-slate-800">{item.name}</td>
                <td className="p-3 text-center font-mono text-slate-600">{item.hsnCode || '-'}</td>
                <td className="p-3 text-center text-slate-600">
                  {item.quantity} {item.unit}
                </td>
                <td className="p-3 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
                <td className="p-3 text-right font-bold text-slate-900">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals & Calculations Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        {/* Left: Total in Words & Bank Details */}
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Amount in Words:</span>
            <p className="text-xs font-semibold text-slate-800 italic">{numberToWords(receipt.grandTotal)}</p>
          </div>

          {bank && bank.accountNumber && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
              <span className="text-[10px] uppercase font-bold text-primary block">
                Bank Transfer Details
              </span>
              <div className="text-slate-600">Bank: <strong className="text-slate-800">{bank.bankName}</strong></div>
              <div className="text-slate-600">A/c Name: <strong className="text-slate-800">{bank.accountHolder}</strong></div>
              <div className="text-slate-600">A/c No: <strong className="font-mono text-slate-800">{bank.accountNumber}</strong></div>
              <div className="text-slate-600">IFSC: <strong className="font-mono text-slate-800">{bank.ifsc}</strong> (Branch: {bank.branch})</div>
            </div>
          )}
        </div>

        {/* Right: Calculations Summary */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="font-semibold text-slate-800">{formatCurrency(receipt.subtotal)}</span>
          </div>

          {receipt.discount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Discount</span>
              <span className="font-semibold">-{formatCurrency(receipt.discount)}</span>
            </div>
          )}

          {receipt.taxType === 'gst' && receipt.taxPercent > 0 && (
            <>
              <div className="flex justify-between text-slate-600">
                <span>CGST ({receipt.taxPercent / 2}%)</span>
                <span className="font-semibold text-slate-800">+{formatCurrency(receipt.cgst)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>SGST ({receipt.taxPercent / 2}%)</span>
                <span className="font-semibold text-slate-800">+{formatCurrency(receipt.sgst)}</span>
              </div>
            </>
          )}

          {receipt.taxType === 'igst' && receipt.taxPercent > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>IGST ({receipt.taxPercent}%</span>
              <span className="font-semibold text-slate-800">+{formatCurrency(receipt.igst)}</span>
            </div>
          )}

          <div className="pt-2 border-t-2 border-slate-300 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-900">Grand Total</span>
            <span className="text-lg font-extrabold text-primary">{formatCurrency(receipt.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Footer Notes & Signature */}
      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 text-xs text-slate-500">
        <div>
          <span className="font-bold text-slate-700 block mb-0.5">Thank you for your business!</span>
          {receipt.notes ? (
            <p className="text-slate-600">{receipt.notes}</p>
          ) : (
            <p className="text-slate-400">1. Goods once sold will not be taken back. 2. Subject to local jurisdiction.</p>
          )}
        </div>

        <div className="text-right self-end sm:self-auto space-y-6">
          <div className="text-slate-800 font-semibold text-xs">For {businessName}</div>
          <div className="border-t border-dashed border-slate-400 pt-1 text-[10px] text-slate-500">
            Authorized Signatory
          </div>
        </div>
      </div>
    </div>
  );
}
