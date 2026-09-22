'use client';

import React from 'react';
import { Receipt, UserSettings } from '@/types';
import { formatCurrency } from '@/lib/utils/currencyFormatter';
import { formatDateDisplay } from '@/lib/utils/dateUtils';
import { numberToWords } from '@/lib/utils/numberToWords';

interface BasicTaxInvoiceViewProps {
  receipt: Receipt;
  settings?: UserSettings;
}

export function BasicTaxInvoiceView({ receipt, settings }: BasicTaxInvoiceViewProps) {
  const businessName = settings?.businessName || 'My Enterprise / Shop';
  const businessPhone = settings?.businessPhone || '+91 98765 43210';
  const businessAddress = settings?.businessAddress || '123 Market Street, Main City';
  const gstin = settings?.gstin || '22AAAAA0000A1Z5';
  const bank = settings?.bankDetails;

  return (
    <div className="bg-white text-black p-6 sm:p-8 font-sans border-2 border-black max-w-4xl mx-auto shadow-2xl printable-basic-tax-invoice">
      {/* Header Banner */}
      <div className="border-b-2 border-black pb-3 text-center">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
          GST TAX INVOICE • ORIGINAL FOR RECIPIENT
        </div>
        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight mt-1">{businessName}</h1>
        <p className="text-xs text-neutral-800">{businessAddress}</p>
        <div className="text-xs font-semibold text-neutral-800 mt-1 flex justify-center gap-4 flex-wrap">
          <span>GSTIN / UIN: <strong className="font-mono">{gstin}</strong></span>
          <span>Contact: {businessPhone}</span>
        </div>
      </div>

      {/* Invoice Meta Grid */}
      <div className="grid grid-cols-2 border-b-2 border-black text-xs">
        <div className="p-3 border-r-2 border-black space-y-1">
          <div className="font-bold uppercase text-[10px] text-neutral-600 tracking-wider">
            Buyer (Bill To):
          </div>
          <div className="text-sm font-bold">{receipt.customerName || 'Cash Customer'}</div>
          {receipt.customerPhone && <div>Ph: {receipt.customerPhone}</div>}
          {receipt.customerAddress && <div>Address: {receipt.customerAddress}</div>}
          <div>
            GSTIN / UIN: <span className="font-mono font-bold">{receipt.customerGstin || 'Unregistered'}</span>
          </div>
        </div>

        <div className="p-3 space-y-1">
          <div className="flex justify-between">
            <span className="font-bold text-neutral-700">Invoice No:</span>
            <span className="font-mono font-extrabold">{receipt.receiptNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-neutral-700">Invoice Date:</span>
            <span className="font-medium">{formatDateDisplay(receipt.date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-neutral-700">Place of Supply:</span>
            <span className="font-medium">{receipt.taxType === 'igst' ? 'Inter-State' : 'Intra-State'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-neutral-700">Reverse Charge:</span>
            <span className="font-medium">No</span>
          </div>
        </div>
      </div>

      {/* Main Items Table */}
      <div className="border-b-2 border-black">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-black bg-neutral-100 text-[10px] font-black uppercase text-neutral-900">
              <th className="p-2 border-r border-black w-8 text-center">S.N.</th>
              <th className="p-2 border-r border-black">Description of Goods / Services</th>
              <th className="p-2 border-r border-black w-24 text-center">HSN/SAC</th>
              <th className="p-2 border-r border-black w-20 text-center">Qty & Unit</th>
              <th className="p-2 border-r border-black w-24 text-right">Rate (₹)</th>
              <th className="p-2 w-28 text-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/40">
            {receipt.items.map((item, idx) => (
              <tr key={item.id || idx}>
                <td className="p-2 border-r border-black text-center font-semibold">{idx + 1}</td>
                <td className="p-2 border-r border-black font-bold">{item.name}</td>
                <td className="p-2 border-r border-black text-center font-mono">{item.hsnCode || '-'}</td>
                <td className="p-2 border-r border-black text-center">
                  {item.quantity} {item.unit}
                </td>
                <td className="p-2 border-r border-black text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="p-2 text-right font-extrabold">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tax Breakup & Subtotal Section */}
      <div className="grid grid-cols-2 border-b-2 border-black text-xs">
        {/* Left: Total in Words & Bank Details */}
        <div className="p-3 border-r-2 border-black space-y-3">
          <div>
            <span className="text-[10px] uppercase font-bold text-neutral-600 block">Total Amount in Words:</span>
            <div className="font-bold text-xs italic">{numberToWords(receipt.grandTotal)}</div>
          </div>

          {bank && bank.accountNumber && (
            <div className="pt-2 border-t border-black/30 space-y-0.5 text-[11px]">
              <span className="text-[10px] uppercase font-black text-neutral-700 block">Bank Details for NEFT/RTGS/IMPS:</span>
              <div>Bank Name: <span className="font-bold">{bank.bankName}</span></div>
              <div>Account Name: <span className="font-bold">{bank.accountHolder}</span></div>
              <div>Account No: <span className="font-mono font-bold">{bank.accountNumber}</span></div>
              <div>IFSC Code: <span className="font-mono font-bold">{bank.ifsc}</span> (Branch: {bank.branch})</div>
            </div>
          )}
        </div>

        {/* Right: Calculations */}
        <div className="divide-y divide-black/30">
          <div className="flex justify-between p-2">
            <span className="font-semibold text-neutral-700">Sub Total (Taxable Value):</span>
            <span className="font-bold">{formatCurrency(receipt.subtotal)}</span>
          </div>

          {receipt.discount > 0 && (
            <div className="flex justify-between p-2 text-neutral-800">
              <span className="font-semibold">Discount:</span>
              <span className="font-bold">-{formatCurrency(receipt.discount)}</span>
            </div>
          )}

          {receipt.taxType === 'gst' && receipt.taxPercent > 0 && (
            <>
              <div className="flex justify-between p-2">
                <span className="font-semibold text-neutral-700">Central Tax CGST ({receipt.taxPercent / 2}%):</span>
                <span className="font-bold">+{formatCurrency(receipt.cgst)}</span>
              </div>
              <div className="flex justify-between p-2">
                <span className="font-semibold text-neutral-700">State Tax SGST ({receipt.taxPercent / 2}%):</span>
                <span className="font-bold">+{formatCurrency(receipt.sgst)}</span>
              </div>
            </>
          )}

          {receipt.taxType === 'igst' && receipt.taxPercent > 0 && (
            <div className="flex justify-between p-2">
              <span className="font-semibold text-neutral-700">Integrated Tax IGST ({receipt.taxPercent}%):</span>
              <span className="font-bold">+{formatCurrency(receipt.igst)}</span>
            </div>
          )}

          <div className="flex justify-between p-2.5 bg-neutral-100 text-sm font-black border-t-2 border-black">
            <span>TOTAL INVOICE VALUE (₹):</span>
            <span className="text-base">{formatCurrency(receipt.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Terms & Declarations / Signatory */}
      <div className="grid grid-cols-2 pt-3 text-xs gap-4">
        <div className="space-y-1">
          <span className="font-bold text-[10px] uppercase text-neutral-700 block">Terms & Conditions:</span>
          <p className="text-[11px] text-neutral-700">1. Goods once sold will not be taken back or exchanged.</p>
          <p className="text-[11px] text-neutral-700">2. All disputes are subject to local jurisdiction only.</p>
        </div>

        <div className="text-right space-y-10">
          <div className="font-bold">For {businessName}</div>
          <div className="border-t border-dashed border-black pt-1 text-[11px] text-neutral-600 inline-block px-4">
            Authorized Signatory
          </div>
        </div>
      </div>
    </div>
  );
}
