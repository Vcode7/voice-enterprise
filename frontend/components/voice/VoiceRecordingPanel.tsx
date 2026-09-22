'use client';

import React from 'react';
import {
  Mic,
  Square,
  Loader2,
  Sparkles,
  Layers,
  Settings2,
  Edit3,
  AlertCircle,
  Copy,
  Check,
  FileText,
  Volume2,
} from 'lucide-react';
import { DataTemplate, RecordingState } from '@/types';
import { AudioVisualizer } from '@/components/voice/AudioVisualizer';
import { VoiceAudioPlayer } from '@/components/voice/VoiceAudioPlayer';

interface VoiceRecordingPanelProps {
  dataMode: 'template' | 'flexible';
  onModeChange: (mode: 'template' | 'flexible') => void;
  activeTemplate: DataTemplate;
  onChangeTemplate: () => void;
  templatesCount: number;
  // Recording state
  recordingState: RecordingState;
  durationSeconds: number;
  volumeLevel: number;
  isProcessing: boolean;
  processingStatus: string;
  errorMessage: string | null;
  lastAudioUrl: string | null;
  lastTranscript: string | null;
  lastExtractedEntryNumber: number | null;
  // Actions
  onMicPress: () => void;
  onOpenManualEntry: () => void;
}

export function VoiceRecordingPanel({
  dataMode,
  onModeChange,
  activeTemplate,
  onChangeTemplate,
  templatesCount,
  recordingState,
  durationSeconds,
  volumeLevel,
  isProcessing,
  processingStatus,
  errorMessage,
  lastAudioUrl,
  lastTranscript,
  lastExtractedEntryNumber,
  onMicPress,
  onOpenManualEntry,
}: VoiceRecordingPanelProps) {
  const [copied, setCopied] = React.useState(false);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyTranscript = () => {
    if (!lastTranscript) return;
    navigator.clipboard.writeText(lastTranscript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-cardBorder rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden flex flex-col gap-5 h-full">
      {/* Background ambient glow */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
          <h2 className="text-sm sm:text-base font-bold text-text tracking-wide">
            Voice Recording Console
          </h2>
        </div>
        <span className="text-[11px] font-semibold text-textSubtle uppercase tracking-wider">
          Live Input
        </span>
      </div>

      {/* Mode Selector Tabs (Template Extraction is Default) */}
      <div>
        <label className="text-[11px] font-bold text-textSubtle uppercase tracking-wider block mb-2">
          Extraction Mode
        </label>
        <div className="grid grid-cols-2 gap-2 bg-surface p-1.5 rounded-xl border border-cardBorder">
          <button
            onClick={() => onModeChange('template')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
              dataMode === 'template'
                ? 'bg-primary text-white shadow-md font-extrabold'
                : 'text-textMuted hover:text-text hover:bg-surfaceMuted'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>📑 Template Form</span>
          </button>

          <button
            onClick={() => onModeChange('flexible')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
              dataMode === 'flexible'
                ? 'bg-primary text-white shadow-md font-extrabold'
                : 'text-textMuted hover:text-text hover:bg-surfaceMuted'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>✨ Flexible Mode</span>
          </button>
        </div>
      </div>

      {/* Active Template Bar (when Template mode is active) */}
      {dataMode === 'template' && (
        <div className="p-3 rounded-xl bg-surface border border-cardBorder flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-textSubtle uppercase font-bold">Selected Template</span>
              {activeTemplate.lookupConfig?.enabled && (
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Auto-Fill ON</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs font-bold text-text truncate">{activeTemplate.name}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono shrink-0">
                {activeTemplate.fields.length} fields
              </span>
            </div>
            {activeTemplate.lookupConfig?.enabled && (
              <p className="text-[10px] text-primary/90 truncate mt-0.5">
                ⚡ Speak {activeTemplate.lookupConfig.mainTableColumn} → auto-fills {activeTemplate.lookupConfig.fieldMappings?.length || 0} fields
              </p>
            )}
          </div>

          <button
            onClick={onChangeTemplate}
            className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Change</span>
          </button>
        </div>
      )}

      {/* Voice Recording Console */}
      <div className="flex flex-col items-center justify-center text-center py-2 space-y-4 bg-surface/50 border border-cardBorder rounded-xl p-4">
        <AudioVisualizer isRecording={recordingState === 'Recording'} volumeLevel={volumeLevel} />

        {/* Glowing Record/Stop Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={onMicPress}
            disabled={isProcessing}
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center transition-all shadow-2xl cursor-pointer ${
              recordingState === 'Recording'
                ? 'bg-danger text-white animate-pulse shadow-danger/50 scale-105'
                : 'bg-gradient-to-tr from-primaryDark to-primary hover:from-primary hover:to-orange-400 text-white shadow-primary/30 hover:scale-105 active:scale-95'
            } disabled:opacity-50`}
            title={recordingState === 'Recording' ? 'Click to Stop & Extract' : 'Click to Record Voice'}
          >
            {recordingState === 'Recording' ? (
              <Square className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
            ) : isProcessing ? (
              <Loader2 className="w-7 h-7 sm:w-8 sm:h-8 animate-spin" />
            ) : (
              <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
            )}
          </button>
        </div>

        {/* Live Timer & Processing State */}
        <div>
          <div className="text-xl sm:text-2xl font-mono font-bold text-text tracking-wider">
            {formatTimer(durationSeconds)}
          </div>
          <p className="text-xs font-semibold text-textMuted mt-1">
            {recordingState === 'Recording' ? (
              <span className="text-danger flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-danger animate-ping" />
                Recording... Click stop when done
              </span>
            ) : isProcessing ? (
              <span className="text-primary flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {processingStatus}
              </span>
            ) : (
              <span>Click microphone to dictate a new entry</span>
            )}
          </p>
        </div>

        {errorMessage && (
          <div className="p-2.5 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs flex items-center gap-2 max-w-sm text-left">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Audio Playback Player (if audio recorded) */}
      {lastAudioUrl && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-textSubtle font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1 text-primary">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Audio Playback</span>
            </span>
          </div>
          <VoiceAudioPlayer audioUrl={lastAudioUrl} />
        </div>
      )}

      {/* Transcription Display */}
      {lastTranscript && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-textSubtle font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1 text-primary">
              <FileText className="w-3.5 h-3.5" />
              <span>Speech-to-Text Transcription</span>
            </span>
            <button
              onClick={handleCopyTranscript}
              className="text-[10px] text-textMuted hover:text-text flex items-center gap-1 cursor-pointer transition"
              title="Copy transcript"
            >
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div className="p-3 rounded-xl bg-surface border border-cardBorder text-xs text-text leading-relaxed relative">
            <p className="italic text-text">"{lastTranscript}"</p>
            {lastExtractedEntryNumber && (
              <div className="mt-2 pt-2 border-t border-cardBorder flex items-center justify-between text-[10px] text-primary font-semibold">
                <span>✓ Extracted into Entry #{lastExtractedEntryNumber}</span>
                <span className="text-textSubtle">Appended to Left Panel</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enter Manually Option */}
      <div className="pt-2 border-t border-cardBorder/60 flex flex-col gap-2">
        <button
          onClick={onOpenManualEntry}
          className="w-full py-2.5 px-4 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition cursor-pointer hover:border-primary/50"
        >
          <Edit3 className="w-4 h-4 text-primary" />
          <span>+ Add Entry Manually Without Voice</span>
        </button>

        <p className="text-[10px] text-textSubtle text-center">
          💡 Each voice dictation or manual entry creates a separate entry in the left panel.
        </p>
      </div>
    </div>
  );
}
