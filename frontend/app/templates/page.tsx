'use client';

import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Copy,
  Trash2,
  Edit2,
  RotateCcw,
  Database,
  Upload,
  Table as TableIcon,
  Search,
  Sparkles,
  Link as LinkIcon,
} from 'lucide-react';
import { DataTemplate, LookupTable } from '@/types';
import { TemplateEditModal } from '@/components/modals/TemplateEditModal';
import { LookupTableManagerModal } from '@/components/modals/LookupTableManagerModal';
import { LookupTableUploadModal } from '@/components/modals/LookupTableUploadModal';
import { apiUrl } from '@/lib/api/apiClient';

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<'templates' | 'lookup_tables'>('templates');

  // Templates state
  const [templates, setTemplates] = useState<DataTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<DataTemplate | null | undefined>(undefined);

  // Lookup Tables state
  const [lookupTables, setLookupTables] = useState<LookupTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedLookupTable, setSelectedLookupTable] = useState<LookupTable | null>(null);
  const [showUploadTableModal, setShowUploadTableModal] = useState(false);
  const [tableSearch, setTableSearch] = useState('');

  const fetchTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const res = await fetch(apiUrl('/api/templates'));
      const data = await res.json();
      if (Array.isArray(data)) setTemplates(data);
    } catch (e) {
      console.error('Failed to load templates:', e);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchLookupTables = async () => {
    try {
      setLoadingTables(true);
      const res = await fetch(apiUrl('/api/lookup-tables'));
      const data = await res.json();
      if (Array.isArray(data)) setLookupTables(data);
    } catch (e) {
      console.error('Failed to load lookup tables:', e);
    } finally {
      setLoadingTables(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchLookupTables();
  }, []);

  const handleDuplicateTemplate = async (tmpl: DataTemplate) => {
    const clone: DataTemplate = {
      ...tmpl,
      id: `template_custom_${Date.now()}`,
      name: `${tmpl.name} (Copy)`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await fetch(apiUrl('/api/templates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clone),
    });

    fetchTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    await fetch(apiUrl(`/api/templates/${id}`), { method: 'DELETE' });
    fetchTemplates();
  };

  const handleResetTemplateDefaults = async () => {
    if (!confirm('Reset templates back to system default templates?')) return;
    await fetch(apiUrl('/api/templates/reset'), { method: 'POST' });
    fetchTemplates();
  };

  const handleResetLookupDefaults = async () => {
    if (!confirm('Reset master lookup tables back to system default catalog?')) return;
    await fetch(apiUrl('/api/lookup-tables/reset'), { method: 'POST' });
    fetchLookupTables();
  };

  const filteredLookupTables = lookupTables.filter((tbl) => {
    if (!tableSearch.trim()) return true;
    const q = tableSearch.toLowerCase();
    return (
      tbl.name.toLowerCase().includes(q) ||
      (tbl.description || '').toLowerCase().includes(q) ||
      tbl.columns.some((c) => c.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2.5">
            <Layers className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            <span>Templates &amp; Master Tables</span>
          </h1>
          <p className="text-xs text-textMuted mt-0.5">
            Manage custom voice templates, upload master tables for auto-fill, and configure strict validation.
          </p>
        </div>

        {/* Tab-specific top action button */}
        {activeTab === 'templates' ? (
          <button
            onClick={() => setEditingTemplate(null)}
            className="px-4 py-2 sm:py-2.5 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-1.5 transition cursor-pointer self-stretch sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Create New Template
          </button>
        ) : (
          <button
            onClick={() => setShowUploadTableModal(true)}
            className="px-4 py-2 sm:py-2.5 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-extrabold shadow-lg shadow-primary/20 flex items-center justify-center gap-1.5 transition cursor-pointer self-stretch sm:self-auto"
          >
            <Upload className="w-4 h-4" />
            Upload Master Table (CSV/Excel)
          </button>
        )}
      </div>

      {/* Main Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-cardBorder pb-2">
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'templates'
              ? 'bg-primary text-white shadow-md shadow-primary/25'
              : 'bg-card text-textMuted hover:text-text border border-cardBorder'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>ERP Data Templates ({templates.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('lookup_tables')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'lookup_tables'
              ? 'bg-primary text-white shadow-md font-extrabold'
              : 'bg-card text-textMuted hover:text-text border border-cardBorder'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Master Lookup Tables ({lookupTables.length})</span>
        </button>
      </div>

      {/* TAB 1: ERP Data Templates */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder hover:border-slate-600 transition space-y-3 sm:space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between pb-2.5 border-b border-cardBorder/60">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-text flex items-center gap-1.5 flex-wrap">
                      {tmpl.name}
                      {tmpl.isDefault && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-surfaceMuted text-textMuted border border-cardBorder">
                          Default
                        </span>
                      )}
                      {tmpl.lookupConfig?.enabled && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>Table Lookup Active</span>
                        </span>
                      )}
                    </h3>
                    {tmpl.description && <p className="text-xs text-textSubtle mt-0.5">{tmpl.description}</p>}
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => handleDuplicateTemplate(tmpl)}
                      title="Duplicate"
                      className="p-1 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingTemplate(tmpl)}
                      title="Edit Template"
                      className="p-1 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {!tmpl.isDefault && (
                      <button
                        onClick={() => handleDeleteTemplate(tmpl.id)}
                        title="Delete Template"
                        className="p-1 rounded-lg bg-surface hover:bg-danger/20 hover:text-danger border border-cardBorder text-textSubtle transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Table Lookup badge if active */}
                {tmpl.lookupConfig?.enabled && (
                  <div className="p-2.5 rounded-xl bg-surfaceMuted border border-primary/30 text-xs text-primary flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate">
                        Main: <strong>{tmpl.lookupConfig.mainTableColumn}</strong> → Auto-fills{' '}
                        {tmpl.lookupConfig.fieldMappings?.length || 0} fields from <em>"{tmpl.lookupConfig.tableName || 'Master Table'}"</em>
                      </span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono font-bold shrink-0">
                      Strict
                    </span>
                  </div>
                )}

                {/* Field breakdown */}
                <div className="space-y-1.5">
                  <div className="text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                    Top Fields ({tmpl.fields.length}):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tmpl.fields.map((f) => {
                      const isMainLookup = tmpl.lookupConfig?.enabled && tmpl.lookupConfig.mainFieldKey === f.extractionKey;
                      const isAutoFilled = tmpl.lookupConfig?.enabled && tmpl.lookupConfig.fieldMappings?.some((m) => m.fieldKey === f.extractionKey);

                      return (
                        <span
                          key={f.id}
                          className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium flex items-center gap-1 ${
                            isMainLookup
                              ? 'bg-surfaceMuted dark:bg-surfaceMuted border-cardBorder dark:border-primary/40 text-primary dark:text-primary font-bold'
                              : isAutoFilled
                              ? 'bg-surfaceMuted dark:bg-slate-900 border-cardBorder dark:border-primary/30 text-primary dark:text-primary'
                              : 'bg-surface border-cardBorder text-textMuted'
                          }`}
                        >
                          {f.name}
                          {isMainLookup && <span className="text-[9px] text-primary font-mono">[MAIN]</span>}
                          {isAutoFilled && <span className="text-[9px] text-primary dark:text-primary font-mono">[AUTO]</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {tmpl.hasTable && (
                  <div className="space-y-1.5 pt-2 border-t border-cardBorder/60">
                    <div className="text-[10px] sm:text-[11px] font-semibold uppercase text-dataColor">
                      {tmpl.tableTitle || 'Table'} Columns ({tmpl.tableFields?.length || 0}):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(tmpl.tableFields || []).map((col) => (
                        <span
                          key={col.id}
                          className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-cardBorder text-primary font-medium"
                        >
                          {col.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer Reset Defaults */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-card border border-cardBorder flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs text-textMuted">
              Restore default production templates?
            </span>
            <button
              onClick={handleResetTemplateDefaults}
              className="text-xs text-textSubtle hover:text-text font-semibold flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Template Defaults</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: Master Lookup Tables Manager */}
      {activeTab === 'lookup_tables' && (
        <div className="space-y-4">
          {/* Table Search & Upload Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-textSubtle absolute left-3 top-2.5" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search master tables by name, description, or column..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-card border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>

            <button
              onClick={() => setShowUploadTableModal(true)}
              className="px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload CSV / Excel Table</span>
            </button>
          </div>

          {/* Lookup Tables Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredLookupTables.length === 0 ? (
              <div className="col-span-2 py-16 text-center text-xs text-textMuted bg-card rounded-2xl border border-dashed border-cardBorder p-6 space-y-2">
                <Database className="w-8 h-8 text-primary mx-auto opacity-60" />
                <p className="font-bold text-text text-sm">No master lookup tables found</p>
                <p className="text-textSubtle">
                  Upload a CSV or Excel table with Part No, Machine Name, Description to enable voice auto-filling.
                </p>
              </div>
            ) : (
              filteredLookupTables.map((tbl) => (
                <div
                  key={tbl.id}
                  onClick={() => setSelectedLookupTable(tbl)}
                  className="p-5 rounded-2xl bg-card border border-cardBorder hover:border-primary/50 transition space-y-3.5 shadow-sm cursor-pointer group"
                >
                  <div className="flex items-center justify-between pb-2.5 border-b border-cardBorder/60">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center border border-primary/30 group-hover:scale-105 transition">
                        <TableIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-text group-hover:text-primary transition">
                          {tbl.name}
                        </h3>
                        {tbl.description && (
                          <p className="text-xs text-textSubtle mt-0.5">{tbl.description}</p>
                        )}
                      </div>
                    </div>

                    <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary font-mono font-bold border border-primary/30">
                      {tbl.rows?.length || 0} records
                    </span>
                  </div>

                  {/* Columns List */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase text-textSubtle">
                      Columns ({tbl.columns?.length || 0}):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(tbl.columns || []).map((col) => (
                        <span
                          key={col}
                          className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-cardBorder text-textMuted font-medium"
                        >
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Preview Samples */}
                  {tbl.rows && tbl.rows.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-cardBorder/60">
                      <div className="text-[10px] uppercase font-bold text-textSubtle">
                        Sample Records:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {tbl.rows.slice(0, 4).map((r, rIdx) => {
                          const firstCol = tbl.columns[0];
                          return (
                            <span
                              key={r.id || rIdx}
                              className="text-[10px] px-2 py-0.5 rounded bg-surface text-primary font-mono border border-cardBorder"
                            >
                              {r[firstCol]}
                            </span>
                          );
                        })}
                        {tbl.rows.length > 4 && (
                          <span className="text-[10px] text-textSubtle self-center">
                            +{tbl.rows.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action Link */}
                  <div className="flex items-center justify-between pt-1 text-xs text-primary font-semibold group-hover:underline">
                    <span>Manage &amp; Edit Records →</span>
                    <span className="text-[10px] text-textSubtle font-normal">
                      Updated {new Date(tbl.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer Reset Defaults for Master Tables */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-card border border-cardBorder flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs text-textMuted">
              Restore default master parts catalog table?
            </span>
            <button
              onClick={handleResetLookupDefaults}
              className="text-xs text-textSubtle hover:text-text font-semibold flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Master Tables</span>
            </button>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {editingTemplate !== undefined && (
        <TemplateEditModal
          template={editingTemplate}
          onClose={() => setEditingTemplate(undefined)}
          onSaved={() => {
            setEditingTemplate(undefined);
            fetchTemplates();
          }}
        />
      )}

      {/* Manage Lookup Table Records Modal */}
      {selectedLookupTable && (
        <LookupTableManagerModal
          table={selectedLookupTable}
          onClose={() => setSelectedLookupTable(null)}
          onUpdated={(updated) => {
            setSelectedLookupTable(updated);
            fetchLookupTables();
          }}
          onDeleted={(id) => {
            setSelectedLookupTable(null);
            fetchLookupTables();
          }}
        />
      )}

      {/* Upload Lookup Table Modal */}
      {showUploadTableModal && (
        <LookupTableUploadModal
          onClose={() => setShowUploadTableModal(false)}
          onUploaded={(newTable) => {
            setShowUploadTableModal(false);
            fetchLookupTables();
          }}
        />
      )}
    </div>
  );
}
