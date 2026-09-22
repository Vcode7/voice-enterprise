'use client';

import React, { useState } from 'react';
import {
  Mic,
  Square,
  DollarSign,
  Receipt,
  FileSpreadsheet,
  Settings2,
  Loader2,
  AlertCircle,
  Edit3,
} from 'lucide-react';
import { useWebAudioRecorder } from '@/hooks/useWebAudioRecorder';
import { AudioVisualizer } from './AudioVisualizer';
import { DataTemplate, ExtractedIntentResult, ExtractedReceiptResult, ExtractedDataResult, FlexibleExtractedResult } from '@/types';
import { TransactionConfirmModal } from '../modals/TransactionConfirmModal';
import { ReceiptEditModal } from '../modals/ReceiptEditModal';
import { DataEntryEditModal } from '../modals/DataEntryEditModal';
import { TemplateManagerModal } from '../modals/TemplateManagerModal';
import { apiUrl } from '@/lib/api/apiClient';

interface VoiceRecordingStudioProps {
  activeTemplate: DataTemplate;
  onSelectActiveTemplate: (tmpl: DataTemplate) => void;
  onRefreshData: () => void;
}

export function VoiceRecordingStudio({
  activeTemplate,
  onSelectActiveTemplate,
  onRefreshData,
}: VoiceRecordingStudioProps) {
  const [mode, setMode] = useState<'expense' | 'receipt' | 'data'>('expense');
  const [voiceDataMode, setVoiceDataMode] = useState<'flexible' | 'template'>('flexible');
  const [showTemplateManager, setShowTemplateManager] = useState(false);

  // Result Modals state
  const [confirmTxData, setConfirmTxData] = useState<ExtractedIntentResult | null>(null);
  const [receiptData, setReceiptData] = useState<ExtractedReceiptResult | null>(null);
  const [templateEprData, setTemplateEprData] = useState<ExtractedDataResult | null>(null);
  const [flexibleEprData, setFlexibleEprData] = useState<FlexibleExtractedResult | null>(null);
  const [isManualDataEntry, setIsManualDataEntry] = useState(false);

  const recorder = useWebAudioRecorder();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

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
        recorder.setState('Understanding');
        setProcessingStatus('Extracting structured entities with LLM...');

        if (mode === 'expense') {
          const res = await fetch(apiUrl('/api/groq/intent'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: text }),
          });
          const data: ExtractedIntentResult = await res.json();
          setConfirmTxData(data);
        } else if (mode === 'receipt') {
          const res = await fetch(apiUrl('/api/groq/receipt'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: text }),
          });
          const data: ExtractedReceiptResult = await res.json();
          setReceiptData(data);
        } else {
          // Voice-to-Data mode
          if (voiceDataMode === 'flexible') {
            const res = await fetch(apiUrl('/api/groq/flexible'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: text }),
            });
            const data: FlexibleExtractedResult = await res.json();
            setFlexibleEprData(data);
          } else {
            const res = await fetch(apiUrl('/api/groq/custom-data'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: text, template: activeTemplate }),
            });
            const data: ExtractedDataResult = await res.json();
            setTemplateEprData(data);
          }
        }

        recorder.resetRecorder();
      } catch (err: any) {
        console.error('Voice Processing Error:', err);
        recorder.setErrorMessage(err.message || 'Processing failed. Please try again.');
        recorder.setState('Error');
      } finally {
        setIsProcessing(false);
      }
    } else {
      await recorder.startRecording();
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div className="bg-card border border-cardBorder rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        {/* Glow backdrop decorative accent */}
        <div className="absolute top-0 right-1/4 w-48 sm:w-72 h-48 sm:h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        {/* Mode Selector Tabs (Horizontally scrollable on mobile) */}
        <div className="flex items-center gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1 max-w-full justify-start sm:justify-center scrollbar-none">
          <button
            onClick={() => setMode('expense')}
            className={`flex items-center space-x-1.5 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-bold shrink-0 transition cursor-pointer ${
              mode === 'expense'
                ? 'bg-primary text-white shadow-lg shadow-primary/30 border border-primary/40'
                : 'bg-surface hover:bg-surfaceMuted text-textMuted hover:text-text border border-cardBorder'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>💰 Expense & Income</span>
          </button>

          <button
            onClick={() => setMode('receipt')}
            className={`flex items-center space-x-1.5 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-bold shrink-0 transition cursor-pointer ${
              mode === 'receipt'
                ? 'bg-secondary text-white shadow-lg shadow-secondary/30 border border-secondary/40'
                : 'bg-surface hover:bg-surfaceMuted text-textMuted hover:text-text border border-cardBorder'
            }`}
          >
            <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>🧾 Voice GST Invoice</span>
          </button>

          <button
            onClick={() => setMode('data')}
            className={`flex items-center space-x-1.5 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-bold shrink-0 transition cursor-pointer ${
              mode === 'data'
                ? 'bg-primary text-white shadow-lg shadow-primary/25 border border-primary/40'
                : 'bg-surface hover:bg-surfaceMuted text-textMuted hover:text-text border border-cardBorder'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>📋 Voice-to-Data ERP</span>
          </button>
        </div>

        {/* Sub-mode selector if in Data Entry mode */}
        {mode === 'data' && (
          <div className="flex flex-col xs:flex-row items-stretch xs:items-center justify-between p-2.5 sm:p-3 rounded-xl bg-surface border border-cardBorder mb-4 sm:mb-6 max-w-xl mx-auto gap-2">
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5">
              <button
                onClick={() => setVoiceDataMode('flexible')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer ${
                  voiceDataMode === 'flexible'
                    ? 'bg-primary/15 text-primary'
                    : 'text-textMuted hover:text-text'
                }`}
              >
                ✨ Flexible (Auto-Detect)
              </button>

              <button
                onClick={() => setVoiceDataMode('template')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer truncate max-w-[150px] sm:max-w-none ${
                  voiceDataMode === 'template'
                    ? 'bg-primary/15 text-primary'
                    : 'text-textMuted hover:text-text'
                }`}
              >
                📑 Template: {activeTemplate.name}
              </button>
            </div>

            {voiceDataMode === 'template' && (
              <button
                onClick={() => setShowTemplateManager(true)}
                className="text-xs text-textMuted hover:text-primary flex items-center justify-center gap-1 font-semibold transition cursor-pointer py-1 px-2 rounded-lg bg-surfaceMuted border border-cardBorder"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Switch</span>
              </button>
            )}
          </div>
        )}

        {/* Central Recording Console */}
        <div className="flex flex-col items-center justify-center text-center py-2 sm:py-4 space-y-3 sm:space-y-4">
          <AudioVisualizer isRecording={recorder.state === 'Recording'} volumeLevel={recorder.volumeLevel} />

          {/* Glowing Microphone Button */}
          <div className="relative">
            <button
              onClick={handleMicPress}
              disabled={isProcessing}
              className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center transition-all shadow-2xl cursor-pointer ${
                recorder.state === 'Recording'
                  ? 'bg-danger text-white animate-pulse-mic shadow-danger/40 scale-105'
                  : mode === 'expense'
                  ? 'bg-gradient-to-tr from-primaryDark to-primary hover:from-primary hover:to-orange-400 text-white shadow-primary/30 hover:scale-105 active:scale-95'
                  : mode === 'receipt'
                  ? 'bg-gradient-to-tr from-emerald-600 to-secondary hover:from-secondary hover:to-emerald-400 text-white shadow-secondary/30 hover:scale-105 active:scale-95'
                  : 'bg-gradient-to-tr from-primaryDark to-primary hover:from-primary hover:to-orange-400 text-white shadow-primary/30 hover:scale-105 active:scale-95'
              } disabled:opacity-50`}
            >
              {recorder.state === 'Recording' ? (
                <Square className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />
              ) : isProcessing ? (
                <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin" />
              ) : (
                <Mic className="w-8 h-8 sm:w-10 sm:h-10" />
              )}
            </button>
          </div>

          {/* Status & Timer */}
          <div>
            <div className="text-lg sm:text-xl font-mono font-bold text-text tracking-wider">
              {formatTimer(recorder.durationSeconds)}
            </div>
            <p className="text-xs font-semibold text-textMuted mt-1">
              {recorder.state === 'Recording' ? (
                <span className="text-danger flex items-center justify-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-danger animate-ping" />
                  Recording... Tap to Stop & Parse
                </span>
              ) : isProcessing ? (
                <span className="text-primary flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {processingStatus}
                </span>
              ) : (
                <span>Tap microphone to start speaking</span>
              )}
            </p>
          </div>

          {/* Manual Entry Button if in Data Mode */}
          {mode === 'data' && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setIsManualDataEntry(true)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-text text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer hover:border-primary/50 shadow-sm"
              >
                <Edit3 className="w-3.5 h-3.5 text-primary" />
                <span>Enter Manually Without Voice</span>
              </button>
            </div>
          )}

          {recorder.errorMessage && (
            <div className="p-2.5 sm:p-3 rounded-xl bg-danger/15 border border-danger/30 text-danger text-xs flex items-center gap-2 max-w-md">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{recorder.errorMessage}</span>
            </div>
          )}

          {/* Helper Tips */}
          <div className="pt-2 text-[11px] sm:text-xs text-textSubtle max-w-lg leading-relaxed px-2">
            {mode === 'expense' && (
              <p>
                💡 <span className="font-semibold text-text">Try speaking:</span> "Purchased carrots for ₹50, onions for ₹100 via PhonePe and had pizza for ₹300 using credit card."
              </p>
            )}
            {mode === 'receipt' && (
              <p>
                💡 <span className="font-semibold text-text">Try speaking:</span> "Basmati rice 5 kg at 110, Sunflower oil 2 litres at 160, discount 50 rupees, GST 18 percent."
              </p>
            )}
            {mode === 'data' && voiceDataMode === 'flexible' && (
              <p>
                💡 <span className="font-semibold text-text">Try speaking:</span> "Part no 1234, date 20 August, operator Ravi. Logs: 8 to 9 AM planned 100 actual 98 reject 2."
              </p>
            )}
            {mode === 'data' && voiceDataMode === 'template' && (
              <p>
                💡 <span className="font-semibold text-text">Try speaking:</span> "Part PRT-9042, shift 1, opening counter 14200, closing 14850. Logs: 8:30 to 9:30 planned 100 produced 98 reject 2."
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Result Modals */}
      {confirmTxData && (
        <TransactionConfirmModal
          extractedData={confirmTxData}
          onClose={() => setConfirmTxData(null)}
          onSaved={() => {
            setConfirmTxData(null);
            onRefreshData();
          }}
        />
      )}

      {receiptData && (
        <ReceiptEditModal
          extractedData={receiptData}
          onClose={() => setReceiptData(null)}
          onSaved={() => {
            setReceiptData(null);
            onRefreshData();
          }}
        />
      )}

      {templateEprData && (
        <DataEntryEditModal
          extractedData={templateEprData}
          template={activeTemplate}
          onClose={() => setTemplateEprData(null)}
          onSaved={() => {
            setTemplateEprData(null);
            onRefreshData();
          }}
        />
      )}

      {flexibleEprData && (
        <DataEntryEditModal
          flexibleData={flexibleEprData}
          onClose={() => setFlexibleEprData(null)}
          onSaved={() => {
            setFlexibleEprData(null);
            onRefreshData();
          }}
        />
      )}

      {isManualDataEntry && (
        <DataEntryEditModal
          isManual={true}
          template={activeTemplate}
          flexibleData={voiceDataMode === 'flexible' ? { isFlexible: true, title: 'Manual Flexible Record', fields: [], raw_transcript: '[Manual Entry]' } : undefined}
          onClose={() => setIsManualDataEntry(false)}
          onSaved={() => {
            setIsManualDataEntry(false);
            onRefreshData();
          }}
        />
      )}

      {showTemplateManager && (
        <TemplateManagerModal
          activeTemplateId={activeTemplate.id}
          onSelectActive={(tmpl) => {
            onSelectActiveTemplate(tmpl);
            setShowTemplateManager(false);
          }}
          onClose={() => setShowTemplateManager(false)}
        />
      )}
    </>
  );
}
