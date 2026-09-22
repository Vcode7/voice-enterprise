import {
  DataTemplate,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  HandwritingFieldExtractionResult,
  SessionDataEntry,
  OcrPageResult,
  LookupValidationStatus,
  EntryTableData,
} from '../../types';
import { dbSettings, dbLookupTables } from '../db/models';
import { GroqServer } from '../groq/groqServer';
import { cleanAndParseJson, normalizeNumericFieldValue } from '../utils/jsonParser';
import { normalizeToIsoDate } from '../utils/dateUtils';

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const ALLOWED_GEMINI_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
];

export const MAX_GEMINI_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB inline limit

export interface GeminiKeyEntry {
  key: string;
  label: string;
}

export interface GeminiKeyStatusInfo {
  hasEnvKey: boolean;
  hasCustomKey: boolean;
  isConfigured: boolean;
  activeKeyType: 'primary_env' | 'backup_custom' | 'none';
  totalConfiguredKeys?: number;
  keyLabels?: string[];
  model: string;
}

export class GeminiServer {
  /**
   * Retrieves the configured Gemini model name.
   * Defaults to gemini-3.5-flash-lite (fastest, low-latency, cost-effective multimodal model).
   * Automatically upgrades deprecated models like gemini-2.5-flash to gemini-3.5-flash-lite.
   */
  public static getModel(): string {
    const envModel = process.env.GEMINI_MODEL?.trim();
    if (envModel && envModel !== '' && envModel !== 'gemini-2.5-flash') {
      return envModel;
    }
    return DEFAULT_GEMINI_MODEL;
  }

  /**
   * Collects all available Gemini API keys from .env, fallbacks, and user settings
   */
  public static async getAllKeys(customKeyOverride?: string | null): Promise<GeminiKeyEntry[]> {
    let settings: any = {};
    try {
      settings = await dbSettings.get();
    } catch {
      settings = {};
    }

    const keys: GeminiKeyEntry[] = [];
    const seen = new Set<string>();

    const addKey = (rawKey: string | undefined | null, label: string) => {
      if (!rawKey) return;
      const trimmed = rawKey.trim();
      if (
        trimmed !== '' &&
        !trimmed.includes('your_gemini_api_key') &&
        !trimmed.includes('your_fallback_key') &&
        !seen.has(trimmed)
      ) {
        seen.add(trimmed);
        keys.push({ key: trimmed, label });
      }
    };

    // Primary .env key
    addKey(process.env.GEMINI_API_KEY, 'Base Primary .env Key');

    // Static fallback env references
    addKey(process.env.GEMINI_API_KEY_FALLBACK1, '.env Fallback Key #1');
    addKey(process.env.GEMINI_API_KEY_FALLBACK2, '.env Fallback Key #2');
    addKey(process.env.GEMINI_API_KEY_FALLBACK3, '.env Fallback Key #3');

    // Dynamic discovery for GEMINI_API_KEY_FALLBACK*
    if (typeof process !== 'undefined' && process.env) {
      const dynamicKeys = Object.keys(process.env)
        .filter((k) => k.startsWith('GEMINI_API_KEY_FALLBACK'))
        .sort();

      for (const k of dynamicKeys) {
        const numMatch = k.match(/FALLBACK(\d+)/i);
        const label = numMatch ? `.env Fallback Key #${numMatch[1]}` : `.env Fallback (${k})`;
        addKey(process.env[k], label);
      }
    }

    // User settings custom key override
    addKey(customKeyOverride || settings.customGeminiApiKey, 'User Settings Key');

    return keys;
  }

  /**
   * Status of Gemini API key configuration
   */
  public static async getKeyStatus(): Promise<GeminiKeyStatusInfo> {
    const keys = await this.getAllKeys();
    let settings: any = {};
    try {
      settings = await dbSettings.get();
    } catch {
      settings = {};
    }

    const envKey = process.env.GEMINI_API_KEY;
    const hasEnvKey = !!(envKey && envKey.trim() !== '' && !envKey.includes('your_gemini_api_key'));
    const customKey = settings.customGeminiApiKey?.trim() || null;
    const hasCustomKey = !!(customKey && customKey !== '');

    return {
      hasEnvKey,
      hasCustomKey,
      isConfigured: keys.length > 0,
      activeKeyType: keys.length > 0 ? (hasEnvKey ? 'primary_env' : 'backup_custom') : 'none',
      totalConfiguredKeys: keys.length,
      keyLabels: keys.map((k) => k.label),
      model: this.getModel(),
    };
  }

