'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Trash2,
  Edit2,
  FileSpreadsheet,
  Printer,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import { DataEntryRecord, DataTemplate, UserSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/lib/constants';
import { formatDateDisplay, getTodayString, getYesterdayString, isThisWeek } from '@/lib/utils/dateUtils';
import { exportEntriesToExcel } from '@/lib/utils/excelExporter';
import { BatchDataEntryViewModal } from '@/components/modals/BatchDataEntryViewModal';
import { apiUrl } from '@/lib/api/apiClient';

export default function HistoryPage() {
  const [entries, setEntries] = useState<DataEntryRecord[]>([]);
  const [templates, setTemplates] = useState<DataTemplate[]>([]);
  const [selectedTemplateFilter, setSelectedTemplateFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [editingEntry, setEditingEntry] = useState<DataEntryRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const [entryRes, tmplRes, setRes] = await Promise.allSettled([
        fetch(apiUrl('/api/data-entries')),
        fetch(apiUrl('/api/templates')),
        fetch(apiUrl('/api/settings')),
      ]);

      if (entryRes.status === 'fulfilled' && entryRes.value.ok) {
        try {
          const entrs = await entryRes.value.json();
          if (Array.isArray(entrs)) setEntries(entrs);
        } catch (err) {
          console.warn('Could not parse entries:', err);
        }
      }

      if (tmplRes.status === 'fulfilled' && tmplRes.value.ok) {
        try {
          const tmpls = await tmplRes.value.json();
          if (Array.isArray(tmpls)) setTemplates(tmpls);
        } catch (err) {
          console.warn('Could not parse templates:', err);
        }
      }

      if (setRes.status === 'fulfilled' && setRes.value.ok) {
        try {
          const sets = await setRes.value.json();
          if (sets && !sets.error) setSettings(sets);
        } catch (err) {
          console.warn('Could not parse settings:', err);
        }
      }
    } catch (e) {
      console.warn('Notice: Backend history sync paused:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleDeleteEntry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this data entry record?')) return;
    await fetch(apiUrl(`/api/data-entries/${id}`), { method: 'DELETE' });
    fetchHistory();
  };

  // Filter data entries
  const filteredEntries = entries.filter((e) => {
    if (selectedTemplateFilter === 'flexible') {
      if (!e.isFlexible && e.templateId !== 'flexible' && !e.flexibleFields) return false;
    } else if (selectedTemplateFilter !== 'All') {
      const matches = e.templateId === selectedTemplateFilter || e.templateName === selectedTemplateFilter;
      if (!matches) return false;
    }

    if (!search.trim()) return true;

    const query = search.toLowerCase();
    const matchesName = (e.title || e.templateName || '').toLowerCase().includes(query);
    const matchesTranscript = (e.rawTranscript || '').toLowerCase().includes(query);
    const matchesDate = e.date.toLowerCase().includes(query);
    const matchesFieldValues = Object.values(e.fieldValues || {}).some((v) =>
      String(v).toLowerCase().includes(query)
    );
    const matchesFlexFields = (e.flexibleFields || []).some(
      (f) => f.name.toLowerCase().includes(query) || String(f.value).toLowerCase().includes(query)
    );

    return matchesName || matchesTranscript || matchesDate || matchesFieldValues || matchesFlexFields;
  });

  // Date groups
  const today = getTodayString();
  const yesterday = getYesterdayString();

  const entryGroups = [
    { title: 'Today', items: filteredEntries.filter((e) => e.date === today) },
    { title: 'Yesterday', items: filteredEntries.filter((e) => e.date === yesterday) },
    { title: 'This Week', items: filteredEntries.filter((e) => e.date !== today && e.date !== yesterday && isThisWeek(e.date)) },
    { title: 'Earlier', items: filteredEntries.filter((e) => e.date !== today && e.date !== yesterday && !isThisWeek(e.date)) },
  ].filter((g) => g.items.length > 0);

  const handleExportAllExcel = () => {
    if (filteredEntries.length === 0) {
      alert('No entries to export.');
      return;
    }

    const allSessionEntries: any[] = [];
    filteredEntries.forEach((rec) => {
      if (rec.entries && rec.entries.length > 0) {
        rec.entries.forEach((se) => allSessionEntries.push(se));
      } else {
        allSessionEntries.push({
          entryNumber: allSessionEntries.length + 1,
          mode: rec.isFlexible ? 'flexible' : 'template',
          templateName: rec.templateName,
          title: rec.title,
          fieldValues: rec.fieldValues,
          flexibleFields: rec.flexibleFields,
          tableTitle: rec.tableTitle,
          tableHeaders: rec.tableHeaders,
          tableRows: rec.tableRows,
          tables: rec.tables,
          rawTranscript: rec.rawTranscript,
          createdAt: rec.createdAt,
        });
      }
    });

    exportEntriesToExcel(allSessionEntries, 'Voice_ERP_History_Report');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            <span>Voice Data Entry History</span>
          </h1>
          <p className="text-xs text-textMuted mt-0.5">
            Search, filter, and review your past recorded batches and entries.
          </p>
        </div>

        <button
          onClick={handleExportAllExcel}
          disabled={filteredEntries.length === 0}
          className="px-4 py-2 sm:py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1.5 transition cursor-pointer self-stretch sm:self-auto disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Export Filtered to Excel</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border border-cardBorder rounded-2xl p-4 shadow-md flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-textSubtle absolute left-3.5 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by part no, machine, description, or transcript..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-cardBorder rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedTemplateFilter}
            onChange={(e) => setSelectedTemplateFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-cardBorder rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium w-full sm:w-auto"
          >
            <option value="All">All Templates</option>
            <option value="flexible">Flexible Voice Records</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Entries List by Date Groups */}
      {loading ? (
        <div className="py-20 text-center text-xs text-textMuted">Loading past history...</div>
      ) : filteredEntries.length === 0 ? (
        <div className="py-16 text-center text-xs text-textMuted bg-card rounded-2xl border border-dashed border-cardBorder p-8 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-primary mx-auto opacity-50" />
          <p className="font-bold text-text text-sm">No data entry records found</p>
          <p className="text-textSubtle">
            {search ? 'Try adjusting your search filters.' : 'Dictate your first entries on the Voice Data Entry home page.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {entryGroups.map((group) => (
            <div key={group.title} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  {group.title}
                </span>
                <span className="text-[11px] text-textSubtle">
                  ({group.items.length} {group.items.length === 1 ? 'batch' : 'batches'})
                </span>
              </div>

              <div className="space-y-2.5">
                {group.items.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => setEditingEntry(entry)}
                    className="p-4 rounded-xl bg-card border border-cardBorder hover:border-primary/50 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group shadow-sm"
                  >
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition border border-primary/30">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold text-text group-hover:text-primary transition">
                            {entry.title || entry.templateName}
                          </h3>
                          <span className="text-[10px] px-2 py-0.2 rounded-full bg-surfaceMuted text-primary font-mono font-bold border border-cardBorder">
                            {entry.totalEntries || entry.entries?.length || 1}{' '}
                            {(entry.totalEntries || entry.entries?.length || 1) === 1 ? 'entry' : 'entries'}
                          </span>
                        </div>

                        {entry.fieldValues && Object.keys(entry.fieldValues).length > 0 && (
                          <p className="text-[11px] text-textMuted mt-0.5 truncate max-w-lg">
                            {Object.entries(entry.fieldValues)
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' • ')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-bold text-text">{formatDateDisplay(entry.date)}</div>
                        <div className="text-[10px] text-textSubtle">
                          {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      <div className="flex items-center space-x-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingEntry(entry);
                          }}
                          className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                          title="View batch entries"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteEntry(entry.id, e)}
                          className="p-1.5 rounded-lg bg-surface hover:bg-danger/20 hover:text-danger border border-cardBorder text-textSubtle transition cursor-pointer"
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Batch Data Entry Modal */}
      {editingEntry && (
        <BatchDataEntryViewModal
          record={editingEntry}
          onClose={() => setEditingEntry(null)}
          onDeleted={() => {
            setEditingEntry(null);
            fetchHistory();
          }}
        />
      )}
    </div>
  );
}
