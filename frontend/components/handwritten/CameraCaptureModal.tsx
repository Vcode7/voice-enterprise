'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Camera,
  RotateCcw,
  Check,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Upload,
  SwitchCamera,
  FileText,
  Sliders,
  Maximize2,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
}: CameraCaptureModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeFileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop all active tracks on stream
  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      setStream(null);
    }
  }, [stream]);

  // Enumerate video devices
  const updateDeviceList = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        // Prefer rear/environment camera if label indicates it
        const backCam = videoDevices.find((d) =>
          /back|rear|environment/i.test(d.label)
        );
        setSelectedDeviceId(backCam ? backCam.deviceId : videoDevices[0].deviceId);
      }
    } catch (err) {
      console.warn('Could not enumerate video devices:', err);
    }
  }, [selectedDeviceId]);

  // Start Camera Stream
  const startCamera = useCallback(
    async (deviceId?: string) => {
      setIsStartingCamera(true);
      setCameraError(null);

      // Stop previous stream
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Direct camera access is not supported by this browser. You can use the Native Device Camera option below.'
        );
        setIsStartingCamera(false);
        return;
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
            },
      };

      try {
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (firstErr: any) {
          // Fallback with simpler video constraints
          console.warn('HD camera constraints failed, attempting basic video:', firstErr);
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
          });
        }

        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          try {
            await videoRef.current.play();
          } catch {}
        }
        await updateDeviceList();
      } catch (err: any) {
        console.error('Camera startup error:', err);
        let msg = 'Could not access the camera. Please verify camera permissions in your browser.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Camera permission was denied. Please allow camera access in your browser settings and refresh.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = 'No camera device found on this system.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          msg = 'Camera is in use by another application or tab. Please close other camera apps and retry.';
        }
        setCameraError(msg);
      } finally {
        setIsStartingCamera(false);
      }
    },
    [stream, updateDeviceList]
  );

  // Initialize camera when modal opens
  useEffect(() => {
    if (isOpen) {
      setCapturedBlob(null);
      setCapturedDataUrl(null);
      startCamera(selectedDeviceId || undefined);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle device switch
  const handleDeviceChange = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    startCamera(newDeviceId);
  };

  // Capture Snapshot
  const handleCaptureSnapshot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    // Trigger flash animation
    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 200);

    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setCapturedDataUrl(url);

        // Pause video playback while reviewing
        try {
          video.pause();
        } catch {}
      },
      'image/jpeg',
      0.95
    );
  };

  // Retake photo
  const handleRetake = () => {
    if (capturedDataUrl) {
      URL.revokeObjectURL(capturedDataUrl);
    }
    setCapturedBlob(null);
    setCapturedDataUrl(null);
    if (videoRef.current && stream) {
      try {
        videoRef.current.play();
      } catch {}
    } else {
      startCamera(selectedDeviceId || undefined);
    }
  };

  // Confirm photo and send to OCR pipeline
  const handleConfirmPhoto = () => {
    if (!capturedBlob) return;
    const filename = `handwriting_capture_${Date.now()}.jpg`;
    const file = new File([capturedBlob], filename, { type: 'image/jpeg' });
    stopStream();
    onCapture(file);
    onClose();
  };

  // Native file input fallback handler (for mobile camera or file picker)
  const handleNativeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      stopStream();
      onCapture(file);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-card border border-primary/30 shadow-2xl shadow-black/40 overflow-hidden">
        {/* Hidden Canvas for High-Resolution Capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Hidden Fallback Native File Input */}
        <input
          ref={nativeFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={handleNativeFileChange}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cardBorder bg-surface shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shadow-sm">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text flex items-center gap-2">
                <span>Capture Document with Camera</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                  Live OCR Camera
                </span>
              </h2>
              <p className="text-[11px] text-textSubtle">
                Frame your handwritten sheet inside the guidelines for best accuracy
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="p-1.5 rounded-lg text-textSubtle hover:text-text hover:bg-surfaceMuted transition cursor-pointer"
            title="Close camera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewfinder Body */}
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[340px] sm:min-h-[420px]">
          {/* Shutter Flash Animation */}
          {isFlashActive && (
            <div className="absolute inset-0 bg-white z-40 animate-out fade-out duration-200 pointer-events-none" />
          )}

          {/* Mode A: Live Video Stream Viewfinder */}
          {!capturedDataUrl && !cameraError && (
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain max-h-[58vh]"
              />

              {/* Document Alignment Viewfinder Overlay */}
              <div className="absolute inset-4 sm:inset-8 pointer-events-none flex flex-col justify-between border border-primary/30 rounded-xl">
                {/* Corner Crosshairs */}
                <div className="flex justify-between">
                  <div className="w-8 h-8 border-t-2 border-l-2 border-primary rounded-tl-lg" />
                  <div className="w-8 h-8 border-t-2 border-r-2 border-primary rounded-tr-lg" />
                </div>

                {/* Center Target Hint */}
                <div className="text-center py-2">
                  <span className="text-[11px] font-medium text-primary bg-black/70 px-3 py-1 rounded-full border border-primary/30 backdrop-blur-sm shadow-md">
                    Align document edges with corners
                  </span>
                </div>

                {/* Bottom Crosshairs */}
                <div className="flex justify-between">
                  <div className="w-8 h-8 border-b-2 border-l-2 border-primary rounded-bl-lg" />
                  <div className="w-8 h-8 border-b-2 border-r-2 border-primary rounded-br-lg" />
                </div>
              </div>

              {/* Live Badge in top corner */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/80 border border-emerald-500/40 text-[10px] font-mono text-emerald-400 font-bold backdrop-blur-sm shadow-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>LIVE FEED</span>
              </div>
            </div>
          )}

          {/* Mode B: Snapped Image Review Viewfinder */}
          {capturedDataUrl && (
            <div className="relative w-full h-full flex items-center justify-center p-2 bg-black">
              <img
                src={capturedDataUrl}
                alt="Captured handwritten document"
                className="w-full h-full object-contain max-h-[58vh] rounded-lg shadow-2xl border border-cardBorder"
              />
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surfaceMuted border border-primary/30 text-[11px] font-mono text-primary font-bold backdrop-blur-sm shadow-lg">
                <Check className="w-3.5 h-3.5 text-primary" />
                <span>PHOTO CAPTURED</span>
              </div>
            </div>
          )}

          {/* Camera Error / Permission Denied State */}
          {cameraError && (
            <div className="p-6 text-center max-w-md space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto shadow-lg">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">Camera Unavailable</h3>
                <p className="text-xs text-textSubtle mt-1.5 leading-relaxed">{cameraError}</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => startCamera(selectedDeviceId || undefined)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted text-text border border-cardBorder text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => nativeFileInputRef.current?.click()}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Use Device Camera / File</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Loading Spinner */}
          {isStartingCamera && !cameraError && (
            <div className="absolute inset-0 bg-background/90 flex flex-col items-center justify-center space-y-3 z-30">
              <RefreshCw className="w-7 h-7 text-primary animate-spin" />
              <p className="text-xs font-semibold text-text">Initializing Camera Stream...</p>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 border-t border-cardBorder bg-surface flex items-center justify-between gap-3 shrink-0 flex-wrap">
          {/* Left: Camera Selection Dropdown (if multiple cameras available) */}
          <div className="flex items-center gap-2">
            {availableDevices.length > 1 && !capturedDataUrl && (
              <div className="flex items-center gap-1.5">
                <SwitchCamera className="w-3.5 h-3.5 text-textSubtle" />
                <select
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-background border border-cardBorder text-[11px] text-text font-medium focus:border-primary focus:outline-none cursor-pointer max-w-[170px] truncate"
                >
                  {availableDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Fallback button to device camera input */}
            {!capturedDataUrl && (
              <button
                type="button"
                onClick={() => nativeFileInputRef.current?.click()}
                className="text-[11px] text-textSubtle hover:text-primary underline transition cursor-pointer"
              >
                Use Native Phone App
              </button>
            )}
          </div>

          {/* Right: Capture Shutter / Action Buttons */}
          <div className="flex items-center gap-2.5 ml-auto">
            {!capturedDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    stopStream();
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-textMuted hover:text-text border border-cardBorder text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={isStartingCamera || !!cameraError}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-primary/20 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
                >
                  <div className="w-4 h-4 rounded-full border-2 border-white flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <span>Capture Photo</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-text border border-cardBorder text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retake</span>
                </button>

                <button
                  type="button"
                  onClick={handleConfirmPhoto}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/25 transition cursor-pointer transform active:scale-95"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Process with Handwriting OCR</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
