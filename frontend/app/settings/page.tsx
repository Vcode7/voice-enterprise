'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  ShieldCheck,
  Building,
  Coins,
  Database,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  Upload,
  RefreshCw,
  Sliders,
  Cpu,
  Zap,
  ZoomIn,
} from 'lucide-react';
import {
  UserSettings,
  ExtractionMethodType,
  OllamaVisionModel,
  OllamaGenerationOptions,
  ChandraModeType,
  ChandraQuantizationType,
  ChandraLoadingMethodType,
} from '@/types';
import { CURRENCIES, DEFAULT_SETTINGS, DEFAULT_OLLAMA_OPTIONS } from '@/lib/constants';
import { OllamaSettingsModal } from '@/components/handwritten/OllamaSettingsModal';
import { SapSettingsSection } from '@/components/sap/SapSettingsSection';
import { apiUrl } from '@/lib/api/apiClient';

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [hfApiKeyInput, setHfApiKeyInput] = useState('');
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [defaultExtractionMethod, setDefaultExtractionMethod] = useState<ExtractionMethodType>('chandra_2');
  const [ollamaBaseUrlInput, setOllamaBaseUrlInput] = useState('http://127.0.0.1:11434');
  const [ollamaVisionModelInput, setOllamaVisionModelInput] = useState('qwen2.5vl:7b');
  const [ollamaModels, setOllamaModels] = useState<OllamaVisionModel[]>([]);
  const [ollamaOptions, setOllamaOptions] = useState<OllamaGenerationOptions>(DEFAULT_OLLAMA_OPTIONS);
  const [isOllamaSettingsOpen, setIsOllamaSettingsOpen] = useState<boolean>(false);
  const [isOllamaOnline, setIsOllamaOnline] = useState<boolean>(false);

  // Chandra V2 Vision Engine State
  const [chandraLoadingMethod, setChandraLoadingMethod] = useState<ChandraLoadingMethodType>('ollama');
  const [chandraMode, setChandraMode] = useState<ChandraModeType>('full_image');
  const [chandraQuantization, setChandraQuantization] = useState<ChandraQuantizationType>('3-bit');
  const [chandraOllamaModel, setChandraOllamaModel] = useState<string>('ahmgam/chandra-ocr-2:q4');
  const [chandraUpscale, setChandraUpscale] = useState<boolean>(false);
  const [availableChandraOllamaModels, setAvailableChandraOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState<boolean>(false);

  const [geminiStatus, setGeminiStatus] = useState<{
    hasEnvKey: boolean;
    hasCustomKey: boolean;
    isConfigured: boolean;
    model: string;
    keyLabels?: string[];
  }>({
    hasEnvKey: false,
    hasCustomKey: false,
    isConfigured: false,
    model: 'gemini-2.5-flash',
  });

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const refreshOllamaModels = useCallback(async () => {
    try {
      setLoadingOllamaModels(true);
      const res = await fetch(apiUrl('/api/handwritten/ollama/models'));
      if (res.ok) {
        const data = await res.json();
        setIsOllamaOnline(Boolean(data.online));
        if (Array.isArray(data.models) && data.models.length > 0) {
          setAvailableChandraOllamaModels(data.models);
          setOllamaModels(data.models.map((m: string) => ({ id: m, name: m, isVisionCapable: true })));
          setChandraOllamaModel((prev) => {
            if (data.models.includes(prev)) return prev;
            const preferred = data.models.find((m: string) => m.toLowerCase().includes('chandra')) || data.models[0];
            return preferred || prev;
          });
        }
      }
    } catch (e) {
      console.warn('Could not refresh Ollama models:', e);
      setIsOllamaOnline(false);
    } finally {
      setLoadingOllamaModels(false);
    }
  }, []);

  const loadSettings = async () => {
    try {
      const [setRes, geminiRes, ollamaRes] = await Promise.allSettled([
        fetch(apiUrl('/api/settings')),
        fetch(apiUrl('/api/gemini/status')),
        fetch(apiUrl('/api/handwritten/ollama/models')),
      ]);

      if (setRes.status === 'fulfilled' && setRes.value.ok) {
        try {
          const setData = await setRes.value.json();
          if (setData) {
            setSettings(setData);
            setHfApiKeyInput(setData.huggingFaceApiKey || '');
            setGeminiApiKeyInput(setData.customGeminiApiKey || '');
            setDefaultExtractionMethod(setData.defaultExtractionMethod || 'chandra_2');
            setOllamaBaseUrlInput(setData.ollamaBaseUrl || 'http://127.0.0.1:11434');
            setOllamaVisionModelInput(setData.ollamaVisionModel || 'qwen2.5vl:7b');
            if (setData.ollamaOptions) {
              setOllamaOptions(setData.ollamaOptions);
            }
            if (setData.chandraLoadingMethod) {
              setChandraLoadingMethod(setData.chandraLoadingMethod);
            }
            if (setData.chandraMode) {
              setChandraMode(setData.chandraMode);
            }
            if (setData.chandraQuantization) {
              setChandraQuantization(setData.chandraQuantization);
            }
            if (setData.chandraOllamaModel) {
              setChandraOllamaModel(setData.chandraOllamaModel);
            }
            if (typeof setData.chandraUpscale === 'boolean') {
              setChandraUpscale(setData.chandraUpscale);
            }
          }
        } catch (err) {
          console.warn('Could not parse settings JSON:', err);
        }
      }

      if (geminiRes.status === 'fulfilled' && geminiRes.value.ok) {
        try {
          const geminiData = await geminiRes.value.json();
          setGeminiStatus(geminiData);
        } catch (err) {
          console.warn('Could not parse gemini status:', err);
        }
      }

      if (ollamaRes.status === 'fulfilled' && ollamaRes.value.ok) {
        try {
          const oData = await ollamaRes.value.json();
          setIsOllamaOnline(Boolean(oData.online ?? true));
          if (oData && Array.isArray(oData.models)) {
            setAvailableChandraOllamaModels(oData.models);
            setOllamaModels(oData.models.map((m: string) => ({ id: m, name: m, isVisionCapable: true })));
          }
        } catch (err) {
          console.warn('Could not parse ollama models:', err);
        }
      }
    } catch (e) {
      console.warn('Notice: Backend settings sync paused:', e);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updated: UserSettings = {
        ...settings,
        customGroqApiKey: settings.customGroqApiKey || '',
        huggingFaceApiKey: hfApiKeyInput.trim(),
        customGeminiApiKey: geminiApiKeyInput.trim(),
        defaultExtractionMethod,
        ollamaBaseUrl: ollamaBaseUrlInput.trim(),
        ollamaVisionModel: ollamaVisionModelInput.trim(),
        ollamaOptions,
        chandraLoadingMethod,
        chandraMode,
        chandraQuantization,
        chandraOllamaModel: chandraOllamaModel.trim(),
        chandraUpscale,
      };
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const data = await res.json();
      setSettings(data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      loadSettings();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearData = async () => {
    if (!confirm('WARNING: Are you sure you want to delete ALL recorded data entries? Templates and lookup tables will be preserved.')) return;
    try {
      await fetch(apiUrl('/api/clear'), { method: 'POST' });
      alert('All session and data entry records have been cleared.');
    } catch (e) {
      alert('Failed to clear database records.');
    }
  };

  const handleExport = (format: 'json' | 'csv') => {
    window.open(apiUrl(`/api/export?format=${format}`), '_blank');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      setImportResult(null);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(apiUrl('/api/import'), {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      setImportResult(data);
    } catch (err: any) {
      alert(err.message || 'Import failed.');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          Settings &amp; Preferences
        </h1>
        <p className="text-xs text-textMuted mt-0.5">
          Configure Chandra V2 Vision Engine, AI models, enterprise profile, master data backup, and database exports.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* 1. Dedicated Chandra V2 Vision Engine Configuration Card */}
        <div className="p-4 sm:p-6 rounded-2xl bg-card border border-primary/30 shadow-md space-y-4">
          <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3">
            <h2 className="text-xs sm:text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Chandra V2 Vision Engine Configuration
            </h2>
            <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
              {chandraMode === 'full_image' ? 'Complete OCR → LLM' : 'PaddleOCR + Chandra'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-surface border border-cardBorder text-xs text-textMuted leading-relaxed flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <strong className="text-text font-semibold">
                Chandra V2 ({chandraLoadingMethod === 'ollama' ? `Ollama API: ${chandraOllamaModel}` : `${chandraQuantization} Local PyTorch`}):
              </strong>{' '}
              {chandraMode === 'full_image' ? (
                <span>
                  Transcribes complete page to HTML layout using <code>OCR_PROMPT</code>, then auto-fills template fields and tables via LLM.
                </span>
              ) : (
                <span>
                  Detects text regions with PaddleOCR, then transcribes handwriting crops using Chandra V2.
                </span>
              )}
            </div>
          </div>

          {/* Chandra OCR Loading Method: Local vs Ollama */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-surface rounded-xl border border-cardBorder gap-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-text">Loading Method:</span>
              </div>
              <span className="text-[10px] text-textMuted ml-5">
                {chandraLoadingMethod === 'local'
                  ? 'Local: Direct PyTorch inference with on-demand quantization'
                  : `Ollama: Send same image & prompt via Ollama API (${chandraOllamaModel})`}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-surfaceMuted p-1 rounded-lg border border-cardBorder shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setChandraLoadingMethod('local')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  chandraLoadingMethod === 'local'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Local PyTorch inference with 3/4/8-bit quantization"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Local</span>
              </button>
              <button
                type="button"
                onClick={() => setChandraLoadingMethod('ollama')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  chandraLoadingMethod === 'ollama'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Send same image and OCR prompt to selected Chandra Ollama model"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Ollama</span>
              </button>
            </div>
          </div>

          {/* Chandra 2 Mode Switch: Full Image vs Detected Region */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-surface rounded-xl border border-cardBorder gap-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-text">Chandra 2 Mode:</span>
              </div>
              <span className="text-[10px] text-textMuted ml-5">
                {chandraMode === 'full_image'
                  ? 'Full Image: Transcribes complete page directly to HTML layout OCR'
                  : 'Detected Region: PaddleOCR region detection + Chandra crop transcription'}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-surfaceMuted p-1 rounded-lg border border-cardBorder shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setChandraMode('full_image')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                  chandraMode === 'full_image'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Send complete page image directly to Chandra 2 for HTML layout OCR, then extract fields with LLM"
              >
                Full Image (Complete OCR)
              </button>
              <button
                type="button"
                onClick={() => setChandraMode('detected_region')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                  chandraMode === 'detected_region'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Detect printed labels with PaddleOCR, then transcribe handwritten crops with Chandra 2"
              >
                Detected Region
              </button>
            </div>
          </div>

          {/* When Local: Chandra 2 Quantization Level */}
          {chandraLoadingMethod === 'local' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-surface rounded-xl border border-cardBorder gap-2">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-bold text-text">Quantization Level:</span>
                </div>
                <span className="text-[10px] text-textMuted ml-5">
                  {chandraQuantization === '3-bit'
                    ? '3-bit NF4 + Double Quantization (~3.5 GB VRAM, Default)'
                    : chandraQuantization === '4-bit'
                    ? '4-bit NF4 Single Quantization (~4.3 GB VRAM)'
                    : '8-bit LLM.int8 Quantization (~6.0 GB VRAM)'}
                </span>
              </div>
              <div className="flex items-center gap-1 bg-surfaceMuted p-1 rounded-lg border border-cardBorder shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setChandraQuantization('3-bit')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                    chandraQuantization === '3-bit'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-textMuted hover:text-text'
                  }`}
                >
                  3-bit (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setChandraQuantization('4-bit')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                    chandraQuantization === '4-bit'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-textMuted hover:text-text'
                  }`}
                >
                  4-bit
                </button>
                <button
                  type="button"
                  onClick={() => setChandraQuantization('8-bit')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                    chandraQuantization === '8-bit'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-textMuted hover:text-text'
                  }`}
                >
                  8-bit
                </button>
              </div>
            </div>
          )}

          {/* When Ollama: Configurable Ollama Vision Model Selector */}
          {chandraLoadingMethod === 'ollama' && (
            <div className="p-3 bg-surface rounded-xl border border-cardBorder space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-bold text-text">Ollama Model:</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1.5 font-medium ${
                      isOllamaOnline
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isOllamaOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {isOllamaOnline ? 'Ollama Online' : 'Ollama Offline'}
                  </span>
                  <button
                    type="button"
                    onClick={refreshOllamaModels}
                    disabled={loadingOllamaModels}
                    className="p-1 rounded text-textMuted hover:text-text hover:bg-surfaceMuted transition cursor-pointer disabled:opacity-50"
                    title="Refresh Ollama models list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingOllamaModels ? 'animate-spin text-primary' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {availableChandraOllamaModels && availableChandraOllamaModels.length > 0 ? (
                  <div className="flex-1 flex gap-2">
                    <select
                      value={chandraOllamaModel}
                      onChange={(e) => setChandraOllamaModel(e.target.value)}
                      className="flex-1 bg-background border border-cardBorder text-text text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-primary font-mono"
                    >
                      {availableChandraOllamaModels.map((mod) => (
                        <option key={mod} value={mod}>
                          {mod}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={chandraOllamaModel}
                      onChange={(e) => setChandraOllamaModel(e.target.value)}
                      placeholder="Custom model tag..."
                      className="w-48 bg-background border border-cardBorder text-text text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-primary font-mono"
                      title="Or type custom model name / tag"
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={chandraOllamaModel}
                    onChange={(e) => setChandraOllamaModel(e.target.value)}
                    placeholder="e.g. ahmgam/chandra-ocr-2:q4"
                    className="flex-1 bg-background border border-cardBorder text-text text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-primary font-mono"
                  />
                )}
              </div>
              <p className="text-[10px] text-textMuted leading-relaxed">
                Sends the same image and prompt to the selected Ollama model. The returned OCR output follows the same format so the SQLite → LLM extraction pipeline is 100% preserved.
              </p>
            </div>
          )}

          {/* Chandra 2 Upscale Image Toggle (Default: OFF) */}
          <div className="flex items-center justify-between p-3 bg-surface rounded-xl border border-cardBorder">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <ZoomIn className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-text">Upscale Image:</span>
              </div>
              <span className="text-[10px] text-textMuted ml-5">
                {chandraUpscale
                  ? '1.5x upscaling preprocessing applied before inference'
                  : 'Original image processed without upscaling (Default)'}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-surfaceMuted p-1 rounded-lg border border-cardBorder">
              <button
                type="button"
                onClick={() => setChandraUpscale(false)}
                className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  !chandraUpscale
                    ? 'bg-card text-text shadow-sm border border-cardBorder'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Process original image directly without upscaling (Default: OFF)"
              >
                OFF
              </button>
              <button
                type="button"
                onClick={() => setChandraUpscale(true)}
                className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  chandraUpscale
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-textMuted hover:text-text'
                }`}
                title="Apply 1.5x upscaling preprocessing before Chandra V2 inference"
              >
                ON (1.5x)
              </button>
            </div>
          </div>
        </div>

        {/* 2. Multimodal AI & OCR Models Configuration */}
        <div className="p-4 sm:p-6 rounded-2xl bg-card border border-cardBorder shadow-md space-y-4">
          <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3">
            <h2 className="text-xs sm:text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Multimodal AI &amp; OCR Engine Configuration
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                Default Handwriting Extraction Pipeline
              </label>
              <select
                value={defaultExtractionMethod}
                onChange={(e) => setDefaultExtractionMethod(e.target.value as ExtractionMethodType)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              >
                <option value="chandra_2" className="bg-card text-text">
                  🪐 Chandra V2 Vision Engine (Complete OCR → LLM)
                </option>
                <option value="gemini" className="bg-card text-text">
                  ✨ Gemini 2.5 Flash / 3.5 Flash-Lite (Multimodal Cloud)
                </option>
                <option value="paddleocr_vl" className="bg-card text-text">
                  🚀 PaddleOCR-VL 1.6 (Pure Local OCR)
                </option>
                <option value="ollama_vision" className="bg-card text-text">
                  👁️ Ollama Vision (Local Multimodal Vision LLM)
                </option>
              </select>
              <span className="text-[10px] text-textSubtle block">
                Select which extraction pipeline is selected by default in Handwriting Scan.
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                Hugging Face Token (For TrOCR Large Handwritten)
              </label>
              <input
                type="password"
                value={hfApiKeyInput}
                onChange={(e) => setHfApiKeyInput(e.target.value)}
                placeholder="hf_..."
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
              />
              <span className="text-[10px] text-textSubtle block">
                Get token at{' '}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline font-semibold"
                >
                  huggingface.co/settings/tokens
                </a>
              </span>
            </div>
          </div>

          {/* Gemini 3.5 Flash-Lite Configuration */}
          <div className="pt-4 border-t border-cardBorder space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Google Gemini 3.5 Flash-Lite (Direct Multimodal Handwriting Scan)
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  geminiStatus.isConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}
              >
                {geminiStatus.isConfigured
                  ? `Active • ${geminiStatus.model}`
                  : 'Key Missing'}
              </span>
            </div>

            <p className="text-[11px] text-textSubtle leading-relaxed">
              When Gemini is selected in Handwriting Scan, original document files (PDF or images) are sent directly to Gemini 3.5 Flash-Lite for ultra-fast, low-latency multimodal field and table extraction without TrOCR preprocessing.
            </p>

            <div className="space-y-1.5">
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                Google Gemini API Key
              </label>
              <input
                type="password"
                value={geminiApiKeyInput}
                onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                placeholder={geminiStatus.hasEnvKey ? 'Configured via .env (GEMINI_API_KEY)' : 'AIzaSy...'}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-amber-500 font-mono"
              />
              <span className="text-[10px] text-textSubtle block">
                Get your free Gemini API key at{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 underline font-semibold"
                >
                  aistudio.google.com/app/apikey
                </a>
              </span>
            </div>
          </div>

          {/* Local Ollama Vision Server Configuration */}
          <div className="pt-4 border-t border-cardBorder space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-primary" />
                Ollama Vision (Local Multimodal Vision Models)
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    isOllamaOnline
                      ? 'bg-primary/10 text-primary border-primary/30'
                      : 'bg-danger/10 text-danger border-danger/30'
                  }`}
                >
                  {isOllamaOnline ? `Online • ${ollamaModels.length} vision model(s)` : 'Ollama Offline'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsOllamaSettingsOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary hover:text-white border border-primary/30 text-[11px] font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-primary/20"
                  title="Configure Ollama Generation Parameters (temperature, num_ctx, top_p, etc.)"
                >
                  <Sliders className="w-3 h-3 text-primary" />
                  <span>Ollama Settings</span>
                </button>
              </div>
            </div>

            <p className="text-[11px] text-textSubtle leading-relaxed">
              When Ollama Vision is selected, documents are processed entirely on your local machine using vision-capable LLMs like Qwen2.5-VL or Gemma-4 without external cloud APIs.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                  Ollama Base Server URL
                </label>
                <input
                  type="text"
                  value={ollamaBaseUrlInput}
                  onChange={(e) => setOllamaBaseUrlInput(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle">
                  Default Ollama Vision Model
                </label>
                {ollamaModels.length > 0 ? (
                  <select
                    value={ollamaVisionModelInput}
                    onChange={(e) => setOllamaVisionModelInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m.id} value={m.name} className="bg-card text-text">
                        {m.name} ({m.parameterSize || (m.size ? (m.size / (1024 * 1024 * 1024)).toFixed(1) + 'GB' : '')})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={ollamaVisionModelInput}
                    onChange={(e) => setOllamaVisionModelInput(e.target.value)}
                    placeholder="qwen2.5vl:7b"
                    className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                  />
                )}
              </div>
            </div>

            {ollamaModels.length > 0 && (
              <div className="p-2.5 bg-surface rounded-xl border border-cardBorder text-xs text-textMuted flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase text-primary">Detected Local Vision Models:</span>
                {ollamaModels.map((m) => (
                  <span
                    key={m.id}
                    className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono text-[10px]"
                  >
                    {m.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Business Profile */}
        <div className="p-4 sm:p-6 rounded-2xl bg-card border border-cardBorder shadow-md space-y-4">
          <h2 className="text-xs sm:text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
            <Building className="w-4 h-4 text-primary" />
            Enterprise &amp; Facility Profile
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                Company / Plant Name
              </label>
              <input
                type="text"
                value={settings.businessName}
                onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>

            <div>
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                Contact Phone
              </label>
              <input
                type="text"
                value={settings.businessPhone}
                onChange={(e) => setSettings({ ...settings, businessPhone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
                Plant / Facility Address
              </label>
              <input
                type="text"
                value={settings.businessAddress}
                onChange={(e) => setSettings({ ...settings, businessAddress: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between">
          <div>
            {saveSuccess && (
              <span className="flex items-center space-x-1.5 text-xs text-emerald-400 font-semibold animate-in fade-in">
                <CheckCircle2 className="w-4 h-4" />
                <span>Settings saved successfully!</span>
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-lg shadow-primary/20 transition cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* SAP OData Integration Section */}
      <SapSettingsSection />

      {/* Database Backup & Export Section */}
      <div className="p-4 sm:p-6 rounded-2xl bg-card border border-cardBorder shadow-md space-y-4">
        <h2 className="text-xs sm:text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Master Data Export &amp; Backup
        </h2>
        <p className="text-[11px] text-textSubtle leading-relaxed">
          Export full JSON backup archives containing your ERP logs, data templates, and master lookup tables.
        </p>

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => handleExport('json')}
            className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Full JSON Backup</span>
          </button>

          <button
            onClick={() => handleExport('csv')}
            className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted text-text border border-cardBorder text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV Archive</span>
          </button>
        </div>

        {/* Clear Data */}
        <div className="pt-3 border-t border-cardBorder/60 flex items-center justify-between">
          <span className="text-xs text-textSubtle">Clear all accumulated data entry logs?</span>
          <button
            onClick={handleClearData}
            className="px-3.5 py-1.5 rounded-xl bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold transition cursor-pointer"
          >
            Clear Data Logs
          </button>
        </div>
      </div>

      {/* Ollama Generation Settings Modal */}
      <OllamaSettingsModal
        isOpen={isOllamaSettingsOpen}
        onClose={() => setIsOllamaSettingsOpen(false)}
        currentOptions={ollamaOptions}
        onSave={(newOpts) => {
          setOllamaOptions(newOpts);
          loadSettings();
        }}
      />
    </div>
  );
}
