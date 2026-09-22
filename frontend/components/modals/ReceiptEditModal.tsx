'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Printer, CheckCircle, Save, LayoutTemplate } from 'lucide-react';
import { ExtractedReceiptResult, ReceiptItem, TaxType, InvoiceFormatType, UserSettings, Receipt } from '@/types';
import { formatCurrency } from '@/lib/utils/currencyFormatter';
import { getTodayString } from '@/lib/utils/dateUtils';
import { DEFAULT_SETTINGS } from '@/lib/constants';
import { StandardInvoiceView } from '../invoice/StandardInvoiceView';
import { BasicTaxInvoiceView } from '../invoice/BasicTaxInvoiceView';
import { apiUrl } from '@/lib/api/apiClient';

interface ReceiptEditModalProps {
  extractedData?: ExtractedReceiptResult;
  existingReceipt?: any;
  onClose: () => void;
  onSaved: () => void;
}

export function ReceiptEditModal({
  extractedData,
  existingReceipt,
  onClose,
  onSaved,
}: ReceiptEditModalProps) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    fetch(apiUrl('/api/settings'))
      .then((res) => res.json())
      .then((data) => {
        if (data && data.businessName) setSettings(data);
      })
      .catch(() => {});
  }, []);

  const initialItems: ReceiptItem[] = existingReceipt?.items ||
    (extractedData?.items && extractedData.items.length > 0
      ? extractedData.items.map((item, idx) => ({
          id: `item_${Date.now()}_${idx}`,
          name: item.name,
          hsnCode: item.hsn_code || '',
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          unitPrice: item.unit_price || 0,
          lineTotal: (item.quantity || 1) * (item.unit_price || 0),
        }))
      : [{ id: 'item_1', name: 'Sample Product', hsnCode: '1006', quantity: 1, unit: 'pcs', unitPrice: 100, lineTotal: 100 }]);

  const [customerName, setCustomerName] = useState(existingReceipt?.customerName || extractedData?.customer_name || '');
  const [customerPhone, setCustomerPhone] = useState(existingReceipt?.customerPhone || extractedData?.customer_phone || '');
  const [customerAddress, setCustomerAddress] = useState(existingReceipt?.customerAddress || extractedData?.customer_address || '');
  const [customerGstin, setCustomerGstin] = useState(existingReceipt?.customerGstin || extractedData?.customer_gstin || '');
  const [discountStr, setDiscountStr] = useState(String(existingReceipt?.discount ?? extractedData?.discount ?? 0));
  const [taxPercentStr, setTaxPercentStr] = useState(String(existingReceipt?.taxPercent ?? extractedData?.tax_percent ?? 0));
  const [taxType, setTaxType] = useState<TaxType>((existingReceipt?.taxType || extractedData?.tax_type || 'none') as TaxType);
  const [notes, setNotes] = useState(existingReceipt?.notes || '');
  const [items, setItems] = useState<ReceiptItem[]>(initialItems);
  const [format, setFormat] = useState<InvoiceFormatType>(existingReceipt?.format || settings.invoiceFormat || 'standard');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync format with settings default if not set
  useEffect(() => {
    if (settings.invoiceFormat && !existingReceipt?.format) {
      setFormat(settings.invoiceFormat);
    }
  }, [settings.invoiceFormat, existingReceipt?.format]);

  // Real-time calculations
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
  const discount = parseFloat(discountStr) || 0;
  const taxPercent = parseFloat(taxPercentStr) || 0;
  const taxableAmount = Math.max(0, subtotal - discount);
  const taxAmount = Math.round(taxableAmount * taxPercent) / 100;
  const cgst = taxType === 'gst' ? Math.round((taxAmount / 2) * 100) / 100 : 0;
  const sgst = taxType === 'gst' ? Math.round((taxAmount / 2) * 100) / 100 : 0;
  const igst = taxType === 'igst' ? taxAmount : 0;
  const grandTotal = Math.max(0, subtotal - discount + taxAmount);

  const currentReceiptObj: Receipt = {
    id: existingReceipt?.id || 'temp_preview_id',
    receiptNumber: existingReceipt?.receiptNumber || 'INV-PREVIEW',
    date: existingReceipt?.date || getTodayString(),
    customerName: customerName.trim() || null,
    customerPhone: customerPhone.trim() || null,
    customerAddress: customerAddress.trim() || null,
    customerGstin: customerGstin.trim() || null,
    items,
    subtotal,
    discount,
    tax: taxAmount,
    taxPercent,
    taxType,
    cgst,
    sgst,
    igst,
    grandTotal,
    currency: 'INR',
    notes: notes.trim() || null,
    format,
    transcript: extractedData?.raw_transcript || existingReceipt?.transcript || null,
    createdAt: existingReceipt?.createdAt || new Date().toISOString(),
  };

  const updateItem = (id: string, key: keyof ReceiptItem, val: any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [key]: val };
        if (key === 'quantity' || key === 'unitPrice') {
          const qty = key === 'quantity' ? parseFloat(val) || 0 : item.quantity;
          const price = key === 'unitPrice' ? parseFloat(val) || 0 : item.unitPrice;
          updated.lineTotal = qty * price;
        }
        return updated;
      })
    );
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        name: 'New Item',
        hsnCode: '',
        quantity: 1,
        unit: 'pcs',
        unitPrice: 50,
        lineTotal: 50,
      },
    ]);
  };

  const deleteItem = (id: string) => {
    if (items.length <= 1) {
      setError('Invoice must contain at least one line item.');
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSave = async (andPrint: boolean = false) => {
    setError(null);
    try {
      setSaving(true);
      let receiptNumber = existingReceipt?.receiptNumber;
      if (!receiptNumber) {
        const numRes = await fetch(apiUrl('/api/receipts/next-number'));
        const numData = await numRes.json();
        receiptNumber = numData.nextReceiptNumber || `INV-${Date.now().toString().slice(-4)}`;
      }

      const payload = {
        receiptNumber,
        date: existingReceipt?.date || getTodayString(),
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        customerAddress: customerAddress.trim() || null,
        customerGstin: customerGstin.trim() || null,
        items,
        subtotal,
        discount,
        tax: taxAmount,
        taxPercent,
        taxType,
        cgst,
        sgst,
        igst,
        grandTotal,
        currency: 'INR',
        notes: notes.trim() || null,
        format,
        transcript: extractedData?.raw_transcript || existingReceipt?.transcript || null,
      };

      const url = existingReceipt ? apiUrl(`/api/receipts/${existingReceipt.id}`) : apiUrl('/api/receipts');
      const method = existingReceipt ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to save receipt.');

      onSaved();
      if (andPrint) {
        window.print();
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const triggerPrint = () => {
    window.print();
  };

  return (
    <>
      {/* On-Screen Modal Window (Hidden during Print) */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto no-print">
        <div className="bg-card border border-cardBorder rounded-t-2xl sm:rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-cardBorder flex items-center justify-between bg-surface">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-text flex items-center gap-2">
                <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-secondary" />
                {existingReceipt ? `Tax Invoice ${existingReceipt.receiptNumber}` : 'Invoice & Bill Editor'}
              </h2>
              <p className="text-[11px] sm:text-xs text-textMuted mt-0.5">
                Edit items, customer details, HSN, tax rate, and print clean invoices.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              {/* View / Edit Mode Toggle */}
              <div className="flex bg-surfaceMuted p-0.5 rounded-lg border border-cardBorder text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className={`px-3 py-1 rounded-md font-semibold transition ${
                    viewMode === 'edit' ? 'bg-primary text-white' : 'text-textMuted hover:text-text'
                  }`}
                >
                  Form Editor
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-3 py-1 rounded-md font-semibold transition ${
                    viewMode === 'preview' ? 'bg-primary text-white' : 'text-textMuted hover:text-text'
                  }`}
                >
                  Invoice View
                </button>
              </div>

              <button onClick={onClose} className="p-1.5 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1">
            {error && (
              <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs font-medium">
                {error}
              </div>
            )}

            {viewMode === 'preview' ? (
              /* Direct On-Screen Preview of selected invoice format */
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-cardBorder">
                  <span className="text-xs text-textMuted font-semibold flex items-center gap-1.5">
                    <LayoutTemplate className="w-4 h-4 text-primary" />
                    Format:
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setFormat('standard')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        format === 'standard'
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-card text-textMuted hover:text-text'
                      }`}
                    >
                      Standard Invoice
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat('basic_tax')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        format === 'basic_tax'
                          ? 'bg-neutral-100 text-neutral-950 font-extrabold shadow-md'
                          : 'bg-card text-textMuted hover:text-text'
                      }`}
                    >
                      Basic Tax (A4 B&W)
                    </button>
                  </div>
                </div>

                {format === 'standard' ? (
                  <StandardInvoiceView receipt={currentReceiptObj} settings={settings} />
                ) : (
                  <BasicTaxInvoiceView receipt={currentReceiptObj} settings={settings} />
                )}
              </div>
            ) : (
              /* Form Editor */
              <div className="space-y-4 sm:space-y-6">
                {/* Bill To Customer Information */}
                <div className="p-4 rounded-xl bg-surface border border-cardBorder space-y-3">
                  <span className="text-xs font-bold uppercase text-primary tracking-wider block">
                    Bill To Details (Customer)
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                        Customer Name *
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="e.g. Aarav Sharma"
                        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                        Customer Phone
                      </label>
                      <input
                        type="text"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                        Customer GSTIN / UIN
                      </label>
                      <input
                        type="text"
                        value={customerGstin}
                        onChange={(e) => setCustomerGstin(e.target.value)}
                        placeholder="29ABCDE1234F1Z5"
                        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                        Customer Address
                      </label>
                      <input
                        type="text"
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Street, City, State"
                        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>

                {/* Tax & Layout Format Options */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-surface border border-cardBorder">
                  <div>
                    <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                      Tax Type
                    </label>
                    <select
                      value={taxType}
                      onChange={(e) => setTaxType(e.target.value as TaxType)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                    >
                      <option value="none">No Tax (0%)</option>
                      <option value="gst">GST (CGST + SGST)</option>
                      <option value="igst">IGST (Inter-state)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                      GST Rate (%)
                    </label>
                    <input
                      type="number"
                      disabled={taxType === 'none'}
                      value={taxPercentStr}
                      onChange={(e) => setTaxPercentStr(e.target.value)}
                      placeholder="e.g. 18"
                      className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary disabled:opacity-40 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                      Invoice Print Format
                    </label>
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as InvoiceFormatType)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                    >
                      <option value="standard">Standard Invoice</option>
                      <option value="basic_tax">Basic Tax Invoice (A4 B&W)</option>
                    </select>
                  </div>
                </div>

                {/* Line Items Table with HSN/SAC Column */}
                <div className="border border-cardBorder rounded-xl overflow-x-auto bg-surface/50">
                  <table className="w-full text-left text-xs min-w-[550px]">
                    <thead className="bg-surfaceMuted text-[10px] sm:text-[11px] font-bold uppercase text-textMuted border-b border-cardBorder">
                      <tr>
                        <th className="p-2.5 w-8">#</th>
                        <th className="p-2.5">Item Description</th>
                        <th className="p-2.5 w-24">HSN/SAC</th>
                        <th className="p-2.5 w-20">Qty</th>
                        <th className="p-2.5 w-16">Unit</th>
                        <th className="p-2.5 w-24 text-right">Price (₹)</th>
                        <th className="p-2.5 w-24 text-right">Total</th>
                        <th className="p-2.5 w-8 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cardBorder/60">
                      {items.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-surfaceMuted/50 transition">
                          <td className="p-2.5 text-textSubtle font-medium">{idx + 1}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                              placeholder="Item description"
                              className="w-full px-2 py-1.5 rounded-lg bg-background/80 border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.hsnCode || ''}
                              onChange={(e) => updateItem(item.id, 'hsnCode', e.target.value)}
                              placeholder="e.g. 1006"
                              className="w-full px-2 py-1.5 rounded-lg bg-background/80 border border-cardBorder text-xs text-text font-mono focus:outline-none focus:border-primary text-center"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0.1"
                              step="any"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg bg-background/80 border border-cardBorder text-xs text-text focus:outline-none focus:border-primary text-center font-medium"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                              placeholder="pcs"
                              className="w-full px-2 py-1.5 rounded-lg bg-background/80 border border-cardBorder text-xs text-text focus:outline-none focus:border-primary text-center"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(item.id, 'unitPrice', e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg bg-background/80 border border-cardBorder text-xs text-text focus:outline-none focus:border-primary text-right font-medium"
                            />
                          </td>
                          <td className="p-2.5 text-right font-bold text-text">
                            {formatCurrency(item.lineTotal)}
                          </td>
                          <td className="p-2 text-center">
                            {items.length > 1 && (
                              <button
                                onClick={() => deleteItem(item.id)}
                                className="text-textSubtle hover:text-danger p-1 rounded transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={addItem}
                    className="py-2 px-3.5 rounded-xl border border-dashed border-cardBorder hover:border-primary/50 text-textMuted hover:text-primary text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Product / Service Item
                  </button>
                </div>

                {/* Invoice Summary & Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="space-y-2">
                    <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                      Notes / Terms (Optional):
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Payment due within 7 days. Thank you for your business!"
                      className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary resize-none"
                    />
                  </div>

                  <div className="rounded-xl bg-surface border border-cardBorder p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-textMuted">
                      <span>Subtotal</span>
                      <span className="font-semibold text-text">{formatCurrency(subtotal)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-textMuted">Discount (₹)</span>
                      <input
                        type="number"
                        value={discountStr}
                        onChange={(e) => setDiscountStr(e.target.value)}
                        className="w-24 px-2 py-1 rounded bg-background border border-cardBorder text-xs text-right font-semibold text-secondary focus:outline-none focus:border-primary"
                      />
                    </div>

                    {taxType === 'gst' && taxPercent > 0 && (
                      <>
                        <div className="flex justify-between text-textMuted">
                          <span>CGST ({taxPercent / 2}%)</span>
                          <span className="font-semibold text-text">+{formatCurrency(cgst)}</span>
                        </div>
                        <div className="flex justify-between text-textMuted">
                          <span>SGST ({taxPercent / 2}%)</span>
                          <span className="font-semibold text-text">+{formatCurrency(sgst)}</span>
                        </div>
                      </>
                    )}

                    {taxType === 'igst' && taxPercent > 0 && (
                      <div className="flex justify-between text-textMuted">
                        <span>IGST ({taxPercent}%)</span>
                        <span className="font-semibold text-text">+{formatCurrency(igst)}</span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-cardBorder flex justify-between items-center">
                      <span className="text-sm font-bold text-text">Grand Total</span>
                      <span className="text-base font-extrabold text-primary">{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-4 sm:p-5 border-t border-cardBorder bg-surface flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-cardBorder text-textMuted hover:text-text hover:bg-surfaceMuted text-xs font-semibold transition"
            >
              Close
            </button>

            <div className="flex items-center space-x-2 sm:space-x-3">
              <button
                type="button"
                disabled={saving}
                onClick={triggerPrint}
                className="px-3 sm:px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-textMuted" />
                <span>Print Invoice / Bill</span>
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave(false)}
                className="px-4 sm:px-5 py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-primary/25 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Invoice'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pure Print-Only Invoice Document (Rendered only during window.print) */}
      <div className="print-only printable-area">
        {format === 'basic_tax' ? (
          <BasicTaxInvoiceView receipt={currentReceiptObj} settings={settings} />
        ) : (
          <StandardInvoiceView receipt={currentReceiptObj} settings={settings} />
        )}
      </div>
    </>
  );
}
