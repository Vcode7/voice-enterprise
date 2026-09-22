'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Layers,
  Sparkles,
  Search,
  Trash2,
  Edit2,
  Printer,
  Save,
  CheckCircle2,
  Database,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useWebAudioRecorder } from '@/hooks/useWebAudioRecorder';
import {
  DataTemplate,
  DataEntryRecord,
  ExtractedDataResult,
  FlexibleExtractedResult,
  SessionDataEntry,
  UserSettings,
  LookupTable,
} from '@/types';
import { DEFAULT_MONITORING_DETAILS_TEMPLATE, DEFAULT_SETTINGS } from '@/lib/constants';
import { formatDateDisplay } from '@/lib/utils/dateUtils';
import { exportEntriesToExcel } from '@/lib/utils/excelExporter';
import { VoiceRecordingPanel } from '@/components/voice/VoiceRecordingPanel';
import { ExtractedEntriesList } from '@/components/voice/ExtractedEntriesList';
import { PrintableEntriesReport } from '@/components/voice/PrintableEntriesReport';
import { BatchDataEntryViewModal } from '@/components/modals/BatchDataEntryViewModal';
import { TemplateManagerModal } from '@/components/modals/TemplateManagerModal';
import { apiUrl } from '@/lib/api/apiClient';

export default function HomePage() {
  // 1. Extraction mode (Template Form is Default)
  const [dataMode, setDataMode] = useState<'template' | 'flexible'>('template');
  const [templates, setTemplates] = useState<DataTemplate[]>([]);
  const [lookupTables, setLookupTables] = useState<LookupTable[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<DataTemplate>(DEFAULT_MONITORING_DETAILS_TEMPLATE);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  // 2. Accumulated Session Entries (Left Panel)
  const [entries, setEntries] = useState<SessionDataEntry[]>([]);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 3. Voice recording & extraction state (Right Panel)
  const recorder = useWebAudioRecorder();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastExtractedEntryNumber, setLastExtractedEntryNumber] = useState<number | null>(null);

  // 4. Saved Database Records (History section below)
  const [records, setRecords] = useState<DataEntryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('All');
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [showSavedHistory, setShowSavedHistory] = useState(false);

  // Modal for viewing past saved batch records
  const [modalMode, setModalMode] = useState<{
    isOpen: boolean;
    existingRecord?: DataEntryRecord;
  }>({ isOpen: false });

  // Fetch initial data
  const fetchTemplatesAndRecords = useCallback(async () => {
    try {
      setLoadingRecords(true);
      const [tmplRes, tableRes, recRes, setRes] = await Promise.allSettled([
        fetch(apiUrl('/api/templates')),
        fetch(apiUrl('/api/lookup-tables')),
        fetch(apiUrl('/api/data-entries')),
        fetch(apiUrl('/api/settings')),
      ]);

      if (tmplRes.status === 'fulfilled' && tmplRes.value.ok) {
        try {
          const tmplData = await tmplRes.value.json();
          if (Array.isArray(tmplData) && tmplData.length > 0) {
            setTemplates(tmplData);
            const def = tmplData.find((t: DataTemplate) => t.isDefault) || tmplData[0];
            setActiveTemplate((prev) => (prev.id === DEFAULT_MONITORING_DETAILS_TEMPLATE.id ? def : prev));
          }
        } catch (err) {
          console.warn('Could not parse templates JSON:', err);
        }
      }

      if (tableRes.status === 'fulfilled' && tableRes.value.ok) {
        try {
          const tableData = await tableRes.value.json();
          if (Array.isArray(tableData)) setLookupTables(tableData);
        } catch (err) {
          console.warn('Could not parse lookup-tables JSON:', err);
        }
      }

      if (recRes.status === 'fulfilled' && recRes.value.ok) {
        try {
          const recData = await recRes.value.json();
          if (Array.isArray(recData)) setRecords(recData);
        } catch (err) {
          console.warn('Could not parse data-entries JSON:', err);
        }
      }

      if (setRes.status === 'fulfilled' && setRes.value.ok) {
        try {
          const setData = await setRes.value.json();
          if (setData && !setData.error) setSettings(setData);
        } catch (err) {
          console.warn('Could not parse settings JSON:', err);
        }
      }
    } catch (e) {
      console.error('Failed to load initial data:', e);
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplatesAndRecords();
  }, [fetchTemplatesAndRecords]);

  // Keep recorder's audio URL in state
  useEffect(() => {
    if (recorder.audioUrl) {
      setLastAudioUrl(recorder.audioUrl);
    }
  }, [recorder.audioUrl]);

  // Handle microphone toggle
  const handleMicPress = async () => {
    if (recorder.state === 'Recording') {
      const blob = await recorder.stopRecording();
      if (!blob) return;

      try {
        setIsProcessing(true);
        recorder.setState('Transcribing');
        setProcessingStatus('Transcribing speech with Whisper AI...');

        const formData = new FormData();
        formData.append('file', blob, 'recording.webm');

        const transcribeRes = await fetch(apiUrl('/api/groq/transcribe'), {
          method: 'POST',
          body: formData,
        });

        if (!transcribeRes.ok) {
          const errData = await transcribeRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Audio transcription failed.');
        }

        const { text } = await transcribeRes.json();
        setLastTranscript(text);
        recorder.setState('Understanding');
        setProcessingStatus('Extracting entities & matching table lookup...');

        const currentEntryNum = entries.length + 1;
        const entryId = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const recordedAudioUrl = recorder.audioUrl || (blob ? URL.createObjectURL(blob) : null);
        setLastAudioUrl(recordedAudioUrl);

        if (dataMode === 'flexible') {
          const res = await fetch(apiUrl('/api/groq/flexible'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: text }),
          });
          const data: FlexibleExtractedResult = await res.json();

          const newEntry: SessionDataEntry = {
            id: entryId,
            entryNumber: currentEntryNum,
            mode: 'flexible',
            templateId: 'flexible',
            templateName: data.title || 'Flexible Voice Record',
            title: data.title || 'Flexible Voice Record',
            fieldValues: (data.fields || []).reduce((acc, f) => ({ ...acc, [f.name]: f.value }), {}),
            flexibleFields: data.fields || [],
            tableTitle: data.table?.title || 'Detected Data Table',
            tableHeaders: data.table?.headers || ['Time Interval', 'Produced Qty', 'Status'],
            tableRows: data.table?.rows || [],
            rawTranscript: text,
            audioUrl: recordedAudioUrl,
            createdAt: new Date().toISOString(),
          };

          setEntries((prev) => [...prev, newEntry]);
        } else {
          const res = await fetch(apiUrl('/api/groq/custom-data'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: text, template: activeTemplate }),
          });
          const data: ExtractedDataResult = await res.json();

          const newEntry: SessionDataEntry = {
            id: entryId,
            entryNumber: currentEntryNum,
            mode: 'template',
            templateId: activeTemplate.id,
            templateName: activeTemplate.name,
            title: activeTemplate.name,
            fieldValues: data.fieldValues || {},
            tableTitle: activeTemplate.tableTitle || 'Repeated Entries',
            tableHeaders: activeTemplate.tableFields?.map((f) => f.name) || [],
            tableRows: data.tableRows || [],
            lookupValidation: data.lookupValidation || null,
            rawTranscript: text,
            audioUrl: recordedAudioUrl,
            createdAt: new Date().toISOString(),
          };

          setEntries((prev) => [...prev, newEntry]);
        }

        setLastExtractedEntryNumber(currentEntryNum);
        recorder.setState('Ready');
      } catch (err: any) {
        console.error('Voice-to-Data Processing Error:', err);
        recorder.setErrorMessage(err.message || 'Processing failed. Please try again.');
        recorder.setState('Error');
      } finally {
        setIsProcessing(false);
      }
    } else {
      await recorder.startRecording();
    }
  };

  // Add Manual Entry to Session
  const handleAddManualEntry = () => {
    const currentEntryNum = entries.length + 1;
    const entryId = `entry_manual_${Date.now()}`;

    if (dataMode === 'flexible') {
      const newEntry: SessionDataEntry = {
        id: entryId,
        entryNumber: currentEntryNum,
        mode: 'flexible',
        templateId: 'flexible',
        templateName: 'Manual Flexible Record',
        title: 'Manual Record',
        fieldValues: { 'Field 1': '' },
        flexibleFields: [{ name: 'Field 1', value: '' }],
        tableTitle: 'Table Rows',
        tableHeaders: ['Time', 'Quantity', 'Status'],
        tableRows: [['', '', '']],
        createdAt: new Date().toISOString(),
      };
      setEntries((prev) => [...prev, newEntry]);
    } else {
      const initialFields: Record<string, any> = {};
      activeTemplate.fields.forEach((f) => {
        initialFields[f.extractionKey] = f.defaultValue || '';
      });

      const initialTableRows: Array<Record<string, any>> = [];
      if (activeTemplate.hasTable && activeTemplate.tableFields?.length > 0) {
        const row: Record<string, any> = {};
        activeTemplate.tableFields.forEach((c) => {
          row[c.extractionKey] = '';
        });
        initialTableRows.push(row);
      }

      const newEntry: SessionDataEntry = {
        id: entryId,
        entryNumber: currentEntryNum,
        mode: 'template',
        templateId: activeTemplate.id,
        templateName: activeTemplate.name,
        title: activeTemplate.name,
        fieldValues: initialFields,
        tableTitle: activeTemplate.tableTitle || 'Repeated Entries',
        tableHeaders: activeTemplate.tableFields?.map((f) => f.name) || [],
        tableRows: initialTableRows,
        createdAt: new Date().toISOString(),
      };
      setEntries((prev) => [...prev, newEntry]);
    }
  };

  // Update entry field in session
  const handleUpdateEntryField = (entryId: string, fieldKey: string, value: any) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        return {
          ...e,
          fieldValues: {
            ...e.fieldValues,
            [fieldKey]: value,
          },
        };
      })
    );
  };

  const handleUpdateFlexibleField = (
    entryId: string,
    fieldIdx: number,
    key: 'name' | 'value',
    value: any
  ) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])];
        if (flex[fieldIdx]) {
          flex[fieldIdx] = { ...flex[fieldIdx], [key]: value };
        }
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleAddFlexibleField = (entryId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])];
        flex.push({ name: `Field ${flex.length + 1}`, value: '' });
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleDeleteFlexibleField = (entryId: string, fieldIdx: number) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])].filter((_, i) => i !== fieldIdx);
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleUpdateTableRow = (
    entryId: string,
    rowIdx: number,
    colKey: string | number,
    value: any
  ) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const rows = [...(e.tableRows || [])];
        if (Array.isArray(rows[rowIdx])) {
          const cells = [...(rows[rowIdx] as any[])];
          cells[Number(colKey)] = value;
          rows[rowIdx] = cells;
        } else if (typeof rows[rowIdx] === 'object' && rows[rowIdx] !== null) {
          rows[rowIdx] = { ...rows[rowIdx], [colKey]: value };
        }
        return { ...e, tableRows: rows };
      })
    );
  };

  const handleAddTableRow = (entryId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const rows = [...(e.tableRows || [])];
        if (e.mode === 'flexible') {
          const cellCount = e.tableHeaders?.length || 3;
          rows.push(new Array(cellCount).fill(''));
        } else {
          const tmpl = templates.find((t) => t.id === e.templateId) || activeTemplate;
          const newRow: Record<string, any> = {};
          (tmpl.tableFields || []).forEach((c) => {
            newRow[c.extractionKey] = '';
          });
          rows.push(newRow);
        }
        return { ...e, tableRows: rows };
      })
    );
  };

  const handleDeleteTableRow = (entryId: string, rowIdx: number) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const rows = [...(e.tableRows || [])].filter((_, i) => i !== rowIdx);
        return { ...e, tableRows: rows };
      })
    );
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== id);
      return filtered.map((e, idx) => ({ ...e, entryNumber: idx + 1 }));
    });
  };

  const handleClearAllEntries = () => {
    if (entries.length === 0) return;
    if (!confirm('Are you sure you want to clear all current session entries?')) return;
    setEntries([]);
  };

  // Save All entries into database
  const handleSaveAll = async () => {
    if (entries.length === 0) return;

    try {
      setIsSavingAll(true);
      setSaveSuccessMsg(null);

      const payload: Omit<DataEntryRecord, 'id' | 'createdAt' | 'updatedAt'> = {
        templateId: dataMode === 'template' ? activeTemplate.id : 'flexible',
        templateName: dataMode === 'template' ? activeTemplate.name : 'Flexible Voice Session',
        isFlexible: dataMode === 'flexible',
        title:
          dataMode === 'template'
            ? `${activeTemplate.name} Batch (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})`
            : `Flexible Voice Batch (${entries.length} entries)`,
        fieldValues: entries[0]?.fieldValues || {},
        flexibleFields: entries[0]?.flexibleFields || undefined,
        tableTitle: entries[0]?.tableTitle || undefined,
        tableHeaders: entries[0]?.tableHeaders || undefined,
        tableRows: entries[0]?.tableRows || [],
        rawTranscript: entries.map((e) => `[Entry ${e.entryNumber}]: ${e.rawTranscript || 'Dictated entry'}`).join('\n\n'),
        entries: entries,
        totalEntries: entries.length,
        date: new Date().toISOString().split('T')[0],
      };

      const res = await fetch(apiUrl('/api/data-entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save entries.');
      }

      setSaveSuccessMsg(`Successfully saved all ${entries.length} entries to database!`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      setEntries([]);
      fetchTemplatesAndRecords();
    } catch (err: any) {
      console.error('Save all error:', err);
      alert(err.message || 'Failed to save entries.');
    } finally {
      setIsSavingAll(false);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (entries.length === 0) {
      alert('No entries to export.');
      return;
    }
    exportEntriesToExcel(
      entries.map((e) => ({
        entryNumber: e.entryNumber,
        mode: e.mode,
        templateName: e.templateName,
        title: e.title,
        fieldValues: e.fieldValues,
        flexibleFields: e.flexibleFields,
        tableTitle: e.tableTitle,
        tableHeaders: e.tableHeaders,
        tableRows: e.tableRows,
        tables: e.tables,
        rawTranscript: e.rawTranscript,
        createdAt: e.createdAt,
      })),
      `${activeTemplate.name.replace(/\s+/g, '_')}_Session`
    );
  };

  // Print multi-entry clean sheet
  const handlePrint = () => {
    if (entries.length === 0) {
      alert('No entries to print.');
      return;
    }
    window.print();
  };

  // Delete saved past database record
  const handleDeleteRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this saved record?')) return;
    try {
      await fetch(apiUrl(`/api/data-entries/${id}`), { method: 'DELETE' });
      fetchTemplatesAndRecords();
    } catch (err) {
      console.error(err);
    }
  };

  // Filter saved records
  const filteredRecords = records.filter((r) => {
    if (filterTemplate !== 'All') {
      if (filterTemplate === 'flexible') {
        if (!r.isFlexible && r.templateId !== 'flexible') return false;
      } else {
        if (r.templateId !== filterTemplate && r.templateName !== filterTemplate) return false;
      }
    }

    if (!search.trim()) return true;
    const query = search.toLowerCase();
    const matchesName = (r.title || r.templateName || '').toLowerCase().includes(query);
    const matchesTranscript = (r.rawTranscript || '').toLowerCase().includes(query);
    const matchesFieldValues = Object.values(r.fieldValues || {}).some((v) =>
      String(v).toLowerCase().includes(query)
    );
    const matchesFlex = (r.flexibleFields || []).some(
      (f) => f.name.toLowerCase().includes(query) || String(f.value).toLowerCase().includes(query)
    );
    return matchesName || matchesTranscript || matchesFieldValues || matchesFlex;
  });

  return (
    <>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2.5">
              <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              <span>Voice Data Entry</span>
              <span className="text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full bg-primary/15 text-primary">
                Live Studio
              </span>
            </h1>
            <p className="text-xs text-textMuted mt-0.5">
              Continuous voice dictation with master table auto-fill, strict validation, and Excel export.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSavedHistory((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl bg-card hover:bg-surface border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-primary" />
              <span>{showSavedHistory ? 'Hide Database History' : `Database History (${records.length})`}</span>
              {showSavedHistory ? <ChevronUp className="w-3 h-3 text-textSubtle" /> : <ChevronDown className="w-3 h-3 text-textSubtle" />}
            </button>
          </div>
        </div>

        {saveSuccessMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 shadow-lg animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-semibold">{saveSuccessMsg}</span>
          </div>
        )}

        {/* Main 2-Column Voice Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column (7 cols): Extracted Entries List & Actions */}
          <div className="lg:col-span-7 h-full">
            <ExtractedEntriesList
              entries={entries}
              templates={templates}
              activeTemplate={activeTemplate}
              lookupTables={lookupTables}
              isSaving={isSavingAll}
              isRecording={recorder.state === 'Recording'}
              isProcessing={
                isProcessing ||
                recorder.state === 'Processing' ||
                recorder.state === 'Transcribing' ||
                recorder.state === 'Understanding'
              }
              processingStatus={processingStatus}
              dataMode={dataMode}
              onReview={() => {
                if (entries.length > 0) {
                  setModalMode({
                    isOpen: true,
                    existingRecord: {
                      id: 'current_session',
                      batchId: 'current_batch',
                      templateId: activeTemplate.id,
                      templateName: activeTemplate.name,
                      title: activeTemplate.name,
                      date: new Date().toISOString().split('T')[0],
                      entries: entries,
                      fieldValues: entries[0]?.fieldValues || {},
                      createdAt: new Date().toISOString(),
                      status: 'pending',
                    } as any,
                  });
                }
              }}
              onEdit={() => {
                if (entries.length > 0) {
                  const el = document.getElementById(`entry-${entries[0].id}`);
                  el?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              onSaveAll={handleSaveAll}
              onPrint={handlePrint}
              onExportExcel={handleExportExcel}
              onClearAll={handleClearAllEntries}
              onAddManualEntry={handleAddManualEntry}
              onDeleteEntry={handleDeleteEntry}
              onUpdateEntryField={handleUpdateEntryField}
              onUpdateFlexibleField={handleUpdateFlexibleField}
              onAddFlexibleField={handleAddFlexibleField}
              onDeleteFlexibleField={handleDeleteFlexibleField}
              onUpdateTableRow={handleUpdateTableRow}
              onAddTableRow={handleAddTableRow}
              onDeleteTableRow={handleDeleteTableRow}
            />
          </div>

          {/* Right Column (5 cols): Voice Recording Console */}
          <div className="lg:col-span-5 h-full">
            <VoiceRecordingPanel
              dataMode={dataMode}
              onModeChange={setDataMode}
              activeTemplate={activeTemplate}
              onChangeTemplate={() => setShowTemplateManager(true)}
              templatesCount={templates.length}
              recordingState={recorder.state}
              durationSeconds={recorder.durationSeconds}
              volumeLevel={recorder.volumeLevel}
              isProcessing={isProcessing}
              processingStatus={processingStatus}
              errorMessage={recorder.errorMessage}
              lastAudioUrl={lastAudioUrl}
              lastTranscript={lastTranscript}
              lastExtractedEntryNumber={lastExtractedEntryNumber}
              onMicPress={handleMicPress}
              onOpenManualEntry={handleAddManualEntry}
            />
          </div>
        </div>

        {/* Database History Section (Collapsible) */}
        {showSavedHistory && (
          <div className="p-5 bg-card border border-cardBorder rounded-2xl space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cardBorder/60 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-bold text-text">Saved Database Batches &amp; Records</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-surfaceMuted border border-cardBorder text-textSubtle font-mono font-bold">
                  {records.length} saved
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-textSubtle absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search saved logs..."
                    className="pl-8 pr-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                  />
                </div>

                <select
                  value={filterTemplate}
                  onChange={(e) => setFilterTemplate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                >
                  <option value="All">All Templates</option>
                  <option value="flexible">Flexible Records</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="py-12 text-center text-xs text-textSubtle">
                No past database records found matching criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredRecords.map((rec) => (
                  <div
                    key={rec.id}
                    onClick={() => setModalMode({ isOpen: true, existingRecord: rec })}
                    className="p-4 rounded-xl bg-surface border border-cardBorder hover:border-primary/50 transition cursor-pointer space-y-2 group shadow-sm"
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-cardBorder/40">
                      <h3 className="text-xs font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary transition truncate">
                        {rec.title || rec.templateName}
                      </h3>
                      <button
                        onClick={(e) => handleDeleteRecord(rec.id, e)}
                        className="p-1 text-textSubtle hover:text-danger rounded transition"
                        title="Delete record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-textSubtle">
                      <span>{formatDateDisplay(rec.date)}</span>
                      <span className="font-mono text-primary font-bold">
                        {rec.totalEntries || rec.entries?.length || 1} {(rec.totalEntries || rec.entries?.length || 1) === 1 ? 'entry' : 'entries'}
                      </span>
                    </div>

                    {rec.fieldValues && Object.keys(rec.fieldValues).length > 0 && (
                      <div className="text-[10px] text-textMuted truncate pt-1">
                        {Object.entries(rec.fieldValues)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' • ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden Printable Multi-Entry Sheet for clean printing */}
      <div className="hidden print:block">
        <PrintableEntriesReport
          entries={entries}
          settings={settings}
        />
      </div>

      {/* Template Selector Modal */}
      {showTemplateManager && (
        <TemplateManagerModal
          activeTemplateId={activeTemplate.id}
          onSelectActive={(t) => {
            setActiveTemplate(t);
            setShowTemplateManager(false);
            fetchTemplatesAndRecords();
          }}
          onClose={() => setShowTemplateManager(false)}
        />
      )}

      {/* View Past Saved Batch Modal */}
      {modalMode.isOpen && modalMode.existingRecord && (
        <BatchDataEntryViewModal
          record={modalMode.existingRecord}
          onClose={() => setModalMode({ isOpen: false })}
          onDeleted={() => {
            setModalMode({ isOpen: false });
            fetchTemplatesAndRecords();
          }}
        />
      )}
    </>
  );
}
