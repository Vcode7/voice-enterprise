'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  RotateCcw,
  Check,
  Save,
  Cpu,
  Layers,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { OllamaGenerationOptions } from '@/types';
import { DEFAULT_OLLAMA_OPTIONS } from '@/lib/constants';
import { apiUrl } from '@/lib/api/apiClient';

interface OllamaSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOptions?: OllamaGenerationOptions;
  onSave?: (updatedOptions: OllamaGenerationOptions) => void;
}

export const OllamaSettingsModal: React.FC<OllamaSettingsModalProps> = ({
  isOpen,
  onClose,
  currentOptions,
  onSave,
}) => {
  const [temperature, setTemperature] = useState<number>(0.1);
  const [numPredict, setNumPredict] = useState<number>(2048);
  const [numCtx, setNumCtx] = useState<number>(2048);
  const [topP, setTopP] = useState<number>(0.9);
  const [topK, setTopK] = useState<number>(40);
  const [repeatPenalty, setRepeatPenalty] = useState<number>(1.1);
  const [repeatLastN, setRepeatLastN] = useState<number>(64);
  const [seed, setSeed] = useState<string>('');
  const [stop, setStop] = useState<string>('');
  const [minP, setMinP] = useState<string>('0.05');
  const [numBatch, setNumBatch] = useState<string>('512');
  const [numGpu, setNumGpu] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Initialize from currentOptions or fallback
  useEffect(() => {
    const initFrom = currentOptions || DEFAULT_OLLAMA_OPTIONS;
    setTemperature(initFrom.temperature ?? 0.1);
    setNumPredict(initFrom.num_predict ?? 2048);
    setNumCtx(initFrom.num_ctx ?? 2048);
    setTopP(initFrom.top_p ?? 0.9);
    setTopK(initFrom.top_k ?? 40);
    setRepeatPenalty(initFrom.repeat_penalty ?? 1.1);
    setRepeatLastN(initFrom.repeat_last_n ?? 64);
    setSeed(initFrom.seed !== undefined ? String(initFrom.seed) : '');
    setStop(Array.isArray(initFrom.stop) ? initFrom.stop.join(', ') : '');
    setMinP(initFrom.min_p !== undefined ? String(initFrom.min_p) : '0.05');
    setNumBatch(initFrom.num_batch !== undefined ? String(initFrom.num_batch) : '512');
    setNumGpu(initFrom.num_gpu !== undefined ? String(initFrom.num_gpu) : '');
  }, [currentOptions, isOpen]);

  if (!isOpen) return null;

  const handleResetDefaults = () => {
    setTemperature(DEFAULT_OLLAMA_OPTIONS.temperature ?? 0.1);
    setNumPredict(DEFAULT_OLLAMA_OPTIONS.num_predict ?? 2048);
    setNumCtx(DEFAULT_OLLAMA_OPTIONS.num_ctx ?? 2048);
    setTopP(DEFAULT_OLLAMA_OPTIONS.top_p ?? 0.9);
    setTopK(DEFAULT_OLLAMA_OPTIONS.top_k ?? 40);
    setRepeatPenalty(DEFAULT_OLLAMA_OPTIONS.repeat_penalty ?? 1.1);
    setRepeatLastN(DEFAULT_OLLAMA_OPTIONS.repeat_last_n ?? 64);
    setSeed('');
    setStop('');
    setMinP('0.05');
    setNumBatch('512');
    setNumGpu('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const parsedStop = stop
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const updatedOptions: OllamaGenerationOptions = {
        temperature: Number(temperature),
        num_predict: Number(numPredict),
        num_ctx: Number(numCtx),
        top_p: Number(topP),
        top_k: Number(topK),
        repeat_penalty: Number(repeatPenalty),
        repeat_last_n: Number(repeatLastN),
      };

      if (seed.trim() !== '' && !isNaN(Number(seed))) {
        updatedOptions.seed = Number(seed);
      }
      if (parsedStop.length > 0) {
        updatedOptions.stop = parsedStop;
      }
      if (minP.trim() !== '' && !isNaN(Number(minP))) {
        updatedOptions.min_p = Number(minP);
      }
      if (numBatch.trim() !== '' && !isNaN(Number(numBatch))) {
        updatedOptions.num_batch = Number(numBatch);
      }
      if (numGpu.trim() !== '' && !isNaN(Number(numGpu))) {
        updatedOptions.num_gpu = Number(numGpu);
      }

      // Save to localStorage
      try {
        localStorage.setItem('voice_epr_ollama_options', JSON.stringify(updatedOptions));
      } catch {}

      // Persist to user settings via API
      try {
        await fetch(apiUrl('/api/settings'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ollamaOptions: updatedOptions }),
        });
      } catch (err) {
        console.warn('Could not persist Ollama settings to server:', err);
      }

      onSave?.(updatedOptions);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 700);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-card border border-primary/30 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cardBorder bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text flex items-center gap-2">
                Ollama Generation Settings
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                  Local Parameters
                </span>
              </h2>
              <p className="text-xs text-textSubtle">
                Control LLM sampling, context memory, and GPU offload for vision document extraction
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-text">
          {/* Section 1: Sampling & Context */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 border-b border-cardBorder pb-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Core Sampling & Context Memory</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Temperature */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text flex items-center gap-1">
                    <span>temperature</span>
                    <span className="text-[10px] text-textSubtle font-normal">(0.0 - 1.5)</span>
                  </label>
                  <span className="font-mono text-primary font-bold">{temperature}</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.5}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <p className="text-[10px] text-textSubtle">
                  Lower values (0.05 - 0.2) give deterministic, accurate JSON structure.
                </p>
              </div>

              {/* Context Size (num_ctx) */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text flex items-center gap-1">
                    <span>num_ctx</span>
                    <span className="text-[10px] text-emerald-400 font-mono">(Context Size)</span>
                  </label>
                  <span className="font-mono text-emerald-400 font-bold">{numCtx}</span>
                </div>
                <input
                  type="number"
                  min={512}
                  max={16384}
                  step={256}
                  value={numCtx}
                  onChange={(e) => setNumCtx(parseInt(e.target.value) || 2048)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">
                  Avoids 32768 overhead. 2048/4096 is optimal for document sheets and avoids CPU spillover.
                </p>
              </div>

              {/* Max Output Tokens (num_predict) */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text flex items-center gap-1">
                    <span>num_predict</span>
                    <span className="text-[10px] text-textSubtle font-normal">(Max Tokens)</span>
                  </label>
                  <span className="font-mono text-primary font-bold">{numPredict}</span>
                </div>
                <input
                  type="number"
                  min={-2}
                  max={8192}
                  step={128}
                  value={numPredict}
                  onChange={(e) => setNumPredict(parseInt(e.target.value) || 2048)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">
                  Maximum output tokens generated. Set to 2048 for full tables.
                </p>
              </div>

              {/* Top P */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text flex items-center gap-1">
                    <span>top_p</span>
                    <span className="text-[10px] text-textSubtle font-normal">(0.0 - 1.0)</span>
                  </label>
                  <span className="font-mono text-primary font-bold">{topP}</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <p className="text-[10px] text-textSubtle">
                  Nucleus sampling probability threshold (default 0.9).
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Probabilities & Penalties */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 border-b border-cardBorder pb-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Probability & Repetition Controls</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top K */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">top_k</label>
                  <span className="font-mono text-primary font-bold">{topK}</span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={topK}
                  onChange={(e) => setTopK(parseInt(e.target.value) || 40)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Limits next token choices to top K (default 40).</p>
              </div>

              {/* Min P */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">min_p</label>
                  <span className="font-mono text-primary font-bold">{minP || 'Disabled'}</span>
                </div>
                <input
                  type="number"
                  min={0.0}
                  max={1.0}
                  step={0.01}
                  placeholder="e.g. 0.05"
                  value={minP}
                  onChange={(e) => setMinP(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Minimum probability cutoff (default 0.05).</p>
              </div>

              {/* Repeat Penalty */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">repeat_penalty</label>
                  <span className="font-mono text-primary font-bold">{repeatPenalty}</span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={2.0}
                  step={0.05}
                  value={repeatPenalty}
                  onChange={(e) => setRepeatPenalty(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <p className="text-[10px] text-textSubtle">Penalizes repeated loop generation (default 1.1).</p>
              </div>

              {/* Repeat Last N */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">repeat_last_n</label>
                  <span className="font-mono text-primary font-bold">{repeatLastN}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={256}
                  value={repeatLastN}
                  onChange={(e) => setRepeatLastN(parseInt(e.target.value) || 64)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Tokens to look back for repetition (default 64).</p>
              </div>
            </div>
          </div>

          {/* Section 3: Hardware & Advanced Execution */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 border-b border-cardBorder pb-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span>Hardware & Execution Options</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Batch Size (num_batch) */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">num_batch</label>
                  <span className="font-mono text-textSubtle">{numBatch || '512'}</span>
                </div>
                <input
                  type="number"
                  min={64}
                  max={2048}
                  step={64}
                  placeholder="512"
                  value={numBatch}
                  onChange={(e) => setNumBatch(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Batch size for prompt/image evaluation.</p>
              </div>

              {/* GPU Offload (num_gpu) */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">num_gpu</label>
                  <span className="font-mono text-textSubtle">{numGpu || 'Auto'}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={999}
                  placeholder="e.g. 99 (offload all layers to GPU)"
                  value={numGpu}
                  onChange={(e) => setNumGpu(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Layers to offload to GPU (set 99 to force full GPU).</p>
              </div>

              {/* Seed */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">seed</label>
                  <span className="font-mono text-textSubtle">{seed || 'Random'}</span>
                </div>
                <input
                  type="number"
                  placeholder="e.g. 42 (blank for random)"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Random seed for reproducible completions.</p>
              </div>

              {/* Stop Sequences */}
              <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-cardBorder">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-text">stop</label>
                  <span className="text-[10px] text-textSubtle">comma-separated</span>
                </div>
                <input
                  type="text"
                  placeholder='e.g. \n\n, END_JSON'
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text font-mono focus:border-primary focus:outline-none"
                />
                <p className="text-[10px] text-textSubtle">Halt token sequences if encountered.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-cardBorder bg-surface">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3 py-1.5 rounded-xl border border-cardBorder hover:bg-surfaceMuted text-textMuted hover:text-text transition flex items-center gap-1.5 cursor-pointer"
            title="Reset to recommended defaults (2048 context)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-cardBorder hover:bg-surfaceMuted text-textMuted hover:text-text transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white font-semibold shadow-lg shadow-primary/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save & Apply</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
