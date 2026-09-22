import {
  DataTemplate,
  SessionDataEntry,
  LookupValidationStatus,
  OcrPageResult,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  EntryTableData,
} from '@/types';
import { dbSettings, dbLookupTables } from '../db/models';
import { GroqServer } from '../groq/groqServer';
import { cleanAndParseJson, repairOcrNumericValue } from '../utils/jsonParser';
import { Agent, setGlobalDispatcher } from 'undici';

// High-capacity undici Agent with NO headers/body timeout (undici default is 300s/5min)
// Complex vision models (Chandra 2) can take >300s on large documents.
const ocrHttpAgent = new Agent({
  headersTimeout: 0, // 0 = no timeout
  bodyTimeout: 0,    // 0 = no timeout
  connectTimeout: 60000,
  keepAliveTimeout: 300000,
});

try {
  setGlobalDispatcher(ocrHttpAgent);
} catch {}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_LLM_MODEL = 'qwen/qwen3.6-27b';

// Hugging Face TrOCR Large Handwritten Endpoints
const HF_TROCR_ENDPOINTS = [
  'https://api-inference.huggingface.co/models/microsoft/trocr-large-handwritten',
  'https://router.huggingface.co/hf-inference/models/microsoft/trocr-large-handwritten',
];

export class HandwrittenExtractor {
  /**
   * 1. Call Local Python FastAPI OCR Backend (http://127.0.0.1:8000/ocr)
   */
  public static async extractWithPythonBackend(
    fileBuffer: Buffer,
    filename: string = 'document.png',
    mimeType: string = 'image/png',
    template?: DataTemplate | null,
    templateFields?: string[] | any,
    modelVariant?: string,
    checkpointId?: string
  ): Promise<{
    success: boolean;
    text?: string;
    entries?: Array<{ page: number; text: string; structured_text?: string; extracted_fields?: any[] }>;
    extracted_fields?: any[];
    engineUsed?: string;
    error?: string;
  }> {
    try {
      const pythonBackendUrl =
        process.env.PYTHON_OCR_URL ||
        process.env.OCR_BACKEND_URL ||
        'http://127.0.0.1:8000/ocr';

      console.log(`[OCR Client] Sending ${fileBuffer.length} bytes to Python Backend: ${pythonBackendUrl} (Variant: ${modelVariant || 'base'})`);

      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      formData.append('file', blob, filename);

      if (modelVariant) {
        formData.append('model_variant', modelVariant);
      }
      if (checkpointId) {
        formData.append('checkpoint_id', checkpointId);
      }

      if (template) {
        formData.append('template_json', JSON.stringify(template));
        if (template.fields) {
          const fieldNames = template.fields.map((f) => f.name);
          formData.append('template_fields_json', JSON.stringify(fieldNames));
        }
        if (template.lookupConfig?.enabled && template.lookupConfig.tableId) {
          try {
            const table = await dbLookupTables.getById(template.lookupConfig.tableId);
            if (table && table.rows && table.rows.length > 0) {
              const colVals = table.rows
                .map((r) => String(r[template.lookupConfig!.mainTableColumn] || '').trim())
                .filter(Boolean);
              const lookupMap = { [template.lookupConfig.mainTableColumn]: colVals };
              formData.append('lookup_tables_json', JSON.stringify(lookupMap));
            }
          } catch {}
        }
      } else if (templateFields) {
        formData.append('template_fields_json', JSON.stringify(templateFields));
      }

      const response = await fetch(pythonBackendUrl, {
        method: 'POST',
        body: formData,
        // @ts-ignore - undici Agent dispatcher option supported by Node.js runtime
        dispatcher: ocrHttpAgent,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[OCR Client] Python OCR backend returned HTTP ${response.status}:`, errText);
        return {
          success: false,
          error: `Python OCR backend returned ${response.status}: ${errText.substring(0, 150)}`,
        };
      }

      const data = await response.json();
      console.log(`[OCR Client] Python OCR backend response:`, {
        success: data?.success,
        pages: data?.total_pages,
        model: data?.model_name,
        entriesCount: data?.entries?.length,
      });

      if (data && data.success) {
        // Collect text from all pages/entries if raw_combined_text or text is not at root
        const entryTexts = Array.isArray(data.entries)
          ? data.entries
              .map((e: any) => e.structured_text || e.text || e.raw_text || '')
              .filter((t: string) => Boolean(t && t.trim()))
          : [];

        const combinedText =
          (typeof data.text === 'string' && data.text.trim()) ||
          (typeof data.raw_combined_text === 'string' && data.raw_combined_text.trim()) ||
          entryTexts.join('\n\n').trim();

        return {
          success: true,
          text: combinedText,
          entries: data.entries || [],
          extracted_fields: data.extracted_fields || [],
          engineUsed: data.model_name
            ? `Python OCR Backend (${data.model_name})`
            : 'Python Hybrid OCR Backend',
        };
      }

      if (data && data.text) {
        return {
          success: true,
          text: String(data.text).trim(),
          engineUsed: 'Python Local OCR Engine',
        };
      }

      return {
        success: false,
        error: data?.error || 'Invalid response format from Python OCR backend.',
      };
    } catch (err: any) {
      console.warn(`[OCR Client] Python OCR backend connection notice:`, err.message);
      return {
        success: false,
        error: err.message || 'Could not connect to Python OCR backend (http://127.0.0.1:8000).',
      };
    }
  }

  /**
   * 2. Primary TrOCR Extraction: Checks local Python backend first, then fallbacks to Hugging Face API
   */
  public static async extractWithTrOCR(
    imageBuffer: Buffer,
    filename: string = 'document.png',
    mimeType: string = 'image/png',
    _imageBase64?: string,
    template?: DataTemplate | null,
    templateFields?: string[],
    modelVariant?: string,
    checkpointId?: string
  ): Promise<{
    success: boolean;
    text: string;
    engineUsed: string;
    entries?: any[];
    extracted_fields?: any[];
    error?: string;
  }> {
    // Step A: Attempt local Python OCR backend
    const pythonResult = await this.extractWithPythonBackend(
      imageBuffer,
      filename,
      mimeType,
      template,
      templateFields,
      modelVariant,
      checkpointId
    );

    if (pythonResult.success) {
      if (pythonResult.text && pythonResult.text.trim().length > 0) {
        console.log(`[OCR Client] Successfully extracted text using ${pythonResult.engineUsed}`);
      } else {
        console.log(`[OCR Client] Python OCR backend processed image (no text detected in document).`);
      }
      return {
        success: true,
        text: pythonResult.text || '',
        engineUsed: pythonResult.engineUsed || 'Python Hybrid OCR (PaddleOCR + TrOCR Large)',
        entries: pythonResult.entries,
        extracted_fields: pythonResult.extracted_fields,
      };
    }

    // Step B: Fallback to direct Hugging Face API ONLY if Python backend is unavailable/offline
    console.log('[OCR Client] Python backend unavailable. Checking for Hugging Face TrOCR API fallback...');
    const settings = await dbSettings.get().catch(() => ({}));
    const hfToken = (settings as any)?.huggingFaceApiKey || process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '';

    if (!hfToken) {
      return {
        success: false,
        text: '',
        engineUsed: 'TrOCR Large Handwritten',
        error: pythonResult.error
          ? `Python OCR backend error: ${pythonResult.error}`
          : 'Could not connect to Python OCR backend (http://127.0.0.1:8000), and Hugging Face API key is not configured.',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Authorization': `Bearer ${hfToken}`,
    };

    let lastError: string | null = null;

    try {
      for (const endpoint of HF_TROCR_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: new Uint8Array(imageBuffer),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');

            // Handle Model Loading (503)
            if (response.status === 503) {
              console.log('[OCR Client] Hugging Face TrOCR model is loading, waiting 6s...');
              await new Promise((resolve) => setTimeout(resolve, 6000));
              const retryResponse = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: new Uint8Array(imageBuffer),
              });

              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                const parsedText = this.parseTrOcrResponse(retryData);
                if (parsedText) {
                  return {
                    success: true,
                    text: parsedText,
                    engineUsed: 'Hugging Face TrOCR Large Handwritten (microsoft/trocr-large-handwritten)',
                  };
                }
              }
            }

            console.warn(`[OCR Client] Endpoint ${endpoint} returned HTTP ${response.status}:`, errorText);
            lastError = `TrOCR API returned ${response.status}: ${errorText.substring(0, 180)}`;
            continue;
          }

          const data = await response.json();
          const parsedText = this.parseTrOcrResponse(data);

          if (parsedText) {
            return {
              success: true,
              text: parsedText,
              engineUsed: 'Hugging Face TrOCR Large Handwritten (microsoft/trocr-large-handwritten)',
            };
          }
        } catch (endpointErr: any) {
          console.warn(`[OCR Client] Failed request to endpoint ${endpoint}:`, endpointErr.message);
          lastError = endpointErr.message || 'TrOCR request failed.';
        }
      }

      return {
        success: false,
        text: '',
        engineUsed: 'TrOCR Large Handwritten',
        error: lastError || 'TrOCR handwriting recognition could not parse text from this image.',
      };
    } catch (err: any) {
      console.error('[OCR Client] TrOCR Error:', err);
      return {
        success: false,
        text: '',
        engineUsed: 'TrOCR Large Handwritten',
        error: err.message || 'TrOCR extraction failed.',
      };
    }
  }

  /**
   * Helper to parse TrOCR JSON response format
   */
  private static parseTrOcrResponse(data: any): string {
    if (typeof data === 'string') return data.trim();

    if (Array.isArray(data)) {
      const texts = data
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item?.generated_text) return item.generated_text;
          if (item?.text) return item.text;
          return '';
        })
        .filter(Boolean);

      return texts.join('\n').trim();
    }

    if (data?.generated_text) return String(data.generated_text).trim();
    if (data?.text) return String(data.text).trim();

    return '';
  }

  /**
   * 2. Extract Document Page Text using TrOCR Large
   * (Image Upload = 1 Page; PDF Upload = Processed Page-by-Page)
   */
  public static async extractDocumentText(
    imageBuffer: Buffer,
    _imageBase64?: string,
    _mimeType?: string
  ): Promise<{ text: string; engineUsed: string }> {
    const result = await this.extractWithTrOCR(imageBuffer);

    if (result.success && result.text) {
      return {
        text: result.text,
        engineUsed: result.engineUsed,
      };
    }

    return {
      text: result.text || (result.error ? `[OCR Notice]: ${result.error}` : ''),
      engineUsed: 'TrOCR Large Handwritten',
    };
  }

  /**
   * 3. LLM Field Structuring for Exactly ONE Single Page into ONE Entry
   * OCR raw text is supplied independently after user review.
   * Performs intelligent OCR Output Repair, Number Reconstruction, and Schema Mapping.
   */
  public static async structureSinglePageEntry(
    pageOcrText: string,
    pageNumber: number,
    totalPages: number,
    template: DataTemplate | null,
    mode: 'template' | 'flexible',
    documentUrl?: string,
    documentName?: string,
    ocrMethod?: string
  ): Promise<{ entry: SessionDataEntry; missingFields: string[] }> {
    const isTemplateMode = mode === 'template' && template !== null;
    const entryId = `entry_hw_${Date.now()}_p${pageNumber}_${Math.random().toString(36).substring(2, 6)}`;
    const pageLabel = totalPages > 1 ? `Page ${pageNumber}` : (documentName ? documentName : 'Document');

    if (!pageOcrText || !pageOcrText.trim()) {
      // Empty entry placeholder
      return {
        entry: {
          id: entryId,
          entryNumber: pageNumber,
          sourceType: 'handwritten',
          mode: isTemplateMode ? 'template' : 'flexible',
          templateId: isTemplateMode && template ? template.id : 'flexible',
          templateName: isTemplateMode && template ? template.name : 'Flexible Handwritten Entry',
          title: isTemplateMode && template ? `${template.name} (${pageLabel})` : `Handwritten Entry (${pageLabel})`,
          fieldValues: {},
          tableTitle: isTemplateMode && template ? template.tableTitle : undefined,
          tableHeaders: isTemplateMode && template ? template.tableFields?.map((f) => f.name) : undefined,
          tableRows: [],
          tables: isTemplateMode && template?.tables && template.tables.length > 0
            ? template.tables.map((t) => ({ name: t.name, headers: t.fields.map((f) => f.name), rows: [] }))
            : undefined,
          missingFields: isTemplateMode && template ? template.fields.map((f) => f.name) : [],
          rawOcrText: '',
          documentUrl: documentUrl || null,
          documentName: documentName || null,
          confidenceScore: 0,
          createdAt: new Date().toISOString(),
        },
        missingFields: isTemplateMode && template ? template.fields.map((f) => f.name) : [],
      };
    }

    if (isTemplateMode && template) {
      const fieldsSchema = template.fields.map((f) => ({
        key: f.extractionKey,
        name: f.name,
        type: f.type,
        options: f.options,
        required: f.required,
      }));

      // Build Multi-Table Schema (Production Table + Rejection Table etc.)
      const rawTemplateTables =
        template.tables && template.tables.length > 0
          ? template.tables
          : template.hasTable && template.tableFields?.length
          ? [
              {
                id: 'table_default',
                name: template.tableTitle || 'Production Table',
                fields: template.tableFields,
              },
            ]
          : [];

      const multiTablesSchema = rawTemplateTables.map((tbl) => ({
        name: tbl.name,
        columns: (tbl.fields || []).map((col) => ({
          key: col.extractionKey || col.name,
          name: col.name,
          type: col.type,
        })),
      }));

      const primaryTableSchema = multiTablesSchema[0]?.columns || [];
      const tableSchema = primaryTableSchema;

      // Check if table lookup & auto-fill is configured for this template
      let lookupGuidance = '';
      if (template.lookupConfig?.enabled && template.lookupConfig.tableId) {
        try {
          const lookupTable = await dbLookupTables.getById(template.lookupConfig.tableId);
          if (lookupTable && lookupTable.rows && lookupTable.rows.length > 0) {
            const mainField = template.fields.find((f) => f.extractionKey === template.lookupConfig?.mainFieldKey);
            const validValues = lookupTable.rows
              .map((r) => String(r[template.lookupConfig!.mainTableColumn] || '').trim())
              .filter(Boolean);
            const mappedFieldNames = (template.lookupConfig.fieldMappings || []).map((m) => {
              const tf = template.fields.find((f) => f.extractionKey === m.fieldKey);
              return tf ? tf.name : m.fieldKey;
            });

            lookupGuidance = `
================================================================================
### MASTER LOOKUP TABLE & AUTO-FILL RULES:
- Master Table Name: "${lookupTable.name}"
- Base Lookup Field: "${mainField?.name || template.lookupConfig.mainFieldKey}" (key: "${template.lookupConfig.mainFieldKey}")
- Registered Valid Codes in Table: [${validValues.map((v) => `"${v}"`).join(', ')}]
- Auto-Filled Dependent Fields: ${mappedFieldNames.join(', ')}
- CRITICAL INSTRUCTION: If the handwritten document mentions or contains one of the registered ${mainField?.name || template.lookupConfig.mainFieldKey} codes (or similar, like "PRT-4029", "P R T - 4 0 2 9", "PRT 4029", "PRT4029"), you MUST extract its exact canonical code "${validValues[0] || 'PRT-4029'}" into "${template.lookupConfig.mainFieldKey}".
- NOTE: The dependent fields (${mappedFieldNames.join(', ')}) will be automatically looked up and populated from the master lookup table, so prioritize extracting the base field code accurately.
================================================================================
`;
          }
        } catch (tblErr) {
          console.warn('[Handwritten OCR] Could not load lookup table for prompt guidance:', tblErr);
        }
      }

      const systemPrompt = `You are an expert OCR Data Structuring, Table Parsing, and Handwritten Number Repair AI.
You are given the reviewed RAW OCR text for ${pageLabel} from a handwritten document/sheet.
Your goal is to parse and clean messy OCR text, reconstruct table rows, fix OCR number recognition errors, and map the extracted data accurately into EXACTLY ONE structured record conforming to the template schema.

================================================================================
### 1. OCR NUMBER ERROR FIXING & DIGIT RECOVERY:
Handwritten numbers are frequently misrecognized by OCR engines into letters, symbols, or punctuated fragments. You MUST intelligently fix these OCR character substitutions:
- Letter 'g' or 'q' for '9':
  * "4g ." or "4g." or "4g" -> "49"
  * "9g" -> "99", "g5" -> "95"
- Symbols '/', ')', ']', '|', 'l', 'I' for '1':
  * "5/" or "5 )" or "5)" or "5|" or "5l" -> "51"
  * "4/" -> "41", "/0" -> "10", "1/" -> "11"
- Stray dots/periods in integer counts:
  * In counts and quantities (like Rejection or Production), dots between or after digits are pen marks or OCR noise:
    "4.7 ." or "4.7" or "4 . 7" -> "47"
    "4.8 ." or "4.8" or "4 . 8" -> "48"
    "20 ." or "20." -> "20"
    "39 ." or "39." -> "39"
- Letter 'L' or 'l' or 'A' for '4' or '1':
  * "L33" or "l33" in production totals -> "433"
  * "Total L33" -> total is "433"
- Letter 'O'/'o' for '0', 'S'/'s' for '5', 'B' for '8', 'Z' for '2':
  * "05" -> "05" or "5", "5O" -> "50"
- Spaced digits:
  * "9 9 4" -> "994", "1 3 6 3" -> "1363", "4 3 3" -> "433"
- Remove all trailing noise punctuation ('.', ',', ';', ':') from numbers.

================================================================================
### 2. TABLE EXTRACTION & MULTI-TABLE RULES:
${
  multiTablesSchema.length > 0
    ? `The template defines ${multiTablesSchema.length} distinct tables:
${multiTablesSchema
  .map(
    (t, idx) =>
      `Table ${idx + 1}: "${t.name}"
Columns: ${JSON.stringify(t.columns.map((c) => c.key))}`
  )
  .join('\n\n')}

CRITICAL HTML TABLE & MULTI-TABLE EXTRACTION INSTRUCTIONS:
1. HTML TABLE RECOGNITION:
   - The reviewed OCR text may be formatted as HTML containing multiple <table> elements.
   - Table 1 ("${multiTablesSchema[0]?.name || 'Production Table'}") corresponds to the primary production log <table> (with columns: Start Time, End Time, Planned Qty, Produced Qty, Rejection, etc.).
   - Table 2 ("${multiTablesSchema[1]?.name || 'Rejection'}") corresponds to the second <table> in the HTML, appearing under a section header like 'REJECTIONS' or 'REJECTION', with defect columns: STRUP, BD, SS, SM, BM, ST, WL, SC, PC, AB, PH, FS, TOTAL.
   - YOU MUST EXTRACT ALL ROWS FROM BOTH TABLES! Do NOT leave the 2nd table ("${multiTablesSchema[1]?.name || 'Rejection'}") empty if a table or row exists for it in the OCR text or HTML.
2. REJECTION TABLE RULES:
   - Look for the <table> with defect abbreviation headers: STRUP, BD, SS, SM, BM, ST, WL, SC, PC, AB, PH, FS, TOTAL.
   - Even if the rejection row has empty cells, zeroes, or sparse handwritten numbers, extract that row into Table 2's "rows" array with keys matching the column names.
   - Name Table 2 EXACTLY "${multiTablesSchema[1]?.name || 'Rejection'}" in the "tables" array.
3. OUTPUT STRUCTURE:
   - Populate "tables" with an entry for EVERY defined table in the schema.
   - For each table, provide "name", "headers", and "rows" (array of row objects matching column names).
   - "tableRows" can be kept empty [] to avoid duplicating data.`
    : 'No tables defined in this template.'
}
================================================================================
${lookupGuidance}
CRITICAL STRUCTURING RULES:
1. Treat this page as ONE discrete entry.
2. Fill "fieldValues" strictly matching template field keys: ${JSON.stringify(fieldsSchema.map((f) => f.key))}.
3. If a field is present in the reviewed OCR text, repair, normalize, and extract its value accurately. If a field is not found on this page, set its value to "" (empty string) and list its name in "missingFields".
4. Populate "tables" with an entry for EVERY defined table. Include all defined headers.
5. Extract rows for BOTH Table 1 ("${multiTablesSchema[0]?.name || 'Production Table'}") and Table 2 ("${multiTablesSchema[1]?.name || 'Rejection'}").
6. Output MUST be valid JSON only.

OUTPUT JSON FORMAT:
{
  "title": "${template.name} (${pageLabel})",
  "fieldValues": {
    ${fieldsSchema.map((f) => `"${f.key}": "..."`).join(',\n    ')}
  },
  "tables": [
    ${multiTablesSchema
      .map(
        (t) => `{
      "name": "${t.name}",
      "headers": ${JSON.stringify(t.columns.map((c) => c.name))},
      "rows": [
        {
          ${t.columns.map((c) => `"${c.key}": "..."`).join(',\n          ')}
        }
      ]
    }`
      )
      .join(',\n    ')}
  ],
  "tableRows": [],
  "missingFields": ["FieldName"],
  "confidenceScore": 95
}
`;

      const isChandraOcr =
        ocrMethod === 'chandra_2' ||
        (typeof ocrMethod === 'string' && ocrMethod.toLowerCase().includes('chandra'));

      const chandraAdditionRule = isChandraOcr
        ? `\n- MATHEMATICAL ADDITION RULE: If any value contains an expression like number + number (e.g. "300 + 8" or "300+8"), mathematically add the numbers and return the calculated sum ("308"), NOT concatenated digits like "3008".`
        : '';

      const userPrompt = `Template Name: ${template.name}
Template Fields Schema: ${JSON.stringify(fieldsSchema, null, 2)}
Template Tables Schema: ${JSON.stringify(multiTablesSchema, null, 2)}

REVIEWED OCR TEXT FOR ${pageLabel.toUpperCase()}:
"""
${pageOcrText}
"""

Please normalize numeric fields, fix handwritten OCR recognition errors (e.g. "4g ." -> "49", "5/" -> "51", "4.7 ." -> "47", "L33" -> "433"), cleanly separate table column bleeds, and return exactly 1 structured record in JSON format containing all fields and both tables:${chandraAdditionRule}`;

      // DEBUG LOG: Exact LLM input sent for extraction
      console.log('================================================================================');
      console.log('[Chandra HTML -> LLM Extraction] ===============================================');
      console.log('[Chandra HTML -> LLM Extraction] === STAGE 1: LLM INPUT SENT FOR EXTRACTION ===');
      console.log(`[Chandra HTML -> LLM Extraction] Page: ${pageNumber}/${totalPages} | Model: ${GROQ_LLM_MODEL} | Max Tokens: 4096`);
      console.log('[Chandra HTML -> LLM Extraction] --- SYSTEM PROMPT ---');
      console.log(systemPrompt);
      console.log('[Chandra HTML -> LLM Extraction] --- USER PROMPT ---');
      console.log(userPrompt);
      console.log('================================================================================');

      try {
        const responseText = await GroqServer.executeWithFailover(
          `Page ${pageNumber} LLM Structuring`,
          null,
          async (apiKey) => {
            const res = await fetch(GROQ_API_URL, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: GROQ_LLM_MODEL,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                max_tokens: 4096,
                reasoning_effort: 'none',
                response_format: { type: 'json_object' },
              }),
            });

            if (!res.ok) {
              const errText = await res.text().catch(() => '');
              const err = new Error(`LLM structuring returned ${res.status}: ${errText}`);
              (err as any).status = res.status;
              (err as any).errorText = errText;
              throw err;
            }

            const data = await res.json();
            return data.choices?.[0]?.message?.content || '';
          }
        );

        // DEBUG LOG: Exact LLM output received
        console.log('================================================================================');
        console.log('[Chandra HTML -> LLM Extraction] ===============================================');
        console.log('[Chandra HTML -> LLM Extraction] === STAGE 2: EXACT LLM OUTPUT RECEIVED =======');
        console.log(responseText);
        console.log('================================================================================');

        const parsed: any = cleanAndParseJson(responseText);
        let fieldValues: Record<string, any> = parsed.fieldValues || {};

        // Normalization & Deterministic Number Repair for template fields
        template.fields.forEach((f) => {
          const rawVal = fieldValues[f.extractionKey] ?? fieldValues[f.name];
          const isNumericField =
            f.type === 'number' ||
            /counter|prod|qty|quantity|weight|count|planned|actual|closing|opening|target|rate|price|amount|total|reading|hours|cycle|speed|num|number/i.test(f.name) ||
            /counter|prod|qty|quantity|weight|count|planned|actual|closing|opening|target|rate|price|amount|total|reading|hours|cycle|speed|num|number/i.test(f.extractionKey);

          if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
            if (isNumericField) {
              fieldValues[f.extractionKey] = repairOcrNumericValue(rawVal);
            } else {
              fieldValues[f.extractionKey] = typeof rawVal === 'string' ? rawVal.trim() : rawVal;
            }
          } else if (isNumericField) {
            // Safety check: If LLM left field empty due to OCR noise, check if raw OCR contains the field
            const fieldEsc = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const keyEsc = f.extractionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?:${fieldEsc}|${keyEsc})\\s*[:=-]?\\s*([^\n\r]+?)(?:\n|\r|$)`, 'i');
            const match = pageOcrText.match(regex);
            if (match && match[1]) {
              const cleaned = repairOcrNumericValue(match[1]);
              if (cleaned) {
                fieldValues[f.extractionKey] = cleaned;
              }
            }
          }
        });