  /**
   * Helper to execute requests across keys and candidate models with automatic failover
   */
  public static async executeWithFailover<T>(
    operationName: string,
    customKeyOverride: string | null | undefined,
    operation: (apiKey: string, model: string) => Promise<T>
  ): Promise<T> {
    const keys = await this.getAllKeys(customKeyOverride);
    const initialModel = this.getModel();
    const candidateModels = [
      initialModel,
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-flash-latest',
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    if (keys.length === 0) {
      throw new Error(
        'Gemini API Key is not configured. Please add GEMINI_API_KEY to your .env file or enter it in Settings.'
      );
    }

    let lastError: any = null;

    for (let i = 0; i < keys.length; i++) {
      const { key, label } = keys[i];

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        const currentModel = candidateModels[mIdx];
        try {
          console.log(`✨ [Gemini Server] Executing ${operationName} using ${label} with model ${currentModel}`);
          return await operation(key, currentModel);
        } catch (error: any) {
          lastError = error;
          const status = error?.status || 0;
          const msg = error?.message || '';

          // If model is 404, 503 (high demand), or deprecated, automatically try next candidate model
          const isModelUnavailableOrDeprecated =
            status === 404 ||
            status === 503 ||
            /no longer available|not found|NOT_FOUND|unknown model|high demand|temporarily unavailable|UNAVAILABLE/i.test(msg);

          if (isModelUnavailableOrDeprecated && mIdx < candidateModels.length - 1) {
            console.warn(
              `⚠️ [Gemini Server] Model ${currentModel} returned ${status || 'unavailable'} (${msg.slice(0, 100)}). Falling back to ${candidateModels[mIdx + 1]}...`
            );
            continue;
          }

          const isRateLimit = status === 429 || msg.includes('429') || /quota|rate_limit|resource_exhausted/i.test(msg);
          const isAuthError = status === 401 || status === 403 || /unauthorized|invalid api key|api_key_invalid/i.test(msg);
          const isTimeout = status === 504 || error?.isTimeout || /timed out|timeout|aborted/i.test(msg);
          const isServerError = (status >= 500 && status < 600) || status === 503 || isTimeout;

          const canFailoverKey = isRateLimit || isAuthError || isServerError;

          if (canFailoverKey && i < keys.length - 1) {
            console.warn(
              `⚠️ [Gemini Server] ${label} failed (${status || 'error'}). Failing over to next key (${keys[i + 1].label})...`
            );
            break; // Try next key
          }

          throw error;
        }
      }
    }

    throw lastError || new Error('Gemini API request failed.');
  }

  /**
   * Validates uploaded file MIME type and size
   */
  public static validateDocument(buffer: Buffer, mimeType: string, filename: string): void {
    const cleanMime = (mimeType || '').toLowerCase().trim();
    const extMatch = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1]}` : '';

    let effectiveMime = cleanMime;
    if (!effectiveMime || effectiveMime === 'application/octet-stream') {
      if (ext === '.pdf') effectiveMime = 'application/pdf';
      else if (ext === '.png') effectiveMime = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') effectiveMime = 'image/jpeg';
      else if (ext === '.webp') effectiveMime = 'image/webp';
    }

    const isAllowedMime = ALLOWED_GEMINI_MIME_TYPES.includes(effectiveMime);
    const isAllowedExt = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext);

    if (!isAllowedMime && !isAllowedExt) {
      throw new Error(
        `Unsupported file format "${ext || mimeType}". Supported formats for Gemini direct extraction: PDF, PNG, JPG, JPEG, WebP.`
      );
    }

    if (buffer.length > MAX_GEMINI_FILE_SIZE_BYTES) {
      const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
      throw new Error(
        `Document is too large (${sizeMb} MB). Maximum supported size for direct Gemini inline analysis is 20 MB.`
      );
    }
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
        : [
            {
              id: 'table_production_log',
              name: 'Production Table',
              columns: template.table_columns,
            },
          ];

    const tablesDescription = rawTables.map((t) => ({
      table_name: t.name,
      columns: (t.columns || []).map((c) => ({
        column_name: c.column_name,
        value_type: c.value_type === 'h' ? 'handwritten' : 'digital/printed',
      })),
    }));

    let lookupGuidance = '';
    if (template.lookupConfig?.enabled) {
      const mapped = (template.lookupConfig.fieldMappings || []).map((m) => m.fieldKey).join(', ');
      lookupGuidance = `
