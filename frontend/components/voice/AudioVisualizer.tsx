'use client';

import React from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  volumeLevel: number;
}

export function AudioVisualizer({ isRecording, volumeLevel }: AudioVisualizerProps) {
  const bars = 16;

  return (
    <div className="flex items-center justify-center space-x-1.5 h-12 my-2">
      {Array.from({ length: bars }).map((_, i) => {
        // Calculate dynamic height based on volume level and index
        const multiplier = Math.sin((i / (bars - 1)) * Math.PI);
        const dynamicHeight = isRecording
          ? Math.max(6, Math.min(44, (volumeLevel * 50 + Math.random() * 12) * multiplier))
          : 4;

        return (
          <div
            key={i}
            className="w-1.5 rounded-full transition-all duration-75"
            style={{
              height: `${dynamicHeight}px`,
              backgroundColor: isRecording
                ? i % 2 === 0
                  ? '#6366F1'
                  : '#EF4444'
                : '#334155',
            }}
          />
        );
      })}
    </div>
  );
}
