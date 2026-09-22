'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { RecordingState } from '@/types';

export interface UseWebAudioRecorderReturn {
  state: RecordingState;
  durationSeconds: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  errorMessage: string | null;
  volumeLevel: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  resetRecorder: () => void;
  setState: (state: RecordingState) => void;
  setErrorMessage: (msg: string | null) => void;
}

export const useWebAudioRecorder = (): UseWebAudioRecorderReturn => {
  const [state, setState] = useState<RecordingState>('Ready');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setVolumeLevel(0);
  };

  useEffect(() => {
    return () => cleanupStream();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      cleanupStream();
      setErrorMessage(null);
      setAudioBlob(null);
      setAudioUrl(null);
      setDurationSeconds(0);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioContext = new AudioCtx();
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const updateVolume = () => {
            if (!streamRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
            const avg = sum / bufferLength / 255;
            setVolumeLevel(Math.min(1, avg * 1.8));
            animationFrameRef.current = requestAnimationFrame(updateVolume);
          };
          updateVolume();
        }
      } catch (e) {
        console.warn('Web Audio visualizer could not be initialized:', e);
      }

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setState('Recording');

      timerRef.current = setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('[WebAudioRecorder] Error:', err);
      setErrorMessage(err.message || 'Microphone access denied or unavailable.');
      setState('Error');
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        resolve(null);
        return;
      }

      setState('Processing');
      mediaRecorderRef.current.onstop = () => {
        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        cleanupStream();
        resolve(blob);
      };

      mediaRecorderRef.current.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    cleanupStream();
    setDurationSeconds(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setState('Ready');
  }, []);

  const resetRecorder = useCallback(() => {
    cleanupStream();
    setDurationSeconds(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setErrorMessage(null);
    setState('Ready');
  }, []);

  return {
    state,
    durationSeconds,
    audioBlob,
    audioUrl,
    errorMessage,
    volumeLevel,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecorder,
    setState,
    setErrorMessage,
  };
};