MASTER TABLE AUTO-FILL & LOOKUP CONTEXT:
- Master Catalog Table: "${template.lookupConfig.tableName || 'Master Table'}"
- Main Lookup Key: "${template.lookupConfig.mainFieldKey}"
- Auto-Filled Fields: ${mapped || 'Machine Name, Description, Raw Material, Cycle Time'}
- Note: Prioritize extracting "${template.lookupConfig.mainFieldKey}" accurately from the document. The system will cross-verify and auto-fill related fields from the master catalog.
`;
    }

    return `You are an expert Handwriting Document & Production Sheet Extraction Engine.

TASK SPECIFICATIONS:
1. Analyze the provided original document image/PDF directly. Do NOT rely on pre-extracted OCR text.
2. Identify the configured fields from the document. Locate the printed or handwritten field label and extract the value in the configured search direction.
3. Extract the corresponding values from the document accurately.
   - Clean up handwritten digit misrecognitions (e.g. pen stroke artifacts, spaced digits like "9 9 4" -> "994", stray pen dots in integer counts).
   - Normalize numeric values while preserving actual decimal points.
   - For date fields (e.g. "Date", "Planned Production Date"), normalize the extracted date into standard ISO format "YYYY-MM-DD" (e.g. "13/8/26" -> "2026-08-13", "13/08/2026" -> "2026-08-13") so date inputs display correctly.
4. Extract ALL configured tables from the document:
   - For EACH configured table, extract rows strictly matching its columns.
   - CRITICAL: EVERY defined table must appear in the "tables" array. If a table has no data on the document (e.g. no rejection entries found), it MUST still appear as an empty table with all its defined headers and rows: [].
   - If a cell is empty or missing, preserve it as an empty string ("").
5. Follow the existing field/lookup rules used by the handwriting scanner:
   - Match the exact field names in "field_values" and "fields".
   - Match the exact column names in table headers and rows.
6. Preserve empty/missing values according to the application's existing JSON convention:
   - Any configured field not found or empty on the document MUST be set to "" in "field_values" and listed in "missing_fields".
