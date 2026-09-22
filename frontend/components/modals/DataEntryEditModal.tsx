'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2, Save, Printer, Table, CheckCircle, Edit3 } from 'lucide-react';
import { DataTemplate, DataEntryRecord, FlexibleExtractedResult, ExtractedDataResult, FlexibleField, TemplateField } from '@/types';
import { getTodayString } from '@/lib/utils/dateUtils';
import { DEFAULT_MONITORING_DETAILS_TEMPLATE } from '@/lib/constants';

interface DataEntryEditModalProps {
  extractedData?: ExtractedDataResult;
  flexibleData?: FlexibleExtractedResult;
  existingRecord?: DataEntryRecord;
  template?: DataTemplate;
  isManual?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function DataEntryEditModal({
  extractedData,
  flexibleData,
  existingRecord,
  template = DEFAULT_MONITORING_DETAILS_TEMPLATE,
  isManual = false,
  onClose,
  onSaved,
}: DataEntryEditModalProps) {
  const isFlexible = !!flexibleData || !!existingRecord?.isFlexible;

  // Flexible state
  const [flexibleTitle, setFlexibleTitle] = useState(
    existingRecord?.title || flexibleData?.title || (isManual ? 'Manual Data Entry' : 'Flexible Voice Record')
  );
  const [flexibleFields, setFlexibleFields] = useState<FlexibleField[]>(
    existingRecord?.flexibleFields ||
      flexibleData?.fields || [
        { id: '1', name: 'Item Name', value: '' },
        { id: '2', name: 'Batch / Code', value: '' },
      ]
  );
  const [flexibleTableTitle, setFlexibleTableTitle] = useState(
    existingRecord?.tableTitle || flexibleData?.table?.title || 'Detected Data Table'
  );
  const [flexibleTableHeaders, setFlexibleTableHeaders] = useState<string[]>(
    existingRecord?.tableHeaders || flexibleData?.table?.headers || ['Time Interval', 'Produced Qty', 'Status']
  );
  const [flexibleTableRows, setFlexibleTableRows] = useState<string[][]>(
    (existingRecord?.tableRows as string[][]) || flexibleData?.table?.rows || [['', '', '']]
  );

  // Template-based state
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(() => {
    if (existingRecord?.fieldValues) return existingRecord.fieldValues;
    if (extractedData?.fieldValues) return extractedData.fieldValues;
    const initial: Record<string, any> = {};
    (template.fields || []).forEach((f) => {
      initial[f.extractionKey] = f.defaultValue ?? (f.type === 'boolean' ? false : '');
    });
    return initial;
  });

  const [tableRows, setTableRows] = useState<Array<Record<string, any>>>(() => {
    if (existingRecord?.tableRows && Array.isArray(existingRecord.tableRows)) {
      return existingRecord.tableRows as Array<Record<string, any>>;
    }
    if (extractedData?.tableRows && Array.isArray(extractedData.tableRows)) {
      return extractedData.tableRows;
    }
    if (template.hasTable && template.tableFields && template.tableFields.length > 0) {
      const emptyRow: Record<string, any> = {};
      template.tableFields.forEach((c) => {
        emptyRow[c.extractionKey] = c.type === 'boolean' ? false : '';
      });
      return [emptyRow];
    }
    return [];
  });

  const [date, setDate] = useState(existingRecord?.date || getTodayString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flexible fields helpers
  const updateFlexibleField = (idx: number, key: 'name' | 'value', val: any) => {
    setFlexibleFields((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: val };
      return copy;
    });
  };

  const addFlexibleField = () => {
    setFlexibleFields((prev) => [
      ...prev,
      { id: `flex_${Date.now()}`, name: `Field ${prev.length + 1}`, value: '' },
    ]);
  };

  const deleteFlexibleField = (idx: number) => {
    setFlexibleFields((prev) => prev.filter((_, i) => i !== idx));
  };

  // Flexible table helpers
  const addFlexibleTableRow = () => {
    const emptyRow = flexibleTableHeaders.map(() => '');
    setFlexibleTableRows((prev) => [...prev, emptyRow]);
  };

  const updateFlexibleTableCell = (rowIdx: number, colIdx: number, val: string) => {
    setFlexibleTableRows((prev) => {
      const copy = [...prev];
      const rowCopy = [...copy[rowIdx]];
      rowCopy[colIdx] = val;
      copy[rowIdx] = rowCopy;
      return copy;
    });
  };

  const deleteFlexibleTableRow = (rowIdx: number) => {
    setFlexibleTableRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  // Template fields helpers
  const updateTemplateField = (key: string, val: any) => {
    setFieldValues((prev) => ({ ...prev, [key]: val }));
  };

  const addTemplateTableRow = () => {
    const emptyRow: Record<string, any> = {};
    (template.tableFields || []).forEach((c) => {
      emptyRow[c.extractionKey] = c.type === 'boolean' ? false : '';
    });
    setTableRows((prev) => [...prev, emptyRow]);
  };

  const updateTemplateTableCell = (rowIdx: number, key: string, val: any) => {
    setTableRows((prev) => {
      const copy = [...prev];
      copy[rowIdx] = { ...copy[rowIdx], [key]: val };
      return copy;
    });
  };

  const deleteTemplateTableRow = (rowIdx: number) => {
    setTableRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  const handleSave = async (andPrint: boolean = false) => {
    setError(null);
    try {
      setSaving(true);
      const payload: Partial<DataEntryRecord> = {
        templateId: isFlexible ? 'flexible' : template.id,
        templateName: isFlexible ? flexibleTitle : template.name,
        isFlexible,
        title: isFlexible ? flexibleTitle : undefined,
        fieldValues: isFlexible
          ? flexibleFields.reduce((acc, f) => ({ ...acc, [f.name]: f.value }), {})
          : fieldValues,
        flexibleFields: isFlexible ? flexibleFields : undefined,
        tableTitle: isFlexible ? flexibleTableTitle : template.tableTitle,
        tableHeaders: isFlexible ? flexibleTableHeaders : template.tableFields.map((c) => c.name),
        tableRows: isFlexible ? flexibleTableRows : tableRows,
        rawTranscript: flexibleData?.raw_transcript || extractedData?.raw_transcript || existingRecord?.rawTranscript || (isManual ? '[Manual Entry]' : null),
        date,
      };

      const url = existingRecord ? `/api/data-entries/${existingRecord.id}` : '/api/data-entries';
      const method = existingRecord ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to save data entry record.');

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

  const renderFieldInput = (f: TemplateField) => {
    const val = fieldValues[f.extractionKey];

    if (f.type === 'select' || (f.options && f.options.length > 0)) {
      return (
        <select
          value={val ?? ''}
          onChange={(e) => updateTemplateField(f.extractionKey, e.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
        >
          <option value="" className="bg-card text-textSubtle">
            Select {f.name}...
          </option>
          {(f.options || []).map((opt) => (
            <option key={opt} value={opt} className="bg-card text-text">
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (f.type === 'boolean') {
      const isChecked = val === true || val === 'true' || val === 'yes' || val === '1';
      return (
        <div className="flex items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={() => updateTemplateField(f.extractionKey, !isChecked)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              isChecked
                ? 'bg-secondary/20 text-secondary border border-secondary/40'
                : 'bg-surface hover:bg-surfaceMuted text-textMuted border border-cardBorder'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isChecked ? 'bg-secondary' : 'bg-slate-600'}`} />
            <span>{isChecked ? 'Yes / Passed' : 'No / Failed'}</span>
          </button>
        </div>
      );
    }

    return (
      <input
        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
        value={val ?? ''}
        onChange={(e) => updateTemplateField(f.extractionKey, e.target.value)}
        placeholder={f.placeholder || `Enter ${f.name}`}
        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
      />
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-t-2xl sm:rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-cardBorder flex items-center justify-between bg-surface no-print">
          <div>
            <h2 className="text-base sm:text-xl font-bold text-text flex items-center gap-2">
              {isManual ? (
                <Edit3 className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              ) : (
                <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              )}
              {isManual
                ? isFlexible
                  ? 'Manual Data Entry'
                  : `Manual Entry: ${template.name}`
                : isFlexible
                ? 'Voice Data Entry'
                : `ERP: ${template.name}`}
            </h2>
            <p className="text-[11px] sm:text-xs text-textMuted mt-0.5">
              {isManual
                ? 'Fill out template attributes and log repeated records manually.'
                : 'Review extracted attributes and production table logs.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 sm:p-2 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1 printable-area">
          {error && (
            <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs font-medium no-print">
              {error}
            </div>
          )}

          {/* Date & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3.5 sm:p-4 rounded-xl bg-surface border border-cardBorder">
            <div>
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                Record Title
              </label>
              <input
                type="text"
                value={isFlexible ? flexibleTitle : template.name}
                onChange={(e) => isFlexible && setFlexibleTitle(e.target.value)}
                disabled={!isFlexible}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs sm:text-sm text-text font-semibold focus:outline-none focus:border-primary disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                Log Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs sm:text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Fields Grid */}
          <div>
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <h3 className="text-xs font-bold text-text uppercase tracking-wider">
                {isFlexible ? 'Flexible Attributes' : 'Template Fields'}
              </h3>
              {isFlexible && (
                <button
                  onClick={addFlexibleField}
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold no-print cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Field
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3.5">
              {isFlexible
                ? flexibleFields.map((f, idx) => (
                    <div key={f.id || idx} className="p-3 rounded-xl bg-surface border border-cardBorder space-y-1 relative">
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          value={f.name}
                          onChange={(e) => updateFlexibleField(idx, 'name', e.target.value)}
                          className="text-[10px] sm:text-[11px] font-bold uppercase text-textSubtle bg-transparent border-b border-transparent hover:border-cardBorder focus:border-primary focus:outline-none w-3/4"
                        />
                        {flexibleFields.length > 1 && (
                          <button
                            onClick={() => deleteFlexibleField(idx)}
                            className="text-textSubtle hover:text-danger p-0.5 no-print"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={String(f.value ?? '')}
                        onChange={(e) => updateFlexibleField(idx, 'value', e.target.value)}
                        placeholder="Enter value..."
                        className="w-full px-3 py-2 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                      />
                    </div>
                  ))
                : template.fields.map((f) => (
                    <div key={f.id} className="p-3.5 rounded-xl bg-surface border border-cardBorder space-y-1.5">
                      <label className="block text-[10px] sm:text-[11px] font-bold uppercase text-textSubtle truncate">
                        {f.name} <span className="text-[10px] lowercase text-textSubtle/60">({f.type})</span>
                      </label>
                      {renderFieldInput(f)}
                    </div>
                  ))}
            </div>
          </div>

          {/* Repeated Entries Table */}
          {((isFlexible && flexibleTableHeaders.length > 0) || (!isFlexible && template.hasTable)) && (
            <div className="space-y-2 sm:space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                  <Table className="w-4 h-4 text-primary" />
                  {isFlexible ? flexibleTableTitle : template.tableTitle || 'Repeated Logs Table'}
                </h3>
                <button
                  onClick={isFlexible ? addFlexibleTableRow : addTemplateTableRow}
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold no-print cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Row
                </button>
              </div>

              <div className="border border-cardBorder rounded-xl overflow-x-auto bg-surface/50">
                <table className="w-full text-left text-xs min-w-[500px]">
                  <thead className="bg-surfaceMuted text-[10px] sm:text-[11px] font-bold uppercase text-textMuted border-b border-cardBorder">
                    <tr>
                      <th className="p-2.5 sm:p-3 w-8">#</th>
                      {isFlexible
                        ? flexibleTableHeaders.map((h, i) => (
                            <th key={i} className="p-2.5 sm:p-3">
                              {h}
                            </th>
                          ))
                        : (template.tableFields || []).map((col) => (
                            <th key={col.id} className="p-2.5 sm:p-3">
                              {col.name} <span className="text-[9px] lowercase text-textSubtle">({col.type})</span>
                            </th>
                          ))}
                      <th className="p-2.5 sm:p-3 w-8 text-center no-print"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cardBorder/60">
                    {isFlexible
                      ? flexibleTableRows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-surfaceMuted/50 transition">
                            <td className="p-2.5 sm:p-3 text-textSubtle font-medium">{rowIdx + 1}</td>
                            {flexibleTableHeaders.map((_, colIdx) => (
                              <td key={colIdx} className="p-1.5 sm:p-2">
                                <input
                                  type="text"
                                  value={row[colIdx] ?? ''}
                                  onChange={(e) => updateFlexibleTableCell(rowIdx, colIdx, e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                                />
                              </td>
                            ))}
                            <td className="p-1.5 sm:p-2 text-center no-print">
                              <button
                                onClick={() => deleteFlexibleTableRow(rowIdx)}
                                className="text-textSubtle hover:text-danger p-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      : tableRows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-surfaceMuted/50 transition">
                            <td className="p-2.5 sm:p-3 text-textSubtle font-medium">{rowIdx + 1}</td>
                            {(template.tableFields || []).map((col) => (
                              <td key={col.id} className="p-1.5 sm:p-2">
                                {col.type === 'select' || (col.options && col.options.length > 0) ? (
                                  <select
                                    value={row[col.extractionKey] ?? ''}
                                    onChange={(e) => updateTemplateTableCell(rowIdx, col.extractionKey, e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                                  >
                                    <option value="" className="bg-card text-textSubtle">
                                      Select...
                                    </option>
                                    {(col.options || []).map((opt) => (
                                      <option key={opt} value={opt} className="bg-card text-text">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : col.type === 'boolean' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateTemplateTableCell(
                                        rowIdx,
                                        col.extractionKey,
                                        !(row[col.extractionKey] === true || row[col.extractionKey] === 'true')
                                      )
                                    }
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                                      row[col.extractionKey] === true || row[col.extractionKey] === 'true'
                                        ? 'bg-secondary/20 text-secondary'
                                        : 'bg-surfaceMuted text-textMuted border border-cardBorder'
                                    }`}
                                  >
                                    {row[col.extractionKey] === true || row[col.extractionKey] === 'true' ? 'Yes' : 'No'}
                                  </button>
                                ) : (
                                  <input
                                    type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'time' ? 'time' : 'text'}
                                    value={row[col.extractionKey] ?? ''}
                                    onChange={(e) => updateTemplateTableCell(rowIdx, col.extractionKey, e.target.value)}
                                    placeholder={col.placeholder || col.name}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                                  />
                                )}
                              </td>
                            ))}
                            <td className="p-1.5 sm:p-2 text-center no-print">
                              <button
                                onClick={() => deleteTemplateTableRow(rowIdx)}
                                className="text-textSubtle hover:text-danger p-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-cardBorder bg-surface flex items-center justify-between no-print gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-cardBorder text-textMuted hover:text-text hover:bg-surfaceMuted text-xs font-semibold transition"
          >
            Cancel
          </button>

          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="px-3 sm:px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-textMuted" />
              <span>Print</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="px-4 sm:px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/50 hover:ring-emerald-300 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer active:scale-95"
            >
              <Save className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
              <span>{saving ? 'Saving...' : 'Save Record'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
