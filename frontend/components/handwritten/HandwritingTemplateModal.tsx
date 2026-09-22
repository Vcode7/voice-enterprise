'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  RotateCcw,
  Save,
  CheckCircle2,
  Layers,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Sparkles,
  FileText,
  Table as TableIcon,
  Database,
  Zap,
  Upload,
  AlertCircle,
  ShieldAlert,
  Search,
  Check,
} from 'lucide-react';
import {
  HandwritingScanningTemplate,
  HandwritingFieldConfig,
  HandwritingTableColumnConfig,
  HandwritingTableConfig,
  HandwritingValueType,
  HandwritingDirection,
  LookupTable,
  TemplateLookupConfig,
  TemplateLookupMapping,
} from '@/types';
import { DEFAULT_HANDWRITING_SCANNING_TEMPLATE, DEFAULT_PARTS_LOOKUP_TABLE } from '@/lib/constants';
import { LookupTableUploadModal } from '../modals/LookupTableUploadModal';
import { FixedValueFileUploader } from '../modals/FixedValueFileUploader';
import { apiUrl } from '@/lib/api/apiClient';

interface HandwritingTemplateModalProps {
  template: HandwritingScanningTemplate;
  allTemplates?: HandwritingScanningTemplate[];
  lookupTables?: LookupTable[];
  onSave: (updatedTemplate: HandwritingScanningTemplate) => void;
  onSelectTemplate?: (templateId: string) => void;
  onCreateTemplate?: () => void;
  onDeleteTemplate?: (templateId: string) => void;
  onClose: () => void;
}

