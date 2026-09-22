'use client';

import React, { useState } from 'react';
import { X, Mic, Square, Sparkles, Loader2 } from 'lucide-react';
import { useWebAudioRecorder } from '@/hooks/useWebAudioRecorder';
import { AudioVisualizer } from '../voice/AudioVisualizer';
import { formatCurrency } from '@/lib/utils/currencyFormatter';
import { isThisMonth } from '@/lib/utils/dateUtils';
import { Transaction } from '@/types';
import { apiUrl } from '@/lib/api/apiClient';

interface AskAIModalProps {
  onClose: () => void;
}

export function AskAIModal({ onClose }: AskAIModalProps) {
  const recorder = useWebAudioRecorder();
  const [transcript, setTranscript] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRecordToggle = async () => {
    if (recorder.state === 'Recording') {
      const blob = await recorder.stopRecording();
      if (!blob) return;

      try {
        setLoading(true);
        recorder.setState('Transcribing');

        const formData = new FormData();
        formData.append('file', blob, 'query.webm');

        const transcribeRes = await fetch(apiUrl('/api/groq/transcribe'), {
          method: 'POST',
          body: formData,
        });

        if (!transcribeRes.ok) throw new Error('Transcription failed.');
        const { text } = await transcribeRes.json();
        setTranscript(text);

        recorder.setState('Understanding');
        const queryRes = await fetch(apiUrl('/api/groq/query'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: text }),
        });

        const parsedQuery = await queryRes.json();

        // Deterministic local computation from API
        const txRes = await fetch(apiUrl('/api/transactions'));
        const allTransactions: Transaction[] = await txRes.json();

        let computedAnswer = '';

        if (parsedQuery.queryType === 'category_total' && parsedQuery.category) {
          const categoryTx = allTransactions.filter(
            (t) =>
              (t.category || '').toLowerCase() === parsedQuery.category?.toLowerCase() &&
              t.transactionType === 'expense' &&
              isThisMonth(t.date)
          );
          const total = categoryTx.reduce((sum, t) => sum + t.amount, 0);
          computedAnswer = `You spent ${formatCurrency(total)} on ${parsedQuery.category} this month across ${categoryTx.length} transactions.`;
        } else if (parsedQuery.queryType === 'biggest_expense') {
          const expenses = allTransactions.filter((t) => t.transactionType === 'expense' && isThisMonth(t.date));
          if (expenses.length === 0) {
            computedAnswer = 'No expenses recorded this month yet.';
          } else {
            const maxTx = expenses.reduce((max, t) => (t.amount > max.amount ? t : max), expenses[0]);
            computedAnswer = `Your biggest expense this month was ${formatCurrency(maxTx.amount)} at ${maxTx.merchant || maxTx.category || 'Merchant'}.`;
          }
        } else if (parsedQuery.queryType === 'payment_method_total') {
          const methodTx = allTransactions.filter((t) =>
            (t.paymentMethod || '').toLowerCase().includes((parsedQuery.paymentMethod || '').toLowerCase())
          );
          const total = methodTx.reduce((sum, t) => sum + t.amount, 0);
          computedAnswer = `Total spent using ${parsedQuery.paymentMethod || 'this method'} is ${formatCurrency(total)}.`;
        } else {
          const monthly = allTransactions.filter((t) => isThisMonth(t.date) && t.transactionType === 'expense');
          const total = monthly.reduce((sum, t) => sum + t.amount, 0);
          computedAnswer = `Your total expenses for this month stand at ${formatCurrency(total)}.`;
        }

        setAnswer(computedAnswer);
      } catch (err: any) {
        setAnswer(err.message || 'Could not process financial query.');
      } finally {
        setLoading(false);
        recorder.resetRecorder();
      }
    } else {
      await recorder.startRecording();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-card border border-cardBorder rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-cardBorder flex items-center justify-between bg-surface">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primaryDark to-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-text">Ask Voice Finance AI</h3>
              <p className="text-[11px] text-textMuted">Natural speech financial analytics</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-textMuted hover:text-text hover:bg-surfaceMuted transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 flex flex-col items-center text-center space-y-3.5 sm:space-y-4 overflow-y-auto">
          <p className="text-[11px] sm:text-xs text-textMuted max-w-sm">
            Ask natural questions like <span className="text-text font-medium">"How much did I spend on groceries this month?"</span>
          </p>

          <AudioVisualizer isRecording={recorder.state === 'Recording'} volumeLevel={recorder.volumeLevel} />

          {/* Record Button */}
          <button
            onClick={handleRecordToggle}
            disabled={loading}
            className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full flex items-center justify-center transition-all shadow-xl cursor-pointer ${
              recorder.state === 'Recording'
                ? 'bg-danger text-white animate-pulse-mic shadow-danger/30'
                : 'bg-primary hover:bg-primaryDark text-white shadow-primary/25 hover:scale-105 active:scale-95'
            }`}
          >
            {recorder.state === 'Recording' ? (
              <Square className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
            ) : (
              <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
            )}
          </button>

          <p className="text-xs font-semibold text-textSubtle">
            {recorder.state === 'Recording'
              ? `Listening (${recorder.durationSeconds}s)... Tap to Stop`
              : loading
              ? 'Analyzing database...'
              : 'Tap microphone to speak'}
          </p>

          {loading && <Loader2 className="w-5 h-5 text-primary animate-spin" />}

          {/* Results */}
          {transcript && (
            <div className="w-full text-left p-3 rounded-xl bg-surface border border-cardBorder space-y-1">
              <span className="text-[10px] font-bold uppercase text-textSubtle tracking-wider">You Asked:</span>
              <p className="text-xs text-text font-medium italic">"{transcript}"</p>
            </div>
          )}

          {answer && (
            <div className="w-full text-left p-3.5 sm:p-4 rounded-xl bg-surface border border-primary/30 space-y-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-primary font-bold text-xs">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Answer:</span>
              </div>
              <p className="text-xs sm:text-sm font-semibold text-text leading-relaxed">{answer}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-cardBorder bg-surface flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
