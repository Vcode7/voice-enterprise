'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2, CheckCircle, ArrowRight } from 'lucide-react';
import { ExtractedIntentResult, FinancialIntent, TransactionType } from '@/types';
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS } from '@/lib/constants';
import { getTodayString } from '@/lib/utils/dateUtils';
import { apiUrl } from '@/lib/api/apiClient';

interface EditableEntry {
  id: string;
  intent: FinancialIntent;
  amount: string;
  merchant: string;
  category: string;
  paymentMethod: string;
  transactionType: TransactionType;
  description: string;
  date: string;
  personName: string;
  targetCategory: string;
}

interface TransactionConfirmModalProps {
  extractedData: ExtractedIntentResult;
  onClose: () => void;
  onSaved: () => void;
}

export function TransactionConfirmModal({
  extractedData,
  onClose,
  onSaved,
}: TransactionConfirmModalProps) {
  const rawEntries =
    extractedData.transactions && extractedData.transactions.length > 0
      ? extractedData.transactions
      : extractedData.entries && extractedData.entries.length > 0
      ? extractedData.entries
      : [extractedData];

  const [entriesList, setEntriesList] = useState<EditableEntry[]>(
    rawEntries.map((item, index) => ({
      id: `entry-${index}-${Date.now()}`,
      intent: item.intent || 'expense',
      amount: item.amount !== null && item.amount !== undefined ? item.amount.toString() : '',
      merchant: item.merchant || item.person_name || '',
      category: item.category || 'Other',
      paymentMethod: item.payment_method || '',
      transactionType: item.transaction_type || (item.intent === 'income' ? 'income' : 'expense'),
      description: item.description || '',
      date: item.date || getTodayString(),
      personName: item.person_name || '',
      targetCategory: item.target_category || '',
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateEntry = (index: number, field: keyof EditableEntry, value: any) => {
    setEntriesList((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const addEntry = () => {
    setEntriesList((prev) => [
      ...prev,
      {
        id: `entry-${prev.length}-${Date.now()}`,
        intent: 'expense',
        amount: '',
        merchant: '',
        category: 'Other',
        paymentMethod: '',
        transactionType: 'expense',
        description: '',
        date: getTodayString(),
        personName: '',
        targetCategory: '',
      },
    ]);
  };

  const removeEntry = (index: number) => {
    if (entriesList.length <= 1) {
      setError('You must keep at least one transaction entry.');
      return;
    }
    setEntriesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveAll = async () => {
    setError(null);
    for (let i = 0; i < entriesList.length; i++) {
      const item = entriesList[i];
      const parsedAmount = parseFloat(item.amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setError(`Entry #${i + 1} (${item.merchant || 'Item'}) has an invalid amount.`);
        return;
      }
    }

    try {
      setSaving(true);
      for (const item of entriesList) {
        const parsedAmount = parseFloat(item.amount);
        const merchantName = item.merchant.trim();
        const paymentMethodValue = item.paymentMethod.trim() || null;

        if (item.intent === 'budget' && item.targetCategory) {
          await fetch(apiUrl('/api/budgets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: item.targetCategory, amount: parsedAmount }),
          });
        } else if (item.intent === 'lend' && merchantName) {
          await fetch(apiUrl('/api/debts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personName: merchantName, amount: parsedAmount, type: 'given', notes: item.description }),
          });
        } else if (item.intent === 'borrow' && merchantName) {
          await fetch(apiUrl('/api/debts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personName: merchantName, amount: parsedAmount, type: 'borrowed', notes: item.description }),
          });
        } else if (item.intent === 'repayment' && merchantName) {
          await fetch(apiUrl('/api/debts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personName: merchantName, amount: parsedAmount, action: 'repayment' }),
          });
        }

        await fetch(apiUrl('/api/transactions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: parsedAmount,
            currency: 'INR',
            merchant: merchantName || null,
            category: item.category || 'Other',
            paymentMethod: paymentMethodValue,
            transactionType: item.transactionType,
            description: item.description || null,
            transcript: extractedData.raw_transcript || null,
            date: item.date || getTodayString(),
          }),
        });
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save transactions.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-t-2xl sm:rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-cardBorder flex items-center justify-between bg-surface">
          <div>
            <h2 className="text-base sm:text-xl font-bold text-text flex items-center gap-2">
              <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-secondary" />
              Confirm Financial Entries
            </h2>
            <p className="text-[11px] sm:text-xs text-textMuted mt-0.5">
              Extracted {entriesList.length} item{entriesList.length > 1 ? 's' : ''} from voice.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Spoken Transcript preview */}
        {extractedData.raw_transcript && (
          <div className="px-4 sm:px-6 py-2.5 bg-surfaceMuted/50 border-b border-cardBorder flex items-center gap-2">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase text-primary tracking-wider shrink-0">
              Spoken:
            </span>
            <span className="text-xs text-textMuted italic truncate">
              "{extractedData.raw_transcript}"
            </span>
          </div>
        )}

        {/* Modal Body - Scrollable entries */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs font-medium">
              {error}
            </div>
          )}

          {entriesList.map((entry, idx) => (
            <div
              key={entry.id}
              className="p-4 sm:p-5 rounded-xl bg-surface border border-cardBorder space-y-3 sm:space-y-4 relative"
            >
              <div className="flex items-center justify-between pb-2 border-b border-cardBorder/60">
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[11px]">
                    {idx + 1}
                  </span>
                  Item #{idx + 1}
                </span>

                {entriesList.length > 1 && (
                  <button
                    onClick={() => removeEntry(idx)}
                    className="text-textSubtle hover:text-danger p-1 rounded transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {/* Amount */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    value={entry.amount}
                    onChange={(e) => updateEntry(idx, 'amount', e.target.value)}
                    placeholder="e.g. 250"
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-sm text-text font-semibold focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Merchant / Payee */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Merchant / Item
                  </label>
                  <input
                    type="text"
                    value={entry.merchant}
                    onChange={(e) => updateEntry(idx, 'merchant', e.target.value)}
                    placeholder="e.g. Grocery Shop"
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-sm text-text focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Type Toggle */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Type
                  </label>
                  <div className="grid grid-cols-2 gap-1 bg-background p-1 rounded-xl border border-cardBorder">
                    <button
                      type="button"
                      onClick={() => {
                        updateEntry(idx, 'transactionType', 'expense');
                        updateEntry(idx, 'intent', 'expense');
                      }}
                      className={`py-1 rounded-lg text-xs font-semibold transition ${
                        entry.transactionType === 'expense'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'text-textMuted hover:text-text'
                      }`}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateEntry(idx, 'transactionType', 'income');
                        updateEntry(idx, 'intent', 'income');
                      }}
                      className={`py-1 rounded-lg text-xs font-semibold transition ${
                        entry.transactionType === 'income'
                          ? 'bg-secondary/20 text-secondary border border-secondary/30'
                          : 'text-textMuted hover:text-text'
                      }`}
                    >
                      Income
                    </button>
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Category
                  </label>
                  <select
                    value={entry.category}
                    onChange={(e) => updateEntry(idx, 'category', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs sm:text-sm text-text focus:outline-none focus:border-primary"
                  >
                    {DEFAULT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-card text-text">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Payment Method
                  </label>
                  <select
                    value={entry.paymentMethod || ''}
                    onChange={(e) => updateEntry(idx, 'paymentMethod', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs sm:text-sm text-text focus:outline-none focus:border-primary"
                  >
                    <option value="" className="bg-card text-textSubtle">
                      None / Not Mentioned
                    </option>
                    {DEFAULT_PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm} className="bg-card text-text">
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(e) => updateEntry(idx, 'date', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs sm:text-sm text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                  Description / Note
                </label>
                <input
                  type="text"
                  value={entry.description}
                  onChange={(e) => updateEntry(idx, 'description', e.target.value)}
                  placeholder="Additional details..."
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addEntry}
            className="w-full py-2.5 sm:py-3 rounded-xl border border-dashed border-cardBorder hover:border-primary/50 text-textMuted hover:text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Another Item
          </button>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-6 border-t border-cardBorder bg-surface flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-cardBorder text-textMuted hover:text-text hover:bg-surfaceMuted text-xs font-semibold transition"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveAll}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-primary/25 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
          >
            {saving ? (
              <span>Saving...</span>
            ) : (
              <>
                <span>Save {entriesList.length} Record{entriesList.length > 1 ? 's' : ''}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
