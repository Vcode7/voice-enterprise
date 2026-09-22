import {
  DataTemplate,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  HandwritingFieldExtractionResult,
  SessionDataEntry,
  OcrPageResult,
  LookupValidationStatus,
  OllamaVisionModel,
  OllamaGenerationOptions,
  EntryTableData,
} from '../../types';
import { dbSettings } from '../db/models';
import { DEFAULT_OLLAMA_OPTIONS, DEFAULT_HANDWRITING_SCANNING_TEMPLATE } from '../constants';
import { GroqServer } from '../groq/groqServer';
import { cleanAndParseJson } from '../utils/jsonParser';
import { normalizeToIsoDate } from '../utils/dateUtils';
import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_VISION_MODEL = 'qwen2.5vl:7b';

export const ALLOWED_OLLAMA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

export const MAX_OLLAMA_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface OllamaExtractionParams {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  model?: string;
  options?: OllamaGenerationOptions;
  handwritingTemplate?: HandwritingScanningTemplate | null;
  template?: DataTemplate | null;
  mode?: 'template' | 'flexible';
}

export class OllamaServer {
  /**
   * Validates document size and mime type.
   */
  public static validateDocument(buffer: Buffer, mimeType: string, filename: string): void {
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    const isAllowedExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.xlsx', '.xls', '.csv'].includes(ext);
    const isAllowedMime = ALLOWED_OLLAMA_MIME_TYPES.includes(mimeType);

    if (!isAllowedExt && !isAllowedMime) {
      throw new Error(
        `Unsupported file format "${mimeType || ext}". Supported formats for Ollama Vision: PDF, Excel (.xlsx, .xls, .csv), and Images (PNG, JPG, WEBP, BMP, TIFF).`
      );
    }

    if (buffer.length > MAX_OLLAMA_FILE_SIZE_BYTES) {
      throw new Error(
        `Document is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size for Ollama is 50MB.`
      );
    }
  }