7. Return ONLY valid JSON, with NO explanation, NO Markdown fences, and NO additional text.
${lookupGuidance}
CONFIGURED TEMPLATE FIELDS:
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
      "headers": ${JSON.stringify((tbl.columns || []).map((c) => c.column_name))},
      "rows": [
        {
          ${(tbl.columns || []).map((c) => `"${c.column_name}": "..."`).join(',\n          ')}
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
  "confidenceScore": 95
}

NOTE: If the document contains multiple distinct pages or sheets (e.g. multi-page PDF), wrap them in:
{
  "pages": [
    {
      "pageNumber": 1,
      "field_values": { ... },
      "tables": [...],
      "table_headers": [...],
      "table_rows": [...],
      "missing_fields": [],
      "confidenceScore": 95
    }
  ]
}
Otherwise, return the single root object.`;
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

    return `You are an expert Document and Handwriting Extraction AI.

TASK SPECIFICATIONS:
1. Analyze the provided original document image/PDF directly.
2. Identify all key-value attributes, header fields, and tabular data from the document.
${template ? `3. Prioritize matching the configured template fields: ${JSON.stringify(fieldsList)}` : '3. Detect all written labels and values.'}
${tableCols.length > 0 ? `4. Extract table rows matching columns: ${JSON.stringify(tableCols)}` : '4. If repeated table rows exist, extract their headers and rows.'}
5. Clean and normalize handwritten values:
   - Fix digit misrecognitions and pen stroke artifacts.
   - For integer quantities, resolve spaced digits ("9 9 4" -> "994").
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
  "structured_text": "Human-readable summary of the document contents",
  "confidenceScore": 90
}`;
  }

  /**
   * Direct Document Multimodal Extraction with Gemini 2.5 Flash
   */
  public static async extractFromDocument(params: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    handwritingTemplate?: HandwritingScanningTemplate | null;
    template?: DataTemplate | null;
    mode?: 'template' | 'flexible';
    customKey?: string | null;
  }): Promise<{
    extractionResponse: HandwritingExtractionApiResponse;
    entries: SessionDataEntry[];
    pages: OcrPageResult[];
  }> {
    const startTime = Date.now();
    const { buffer, filename, mimeType, handwritingTemplate, template, mode = 'template', customKey } = params;

    // 1. Validate file format and size
    this.validateDocument(buffer, mimeType, filename);

    // Normalize mimeType
    let cleanMime = mimeType;
    if (filename.toLowerCase().endsWith('.pdf')) cleanMime = 'application/pdf';
    else if (filename.toLowerCase().endsWith('.png')) cleanMime = 'image/png';
    else if (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')) cleanMime = 'image/jpeg';
    else if (filename.toLowerCase().endsWith('.webp')) cleanMime = 'image/webp';

    const base64Data = buffer.toString('base64');

    // 2. Construct Prompt based on template mode
    const prompt = handwritingTemplate
      ? this.buildTemplatePrompt(handwritingTemplate, filename)
      : this.buildFlexiblePrompt(template || null, filename);

    // 3. Execute Gemini 2.5 Flash Request with failover support
    const rawResultText = await this.executeWithFailover(
      `Gemini Handwriting Extraction (${filename})`,
      customKey,
      async (apiKey, model) => {
        const url = `${GEMINI_API_BASE_URL}/${model}:generateContent?key=${apiKey}`;

        const payload = {
          systemInstruction: {
            parts: [
              {
                text: 'You are an automated, high-precision document and handwriting extraction engine. Output ONLY strictly valid JSON adhering to the provided schema. Do NOT produce chain-of-thought explanations, preambles, or markdown wrappers. Output the JSON directly and immediately.',
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: base64Data,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 16384,
          },
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 240000); // 240s (4 min) timeout for multi-page documents

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            const err: any = new Error(`Gemini API returned status ${res.status}: ${errText}`);
            err.status = res.status;
            err.errorText = errText;
            throw err;
          }

          const responseData = await res.json();
          const candidate = responseData?.candidates?.[0];

          // Safely extract text from all parts (in case thoughtSignature or other metadata is present)
          const textPart = candidate?.content?.parts
            ?.map((p: any) => p.text)
            .filter(Boolean)
            .join('\n');

          if (!textPart) {
            throw new Error('Gemini returned an empty candidate or no text part.');
          }

          return textPart;
        } catch (fetchErr: any) {
          if (fetchErr?.name === 'AbortError' || /aborted/i.test(fetchErr?.message)) {
            const timeoutErr: any = new Error(
              `Gemini extraction timed out after 240 seconds for "${filename}". ` +
              `If this is a large or high-resolution multi-page PDF, consider extracting pages individually or compressing the document.`
            );
            timeoutErr.status = 504;
            timeoutErr.isTimeout = true;
            throw timeoutErr;
          }
          throw fetchErr;
        } finally {
          clearTimeout(timeoutId);
        }
      }
    );

    // 4. Safely Extract and Parse JSON (handles markdown wrappers, backticks, trailing prose)
    let parsed: any;
    try {
      parsed = cleanAndParseJson(rawResultText);
    } catch (parseErr: any) {
      console.error('Failed to parse Gemini JSON output:', rawResultText);
      throw new Error(`Gemini response could not be parsed as valid JSON: ${parseErr.message}`);
    }

    const processingTimeMs = Date.now() - startTime;

    // 5. Normalize Single vs Multiple Page responses
    let pageItems: any[] = [];
    if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
      pageItems = parsed.pages;
    } else {
      pageItems = [{ ...parsed, pageNumber: 1 }];
    }

    const ocrPages: OcrPageResult[] = [];
    const entries: SessionDataEntry[] = [];
    let aggregatedFields: HandwritingFieldExtractionResult[] = [];
    let aggregatedFieldValues: Record<string, string> = {};
    let aggregatedTableHeaders: string[] = [];
    let aggregatedTableRows: Array<Record<string, string>> = [];
    let aggregatedStructuredText = '';

    for (let i = 0; i < pageItems.length; i++) {
      const p = pageItems[i];
      const pageNumber = p.pageNumber || i + 1;

      // Extract field values
      let fieldValues: Record<string, string> = {};
      if (p.field_values && typeof p.field_values === 'object') {
        Object.entries(p.field_values).forEach(([k, v]) => {
          let strVal = v !== null && v !== undefined ? String(v).trim() : '';
          if (k.toLowerCase().includes('date') && strVal) {
            strVal = normalizeToIsoDate(strVal);
          }
          fieldValues[k] = strVal;
        });
      }

      // If dedicated handwritingTemplate provided, ensure all defined fields exist
      if (handwritingTemplate) {
        handwritingTemplate.fields.forEach((f) => {
          if (fieldValues[f.field_name] === undefined) {
            fieldValues[f.field_name] = '';
          }
        });
      }

      // Normalize table headers and rows
      const tableHeaders: string[] = Array.isArray(p.table_headers)
        ? p.table_headers
        : handwritingTemplate?.table_columns.map((c) => c.column_name) || [];

      const rawTableRows: any[] = Array.isArray(p.table_rows) ? p.table_rows : [];
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
            confidence: fieldValues[f.field_name] ? 95 : 0,
            source: 'gemini',
          }))
        : Object.entries(fieldValues).map(([name, val]) => ({
            field_name: name,
            field_type: 'digital',
            value_type: 'h',
            look_for: 'right',
            value: String(val),
            confidence: val ? 95 : 0,
            source: 'gemini',
          }));

      // Generate structured text preview if missing
      const structuredText = p.structured_text || this.generateStructuredSummary(fieldValues, tableHeaders, normalizedTableRows);

      // Create OCR Page Review Result
      ocrPages.push({
        pageNumber,
        imageUrl: cleanMime.startsWith('image/') ? `data:${cleanMime};base64,${base64Data}` : undefined,
        ocrText: structuredText,
      });

      // Convert table rows to array of arrays for SessionDataEntry format
      const tableRowsArray: any[][] = normalizedTableRows.map((row) =>
        tableHeaders.map((header) => row[header] || '')
      );

      // Perform Lookup Table Auto-Fill & Strict Validation if template or handwritingTemplate has lookup configured
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
            structuredText
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
        } catch (lookupErr) {
          console.warn('Lookup auto-fill error:', lookupErr);
        }
      }

      // Check missing fields
      const missingFields: string[] = [];
      if (handwritingTemplate) {
        handwritingTemplate.fields.forEach((f) => {
          if (!finalFieldValues[f.field_name]) {
            missingFields.push(f.field_name);
          }
        });
      } else if (template) {
        template.fields.forEach((f) => {
          if (!finalFieldValues[f.extractionKey] && !finalFieldValues[f.name]) {
            missingFields.push(f.name);
          }
        });
      }

      // Build multi-tables
      const rawTmplTables =
        handwritingTemplate?.tables && handwritingTemplate.tables.length > 0
          ? handwritingTemplate.tables
          : template?.tables && template.tables.length > 0
          ? template.tables
          : [
              {
                id: 'table_production_log',
                name: 'Production Table',
                columns: handwritingTemplate?.table_columns || [],
                fields: template?.tableFields || [],
              },
            ];

      const entryTables: EntryTableData[] = (rawTmplTables as any[]).map((tmplTbl, tIdx) => {
        const headers = (tmplTbl.columns || tmplTbl.fields || []).map(
          (c: any) => c.name || c.column_name
        );
        if (p.tables && Array.isArray(p.tables)) {
          const matched = p.tables.find(
            (t: any) => t.name?.toLowerCase().trim() === tmplTbl.name.toLowerCase().trim()
          );
          if (matched && Array.isArray(matched.rows)) {
            return {
              name: tmplTbl.name,
              headers: matched.headers && matched.headers.length > 0 ? matched.headers : headers,
              rows: matched.rows,
            };
          }
        }
        if (tIdx === 0) {
          return {
            name: tmplTbl.name,
            headers: tableHeaders.length > 0 ? tableHeaders : headers,
            rows: tableRowsArray,
          };
        }
        return {
          name: tmplTbl.name,
          headers,
          rows: [],
        };
      });

      // Create unified SessionDataEntry
      const entryTitle = handwritingTemplate
        ? `${handwritingTemplate.name} (${filename}${pageItems.length > 1 ? ` Pg ${pageNumber}` : ''})`
        : template
        ? `${template.name} (${filename})`
        : `Handwritten Entry (${filename})`;

      const sessionEntry: SessionDataEntry = {
        id: `hw_entry_gemini_${Date.now()}_${pageNumber}`,
        entryNumber: pageNumber,
        sourceType: 'handwritten',
        mode: mode === 'flexible' ? 'flexible' : 'template',
        templateId: handwritingTemplate?.id || template?.id || 'handwriting_scanning_default',
        templateName: handwritingTemplate?.name || template?.name || 'Handwriting Scanning Template',
        title: entryTitle,
        fieldValues: finalFieldValues,
        tableTitle: entryTables[0]?.name || 'Production Table Entries',
        tableHeaders: entryTables[0]?.headers || tableHeaders,
        tableRows: tableRowsArray,
        tables: entryTables,
        missingFields,
        lookupValidation,
        rawOcrText: structuredText,
        confidenceScore: typeof p.confidenceScore === 'number' ? p.confidenceScore : 95,
        createdAt: new Date().toISOString(),
      };

      entries.push(sessionEntry);

      if (i === 0) {
        aggregatedFields = fieldResults;
        aggregatedFieldValues = finalFieldValues;
        aggregatedTableHeaders = entryTables[0]?.headers || tableHeaders;
        aggregatedTableRows = normalizedTableRows;
        aggregatedStructuredText = structuredText;
      }
    }

    const firstEntryTables = entries[0]?.tables || [];

    const extractionResponse: HandwritingExtractionApiResponse = {
      success: true,
      filename,
      template_name: handwritingTemplate?.name || template?.name || 'Handwriting Scanning Template',
      fields: aggregatedFields,
      field_values: aggregatedFieldValues,
      table_headers: aggregatedTableHeaders,
      table_rows: aggregatedTableRows,
      tables: firstEntryTables,
      structured_text: aggregatedStructuredText,
      raw_text: aggregatedStructuredText,
      total_pages: pageItems.length,
      processing_time_ms: processingTimeMs,
      engineUsed: 'Gemini 2.5 Flash',
    };

    // Log complete Gemini output directly to backend terminal console
    console.log('================================================================================');
    console.log(`=== [GEMINI LLM COMPLETE OUTPUT: ${filename}] ===`);
    console.log(`Total Pages: ${pageItems.length} | Processing Duration: ${processingTimeMs}ms`);
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
      extractionResponse,
      entries,
      pages: ocrPages,
    };
  }

  /**
   * Generates a clean human-readable text summary of extracted fields and table
   */
  private static generateStructuredSummary(
    fieldValues: Record<string, string>,
    tableHeaders: string[],
    tableRows: Array<Record<string, string>>
  ): string {
    const lines: string[] = ['=== EXTRACTED FIELDS (GEMINI 2.5 FLASH) ==='];

    Object.entries(fieldValues).forEach(([k, v]) => {
      lines.push(`${k}: ${v || '[Empty]'}`);
    });

    if (tableHeaders.length > 0 && tableRows.length > 0) {
      lines.push('\n=== PRODUCTION TABLE ROWS ===');
      lines.push(tableHeaders.join(' | '));
      lines.push(tableHeaders.map(() => '---').join(' | '));
      tableRows.forEach((row) => {
        lines.push(tableHeaders.map((h) => row[h] || '').join(' | '));
      });
    }

    return lines.join('\n');
  }
}
