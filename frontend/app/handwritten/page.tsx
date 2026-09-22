'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Layers,
  Sparkles,
  Search,
  Trash2,
  Edit2,
  Printer,
  Save,
  CheckCircle2,
  Database,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Camera,
  Upload,
} from 'lucide-react';
import {
  DataTemplate,
  DataEntryRecord,
  SessionDataEntry,
  UserSettings,
  LookupTable,
  HandwrittenEngineType,
  OcrPageResult,
  ModelVariantType,
  OcrCheckpointInfo,
  ModelVariantsResponse,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  ExtractionMethodType,
  ChandraModeType,
  ChandraQuantizationType,
  ChandraLoadingMethodType,
  OllamaVisionModel,
  OllamaGenerationOptions,
  EntryTableData,
} from '@/types';
import { DEFAULT_HANDWRITING_SCANNING_TEMPLATE, DEFAULT_SETTINGS, DEFAULT_OLLAMA_OPTIONS } from '@/lib/constants';
import { formatDateDisplay } from '@/lib/utils/dateUtils';
import { apiUrl } from '@/lib/api/apiClient';
import { exportEntriesToExcel } from '@/lib/utils/excelExporter';
import { convertPdfToImages } from '@/lib/utils/pdfToImages';
import { DocumentUploadPanel } from '@/components/handwritten/DocumentUploadPanel';
import { ExtractedEntriesList } from '@/components/voice/ExtractedEntriesList';
import { PrintableEntriesReport } from '@/components/voice/PrintableEntriesReport';
import { BatchDataEntryViewModal } from '@/components/modals/BatchDataEntryViewModal';
import { HandwritingTemplateModal } from '@/components/handwritten/HandwritingTemplateModal';
import { HandwritingReviewModal } from '@/components/handwritten/HandwritingReviewModal';
import { CameraCaptureModal } from '@/components/handwritten/CameraCaptureModal';

