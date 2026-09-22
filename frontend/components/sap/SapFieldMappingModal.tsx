'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Save,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
  ArrowRight,
  Database,
  Plus,
  Trash2,
} from 'lucide-react';
import { DataTemplate } from '@/types';
import {
  SapMetadata,
  SapEntitySet,
  SapField,
  SapFieldMapping,
  SapFieldMappingRule,
  SapFieldTransform,
} from '@/types/sap';
import { SmartMapper } from '@/lib/sap/smartMapper';

interface SapFieldMappingModalProps {
  metadata: SapMetadata;
  templates: DataTemplate[];
  initialTemplateId?: string;
  initialEntitySetName?: string;
  onClose: () => void;
  onSaved?: (mapping: SapFieldMapping) => void;
}

export function SapFieldMappingModal({
  metadata,
  templates,
  initialTemplateId,
  initialEntitySetName,
  onClose,
  onSaved,
}: SapFieldMappingModalProps) {
  // Selectors
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialTemplateId || (templates.length > 0 ? templates[0].id : '')
  );
  const [selectedEntitySetName, setSelectedEntitySetName] = useState<string>(
    initialEntitySetName || (metadata.entitySets.length > 0 ? metadata.entitySets[0].name : '')
  );

  // Mappings state
  const [mappingRules, setMappingRules] = useState<SapFieldMappingRule[]>([]);
  const [staticValues, setStaticValues] = useState<Record<string, string>>({});
  const [newStaticKey, setNewStaticKey] = useState('');
  const [newStaticVal, setNewStaticVal] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [existingMappingFound, setExistingMappingFound] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active template and active entity set
  const currentTemplate = templates.find((t) => t.id === selectedTemplateId);
  const currentEntitySet = metadata.entitySets.find((es) => es.name === selectedEntitySetName);

  // Load existing mapping or generate suggestions when template or entity set changes
  useEffect(() => {
    if (!selectedTemplateId || !selectedEntitySetName) return;

    let isMounted = true;
    setLoading(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    const loadMapping = async () => {
      try {
        const res = await fetch(
          `/api/sap/mappings?templateId=${encodeURIComponent(selectedTemplateId)}&entitySet=${encodeURIComponent(
            selectedEntitySetName
          )}`
        );
        const data = await res.json();

        if (!isMounted) return;

        if (data && data.mappings && data.mappings.length > 0) {
          setMappingRules(data.mappings);
          setStaticValues(data.staticValues || {});
          setExistingMappingFound(true);
        } else {
          setExistingMappingFound(false);
          // Automatically run smart suggestion
          generateSuggestions();
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage('Failed to load saved mapping.');
          generateSuggestions();
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadMapping();

    return () => {
      isMounted = false;
    };
  }, [selectedTemplateId, selectedEntitySetName]);

  const generateSuggestions = () => {
    if (!currentTemplate || !currentEntitySet) return;

    // Combine standard template fields and table fields
    const allVoiceFields = [
      ...currentTemplate.fields,
      ...(currentTemplate.tableFields || []).map((tf) => ({
        ...tf,
        extractionKey: `table.${tf.extractionKey}`,
        name: `[Table] ${tf.name}`,
      })),
    ];

    const suggested = SmartMapper.suggestMappings(allVoiceFields, currentEntitySet.fields);
    setMappingRules(suggested);
  };

  const handleFieldChange = (index: number, sapFieldName: string) => {
    const updated = [...mappingRules];
    const rule = updated[index];

    if (!sapFieldName) {
      rule.sapFieldName = '';
      rule.sapFieldType = '';
      rule.isKey = false;
      rule.isRequired = false;
    } else {
      const sapField = currentEntitySet?.fields.find((f) => f.name === sapFieldName);
      rule.sapFieldName = sapFieldName;
      rule.sapFieldType = sapField?.type || 'Edm.String';
      rule.isKey = sapField?.isKey || false;
      rule.isRequired = !sapField?.nullable;

      // Set default transform
      if (rule.sapFieldType.includes('DateTime')) {
        rule.transformation = 'date_iso';
      } else if (rule.sapFieldType.includes('Decimal') || rule.sapFieldType.includes('Int')) {
        rule.transformation = 'number';
      }
    }

    setMappingRules(updated);
  };

  const handleTransformChange = (index: number, transform: SapFieldTransform) => {
    const updated = [...mappingRules];
    updated[index].transformation = transform;
    setMappingRules(updated);
  };

  const handleAddStaticValue = () => {
    if (!newStaticKey.trim() || !newStaticVal.trim()) return;
    setStaticValues({
      ...staticValues,
      [newStaticKey.trim()]: newStaticVal.trim(),
    });
    setNewStaticKey('');
    setNewStaticVal('');
  };

  const handleRemoveStaticValue = (key: string) => {
    const updated = { ...staticValues };
    delete updated[key];
    setStaticValues(updated);
  };

  // Required SAP fields check
  const missingRequiredSapFields = currentEntitySet
    ? currentEntitySet.fields.filter(
        (sf) =>
          !sf.nullable &&
          !sf.isKey &&
          !mappingRules.some((r) => r.sapFieldName === sf.name) &&
          !staticValues[sf.name]
      )
    : [];

  const handleSave = async (forceOverwrite: boolean = false) => {
    if (existingMappingFound && !forceOverwrite && !showOverwriteConfirm) {
      setShowOverwriteConfirm(true);
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    const payload: SapFieldMapping = {
      id: '',
      templateId: selectedTemplateId,
      templateName: currentTemplate?.name || 'Voice Template',
      entitySetName: selectedEntitySetName,
      mappings: mappingRules,
      staticValues,
      updatedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/sap/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save mapping');
      }

      const saved = await res.json();
      setSaveSuccess(true);
      setShowOverwriteConfirm(false);
      setExistingMappingFound(true);
      if (onSaved) onSaved(saved);

      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving mapping.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-card border border-cardBorder rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-cardBorder flex items-center justify-between bg-surface/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary flex items-center justify-center border border-primary/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-text flex items-center gap-2">
                Configure SAP Field Mapping
              </h2>
              <p className="text-xs text-textMuted">
                Map Voice Entry Template fields to SAP OData Entity Set properties.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface text-textSubtle hover:text-text transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* Selectors Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-surface/70 border border-cardBorder">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-primary" />
                1. Voice Entry Template
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.fields.length} fields)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-secondary" />
                2. Target SAP Entity Set
              </label>
              <select
                value={selectedEntitySetName}
                onChange={(e) => setSelectedEntitySetName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-secondary font-medium font-mono"
              >
                {metadata.entitySets.map((es) => (
                  <option key={es.name} value={es.name}>
                    {es.name} ({es.fields.length} properties)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Alert: Missing Required SAP Fields */}
          {missingRequiredSapFields.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Required SAP Properties Not Yet Mapped:</p>
                <p className="text-[11px] mt-0.5 text-textMuted">
                  The following mandatory SAP fields require a mapping or a static constant value:{' '}
                  <span className="font-mono font-semibold text-text">
                    {missingRequiredSapFields.map((f) => f.name).join(', ')}
                  </span>
                  .
                </p>
              </div>
            </div>
          )}

          {/* Overwrite Confirmation Alert */}
          {showOverwriteConfirm && (
            <div className="p-4 rounded-xl bg-primary/15 border border-primary/40 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-text">
                <AlertCircle className="w-4 h-4 text-primary" />
                <span>Existing Mapping Found</span>
              </div>
              <p className="text-textMuted">
                A saved field mapping already exists for{' '}
                <strong className="text-text">{currentTemplate?.name}</strong> →{' '}
                <strong className="text-text font-mono">{selectedEntitySetName}</strong>. Do you want to overwrite it?
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primaryDark text-white text-xs font-bold transition cursor-pointer"
                >
                  Yes, Overwrite Mapping
                </button>
                <button
                  type="button"
                  onClick={() => setShowOverwriteConfirm(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={generateSuggestions}
                className="px-3.5 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-Suggest Mappings
              </button>
              {existingMappingFound && (
                <span className="text-[11px] font-semibold text-textSubtle px-2 py-1 rounded-md bg-surface border border-cardBorder">
                  Active Saved Mapping
                </span>
              )}
            </div>

            <span className="text-[11px] text-textMuted">
              {mappingRules.filter((r) => r.sapFieldName).length} of {mappingRules.length} Voice fields mapped
            </span>
          </div>

          {/* Mappings Table */}
          <div className="border border-cardBorder rounded-xl overflow-hidden bg-surface/30">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-surface border-b border-cardBorder text-[10px] uppercase font-bold text-textSubtle">
                    <th className="py-2.5 px-3">Voice Entry Field</th>
                    <th className="py-2.5 px-2 text-center"></th>
                    <th className="py-2.5 px-3">SAP OData Property</th>
                    <th className="py-2.5 px-3">Data Transform</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cardBorder/60">
                  {mappingRules.map((rule, idx) => {
                    const validation = SmartMapper.validateCompatibility(rule.templateFieldType, rule.sapFieldType);

                    return (
                      <tr key={`${rule.templateFieldKey}-${idx}`} className="hover:bg-surface/50 transition">
                        {/* Voice Field */}
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-text">{rule.templateFieldName}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[10px] text-textSubtle">{rule.templateFieldKey}</span>
                            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-surface border border-cardBorder text-textMuted">
                              {rule.templateFieldType}
                            </span>
                          </div>
                        </td>

                        {/* Arrow */}
                        <td className="py-2.5 px-2 text-center text-textSubtle">
                          <ArrowRight className="w-3.5 h-3.5 inline text-primary/70" />
                        </td>

                        {/* SAP Property Dropdown */}
                        <td className="py-2.5 px-3">
                          <select
                            value={rule.sapFieldName || ''}
                            onChange={(e) => handleFieldChange(idx, e.target.value)}
                            className="w-full max-w-xs px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                          >
                            <option value="">-- None / Skip Field --</option>
                            {currentEntitySet?.fields.map((sf) => (
                              <option key={sf.name} value={sf.name}>
                                {sf.name} ({sf.type.replace('Edm.', '')}){!sf.nullable ? ' *' : ''}
                                {sf.isKey ? ' [KEY]' : ''}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Transformation */}
                        <td className="py-2.5 px-3">
                          <select
                            value={rule.transformation || 'none'}
                            onChange={(e) => handleTransformChange(idx, e.target.value as SapFieldTransform)}
                            disabled={!rule.sapFieldName}
                            className="px-2 py-1 rounded-lg bg-background border border-cardBorder text-[11px] text-text focus:outline-none focus:border-primary disabled:opacity-50"
                          >
                            <option value="none">Direct / None</option>
                            <option value="trim">Trim Whitespace</option>
                            <option value="uppercase">Uppercase</option>
                            <option value="lowercase">Lowercase</option>
                            <option value="number">To Number</option>
                            <option value="date_iso">Date (ISO 8601)</option>
                            <option value="date_sap">Date (/Date(...)/)</option>
                            <option value="boolean">To Boolean</option>
                          </select>
                        </td>

                        {/* Status Badge */}
                        <td className="py-2.5 px-3">
                          {validation.status === 'compatible' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Valid
                            </span>
                          )}
                          {validation.status === 'warning' && (
                            <span
                              title={validation.message}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 cursor-help"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Notice
                            </span>
                          )}
                          {validation.status === 'incompatible' && (
                            <span
                              title={validation.message}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger cursor-help"
                            >
                              <AlertCircle className="w-3 h-3" />
                              Mismatch
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Static Constant Values Section */}
          <div className="p-4 rounded-xl bg-surface/60 border border-cardBorder space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-primary" />
                  Static Constant SAP Fields (Defaults)
                </h3>
                <p className="text-[10px] text-textSubtle mt-0.5">
                  Provide fixed constant values for mandatory SAP fields that do not exist in the Voice Entry template (e.g. CompanyCode, Plant).
                </p>
              </div>
            </div>

            {/* List of current static values */}
            {Object.keys(staticValues).length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(staticValues).map(([k, v]) => (
                  <div
                    key={k}
                    className="p-2 px-3 rounded-lg bg-background border border-cardBorder flex items-center justify-between"
                  >
                    <div className="text-xs font-mono">
                      <span className="text-textSubtle">{k}: </span>
                      <strong className="text-primary">{v}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveStaticValue(k)}
                      className="text-textSubtle hover:text-danger p-1 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Static Key/Value */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <select
                value={newStaticKey}
                onChange={(e) => setNewStaticKey(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
              >
                <option value="">-- Choose SAP Property --</option>
                {currentEntitySet?.fields.map((sf) => (
                  <option key={sf.name} value={sf.name}>
                    {sf.name} ({sf.type.replace('Edm.', '')})
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Constant Value (e.g. 1000)"
                value={newStaticVal}
                onChange={(e) => setNewStaticVal(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono flex-1 min-w-[140px]"
              />

              <button
                type="button"
                onClick={handleAddStaticValue}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-cardBorder flex items-center justify-between bg-surface/50">
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                Mapping Saved Successfully!
              </span>
            )}
            {errorMessage && (
              <span className="text-xs font-bold text-danger flex items-center gap-1 animate-fade-in">
                <AlertCircle className="w-4 h-4" />
                {errorMessage}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/25 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Mapping'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
