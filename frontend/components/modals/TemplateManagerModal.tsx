'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Layers, Copy, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import { DataTemplate } from '@/types';
import { DEFAULT_MONITORING_DETAILS_TEMPLATE } from '@/lib/constants';
import { TemplateEditModal } from './TemplateEditModal';
import { apiUrl } from '@/lib/api/apiClient';

interface TemplateManagerModalProps {
  activeTemplateId: string;
  onSelectActive: (template: DataTemplate) => void;
  onClose: () => void;
}

export function TemplateManagerModal({
  activeTemplateId,
  onSelectActive,
  onClose,
}: TemplateManagerModalProps) {
  const [templates, setTemplates] = useState<DataTemplate[]>([DEFAULT_MONITORING_DETAILS_TEMPLATE]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<DataTemplate | null | undefined>(undefined);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await fetch(apiUrl('/api/templates'));
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setTemplates(data);
      } else {
        setTemplates([DEFAULT_MONITORING_DETAILS_TEMPLATE]);
      }
    } catch (e) {
      console.error('Failed to load templates:', e);
      setTemplates([DEFAULT_MONITORING_DETAILS_TEMPLATE]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDuplicate = async (tmpl: DataTemplate) => {
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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    await fetch(apiUrl(`/api/templates/${id}`), { method: 'DELETE' });
    fetchTemplates();
  };

  const handleResetDefaults = async () => {
    if (!confirm('Reset templates back to system default Monitoring Details template?')) return;
    await fetch(apiUrl('/api/templates/reset'), { method: 'POST' });
    fetchTemplates();
  };

  const safeTemplates = Array.isArray(templates) && templates.length > 0
    ? templates
    : [DEFAULT_MONITORING_DETAILS_TEMPLATE];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
        <div className="bg-card border border-cardBorder rounded-t-2xl sm:rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-4 sm:p-6 border-b border-cardBorder flex items-center justify-between bg-surface">
            <div>
              <h2 className="text-base sm:text-xl font-bold text-text flex items-center gap-2">
                <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                Templates Manager
              </h2>
              <p className="text-[11px] sm:text-xs text-textMuted mt-0.5">
                Select active template for voice ERP dictation.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 sm:p-2 rounded-xl text-textMuted hover:text-text hover:bg-surfaceMuted transition cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* List */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-3 sm:space-y-4 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-bold text-text uppercase tracking-wider">
                Templates ({safeTemplates.length})
              </span>
              <button
                onClick={() => setEditingTemplate(null)}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-primary/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs text-textMuted">Loading templates...</div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:gap-3.5">
                {safeTemplates.map((tmpl) => {
                  const isActive = tmpl.id === activeTemplateId;

                  return (
                    <div
                      key={tmpl.id}
                      className={`p-3.5 sm:p-4 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-primary/10 border-primary/50 shadow-md shadow-primary/10'
                          : 'bg-surface border-cardBorder hover:border-slate-400 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <h4 className="text-sm font-bold text-text">{tmpl.name}</h4>
                          {tmpl.isDefault && (
                            <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-surfaceMuted text-textMuted border border-cardBorder">
                              Default
                            </span>
                          )}
                          {isActive && (
                            <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Active
                            </span>
                          )}
                        </div>
                        {tmpl.description && <p className="text-xs text-textSubtle">{tmpl.description}</p>}
                        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-textMuted pt-0.5">
                          <span>{tmpl.fields?.length || 0} fields</span>
                          <span>•</span>
                          <span>{tmpl.hasTable ? `${tmpl.tableFields?.length || 0} table cols` : 'No table'}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 self-end sm:self-center">
                        {!isActive && (
                          <button
                            onClick={() => onSelectActive(tmpl)}
                            className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-primary hover:text-white border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
                          >
                            Set Active
                          </button>
                        )}
                        <button
                          onClick={() => handleDuplicate(tmpl)}
                          title="Duplicate template"
                          className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingTemplate(tmpl)}
                          className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
                        >
                          Edit
                        </button>
                        {!tmpl.isDefault && (
                          <button
                            onClick={() => handleDelete(tmpl.id)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-danger/20 hover:text-danger border border-cardBorder text-textSubtle transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3.5 sm:p-5 border-t border-cardBorder bg-surface flex items-center justify-between">
            <button
              onClick={handleResetDefaults}
              className="text-[11px] sm:text-xs text-textSubtle hover:text-text flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-1.5 sm:py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>

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
    </>
  );
}
