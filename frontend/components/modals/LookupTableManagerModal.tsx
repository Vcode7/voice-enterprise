'use client';

import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Save,
  Search,
  Table as TableIcon,
  Download,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
} from 'lucide-react';
import { LookupTable, LookupTableRow } from '@/types';
import { apiUrl } from '@/lib/api/apiClient';
import { LookupTableUploadModal } from './LookupTableUploadModal';

interface LookupTableManagerModalProps {
  table: LookupTable;
  onClose: () => void;
  onUpdated: (updated: LookupTable) => void;
  onDeleted?: (id: string) => void;
}

export function LookupTableManagerModal({
  table,
  onClose,
  onUpdated,
  onDeleted,
}: LookupTableManagerModalProps) {
  const [name, setName] = useState(table.name);
  const [description, setDescription] = useState(table.description || '');
  const [columns, setColumns] = useState<string[]>([...table.columns]);
  const [rows, setRows] = useState<LookupTableRow[]>([...table.rows]);
  const [search, setSearch] = useState('');

  // Adding new record state
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});

  // Inline editing row state
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editRowData, setEditRowData] = useState<Record<string, string>>({});

  // Adding new column state
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  const [saving, setSaving] = useState(false);
  const [showAppendModal, setShowAppendModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter rows
  const filteredRows = rows.filter((r) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return columns.some((col) => String(r[col] || '').toLowerCase().includes(query));
  });

  const handleSaveAddRow = () => {
    // Check if at least one column has a value
    const hasValue = columns.some((col) => (newRowData[col] || '').trim() !== '');
    if (!hasValue) {
      setError('Please fill in at least one column for the new record.');
      return;
    }

    const newRecord: LookupTableRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      ...newRowData,
    };

    setRows((prev) => [newRecord, ...prev]);
    setNewRowData({});
    setShowAddRow(false);
    setError(null);
  };

  const handleStartEditRow = (row: LookupTableRow) => {
    setEditingRowId(row.id);
    const initial: Record<string, string> = {};
    columns.forEach((col) => {
      initial[col] = String(row[col] || '');
    });
    setEditRowData(initial);
  };

  const handleSaveEditRow = (rowId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, ...editRowData } : r))
    );
    setEditingRowId(null);
    setEditRowData({});
  };

  const handleDeleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleAddColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    if (columns.includes(trimmed)) {
      setError(`Column "${trimmed}" already exists.`);
      return;
    }
    setColumns((prev) => [...prev, trimmed]);
    setNewColumnName('');
    setShowAddColumn(false);
    setError(null);
  };

  const handleDeleteColumn = (colName: string) => {
    if (columns.length <= 1) {
      setError('Table must have at least one column.');
      return;
    }
    if (!confirm(`Are you sure you want to delete column "${colName}" from all records?`)) return;
    setColumns((prev) => prev.filter((c) => c !== colName));
    setRows((prev) =>
      prev.map((r) => {
        const copy = { ...r };
        delete copy[colName];
        return copy;
      })
    );
  };

  const handleSaveAll = async () => {
    if (!name.trim()) {
      setError('Table name is required.');
      return;
    }
    if (columns.length === 0) {
      setError('Table must have at least one column.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload: LookupTable = {
        ...table,
        name: name.trim(),
        description: description.trim() || undefined,
        columns,
        rows,
        updatedAt: new Date().toISOString(),
      };

      const res = await fetch(apiUrl(`/api/lookup-tables/${table.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save changes.');
      }

      const updated: LookupTable = await res.json();
      setSuccessMsg('Table updated successfully!');
      setTimeout(() => setSuccessMsg(null), 3000);
      onUpdated(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTable = async () => {
    if (!confirm(`Are you sure you want to delete lookup table "${table.name}"? Templates linked to this table will lose lookup auto-fill.`)) return;

    try {
      setSaving(true);
      const res = await fetch(apiUrl(`/api/lookup-tables/${table.id}`), { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete table.');
      }
      if (onDeleted) onDeleted(table.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete table.');
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const escapeCsv = (str: string | null | undefined): string => {
      if (!str) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const csvHeaders = columns.map(escapeCsv).join(',');
    const csvRows = rows.map((r) =>
      columns.map((c) => escapeCsv(r[c])).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${name.replace(/\s+/g, '_')}_records.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-2xl max-w-5xl w-full p-4 sm:p-6 shadow-2xl space-y-4 my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center border border-primary/30">
              <TableIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-text">{table.name}</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono font-bold border border-primary/30">
                  {rows.length} {rows.length === 1 ? 'record' : 'records'}
                </span>
              </div>
              <p className="text-xs text-textMuted">
                Manage lookup records, edit columns, and maintain registered valid entries.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAppendModal(true)}
              className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              title="Upload additional Excel/CSV files to merge into this master table"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add More Mapping Data</span>
            </button>
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Download table as CSV"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Metadata Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-textSubtle uppercase tracking-wider">
              Table Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-textSubtle uppercase tracking-wider">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Master catalog of valid part numbers & machines"
              className="w-full px-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
        </div>

        {/* Table Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-textSubtle absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search table records..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddRow((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Record</span>
            </button>

            <button
              onClick={() => setShowAddColumn((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Column</span>
            </button>
          </div>
        </div>

        {/* Add Column Box */}
        {showAddColumn && (
          <div className="p-3 bg-surface border border-cardBorder rounded-xl flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              placeholder="Enter new column name (e.g. Unit Weight)..."
              className="px-3 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text flex-1 focus:outline-none focus:border-primary"
            />
            <button
              onClick={handleAddColumn}
              className="px-3 py-1.5 rounded-lg bg-primary text-white font-bold text-xs cursor-pointer"
            >
              Create Column
            </button>
            <button
              onClick={() => setShowAddColumn(false)}
              className="px-3 py-1.5 rounded-lg bg-surfaceMuted hover:bg-card border border-cardBorder text-text text-xs cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Add Record Form Box */}
        {showAddRow && (
          <div className="p-3.5 bg-surface border border-primary/30 rounded-xl space-y-2.5 shrink-0 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">
                New Record Values
              </span>
              <button
                onClick={() => setShowAddRow(false)}
                className="text-textSubtle hover:text-text text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {columns.map((col) => (
                <div key={col} className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-textSubtle truncate block">
                    {col}
                  </label>
                  <input
                    type="text"
                    value={newRowData[col] || ''}
                    onChange={(e) =>
                      setNewRowData((prev) => ({ ...prev, [col]: e.target.value }))
                    }
                    placeholder={`Enter ${col}...`}
                    className="w-full px-2.5 py-1 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSaveAddRow}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primaryDark text-white text-xs font-bold transition cursor-pointer"
              >
                Insert Record
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Records Table */}
        <div className="flex-1 overflow-x-auto overflow-y-auto rounded-xl border border-cardBorder bg-background">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-surfaceMuted border-b border-cardBorder text-textSubtle sticky top-0 z-10 font-bold uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2 w-12 text-center">#</th>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center justify-between gap-2 group">
                      <span>{col}</span>
                      <button
                        onClick={() => handleDeleteColumn(col)}
                        title={`Delete column ${col}`}
                        className="opacity-0 group-hover:opacity-100 text-textSubtle hover:text-danger p-0.5 rounded transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cardBorder/40">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="py-12 text-center text-textSubtle">
                    {search ? 'No records match your search query.' : 'No records yet in this table. Click "+ Add Record" above.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const isEditing = editingRowId === row.id;

                  return (
                    <tr key={row.id} className="hover:bg-surfaceMuted/50 transition">
                      <td className="px-3 py-2 text-textSubtle font-mono text-[11px] text-center">
                        {idx + 1}
                      </td>

                      {columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 text-text whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editRowData[col] || ''}
                              onChange={(e) =>
                                setEditRowData((prev) => ({ ...prev, [col]: e.target.value }))
                              }
                              className="w-full px-2 py-1 rounded bg-background border border-primary/40 text-xs text-text focus:outline-none"
                            />
                          ) : (
                            <span className="font-medium">{row[col] || '-'}</span>
                          )}
                        </td>
                      ))}

                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end space-x-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEditRow(row.id)}
                                className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition cursor-pointer"
                                title="Save record"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingRowId(null)}
                                className="p-1 rounded bg-surfaceMuted hover:bg-card border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEditRow(row)}
                                className="p-1 rounded bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                                title="Edit record"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteRow(row.id)}
                                className="p-1 rounded bg-surface hover:bg-danger/20 hover:text-danger border border-cardBorder text-textSubtle transition cursor-pointer"
                                title="Delete record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-cardBorder/60 shrink-0">
          <button
            onClick={handleDeleteTable}
            className="text-xs text-danger/80 hover:text-danger font-semibold flex items-center gap-1 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Table</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-primary/20 transition cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save All Changes'}</span>
            </button>
          </div>
        </div>
      </div>

      {showAppendModal && (
        <LookupTableUploadModal
          mode="append"
          existingTable={{
            ...table,
            name,
            description,
            columns,
            rows,
          }}
          onClose={() => setShowAppendModal(false)}
          onUploaded={(mergedTable) => {
            setName(mergedTable.name);
            setDescription(mergedTable.description || '');
            setColumns(mergedTable.columns);
            setRows(mergedTable.rows);
            setShowAppendModal(false);
            setSuccessMsg(`Successfully merged new mapping data! Table now has ${mergedTable.rows.length} records.`);
            onUpdated(mergedTable);
          }}
        />
      )}
    </div>
  );
}
