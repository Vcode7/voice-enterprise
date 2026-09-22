'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Save,
  Layers,
  Table,
  Database,
  Link as LinkIcon,
  ShieldAlert,
  Upload,
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Zap,
  Check,
  ArrowRight,
} from 'lucide-react';
import {
  DataTemplate,
  TemplateField,
  FieldType,
  LookupTable,
  TemplateLookupConfig,
  TemplateLookupMapping,
} from '@/types';
import { LookupTableUploadModal } from './LookupTableUploadModal';
import { FixedValueFileUploader } from './FixedValueFileUploader';
import { apiUrl } from '@/lib/api/apiClient';

const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'time', label: 'Time' },
  { type: 'select', label: 'Fixed Options / Dropdown' },
  { type: 'boolean', label: 'Boolean (Yes/No)' },
  { type: 'fixed', label: '🔒 Fixed Value' },
];

interface TemplateEditModalProps {
  template?: DataTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateEditModal({ template, onClose, onSaved }: TemplateEditModalProps) {
  const isEditing = !!template;
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [fields, setFields] = useState<TemplateField[]>(
    template?.fields || [
      { id: 'f1', name: 'Part No', extractionKey: 'part_no', type: 'text', placeholder: 'e.g. PRT-4029' },
      { id: 'f2', name: 'Machine Name', extractionKey: 'machine_name', type: 'text', placeholder: 'e.g. Injection Machine 01' },
      { id: 'f3', name: 'Description', extractionKey: 'description', type: 'text', placeholder: 'e.g. Housing Gear Box' },
      { id: 'f4', name: 'Raw Material', extractionKey: 'raw_material', type: 'text', placeholder: 'e.g. ABS Resin Grade A' },
      { id: 'f5', name: 'Shift', extractionKey: 'shift', type: 'select', options: ['A', 'B', 'C'], placeholder: 'Select Shift (A, B, or C)' },
      { id: 'f6', name: 'Quantity', extractionKey: 'quantity', type: 'number', placeholder: 'e.g. 50' },
    ]
  );
  const [hasTable, setHasTable] = useState(template?.hasTable ?? false);
  const [tableTitle, setTableTitle] = useState(template?.tableTitle || 'Repeated Logs Table');
  const [tableFields, setTableFields] = useState<TemplateField[]>(
    template?.tableFields || [
      { id: 'tf1', name: 'Start Time', extractionKey: 'start_time', type: 'time', placeholder: '09:00 AM' },
      { id: 'tf2', name: 'End Time', extractionKey: 'end_time', type: 'time', placeholder: '10:00 AM' },
      { id: 'tf3', name: 'Produced Qty', extractionKey: 'produced_qty', type: 'number', placeholder: '100' },
    ]
  );

  // Lookup Tables & Auto-Fill Config state
  const [availableTables, setAvailableTables] = useState<LookupTable[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadModalMode, setUploadModalMode] = useState<'create' | 'append'>('create');

  const [lookupEnabled, setLookupEnabled] = useState<boolean>(template?.lookupConfig?.enabled ?? false);
  const [lookupTableId, setLookupTableId] = useState<string>(template?.lookupConfig?.tableId || '');
  const [mainFieldKey, setMainFieldKey] = useState<string>(template?.lookupConfig?.mainFieldKey || 'part_no');
  const [mainTableColumn, setMainTableColumn] = useState<string>(template?.lookupConfig?.mainTableColumn || '');
  const [fieldMappings, setFieldMappings] = useState<TemplateLookupMapping[]>(
    template?.lookupConfig?.fieldMappings || []
  );
  const [strictValidation, setStrictValidation] = useState<boolean>(
    template?.lookupConfig?.strictValidation ?? true
  );

  // Interactive Test Auto-Fill state
  const [testBaseValue, setTestBaseValue] = useState('');
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    found: boolean;
    canonicalValue?: string;
    matchedRow?: Record<string, any>;
    autoFilledFields?: Array<{ fieldName: string; fieldKey: string; tableColumn: string; value: string }>;
    otherColumns?: Array<{ column: string; value: string }>;
    error?: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available lookup tables
  useEffect(() => {
    fetch(apiUrl('/api/lookup-tables'))
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailableTables(data);
          if (!lookupTableId && data.length > 0) {
            setLookupTableId(data[0].id);
          }
        }
      })
      .catch((err) => console.error('Failed to load lookup tables:', err));
  }, [lookupTableId]);

  const selectedTable = availableTables.find((t) => t.id === lookupTableId);

  // Auto-set main table column if not set
  useEffect(() => {
    if (selectedTable && selectedTable.columns.length > 0) {
      if (!mainTableColumn || !selectedTable.columns.includes(mainTableColumn)) {
        // Look for matching column name with main field
        const matchingCol = selectedTable.columns.find(
          (c) => c.toLowerCase() === 'part no' || c.toLowerCase().includes('part')
        ) || selectedTable.columns[0];
        setMainTableColumn(matchingCol);
      }
    }
  }, [selectedTable, mainTableColumn]);

  const toSlug = (str: string) =>
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const addField = () => {
    const id = `f_${Date.now()}`;
    setFields((prev) => [
      ...prev,
      { id, name: `Custom Field ${prev.length + 1}`, extractionKey: `field_${prev.length + 1}`, type: 'text' },
    ]);
  };

  const updateField = (idx: number, key: keyof TemplateField, val: any) => {
    setFields((prev) => {
      const copy = [...prev];
      const item = { ...copy[idx], [key]: val };
      if (key === 'name' && (!copy[idx].extractionKey || copy[idx].extractionKey === toSlug(copy[idx].name))) {
        item.extractionKey = toSlug(val);
      }
      if (key === 'type' && val === 'select' && (!item.options || item.options.length === 0)) {
        item.options = ['Option 1', 'Option 2'];
      }
      copy[idx] = item;
      return copy;
    });
  };

  const deleteField = (idx: number) => {
    const deletedField = fields[idx];
    setFields((prev) => prev.filter((_, i) => i !== idx));

    // Remove from field mappings if mapped
    if (deletedField) {
      setFieldMappings((prev) => prev.filter((m) => m.fieldKey !== deletedField.extractionKey));
      if (mainFieldKey === deletedField.extractionKey) {
        const remaining = fields.filter((_, i) => i !== idx);
        if (remaining.length > 0) setMainFieldKey(remaining[0].extractionKey);
      }
    }
  };

  const addTableField = () => {
    const id = `tf_${Date.now()}`;
    setTableFields((prev) => [
      ...prev,
      { id, name: `Column ${prev.length + 1}`, extractionKey: `col_${prev.length + 1}`, type: 'text' },
    ]);
  };

  const updateTableField = (idx: number, key: keyof TemplateField, val: any) => {
    setTableFields((prev) => {
      const copy = [...prev];
      const item = { ...copy[idx], [key]: val };
      if (key === 'name' && (!copy[idx].extractionKey || copy[idx].extractionKey === toSlug(copy[idx].name))) {
        item.extractionKey = toSlug(val);
      }
      if (key === 'type' && val === 'select' && (!item.options || item.options.length === 0)) {
        item.options = ['Pass', 'Fail'];
      }
      copy[idx] = item;
      return copy;
    });
  };

  const deleteTableField = (idx: number) => {
    setTableFields((prev) => prev.filter((_, i) => i !== idx));
  };

  // Field Mapping Helpers
  const addFieldMapping = () => {
    if (!selectedTable || selectedTable.columns.length === 0) return;
    const availableField = fields.find(
      (f) => f.extractionKey !== mainFieldKey && !fieldMappings.some((m) => m.fieldKey === f.extractionKey)
    );
    const targetFieldKey = availableField ? availableField.extractionKey : fields[0]?.extractionKey || 'field_1';
    const targetCol = selectedTable.columns.find((c) => c !== mainTableColumn) || selectedTable.columns[0];

    setFieldMappings((prev) => [...prev, { fieldKey: targetFieldKey, tableColumn: targetCol }]);
  };

  const updateFieldMapping = (idx: number, key: 'fieldKey' | 'tableColumn', val: string) => {
    setFieldMappings((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: val };
      return copy;
    });
  };

  const deleteFieldMapping = (idx: number) => {
    setFieldMappings((prev) => prev.filter((_, i) => i !== idx));
  };

  const runTestLookup = (val?: string) => {
    const query = (val !== undefined ? val : testBaseValue).trim();
    if (!query) {
      setTestResult(null);
      return;
    }
    if (!selectedTable || !selectedTable.rows || selectedTable.rows.length === 0) {
      setTestResult({
        tested: true,
        found: false,
        error: 'Selected table has no data rows to search.',
      });
      return;
    }

    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQuery = normalize(query);

    const matchedRow = selectedTable.rows.find((row) => {
      const rowVal = String(row[mainTableColumn] || '').trim();
      if (!rowVal) return false;
      if (rowVal.toLowerCase() === query.toLowerCase()) return true;
      if (normalize(rowVal) === normQuery) return true;
      return false;
    });

    if (matchedRow) {
      const canonicalVal = String(matchedRow[mainTableColumn] || query);
      const autoFilled = (fieldMappings || []).map((m) => {
        const targetField = fields.find((f) => f.extractionKey === m.fieldKey);
        const colVal = matchedRow[m.tableColumn] !== undefined ? String(matchedRow[m.tableColumn]) : '';
        return {
          fieldName: targetField?.name || m.fieldKey,
          fieldKey: m.fieldKey,
          tableColumn: m.tableColumn,
          value: colVal,
        };
      });

      const mappedCols = new Set([mainTableColumn, ...fieldMappings.map((m) => m.tableColumn)]);
      const otherCols = selectedTable.columns
        .filter((col) => !mappedCols.has(col))
        .map((col) => ({
          column: col,
          value: String(matchedRow[col] || ''),
        }));

      setTestResult({
        tested: true,
        found: true,
        canonicalValue: canonicalVal,
        matchedRow,
        autoFilledFields: autoFilled,
        otherColumns: otherCols,
      });
    } else {
      setTestResult({
        tested: true,
        found: false,
        error: `No record matching "${query}" found in "${selectedTable.name}" under column "${mainTableColumn}".`,
      });
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Template name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const sanitizedFields = fields.map((f) => ({
        ...f,
        name: f.name.trim(),
        extractionKey: f.extractionKey.trim() || toSlug(f.name),
        options: f.type === 'select' && f.options ? f.options.filter(Boolean) : undefined,
      }));

      const sanitizedTableFields = hasTable
        ? tableFields.map((col) => ({
            ...col,
            name: col.name.trim(),
            extractionKey: col.extractionKey.trim() || toSlug(col.name),
            options: col.type === 'select' && col.options ? col.options.filter(Boolean) : undefined,
          }))
        : [];

      let lookupConfig: TemplateLookupConfig | undefined = undefined;
      if (lookupEnabled && lookupTableId) {
        lookupConfig = {
          enabled: true,
          tableId: lookupTableId,
          tableName: selectedTable?.name || 'Lookup Table',
          mainFieldKey: mainFieldKey || sanitizedFields[0]?.extractionKey || 'part_no',
          mainTableColumn: mainTableColumn || selectedTable?.columns[0] || 'Part No',
          fieldMappings: fieldMappings.filter((m) => m.fieldKey && m.tableColumn),
          strictValidation: true, // strict table validation always enforced for accuracy
        };
      }

      const payload: DataTemplate = {
        id: template?.id || `template_custom_${Date.now()}`,
        name: name.trim(),
        description: description.trim() || undefined,
        isDefault: template?.isDefault || false,
        fields: sanitizedFields,
        hasTable,
        tableTitle: hasTable ? tableTitle.trim() : undefined,
        tableFields: sanitizedTableFields,
        lookupConfig,
        createdAt: template?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const url = isEditing ? apiUrl(`/api/templates/${template.id}`) : apiUrl('/api/templates');
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to save template.');

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className="bg-card border border-cardBorder rounded-2xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl space-y-4 my-6 flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primaryDark to-primary flex items-center justify-center text-white shadow-md shadow-primary/20">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-text">
                  {isEditing ? 'Edit Data Template' : 'Create Data Template'}
                </h2>
                <p className="text-xs text-textMuted">
                  Configure template fields, master table lookups, and auto-fill rules.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs flex items-center gap-2 shrink-0">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Scroll Area */}
          <div className="flex-1 overflow-y-auto pr-1.5 space-y-5">
            {/* Template Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-textSubtle uppercase tracking-wider">
                  Template Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daily Shift Machine Log"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-textSubtle uppercase tracking-wider">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Industrial machine production run log"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                />
              </div>
            </div>

            {/* ⚡ SECTION 1: Table Lookup / Auto-Fill Configuration */}
            <div className="p-4 rounded-2xl bg-surfaceMuted border border-primary/30 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <span>Table Lookup / Auto-Fill</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-bold border border-primary/40">
                        Strict Validation
                      </span>
                    </h3>
                    <p className="text-[11px] text-textMuted">
                      Speak one main field (e.g. Part No) to automatically look up and fill other fields from an uploaded table.
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lookupEnabled}
                    onChange={(e) => setLookupEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-surfaceMuted border border-cardBorder peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cardBorder after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              {lookupEnabled && (
                <div className="space-y-3 pt-2 border-t border-primary/20">
                  {/* Select Lookup Table */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-8 space-y-1">
                      <label className="text-[11px] font-bold text-textSubtle uppercase tracking-wider block">
                        Select Master Lookup Table
                      </label>
                      <select
                        value={lookupTableId}
                        onChange={(e) => setLookupTableId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                      >
                        {availableTables.length === 0 ? (
                          <option value="">No lookup tables uploaded yet</option>
                        ) : (
                          availableTables.map((tbl) => (
                            <option key={tbl.id} value={tbl.id}>
                              {tbl.name} ({tbl.rows?.length || 0} records, {tbl.columns?.length || 0} cols)
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div className="sm:col-span-4 flex flex-col sm:flex-row items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUploadModalMode('create');
                          setShowUploadModal(true);
                        }}
                        className="w-full sm:flex-1 px-3 py-2 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        title="Upload a new master table"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload New</span>
                      </button>
                      {selectedTable && (
                        <button
                          type="button"
                          onClick={() => {
                            setUploadModalMode('append');
                            setShowUploadModal(true);
                          }}
                          className="w-full sm:flex-1 px-3 py-2 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                          title="Upload additional Excel/CSV files to merge into this master table"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add More Mapping Data</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedTable && (
                    <div className="p-3 bg-surface rounded-xl border border-cardBorder space-y-3">
                      {/* Main Field & Main Column */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-primary uppercase tracking-wider block">
                            Main Spoken Field (Template)
                          </label>
                          <select
                            value={mainFieldKey}
                            onChange={(e) => setMainFieldKey(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-primary/30 text-xs text-text font-bold"
                          >
                            {fields.map((f) => (
                              <option key={f.id} value={f.extractionKey}>
                                {f.name} ({f.extractionKey})
                              </option>
                            ))}
                          </select>
                          <span className="text-[10px] text-textSubtle">
                            The user speaks this field value (e.g. Part No).
                          </span>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-primary uppercase tracking-wider block">
                            Matches Table Column (Master Table)
                          </label>
                          <select
                            value={mainTableColumn}
                            onChange={(e) => setMainTableColumn(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-primary/30 text-xs text-text font-bold"
                          >
                            {(selectedTable.columns || []).map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </select>
                          <span className="text-[10px] text-textSubtle">
                            Column in table containing valid main values.
                          </span>
                        </div>
                      </div>

                      {/* Dependent Auto-Fill Mappings */}
                      <div className="space-y-2 pt-2 border-t border-cardBorder/60">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-textSubtle uppercase tracking-wider">
                            Auto-Fill Field Mappings ({fieldMappings.length})
                          </span>
                          <button
                            type="button"
                            onClick={addFieldMapping}
                            className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Field Mapping</span>
                          </button>
                        </div>

                        {fieldMappings.length === 0 ? (
                          <div className="py-3 text-center text-xs text-textSubtle bg-background/50 rounded-lg">
                            No auto-fill fields mapped. Click <strong>"+ Add Field Mapping"</strong> to link Machine Name, Description, etc.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {fieldMappings.map((mapping, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2 rounded-lg bg-background border border-cardBorder"
                              >
                                <div className="sm:col-span-5">
                                  <label className="text-[9px] text-textSubtle uppercase font-bold block mb-0.5">
                                    Template Field to Auto-Fill
                                  </label>
                                  <select
                                    value={mapping.fieldKey}
                                    onChange={(e) => updateFieldMapping(idx, 'fieldKey', e.target.value)}
                                    className="w-full px-2 py-1 rounded bg-background border border-cardBorder text-xs text-text"
                                  >
                                    {fields
                                      .filter((f) => f.extractionKey !== mainFieldKey)
                                      .map((f) => (
                                        <option key={f.id} value={f.extractionKey}>
                                          {f.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>

                                <div className="sm:col-span-1 flex justify-center text-textSubtle font-bold">
                                  ←
                                </div>

                                <div className="sm:col-span-5">
                                  <label className="text-[9px] text-textSubtle uppercase font-bold block mb-0.5">
                                    From Table Column
                                  </label>
                                  <select
                                    value={mapping.tableColumn}
                                    onChange={(e) => updateFieldMapping(idx, 'tableColumn', e.target.value)}
                                    className="w-full px-2 py-1 rounded bg-background border border-cardBorder text-xs text-text"
                                  >
                                    {(selectedTable.columns || []).map((col) => (
                                      <option key={col} value={col}>
                                        {col}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="sm:col-span-1 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => deleteFieldMapping(idx)}
                                    className="p-1 rounded text-textSubtle hover:text-danger cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 🧪 INTERACTIVE AUTO-FILL TEST TOOL */}
                      <div className="p-3 bg-card rounded-xl border border-primary/30 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                            <Zap className="w-3.5 h-3.5 text-primary" />
                            <span>Test Auto-Fill & Data Retrieval</span>
                          </div>
                          <span className="text-[10px] text-primary/80 font-mono">
                            Base: {fields.find((f) => f.extractionKey === mainFieldKey)?.name || 'Main Field'} ({mainTableColumn})
                          </span>
                        </div>

                        <p className="text-[11px] text-textMuted">
                          Enter or select a base field value to test whether corresponding data is retrieved from <strong>"{selectedTable.name}"</strong>.
                        </p>

                        {/* Test Input & Button */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={testBaseValue}
                              onChange={(e) => {
                                setTestBaseValue(e.target.value);
                                if (e.target.value.trim()) {
                                  runTestLookup(e.target.value);
                                } else {
                                  setTestResult(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  runTestLookup();
                                }
                              }}
                              placeholder={`Enter base value... e.g. ${String(selectedTable.rows[0]?.[mainTableColumn] || 'PRT-4029')}`}
                              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-background border border-cardBorder focus:border-primary text-xs text-text font-mono focus:outline-none"
                            />
                            <Search className="w-3.5 h-3.5 text-textSubtle absolute left-2.5 top-2.5 pointer-events-none" />
                          </div>

                          <button
                            type="button"
                            onClick={() => runTestLookup()}
                            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primaryDark text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer shadow-sm shrink-0"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>Check Data</span>
                          </button>
                        </div>

                        {/* Quick Sample Clickable Chips */}
                        {selectedTable.rows && selectedTable.rows.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-textSubtle font-semibold block">
                              Quick Test Samples from Table:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedTable.rows.slice(0, 6).map((r, i) => {
                                const sampleVal = String(r[mainTableColumn] || '').trim();
                                if (!sampleVal) return null;
                                const isSelected = testBaseValue.toLowerCase() === sampleVal.toLowerCase();
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                      setTestBaseValue(sampleVal);
                                      runTestLookup(sampleVal);
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition cursor-pointer border ${
                                      isSelected
                                        ? 'bg-primary text-white border-primary shadow-sm'
                                        : 'bg-surfaceMuted text-primary border-cardBorder hover:border-primary/50 hover:bg-surface'
                                    }`}
                                  >
                                    {sampleVal}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Live Retrieval Result Box */}
                        {testResult && testResult.tested && (
                          <div
                            className={`p-3 rounded-lg border space-y-2 ${
                              testResult.found
                                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                                : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 font-bold text-xs">
                                {testResult.found ? (
                                  <>
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                    <span>Data Successfully Retrieved for "{testResult.canonicalValue}"</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                                    <span>Data Not Found in Table</span>
                                  </>
                                )}
                              </div>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${
                                  testResult.found
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {testResult.found ? 'MATCH FOUND' : 'NOT FOUND'}
                              </span>
                            </div>

                            {testResult.found ? (
                              <div className="space-y-1.5 pt-1">
                                <div className="text-[10px] text-textSubtle font-semibold uppercase">
                                  Auto-Filled Fields Preview:
                                </div>
                                {testResult.autoFilledFields && testResult.autoFilledFields.length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {testResult.autoFilledFields.map((item, idx) => (
                                      <div
                                        key={idx}
                                        className="p-1.5 rounded bg-surface border border-emerald-500/20 text-[11px] flex items-center justify-between"
                                      >
                                        <span className="text-textSubtle font-medium">
                                          {item.fieldName}:
                                        </span>
                                        <span className="text-text font-bold font-mono text-primary truncate max-w-[140px]">
                                          {item.value || <span className="text-textSubtle italic">empty</span>}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-amber-300 italic">
                                    No dependent fields mapped yet. Map fields above to automatically fill Machine Name, Description, etc.
                                  </p>
                                )}

                                {testResult.otherColumns && testResult.otherColumns.length > 0 && (
                                  <div className="pt-1 text-[10px] text-textSubtle flex flex-wrap gap-1 items-center">
                                    <span className="font-semibold">Other table values:</span>
                                    {testResult.otherColumns.map((oc, i) => (
                                      <span
                                        key={i}
                                        className="px-1.5 py-0.2 rounded bg-surface border border-cardBorder text-textMuted"
                                      >
                                        {oc.column}: <strong>{oc.value}</strong>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-[11px] text-rose-200">
                                {testResult.error}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Strict Validation Info Callout */}
                      <div className="p-2.5 rounded-lg bg-surface border border-primary/20 text-[11px] text-primary flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <strong>Strict Table Validation Active:</strong> Only values registered in{' '}
                          <em>"{selectedTable.name}"</em> are accepted for {fields.find((f) => f.extractionKey === mainFieldKey)?.name || 'Main Field'}.
                          Any unregistered spoken or handwritten value will be strictly rejected with clear error feedback.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 2: Top-Level Template Fields */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-text uppercase tracking-wider">Top-Level Fields</h3>
                  <p className="text-[11px] text-textMuted">Fields extracted per voice entry.</p>
                </div>
                <button
                  type="button"
                  onClick={addField}
                  className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Field
                </button>
              </div>

              <div className="space-y-2.5">
                {fields.map((f, idx) => (
                  <div key={f.id || idx} className="p-3 rounded-xl bg-surface border border-cardBorder space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          value={f.name}
                          onChange={(e) => updateField(idx, 'name', e.target.value)}
                          placeholder="Field Display Name"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          value={f.extractionKey}
                          onChange={(e) => updateField(idx, 'extractionKey', e.target.value)}
                          placeholder="AI Extraction Key"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-textSubtle focus:outline-none focus:border-primary font-mono text-[11px]"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <select
                          value={f.type}
                          onChange={(e) => updateField(idx, 'type', e.target.value as FieldType)}
                          className="w-full px-2 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.type} value={t.type}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => deleteField(idx)}
                          className="text-textSubtle hover:text-danger p-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Fixed / Allowed Values Row if Select Type */}
                    {f.type === 'select' && (
                      <div className="p-2.5 rounded-lg bg-surfaceMuted border border-cardBorder space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] uppercase font-bold text-primary">
                            Fixed / Allowed Dropdown Options (Comma-separated)
                          </label>
                          <span className="text-[10px] text-textSubtle">e.g. A, B, C</span>
                        </div>
                        <input
                          type="text"
                          value={(f.options || []).join(', ')}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const opts = raw.split(',').map((s) => s.trim()).filter(Boolean);
                            updateField(idx, 'options', opts);
                          }}
                          placeholder="e.g. A, B, C"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                        />
                      </div>
                    )}

                    {/* Fixed Value Configuration Drawer if type === 'fixed' or is_fixed */}
                    {(f.type === 'fixed' || f.is_fixed) && (
                      <div className="p-3 rounded-xl bg-card border border-primary/30 space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-primary text-[11px] flex items-center gap-1">
                            <span>🔒 Fixed Value Configuration</span>
                            <span className="text-textSubtle font-normal">
                              (Extraction &amp; Form restricted exclusively to configured values)
                            </span>
                          </span>

                          {/* Source switch: Manual vs File */}
                          <div className="flex items-center rounded-lg bg-surfaceMuted p-0.5 border border-cardBorder">
                            <button
                              type="button"
                              onClick={() => {
                                updateField(idx, 'fixed_source', 'manual');
                                updateField(idx, 'is_fixed', true);
                              }}
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                                (f.fixed_source || 'manual') === 'manual'
                                  ? 'bg-primary text-white font-bold'
                                  : 'text-textSubtle hover:text-text'
                              }`}
                            >
                              Manual
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateField(idx, 'fixed_source', 'file');
                                updateField(idx, 'is_fixed', true);
                              }}
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                                f.fixed_source === 'file'
                                  ? 'bg-primary text-white font-bold'
                                  : 'text-textSubtle hover:text-text'
                              }`}
                            >
                              Upload File (Excel/CSV)
                            </button>
                          </div>
                        </div>

                        {(f.fixed_source || 'manual') === 'manual' ? (
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-primary block">
                              Fixed Value OR Allowed Choices (Comma-separated)
                            </label>
                            <input
                              type="text"
                              value={f.fixed_value || (f.fixed_values || []).join(', ')}
                              onChange={(e) => {
                                const raw = e.target.value;
                                updateField(idx, 'is_fixed', true);
                                if (raw.includes(',')) {
                                  const vals = raw.split(',').map((s) => s.trim()).filter(Boolean);
                                  updateField(idx, 'fixed_values', vals);
                                  updateField(idx, 'fixed_value', vals[0] || '');
                                  updateField(idx, 'options', vals);
                                } else {
                                  updateField(idx, 'fixed_value', raw);
                                  updateField(idx, 'fixed_values', raw ? [raw.trim()] : []);
                                  updateField(idx, 'options', raw ? [raw.trim()] : []);
                                }
                              }}
                              placeholder="e.g. Line 01 OR Line 01, Line 02, Line 03"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                            />
                            <p className="text-[10px] text-textSubtle">
                              Enter a single fixed value, or comma-separated choices that the field is constrained to.
                            </p>
                          </div>
                        ) : (
                          <FixedValueFileUploader
                            currentColumnName={f.fixed_column_name}
                            currentValues={f.fixed_values}
                            currentFileName={f.fixed_file_name}
                            onLoaded={(colName, vals, fName) => {
                              updateField(idx, 'is_fixed', true);
                              updateField(idx, 'fixed_column_name', colName);
                              updateField(idx, 'fixed_values', vals);
                              updateField(idx, 'fixed_value', vals[0] || '');
                              updateField(idx, 'options', vals);
                              updateField(idx, 'fixed_file_name', fName);
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION 3: Repeated Table Toggle & Schema */}
            <div className="space-y-3 pt-3 border-t border-cardBorder">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Table className="w-4 h-4 text-dataColor" />
                  <div>
                    <h3 className="text-xs font-bold text-text uppercase tracking-wider">Include Repeated Table</h3>
                    <p className="text-[10px] sm:text-[11px] text-textMuted">Enable for hourly logs or repeated interval rows.</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={hasTable}
                  onChange={(e) => setHasTable(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary bg-background border-cardBorder cursor-pointer"
                />
              </div>

              {hasTable && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-cardBorder space-y-3">
                  <div>
                    <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                      Table Header Title
                    </label>
                    <input
                      type="text"
                      value={tableTitle}
                      onChange={(e) => setTableTitle(e.target.value)}
                      placeholder="e.g. Hourly Production Logs"
                      className="w-full px-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">Table Columns</label>
                      <button
                        type="button"
                        onClick={addTableField}
                        className="text-xs text-dataColor hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Column
                      </button>
                    </div>

                    {tableFields.map((col, idx) => (
                      <div key={col.id || idx} className="p-2.5 rounded-xl bg-surface/80 border border-cardBorder space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={col.name}
                              onChange={(e) => updateTableField(idx, 'name', e.target.value)}
                              placeholder="Column Name"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                            />
                          </div>

                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={col.extractionKey}
                              onChange={(e) => updateTableField(idx, 'extractionKey', e.target.value)}
                              placeholder="AI Key"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-textSubtle focus:outline-none focus:border-primary font-mono text-[11px]"
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <select
                              value={col.type}
                              onChange={(e) => updateTableField(idx, 'type', e.target.value as FieldType)}
                              className="w-full px-2 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                            >
                              {FIELD_TYPES.map((t) => (
                                <option key={t.type} value={t.type}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => deleteTableField(idx)}
                              className="text-textSubtle hover:text-danger p-1 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 sm:p-4 border-t border-cardBorder bg-surface flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-cardBorder text-textMuted hover:text-text hover:bg-surfaceMuted text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-primary/20 transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Template'}</span>
            </button>
          </div>
        </div>
      </div>

      {showUploadModal && (
        <LookupTableUploadModal
          mode={uploadModalMode}
          existingTable={uploadModalMode === 'append' ? selectedTable : undefined}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(newTable) => {
            setShowUploadModal(false);
            setAvailableTables((prev) => {
              const idx = prev.findIndex((t) => t.id === newTable.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = newTable;
                return copy;
              }
              return [newTable, ...prev];
            });
            setLookupTableId(newTable.id);
            setLookupEnabled(true);
          }}
        />
      )}
    </>
  );
}