  /**
   * Checks if local Ollama server is reachable.
   */
  public static async isServerReachable(): Promise<boolean> {
    const baseUrl = await this.getBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  /**
   * Retrieves the Ollama API Base URL from env or user settings.
   */
  public static async getBaseUrl(): Promise<string> {
    const envUrl = process.env.OLLAMA_BASE_URL?.trim();
    if (envUrl && envUrl !== '') {
      return envUrl.replace(/\/+$/, '');
    }

    try {
      const settingsPromise = dbSettings.get();
      const timeoutPromise = new Promise<any>((resolve) => setTimeout(() => resolve({}), 600));
      const settings = await Promise.race([settingsPromise, timeoutPromise]);
      if (settings?.ollamaBaseUrl?.trim()) {
        return settings.ollamaBaseUrl.trim().replace(/\/+$/, '');
      }
    } catch {
      // ignore
    }

    return DEFAULT_OLLAMA_BASE_URL;
  }

  /**
   * Retrieves the default vision model name from env or settings.
   */
  public static async getDefaultModel(): Promise<string> {
    const envModel = process.env.OLLAMA_DEFAULT_VISION_MODEL?.trim();
    if (envModel && envModel !== '') {
      return envModel;
    }

    try {
      const settingsPromise = dbSettings.get();
      const timeoutPromise = new Promise<any>((resolve) => setTimeout(() => resolve({}), 600));
      const settings = await Promise.race([settingsPromise, timeoutPromise]);
      if (settings?.ollamaVisionModel?.trim()) {
        return settings.ollamaVisionModel.trim();
      }
    } catch {
      // ignore
    }

    return DEFAULT_OLLAMA_VISION_MODEL;
  }

  /**
   * Connects to the local Ollama server and lists all available vision-capable models.
   */
  public static async listVisionModels(): Promise<{
    isOnline: boolean;
    models: OllamaVisionModel[];
    defaultModel: string;
    baseUrl: string;
    error?: string;
  }> {
    const baseUrl = await this.getBaseUrl();
    const defaultModel = await this.getDefaultModel();

    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        return {
          isOnline: false,
          models: [],
          defaultModel,
          baseUrl,
          error: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = await res.json();
      const rawModels = Array.isArray(data.models) ? data.models : [];

      const visionKeywords = ['vl', 'vision', 'llava', 'bakllava', 'minicpm', 'moondream', 'qwen2.5vl', 'qwen3-vl', 'qwen', 'gemma-4'];

      const models: OllamaVisionModel[] = rawModels.map((m: any) => {
        const name = m.name || m.model || '';
        const lowerName = name.toLowerCase();
        const family = m.details?.family?.toLowerCase() || '';
        const families = Array.isArray(m.details?.families) ? m.details.families.map((f: string) => f.toLowerCase()) : [];
        const capabilities = Array.isArray(m.capabilities) ? m.capabilities.map((c: string) => c.toLowerCase()) : [];

        // Check if model supports vision
        const hasVisionCapability = capabilities.includes('vision');
        const hasVisionFamily = family.includes('vl') || family.includes('vision') || families.some((f: string) => f.includes('vl') || f.includes('vision'));
        const hasVisionName = visionKeywords.some((kw) => lowerName.includes(kw));

        const isVisionCapable = hasVisionCapability || hasVisionFamily || hasVisionName;

        return {
          id: name,
          name: name,
          size: m.size,
          parameterSize: m.details?.parameter_size,
          quantization: m.details?.quantization_level,
          isVisionCapable,
          modifiedAt: m.modified_at,
          family: m.details?.family,
        };
      });

      // Filter vision-capable models first
      const visionModels = models.filter((m) => m.isVisionCapable);

      // If no explicit vision models found, return all models with fallback
      const returnedModels = visionModels.length > 0 ? visionModels : models;

      return {
        isOnline: true,
        models: returnedModels,
        defaultModel,
        baseUrl,
      };
    } catch (err: any) {
      return {
        isOnline: false,
        models: [],
        defaultModel,
        baseUrl,
        error: `Could not connect to local Ollama server at ${baseUrl}. Please ensure Ollama is running ('ollama serve').`,
      };
    }
  }

  /**
   * Converts any uploaded document (PDF, Excel spreadsheet sheets, or images) into standardized individual PNG images.
   * NEVER sends raw document files directly to Ollama.
   */
  public static async convertDocumentToRenderedImages(
    buffer: Buffer,
    filename: string
  ): Promise<Array<{ pageNumber: number; label: string; image_base64: string }>> {
    return new Promise((resolve) => {
      const scriptPath = path.resolve(process.cwd(), 'backend', 'document_image_converter.py');
      const proc = spawn('python', [scriptPath, '--filename', filename]);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        const startMarker = '__DOC_IMAGES_JSON_START__';
        const endMarker = '__DOC_IMAGES_JSON_END__';

        if (code === 0 && stdout.includes(startMarker) && stdout.includes(endMarker)) {
          try {
            const jsonStr = stdout.substring(
              stdout.indexOf(startMarker) + startMarker.length,
              stdout.indexOf(endMarker)
            ).trim();
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
              const cleanPages = parsed.pages
                .map((p: any) => ({
                  pageNumber: Number(p.pageNumber) || 1,
                  label: String(p.label || `Page ${p.pageNumber || 1}`),
                  image_base64: String(p.image_base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, ''),
                }))
                .filter((p: any) => p.image_base64.length > 50);

              if (cleanPages.length > 0) {
                resolve(cleanPages);
                return;
              }
            }
          } catch (parseErr) {
            console.warn('[OllamaServer] Failed to parse document image converter JSON:', parseErr);
          }
        }

        if (stderr) {
          console.warn('[OllamaServer] Document image converter notice:', stderr);
        }

        // Fallback: If converter failed or returned empty, treat buffer as single image and sanitize
        let rawBase64 = buffer.toString('base64');
        rawBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
        if (rawBase64.length > 50) {
          resolve([{
            pageNumber: 1,
            label: 'Page 1',
            image_base64: rawBase64,
          }]);
        } else {
          resolve([]);
        }
      });

      proc.stdin.write(buffer);
      proc.stdin.end();
    });
  }

  /**
   * Builds the instruction prompt for Dedicated Handwriting Template
   */
  private static buildTemplatePrompt(
    template: HandwritingScanningTemplate,
    filename: string
  ): string {
    const fieldsDescription = template.fields.map((f) => ({
      field_name: f.field_name,
      value_type: f.value_type === 'h' ? 'handwritten' : 'digital/printed',
      search_direction: `look ${f.look_for} from the label "${f.field_name}"`,
    }));

    const rawTables =
      template.tables && template.tables.length > 0
        ? template.tables
        : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [];

    const tablesDescription = rawTables.map((tbl) => ({
      table_name: tbl.name,
      columns: (tbl.columns || []).map((c: any) => ({
        column_name: c.column_name || c.name,
        value_type: c.value_type === 'h' ? 'handwritten' : 'digital/printed',
      })),
    }));

    return `You are an expert Document and Handwriting Extraction Vision AI.

TASK SPECIFICATIONS:
1. Analyze the provided original document image directly.
2. Locate the configured fields on the document and extract their values accurately.
   - Clean up handwritten digit misrecognitions (spaced digits e.g. "9 9 4" -> "994").
   - For date fields (e.g. "Date"), normalize the extracted date into standard ISO format "YYYY-MM-DD" (e.g. "13/8/26" -> "2026-08-13").
3. Extract repeated table rows for each configured table matching its specific columns:
   - For EACH table defined in CONFIGURED TABLES, extract matching rows.
   - If a table has no rows or data on the document, preserve it as an empty table with "rows": [].
   - If a cell is empty or missing, preserve it as an empty string ("").
4. Preserve empty or unreadable fields as "" (empty string) in "field_values" and list them in "missing_fields".
5. Return ONLY valid JSON, with NO explanation, NO Markdown code fences, and NO additional text.

CONFIGURED FIELDS:
${JSON.stringify(fieldsDescription, null, 2)}

CONFIGURED TABLES:
${JSON.stringify(tablesDescription, null, 2)}

DOCUMENT FILENAME: "${filename}"

OUTPUT JSON SCHEMA:
{
  "template_name": "${template.name}",
  "field_values": {
    ${template.fields.map((f) => `"${f.field_name}": "..."`).join(',\n    ')}
  },
  "tables": [
    ${rawTables
      .map(
        (tbl) => `{
      "name": "${tbl.name}",
      "headers": ${JSON.stringify((tbl.columns || []).map((c: any) => c.column_name || c.name))},
      "rows": [
        {
          ${(tbl.columns || []).map((c: any) => `"${c.column_name || c.name}": "..."`).join(',\n          ')}
        }
      ]
    }`
      )
      .join(',\n    ')}
  ],
  "table_headers": ${JSON.stringify(template.table_columns.map((c) => c.column_name))},
  "table_rows": [
    {
      ${template.table_columns.map((c) => `"${c.column_name}": "..."`).join(',\n      ')}
    }
  ],
  "missing_fields": [],
  "confidenceScore": 92
}`;
  }

  /**
   * Builds the instruction prompt for Flexible or Standard DataTemplate Mode
   */
  private static buildFlexiblePrompt(
    template: DataTemplate | null,
    filename: string
  ): string {
    const fieldsList = template?.fields?.map((f) => f.name) || [];
    const tableCols = template?.tableFields?.map((f) => f.name) || [];

    return `You are an expert Document and Handwriting Extraction Vision AI.

TASK SPECIFICATIONS:
1. Analyze the provided original document image directly.
2. Identify all key-value attributes, header fields, and tabular data from the document.
${template ? `3. Match the configured template fields: ${JSON.stringify(fieldsList)}` : '3. Detect all written labels and values.'}
${tableCols.length > 0 ? `4. Extract table rows matching columns: ${JSON.stringify(tableCols)}` : '4. If repeated table rows exist, extract their headers and rows.'}
5. Clean and normalize handwritten values.
6. Return ONLY valid JSON, with NO explanation, NO Markdown code fences, and NO additional text.
7. Preserve empty/missing values as "" (empty string).

DOCUMENT FILENAME: "${filename}"

OUTPUT JSON SCHEMA:
{
  "title": "Extracted Document Record",
  "field_values": {
    "Field Name": "Extracted Value"
  },
  "flexibleFields": [
    { "name": "Field Name", "value": "Extracted Value" }
  ],
  "table_headers": ["Column 1", "Column 2"],
  "table_rows": [
    { "Column 1": "Val 1", "Column 2": "Val 2" }
  ],
  "missing_fields": [],
  "structured_text": "Human-readable summary of document contents",
  "confidenceScore": 90
}`;
  }

  /**
   * Resolves final Ollama options from request params, saved user settings, and defaults.
   * Ensures an appropriate lower context (e.g. 2048 or 4096) is used instead of 32768.
   */
  public static async resolveOptions(
    customOptions?: OllamaGenerationOptions,
    promptLength: number = 2000
  ): Promise<Record<string, any>> {
    let savedOptions: OllamaGenerationOptions = {};
    try {
      const settings = await dbSettings.get();
      if (settings?.ollamaOptions) {
        savedOptions = settings.ollamaOptions;
      }
    } catch {
      // ignore
    }

    const merged: OllamaGenerationOptions = {
      ...DEFAULT_OLLAMA_OPTIONS,
      ...savedOptions,
      ...customOptions,
    };

    // Calculate appropriate lower num_ctx (avoid unnecessary 32768)
    let finalNumCtx = merged.num_ctx;
    if (!finalNumCtx || finalNumCtx > 8192 || finalNumCtx < 1024) {
      // Calculate based on prompt + vision tokens + response headroom
      const estimatedPromptTokens = Math.ceil(promptLength / 3.5);
      const estimatedVisionTokens = 1000;
      const expectedOutputTokens = merged.num_predict || 2048;
      const calculated = estimatedPromptTokens + estimatedVisionTokens + expectedOutputTokens;
      // Clamp between 2048 and 4096 for optimal speed & memory footprint
      finalNumCtx = Math.min(Math.max(calculated, 2048), 4096);
    }

    const optionsPayload: Record<string, any> = {
      temperature: typeof merged.temperature === 'number' ? merged.temperature : 0.1,
      num_predict: typeof merged.num_predict === 'number' ? merged.num_predict : 2048,
      num_ctx: finalNumCtx,
    };

    if (typeof merged.top_p === 'number') optionsPayload.top_p = merged.top_p;
    if (typeof merged.top_k === 'number') optionsPayload.top_k = merged.top_k;
    if (typeof merged.repeat_penalty === 'number') optionsPayload.repeat_penalty = merged.repeat_penalty;
    if (typeof merged.repeat_last_n === 'number') optionsPayload.repeat_last_n = merged.repeat_last_n;
    if (typeof merged.seed === 'number' && !isNaN(merged.seed)) optionsPayload.seed = merged.seed;
    if (Array.isArray(merged.stop) && merged.stop.length > 0) optionsPayload.stop = merged.stop;
    if (typeof merged.min_p === 'number' && !isNaN(merged.min_p)) optionsPayload.min_p = merged.min_p;
    if (typeof merged.num_batch === 'number' && !isNaN(merged.num_batch)) optionsPayload.num_batch = merged.num_batch;
    if (typeof merged.num_gpu === 'number' && !isNaN(merged.num_gpu)) optionsPayload.num_gpu = merged.num_gpu;

    return optionsPayload;
  }

  /**
   * Direct Document Multimodal Extraction with Ollama Vision
   */
  public static async extractFromDocument(params: OllamaExtractionParams): Promise<{
    pages: OcrPageResult[];
    entries: SessionDataEntry[];
    extractionResponse: HandwritingExtractionApiResponse;
  }> {
    const {
      buffer,
      filename,
      mimeType = 'image/png',
      model,
      options,
      handwritingTemplate,
      template,
      mode = 'template',
    } = params;

    const startTime = Date.now();
    const baseUrl = await this.getBaseUrl();
    let selectedModel = model?.trim() || (await this.getDefaultModel());

    // Verify model availability and fallback if requested model is not installed
    try {
      const modelList = await this.listVisionModels();
      if (modelList.isOnline && modelList.models.length > 0) {
        const isSelectedAvailable = modelList.models.some(
          (m) => m.id.toLowerCase() === selectedModel.toLowerCase()
        );
        if (!isSelectedAvailable) {
          const fallback = modelList.models[0].id;
          console.warn(
            `[Ollama Vision] Requested model '${selectedModel}' not found in installed models. Falling back to available vision model '${fallback}'.`
          );
          selectedModel = fallback;
        }
      }
    } catch {
      // ignore check error
    }

    // 1. NEVER send the raw uploaded document/file directly to Ollama.
    // Convert/render every document page/sheet into an individual image first.
    const renderedPages = await this.convertDocumentToRenderedImages(buffer, filename);
    if (!renderedPages || renderedPages.length === 0) {
      throw new Error(
        `Could not convert document "${filename}" into image format for Ollama Vision. Please ensure Python is available or upload a valid image/PDF/Excel sheet.`
      );
    }

    console.log(
      `[Ollama Vision] Document "${filename}" rendered into ${renderedPages.length} image page(s)/sheet(s). Processing one by one...`
    );

    const ocrPages: OcrPageResult[] = [];
    const entries: SessionDataEntry[] = [];
    let aggregatedFields: HandwritingFieldExtractionResult[] = [];
    let aggregatedFieldValues: Record<string, string> = {};
    let aggregatedTableHeaders: string[] = [];
    let aggregatedTableRows: Array<Record<string, string>> = [];
    let aggregatedStructuredText = '';

    // 2. If multiple sheets/pages are uploaded, process them one by one as separate images.
    for (let pageIdx = 0; pageIdx < renderedPages.length; pageIdx++) {
      const { pageNumber, label, image_base64 } = renderedPages[pageIdx];
      let pageBase64 = image_base64.trim().replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, '');

      if (!pageBase64 || pageBase64.length < 50) {
        console.warn(`[Ollama Vision] Skipping ${label}: invalid or empty base64 image data.`);
        continue;
      }

      const prompt =
        mode === 'template' && handwritingTemplate
          ? this.buildTemplatePrompt(handwritingTemplate, filename)
          : this.buildFlexiblePrompt(template || null, filename);

      console.log(
        `[Ollama Vision] Sending image for ${label} (${pageIdx + 1}/${renderedPages.length}) to Ollama model '${selectedModel}' at ${baseUrl}...`
      );

      // Resolve final options and log exact parameters sent to Ollama
      const resolvedOptions = await this.resolveOptions(options, prompt.length);

      console.log('================================================================================');
      console.log(`=== [OLLAMA VISION REQUEST DISPATCH: ${filename}] ===`);
      console.log(`Endpoint: ${baseUrl}/api/chat`);
      console.log(`Model: ${selectedModel}`);
      console.log(`Target Page/Sheet: ${label} (${pageIdx + 1}/${renderedPages.length})`);
      console.log('--- EXACT RESOLVED OLLAMA PARAMETERS & OPTIONS ---');
      console.dir({
        model: selectedModel,
        options: resolvedOptions,
        format: 'json',
        stream: true,
      }, { depth: null });
      console.log('================================================================================');

      let rawContent = '';
      try {
        // Send ONLY the single page/sheet image to Ollama vision model
        const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are an expert Document and Handwriting Extraction Vision AI. Extract text, attributes, and tabular data directly from the image. Do not explain or think. Output valid JSON only matching the requested schema.',
              },
              {
                role: 'user',
                content: prompt,
                images: [pageBase64],
              },
            ],
            options: resolvedOptions,
            format: 'json',
            stream: true,
          }),
        });

        if (!ollamaRes.ok) {
          const errData = await ollamaRes.json().catch(() => ({}));
          const errMsg = errData.error || `HTTP ${ollamaRes.status}: ${ollamaRes.statusText}`;

          if (errMsg.includes('out-of-memory') || errMsg.includes('buffer of size')) {
            throw new Error(`Ollama Vision model '${selectedModel}' ran out of memory. Try selecting a smaller vision model or restarting Ollama.`);
          }
          if (errMsg.includes('model') && errMsg.includes('not found')) {
            throw new Error(`Ollama model '${selectedModel}' is not installed. Run 'ollama pull ${selectedModel}' or choose an installed model.`);
          }
          throw new Error(`Ollama Vision API error: ${errMsg}`);
        }

        // Read streaming chunks to prevent Node.js socket / header timeout
        if (ollamaRes.body) {
          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let bufferStr = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bufferStr += decoder.decode(value, { stream: true });
            const lines = bufferStr.split('\n');
            bufferStr = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line);
                if (chunk.message?.content) {
                  rawContent += chunk.message.content;
                } else if (chunk.response) {
                  rawContent += chunk.response;
                }
              } catch {}
            }
          }

          if (bufferStr.trim()) {
            try {
              const chunk = JSON.parse(bufferStr);
              if (chunk.message?.content) {
                rawContent += chunk.message.content;
              } else if (chunk.response) {
                rawContent += chunk.response;
              }
            } catch {}
          }
        } else {
          const data = await ollamaRes.json();
          rawContent = data.message?.content || data.response || '';
        }

        // Log raw LLM response directly to backend console
        console.log('================================================================================');
        console.log(`=== [OLLAMA VISION COMPLETE RAW LLM OUTPUT: ${filename} (Model: ${selectedModel}, ${label})] ===`);
        console.log(rawContent);
        console.log('================================================================================');
      } catch (networkErr: any) {
        console.error(`[Ollama Vision] fetch exception for ${label}:`, networkErr?.message, 'Cause:', networkErr?.cause);
        if (networkErr.message?.includes('ECONNREFUSED')) {
          throw new Error(`Could not connect to local Ollama server at ${baseUrl}. Please verify Ollama is running ('ollama serve').`);
        }
        throw networkErr;
      }

      const parsed = cleanAndParseJson(rawContent);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Ollama Vision model '${selectedModel}' did not return valid JSON format.`);
      }

      // Extract field values
      const fieldValues: Record<string, string> = {};
      if (parsed.field_values && typeof parsed.field_values === 'object') {
        Object.entries(parsed.field_values).forEach(([k, v]) => {
          let strVal = v !== null && v !== undefined ? String(v).trim() : '';
          if (k.toLowerCase().includes('date') && strVal) {
            strVal = normalizeToIsoDate(strVal);
          }
          fieldValues[k] = strVal;
        });
      }

      // Ensure all defined template fields exist with default empty string
      if (handwritingTemplate) {
        handwritingTemplate.fields.forEach((f) => {
          if (fieldValues[f.field_name] === undefined) {
            fieldValues[f.field_name] = '';
          }
        });
      }

      // Table headers and rows
      const tableHeaders: string[] = Array.isArray(parsed.table_headers)
        ? parsed.table_headers
        : handwritingTemplate?.table_columns.map((c) => c.column_name) || [];

      const rawTableRows: any[] = Array.isArray(parsed.table_rows) ? parsed.table_rows : [];
      const normalizedTableRows: Array<Record<string, string>> = rawTableRows.map((row) => {
        const rowObj: Record<string, string> = {};
        tableHeaders.forEach((header, colIdx) => {
          if (Array.isArray(row)) {
            rowObj[header] = row[colIdx] !== undefined && row[colIdx] !== null ? String(row[colIdx]) : '';
          } else if (typeof row === 'object' && row !== null) {
            rowObj[header] = row[header] !== undefined && row[header] !== null ? String(row[header]) : '';
          } else {
            rowObj[header] = '';
          }
        });
        return rowObj;
      });

      // Construct detailed field extraction results
      const fieldResults: HandwritingFieldExtractionResult[] = handwritingTemplate
        ? handwritingTemplate.fields.map((f) => ({
            field_name: f.field_name,
            field_type: f.field_type,
            value_type: f.value_type,
            look_for: f.look_for,
            value: fieldValues[f.field_name] || '',
            confidence: fieldValues[f.field_name] ? 92 : 0,
            source: 'ollama_vision',
          }))
        : Object.entries(fieldValues).map(([name, val]) => ({
            field_name: name,
            field_type: 'digital',
            value_type: 'h',
            look_for: 'right',
            value: String(val),
            confidence: val ? 90 : 0,
            source: 'ollama_vision',
          }));

      // Generate structured summary
      const structuredSummary = this.generateStructuredSummary(fieldValues, tableHeaders, normalizedTableRows);

      // OCR Page review entry
      ocrPages.push({
        pageNumber,
        imageUrl: `data:image/png;base64,${pageBase64}`,
        ocrText: structuredSummary,
      });

      // Table rows as array of arrays for SessionDataEntry format
      const tableRowsArray: any[][] = normalizedTableRows.map((row) =>
        tableHeaders.map((header) => row[header] || '')
      );

      // Auto-Fill Lookup & Strict Validation
      let lookupValidation: LookupValidationStatus | null = null;
      let finalFieldValues: Record<string, any> = { ...fieldValues };
      const effectiveLookupConfig = handwritingTemplate?.lookupConfig || template?.lookupConfig;

      if (effectiveLookupConfig?.enabled) {
        const lookupTemplate: DataTemplate = template || {
          id: handwritingTemplate?.id || 'handwriting_scanning_default',
          name: handwritingTemplate?.name || 'Handwriting Scanning Template',
          description: handwritingTemplate?.description,
          fields: (handwritingTemplate?.fields || []).map((f) => ({
            id: f.id,
            name: f.field_name,
            extractionKey: f.field_name,
            type: 'text' as any,
          })),
          hasTable: Boolean(handwritingTemplate?.table_columns && handwritingTemplate.table_columns.length > 0),
          tableFields: (handwritingTemplate?.table_columns || []).map((c) => ({
            id: c.id,
            name: c.column_name,
            extractionKey: c.column_name,
            type: 'text' as any,
          })),
          lookupConfig: effectiveLookupConfig,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        try {
          const lookupRes = await GroqServer.processLookupAutoFillAndValidation(
            lookupTemplate,
            finalFieldValues,
            structuredSummary
          );
          finalFieldValues = lookupRes.fieldValues;
          lookupValidation = lookupRes.lookupValidation;

          if (lookupRes.fieldValues) {
            fieldResults.forEach((fr) => {
              if (lookupRes.fieldValues[fr.field_name] !== undefined) {
                fr.value = String(lookupRes.fieldValues[fr.field_name]);
              }
            });
          }
        } catch (lErr) {
          console.warn('[OllamaServer] Lookup auto-fill notice:', lErr);
        }
      }

      const rawTables =
        handwritingTemplate?.tables && handwritingTemplate.tables.length > 0
          ? handwritingTemplate.tables
          : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || [];

      const allExtractedTables: EntryTableData[] = rawTables.map((tDef) => {
        const found = Array.isArray(parsed.tables)
          ? parsed.tables.find(
              (et: any) => et.name?.toLowerCase().trim() === tDef.name.toLowerCase().trim()
            )
          : null;
        const headers = (tDef.columns || []).map((c: any) => c.column_name || c.name);
        if (found && Array.isArray(found.rows)) {
          return {
            name: tDef.name,
            headers: found.headers && found.headers.length > 0 ? found.headers : headers,
            rows: found.rows,
          };
        }
        return {
          name: tDef.name,
          headers,
          rows: [],
        };
      });

      // Create SessionDataEntry
      const entry: SessionDataEntry = {
        id: `ollama_entry_${Date.now()}_${pageNumber}`,
        entryNumber: pageIdx + 1,
        sourceType: 'handwritten',
        mode,
        templateId: handwritingTemplate?.id || template?.id || (mode === 'template' ? 'default' : 'flexible'),
        templateName: handwritingTemplate?.name || template?.name || (mode === 'template' ? 'Template Form' : 'Flexible Notes'),
        title: `${handwritingTemplate?.name || template?.name || 'Handwritten Record'} (${filename}${renderedPages.length > 1 ? ` ${label}` : ''})`,
        fieldValues: finalFieldValues,
        tableTitle: allExtractedTables[0]?.name || 'Production Table Entries',
        tableHeaders: allExtractedTables[0]?.headers || tableHeaders,
        tableRows: tableRowsArray,
        tables: allExtractedTables,
        rawOcrText: structuredSummary,
        confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 92,
        lookupValidation: lookupValidation || undefined,
        createdAt: new Date().toISOString(),
      };

      entries.push(entry);

      // Aggregate page data
      if (pageIdx === 0) {
        aggregatedFields = fieldResults;
        aggregatedFieldValues = finalFieldValues;
        aggregatedTableHeaders = tableHeaders;
        aggregatedTableRows = normalizedTableRows;
        aggregatedStructuredText = structuredSummary;
      } else {
        aggregatedFields.push(...fieldResults);
        aggregatedTableRows.push(...normalizedTableRows);
        aggregatedStructuredText += `\n\n--- ${label} ---\n` + structuredSummary;
      }
    }

    const durationMs = Date.now() - startTime;

    const extractionResponse: HandwritingExtractionApiResponse = {
      success: true,
      filename,
      template_name: handwritingTemplate?.name || template?.name || 'Handwriting Scanning Template',
      fields: aggregatedFields,
      field_values: aggregatedFieldValues,
      table_headers: aggregatedTableHeaders,
      table_rows: aggregatedTableRows,
      tables: entries[0]?.tables || [],
      structured_text: aggregatedStructuredText,
      raw_text: aggregatedStructuredText,
      total_pages: renderedPages.length,
      processing_time_ms: durationMs,
      device: `Ollama Local Vision (${selectedModel})`,
    };

    // Log complete Ollama Vision extraction output directly to backend terminal console
    console.log('================================================================================');
    console.log(`=== [OLLAMA VISION COMPLETE EXTRACTION OUTPUT: ${filename}] ===`);
    console.log(`Model: ${selectedModel} | Pages/Sheets: ${renderedPages.length} | Processing Duration: ${durationMs}ms`);
    console.log('--- EXTRACTED FIELD VALUES ---');
    console.dir(aggregatedFieldValues, { depth: null });
    console.log('--- TABLE HEADERS ---');
    console.log(aggregatedTableHeaders);
    console.log('--- TABLE ROWS ---');
    console.dir(aggregatedTableRows, { depth: null });
    console.log('--- STRUCTURED TEXT ---');
    console.log(aggregatedStructuredText);
    console.log('================================================================================');

    return {
      pages: ocrPages,
      entries,
      extractionResponse,
    };
  }

  /**
   * Helper to format a clean text summary of fields and table rows
   */
  private static generateStructuredSummary(
    fieldValues: Record<string, string>,
    headers: string[],
    rows: Array<Record<string, string>>
  ): string {
    const lines: string[] = ['=== EXTRACTED FIELDS (OLLAMA VISION) ==='];
    Object.entries(fieldValues).forEach(([k, v]) => {
      lines.push(`${k}: ${v || '[Empty]'}`);
    });

    if (headers.length > 0 && rows.length > 0) {
      lines.push('\n=== PRODUCTION TABLE ROWS ===');
      lines.push(headers.join(' | '));
      lines.push(headers.map(() => '---').join(' | '));
      rows.forEach((r) => {
        const rowVals = headers.map((h) => r[h] || '');
        lines.push(rowVals.join(' | '));
      });
    }

    return lines.join('\n');
  }
}
