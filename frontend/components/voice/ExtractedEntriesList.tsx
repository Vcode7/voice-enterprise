'use client';

import React, { useState } from 'react';
import {
  Save,
  Printer,
  FileSpreadsheet,
  Trash2,
  Plus,
  Volume2,
  CheckCircle2,
  Sparkles,
  Layers,
  RotateCcw,
  AlertCircle,
  Clock,
  Loader2,
  Mic,
  Radio,
  FileText,
  X,
  Eye,
  Edit3,
  Table as TableIcon,
} from 'lucide-react';
import { SessionDataEntry, DataTemplate, TemplateField, LookupTable } from '@/types';
import { VoiceAudioPlayer } from '@/components/voice/VoiceAudioPlayer';
import { normalizeToIsoDate } from '@/lib/utils/dateUtils';
import { getTableColumnMinWidthPx } from '@/lib/utils/tableColumnWidth';

interface ExtractedEntriesListProps {
  entries: SessionDataEntry[];
  templates: DataTemplate[];
  activeTemplate: DataTemplate;
  lookupTables?: LookupTable[];
  isSaving: boolean;
  // Live Recording / Extraction state for pending entry
  isRecording?: boolean;
  isProcessing?: boolean;
  processingStatus?: string;
  dataMode?: 'template' | 'flexible';
  // Actions
  onReview?: () => void;
  onEdit?: () => void;
  onSaveAll: () => void;
  onPrint: () => void;
  onExportExcel: () => void;
  onClearAll: () => void;
  onAddManualEntry: () => void;
  onDeleteEntry: (id: string) => void;
  onUpdateEntryField: (entryId: string, fieldKey: string, value: any) => void;
  onUpdateFlexibleField: (entryId: string, fieldIdx: number, key: 'name' | 'value', value: any) => void;
  onAddFlexibleField: (entryId: string) => void;
  onDeleteFlexibleField: (entryId: string, fieldIdx: number) => void;
  onUpdateTableRow: (entryId: string, rowIdx: number, colKey: string | number, value: any, tableIdx?: number) => void;
  onAddTableRow: (entryId: string, tableIdx?: number) => void;
  onDeleteTableRow: (entryId: string, rowIdx: number, tableIdx?: number) => void;
}