        // Apply Master Table Lookup Auto-Fill & Strict Validation
        let lookupValidation: LookupValidationStatus | null = null;
        if (template.lookupConfig?.enabled) {
          const lookupResult = await GroqServer.processLookupAutoFillAndValidation(
            template,
            fieldValues,
            pageOcrText
          );
          fieldValues = lookupResult.fieldValues;
          lookupValidation = lookupResult.lookupValidation;
        }

        // Parse HTML tables directly from Chandra OCR output as deterministic fallback
        const htmlFallbackTables = HandwrittenExtractor.parseHtmlTablesFromOcr(pageOcrText);

        // Clean, repair & construct all defined tables (Production Table + Rejection Table etc.)
        const allExtractedTables: EntryTableData[] = rawTemplateTables.map((tbl: any, tblIdx: number) => {
          const tblCols = tbl.fields || tbl.columns || [];
          const definedHeaders = tblCols.map((c: any) => c.column_name || c.name);
          const definedKeys = tblCols.map((c: any) => c.extractionKey || c.column_name || c.name);

          // Find table in parsed.tables with smart multi-tier matching
          let matched: any = null;

          if (Array.isArray(parsed.tables)) {
            // Tier 1: Exact name match
            matched = parsed.tables.find(
              (pt: any) =>
                pt &&
                typeof pt === 'object' &&
                pt.name &&
                pt.name.toLowerCase().trim() === tbl.name.toLowerCase().trim()
            );

            // Tier 2: Normalized match (e.g. "rejections" vs "rejection", "rejection table" vs "rejection")
            if (!matched) {
              const norm = (s: string) =>
                (s || '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '')
                  .replace(/table|breakdown|card|sheet/g, '')
                  .replace(/s$/, '');
              const tblNorm = norm(tbl.name);
              matched = parsed.tables.find(
                (pt: any) => pt?.name && norm(pt.name) === tblNorm
              );
            }

            // Tier 3: Keyword / Substring match (e.g. contains "reject" or "defect")
            if (!matched) {
              const tblLower = tbl.name.toLowerCase();
              if (tblLower.includes('reject')) {
                matched = parsed.tables.find(
                  (pt: any) =>
                    pt?.name &&
                    (pt.name.toLowerCase().includes('reject') ||
                      pt.name.toLowerCase().includes('defect'))
                );
              } else if (tblLower.includes('product')) {
                matched = parsed.tables.find(
                  (pt: any) => pt?.name && pt.name.toLowerCase().includes('product')
                );
              }
            }

            // Tier 4: Header match (does the parsed table have headers matching this table's defined columns?)
            if (!matched) {
              matched = parsed.tables.find((pt: any) => {
                if (!pt) return false;
                const ptHeaders = Array.isArray(pt.headers)
                  ? pt.headers.map((h: any) => String(h).toLowerCase().trim())
                  : [];
                const ptRows =
                  Array.isArray(pt.rows) && pt.rows[0] && typeof pt.rows[0] === 'object'
                    ? Object.keys(pt.rows[0]).map((k) => k.toLowerCase().trim())
                    : [];
                const sampleKeys = [...ptHeaders, ...ptRows];
                if (sampleKeys.length === 0) return false;
                const matchCount = definedHeaders.filter((dh: string) =>
                  sampleKeys.includes(dh.toLowerCase().trim())
                ).length;
                return matchCount >= Math.min(2, definedHeaders.length);
              });
            }

            // Tier 5: Index match fallback
            if (!matched && parsed.tables[tblIdx]) {
              matched = parsed.tables[tblIdx];
            }
          }

          // Tier 6: Check root-level fallbacks on `parsed` (e.g. parsed.rejection, parsed.rejections, parsed.rejectionTable)
          if (!matched) {
            const tblLower = tbl.name.toLowerCase();
            if (tblLower.includes('reject')) {
              const rootRej =
                parsed.rejection ||
                parsed.rejections ||
                parsed.rejectionTable ||
                parsed.rejection_table ||
                parsed.rejectionRows;
              if (rootRej) {
                matched = Array.isArray(rootRej)
                  ? { rows: rootRej }
                  : typeof rootRej === 'object'
                  ? rootRej
                  : null;
              }
            }
          }

          // Extract raw rows from matched table
          let rawRows: any[] = [];
          if (matched) {
            if (Array.isArray(matched.rows)) {
              rawRows = matched.rows;
            } else if (typeof matched.rows === 'object' && matched.rows !== null) {
              rawRows = [matched.rows];
            } else if (Array.isArray(matched)) {
              rawRows = matched;
            } else if (typeof matched === 'object' && matched !== null && !matched.name && !matched.headers) {
              rawRows = [matched];
            }
          }

          // Fallback for primary table if LLM populated legacy tableRows
          if (rawRows.length === 0 && tblIdx === 0 && Array.isArray(parsed.tableRows) && parsed.tableRows.length > 0) {
            rawRows = parsed.tableRows;
          }

          // Tier 7: HTML Table fallback - If rawRows is still empty, recover from Chandra HTML tables!
          if (rawRows.length === 0 && htmlFallbackTables.length > 0) {
            const matchedHtmlTable =
              htmlFallbackTables.find((ht) => {
                const htHeadersLower = ht.headers.map((h) => h.toLowerCase().trim());
                const matchCount = definedHeaders.filter((dh: string) =>
                  htHeadersLower.includes(dh.toLowerCase().trim())
                ).length;
                return matchCount >= Math.min(2, definedHeaders.length);
              }) ||
              (htmlFallbackTables.length > tblIdx ? htmlFallbackTables[tblIdx] : null);

            if (matchedHtmlTable && matchedHtmlTable.rows.length > 0) {
              rawRows = matchedHtmlTable.rows;
              console.log(
                `[Chandra HTML -> LLM Extraction] Recovered ${rawRows.length} rows for table "${tbl.name}" directly from Chandra HTML table!`
              );
            }
          }

          // Clean, repair & normalize numeric values in rows
          const cleanedRows = rawRows.map((row: any) => {
            const rowObj: Record<string, any> = {};

            if (Array.isArray(row)) {
              // Row is array of values
              definedHeaders.forEach((h: string, colIdx: number) => {
                const val = row[colIdx] !== undefined && row[colIdx] !== null ? String(row[colIdx]).trim() : '';
                const key = definedKeys[colIdx] || h;
                rowObj[h] = val;
                rowObj[key] = val;
              });
            } else if (typeof row === 'object' && row !== null) {
              // Row is object: map by column name, extraction key, and lowercase variants
              const rowKeysLower: Record<string, any> = {};
              Object.entries(row).forEach(([k, v]) => {
                rowKeysLower[k.toLowerCase().trim()] = v;
                rowKeysLower[k.trim()] = v;
              });

              tblCols.forEach((col: any) => {
                const colName = col.column_name || col.name;
                const colKey = col.extractionKey || colName;
                const rawVal =
                  row[colName] ??
                  row[colKey] ??
                  rowKeysLower[colName.toLowerCase().trim()] ??
                  rowKeysLower[colKey.toLowerCase().trim()] ??
                  '';

                let finalVal = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';
                const isNumericCol =
                  col.type === 'number' ||
                  col.is_number ||
                  /qty|quantity|prod|count|counter|weight|target|rate|amount|total|reading|hours|strup|bd|ss|sm|bm|st|wl|sc|pc|ab|ph|fs/i.test(colName) ||
                  /qty|quantity|prod|count|counter|weight|target|rate|amount|total|reading|hours|strup|bd|ss|sm|bm|st|wl|sc|pc|ab|ph|fs/i.test(colKey);

                if (isNumericCol && finalVal !== '') {
                  finalVal = repairOcrNumericValue(finalVal);
                }

                rowObj[colName] = finalVal;
                rowObj[colKey] = finalVal;
              });
            }

            return rowObj;
          });

          return {
            name: tbl.name,
            headers: definedHeaders,
            rows: cleanedRows,
          };
        });

        // DEBUG LOG: Parsed tables summary
        console.log('================================================================================');
        console.log('[Chandra HTML -> LLM Extraction] === STAGE 3: PARSED TABLES & FIELDS ==========');
        console.log(`[Chandra HTML -> LLM Extraction] Total Fields Extracted: ${Object.keys(fieldValues).length}`);
        allExtractedTables.forEach((tbl, idx) => {
          console.log(
            `[Chandra HTML -> LLM Extraction] Table ${idx + 1} ("${tbl.name}"): ${tbl.rows.length} rows. Headers: [${tbl.headers.join(', ')}]`
          );
          if (tbl.rows.length > 0) {
            console.log(`[Chandra HTML -> LLM Extraction] Table ${idx + 1} Sample Row 1:`, JSON.stringify(tbl.rows[0]));
          } else {
            console.log(`[Chandra HTML -> LLM Extraction] Table ${idx + 1} is EMPTY (0 rows).`);
          }
        });
        console.log('================================================================================');

        const primaryTable = allExtractedTables[0] || {
          name: template.tableTitle || 'Production Table Entries',
          headers: template.tableFields?.map((col) => col.name) || [],
          rows: [],
        };

        // Check missing required / defined fields after auto-fill has been applied
        const missingFields: string[] = [];
        template.fields.forEach((f) => {
          const val = fieldValues[f.extractionKey];
          if (val === undefined || val === null || String(val).trim() === '') {
            missingFields.push(f.name);
          }
        });

        const entry: SessionDataEntry = {
          id: entryId,
          entryNumber: pageNumber,
          sourceType: 'handwritten',
          mode: 'template',
          templateId: template.id,
          templateName: template.name,
          title: parsed.title || `${template.name} (${pageLabel})`,
          fieldValues,
          tableTitle: primaryTable.name,
          tableHeaders: primaryTable.headers,
          tableRows: primaryTable.rows,
          tables: allExtractedTables,
          missingFields,
          lookupValidation,
          rawOcrText: pageOcrText,
          documentUrl: documentUrl || null,
          documentName: documentName || null,
          confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 90,
          createdAt: new Date().toISOString(),
        };

        return { entry, missingFields };
      } catch (err: any) {
        console.error(`Page ${pageNumber} LLM Structuring error:`, err);
        return await this.heuristicFallbackSinglePage(pageOcrText, pageNumber, template, 'template', documentUrl, documentName);
      }
    } else {
      // Flexible Mode for Single Page
      const systemPrompt = `You are an expert Flexible Document Structuring, Table Extraction, and Handwritten OCR Repair AI.
You are given the reviewed RAW OCR text for ${pageLabel} of a document.
Your task is to repair OCR formatting noise, fix handwritten number misrecognitions, and structure it into ONE clean record with dynamic key-value attributes and table rows.

================================================================================
### 1. OCR NUMBER ERROR FIXING & DIGIT RECOVERY:
Handwritten numbers are frequently misrecognized by OCR engines into letters, symbols, or punctuated fragments. You MUST intelligently fix these OCR character substitutions:
- Letter 'g' or 'q' for '9':
  * "4g ." or "4g." or "4g" -> "49", "9g" -> "99", "g5" -> "95"
- Symbols '/', ')', '|', 'l', 'I', ']' for '1':
  * "5/" or "5 )" or "5)" or "5|" or "5l" -> "51", "4/" -> "41"
- Stray dots/periods in integer counts:
  * Dots between or after digits in integer counts are pen marks or OCR noise:
    "4.7 ." or "4.7" or "4 . 7" -> "47"
    "4.8 ." or "4.8" or "4 . 8" -> "48"
    "20 ." or "20." -> "20"
    "39 ." or "39." -> "39"
- Letter 'L' or 'l' or 'A' for '4' or '1':
  * "L33" or "l33" -> "433" ("Total L33" -> 433)
- Spaced digits: "9 9 4" -> "994", "1 3 6 3" -> "1363", "4 3 3" -> "433"
- Remove all trailing noise punctuation ('.', ',', ';', ':') from numbers.

================================================================================
### 2. TABLE EXTRACTION & COLUMN BLEED SEPARATION:
- When a cell contains both a timestamp and a number (e.g. "05.00PM 5/"), separate them:
  * "05.00PM" belongs to "End Time".
  * "5/" is the numeric quantity ("51") and belongs to "Produced Qty" or "OK Component".
  * Footer note "OK Component :" confirms the quantity column.
- Detect accurate table headers (e.g. ["Start Time", "End Time", "Produced Qty", "Rejection"]).
- Structure all tabular hourly entries into "tableRows" as arrays of cell strings matching "tableHeaders".
- Do not include totals/footers like "Total L33 | 369" as hourly table rows.

OUTPUT JSON FORMAT:
{
  "title": "Document Record (${pageLabel})",
  "flexibleFields": [
    { "name": "Total Produced", "value": "433" },
    { "name": "Total Rejection", "value": "369" }
  ],
  "tableTitle": "Hourly Production Log",
  "tableHeaders": ["Start Time", "End Time", "Produced Qty", "Rejection"],
  "tableRows": [
    ["03.30PM", "04.00PM", "", ""],
    ["04.00PM", "05.00PM", "51", "49"]
  ],
  "confidenceScore": 92
}`;

      const isChandraOcr =
        ocrMethod === 'chandra_2' ||
        (typeof ocrMethod === 'string' && ocrMethod.toLowerCase().includes('chandra'));

      const chandraAdditionRule = isChandraOcr
        ? `\n- MATHEMATICAL ADDITION RULE: If any value contains an expression like number + number (e.g. "300 + 8" or "300+8"), mathematically add the numbers and return the calculated sum ("308"), NOT concatenated digits like "3008".`
        : '';

      const userPrompt = `REVIEWED OCR TEXT FOR ${pageLabel.toUpperCase()}:
"""
${pageOcrText}
"""

Please repair OCR text, fix handwritten number misrecognitions (e.g. "4g ." -> "49", "5/" -> "51", "4.7 ." -> "47", "L33" -> "433"), separate column bleeds, and structure this page into 1 flexible record in JSON format:${chandraAdditionRule}`;

      try {
        const responseText = await GroqServer.executeWithFailover(
          `Page ${pageNumber} Flexible Structuring`,
          null,
          async (apiKey) => {
            const res = await fetch(GROQ_API_URL, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: GROQ_LLM_MODEL,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                max_tokens: 900,
                reasoning_effort: 'none',
                response_format: { type: 'json_object' },
              }),
            });

            if (!res.ok) {
              const errText = await res.text().catch(() => '');
              const err = new Error(`LLM parsing returned ${res.status}: ${errText}`);
              (err as any).status = res.status;
              (err as any).errorText = errText;
              throw err;
            }

            const data = await res.json();
            return data.choices?.[0]?.message?.content || '';
          }
        );

        const parsed: any = cleanAndParseJson(responseText);
        const rawFlexFields = Array.isArray(parsed.flexibleFields)
          ? parsed.flexibleFields
          : Object.entries(parsed.fieldValues || {}).map(([name, value]) => ({ name, value: String(value) }));

        // Repair numeric flexible fields
        const flexFields = rawFlexFields.map((f: any) => ({
          name: f.name,
          value:
            /counter|prod|qty|quantity|weight|count|planned|actual|closing|opening|rate|price|amount|total/i.test(f.name)
              ? repairOcrNumericValue(f.value)
              : f.value,
        }));

        const entry: SessionDataEntry = {
          id: entryId,
          entryNumber: pageNumber,
          sourceType: 'handwritten',
          mode: 'flexible',
          templateId: 'flexible',
          templateName: 'Flexible Handwritten Entry',
          title: parsed.title || `Handwritten Entry (${pageLabel})`,
          fieldValues: flexFields.reduce((acc: any, f: any) => ({ ...acc, [f.name]: f.value }), {}),
          flexibleFields: flexFields,
          tableTitle: parsed.tableTitle || 'Extracted Table',
          tableHeaders: parsed.tableHeaders || ['Item', 'Quantity', 'Notes'],
          tableRows: parsed.tableRows || [],
          rawOcrText: pageOcrText,
          documentUrl: documentUrl || null,
          documentName: documentName || null,
          confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 85,
          createdAt: new Date().toISOString(),
        };

        return { entry, missingFields: [] };
      } catch (err: any) {
        return this.heuristicFallbackSinglePage(pageOcrText, pageNumber, null, 'flexible', documentUrl, documentName);
      }
    }
  }

  /**
   * Structure multiple pages sequentially (Page 1 -> Entry 1, Page 2 -> Entry 2, ...)
   */
  public static async structureMultiplePages(
    pages: Array<{ pageNumber: number; ocrText: string; imageUrl?: string }>,
    template: DataTemplate | null,
    mode: 'template' | 'flexible',
    documentName?: string,
    ocrMethod?: string
  ): Promise<{ entries: SessionDataEntry[]; missingFieldsSummary: string[] }> {
    const entries: SessionDataEntry[] = [];
    const allMissing = new Set<string>();

    for (const page of pages) {
      const { entry, missingFields } = await this.structureSinglePageEntry(
        page.ocrText,
        page.pageNumber,
        pages.length,
        template,
        mode,
        page.imageUrl,
        documentName,
        ocrMethod
      );
      entries.push(entry);
      missingFields.forEach((f) => allMissing.add(f));
    }

    return {
      entries,
      missingFieldsSummary: Array.from(allMissing),
    };
  }

  /**
   * Heuristic Fallback for Single Page with OCR Number Repair and Auto-Fill
   */
  private static async heuristicFallbackSinglePage(
    pageOcrText: string,
    pageNumber: number,
    template: DataTemplate | null,
    mode: 'template' | 'flexible',
    documentUrl?: string,
    documentName?: string
  ): Promise<{ entry: SessionDataEntry; missingFields: string[] }> {
    const entryId = `entry_hw_fallback_${Date.now()}_p${pageNumber}`;

    if (mode === 'template' && template) {
      let fieldValues: Record<string, any> = {};

      template.fields.forEach((f) => {
        const fieldEsc = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keyEsc = f.extractionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:${fieldEsc}|${keyEsc})\\s*[:=-]?\\s*([^\n\r]+?)(?:\n|\r|$)`, 'i');
        const match = pageOcrText.match(regex);
        if (match && match[1]) {
          const rawMatch = match[1].trim();
          const isNumeric =
            f.type === 'number' ||
            /counter|prod|qty|quantity|weight|count|planned|actual|closing|opening|target|rate|price|amount|total|reading|hours|cycle|speed|num|number/i.test(f.name) ||
            /counter|prod|qty|quantity|weight|count|planned|actual|closing|opening|target|rate|price|amount|total|reading|hours|cycle|speed|num|number/i.test(f.extractionKey);

          fieldValues[f.extractionKey] = isNumeric
            ? repairOcrNumericValue(rawMatch)
            : rawMatch;
        } else {
          fieldValues[f.extractionKey] = '';
        }
      });

      // Apply Lookup Table Auto-Fill & Strict Validation in Fallback
      let lookupValidation: LookupValidationStatus | null = null;
      if (template.lookupConfig?.enabled) {
        try {
          const lookupResult = await GroqServer.processLookupAutoFillAndValidation(
            template,
            fieldValues,
            pageOcrText
          );
          fieldValues = lookupResult.fieldValues;
          lookupValidation = lookupResult.lookupValidation;
        } catch {}
      }

      const missingFields: string[] = [];
      template.fields.forEach((f) => {
        const val = fieldValues[f.extractionKey];
        if (val === undefined || val === null || String(val).trim() === '') {
          missingFields.push(f.name);
        }
      });

      const fallbackTables: EntryTableData[] = (template.tables && template.tables.length > 0
        ? template.tables
        : template.hasTable && template.tableFields?.length
        ? [{ name: template.tableTitle || 'Production Table', fields: template.tableFields }]
        : []
      ).map((tbl) => ({
        name: tbl.name,
        headers: (tbl.fields || []).map((c: any) => c.name),
        rows: [],
      }));

      const primaryFallback = fallbackTables[0] || {
        name: template.tableTitle || 'Production Table Entries',
        headers: template.tableFields?.map((c) => c.name) || [],
        rows: [],
      };

      return {
        entry: {
          id: entryId,
          entryNumber: pageNumber,
          sourceType: 'handwritten',
          mode: 'template',
          templateId: template.id,
          templateName: template.name,
          title: `${template.name} (Page ${pageNumber})`,
          fieldValues,
          tableTitle: primaryFallback.name,
          tableHeaders: primaryFallback.headers,
          tableRows: [],
          tables: fallbackTables,
          missingFields,
          lookupValidation,
          rawOcrText: pageOcrText,
          documentUrl: documentUrl || null,
          documentName: documentName || null,
          confidenceScore: 50,
          createdAt: new Date().toISOString(),
        },
        missingFields,
      };
    } else {
      const pageLines = (pageOcrText || '')
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);

      const flexibleFields = pageLines.slice(0, 8).map((line: string, idx: number) => {
        const parts = line.split(/[:=-]/);
        if (parts.length > 1) {
          const val = parts.slice(1).join(':').trim();
          return {
            name: parts[0].trim(),
            value: /counter|prod|qty|quantity|weight/i.test(parts[0]) ? repairOcrNumericValue(val) : val,
          };
        }
        return { name: `Line ${idx + 1}`, value: line };
      });

      return {
        entry: {
          id: entryId,
          entryNumber: pageNumber,
          sourceType: 'handwritten',
          mode: 'flexible',
          templateId: 'flexible',
          templateName: 'Flexible Handwritten Entry',
          title: `Handwritten Entry (Page ${pageNumber})`,
          fieldValues: flexibleFields.reduce((acc: Record<string, any>, f: { name: string; value: any }) => ({ ...acc, [f.name]: f.value }), {}),
          flexibleFields,
          tableTitle: 'Detected Rows',
          tableHeaders: ['Line Content'],
          tableRows: pageLines.slice(8).map((l: string) => [l]),
          rawOcrText: pageOcrText,
          documentUrl: documentUrl || null,
          documentName: documentName || null,
          confidenceScore: 50,
          createdAt: new Date().toISOString(),
        },
        missingFields: [],
      };
    }
  }

  /**
   * Helper: Parse HTML tables directly from Chandra OCR output
   */
  private static parseHtmlTablesFromOcr(html: string): Array<{ headers: string[]; rows: Array<Record<string, string>> }> {
    if (!html || typeof html !== 'string') return [];
    const tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }> = [];

    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableContent = tableMatch[1];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;
      const allRowsHtml: string[] = [];

      while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
        allRowsHtml.push(rowMatch[1]);
      }

      if (allRowsHtml.length === 0) continue;

      let headers: string[] = [];
      const dataRows: string[] = [];

      // Check if rows have <th>
      for (const rHtml of allRowsHtml) {
        const thMatches = Array.from(rHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) =>
          m[1].replace(/<[^>]+>/g, '').trim()
        );
        if (thMatches.length > 0 && headers.length === 0) {
          headers = thMatches;
        } else {
          dataRows.push(rHtml);
        }
      }

      // If no <th> found, use first row's <td> as headers if multiple rows exist
      if (headers.length === 0 && allRowsHtml.length > 1) {
        const firstRowTds = Array.from(allRowsHtml[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
          m[1].replace(/<[^>]+>/g, '').trim()
        );
        if (firstRowTds.length > 0) {
          headers = firstRowTds;
          dataRows.splice(0, 1);
        }
      }

      if (headers.length === 0) continue;

      const parsedRows: Array<Record<string, string>> = [];
      for (const rHtml of dataRows) {
        const tdMatches = Array.from(rHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
          m[1].replace(/<[^>]+>/g, '').trim()
        );
        if (tdMatches.length === 0) continue;

        const rowObj: Record<string, string> = {};
        headers.forEach((h, colIdx) => {
          rowObj[h] = tdMatches[colIdx] ? tdMatches[colIdx].trim() : '';
        });
        parsedRows.push(rowObj);
      }

      tables.push({ headers, rows: parsedRows });
    }

    return tables;
  }

  /**
   * 4. Dedicated Handwriting Scanning Pipeline:
   * Sends image/PDF buffer and dedicated HandwritingScanningTemplate to Python backend /ocr/handwriting.
   */
  public static async extractWithHandwritingPipeline(
    fileBuffer: Buffer,
    filename: string = 'document.png',
    mimeType: string = 'image/png',
    template?: HandwritingScanningTemplate | null,
    modelVariant?: string,
    checkpointId?: string,
    ocrMethod?: string,
    chandraMode?: string,
    chandraUpscale?: boolean,
    chandraQuantization?: string,
    chandraLoadingMethod?: string,
    chandraOllamaModel?: string
  ): Promise<HandwritingExtractionApiResponse> {
    try {
      const baseOcrUrl =
        process.env.PYTHON_OCR_URL ||
        process.env.OCR_BACKEND_URL ||
        'http://127.0.0.1:8000/ocr';
      const handwritingUrl = baseOcrUrl.replace(/\/ocr\/?$/, '/ocr/handwriting');

      console.log(`[Handwriting Client] Sending ${fileBuffer.length} bytes to Python Backend: ${handwritingUrl} (Method: ${ocrMethod || 'trocr'}, Mode: ${chandraMode || 'default'}, Loading: ${chandraLoadingMethod || 'ollama'}, OllamaModel: ${chandraOllamaModel || 'default'}, Quant: ${chandraQuantization || '3-bit'}, Upscale: ${chandraUpscale ?? false}, Template: ${template?.name || 'Default'})`);

      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      formData.append('file', blob, filename);

      if (modelVariant) {
        formData.append('model_variant', modelVariant);
      }
      if (checkpointId) {
        formData.append('checkpoint_id', checkpointId);
      }
      if (ocrMethod) {
        formData.append('ocr_method', ocrMethod);
      }
      if (chandraMode) {
        formData.append('chandra_mode', chandraMode);
      }
      if (chandraUpscale !== undefined) {
        formData.append('chandra_upscale', String(Boolean(chandraUpscale)));
      }
      if (chandraQuantization) {
        formData.append('chandra_quantization', chandraQuantization);
      }
      if (chandraLoadingMethod) {
        formData.append('chandra_loading_method', chandraLoadingMethod);
      }
      if (chandraOllamaModel) {
        formData.append('chandra_ollama_model', chandraOllamaModel);
      }
      if (template) {
        formData.append('template_json', JSON.stringify(template));
      }

      const response = await fetch(handwritingUrl, {
        method: 'POST',
        body: formData,
        // @ts-ignore - undici Agent dispatcher option supported by Node.js runtime
        dispatcher: ocrHttpAgent,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[Handwriting Client] Python OCR backend returned HTTP ${response.status}:`, errText);
        return {
          success: false,
          template_name: template?.name || 'Handwriting Scanning Template',
          fields: [],
          field_values: {},
          table_headers: [],
          table_rows: [],
          structured_text: '',
          raw_text: '',
          total_pages: 1,
          processing_time_ms: 0,
          error: `Python OCR backend returned ${response.status}: ${errText.substring(0, 150)}`,
        };
      }

      const data: HandwritingExtractionApiResponse = await response.json();
      return data;
    } catch (err: any) {
      console.warn(`[Handwriting Client] Python OCR connection error:`, err.message);
      return {
        success: false,
        template_name: template?.name || 'Handwriting Scanning Template',
        fields: [],
        field_values: {},
        table_headers: [],
        table_rows: [],
        structured_text: '',
        raw_text: '',
        total_pages: 1,
        processing_time_ms: 0,
        error: err.message || 'Could not connect to Python OCR backend (http://127.0.0.1:8000).',
      };
    }
  }
}