export function HandwritingTemplateModal({
  template,
  allTemplates = [],
  lookupTables: propLookupTables,
  onSave,
  onSelectTemplate,
  onCreateTemplate,
  onDeleteTemplate,
  onClose,
}: HandwritingTemplateModalProps) {
  const [currentTemplate, setCurrentTemplate] = useState<HandwritingScanningTemplate>(
    JSON.parse(JSON.stringify(template))
  );

  const [tables, setTables] = useState<HandwritingTableConfig[]>(() => {
    if (template.tables && template.tables.length > 0) {
      return JSON.parse(JSON.stringify(template.tables));
    }
    return JSON.parse(JSON.stringify(DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || []));
  });

  useEffect(() => {
    setCurrentTemplate(JSON.parse(JSON.stringify(template)));
    setLookupEnabled(template.lookupConfig?.enabled ?? true);
    setLookupTableId(template.lookupConfig?.tableId || 'lookup_parts_catalog');
    setMainFieldKey(template.lookupConfig?.mainFieldKey || 'Part No');
    setMainTableColumn(template.lookupConfig?.mainTableColumn || 'Part No');
    setFieldMappings(template.lookupConfig?.fieldMappings || []);
    setStrictValidation(template.lookupConfig?.strictValidation ?? true);

    if (template.tables && template.tables.length > 0) {
      setTables(JSON.parse(JSON.stringify(template.tables)));
    } else {
      setTables(JSON.parse(JSON.stringify(DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [])));
    }
  }, [template]);

  const [activeTab, setActiveTab] = useState<'fields' | 'table' | 'lookup'>('fields');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // ----------------------------------------------------
  // Master Lookup Table & Auto-Fill State
  // ----------------------------------------------------
  const [availableTables, setAvailableTables] = useState<LookupTable[]>(
    propLookupTables && propLookupTables.length > 0 ? propLookupTables : [DEFAULT_PARTS_LOOKUP_TABLE]
  );
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadModalMode, setUploadModalMode] = useState<'create' | 'append'>('create');

  const [lookupEnabled, setLookupEnabled] = useState<boolean>(
    currentTemplate.lookupConfig?.enabled ?? true
  );
  const [lookupTableId, setLookupTableId] = useState<string>(
    currentTemplate.lookupConfig?.tableId || 'lookup_parts_catalog'
  );
  const [mainFieldKey, setMainFieldKey] = useState<string>(
    currentTemplate.lookupConfig?.mainFieldKey || 'Part No'
  );
  const [mainTableColumn, setMainTableColumn] = useState<string>(
    currentTemplate.lookupConfig?.mainTableColumn || 'Part No'
  );
  const [fieldMappings, setFieldMappings] = useState<TemplateLookupMapping[]>(
    currentTemplate.lookupConfig?.fieldMappings || [
      { fieldKey: 'Machine Name', tableColumn: 'Machine Name' },
      { fieldKey: 'Description', tableColumn: 'Description' },
      { fieldKey: 'Raw Material', tableColumn: 'Raw Material' },
      { fieldKey: 'Cycle Time', tableColumn: 'Cycle Time (s)' },
    ]
  );
  const [strictValidation, setStrictValidation] = useState<boolean>(
    currentTemplate.lookupConfig?.strictValidation ?? true
  );

  // Interactive Live Auto-Fill Test Tool state
  const [testBaseValue, setTestBaseValue] = useState('PRT-4029');
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    found: boolean;
    canonicalValue?: string;
    matchedRow?: Record<string, any>;
    autoFilledFields?: Array<{ fieldName: string; fieldKey: string; tableColumn: string; value: string }>;
    otherColumns?: Array<{ column: string; value: string }>;
    error?: string;
  } | null>(null);

  // Fetch available tables if not loaded
  useEffect(() => {
    fetch(apiUrl('/api/lookup-tables'))
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableTables(data);
          if (!lookupTableId) {
            setLookupTableId(data[0].id);
          }
        }
      })
      .catch((err) => console.warn('Could not load lookup tables for modal:', err));
  }, [lookupTableId]);

  const selectedTable =
    availableTables.find((t) => t.id === lookupTableId) || availableTables[0] || DEFAULT_PARTS_LOOKUP_TABLE;

  // Auto-set main table column if not set or invalid
  useEffect(() => {
    if (selectedTable && selectedTable.columns.length > 0) {
      if (!mainTableColumn || !selectedTable.columns.includes(mainTableColumn)) {
        const matchingCol =
          selectedTable.columns.find(
            (c) => c.toLowerCase() === 'part no' || c.toLowerCase().includes('part')
          ) || selectedTable.columns[0];
        setMainTableColumn(matchingCol);
      }
    }
  }, [selectedTable, mainTableColumn]);

  // Field updates
  const handleUpdateField = (
    index: number,
    key: keyof HandwritingFieldConfig,
    value: any
  ) => {
    const oldName = currentTemplate.fields[index]?.field_name;
    setCurrentTemplate((prev) => {
      const copy = { ...prev, fields: [...prev.fields] };
      copy.fields[index] = { ...copy.fields[index], [key]: value };
      return copy;
    });

    // Update field mappings if field name changed
    if (key === 'field_name' && oldName && value) {
      if (mainFieldKey === oldName) {
        setMainFieldKey(value);
      }
      setFieldMappings((prev) =>
        prev.map((m) => (m.fieldKey === oldName ? { ...m, fieldKey: value } : m))
      );
    }
  };

  const handleAddField = () => {
    const newName = `Custom Field ${currentTemplate.fields.length + 1}`;
    setCurrentTemplate((prev) => ({
      ...prev,
      fields: [
        ...prev.fields,
        {
          id: `hw_field_${Date.now()}`,
          field_name: newName,
          field_type: 'digital',
          value_type: 'h',
          look_for: 'right',
        },
      ],
    }));
  };

  const handleDeleteField = (index: number) => {
    const deleted = currentTemplate.fields[index];
    setCurrentTemplate((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));

    if (deleted) {
      setFieldMappings((prev) => prev.filter((m) => m.fieldKey !== deleted.field_name));
      if (mainFieldKey === deleted.field_name) {
        const remaining = currentTemplate.fields.filter((_, i) => i !== index);
        if (remaining.length > 0) setMainFieldKey(remaining[0].field_name);
      }
    }
  };

  // Multi-table management
  const handleAddTable = () => {
    const newIdx = tables.length + 1;
    const newTable: HandwritingTableConfig = {
      id: `table_${Date.now()}`,
      name: `Table ${newIdx}`,
      columns: [
        {
          id: `hw_col_${Date.now()}_1`,
          column_name: 'Column 1',
          value_type: 'h',
          is_number: false,
          calculate_total: false,
        },
      ],
    };
    setTables((prev) => [...prev, newTable]);
  };

  const handleRemoveTable = (tableIndex: number) => {
    if (tables.length <= 1) {
      alert('At least one table is required in the template.');
      return;
    }
    const tableToRemove = tables[tableIndex];
    if (confirm(`Are you sure you want to delete table "${tableToRemove.name}"?`)) {
      setTables((prev) => prev.filter((_, idx) => idx !== tableIndex));
    }
  };

  const handleUpdateTableName = (tableIndex: number, name: string) => {
    setTables((prev) => {
      const copy = [...prev];
      copy[tableIndex] = { ...copy[tableIndex], name };
      return copy;
    });
  };

  const handleAddColumnToTable = (tableIndex: number) => {
    setTables((prev) => {
      const copy = [...prev];
      const target = { ...copy[tableIndex] };
      const colNum = target.columns.length + 1;
      target.columns = [
        ...target.columns,
        {
          id: `hw_col_${Date.now()}_${colNum}`,
          column_name: `Column ${colNum}`,
          value_type: 'h',
          is_number: false,
          calculate_total: false,
        },
      ];
      copy[tableIndex] = target;
      return copy;
    });
  };

  const handleUpdateTableColumn = (
    tableIndex: number,
    colIndex: number,
    key: keyof HandwritingTableColumnConfig,
    value: any
  ) => {
    setTables((prev) => {
      const copy = [...prev];
      const target = { ...copy[tableIndex] };
      const cols = [...target.columns];
      cols[colIndex] = { ...cols[colIndex], [key]: value };
      target.columns = cols;
      copy[tableIndex] = target;
      return copy;
    });
  };

  const handleDeleteTableColumn = (tableIndex: number, colIndex: number) => {
    setTables((prev) => {
      const copy = [...prev];
      const target = { ...copy[tableIndex] };
      target.columns = target.columns.filter((_, idx) => idx !== colIndex);
      copy[tableIndex] = target;
      return copy;
    });
  };

  // Field Mapping Helpers
  const addFieldMapping = () => {
    if (!selectedTable || selectedTable.columns.length === 0) return;
    const availableField = currentTemplate.fields.find(
      (f) => f.field_name !== mainFieldKey && !fieldMappings.some((m) => m.fieldKey === f.field_name)
    );
    const targetFieldKey = availableField ? availableField.field_name : currentTemplate.fields[0]?.field_name || 'Part No';
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

  // Test Auto-Fill Execution
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
        const colVal = matchedRow[m.tableColumn] !== undefined ? String(matchedRow[m.tableColumn]) : '';
        return {
          fieldName: m.fieldKey,
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

  // Reset to default
  const handleResetDefaults = () => {
    if (
      confirm(
        'Reset this template back to default handwriting fields, tables (Production & Rejection), and Parts & Machines master auto-fill?'
      )
    ) {
      const defaultClone = JSON.parse(JSON.stringify(DEFAULT_HANDWRITING_SCANNING_TEMPLATE));
      setCurrentTemplate(defaultClone);
      if (defaultClone.tables && defaultClone.tables.length > 0) {
        setTables(JSON.parse(JSON.stringify(defaultClone.tables)));
      } else {
        setTables(JSON.parse(JSON.stringify(DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [])));
      }
      if (defaultClone.lookupConfig) {
        setLookupEnabled(defaultClone.lookupConfig.enabled);
        setLookupTableId(defaultClone.lookupConfig.tableId);
        setMainFieldKey(defaultClone.lookupConfig.mainFieldKey);
        setMainTableColumn(defaultClone.lookupConfig.mainTableColumn);
        setFieldMappings(defaultClone.lookupConfig.fieldMappings);
        setStrictValidation(defaultClone.lookupConfig.strictValidation);
      }
    }
  };

  const handleSave = () => {
    let lookupConfig: TemplateLookupConfig | undefined = undefined;
    if (lookupEnabled && lookupTableId) {
      lookupConfig = {
        enabled: true,
        tableId: lookupTableId,
        tableName: selectedTable?.name || 'Lookup Table',
        mainFieldKey: mainFieldKey || 'Part No',
        mainTableColumn: mainTableColumn || 'Part No',
        fieldMappings: fieldMappings.filter((m) => m.fieldKey && m.tableColumn),
        strictValidation: strictValidation,
      };
    }

    const payload: HandwritingScanningTemplate = {
      ...currentTemplate,
      tables: tables,
      table_columns: tables[0]?.columns || currentTemplate.table_columns || [],
      lookupConfig,
      updatedAt: new Date().toISOString(),
    };

    onSave(payload);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

  const directionIcons: Record<HandwritingDirection, React.ReactNode> = {
    right: <ArrowRight className="w-3.5 h-3.5 text-primary" />,
    down: <ArrowDown className="w-3.5 h-3.5 text-amber-400" />,
    left: <ArrowLeft className="w-3.5 h-3.5 text-primary" />,
    up: <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />,
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
        <div className="w-full max-w-4xl bg-card border border-cardBorder rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Modal Header */}
          <div className="p-5 border-b border-cardBorder bg-surface flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-text tracking-tight">
                    Handwriting Scanning Template Configuration
                  </h2>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                    OCR &amp; Auto-Fill Schema
                  </span>
                </div>
                <p className="text-xs text-textMuted mt-0.5">
                  Configure handwriting fields, table column calculations, and master table auto-fill rules.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Multiple Templates Bar */}
          <div className="px-6 py-3 bg-surfaceMuted/50 border-b border-cardBorder flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
              <span className="text-xs font-bold text-textMuted uppercase tracking-wider shrink-0">
                Active Template:
              </span>
              {allTemplates && allTemplates.length > 0 ? (
                <select
                  value={currentTemplate.id}
                  onChange={(e) => onSelectTemplate?.(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-card border border-cardBorder text-xs text-text font-bold focus:outline-none focus:border-primary max-w-[260px]"
                >
                  {allTemplates.map((t) => (
                    <option key={t.id} value={t.id} className="bg-card text-text">
                      {t.name} {t.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-bold text-primary font-mono">
                  {currentTemplate.name}
                </span>
              )}

              {onCreateTemplate && (
                <button
                  type="button"
                  onClick={onCreateTemplate}
                  className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                  title="Create a new handwriting scanning template"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Template</span>
                </button>
              )}

              {onDeleteTemplate && !currentTemplate.isDefault && allTemplates.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete template "${currentTemplate.name}"?`)) {
                      onDeleteTemplate(currentTemplate.id);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-500 dark:text-red-400 border border-red-500/30 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                  title="Delete this custom template"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
            </div>

            {/* Template Name & Description Inline Editor */}
            <div className="flex items-center gap-2 flex-1 min-w-[260px] justify-end">
              <input
                type="text"
                value={currentTemplate.name}
                onChange={(e) => setCurrentTemplate((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Template Name"
                className="px-3 py-1.5 rounded-xl bg-card border border-cardBorder text-xs text-text font-medium focus:outline-none focus:border-primary w-full max-w-[220px]"
                title="Edit Template Name"
              />
            </div>
          </div>

          {/* Informational Guidance Banner */}
          <div className="px-6 py-2.5 bg-surfaceMuted border-b border-primary/20 flex items-start gap-2.5 text-xs text-primary dark:text-primary">
            <Sparkles className="w-4 h-4 text-primary dark:text-primary shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-text">Dedicated Handwriting Pipeline Rules:</span>
              <p className="text-textMuted text-[11px]">
                Labels are digital printed text. For values, choose <strong className="text-text">✍️ h</strong> to run TrOCR handwriting recognition or <strong className="text-text">🖨️ d</strong> to read digital text via PaddleOCR. With Auto-Fill enabled, extracted Part Numbers automatically populate Machine Name, Material, Description, and Cycle Time from the master table!
              </p>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex items-center gap-2 px-6 pt-4 border-b border-cardBorder bg-surface">
            <button
              onClick={() => setActiveTab('fields')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'fields'
                  ? 'border-dataColor dark:border-primary text-primary'
                  : 'border-transparent text-textMuted hover:text-text'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Normal Fields ({currentTemplate.fields.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('table')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'table'
                  ? 'border-dataColor dark:border-primary text-primary'
                  : 'border-transparent text-textMuted hover:text-text'
              }`}
            >
              <TableIcon className="w-4 h-4" />
              <span>Tables ({tables.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('lookup')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'lookup'
                  ? 'border-dataColor dark:border-primary text-primary'
                  : 'border-transparent text-textMuted hover:text-text'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>Auto-Fill &amp; Master Table</span>
              {lookupEnabled && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-primary/15 text-primary font-mono font-bold border border-primary/30">
                  Active
                </span>
              )}
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            {/* TAB 1: Normal Form Fields */}
            {activeTab === 'fields' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-bold text-text">
                    Configured Form Fields ({currentTemplate.fields.length})
                  </span>
                  <button
                    onClick={handleAddField}
                    className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Field</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {currentTemplate.fields.map((field, idx) => (
                    <div
                      key={field.id || idx}
                      className={`p-3.5 rounded-xl transition space-y-2.5 ${
                        field.is_fixed
                          ? 'bg-surface border border-primary/30 shadow-sm'
                          : 'bg-surface/60 border border-cardBorder hover:border-primary/50'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Field Name */}
                        <div className="flex-1 flex items-center gap-3">
                          <span className="text-xs font-mono font-bold text-textMuted w-6">
                            #{idx + 1}
                          </span>
                          <input
                            type="text"
                            value={field.field_name}
                            onChange={(e) => handleUpdateField(idx, 'field_name', e.target.value)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-card border border-cardBorder text-xs text-text font-medium focus:outline-none focus:border-primary"
                            placeholder="Field label in document"
                          />
                          {lookupEnabled && mainFieldKey === field.field_name && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-bold border border-primary/30 whitespace-nowrap">
                              🔑 Main Key
                            </span>
                          )}
                          {lookupEnabled &&
                            fieldMappings.some((m) => m.fieldKey === field.field_name) && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary dark:text-primary font-bold border border-primary/30 whitespace-nowrap">
                                ✨ Auto-Filled
                              </span>
                            )}
                          {field.is_fixed && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-bold border border-primary/30 whitespace-nowrap flex items-center gap-1">
                              <span>🔒 Fixed</span>
                              {field.fixed_values && field.fixed_values.length > 0 && (
                                <span className="opacity-80">({field.fixed_values.length} allowed)</span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Field Controls */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold px-2 py-1 rounded-lg bg-surfaceMuted text-textMuted border border-cardBorder">
                            label: digital
                          </span>

                          {/* Value Type Selector */}
                          <select
                            value={field.value_type}
                            onChange={(e) =>
                              handleUpdateField(idx, 'value_type', e.target.value as HandwritingValueType)
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition focus:outline-none ${
                              field.value_type === 'h'
                                ? 'bg-primary/15 border-primary/40 text-primary dark:text-primary'
                                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            <option value="h" className="bg-card text-text">✍️ h (Handwriting → TrOCR)</option>
                            <option value="d" className="bg-card text-text">🖨️ d (Digital → PaddleOCR)</option>
                          </select>

                          {/* Direction Selector */}
                          <div className="flex items-center gap-1.5 bg-card px-2 py-1 rounded-lg border border-cardBorder">
                            {directionIcons[field.look_for]}
                            <select
                              value={field.look_for}
                              onChange={(e) =>
                                handleUpdateField(idx, 'look_for', e.target.value as HandwritingDirection)
                              }
                              className="bg-transparent text-xs text-text font-medium focus:outline-none cursor-pointer"
                            >
                              <option value="right" className="bg-card text-text">Right (➡️)</option>
                              <option value="down" className="bg-card text-text">Down (⬇️)</option>
                              <option value="left" className="bg-card text-text">Left (⬅️)</option>
                              <option value="up" className="bg-card text-text">Up (⬆️)</option>
                            </select>
                          </div>

                          {/* Fixed Value Toggle Button */}
                          <button
                            type="button"
                            onClick={() => {
                              const next = !field.is_fixed;
                              handleUpdateField(idx, 'is_fixed', next);
                              if (next && !field.fixed_source) {
                                handleUpdateField(idx, 'fixed_source', 'manual');
                              }
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-1 ${
                              field.is_fixed
                                ? 'bg-primary/15 border-primary/40 text-primary'
                                : 'bg-card border-cardBorder text-textMuted hover:text-text'
                            }`}
                            title="Configure fixed value (manual or from Excel/CSV column)"
                          >
                            <span>🔒</span>
                            <span>{field.is_fixed ? 'Fixed Value' : 'Fixed?'}</span>
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteField(idx)}
                            className="p-1.5 text-textMuted hover:text-red-500 rounded-lg hover:bg-surfaceMuted transition cursor-pointer"
                            title="Delete field"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Fixed Value Configuration Drawer */}
                      {field.is_fixed && (
                        <div className="pt-2.5 border-t border-primary/20 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-primary text-[11px] flex items-center gap-1">
                              <span>🔒 Allowed Fixed Values</span>
                              <span className="text-textMuted font-normal">
                                (Strictly restricts form entry &amp; LLM extraction to these values)
                              </span>
                            </span>

                            {/* Source switch */}
                            <div className="flex items-center rounded-lg bg-card p-0.5 border border-cardBorder">
                              <button
                                type="button"
                                onClick={() => handleUpdateField(idx, 'fixed_source', 'manual')}
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                                  (field.fixed_source || 'manual') === 'manual'
                                    ? 'bg-primary text-white font-bold'
                                    : 'text-textMuted hover:text-text'
                                }`}
                              >
                                Manual
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateField(idx, 'fixed_source', 'file')}
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                                  field.fixed_source === 'file'
                                    ? 'bg-primary text-white font-bold'
                                    : 'text-textMuted hover:text-text'
                                }`}
                              >
                                Upload File (Excel/CSV)
                              </button>
                            </div>
                          </div>

                          {(field.fixed_source || 'manual') === 'manual' ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={field.fixed_value || (field.fixed_values || []).join(', ')}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw.includes(',')) {
                                    const vals = raw.split(',').map((s) => s.trim()).filter(Boolean);
                                    handleUpdateField(idx, 'fixed_values', vals);
                                    handleUpdateField(idx, 'fixed_value', vals[0] || '');
                                  } else {
                                    handleUpdateField(idx, 'fixed_value', raw);
                                    handleUpdateField(idx, 'fixed_values', raw ? [raw.trim()] : []);
                                  }
                                }}
                                placeholder="e.g. NEW-150 OR comma-separated: NEW-150, CNC-01, INJ-04"
                                className="w-full px-3 py-1.5 rounded-lg bg-card border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                              />
                              <p className="text-[10px] text-textMuted">
                                Enter a single fixed value (e.g. <code>NEW-150</code>) or multiple comma-separated allowed values.
                              </p>
                            </div>
                          ) : (
                            <FixedValueFileUploader
                              currentColumnName={field.fixed_column_name}
                              currentValues={field.fixed_values}
                              currentFileName={field.fixed_file_name}
                              onLoaded={(colName, vals, fName) => {
                                handleUpdateField(idx, 'fixed_column_name', colName);
                                handleUpdateField(idx, 'fixed_values', vals);
                                handleUpdateField(idx, 'fixed_value', vals[0] || '');
                                handleUpdateField(idx, 'fixed_file_name', fName);
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 2: Multiple Tables & Columns */}
            {activeTab === 'table' && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-surface border border-cardBorder text-xs text-textMuted space-y-1">
                  <span className="font-bold text-text">Table Configuration &amp; Alignment Logic:</span>
                  <p className="text-[11px] leading-relaxed">
                    Configure multiple tables with distinct table names and column headers (e.g. Production Table and Rejection). The OCR pipeline automatically detects matching headers and extracts values based strictly on table column boundaries.
                  </p>
                </div>

                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text">
                      Configured Tables ({tables.length})
                    </span>
                    <span className="text-[10px] text-textMuted font-mono">
                      • {tables.reduce((acc, t) => acc + t.columns.length, 0)} total columns
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddTable}
                    className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Table</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {tables.map((table, tableIdx) => (
                    <div
                      key={table.id || tableIdx}
                      className="rounded-xl bg-surface/50 border border-cardBorder hover:border-cardBorder transition overflow-hidden shadow-sm"
                    >
                      {/* Table Header Row */}
                      <div className="p-3.5 bg-surface border-b border-cardBorder flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 flex-1 min-w-[260px]">
                          <span className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                            <TableIcon className="w-4 h-4" />
                          </span>
                          <span className="text-xs font-mono font-bold text-textMuted">
                            #{tableIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={table.name}
                            onChange={(e) => handleUpdateTableName(tableIdx, e.target.value)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-card border border-cardBorder text-xs text-text font-bold focus:outline-none focus:border-primary max-w-[280px]"
                            placeholder="Table Name (e.g. Production Table, Rejection)"
                          />
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-surfaceMuted text-textMuted font-mono border border-cardBorder whitespace-nowrap">
                            {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAddColumnToTable(tableIdx)}
                            className="px-2.5 py-1.5 rounded-lg bg-card hover:bg-surfaceMuted text-primary text-xs font-semibold flex items-center gap-1 transition cursor-pointer border border-cardBorder"
                            title={`Add a column to ${table.name}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Column</span>
                          </button>

                          {tables.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveTable(tableIdx)}
                              className="p-1.5 text-textMuted hover:text-red-500 rounded-lg hover:bg-surfaceMuted transition cursor-pointer"
                              title={`Delete table "${table.name}"`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Columns List for this Table */}
                      <div className="p-3 space-y-2">
                        {table.columns.length === 0 ? (
                          <div className="text-center py-6 text-xs text-textMuted">
                            No columns defined yet. Click <span className="text-primary font-medium">Add Column</span> above to add headers to this table.
                          </div>
                        ) : (
                          table.columns.map((col, colIdx) => (
                            <div
                              key={col.id || colIdx}
                              className="p-3 rounded-lg bg-card border border-cardBorder hover:border-cardBorder transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="flex-1 flex items-center gap-2.5">
                                <span className="text-[11px] font-mono font-bold text-textMuted w-12 shrink-0">
                                  Col {colIdx + 1}
                                </span>
                                <input
                                  type="text"
                                  value={col.column_name}
                                  onChange={(e) =>
                                    handleUpdateTableColumn(tableIdx, colIdx, 'column_name', e.target.value)
                                  }
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-cardBorder text-xs text-text font-medium focus:outline-none focus:border-primary"
                                  placeholder="Column header title"
                                />
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Number Column Toggle */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextIsNum = !col.is_number;
                                    handleUpdateTableColumn(tableIdx, colIdx, 'is_number', nextIsNum);
                                    if (!nextIsNum) {
                                      handleUpdateTableColumn(tableIdx, colIdx, 'calculate_total', false);
                                    }
                                  }}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-1 ${
                                    col.is_number
                                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300'
                                      : 'bg-surface border-cardBorder text-textMuted hover:text-text'
                                  }`}
                                  title="Mark column as a Number field"
                                >
                                  <span>🔢</span>
                                  <span>Number</span>
                                </button>

                                {/* Calculate Total Option (only if column is number) */}
                                {col.is_number && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateTableColumn(tableIdx, colIdx, 'calculate_total', !col.calculate_total)
                                    }
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-1 ${
                                      col.calculate_total
                                        ? 'bg-primary/15 border-primary/30 text-primary shadow-sm'
                                        : 'bg-surface border-cardBorder text-textMuted hover:text-text'
                                    }`}
                                    title="Automatically sum values in this column"
                                  >
                                    <span>Σ</span>
                                    <span>Calculate Total</span>
                                  </button>
                                )}

                                {/* Value Type Selector */}
                                <select
                                  value={col.value_type}
                                  onChange={(e) =>
                                    handleUpdateTableColumn(
                                      tableIdx,
                                      colIdx,
                                      'value_type',
                                      e.target.value as HandwritingValueType
                                    )
                                  }
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition focus:outline-none ${
                                    col.value_type === 'h'
                                      ? 'bg-primary/15 border-primary/40 text-primary dark:text-primary'
                                      : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                                  }`}
                                >
                                  <option value="d" className="bg-card text-text">🖨️ d (Digital)</option>
                                  <option value="h" className="bg-card text-text">✍️ h (Handwritten)</option>
                                </select>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteTableColumn(tableIdx, colIdx)}
                                  className="p-1.5 text-textMuted hover:text-red-500 rounded-lg hover:bg-surfaceMuted transition cursor-pointer"
                                  title="Delete column"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: Master Table Lookup & Auto-Fill */}
            {activeTab === 'lookup' && (
              <div className="space-y-4">
                {/* Master Table Feature Switch */}
                <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                          <span>Master Table Auto-Fill &amp; Lookup Validation</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-bold">
                            Strict Validation
                          </span>
                        </h3>
                        <p className="text-[11px] text-textMuted">
                          Extract the main part number to automatically fill and cross-verify Machine Name, Material, Description, and Cycle Time from your master catalog.
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
                      <div className="w-9 h-5 bg-surfaceMuted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cardBorder after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>

                  {lookupEnabled && (
                    <div className="space-y-4 pt-3 border-t border-primary/20">
                      {/* Select Lookup Table + Upload */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                        <div className="sm:col-span-8 space-y-1">
                          <label className="text-[11px] font-bold text-textMuted uppercase tracking-wider block">
                            Select Master Catalog Table
                          </label>
                          <select
                            value={lookupTableId}
                            onChange={(e) => setLookupTableId(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-card border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                          >
                            {availableTables.length === 0 ? (
                              <option value="" className="bg-card text-text">No lookup tables uploaded yet</option>
                            ) : (
                              availableTables.map((tbl) => (
                                <option key={tbl.id} value={tbl.id} className="bg-card text-text">
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
                            title="Upload a new lookup table"
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
                              title="Upload additional Excel/CSV files to merge into this master catalog"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add More Mapping Data</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {selectedTable && (
                        <div className="p-3.5 bg-surface rounded-xl border border-cardBorder space-y-3.5">
                          {/* Main Field & Main Column */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-primary uppercase tracking-wider block">
                                Main Scanned Field (Template)
                              </label>
                              <select
                                value={mainFieldKey}
                                onChange={(e) => setMainFieldKey(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-card border border-primary/30 text-xs text-text font-bold"
                              >
                                {currentTemplate.fields.map((f) => (
                                  <option key={f.id} value={f.field_name} className="bg-card text-text">
                                    {f.field_name}
                                  </option>
                                ))}
                              </select>
                              <span className="text-[10px] text-textMuted">
                                The OCR / Gemini reads this base field (e.g. Part No).
                              </span>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-primary uppercase tracking-wider block">
                                Matches Master Table Column
                              </label>
                              <select
                                value={mainTableColumn}
                                onChange={(e) => setMainTableColumn(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-card border border-primary/30 text-xs text-text font-bold"
                              >
                                {(selectedTable.columns || []).map((col) => (
                                  <option key={col} value={col} className="bg-card text-text">
                                    {col}
                                  </option>
                                ))}
                              </select>
                              <span className="text-[10px] text-textMuted">
                                Column in master table containing valid part codes.
                              </span>
                            </div>
                          </div>

                          {/* Strict Validation Checkbox */}
                          <div className="flex items-center justify-between p-2.5 rounded-lg bg-card border border-cardBorder">
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold text-text flex items-center gap-1.5">
                                <ShieldAlert className="w-3.5 h-3.5 text-primary" />
                                <span>Strict Catalog Validation</span>
                              </div>
                              <p className="text-[10px] text-textMuted">
                                Automatically rejects invalid or unrecognized part codes to prevent handwritten hallucinations.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={strictValidation}
                              onChange={(e) => setStrictValidation(e.target.checked)}
                              className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                            />
                          </div>

                          {/* Dependent Auto-Fill Mappings */}
                          <div className="space-y-2 pt-2 border-t border-cardBorder">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
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
                              <div className="py-3 text-center text-xs text-textMuted bg-card rounded-lg border border-cardBorder">
                                No auto-fill fields mapped. Click <strong>"+ Add Field Mapping"</strong> to link Machine Name, Description, etc.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {fieldMappings.map((mapping, idx) => (
                                  <div
                                    key={idx}
                                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2 rounded-lg bg-card border border-cardBorder"
                                  >
                                    <div className="sm:col-span-5">
                                      <label className="text-[9px] text-textMuted uppercase font-bold block mb-0.5">
                                        Template Field to Auto-Fill
                                      </label>
                                      <select
                                        value={mapping.fieldKey}
                                        onChange={(e) => updateFieldMapping(idx, 'fieldKey', e.target.value)}
                                        className="w-full px-2 py-1 rounded bg-surface border border-cardBorder text-xs text-text"
                                      >
                                        {currentTemplate.fields
                                          .filter((f) => f.field_name !== mainFieldKey)
                                          .map((f) => (
                                            <option key={f.id} value={f.field_name} className="bg-card text-text">
                                              {f.field_name}
                                            </option>
                                          ))}
                                      </select>
                                    </div>

                                    <div className="sm:col-span-1 flex justify-center text-primary font-bold">
                                      ←
                                    </div>

                                    <div className="sm:col-span-5">
                                      <label className="text-[9px] text-textMuted uppercase font-bold block mb-0.5">
                                        From Table Column
                                      </label>
                                      <select
                                        value={mapping.tableColumn}
                                        onChange={(e) => updateFieldMapping(idx, 'tableColumn', e.target.value)}
                                        className="w-full px-2 py-1 rounded bg-surface border border-cardBorder text-xs text-text"
                                      >
                                        {(selectedTable.columns || []).map((col) => (
                                          <option key={col} value={col} className="bg-card text-text">
                                            {col}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="sm:col-span-1 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => deleteFieldMapping(idx)}
                                        className="p-1 rounded text-textMuted hover:text-red-500 cursor-pointer"
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
                          <div className="p-3.5 bg-card rounded-xl border border-primary/30 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                                <Zap className="w-3.5 h-3.5 text-primary" />
                                <span>Interactive Auto-Fill Test Tool</span>
                              </div>
                              <span className="text-[10px] text-primary/80 font-mono">
                                Base: {mainFieldKey} ({mainTableColumn})
                              </span>
                            </div>

                            <p className="text-[11px] text-textMuted">
                              Type or click a sample part number to test how data is retrieved from <strong>"{selectedTable.name}"</strong>.
                            </p>

                            {/* Quick Sample Chips */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold text-textMuted uppercase">Quick Samples:</span>
                              {['PRT-4029', '29465634', 'PRT-1002', 'PRT-8831'].map((sample) => (
                                <button
                                  key={sample}
                                  type="button"
                                  onClick={() => {
                                    setTestBaseValue(sample);
                                    runTestLookup(sample);
                                  }}
                                  className="px-2 py-0.5 rounded-md bg-surface hover:bg-surfaceMuted text-[11px] font-mono font-medium text-primary border border-cardBorder transition cursor-pointer"
                                >
                                  {sample}
                                </button>
                              ))}
                            </div>

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
                                  placeholder={`Enter test ${mainFieldKey} (e.g. PRT-4029)...`}
                                  className="w-full px-3 py-1.5 rounded-lg bg-surface border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => runTestLookup()}
                                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primaryDark text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                              >
                                <Search className="w-3.5 h-3.5" />
                                <span>Lookup</span>
                              </button>
                            </div>

                            {/* Test Results Display */}
                            {testResult && (
                              <div className="pt-2 border-t border-cardBorder">
                                {testResult.found ? (
                                  <div className="space-y-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
                                    <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                      <div className="flex items-center gap-1.5">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                                        <span>Record Match Found: <strong>"{testResult.canonicalValue}"</strong></span>
                                      </div>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 font-mono">
                                        Valid
                                      </span>
                                    </div>

                                    {testResult.autoFilledFields && testResult.autoFilledFields.length > 0 && (
                                      <div className="space-y-1 pt-1">
                                        <div className="text-[10px] font-bold text-textMuted uppercase">
                                          Auto-Filled Values ({testResult.autoFilledFields.length}):
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                          {testResult.autoFilledFields.map((f, i) => (
                                            <div
                                              key={i}
                                              className="p-1.5 rounded bg-surface border border-cardBorder text-[11px] flex items-center justify-between"
                                            >
                                              <span className="text-textMuted">{f.fieldName}:</span>
                                              <span className="font-bold text-emerald-600 dark:text-emerald-300 font-mono truncate ml-2">
                                                {f.value || <span className="text-textMuted italic">empty</span>}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
                                    <div>
                                      <div className="font-bold">No Match Found</div>
                                      <p className="text-[11px] text-rose-600 dark:text-rose-200/80">{testResult.error}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-4 border-t border-cardBorder bg-surface flex items-center justify-between">
            <button
              onClick={handleResetDefaults}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-textMuted hover:text-text hover:bg-surfaceMuted flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default Schema</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-textMuted hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-primary/20 cursor-pointer"
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-950" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Template</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lookup Table Upload Modal */}
      {showUploadModal && (
        <LookupTableUploadModal
          mode={uploadModalMode}
          existingTable={uploadModalMode === 'append' ? selectedTable : undefined}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(newTable) => {
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
            setShowUploadModal(false);
          }}
        />
      )}
    </>
  );
}