export function ExtractedEntriesList({
  entries,
  templates,
  activeTemplate,
  lookupTables = [],
  isSaving,
  isRecording = false,
  isProcessing = false,
  processingStatus = '',
  dataMode = 'template',
  onReview,
  onEdit,
  onSaveAll,
  onPrint,
  onExportExcel,
  onClearAll,
  onAddManualEntry,
  onDeleteEntry,
  onUpdateEntryField,
  onUpdateFlexibleField,
  onAddFlexibleField,
  onDeleteFlexibleField,
  onUpdateTableRow,
  onAddTableRow,
  onDeleteTableRow,
}: ExtractedEntriesListProps) {
  const [expandedAudioEntryId, setExpandedAudioEntryId] = useState<string | null>(null);
  const [expandedDocEntryId, setExpandedDocEntryId] = useState<string | null>(null);
  const [expandedOcrEntryId, setExpandedOcrEntryId] = useState<string | null>(null);

  const isPending = isRecording || isProcessing;
  const nextEntryNumber = entries.length + 1;

  return (
    <div className="bg-card border border-cardBorder rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Top Header / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cardBorder/60 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center border border-primary/30 shadow-md">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text flex items-center gap-2">
              <span>Extracted Entries</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surfaceMuted text-primary font-mono font-bold border border-cardBorder">
                {entries.length} {entries.length === 1 ? 'record' : 'records'}
              </span>
            </h2>
            <p className="text-[11px] text-textMuted">
              Review, edit attributes, verify table auto-fill, and export.
            </p>
          </div>
        </div>

        {/* Global Batch Action Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onAddManualEntry}
            disabled={isSaving}
            className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
            title="Add an empty manual entry to this batch"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Entry</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            disabled={entries.length === 0 || isSaving}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 dark:text-emerald-300 dark:border-emerald-500/30 text-xs font-semibold flex items-center gap-1 transition disabled:opacity-40 cursor-pointer"
            title="Export session entries to Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Excel</span>
          </button>

          <button
            type="button"
            onClick={onPrint}
            disabled={entries.length === 0 || isSaving}
            className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1 transition disabled:opacity-40 cursor-pointer"
            title="Print Clean Sheet"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Print</span>
          </button>

          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              disabled={isSaving}
              className="p-1.5 rounded-lg bg-surface hover:bg-danger/20 text-textSubtle hover:text-danger border border-cardBorder transition cursor-pointer"
              title="Clear all session entries"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Review Button - Left side beside Save All */}
          {onReview && (
            <button
              type="button"
              onClick={onReview}
              disabled={entries.length === 0 || isSaving}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary hover:text-primary dark:hover:text-primary border border-cardBorder hover:border-primary/50 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-40 cursor-pointer shadow-sm"
              title="Review entries side-by-side with document"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Review</span>
            </button>
          )}

          {/* Edit Button - Left side beside Save All */}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              disabled={entries.length === 0 || isSaving}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary hover:text-primaryDark border border-cardBorder hover:border-primary/50 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-40 cursor-pointer shadow-sm"
              title="Edit entries and tables"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          )}

          <button
            type="button"
            onClick={onSaveAll}
            disabled={entries.length === 0 || isSaving}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-primary/20 transition disabled:opacity-40 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save All ({entries.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Entries List Area */}
      <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">
        {entries.length === 0 && !isPending ? (
          <div className="py-14 text-center text-xs text-textMuted bg-surface/50 rounded-2xl border border-dashed border-cardBorder p-6 space-y-2">
            <Mic className="w-8 h-8 text-primary mx-auto opacity-50" />
            <p className="font-bold text-text text-sm">No entries in session yet</p>
            <p className="text-textSubtle max-w-sm mx-auto">
              Speak into the microphone or upload a handwritten document sheet on the right to extract structured entries.
            </p>
          </div>
        ) : (
          <>
            {entries.map((entry) => {
              const isTemplateMode =
                entry.mode === 'template' ||
                !entry.mode ||
                dataMode === 'template' ||
                Boolean(entry.templateId) ||
                Boolean(activeTemplate);

              const template = isTemplateMode
                ? templates.find((t) => t.id === entry.templateId) || activeTemplate
                : null;

              return (
                <div
                  key={entry.id}
                  className="p-4 rounded-2xl bg-card border border-cardBorder space-y-3.5 hover:border-cardBorder/80 transition shadow-sm"
                >
                  {/* Entry Header Banner */}
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-cardBorder/60 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg bg-primary text-white font-mono font-extrabold text-xs">
                        Entry {entry.entryNumber}
                      </span>
                      <span className="text-xs font-bold text-text truncate">
                        {entry.title || entry.templateName || (entry.mode === 'flexible' ? 'Flexible Record' : 'Template Form')}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceMuted text-textSubtle border border-cardBorder">
                        {entry.mode === 'flexible' ? 'Flexible' : 'Template'}
                      </span>
                      {entry.sourceType === 'handwritten' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold border border-primary/30">
                          ✍️ Handwritten
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {entry.audioUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedAudioEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                          className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                            expandedAudioEntryId === entry.id
                              ? 'bg-primary text-white'
                              : 'bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder'
                          }`}
                          title="Play audio recording"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          <span className="text-[10px] hidden sm:inline">Audio</span>
                        </button>
                      )}

                      {entry.documentUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDocEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                          className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                            expandedDocEntryId === entry.id
                              ? 'bg-primary text-white'
                              : 'bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder'
                          }`}
                          title="View uploaded document"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span className="text-[10px] hidden sm:inline">Doc</span>
                        </button>
                      )}

                      {entry.rawOcrText && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedOcrEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                          className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                            expandedOcrEntryId === entry.id
                              ? 'bg-primary text-white'
                              : 'bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder'
                          }`}
                          title="View raw OCR transcript"
                        >
                          <span className="text-[10px]">OCR</span>
                        </button>
                      )}

                      <span className="text-[10px] text-textSubtle font-mono mr-1">
                        {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>

                      <button
                        type="button"
                        onClick={() => onDeleteEntry(entry.id)}
                        className="p-1.5 rounded-lg bg-surface hover:bg-danger/20 hover:text-danger text-textSubtle border border-cardBorder transition cursor-pointer"
                        title="Delete this entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Audio Player */}
                  {expandedAudioEntryId === entry.id && entry.audioUrl && (
                    <div className="p-2 bg-surface rounded-lg border border-cardBorder">
                      <VoiceAudioPlayer audioUrl={entry.audioUrl} />
                    </div>
                  )}

                  {/* Inline Document Preview Drawer */}
                  {expandedDocEntryId === entry.id && entry.documentUrl && (
                    <div className="p-3 bg-surface rounded-xl border border-cardBorder space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                        <span>Original Scanned Document</span>
                        <button
                          type="button"
                          onClick={() => setExpandedDocEntryId(null)}
                          className="text-textSubtle hover:text-text cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="max-h-60 overflow-auto rounded-lg border border-cardBorder bg-surfaceMuted flex justify-center p-2">
                        <img
                          src={entry.documentUrl}
                          alt="Document"
                          className="max-h-56 object-contain rounded"
                        />
                      </div>
                    </div>
                  )}

                  {/* Inline Raw OCR Transcript Drawer */}
                  {expandedOcrEntryId === entry.id && entry.rawOcrText && (
                    <div className="p-3 bg-surface rounded-xl border border-cardBorder text-xs text-textMuted space-y-1.5 font-mono">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase text-primary">
                        <span>Raw OCR / Handwriting Transcription</span>
                        <button
                          type="button"
                          onClick={() => setExpandedOcrEntryId(null)}
                          className="text-textSubtle hover:text-text font-sans cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <pre className="text-[11px] text-text whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {entry.rawOcrText}
                      </pre>
                    </div>
                  )}

                  {/* Voice Transcript Quote */}
                  {entry.rawTranscript && !entry.rawOcrText && (
                    <div className="p-2 bg-surface rounded-lg border-l-2 border-primary text-xs text-textMuted italic flex items-start gap-1.5">
                      <span className="text-[10px] font-bold uppercase not-italic text-primary shrink-0">
                        Transcript:
                      </span>
                      <span className="text-text">"{entry.rawTranscript}"</span>
                    </div>
                  )}

                  {/* Missing Fields Warning Alert */}
                  {entry.missingFields && entry.missingFields.length > 0 && (
                    <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          <strong>Missing from document:</strong> {entry.missingFields.join(', ')}
                        </span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono font-bold shrink-0">
                        Review Needed
                      </span>
                    </div>
                  )}

                  {/* Table Lookup Validation / Auto-Fill Result Banners */}
                  {entry.lookupValidation && !entry.lookupValidation.isValid && (
                    <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-rose-200">Strict Table Validation Rejection</div>
                        <p className="text-[11px] mt-0.5">{entry.lookupValidation.error}</p>
                      </div>
                    </div>
                  )}

                  {entry.lookupValidation && entry.lookupValidation.isValid && (
                    <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">
                          Matched <strong>{entry.lookupValidation.matchedValue}</strong> in <em>"{entry.lookupValidation.tableName}"</em> • Auto-filled {entry.lookupValidation.autoFilledCount} fields!
                        </span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 font-mono font-bold shrink-0">
                        Verified
                      </span>
                    </div>
                  )}

                  {/* Editable Fields Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-textSubtle uppercase tracking-wider">
                        Fields &amp; Values
                      </span>
                      {entry.mode === 'flexible' && (
                        <button
                          type="button"
                          onClick={() => onAddFlexibleField(entry.id)}
                          className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Field</span>
                        </button>
                      )}
                    </div>

                    {/* Mode 1: Template Fields & Extracted Field Values */}
                    {(() => {
                      const entryFieldValues: Record<string, any> =
                        entry.fieldValues || (entry as any).field_values || (entry as any).data || {};

                      const templateFields = template?.fields || [];

                      // If pure flexible mode with NO structured field values detected, show flexible attributes
                      if (entry.mode === 'flexible' && templateFields.length === 0 && Object.keys(entryFieldValues).length === 0) {
                        return (
                          <div className="space-y-2">
                            {entry.flexibleFields && entry.flexibleFields.length > 0 ? (
                              entry.flexibleFields.map((f, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={f.name}
                                    onChange={(e) =>
                                      onUpdateFlexibleField(entry.id, idx, 'name', e.target.value)
                                    }
                                    placeholder="Field Name"
                                    className="w-1/3 px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-primary font-bold focus:outline-none focus:border-primary"
                                  />
                                  <input
                                    type="text"
                                    value={f.value}
                                    onChange={(e) =>
                                      onUpdateFlexibleField(entry.id, idx, 'value', e.target.value)
                                    }
                                    placeholder="Field Value"
                                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => onDeleteFlexibleField(entry.id, idx)}
                                    className="p-1 rounded text-textSubtle hover:text-danger cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-textSubtle italic">No attributes detected.</div>
                            )}
                          </div>
                        );
                      }

                      // Robust resolver for a field's value across multiple potential keys
                      const resolveFieldValue = (fieldKey: string, altName?: string, altId?: string) => {
                        if (entryFieldValues[fieldKey] !== undefined && entryFieldValues[fieldKey] !== null) {
                          return entryFieldValues[fieldKey];
                        }
                        if (altName && entryFieldValues[altName] !== undefined && entryFieldValues[altName] !== null) {
                          return entryFieldValues[altName];
                        }
                        if (altId && entryFieldValues[altId] !== undefined && entryFieldValues[altId] !== null) {
                          return entryFieldValues[altId];
                        }
                        const searchLower = (fieldKey || altName || '').trim().toLowerCase();
                        const matched = Object.entries(entryFieldValues).find(
                          ([k]) => k.trim().toLowerCase() === searchLower
                        );
                        if (matched !== undefined && matched[1] !== null) {
                          return matched[1];
                        }
                        return '';
                      };

                      // Identify any extra fields extracted by LLM not defined in the template
                      const matchedFieldKeys = new Set<string>();
                      templateFields.forEach((tf) => {
                        [tf.extractionKey, tf.name, tf.id].forEach((k) => {
                          if (k) matchedFieldKeys.add(k.trim().toLowerCase());
                        });
                      });

                      const extraFieldEntries = Object.entries(entryFieldValues).filter(
                        ([k]) => !matchedFieldKeys.has(k.trim().toLowerCase())
                      );

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {/* 1. Standard Template Defined Fields */}
                          {templateFields.map((field) => {
                            const val = resolveFieldValue(field.extractionKey, field.name, field.id);
                            const isMainLookup =
                              template?.lookupConfig?.enabled &&
                              (template.lookupConfig.mainFieldKey === field.extractionKey ||
                                template.lookupConfig.mainFieldKey === field.name);
                            const isAutoFilled =
                              template?.lookupConfig?.enabled &&
                              template.lookupConfig.fieldMappings?.some(
                                (m) => m.fieldKey === field.extractionKey || m.fieldKey === field.name
                              );

                            const activeLookupTable = template?.lookupConfig?.enabled
                              ? lookupTables.find((t) => t.id === template.lookupConfig?.tableId)
                              : null;

                            const handleFieldChange = (newVal: any) => {
                              onUpdateEntryField(entry.id, field.extractionKey || field.name, newVal);

                              if (isMainLookup && activeLookupTable && activeLookupTable.rows) {
                                const mainCol = template.lookupConfig!.mainTableColumn;
                                const matched = activeLookupTable.rows.find((r) => {
                                  const colVal = String(r[mainCol] || '').trim();
                                  return (
                                    colVal.toLowerCase() === String(newVal).trim().toLowerCase() ||
                                    colVal.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                                      String(newVal).trim().toLowerCase().replace(/[^a-z0-9]/g, '')
                                  );
                                });

                                if (matched) {
                                  (template.lookupConfig!.fieldMappings || []).forEach((m) => {
                                    const targetVal = matched[m.tableColumn];
                                    if (targetVal !== undefined && targetVal !== null) {
                                      onUpdateEntryField(entry.id, m.fieldKey, targetVal);
                                    }
                                  });
                                }
                              }
                            };

                            // Check for Fixed Value field
                            const isFixedField = field.is_fixed || field.type === 'fixed';
                            const fixedChoices =
                              field.fixed_values && field.fixed_values.length > 0
                                ? field.fixed_values
                                : (field.type === 'fixed' && field.options && field.options.length > 0
                                    ? field.options
                                    : null);

                            if (isFixedField && fixedChoices && fixedChoices.length > 0) {
                              const effectiveVal = val || field.fixed_value || fixedChoices[0];
                              return (
                                <div key={field.id} className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-primary uppercase truncate block flex items-center gap-1">
                                      <span>{field.name}</span>
                                    </label>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-bold border border-primary/30">
                                      🔒 Fixed List ({fixedChoices.length})
                                    </span>
                                  </div>
                                  <select
                                    value={effectiveVal}
                                    onChange={(e) => handleFieldChange(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-primary/40 text-xs text-text focus:outline-none focus:border-primary font-bold"
                                  >
                                    {fixedChoices.map((opt) => (
                                      <option key={opt} value={opt} className="bg-card text-text">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            }

                            if (isFixedField && field.fixed_value) {
                              const effectiveVal = val || field.fixed_value;
                              return (
                                <div key={field.id} className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-primary uppercase truncate block">
                                      {field.name}
                                    </label>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary dark:text-primary font-bold border border-primary/30">
                                      🔒 Fixed
                                    </span>
                                  </div>
                                  <input
                                    type="text"
                                    value={effectiveVal}
                                    onChange={(e) => handleFieldChange(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-surfaceMuted/50 border border-cardBorder text-xs text-text font-bold focus:outline-none focus:border-primary"
                                  />
                                </div>
                              );
                            }

                            if (field.type === 'select' || (field.options && field.options.length > 0)) {
                              return (
                                <div key={field.id} className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-textSubtle uppercase truncate block">
                                      {field.name}
                                    </label>
                                    {isAutoFilled && (
                                      <span className="text-[9px] text-primary font-semibold">✨ Auto</span>
                                    )}
                                  </div>
                                  <select
                                    value={val ?? ''}
                                    onChange={(e) => handleFieldChange(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                                  >
                                    <option value="" className="bg-card text-textSubtle">
                                      Select {field.name}...
                                    </option>
                                    {(field.options || []).map((opt) => (
                                      <option key={opt} value={opt} className="bg-card text-text">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            }

                            if (field.type === 'boolean') {
                              const isChecked = val === true || val === 'true' || val === 'yes' || val === '1';
                              return (
                                <div key={field.id} className="space-y-1">
                                  <label className="text-[10px] font-bold text-textSubtle uppercase truncate block">
                                    {field.name}
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => handleFieldChange(!isChecked)}
                                    className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                                      isChecked
                                        ? 'bg-success/20 text-success border border-success/40'
                                        : 'bg-background text-textSubtle border border-cardBorder'
                                    }`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>{isChecked ? 'YES / PASS' : 'NO / FAIL'}</span>
                                  </button>
                                </div>
                              );
                            }

                            return (
                              <div key={field.id} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label
                                    className={`text-[10px] font-bold uppercase truncate block ${
                                      isMainLookup ? 'text-primary' : 'text-textSubtle'
                                    }`}
                                  >
                                    {field.name}
                                  </label>
                                  {isMainLookup && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-primary/15 text-primary font-mono font-bold">
                                      Main
                                    </span>
                                  )}
                                  {isAutoFilled && (
                                    <span className="text-[9px] text-primary font-semibold">✨ Auto</span>
                                  )}
                                </div>

                                {isMainLookup && activeLookupTable && activeLookupTable.rows ? (
                                  <div className="relative">
                                    <input
                                      type="text"
                                      list={`lookup_list_${entry.id}_${field.id}`}
                                      value={val ?? ''}
                                      onChange={(e) => handleFieldChange(e.target.value)}
                                      placeholder={field.placeholder || `Enter or pick ${field.name}...`}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-primary/40 text-xs text-text focus:outline-none focus:border-primary font-bold"
                                    />
                                    <datalist id={`lookup_list_${entry.id}_${field.id}`}>
                                      {activeLookupTable.rows.map((r, rIdx) => {
                                        const code = r[template.lookupConfig!.mainTableColumn];
                                        return code ? <option key={r.id || rIdx} value={code} /> : null;
                                      })}
                                    </datalist>
                                  </div>
                                ) : (() => {
                                  const isDateField =
                                    field.type === 'date' ||
                                    field.name.toLowerCase().includes('date') ||
                                    field.extractionKey.toLowerCase().includes('date');

                                  const normalizedDate = isDateField ? normalizeToIsoDate(val) : '';
                                  const inputType =
                                    field.type === 'number'
                                      ? 'number'
                                      : isDateField
                                      ? 'date'
                                      : field.type === 'time'
                                      ? 'time'
                                      : 'text';

                                  const displayVal = isDateField ? normalizedDate : (val ?? '');

                                  return (
                                    <input
                                      type={inputType}
                                      value={displayVal}
                                      onChange={(e) => handleFieldChange(e.target.value)}
                                      placeholder={field.placeholder || `Enter ${field.name}...`}
                                      className={`w-full px-2.5 py-1.5 rounded-lg bg-background border text-xs text-text focus:outline-none font-medium ${
                                        isAutoFilled
                                          ? 'border-primary/40 focus:border-primary bg-surfaceMuted/50 dark:bg-slate-950/40'
                                          : 'border-cardBorder focus:border-primary'
                                      }`}
                                    />
                                  );
                                })()}
                              </div>
                            );
                          })}

                          {/* 2. Additional Extracted Fields from LLM not in template */}
                          {extraFieldEntries.map(([extraKey, extraVal]) => (
                            <div key={extraKey} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-textSubtle uppercase truncate block">
                                  {extraKey}
                                </label>
                                <span className="text-[9px] px-1 py-0.2 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
                                  Extracted
                                </span>
                              </div>
                              <input
                                type="text"
                                value={extraVal ?? ''}
                                onChange={(e) => onUpdateEntryField(entry.id, extraKey, e.target.value)}
                                placeholder={`Enter ${extraKey}...`}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder focus:border-primary text-xs text-text focus:outline-none font-medium"
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Tables Rendering */}
                  {entry.tables && entry.tables.length > 0 ? (
                    <div className="pt-2 border-t border-cardBorder/60 space-y-4">
                      {entry.tables.map((tbl, tblIdx) => (
                        <div key={tblIdx} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                              <span>{tbl.name || `Table ${tblIdx + 1}`}</span>
                              <span className="text-[10px] px-2 py-0.2 rounded-full bg-surfaceMuted text-primary font-mono border border-cardBorder">
                                {tbl.rows?.length || 0} {tbl.rows?.length === 1 ? 'row' : 'rows'}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => onAddTableRow(entry.id, tblIdx)}
                              className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Row</span>
                            </button>
                          </div>

                          <div className="w-full overflow-x-auto rounded-xl border border-cardBorder bg-background scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900/80 shadow-inner">
                            <table className="min-w-full w-max text-left text-xs border-collapse table-auto">
                              <thead className="sticky top-0 z-10 bg-surface shadow-sm">
                                <tr className="bg-surface text-textSubtle text-[10px] uppercase font-bold border-b border-cardBorder">
                                  <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center">#</th>
                                  {(tbl.headers || []).map((h, i) => {
                                    const minPx = getTableColumnMinWidthPx(h);
                                    return (
                                      <th
                                        key={i}
                                        style={{ minWidth: `${minPx}px` }}
                                        className="p-2 font-bold whitespace-nowrap text-textMuted"
                                      >
                                        {h}
                                      </th>
                                    );
                                  })}
                                  <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-cardBorder/50 font-medium">
                                {!tbl.rows || tbl.rows.length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={(tbl.headers?.length || 0) + 2}
                                      className="p-3 text-center text-textSubtle italic text-xs"
                                    >
                                      No entries extracted yet for this table. Click "+ Add Row" to add entries.
                                    </td>
                                  </tr>
                                ) : (
                                  tbl.rows.map((row: any, rIdx: number) => (
                                    <tr key={rIdx} className="hover:bg-surface/60 transition">
                                      <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-textSubtle font-mono text-[10px]">
                                        {rIdx + 1}
                                      </td>
                                      {(tbl.headers || []).map((colName, cIdx) => {
                                        const minPx = getTableColumnMinWidthPx(colName);
                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ minWidth: `${minPx}px` }}
                                            className="p-1.5"
                                          >
                                            <input
                                              type="text"
                                              value={
                                                typeof row === 'object' && row !== null && !Array.isArray(row)
                                                  ? (row[colName] ?? '')
                                                  : Array.isArray(row)
                                                  ? (row[cIdx] ?? '')
                                                  : ''
                                              }
                                              onChange={(e) =>
                                                onUpdateTableRow(
                                                  entry.id,
                                                  rIdx,
                                                  Array.isArray(row) ? cIdx : colName,
                                                  e.target.value,
                                                  tblIdx
                                                )
                                              }
                                              placeholder="-"
                                              className="w-full min-w-[65px] px-2 py-1 bg-card border border-cardBorder rounded text-xs text-text focus:outline-none focus:border-primary font-mono transition"
                                            />
                                          </td>
                                        );
                                      })}
                                      <td className="p-1.5 w-12 min-w-[48px] max-w-[48px] text-center">
                                        <button
                                          type="button"
                                          onClick={() => onDeleteTableRow(entry.id, rIdx, tblIdx)}
                                          className="p-1 text-textSubtle hover:text-danger rounded cursor-pointer transition"
                                          title="Delete row"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : ((entry.mode === 'template' && template?.hasTable) ||
                    (entry.mode === 'flexible' && entry.tableRows && entry.tableRows.length > 0)) ? (
                    <div className="pt-2 border-t border-cardBorder/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                          {entry.tableTitle || template?.tableTitle || 'Repeated Logs Table'} ({entry.tableRows?.length || 0} rows)
                        </span>
                        <button
                          type="button"
                          onClick={() => onAddTableRow(entry.id)}
                          className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Row</span>
                        </button>
                      </div>

                      {entry.tableRows && entry.tableRows.length > 0 && (
                        <div className="w-full overflow-x-auto rounded-xl border border-cardBorder bg-background scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900/80 shadow-inner">
                          <table className="min-w-full w-max text-left text-xs border-collapse table-auto">
                            <thead className="sticky top-0 z-10 bg-surface shadow-sm">
                              <tr className="bg-surface text-textSubtle text-[10px] uppercase font-bold border-b border-cardBorder">
                                <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center">#</th>
                                {entry.mode === 'template' && template
                                  ? (template.tableFields || []).map((col) => {
                                      const minPx = getTableColumnMinWidthPx(col.name, col.type === 'number');
                                      return (
                                        <th
                                          key={col.id}
                                          style={{ minWidth: `${minPx}px` }}
                                          className="p-2 font-bold text-textMuted whitespace-nowrap"
                                        >
                                          {col.name}
                                        </th>
                                      );
                                    })
                                  : (entry.tableHeaders || ['Item', 'Quantity', 'Notes']).map((h, i) => {
                                      const minPx = getTableColumnMinWidthPx(h);
                                      return (
                                        <th
                                          key={i}
                                          style={{ minWidth: `${minPx}px` }}
                                          className="p-2 font-bold text-textMuted whitespace-nowrap"
                                        >
                                          {h}
                                        </th>
                                      );
                                    })}
                                <th className="p-2 w-12 min-w-[48px] max-w-[48px] text-center"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-cardBorder/50 font-medium">
                              {entry.tableRows.map((row: any, rIdx: number) => (
                                <tr key={rIdx} className="hover:bg-surface/60 transition">
                                  <td className="p-2 w-12 min-w-[48px] max-w-[48px] text-center text-textSubtle font-mono text-[10px]">
                                    {rIdx + 1}
                                  </td>
                                  {entry.mode === 'template' && template
                                    ? (template.tableFields || []).map((col, cIdx) => {
                                        const minPx = getTableColumnMinWidthPx(col.name, col.type === 'number');
                                        return (
                                          <td
                                            key={col.id}
                                            style={{ minWidth: `${minPx}px` }}
                                            className="p-1.5"
                                          >
                                            <input
                                              type="text"
                                              value={
                                                typeof row === 'object' && row !== null && !Array.isArray(row)
                                                  ? (row[col.extractionKey] ?? row[col.name] ?? '')
                                                  : Array.isArray(row)
                                                  ? (row[cIdx] ?? '')
                                                  : ''
                                              }
                                              onChange={(e) =>
                                                onUpdateTableRow(entry.id, rIdx, col.extractionKey, e.target.value)
                                              }
                                              placeholder={`-`}
                                              className="w-full min-w-[65px] px-2 py-1 bg-card border border-cardBorder rounded text-xs text-text focus:outline-none focus:border-primary font-mono transition"
                                            />
                                          </td>
                                        );
                                      })
                                    : (entry.tableHeaders || ['Item', 'Quantity', 'Notes']).map((h, cIdx) => {
                                        const minPx = getTableColumnMinWidthPx(h);
                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ minWidth: `${minPx}px` }}
                                            className="p-1.5"
                                          >
                                            <input
                                              type="text"
                                              value={Array.isArray(row) ? row[cIdx] ?? '' : row[cIdx] ?? ''}
                                              onChange={(e) =>
                                                onUpdateTableRow(entry.id, rIdx, cIdx, e.target.value)
                                              }
                                              placeholder={`-`}
                                              className="w-full min-w-[65px] px-2 py-1 bg-card border border-cardBorder rounded text-xs text-text focus:outline-none focus:border-primary font-mono transition"
                                            />
                                          </td>
                                        );
                                      })}
                                  <td className="p-1.5 w-12 min-w-[48px] max-w-[48px] text-center">
                                    <button
                                      type="button"
                                      onClick={() => onDeleteTableRow(entry.id, rIdx)}
                                      className="p-1 text-textSubtle hover:text-danger rounded cursor-pointer transition"
                                      title="Delete row"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        {/* Live Pending Extraction & Template Preview Card */}
        {isPending && (
          <div className="p-4 rounded-2xl bg-card border-2 border-dashed border-primary/60 shadow-xl shadow-primary/20 space-y-4 relative overflow-hidden transition-all">
            {/* Top Ambient Highlight */}
            <div className="absolute top-0 right-0 w-64 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />

            {/* Preview Card Header */}
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-primary/30 flex-wrap relative z-10">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-primaryDark to-primary text-white font-mono font-extrabold text-xs shadow-md shadow-primary/20 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-950 animate-ping" />
                  <span>Entry {nextEntryNumber}</span>
                </span>

                <span className="text-xs font-bold text-dataColor dark:text-primary flex items-center gap-1.5">
                  <span>{dataMode === 'template' ? activeTemplate?.name || 'Template Form' : 'Flexible Voice Record'}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-semibold border border-primary/30">
                    Live Preview
                  </span>
                </span>

                {dataMode === 'template' && activeTemplate?.lookupConfig?.enabled && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-semibold border border-emerald-500/30 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Auto-Fill Ready</span>
                  </span>
                )}
              </div>

              {/* Status Pill Badge */}
              <div className="flex items-center gap-2">
                {isRecording ? (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-500 dark:text-rose-300 text-xs font-bold animate-pulse shadow-sm shadow-rose-500/20">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                    <Mic className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                    <span>Listening &amp; Recording...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-bold shadow-sm shadow-primary/20">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    <span>{processingStatus || 'Extracting structured fields...'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Informational Guidance Banner */}
            <div className="p-3 rounded-xl bg-surface border border-primary/20 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-primary/90">
                <Radio className="w-4 h-4 text-primary shrink-0 animate-pulse" />
                <span>
                  {isRecording
                    ? `Dictating into Entry #${nextEntryNumber}. Spoken entities will align with the template fields below.`
                    : `${processingStatus || 'Transcribing with Whisper AI and aligning entities with template schema...'}`}
                </span>
              </div>
              <span className="text-[10px] font-mono text-textSubtle shrink-0 font-bold hidden sm:inline">
                {dataMode === 'template' ? `${(activeTemplate?.fields || []).length} Fields Loaded` : 'Dynamic Freeform'}
              </span>
            </div>

            {/* Template Fields Skeleton & Preview */}
            {dataMode === 'template' ? (
              <div className="space-y-3 relative z-10">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Current Template Fields Preview</span>
                  </span>
                  <span className="text-[10px] text-textSubtle font-mono">
                    Awaiting voice input
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {(activeTemplate?.fields || []).map((field) => {
                    const isAutoFilled =
                      activeTemplate?.lookupConfig?.enabled &&
                      activeTemplate.lookupConfig.fieldMappings?.some((m) => m.fieldKey === field.extractionKey);
                    const isMainLookup =
                      activeTemplate?.lookupConfig?.enabled &&
                      activeTemplate.lookupConfig.mainFieldKey === field.extractionKey;

                    return (
                      <div
                        key={field.id || field.extractionKey}
                        className="p-2.5 rounded-xl bg-surface border border-cardBorder space-y-1.5 relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-textSubtle uppercase truncate block">
                            {field.name}
                            {field.required && <span className="text-rose-400 ml-0.5">*</span>}
                          </label>
                          {isMainLookup ? (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-500 dark:text-amber-300 font-semibold border border-amber-500/30">
                              🔑 Lookup Key
                            </span>
                          ) : isAutoFilled ? (
                            <span className="text-[9px] text-primary font-semibold">
                              ✨ Auto-Fill
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-textSubtle uppercase">
                              {field.type}
                            </span>
                          )}
                        </div>

                        {/* Shimmering Field Preview Input Box */}
                        <div className="h-9 px-3 rounded-lg bg-surfaceMuted/50 border border-cardBorder relative overflow-hidden flex items-center justify-between text-xs text-textSubtle">
                          <div className="absolute inset-0 skeleton-shimmer opacity-40 pointer-events-none" />
                          <span className="text-primary/70 italic font-mono text-[11px] truncate relative z-10 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping shrink-0" />
                            <span>{field.placeholder || `Listening for ${field.name}...`}</span>
                          </span>
                          {field.type === 'select' && (
                            <span className="text-[10px] text-textSubtle shrink-0 relative z-10 font-mono">
                              ▼
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Table Preview (if template has table) */}
                {activeTemplate?.hasTable && activeTemplate?.tableFields && activeTemplate.tableFields.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-cardBorder/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>{activeTemplate?.tableTitle || 'Repeated Entries Grid Preview'}</span>
                      </span>
                      <span className="text-[10px] font-mono text-textSubtle">
                        {activeTemplate.tableFields.length} columns ready
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-cardBorder bg-card">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-surface border-b border-cardBorder">
                            <th className="p-2 text-[10px] font-bold text-textSubtle uppercase tracking-wider w-10 text-center">
                              #
                            </th>
                            {activeTemplate.tableFields.map((col) => (
                              <th
                                key={col.id || col.extractionKey}
                                className="p-2 text-[10px] font-bold text-primary uppercase tracking-wider whitespace-nowrap"
                              >
                                {col.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[1, 2].map((rowNum) => (
                            <tr key={rowNum} className="border-b border-cardBorder/40">
                              <td className="p-2 text-center text-[10px] font-mono text-textSubtle">
                                {rowNum}
                              </td>
                              {activeTemplate.tableFields.map((col) => (
                                <td key={col.id || col.extractionKey} className="p-2">
                                  <div className="h-6 rounded bg-surfaceMuted/50 border border-cardBorder skeleton-shimmer opacity-50 flex items-center px-2 text-[10px] text-primary/50 italic font-mono">
                                    Listening...
                                  </div>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Flexible Mode Preview */
              <div className="space-y-3 relative z-10">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Flexible Data Entity Recognition</span>
                  </span>
                  <span className="text-[10px] text-textSubtle font-mono">
                    Auto-structures any spoken keys
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {['Title / Document Name', 'Item Name', 'Quantity / Value', 'Status / Remarks'].map((fieldLabel, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-surface border border-cardBorder space-y-1.5 relative overflow-hidden"
                    >
                      <label className="text-[10px] font-bold text-textSubtle uppercase truncate block">
                        {fieldLabel}
                      </label>
                      <div className="h-9 px-3 rounded-lg bg-surfaceMuted/50 border border-cardBorder relative overflow-hidden flex items-center text-xs text-textSubtle">
                        <div className="absolute inset-0 skeleton-shimmer opacity-40 pointer-events-none" />
                        <span className="text-primary/70 italic font-mono text-[11px] truncate relative z-10 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping shrink-0" />
                          <span>Listening for {fieldLabel}...</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
