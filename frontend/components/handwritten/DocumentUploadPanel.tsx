'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import {
  Upload,
  FileText,
  Camera,
  Sparkles,
  Layers,
  Settings,
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  FileSpreadsheet,
  RefreshCw,
  Cpu,
  ArrowRight,
  Edit3,
  Copy,
  Check,
  Zap,
  Search,
  ChevronDown,
  ChevronUp,
  Database,
  Sliders,
  Eye,
  Plus,
  ZoomIn,
} from 'lucide-react';
import {
  DataTemplate,
  OcrPageResult,
  ModelVariantType,
  OcrCheckpointInfo,
  LookupTable,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  ExtractionMethodType,
  ChandraModeType,
  ChandraQuantizationType,
  ChandraLoadingMethodType,
  OllamaVisionModel,
  OllamaGenerationOptions,
} from '@/types';
import { calculateColumnTotals } from '@/lib/utils/tableTotals';
import { getTableColumnMinWidthPx } from '@/lib/utils/tableColumnWidth';
import { CameraCaptureModal } from './CameraCaptureModal';

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

interface DocumentUploadPanelProps {
  dataMode: 'template' | 'flexible';
  onModeChange: (mode: 'template' | 'flexible') => void;
  activeTemplate: DataTemplate;
  onChangeTemplate: () => void;
  templatesCount: number;
  lookupTables?: LookupTable[];
  // Dedicated Handwriting Scanning Template
  handwritingTemplate?: HandwritingScanningTemplate;
  allTemplates?: HandwritingScanningTemplate[];
  onSelectTemplate?: (templateId: string) => void;
  onCreateTemplate?: () => void;
  onOpenTemplateConfig?: () => void;
  onOpenReviewModal?: () => void;
  extractedResult?: HandwritingExtractionApiResponse | null;
  // Extraction Pipeline Selection
  extractionMethod?: ExtractionMethodType;
  onExtractionMethodChange?: (method: ExtractionMethodType) => void;
  chandraMode?: ChandraModeType;
  onChandraModeChange?: (mode: ChandraModeType) => void;
  chandraUpscale?: boolean;
  onChandraUpscaleChange?: (upscale: boolean) => void;
  chandraQuantization?: ChandraQuantizationType;
  onChandraQuantizationChange?: (quantization: ChandraQuantizationType) => void;
  // Chandra Loading Method Option (Local vs Ollama)
  chandraLoadingMethod?: ChandraLoadingMethodType;
  onChandraLoadingMethodChange?: (method: ChandraLoadingMethodType) => void;
  chandraOllamaModel?: string;
  onChandraOllamaModelChange?: (model: string) => void;
  availableOllamaModels?: string[];
  loadingOllamaModels?: boolean;
  // Ollama Vision Model Selection
  selectedOllamaModel?: string;
  onOllamaModelChange?: (model: string) => void;
  ollamaModels?: OllamaVisionModel[];
  isOllamaOnline?: boolean;
  onRefreshOllamaModels?: () => void;
  ollamaOptions?: OllamaGenerationOptions;
  onOllamaOptionsChange?: (options: OllamaGenerationOptions) => void;
  // Model Variant Selection
  modelVariant: ModelVariantType;
  onModelVariantChange: (variant: ModelVariantType) => void;
  availableCheckpoints: OcrCheckpointInfo[];
  selectedCheckpointId: string;
  onCheckpointChange: (checkpointId: string) => void;
  // Pipeline State
  pipelineStage: 'upload' | 'ocr_running' | 'ocr_review' | 'llm_running';
  processingStatus: string;
  errorMessage?: string | null;
  // Uploaded Files / Pages
  uploadedFile: File | null;
  isPdf: boolean;
  ocrPages: OcrPageResult[];
  activePageIndex: number;
  engineUsed?: string;
  lastExtractedCount?: number;
  // Handlers
  onFileSelected: (file: File) => void;
  onClearUploadedFile: () => void;
  onSelectActivePage: (index: number) => void;
  onUpdatePageOcrText: (pageIndex: number, newText: string) => void;
  onRerunOcr: () => void;
  onReExtractFields?: () => void;
  onLoadSample: (sampleType: 'shift_log' | 'parts_sheet' | 'flexible_notes') => void;
  onOpenCamera?: () => void;
}