export default function HandwrittenEntryPage() {
  // 1. Extraction mode (Template Form is Default)
  const [dataMode, setDataMode] = useState<'template' | 'flexible'>('template');
  const [lookupTables, setLookupTables] = useState<LookupTable[]>([]);
  const [handwritingTemplates, setHandwritingTemplates] = useState<HandwritingScanningTemplate[]>([
    DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
  ]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    DEFAULT_HANDWRITING_SCANNING_TEMPLATE.id
  );
  const [handwritingTemplate, setHandwritingTemplate] = useState<HandwritingScanningTemplate>(
    DEFAULT_HANDWRITING_SCANNING_TEMPLATE
  );
  const [showHandwritingTemplateModal, setShowHandwritingTemplateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [lastExtractedResult, setLastExtractedResult] = useState<HandwritingExtractionApiResponse | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [extractionMethod, setExtractionMethod] = useState<ExtractionMethodType>('chandra_2');
  const [chandraMode, setChandraMode] = useState<ChandraModeType>('full_image');
  const [chandraUpscale, setChandraUpscale] = useState<boolean>(false);
  const [chandraQuantization, setChandraQuantization] = useState<ChandraQuantizationType>('3-bit');
  const [chandraLoadingMethod, setChandraLoadingMethod] = useState<ChandraLoadingMethodType>('ollama');
  const [chandraOllamaModel, setChandraOllamaModel] = useState<string>('chandra');
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState<boolean>(false);

  // Ollama Vision State
  const [ollamaModels, setOllamaModels] = useState<OllamaVisionModel[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>('qwen2.5vl:7b');
  const [ollamaOptions, setOllamaOptions] = useState<OllamaGenerationOptions>(DEFAULT_OLLAMA_OPTIONS);
  const [isOllamaOnline, setIsOllamaOnline] = useState<boolean>(true);

  // Model Variant & Checkpoint State

  const [modelVariant, setModelVariant] = useState<ModelVariantType>('base');
  const [availableCheckpoints, setAvailableCheckpoints] = useState<OcrCheckpointInfo[]>([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>('');

  // 2. Accumulated Session Entries (Left Panel)
  const [entries, setEntries] = useState<SessionDataEntry[]>([]);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 3. 2-Stage Pipeline State (Right Panel)
  const [pipelineStage, setPipelineStage] = useState<'upload' | 'ocr_running' | 'ocr_review' | 'llm_running'>('upload');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isPdf, setIsPdf] = useState<boolean>(false);
  const [ocrPages, setOcrPages] = useState<OcrPageResult[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [engineUsed, setEngineUsed] = useState<string>('Chandra V2 Vision OCR');
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 4. Saved Database Records (History section below)
  const [records, setRecords] = useState<DataEntryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('All');
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [showSavedHistory, setShowSavedHistory] = useState(false);

  // Modal for viewing past saved batch records
  const [modalMode, setModalMode] = useState<{
    isOpen: boolean;
    existingRecord?: DataEntryRecord;
  }>({ isOpen: false });

  const fetchOllamaModels = useCallback(async () => {
    try {
      setLoadingOllamaModels(true);
      const res = await fetch(apiUrl('/api/handwritten/ollama/models'));
      if (res.ok) {
        const data = await res.json();
        setIsOllamaOnline(Boolean(data.online));
        if (Array.isArray(data.models) && data.models.length > 0) {
          setAvailableOllamaModels(data.models);
          setChandraOllamaModel((prev) => {
            if (data.models.includes(prev)) return prev;
            const preferred = data.models.find((m: string) => m.toLowerCase().includes('chandra')) || data.models[0];
            return preferred || prev;
          });
        }
      }
    } catch (e) {
      console.warn('Could not fetch Ollama models:', e);
      setIsOllamaOnline(false);
    } finally {
      setLoadingOllamaModels(false);
    }
  }, []);

  // Fetch initial data safely with Promise.allSettled
  const fetchTemplatesAndRecords = useCallback(async () => {
    try {
      setLoadingRecords(true);
      const [tableRes, recRes, setRes, modelRes, hwTmplRes] = await Promise.allSettled([
        fetch(apiUrl('/api/lookup-tables')),
        fetch(apiUrl('/api/data-entries')),
        fetch(apiUrl('/api/settings')),
        fetch(apiUrl('/api/handwritten/models')),
        fetch(apiUrl('/api/handwritten/template')),
      ]);

      if (tableRes.status === 'fulfilled' && tableRes.value.ok) {
        try {
          const tableData = await tableRes.value.json();
          if (Array.isArray(tableData)) setLookupTables(tableData);
        } catch (err) {
          console.warn('Could not parse lookup-tables JSON:', err);
        }
      }

      if (recRes.status === 'fulfilled' && recRes.value.ok) {
        try {
          const recData = await recRes.value.json();
          if (Array.isArray(recData)) setRecords(recData);
        } catch (err) {
          console.warn('Could not parse data-entries JSON:', err);
        }
      }

      if (setRes.status === 'fulfilled' && setRes.value.ok) {
        try {
          const setData = await setRes.value.json();
          if (setData && !setData.error) {
            setSettings(setData);
            if (setData.defaultExtractionMethod) {
              setExtractionMethod(setData.defaultExtractionMethod);
            }
            if (setData.ollamaVisionModel) {
              setSelectedOllamaModel(setData.ollamaVisionModel);
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
            if (setData.ollamaOptions) {
              setOllamaOptions(setData.ollamaOptions);
            } else {
              try {
                const localOpts = localStorage.getItem('voice_epr_ollama_options');
                if (localOpts) setOllamaOptions(JSON.parse(localOpts));
              } catch {}
            }
          }
        } catch (err) {
          console.warn('Could not parse settings JSON:', err);
        }
      }

      if (modelRes.status === 'fulfilled' && modelRes.value.ok) {
        try {
          const modelData: ModelVariantsResponse = await modelRes.value.json();
          if (modelData && (modelData as any).defaultLoadingMethod) {
            setChandraLoadingMethod((modelData as any).defaultLoadingMethod);
          }
          if (modelData && (modelData as any).defaultOllamaModel) {
            setChandraOllamaModel((prev) => prev || (modelData as any).defaultOllamaModel);
          }
          if (modelData && Array.isArray(modelData.checkpoints)) {
            setAvailableCheckpoints(modelData.checkpoints);
            if (modelData.checkpoints.length > 0) {
              setSelectedCheckpointId(modelData.checkpoints[0].id);
            }
          }
        } catch (err) {
          console.warn('Could not parse model data:', err);
        }
      }

      if (hwTmplRes.status === 'fulfilled' && hwTmplRes.value.ok) {
        try {
          const hwTmplData = await hwTmplRes.value.json();
          if (Array.isArray(hwTmplData) && hwTmplData.length > 0) {
            setHandwritingTemplates(hwTmplData);
            setHandwritingTemplate(hwTmplData[0]);
            setSelectedTemplateId(hwTmplData[0].id);
          } else if (hwTmplData && Array.isArray(hwTmplData.fields)) {
            setHandwritingTemplates([hwTmplData]);
            setHandwritingTemplate(hwTmplData);
            setSelectedTemplateId(hwTmplData.id);
          }
        } catch (err) {
          console.warn('Could not parse handwriting template JSON:', err);
        }
      }

      await fetchOllamaModels();
    } catch (e) {
      console.warn('Notice: Backend initial sync paused:', e);
    } finally {
      setLoadingRecords(false);
    }
  }, [fetchOllamaModels]);

  useEffect(() => {
    fetchTemplatesAndRecords();
  }, [fetchTemplatesAndRecords]);

  // Helper: construct all defined tables for an entry, ensuring empty tables retain headers
  const buildEntryTables = useCallback(
    (ocrData: any, template: HandwritingScanningTemplate): EntryTableData[] => {
      const rawTables =
        template.tables && template.tables.length > 0
          ? template.tables
          : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [];

      if (ocrData.tables && Array.isArray(ocrData.tables) && ocrData.tables.length > 0) {
        return rawTables.map((tmplTable, tmplIdx) => {
          const norm = (s: string) =>
            (s || '')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .replace(/table|breakdown|card|sheet/g, '')
              .replace(/s$/, '');
          const tmplNorm = norm(tmplTable.name);
          const tmplLower = (tmplTable.name || '').toLowerCase();

          // Match by exact name, normalized name, keyword, or index fallback
          const found =
            ocrData.tables.find(
              (t: any) =>
                t &&
                typeof t === 'object' &&
                (t.name?.toLowerCase().trim() === tmplTable.name?.toLowerCase().trim() ||
                  norm(t.name || '') === tmplNorm ||
                  (tmplLower.includes('reject') &&
                    (t.name?.toLowerCase().includes('reject') ||
                      t.name?.toLowerCase().includes('defect'))) ||
                  (tmplLower.includes('product') && t.name?.toLowerCase().includes('product')))
            ) || ocrData.tables[tmplIdx];

          const headers = (tmplTable.columns || (tmplTable as any).fields || []).map(
            (f: any) => f.name || f.column_name
          );

          if (found && found.rows) {
            const rawRows = Array.isArray(found.rows) ? found.rows : [found.rows];
            console.log(
              `[buildEntryTables] Matched table "${tmplTable.name}" with ${rawRows.length} rows.`
            );
            return {
              name: tmplTable.name,
              headers: found.headers && found.headers.length > 0 ? found.headers : headers,
              rows: rawRows,
            };
          }

          console.log(`[buildEntryTables] Table "${tmplTable.name}" has 0 rows.`);
          return {
            name: tmplTable.name,
            headers,
            rows: [],
          };
        });
      }

      // Fallback if ocrData doesn't have .tables
      return rawTables.map((tmplTable, idx) => {
        const headers = (tmplTable.columns || (tmplTable as any).fields || []).map(
          (f: any) => f.name || f.column_name
        );
        if (idx === 0 && ocrData.table_rows) {
          const rowsArray: any[][] = (ocrData.table_rows || []).map((row: any) => {
            if (Array.isArray(row)) return row;
            return (ocrData.table_headers || headers).map((col: string) => row[col] || '');
          });
          return {
            name: tmplTable.name,
            headers: ocrData.table_headers || headers,
            rows: rowsArray,
          };
        }
        return {
          name: tmplTable.name,
          headers,
          rows: [],
        };
      });
    },
    []
  );

  // Adapt dedicated HandwritingScanningTemplate to UI format for the entries list
  const adaptedTemplate: DataTemplate = React.useMemo(() => {
    const rawTables =
      handwritingTemplate.tables && handwritingTemplate.tables.length > 0
        ? handwritingTemplate.tables
        : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [];

    const tables = rawTables.map((t: any) => ({
      id: t.id || `table_${t.name}`,
      name: t.name,
      fields: (t.columns || t.fields || []).map((c: any) => ({
        id: c.id || `col_${c.column_name || c.name}`,
        name: c.column_name || c.name,
        extractionKey: c.extractionKey || c.column_name || c.name,
        type: (c.is_number ? 'number' : 'text') as any,
        placeholder: `[${c.value_type === 'h' ? '✍️' : '🖨️'}${c.calculate_total ? ' Σ' : ''}]`,
      })),
    }));

    const primaryTableFields =
      tables[0]?.fields ||
      handwritingTemplate.table_columns.map((c) => ({
        id: c.id,
        name: c.column_name,
        extractionKey: c.column_name,
        type: (c.is_number ? 'number' : 'text') as any,
        placeholder: `[${c.value_type === 'h' ? '✍️' : '🖨️'}${c.calculate_total ? ' Σ' : ''}]`,
      }));

    return {
      id: handwritingTemplate.id,
      name: handwritingTemplate.name,
      description: handwritingTemplate.description,
      isDefault: true,
      hasTable:
        tables.length > 0 ||
        (handwritingTemplate.table_columns && handwritingTemplate.table_columns.length > 0),
      tableTitle: tables[0]?.name || 'Production Table Entries',
      fields: handwritingTemplate.fields.map((f) => ({
        id: f.id,
        name: f.field_name,
        extractionKey: f.field_name,
        type: (f.is_fixed ? 'fixed' : (f.field_name.toLowerCase().includes('date') ? 'date' : 'text')) as any,
        is_fixed: f.is_fixed,
        fixed_value: f.fixed_value,
        fixed_values: f.fixed_values,
        fixed_source: f.fixed_source,
        fixed_file_name: f.fixed_file_name,
        fixed_column_name: f.fixed_column_name,
        placeholder: f.is_fixed
          ? `[🔒 Fixed: ${f.fixed_value || (f.fixed_values?.length ? `${f.fixed_values.length} allowed` : '')}]`
          : `[${f.value_type === 'h' ? '✍️ TrOCR' : '🖨️ Paddle'}] look_${f.look_for}`,
      })),
      tableFields: primaryTableFields,
      tables,
      lookupConfig: handwritingTemplate.lookupConfig,
      createdAt: handwritingTemplate.updatedAt || new Date().toISOString(),
      updatedAt: handwritingTemplate.updatedAt || new Date().toISOString(),
    };
  }, [handwritingTemplate]);

  const activeTemplate = adaptedTemplate;
  const templates = [adaptedTemplate];

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const found = handwritingTemplates.find((t) => t.id === id);
    if (found) {
      setHandwritingTemplate(found);
    }
  };

  const handleCreateTemplate = async () => {
    const newTmpl: HandwritingScanningTemplate = {
      ...JSON.parse(JSON.stringify(DEFAULT_HANDWRITING_SCANNING_TEMPLATE)),
      id: `hw_tmpl_${Date.now()}`,
      name: `Template ${handwritingTemplates.length + 1}`,
      description: `Custom handwriting scanning template ${handwritingTemplates.length + 1}`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch(apiUrl('/api/handwritten/template'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTmpl),
      });
      const saved = await res.json();
      setHandwritingTemplates((prev) => [...prev, saved]);
      setHandwritingTemplate(saved);
      setSelectedTemplateId(saved.id);
      setShowHandwritingTemplateModal(true);
    } catch (err) {
      console.error('Failed to create handwriting template:', err);
    }
  };

  const handleSaveHandwritingTemplate = async (updated: HandwritingScanningTemplate) => {
    setHandwritingTemplate(updated);
    setHandwritingTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [...prev, updated];
    });

    try {
      await fetch(apiUrl('/api/handwritten/template'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.error('Failed to save handwriting template:', err);
    }
  };

  const handleDeleteHandwritingTemplate = async (id: string) => {
    try {
      await fetch(apiUrl(`/api/handwritten/template?id=${id}`), { method: 'DELETE' });
      const remaining = handwritingTemplates.filter((t) => t.id !== id);
      const safeRemaining = remaining.length > 0 ? remaining : [DEFAULT_HANDWRITING_SCANNING_TEMPLATE];
      setHandwritingTemplates(safeRemaining);
      const nextActive = safeRemaining[0];
      setHandwritingTemplate(nextActive);
      setSelectedTemplateId(nextActive.id);
    } catch (err) {
      console.error('Failed to delete handwriting template:', err);
    }
  };

  const handleUpdateEntryFromReview = (
    pageIndex: number,
    updatedFields: Record<string, any>,
    updatedTableRows?: any[],
    updatedTables?: EntryTableData[]
  ) => {
    setEntries((prev) => {
      const copy = [...prev];
      if (copy[pageIndex]) {
        copy[pageIndex] = {
          ...copy[pageIndex],
          fieldValues: updatedFields,
          tableRows: updatedTableRows !== undefined ? updatedTableRows : copy[pageIndex].tableRows,
          tables: updatedTables !== undefined ? updatedTables : copy[pageIndex].tables,
        };
      }
      return copy;
    });

    if (pageIndex === activePageIndex) {
      setLastExtractedResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          field_values: updatedFields,
          table_rows: updatedTableRows !== undefined ? updatedTableRows : prev.table_rows,
          tables: updatedTables !== undefined ? updatedTables : prev.tables,
        };
      });
    }
  };

  const handleImmediateSaveFromReview = async (pageIndex: number) => {
    const entryToSave = entries[pageIndex];
    if (!entryToSave) return;

    try {
      await fetch(apiUrl('/api/data-entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: entryToSave.templateId,
          templateName: entryToSave.templateName,
          title: entryToSave.title || `${entryToSave.templateName} Entry`,
          fieldValues: entryToSave.fieldValues,
          tableTitle: entryToSave.tableTitle,
          tableHeaders: entryToSave.tableHeaders,
          tableRows: entryToSave.tableRows,
          tables: entryToSave.tables,
          sourceType: 'handwritten',
          rawTranscript: entryToSave.rawOcrText,
          rawOcrText: entryToSave.rawOcrText,
          documentName: uploadedFile?.name,
          entries: [entryToSave],
          totalEntries: 1,
        }),
      });

      fetch(apiUrl('/api/data-entries'))
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setRecords(data);
        })
        .catch(() => {});
    } catch (err) {
      console.warn('Failed to immediately save entry:', err);
    }
  };



  // STAGE 2: Auto-Structure OCR text with LLM and fill template fields
  const executeStructuring = async (pages: OcrPageResult[], docName: string) => {
    if (!pages || pages.length === 0) return;

    const hasAnyText = pages.some((p) => p.ocrText && p.ocrText.trim().length > 0);
    if (!hasAnyText) {
      setErrorMessage('OCR completed, but no readable text was detected in this document. You can type/edit text in the box above and click "Re-structure fields".');
      setPipelineStage('ocr_review');
      return;
    }

    try {
      setPipelineStage('llm_running');
      setErrorMessage(null);
      setProcessingStatus(
        `Auto-filling template fields via LLM (${pages.length} ${pages.length === 1 ? 'entry' : 'entries'})...`
      );

      const payload = {
        pages: pages.map((p) => ({
          pageNumber: p.pageNumber,
          ocrText: p.ocrText,
          rawOcrHtml: p.rawOcrHtml || '',
          ocrRecordId: p.ocrRecordId || undefined,
          imageUrl: p.imageUrl,
        })),
        template: dataMode === 'template' ? activeTemplate : null,
        mode: dataMode,
        documentName: docName || 'Document',
        ocrMethod: extractionMethod,
      };

      const res = await fetch(apiUrl('/api/handwritten/structure'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to extract structured template fields.');
      }

      const data = await res.json();
      const structuredEntries: SessionDataEntry[] = data.entries || [];

      if (structuredEntries.length === 0) {
        throw new Error('No structured records could be extracted from the OCR text.');
      }

      // Append entries into session list with sequential entry numbers
      setEntries((prev) => {
        const startNumber = prev.length;
        const renumbered = structuredEntries.map((e, idx) => {
          const entryMode = e.mode || (dataMode as any) || 'template';
          const entryFieldValues =
            e.fieldValues || (e as any).field_values || (e as any).data || {};
          return {
            ...e,
            mode: entryMode,
            entryNumber: startNumber + idx + 1,
            documentName: docName || 'Document',
            sourceType: 'handwritten' as const,
            templateId: e.templateId || activeTemplate.id,
            templateName: e.templateName || activeTemplate.name,
            fieldValues: entryFieldValues,
            tables: e.tables || [],
            tableRows: e.tableRows || [],
            createdAt: e.createdAt || new Date().toISOString(),
            rawOcrText: (e as any).cleanText || e.rawTranscript || e.rawOcrText || '',
          };
        });
        return [...prev, ...renumbered];
      });

      if (structuredEntries[0]) {
        const first = structuredEntries[0];
        setLastExtractedResult({
          success: true,
          template_name: first.templateName || activeTemplate.name,
          fields: [],
          field_values: first.fieldValues || (first as any).field_values || {},
          table_headers: first.tableHeaders || [],
          table_rows: (first.tableRows as any) || [],
          tables: first.tables || [],
          structured_text: first.rawTranscript || '',
          raw_text: (first as any).rawOcrHtml || '',
          total_pages: structuredEntries.length,
          processing_time_ms: 0,
        });
      }

      setSaveSuccessMsg(
        `Extracted & Auto-Filled ${structuredEntries.length} ${structuredEntries.length === 1 ? 'entry' : 'entries'} into session list!`
      );
      setTimeout(() => setSaveSuccessMsg(null), 5000);

      // Keep OCR text visible in review box
      setPipelineStage('ocr_review');
    } catch (err: any) {
      console.error('LLM Structuring Error:', err);
      setErrorMessage(err.message || 'LLM structuring failed.');
      setPipelineStage('ocr_review');
    } finally {
      setProcessingStatus('');
    }
  };

  // STAGE 1: Process Selected File (Image = 1 Page; PDF = Page by Page)
  const handleFileSelected = async (file: File) => {
    setUploadedFile(file);
    setErrorMessage(null);
    setOcrPages([]);
    setActivePageIndex(0);

    const isFilePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    setIsPdf(isFilePdf);

    let renderedPdfPages: any[] = [];
    if (isFilePdf) {
      try {
        renderedPdfPages = await convertPdfToImages(file);
      } catch (pdfErr) {
        console.warn('Could not pre-render PDF pages:', pdfErr);
      }
    }

    try {
      setPipelineStage('ocr_running');

      // Chandra V2 Vision OCR (Quantized - Full Image / Detected Region)
      const modeLabel = chandraMode === 'full_image' ? 'Full Image' : 'Detected Region';
      const loadLabel = chandraLoadingMethod === 'ollama' ? `Ollama: ${chandraOllamaModel}` : chandraQuantization;

      if (isFilePdf) {
        setProcessingStatus(`Splitting PDF & running Chandra 2 (${modeLabel}, ${loadLabel})...`);
        const pdfPages = await convertPdfToImages(file);

        if (pdfPages.length === 0) {
          throw new Error('No readable pages found in PDF document.');
        }

        const results: OcrPageResult[] = [];

        for (let i = 0; i < pdfPages.length; i++) {
          const p = pdfPages[i];
          setProcessingStatus(`Running Chandra 2 (${modeLabel}, ${loadLabel}) on PDF Page ${p.pageNumber} of ${pdfPages.length}...`);

          const formData = new FormData();
          formData.append('base64Data', p.dataUrl);
          formData.append('ocr_method', 'chandra_2');
          formData.append('chandra_mode', chandraMode);
          formData.append('chandra_upscale', String(chandraUpscale));
          formData.append('chandra_quantization', chandraQuantization);
          formData.append('chandra_loading_method', chandraLoadingMethod);
          if (chandraLoadingMethod === 'ollama') {
            formData.append('chandra_ollama_model', chandraOllamaModel);
          }
          if (dataMode === 'template') {
            formData.append('handwriting_template', JSON.stringify(handwritingTemplate));
          }

          const ocrRes = await fetch(apiUrl('/api/handwritten/ocr'), {
            method: 'POST',
            body: formData,
          });

          if (!ocrRes.ok) {
            const err = await ocrRes.json().catch(() => ({}));
            const errorMsg =
              err.detail ||
              err.error ||
              err.message ||
              `Chandra 2 failed on page ${p.pageNumber} (HTTP ${ocrRes.status}).`;
            throw new Error(errorMsg);
          }

          const ocrData = await ocrRes.json();
          if (ocrData.success === false && ocrData.error) {
            throw new Error(ocrData.error);
          }

          setLastExtractedResult(ocrData);

          const pageCleanText = ocrData.clean_text || ocrData.text || '';
          const pageRawHtml = ocrData.raw_text || ocrData.structured_text || '';
          const pageOcrId = ocrData.ocrRecordId || ocrData.ocr_record_id;

          results.push({
            pageNumber: p.pageNumber,
            imageUrl: p.dataUrl,
            ocrText: pageCleanText,
            rawOcrHtml: pageRawHtml,
            ocrRecordId: pageOcrId,
          });

          if (ocrData.engineUsed) {
            setEngineUsed(ocrData.engineUsed);
          }
        }

        setOcrPages(results);

        // Initiate the LLM call in the Python backend only
        await executeStructuring(results, file.name);

      } else {
        // Single Image
        setProcessingStatus(`Running Chandra 2 (${modeLabel}, ${loadLabel}) handwriting extraction...`);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('ocr_method', 'chandra_2');
        formData.append('chandra_mode', chandraMode);
        formData.append('chandra_upscale', String(chandraUpscale));
        formData.append('chandra_quantization', chandraQuantization);
        formData.append('chandra_loading_method', chandraLoadingMethod);
        if (chandraLoadingMethod === 'ollama') {
          formData.append('chandra_ollama_model', chandraOllamaModel);
        }
        if (dataMode === 'template') {
          formData.append('handwriting_template', JSON.stringify(handwritingTemplate));
        }

        const ocrRes = await fetch(apiUrl('/api/handwritten/ocr'), {
          method: 'POST',
          body: formData,
        });

        if (!ocrRes.ok) {
          const err = await ocrRes.json().catch(() => ({}));
          const errorMsg =
            err.detail ||
            err.error ||
            err.message ||
            `Failed to extract text using Chandra 2 OCR (HTTP ${ocrRes.status}).`;
          throw new Error(errorMsg);
        }

        const ocrData = await ocrRes.json();
        if (ocrData.success === false && ocrData.error) {
          throw new Error(ocrData.error);
        }

        setLastExtractedResult(ocrData);

        const pageCleanText = ocrData.clean_text || ocrData.text || '';
        const pageRawHtml = ocrData.raw_text || ocrData.structured_text || '';
        const pageOcrId = ocrData.ocrRecordId || ocrData.ocr_record_id;

        const imageUrl = URL.createObjectURL(file);
        const results: OcrPageResult[] = [
          {
            pageNumber: 1,
            imageUrl,
            ocrText: pageCleanText,
            rawOcrHtml: pageRawHtml,
            ocrRecordId: pageOcrId,
          },
        ];

        if (ocrData.engineUsed) {
          setEngineUsed(ocrData.engineUsed);
        }

        setOcrPages(results);

        // Initiate the LLM call in the Python backend only
        await executeStructuring(results, file.name);
      }
    } catch (err: any) {
      console.error('Handwriting Extraction Error:', err);
      setErrorMessage(err.message || 'Failed to extract handwriting from document.');
      setPipelineStage('upload');
      setProcessingStatus('');
    }

  };

  const handleClearUploadedFile = () => {
    ocrPages.forEach((p) => {
      if (p.imageUrl && p.imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(p.imageUrl);
      }
    });
    setUploadedFile(null);
    setOcrPages([]);
    setActivePageIndex(0);
    setPipelineStage('upload');
    setErrorMessage(null);
    setProcessingStatus('');
  };

  const handleUpdatePageOcrText = (pageIndex: number, newText: string) => {
    setOcrPages((prev) => {
      const copy = [...prev];
      if (copy[pageIndex]) {
        copy[pageIndex] = { ...copy[pageIndex], ocrText: newText };
      }
      return copy;
    });
  };

  // Re-run OCR on active document
  const handleRerunOcr = async () => {
    if (!uploadedFile) return;
    handleFileSelected(uploadedFile);
  };

  // Sample document generator
  const handleLoadSample = async (sampleType: 'shift_log' | 'parts_sheet' | 'flexible_notes') => {
    try {
      setPipelineStage('ocr_running');
      setErrorMessage(null);
      setProcessingStatus('Generating sample document & extracting handwriting...');

      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 1100;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.fillStyle = '#fcfbf7';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 24px sans-serif';
        const docTitle =
          sampleType === 'shift_log'
            ? 'PLANT SHIFT PRODUCTION LOG (IMAGE ENTRY)'
            : sampleType === 'parts_sheet'
            ? 'MULTI-PAGE DISPATCH VOUCHER (PAGE 1)'
            : 'DAILY FABRICATION NOTES';
        ctx.fillText(docTitle, 40, 50);

        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`Date: ${new Date().toLocaleDateString()} | Plant Section: Assembly Line 02`, 40, 80);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(40, 95);
        ctx.lineTo(860, 95);
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'italic 18px "Courier New", monospace';

        if (sampleType === 'shift_log') {
          const sampleRows = [
            'Part No: PRT-4029',
            'Shift: A',
            'Quantity: 150',
            'Status: Pass',
            'Notes: Machine ran smoothly without calibration errors.',
            'Production Logs:',
            ' - 09:00 AM to 10:00 AM: 50 pcs',
            ' - 10:00 AM to 11:00 AM: 50 pcs',
            ' - 11:00 AM to 12:00 PM: 50 pcs',
          ];
          let y = 140;
          sampleRows.forEach((r) => {
            ctx.fillText(r, 50, y);
            y += 36;
          });
        } else if (sampleType === 'parts_sheet') {
          const sampleRows = [
            'DISPATCH SHEET - BATCH ORDER',
            'Part No: PRT-1002',
            'Shift: B',
            'Quantity: 320',
            'Operator: A. Verma',
            'Hourly Logs:',
            ' - 02:00 PM to 03:00 PM: 160 pcs',
            ' - 03:00 PM to 04:00 PM: 160 pcs',
          ];
          let y = 140;
          sampleRows.forEach((r) => {
            ctx.fillText(r, 50, y);
            y += 36;
          });
        } else {
          const sampleRows = [
            'Workshop Notes: Heavy Fabrication Job',
            'Supervisor: M. Sharma',
            'Material: High Tensile Alloy Steel Plates',
            'Technicians on Shift: 8',
            'Daily Power Usage: 340 kWh',
          ];
          let y = 140;
          sampleRows.forEach((r) => {
            ctx.fillText(r, 50, y);
            y += 40;
          });
        }
      }

      canvas.toBlob(async (blob) => {
        if (!blob) return;

        let samplePages: OcrPageResult[] = [];
        let docName = '';

        if (sampleType === 'parts_sheet') {
          // 2-page PDF simulation
          setIsPdf(true);
          const page1Url = canvas.toDataURL('image/png');
          docName = 'sample_dispatch_voucher.pdf';
          setUploadedFile(new File([blob], docName, { type: 'application/pdf' }));
          samplePages = [
            {
              pageNumber: 1,
              imageUrl: page1Url,
              ocrText: `DISPATCH SHEET - PAGE 1\nPart No: PRT-1002\nShift: A\nQuantity: 300\nProduced: 300 units\nStatus: Pass`,
            },
            {
              pageNumber: 2,
              imageUrl: page1Url,
              ocrText: `DISPATCH SHEET - PAGE 2\nPart No: PRT-8831\nShift: B\nQuantity: 450\nProduced: 450 units\nStatus: Pass`,
            },
          ];
          setDataMode('template');
        } else {
          // Single Image
          setIsPdf(false);
          const dataUrl = canvas.toDataURL('image/png');
          docName = `sample_${sampleType}.png`;
          setUploadedFile(new File([blob], docName, { type: 'image/png' }));
          samplePages = [
            {
              pageNumber: 1,
              imageUrl: dataUrl,
              ocrText:
                sampleType === 'flexible_notes'
                  ? `Workshop Notes: Heavy Fabrication Job\nSupervisor: M. Sharma\nMaterial: High Tensile Alloy Steel Plates\nTechnicians: 8\nPower Usage: 340 kWh`
                  : `Part No: PRT-4029\nShift: A\nQuantity: 150\nProduced Qty: 150\nStatus: Pass`,
            },
          ];
          if (sampleType === 'flexible_notes') setDataMode('flexible');
          else setDataMode('template');
        }

        // Show OCR output immediately
        setOcrPages(samplePages);

        // Automatically trigger LLM to fill template fields
        await executeStructuring(samplePages, docName);
      }, 'image/png');
    } catch (err: any) {
      console.error(err);
      setPipelineStage('upload');
      setProcessingStatus('');
    }
  };

  // Add Manual Entry to Session
  const handleAddManualEntry = () => {
    const currentEntryNum = entries.length + 1;
    const entryId = `entry_hw_manual_${Date.now()}`;

    if (dataMode === 'flexible') {
      const newEntry: SessionDataEntry = {
        id: entryId,
        entryNumber: currentEntryNum,
        sourceType: 'handwritten',
        mode: 'flexible',
        templateId: 'flexible',
        templateName: 'Manual Flexible Record',
        title: 'Manual Record',
        fieldValues: { 'Field 1': '' },
        flexibleFields: [{ name: 'Field 1', value: '' }],
        tableTitle: 'Table Rows',
        tableHeaders: ['Item', 'Quantity', 'Notes'],
        tableRows: [['', '', '']],
        createdAt: new Date().toISOString(),
      };
      setEntries((prev) => [...prev, newEntry]);
    } else {
      const initialFields: Record<string, any> = {};
      adaptedTemplate.fields.forEach((f) => {
        initialFields[f.extractionKey] = f.defaultValue || '';
      });

      const initialTableRows: Array<Record<string, any>> = [];
      if (adaptedTemplate.hasTable && adaptedTemplate.tableFields?.length > 0) {
        const row: Record<string, any> = {};
        adaptedTemplate.tableFields.forEach((c) => {
          row[c.extractionKey] = '';
        });
        initialTableRows.push(row);
      }

      const initialTables: EntryTableData[] =
        adaptedTemplate.tables && adaptedTemplate.tables.length > 0
          ? adaptedTemplate.tables.map((tbl) => {
              const row: Record<string, any> = {};
              tbl.fields.forEach((c) => {
                row[c.extractionKey] = '';
              });
              return {
                name: tbl.name,
                headers: tbl.fields.map((f) => f.name),
                rows: [row],
              };
            })
          : [
              {
                name: adaptedTemplate.tableTitle || 'Production Table Entries',
                headers: adaptedTemplate.tableFields?.map((f) => f.name) || [],
                rows: initialTableRows,
              },
            ];

      const newEntry: SessionDataEntry = {
        id: entryId,
        entryNumber: currentEntryNum,
        sourceType: 'handwritten',
        mode: 'template',
        templateId: adaptedTemplate.id,
        templateName: adaptedTemplate.name,
        title: adaptedTemplate.name,
        fieldValues: initialFields,
        tableTitle: adaptedTemplate.tableTitle || 'Production Table Entries',
        tableHeaders: adaptedTemplate.tableFields?.map((f) => f.name) || [],
        tableRows: initialTableRows,
        tables: initialTables,
        createdAt: new Date().toISOString(),
      };
      setEntries((prev) => [...prev, newEntry]);
    }
  };

  // Update entry field in session
  const handleUpdateEntryField = (entryId: string, fieldKey: string, value: any) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        return {
          ...e,
          fieldValues: {
            ...e.fieldValues,
            [fieldKey]: value,
          },
        };
      })
    );
  };

  const handleUpdateFlexibleField = (
    entryId: string,
    fieldIdx: number,
    key: 'name' | 'value',
    value: any
  ) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])];
        if (flex[fieldIdx]) {
          flex[fieldIdx] = { ...flex[fieldIdx], [key]: value };
        }
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleAddFlexibleField = (entryId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])];
        flex.push({ name: `Field ${flex.length + 1}`, value: '' });
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleDeleteFlexibleField = (entryId: string, fieldIdx: number) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const flex = [...(e.flexibleFields || [])].filter((_, i) => i !== fieldIdx);
        return { ...e, flexibleFields: flex };
      })
    );
  };

  const handleUpdateTableRow = (
    entryId: string,
    rowIdx: number,
    colKey: string | number,
    value: any,
    tableIdx: number = 0
  ) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        let updatedTableRows = e.tableRows;
        if (tableIdx === 0) {
          const rows = [...(e.tableRows || [])];
          if (Array.isArray(rows[rowIdx])) {
            const cells = [...(rows[rowIdx] as any[])];
            cells[Number(colKey)] = value;
            rows[rowIdx] = cells;
          } else if (typeof rows[rowIdx] === 'object' && rows[rowIdx] !== null) {
            rows[rowIdx] = { ...rows[rowIdx], [colKey]: value };
          }
          updatedTableRows = rows;
        }

        let updatedTables = e.tables;
        if (e.tables && e.tables[tableIdx]) {
          const newTables = [...e.tables];
          const targetTable = { ...newTables[tableIdx] };
          const rows = [...targetTable.rows];
          if (Array.isArray(rows[rowIdx])) {
            const cells = [...(rows[rowIdx] as any[])];
            cells[Number(colKey)] = value;
            rows[rowIdx] = cells;
          } else if (typeof rows[rowIdx] === 'object' && rows[rowIdx] !== null) {
            rows[rowIdx] = { ...rows[rowIdx], [colKey]: value };
          }
          targetTable.rows = rows;
          newTables[tableIdx] = targetTable;
          updatedTables = newTables;
        }

        return { ...e, tableRows: updatedTableRows, tables: updatedTables };
      })
    );
  };

  const handleAddTableRow = (entryId: string, tableIdx: number = 0) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        let updatedTableRows = e.tableRows;
        let updatedTables = e.tables;

        if (e.tables && e.tables.length > 0) {
          const newTables = [...e.tables];
          const tIdx = newTables[tableIdx] ? tableIdx : 0;
          const currentTable = { ...newTables[tIdx] };
          const newRow: Record<string, any> = {};
          (currentTable.headers || []).forEach((h) => {
            newRow[h] = '';
          });
          const rows = [...currentTable.rows, newRow];
          currentTable.rows = rows;
          newTables[tIdx] = currentTable;
          updatedTables = newTables;
          if (tIdx === 0) {
            updatedTableRows = rows;
          }
        } else {
          const rows = [...(e.tableRows || [])];
          if (e.mode === 'flexible') {
            const cellCount = e.tableHeaders?.length || 3;
            rows.push(new Array(cellCount).fill(''));
          } else {
            const tmpl = templates.find((t) => t.id === e.templateId) || activeTemplate;
            const newRow: Record<string, any> = {};
            (tmpl.tableFields || []).forEach((c) => {
              newRow[c.extractionKey] = '';
            });
            rows.push(newRow);
          }
          updatedTableRows = rows;
        }

        return { ...e, tableRows: updatedTableRows, tables: updatedTables };
      })
    );
  };

  const handleDeleteTableRow = (entryId: string, rowIdx: number, tableIdx: number = 0) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        let updatedTableRows = e.tableRows;
        if (tableIdx === 0) {
          updatedTableRows = [...(e.tableRows || [])].filter((_, i) => i !== rowIdx);
        }
        let updatedTables = e.tables;
        if (e.tables && e.tables[tableIdx]) {
          const newTables = [...e.tables];
          const currentTable = { ...newTables[tableIdx] };
          currentTable.rows = [...currentTable.rows].filter((_, i) => i !== rowIdx);
          newTables[tableIdx] = currentTable;
          updatedTables = newTables;
        }
        return { ...e, tableRows: updatedTableRows, tables: updatedTables };
      })
    );
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== id);
      return filtered.map((e, idx) => ({ ...e, entryNumber: idx + 1 }));
    });
  };

  const handleClearAllEntries = () => {
    if (entries.length === 0) return;
    if (!confirm('Are you sure you want to clear all current session entries?')) return;
    setEntries([]);
  };

  // Save All entries into database
  const handleSaveAll = async () => {
    if (entries.length === 0) return;

    try {
      setIsSavingAll(true);
      setSaveSuccessMsg(null);

      const payload: Omit<DataEntryRecord, 'id' | 'createdAt' | 'updatedAt'> = {
        sourceType: 'handwritten',
        templateId: dataMode === 'template' ? activeTemplate.id : 'flexible',
        templateName: dataMode === 'template' ? activeTemplate.name : 'Flexible Handwritten Session',
        isFlexible: dataMode === 'flexible',
        title:
          dataMode === 'template'
            ? `${activeTemplate.name} Handwritten Batch (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})`
            : `Flexible Handwritten Batch (${entries.length} entries)`,
        fieldValues: entries[0]?.fieldValues || {},
        flexibleFields: entries[0]?.flexibleFields || undefined,
        tableTitle: entries[0]?.tableTitle || undefined,
        tableHeaders: entries[0]?.tableHeaders || undefined,
        tableRows: entries[0]?.tableRows || [],
        tables: entries[0]?.tables || undefined,
        rawTranscript: entries.map((e) => `[Entry ${e.entryNumber} OCR]: ${e.rawOcrText || 'Handwritten record'}`).join('\n\n'),
        rawOcrText: entries[0]?.rawOcrText || null,
        documentUrl: entries[0]?.documentUrl || null,
        documentName: entries[0]?.documentName || null,
        entries: entries,
        totalEntries: entries.length,
        date: new Date().toISOString().split('T')[0],
      };

      const res = await fetch(apiUrl('/api/data-entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save entries.');
      }

      setSaveSuccessMsg(`Successfully saved all ${entries.length} handwritten entries to database!`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      setEntries([]);
      fetchTemplatesAndRecords();
    } catch (err: any) {
      console.error('Save all error:', err);
      alert(err.message || 'Failed to save entries.');
    } finally {
      setIsSavingAll(false);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (entries.length === 0) {
      alert('No entries to export.');
      return;
    }
    exportEntriesToExcel(
      entries.map((e) => ({
        entryNumber: e.entryNumber,
        mode: e.mode,
        templateName: e.templateName,
        title: e.title,
        fieldValues: e.fieldValues,
        flexibleFields: e.flexibleFields,
        tableTitle: e.tableTitle,
        tableHeaders: e.tableHeaders,
        tableRows: e.tableRows,
        tables: e.tables,
        rawTranscript: e.rawOcrText || e.rawTranscript,
        createdAt: e.createdAt,
      })),
      `${activeTemplate.name.replace(/\s+/g, '_')}_Handwritten_Batch`
    );
  };

  // Print report
  const handlePrint = () => {
    if (entries.length === 0) {
      alert('No entries to print.');
      return;
    }
    window.print();
  };

  // Delete saved past record
  const handleDeleteRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this saved record?')) return;
    try {
      await fetch(apiUrl(`/api/data-entries/${id}`), { method: 'DELETE' });
      fetchTemplatesAndRecords();
    } catch (err) {
      console.error(err);
    }
  };

  // Filter saved records
  const filteredRecords = records.filter((r) => {
    if (filterTemplate !== 'All') {
      if (filterTemplate === 'flexible') {
        if (!r.isFlexible && r.templateId !== 'flexible') return false;
      } else {
        if (r.templateId !== filterTemplate && r.templateName !== filterTemplate) return false;
      }
    }

    if (!search.trim()) return true;
    const query = search.toLowerCase();
    const matchesName = (r.title || r.templateName || '').toLowerCase().includes(query);
    const matchesTranscript = (r.rawTranscript || r.rawOcrText || '').toLowerCase().includes(query);
    const matchesFieldValues = Object.values(r.fieldValues || {}).some((v) =>
      String(v).toLowerCase().includes(query)
    );
    return matchesName || matchesTranscript || matchesFieldValues;
  });

  return (
    <>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2.5">
                <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                <span>Handwriting Scanning Studio</span>
              </h1>
            </div>
            <p className="text-xs text-textMuted mt-0.5">
              Scan, digitize, and automatically extract handwritten shop-floor and production sheets into structured data.
            </p>
          </div>
        </div>

        {saveSuccessMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 shadow-lg animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-semibold">{saveSuccessMsg}</span>
          </div>
        )}

        {/* Main 2-Column Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column (7 cols): Extracted Entries List & Actions */}
          <div className="lg:col-span-7 h-full">
            <ExtractedEntriesList
              entries={entries}
              templates={[adaptedTemplate]}
              activeTemplate={adaptedTemplate}
              lookupTables={lookupTables}
              isSaving={isSavingAll}
              isRecording={false}
              isProcessing={pipelineStage === 'llm_running'}
              processingStatus={processingStatus}
              dataMode={dataMode}
              onReview={() => setShowReviewModal(true)}
              onEdit={() => setShowReviewModal(true)}
              onSaveAll={handleSaveAll}
              onPrint={handlePrint}
              onExportExcel={handleExportExcel}
              onClearAll={handleClearAllEntries}
              onAddManualEntry={handleAddManualEntry}
              onDeleteEntry={handleDeleteEntry}
              onUpdateEntryField={handleUpdateEntryField}
              onUpdateFlexibleField={handleUpdateFlexibleField}
              onAddFlexibleField={handleAddFlexibleField}
              onDeleteFlexibleField={handleDeleteFlexibleField}
              onUpdateTableRow={handleUpdateTableRow}
              onAddTableRow={handleAddTableRow}
              onDeleteTableRow={handleDeleteTableRow}
            />
          </div>

          {/* Right Column (5 cols): 2-Stage Document Upload & OCR Review Panel */}
          <div className="lg:col-span-5 h-full">
            <DocumentUploadPanel
              dataMode={dataMode}
              onModeChange={setDataMode}
              activeTemplate={adaptedTemplate}
              handwritingTemplate={handwritingTemplate}
              allTemplates={handwritingTemplates}
              onSelectTemplate={handleSelectTemplate}
              onCreateTemplate={handleCreateTemplate}
              onOpenTemplateConfig={() => setShowHandwritingTemplateModal(true)}
              onOpenReviewModal={() => setShowReviewModal(true)}
              extractedResult={lastExtractedResult}
              onChangeTemplate={() => setShowHandwritingTemplateModal(true)}
              templatesCount={handwritingTemplates.length}
              lookupTables={lookupTables}
              extractionMethod={extractionMethod}
              onExtractionMethodChange={setExtractionMethod}
              chandraMode={chandraMode}
              onChandraModeChange={setChandraMode}
              chandraUpscale={chandraUpscale}
              onChandraUpscaleChange={setChandraUpscale}
              chandraQuantization={chandraQuantization}
              onChandraQuantizationChange={setChandraQuantization}
              chandraLoadingMethod={chandraLoadingMethod}
              onChandraLoadingMethodChange={setChandraLoadingMethod}
              chandraOllamaModel={chandraOllamaModel}
              onChandraOllamaModelChange={setChandraOllamaModel}
              availableOllamaModels={availableOllamaModels}
              loadingOllamaModels={loadingOllamaModels}
              selectedOllamaModel={selectedOllamaModel}
              onOllamaModelChange={setSelectedOllamaModel}
              ollamaModels={ollamaModels}
              isOllamaOnline={isOllamaOnline}
              onRefreshOllamaModels={fetchOllamaModels}
              ollamaOptions={ollamaOptions}
              onOllamaOptionsChange={setOllamaOptions}
              modelVariant={modelVariant}
              onModelVariantChange={setModelVariant}
              availableCheckpoints={availableCheckpoints}
              selectedCheckpointId={selectedCheckpointId}
              onCheckpointChange={setSelectedCheckpointId}
              pipelineStage={pipelineStage}
              processingStatus={processingStatus}
              errorMessage={errorMessage}
              uploadedFile={uploadedFile}
              isPdf={isPdf}
              ocrPages={ocrPages}
              activePageIndex={activePageIndex}
              engineUsed={engineUsed}
              onFileSelected={handleFileSelected}
              onClearUploadedFile={handleClearUploadedFile}
              onSelectActivePage={setActivePageIndex}
              onUpdatePageOcrText={handleUpdatePageOcrText}
              onRerunOcr={handleRerunOcr}
              onReExtractFields={() => executeStructuring(ocrPages, uploadedFile?.name || 'Document')}
              onLoadSample={handleLoadSample}
              onOpenCamera={() => setShowCameraModal(true)}
            />
          </div>
        </div>


        {/* Database History Section (Collapsible) */}
        {records.length > 0 && (
          <div className="bg-card border border-cardBorder rounded-2xl shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSavedHistory((prev) => !prev)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-surface/50 transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-bold text-text">Saved Database Batches &amp; Records</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-surfaceMuted border border-cardBorder text-textSubtle font-mono font-bold">
                  {records.length} saved
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-textSubtle font-medium">
                <span>{showSavedHistory ? 'Hide History' : 'View History'}</span>
                {showSavedHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showSavedHistory && (
              <div className="p-5 pt-0 space-y-4 border-t border-cardBorder/40">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-b border-cardBorder/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-textMuted">Filter and browse all saved handwriting batch records:</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-textSubtle absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search saved logs..."
                        className="pl-8 pr-3 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                      />
                    </div>

                    <select
                      value={filterTemplate}
                      onChange={(e) => setFilterTemplate(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
                    >
                      <option value="All">All Templates</option>
                      <option value="flexible">Flexible Records</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {filteredRecords.length === 0 ? (
                  <div className="py-12 text-center text-xs text-textSubtle">
                    No past database records found matching criteria.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredRecords.map((rec) => (
                      <div
                        key={rec.id}
                        onClick={() => setModalMode({ isOpen: true, existingRecord: rec })}
                        className="p-4 rounded-xl bg-surface border border-cardBorder hover:border-primary/50 transition cursor-pointer space-y-2 group shadow-sm"
                      >
                        <div className="flex items-center justify-between pb-1.5 border-b border-cardBorder/40">
                          <div className="flex items-center gap-1.5 truncate">
                            {rec.sourceType === 'handwritten' ? (
                              <span className="text-[10px] text-primary font-bold shrink-0">✍️</span>
                            ) : (
                              <span className="text-[10px] text-primary font-bold shrink-0">🎙️</span>
                            )}
                            <h3 className="text-xs font-bold text-text group-hover:text-dataColor dark:group-hover:text-primary transition truncate">
                              {rec.title || rec.templateName}
                            </h3>
                          </div>
                          <button
                            onClick={(e) => handleDeleteRecord(rec.id, e)}
                            className="p-1 text-textSubtle hover:text-danger rounded transition"
                            title="Delete record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-textSubtle">
                          <span>{formatDateDisplay(rec.date)}</span>
                          <span className="font-mono text-primary font-bold">
                            {rec.totalEntries || rec.entries?.length || 1} {(rec.totalEntries || rec.entries?.length || 1) === 1 ? 'entry' : 'entries'}
                          </span>
                        </div>

                        {rec.fieldValues && Object.keys(rec.fieldValues).length > 0 && (
                          <div className="text-[10px] text-textMuted truncate pt-1">
                            {Object.entries(rec.fieldValues)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' • ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden Printable Multi-Entry Sheet */}
      <div className="hidden print:block">
        <PrintableEntriesReport
          entries={entries}
          settings={settings}
        />
      </div>

      {/* Dedicated Handwriting Template Configuration Modal */}
      {showHandwritingTemplateModal && (
        <HandwritingTemplateModal
          template={handwritingTemplate}
          allTemplates={handwritingTemplates}
          lookupTables={lookupTables}
          onSave={handleSaveHandwritingTemplate}
          onSelectTemplate={handleSelectTemplate}
          onCreateTemplate={handleCreateTemplate}
          onDeleteTemplate={handleDeleteHandwritingTemplate}
          onClose={() => setShowHandwritingTemplateModal(false)}
        />
      )}

      {/* Side-by-Side Review & Voice Editing Modal */}
      {showReviewModal && (
        <HandwritingReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          ocrPages={ocrPages}
          initialPageIndex={activePageIndex}
          entries={entries}
          template={handwritingTemplate}
          onUpdateEntry={handleUpdateEntryFromReview}
          onImmediateSave={handleImmediateSaveFromReview}
          onSaveAll={handleSaveAll}
        />
      )}


      {/* View Past Saved Batch Modal */}
      {modalMode.isOpen && modalMode.existingRecord && (
        <BatchDataEntryViewModal
          record={modalMode.existingRecord}
          onClose={() => setModalMode({ isOpen: false })}
          onDeleted={() => {
            setModalMode({ isOpen: false });
            fetchTemplatesAndRecords();
          }}
        />
      )}
      {/* Live Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={(file) => {
          setShowCameraModal(false);
          handleFileSelected(file);
        }}
      />
    </>
  );
}