export function DocumentUploadPanel({
  dataMode,
  onModeChange,
  activeTemplate,
  onChangeTemplate,
  templatesCount,
  lookupTables,
  handwritingTemplate,
  allTemplates = [],
  onSelectTemplate,
  onCreateTemplate,
  onOpenTemplateConfig,
  onOpenReviewModal,
  extractedResult,
  extractionMethod = 'gemini',
  onExtractionMethodChange,
  chandraMode = 'full_image',
  onChandraModeChange,
  chandraUpscale = false,
  onChandraUpscaleChange,
  chandraQuantization = '3-bit',
  onChandraQuantizationChange,
  chandraLoadingMethod = 'ollama',
  onChandraLoadingMethodChange,
  chandraOllamaModel = 'chandra',
  onChandraOllamaModelChange,
  availableOllamaModels = [],
  loadingOllamaModels = false,
  selectedOllamaModel,
  onOllamaModelChange,
  ollamaModels = [],
  isOllamaOnline = true,
  onRefreshOllamaModels,
  ollamaOptions,
  onOllamaOptionsChange,
  modelVariant,
  onModelVariantChange,
  availableCheckpoints,
  selectedCheckpointId,
  onCheckpointChange,
  pipelineStage,
  processingStatus,
  errorMessage,
  uploadedFile,
  isPdf,
  ocrPages,
  activePageIndex,
  engineUsed = 'TrOCR Large Handwritten',
  lastExtractedCount,
  onFileSelected,
  onClearUploadedFile,
  onSelectActivePage,
  onUpdatePageOcrText,
  onRerunOcr,
  onReExtractFields,
  onLoadSample,
  onOpenCamera,
}: DocumentUploadPanelProps) {

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);

  const handleTriggerCamera = () => {
    if (onOpenCamera) {
      onOpenCamera();
    } else {
      setIsCameraModalOpen(true);
    }
  };

  // Auto-Fill Lookup Tester state
  const [showLookupTester, setShowLookupTester] = useState(false);
  const [hwTestValue, setHwTestValue] = useState('');
  const [hwTestResult, setHwTestResult] = useState<{
    tested: boolean;
    found: boolean;
    canonicalValue?: string;
    matchedRow?: Record<string, any>;
    autoFilledFields?: Array<{ fieldName: string; fieldKey: string; tableColumn: string; value: string }>;
    error?: string;
  } | null>(null);

  const isOcrRunning = pipelineStage === 'ocr_running';
  const isLlmRunning = pipelineStage === 'llm_running';
  const isProcessing = isOcrRunning || isLlmRunning;

  const currentLookupTable = lookupTables?.find(
    (t) => t.id === activeTemplate.lookupConfig?.tableId
  );

  const runHwLookupTest = (val?: string) => {
    const query = (val !== undefined ? val : hwTestValue).trim();
    if (!query) {
      setHwTestResult(null);
      return;
    }
    if (!currentLookupTable || !currentLookupTable.rows || currentLookupTable.rows.length === 0) {
      setHwTestResult({ tested: true, found: false, error: 'No master table rows loaded to search.' });
      return;
    }
    const mainCol = activeTemplate.lookupConfig?.mainTableColumn || '';
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQuery = normalize(query);

    const matchedRow = currentLookupTable.rows.find((row) => {
      const rowVal = String(row[mainCol] || '').trim();
      if (!rowVal) return false;
      if (rowVal.toLowerCase() === query.toLowerCase()) return true;
      if (normalize(rowVal) === normQuery) return true;
      return false;
    });

    if (matchedRow) {
      const canonicalVal = String(matchedRow[mainCol] || query);
      const autoFilled = (activeTemplate.lookupConfig?.fieldMappings || []).map((m) => {
        const targetField = activeTemplate.fields.find((f) => f.extractionKey === m.fieldKey);
        const colVal = matchedRow[m.tableColumn] !== undefined ? String(matchedRow[m.tableColumn]) : '';
        return {
          fieldName: targetField?.name || m.fieldKey,
          fieldKey: m.fieldKey,
          tableColumn: m.tableColumn,
          value: colVal,
        };
      });

      setHwTestResult({
        tested: true,
        found: true,
        canonicalValue: canonicalVal,
        matchedRow,
        autoFilledFields: autoFilled,
      });
    } else {
      setHwTestResult({
        tested: true,
        found: false,
        error: `No matching record for "${query}" in master table "${currentLookupTable.name}".`,
      });
    }
  };

  const validateAndSelectFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.includes(ext) || ALLOWED_MIME_TYPES.includes(file.type);

    if (!isAllowed) {
      alert('Invalid file format. Supported formats: PDF, JPG, JPEG, and PNG only.');
      return;
    }

    onFileSelected(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSelectFile(e.target.files[0]);
    }
  };

  const handleCopyOcrText = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const activePage = ocrPages[activePageIndex] || ocrPages[0];



  const getPipelineBadge = () => {
    const methodTag = chandraLoadingMethod === 'ollama' ? 'Ollama API' : `${chandraQuantization}`;
    return `🪐 Chandra V2 (${chandraMode === 'full_image' ? 'Full Image' : 'Detected Region'} • ${methodTag})`;
  };

  const getPipelineHeaderColor = () => {
    return { dot: 'bg-primary', badge: 'bg-primary/15 text-primary' };
  };

  const getRerunLabel = () => {
    return 'Re-run Chandra V2 OCR';
  };

  const headerColors = getPipelineHeaderColor();

  return (
    <div className="bg-card border border-cardBorder rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Console Header */}
      <div className="flex items-center justify-between border-b border-cardBorder/60 pb-3">
        <div className="flex items-center space-x-2">
          <div className={`w-2.5 h-2.5 rounded-full ${headerColors.dot} animate-pulse`} />
          <h2 className="text-sm font-bold text-text uppercase tracking-wider">
            Handwriting Scanner & Auto-Fill
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold truncate max-w-[240px] ${headerColors.badge}`}
          >
            {getPipelineBadge()}
          </span>
          <Link
            href="/settings"
            className="p-1 rounded-lg hover:bg-surface text-textSubtle hover:text-primary transition"
            title="Configure Vision Engine in Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Mode Selector Tabs */}
      <div>
        <label className="text-[11px] font-bold text-textSubtle uppercase tracking-wider block mb-1.5">
          Extraction Mode
        </label>
        <div className="grid grid-cols-2 gap-2 bg-surface p-1.5 rounded-xl border border-cardBorder">
          <button
            type="button"
            onClick={() => onModeChange('template')}
            disabled={isProcessing}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
              dataMode === 'template'
                ? 'bg-primary text-white shadow-md font-extrabold'
                : 'text-textMuted hover:text-text hover:bg-surfaceMuted'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>📑 Template Mode</span>
          </button>

          <button
            type="button"
            onClick={() => onModeChange('flexible')}
            disabled={isProcessing}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
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

      {/* 3. Dedicated Handwriting Scanning Template Bar */}
      {dataMode === 'template' && (
        <div className="p-3.5 rounded-xl bg-surface border border-cardBorder space-y-2.5 shadow-sm">
          {/* Row 1: Template Name (Left) & Configure Button (Right) */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[11px] font-bold text-textSubtle uppercase tracking-wider shrink-0">
                Template:
              </span>
              {allTemplates && allTemplates.length > 0 ? (
                <select
                  value={handwritingTemplate?.id}
                  onChange={(e) => onSelectTemplate?.(e.target.value)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded-lg bg-card border border-cardBorder text-xs font-bold text-text focus:outline-none focus:border-primary w-full max-w-[280px] truncate shadow-sm cursor-pointer"
                >
                  {allTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <h3 className="text-xs font-bold text-text truncate">
                  {handwritingTemplate?.name || 'Handwriting Scanning Template'}
                </h3>
              )}
            </div>

            {onOpenTemplateConfig && (
              <button
                type="button"
                onClick={onOpenTemplateConfig}
                disabled={isProcessing}
                className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-sm shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Configure</span>
              </button>
            )}
          </div>

          {/* Row 2: Template Field Count (Left) & Add Template Button (Right) */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-mono font-bold flex items-center gap-1.5">
                <span>{handwritingTemplate?.fields?.length || 16} Fields</span>
                <span>•</span>
                <span>
                  {handwritingTemplate?.tables && handwritingTemplate.tables.length > 0
                    ? `${handwritingTemplate.tables.length} Tables`
                    : `${handwritingTemplate?.table_columns?.length || 5} Table Cols`}
                </span>
              </span>

              {handwritingTemplate && (
                <span className="text-[10px] text-textMuted font-mono">
                  ({handwritingTemplate.fields.filter((f) => f.value_type === 'h').length} Handwritten ✍️ •{' '}
                  {handwritingTemplate.fields.filter((f) => f.value_type === 'd').length} Digital 🖨️)
                </span>
              )}
            </div>

            {onCreateTemplate && (
              <button
                type="button"
                onClick={onCreateTemplate}
                disabled={isProcessing}
                className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-sm shrink-0"
                title="Add a new template"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Template</span>
              </button>
            )}
          </div>

          {/* Clean Summary Badges for Tables if present */}
          {handwritingTemplate && handwritingTemplate.tables && handwritingTemplate.tables.length > 0 && (
            <div className="pt-2 border-t border-cardBorder/50 flex flex-wrap items-center gap-2 text-xs">
              {handwritingTemplate.tables.map((tbl, tIdx) => (
                <div
                  key={tbl.id || tIdx}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surfaceMuted border border-cardBorder"
                >
                  <span className="text-primary font-bold text-[11px]">{tbl.name}:</span>
                  <span className="font-bold text-text font-mono text-[11px]">{tbl.columns.length} Cols</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hidden File Inputs (PDF, JPG, JPEG, PNG) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={handleInputChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="hidden"
        onChange={handleInputChange}
      />

      {/* STAGE 0: Dual Action Cards — Upload File OR Capture with Camera */}
      {pipelineStage === 'upload' && !uploadedFile && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* OPTION 1: Upload File (PDF / Images) */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-between space-y-3.5 group ${
                dragActive
                  ? 'border-primary bg-surfaceMuted scale-[1.01] shadow-lg shadow-primary/20'
                  : 'border-cardBorder hover:border-primary/50 bg-surface hover:bg-surfaceMuted/80 shadow-sm'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-primary/15 text-primary flex items-center justify-center border border-primary/30 shadow-md shadow-primary/20 group-hover:scale-105 group-hover:bg-primary/20 transition">
                <Upload className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <span className="text-xs font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary transition flex items-center justify-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  <span>Upload File / PDF</span>
                </span>
                <p className="text-[11px] text-textSubtle leading-relaxed">
                  Drag &amp; drop or browse <strong>PDF</strong>, <strong>JPG</strong>, <strong>PNG</strong>
                </p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="w-full py-2 px-3 rounded-xl bg-surface hover:bg-surfaceMuted text-primary border border-cardBorder text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm group-hover:border-primary/50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Browse Files</span>
              </button>
            </div>

            {/* OPTION 2: Capture with Camera */}
            <div
              onClick={handleTriggerCamera}
              className="border-2 border-dashed border-cardBorder hover:border-primary/50 bg-surface hover:bg-surfaceMuted/80 rounded-2xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-between space-y-3.5 group shadow-sm"
            >
              <div className="w-12 h-12 rounded-2xl bg-primary/15 text-primary dark:text-primary flex items-center justify-center border border-primary/30 shadow-md shadow-primary/20 group-hover:scale-105 group-hover:bg-primary/20 transition">
                <Camera className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <span className="text-xs font-bold text-text group-hover:text-primary dark:group-hover:text-primary transition flex items-center justify-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-primary dark:text-primary" />
                  <span>Capture with Camera</span>
                </span>
                <p className="text-[11px] text-textSubtle leading-relaxed">
                  Use live webcam or mobile camera to scan physical sheet
                </p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTriggerCamera();
                }}
                className="w-full py-2 px-3 rounded-xl bg-surfaceMuted hover:bg-surface text-primary border border-cardBorder dark:bg-primary/10 dark:hover:bg-primary/20 dark:border-primary/30 dark:text-primary text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm group-hover:border-primary/50"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Open Live Camera</span>
              </button>
            </div>
          </div>

          <div className="text-center pt-0.5">
            <span className="text-[10px] text-textSubtle">
              Both uploaded files and camera captures process automatically through Chandra 2 OCR and LLM auto-fill
            </span>
          </div>
        </div>
      )}

      {/* STAGE 1 (RUNNING): Extraction Progress Stepper */}
      {isOcrRunning && (
        <div
          className={`p-4 bg-surface rounded-2xl border space-y-3 animate-pulse ${headerColors.badge.split(' ')[2] || 'border-cardBorder'}`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex items-center gap-2 font-bold text-xs ${headerColors.badge.split(' ')[1] || 'text-text'}`}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {processingStatus ||
                  (extractionMethod === 'gemini'
                    ? 'Analyzing document directly with Gemini 2.5 Flash...'
                    : extractionMethod === 'paddleocr_vl'
                    ? 'Extracting document locally with PaddleOCR-VL 1.6...'
                    : extractionMethod === 'ollama_vision'
                    ? `Extracting document with Ollama Vision (${selectedOllamaModel || 'qwen2.5vl:7b'})...`
                    : 'Extracting handwriting with TrOCR...')}
              </span>
            </div>
            <span className={`text-[10px] font-mono font-bold ${headerColors.badge.split(' ')[1] || 'text-text'}`}>
              {extractionMethod === 'gemini' || extractionMethod === 'ollama_vision'
                ? 'Multimodal Extraction'
                : 'Local OCR Extraction'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-surfaceMuted border border-cardBorder text-xs text-textMuted space-y-1">
            <div className="flex justify-between text-[11px]">
              <span>Document:</span>
              <span className="text-text font-bold truncate max-w-[200px]">{uploadedFile?.name || 'Document'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span>Pipeline:</span>
              <span className={`font-mono font-semibold ${headerColors.badge.split(' ')[1] || 'text-text'}`}>
                {getPipelineBadge()}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span>Document Type:</span>
              <span className="font-semibold text-textSubtle">
                {isPdf ? 'PDF Document' : 'Single Image'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 2 & 3: Immediate OCR Extracted Output + Automated LLM Field Filling */}
      {ocrPages.length > 0 && (
        <div className="p-4 rounded-2xl bg-surface border border-cardBorder space-y-3.5 shadow-lg">
          {/* Header & Status Indicator */}
          <div className="flex items-center justify-between pb-2 border-b border-cardBorder/60 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-mono font-bold text-xs">
                ✓
              </span>
              <div>
                <h3 className="text-xs font-bold text-text flex items-center gap-1.5">
                  <span>OCR Extracted Text ({ocrPages.length} {ocrPages.length === 1 ? 'Page' : 'Pages'})</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-surfaceMuted text-primary border border-cardBorder font-semibold">
                    Live Output
                  </span>
                </h3>
                <p className="text-[10px] text-textSubtle">
                  {isPdf ? 'Each page automatically forms a separate entry.' : 'Image recognized as 1 structured record.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="px-2.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                title="Upload another document"
              >
                <Upload className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Upload New</span>
              </button>

              <button
                type="button"
                onClick={handleTriggerCamera}
                disabled={isProcessing}
                className="px-2.5 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                title="Capture another sheet with camera"
              >
                <Camera className="w-3.5 h-3.5 text-primary dark:text-primary" />
                <span className="hidden sm:inline">Camera</span>
              </button>

              {onOpenReviewModal && (
                <button
                  type="button"
                  onClick={onOpenReviewModal}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-primary/20 transition cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Review &amp; Edit</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClearUploadedFile}
                disabled={isProcessing}
                className="p-1 rounded-lg text-textSubtle hover:text-danger hover:bg-surfaceMuted transition cursor-pointer disabled:opacity-50"
                title="Clear current document"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Parallel Automatic LLM Progress Banner */}
          {isLlmRunning && (
            <div className="p-3 bg-surface border border-cardBorder dark:bg-primary/10 dark:border-primary/30 text-text rounded-xl flex items-center justify-between gap-2 animate-pulse">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <span>⚡ OCR complete! Automatically structuring & filling template fields with LLM...</span>
              </div>
              <span className="text-[10px] font-mono text-primary/80 font-bold shrink-0">
                Stage 2: LLM Auto-Fill
              </span>
            </div>
          )}

          {/* Success Banner when Structuring is Done */}
          {!isLlmRunning && pipelineStage === 'ocr_review' && (
            <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-500/40 dark:text-emerald-300 rounded-xl flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>✓ OCR output recognized & fields automatically filled in session list!</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400/80">Auto-Filled</span>
            </div>
          )}

          {/* Multi-Page Tabs if PDF */}
          {ocrPages.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {ocrPages.map((page, idx) => (
                <button
                  key={page.pageNumber}
                  type="button"
                  onClick={() => onSelectActivePage(idx)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 shrink-0 cursor-pointer ${
                    activePageIndex === idx
                      ? 'bg-primary text-white shadow-md font-extrabold'
                      : 'bg-surface hover:bg-surfaceMuted text-textMuted hover:text-text border border-cardBorder'
                  }`}
                >
                  <span>Page {page.pageNumber}</span>
                  <span className="text-[9px] opacity-70 font-mono">({page.ocrText.length} chars)</span>
                </button>
              ))}
            </div>
          )}

          {/* Active Page OCR Text Area */}
          {activePage && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 text-primary font-bold">
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>
                    {ocrPages.length > 1 ? `Page ${activePage.pageNumber} Extracted OCR Text` : 'Extracted OCR Text'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-textSubtle font-mono">
                    {activePage.ocrText.length} characters
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyOcrText(activePage.ocrText, activePageIndex)}
                    className="text-[10px] text-primary hover:underline flex items-center gap-1 cursor-pointer font-semibold"
                  >
                    {copiedIndex === activePageIndex ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Editable Textarea */}
              <textarea
                rows={6}
                value={activePage.ocrText}
                onChange={(e) => onUpdatePageOcrText(activePageIndex, e.target.value)}
                placeholder="No text recognized for this page. Type or paste text here..."
                className="w-full p-2.5 bg-card border border-cardBorder focus:border-primary rounded-xl text-xs text-text font-mono focus:outline-none leading-relaxed resize-y shadow-inner"
              />

              <div className="flex items-center justify-between text-[10px] text-textSubtle pt-1">
                <span className="italic">
                  💡 OCR text is displayed immediately and processed into fields automatically.
                </span>

                {onReExtractFields && !isProcessing && (
                  <button
                    type="button"
                    onClick={onReExtractFields}
                    className="text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Re-structure fields</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Live Extracted Fields & Table Breakdown */}
          {extractedResult && (
            <div className="p-3 bg-surface rounded-xl border border-cardBorder space-y-3">
              {/* Form Fields Extracted */}
              {extractedResult.fields && extractedResult.fields.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                    <span>Extracted Form Fields</span>
                    <span className="text-[9px] text-textSubtle font-mono">
                      {extractedResult.fields.filter((f) => Boolean(f.value)).length} of{' '}
                      {extractedResult.fields.length} detected
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {extractedResult.fields.map((f, i) => (
                      <div
                        key={i}
                        className={`p-1.5 rounded-lg border text-xs flex items-center justify-between gap-1.5 ${
                          f.value
                            ? 'bg-card border-cardBorder'
                            : 'bg-card/40 border-cardBorder/40 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[10px] text-textSubtle font-bold truncate">
                            {f.field_name}:
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded font-bold shrink-0 ${
                              f.value_type === 'h'
                                ? 'bg-surfaceMuted text-primary border border-cardBorder dark:bg-primary/15 dark:text-primary dark:border-primary/30'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30'
                            }`}
                          >
                            {f.value_type === 'h' ? '✍️ TrOCR' : '🖨️ Paddle'}
                          </span>
                        </div>
                        <span className="font-bold font-mono text-primary truncate max-w-[120px]">
                          {f.value || '""'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Table Rows Extracted */}
              {extractedResult.tables && extractedResult.tables.length > 0 ? (
                <div className="space-y-3 pt-2 border-t border-cardBorder/60">
                  {extractedResult.tables.map((tbl, tIdx) => (
                    <div key={tIdx} className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                        <div className="flex items-center gap-2">
                          <span>{tbl.name || `Table ${tIdx + 1}`}</span>
                        </div>
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">
                          {tbl.rows?.length || 0} {tbl.rows?.length === 1 ? 'row' : 'rows'}
                        </span>
                      </div>
                      <div className="w-full overflow-x-auto rounded-lg border border-cardBorder scrollbar-thin scrollbar-thumb-slate-400 dark:scrollbar-thumb-slate-700 shadow-inner">
                        <table className="min-w-full w-max text-[11px] text-left border-collapse table-auto">
                          <thead className="sticky top-0 z-10 bg-surface shadow-sm">
                            <tr className="bg-surface border-b border-cardBorder text-textSubtle font-semibold">
                              {(tbl.headers || []).map((h, i) => {
                                const minPx = getTableColumnMinWidthPx(h);
                                return (
                                  <th
                                    key={i}
                                    style={{ minWidth: `${minPx}px` }}
                                    className="p-1.5 font-mono text-[10px] whitespace-nowrap text-textMuted"
                                  >
                                    {h}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {!tbl.rows || tbl.rows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={tbl.headers?.length || 1}
                                  className="p-2 text-center text-textSubtle italic text-[10px]"
                                >
                                  No entries extracted for this table.
                                </td>
                              </tr>
                            ) : (
                              tbl.rows.map((row: any, rIdx: number) => (
                                <tr
                                  key={rIdx}
                                  className="border-b border-cardBorder/40 hover:bg-surfaceMuted/50 transition"
                                >
                                  {(tbl.headers || []).map((h, cIdx) => {
                                    const minPx = getTableColumnMinWidthPx(h);
                                    const val = Array.isArray(row)
                                      ? row[cIdx]
                                      : typeof row === 'object' && row !== null
                                      ? row[h]
                                      : '';
                                    return (
                                      <td
                                        key={cIdx}
                                        style={{ minWidth: `${minPx}px` }}
                                        className="p-1.5 font-mono text-text whitespace-nowrap"
                                      >
                                        {val || <span className="text-textSubtle italic">""</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : extractedResult.table_rows && extractedResult.table_rows.length > 0 && (() => {
                const totalsInfo = calculateColumnTotals(
                  handwritingTemplate?.table_columns,
                  extractedResult.table_headers,
                  extractedResult.table_rows
                );

                return (
                  <div className="space-y-1.5 pt-2 border-t border-cardBorder/60">
                    <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                      <div className="flex items-center gap-2">
                        <span>Extracted Production Table</span>
                        {totalsInfo.hasTotals && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-mono">
                            Σ Totals Active
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">
                        {extractedResult.table_rows.length} rows • Column-aligned
                      </span>
                    </div>
                    <div className="w-full overflow-x-auto rounded-lg border border-cardBorder scrollbar-thin scrollbar-thumb-slate-400 dark:scrollbar-thumb-slate-700 shadow-inner">
                      <table className="min-w-full w-max text-[11px] text-left border-collapse table-auto">
                        <thead className="sticky top-0 z-10 bg-surface shadow-sm">
                          <tr className="bg-surface border-b border-cardBorder text-textSubtle font-semibold">
                            {extractedResult.table_headers.map((h, i) => {
                              const minPx = getTableColumnMinWidthPx(h);
                              return (
                                <th
                                  key={i}
                                  style={{ minWidth: `${minPx}px` }}
                                  className="p-1.5 font-mono text-[10px] whitespace-nowrap text-textMuted"
                                >
                                  {h}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {extractedResult.table_rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="border-b border-cardBorder/40 hover:bg-surfaceMuted/50 transition"
                            >
                              {extractedResult.table_headers.map((h, cIdx) => {
                                const minPx = getTableColumnMinWidthPx(h);
                                return (
                                  <td
                                    key={cIdx}
                                    style={{ minWidth: `${minPx}px` }}
                                    className="p-1.5 font-mono text-text whitespace-nowrap"
                                  >
                                    {row[h] || <span className="text-textSubtle italic">""</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                        {totalsInfo.hasTotals && (
                          <tfoot>
                            <tr className="bg-surface border-t-2 border-primary/30 text-[10px] font-bold">
                              {extractedResult.table_headers.map((h, cIdx) => {
                                const minPx = getTableColumnMinWidthPx(h);
                                const totalVal = totalsInfo.totals[h];
                                return (
                                  <td
                                    key={cIdx}
                                    style={{ minWidth: `${minPx}px` }}
                                    className="p-1.5 font-mono whitespace-nowrap"
                                  >
                                    {totalVal !== undefined ? (
                                      <span className="text-primary font-bold bg-surfaceMuted px-1.5 py-0.5 rounded border border-cardBorder">
                                        Σ Total: {totalVal}
                                      </span>
                                    ) : (
                                      <span className="text-textSubtle font-normal">-</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-between text-[11px] text-textSubtle pt-2 border-t border-cardBorder/60">
            <button
              type="button"
              onClick={onRerunOcr}
              disabled={isProcessing}
              className={`flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                extractionMethod === 'gemini'
                  ? 'text-textSubtle hover:text-amber-400'
                  : extractionMethod === 'paddleocr_vl'
                  ? 'text-textSubtle hover:text-emerald-400'
                  : extractionMethod === 'ollama_vision'
                  ? 'text-textSubtle hover:text-primary'
                  : 'text-textSubtle hover:text-primary'
              }`}
            >
              <RefreshCw className="w-3 h-3" />
              <span>{getRerunLabel()}</span>
            </button>

            <span
              className={`font-mono text-[9px] ${
                extractionMethod === 'gemini'
                  ? 'text-amber-300/90'
                  : extractionMethod === 'paddleocr_vl'
                  ? 'text-emerald-300/90'
                  : extractionMethod === 'ollama_vision'
                  ? 'text-primary/90'
                  : 'text-primary/80'
              }`}
            >
              {getPipelineBadge()}
            </span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-danger/15 border border-danger/30 rounded-xl text-xs text-danger flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Quick Test Sample Documents Section */}
      <div className="pt-2 border-t border-cardBorder/60 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-textSubtle uppercase tracking-wider">
            Quick Test: Load Sample Document
          </label>
          <span className="text-[10px] text-primary/80">No file upload needed</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onLoadSample('shift_log')}
            disabled={isProcessing}
            className="p-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-left transition group cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary">
              <FileSpreadsheet className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">Shift Machine Log</span>
            </div>
            <p className="text-[9px] text-textSubtle truncate mt-0.5">
              1 image = 1 auto-filled entry
            </p>
          </button>

          <button
            type="button"
            onClick={() => onLoadSample('parts_sheet')}
            disabled={isProcessing}
            className="p-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-left transition group cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary">
              <Layers className="w-3 h-3 text-primary dark:text-primary shrink-0" />
              <span className="truncate">Multi-Page PDF</span>
            </div>
            <p className="text-[9px] text-textSubtle truncate mt-0.5">
              Page-by-page auto-filled entries
            </p>
          </button>

          <button
            type="button"
            onClick={() => onLoadSample('flexible_notes')}
            disabled={isProcessing}
            className="p-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-left transition group cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary">
              <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate">Handwritten Notes</span>
            </div>
            <p className="text-[9px] text-textSubtle truncate mt-0.5">
              Dynamic flexible schema
            </p>
          </button>
        </div>
      </div>

      {/* Engine Information */}
      <div className="pt-2 border-t border-cardBorder/60">
        <button
          type="button"
          onClick={() => setShowEngineSettings((prev) => !prev)}
          className="text-[10px] text-textSubtle hover:text-text flex items-center gap-1 font-semibold transition cursor-pointer"
        >
          <Cpu className="w-3 h-3 text-primary" />
          <span>Chandra V2 OCR Engine Information</span>
        </button>

        {showEngineSettings && (
          <div className="mt-2 p-3 bg-surface rounded-xl border border-primary/30 space-y-2">
            <div className="text-xs font-bold text-text flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span>Chandra V2 Vision OCR (datalab-to/chandra-ocr-2)</span>
            </div>
            <p className="text-[10px] text-textSubtle leading-relaxed">
              High-precision vision-language document OCR engine. In <strong>Full Image</strong> mode, it transcribes entire documents into rich HTML using native <code>OCR_PROMPT</code>, which is then parsed by the LLM into structured template fields and multi-tables. In <strong>Detected Region</strong> mode, PaddleOCR locates text regions and Chandra V2 transcribes handwriting crops.
            </p>
          </div>
        )}
      </div>
      {/* Live Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={(file) => {
          setIsCameraModalOpen(false);
          onFileSelected(file);
        }}
      />
    </div>
  );
}
