import {
  DataTemplate,
  HandwritingScanningTemplate,
  HandwritingExtractionApiResponse,
  HandwritingFieldExtractionResult,
  SessionDataEntry,
  OcrPageResult,
  LookupValidationStatus,
} from '../../types';
import { GroqServer } from '../groq/groqServer';
import { HandwrittenExtractor } from '../ocr/handwrittenExtractor';
import { normalizeToIsoDate } from '../utils/dateUtils';
import { DEFAULT_HANDWRITING_SCANNING_TEMPLATE } from '../constants';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DEFAULT_PADDLE_BACKEND_URL = 'http://127.0.0.1:8000/ocr/paddle-vl';

export const ALLOWED_PADDLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'application/pdf',
];

export const MAX_PADDLE_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface PaddleExtractionParams {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  handwritingTemplate?: HandwritingScanningTemplate | null;
  template?: DataTemplate | null;
  mode?: 'template' | 'flexible';
}

export class PaddleServer {
  /**
   * Validates document size and mime type.
   */
  public static validateDocument(buffer: Buffer, mimeType: string, filename: string): void {
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    const isAllowedExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);
    const isAllowedMime = ALLOWED_PADDLE_MIME_TYPES.includes(mimeType);

    if (!isAllowedExt && !isAllowedMime) {
      throw new Error(
        `Unsupported file format "${mimeType || ext}". Supported formats for PaddleOCR-VL: PDF, JPG, PNG, WEBP, and BMP.`
      );
    }

    if (buffer.length > MAX_PADDLE_FILE_SIZE_BYTES) {
      throw new Error(
        `Document is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size for PaddleOCR-VL is 50MB.`
      );
    }
  }
  /**
   * Executes pure PaddleOCR-VL 1.6 extraction via FastAPI backend or fallback CLI runner.
   */
  public static async extractFromDocument(params: PaddleExtractionParams): Promise<{
    pages: OcrPageResult[];
    entries: SessionDataEntry[];
    extractionResponse: HandwritingExtractionApiResponse;
  }> {
    const {
      buffer,
      filename,
      mimeType = 'image/png',
      handwritingTemplate,
      template,
      mode = 'template',
    } = params;

    const startTime = Date.now();
    const effectiveTemplate = handwritingTemplate || null;

    // 1. Try local Python FastAPI endpoint first
    let rawResult: any = null;
    let backendUrl = process.env.PADDLE_BACKEND_URL?.trim() || DEFAULT_PADDLE_BACKEND_URL;

    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
      formData.append('file', blob, filename);
      if (effectiveTemplate) {
        formData.append('template_json', JSON.stringify(effectiveTemplate));
      }
      formData.append('mode', mode);

      const res = await fetch(backendUrl, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(180000), // 3 min timeout to support full OCR processing
      });

      if (res.ok) {
        rawResult = await res.json();
      } else {
        const errorBody = await res.text().catch(() => '');
        console.warn(`[PaddleServer] FastAPI backend HTTP ${res.status}: ${errorBody.slice(0, 200)}`);
      }
    } catch (apiErr: any) {
      console.warn(`[PaddleServer] FastAPI backend notice (${apiErr?.name || 'Error'}: ${apiErr?.message || apiErr}), executing local CLI runner...`);
    }

    // 2. Fallback to direct Python CLI execution
    if (!rawResult || !rawResult.success) {
      rawResult = await this.executeCliExtractor(buffer, filename, effectiveTemplate, mode);
    }

    if (!rawResult || !rawResult.success) {
      throw new Error(rawResult?.error || 'Failed to extract document using PaddleOCR-VL 1.6.');
    }

    // 3. Process field values & dates
    const fieldValues: Record<string, string> = {};
    if (rawResult.field_values && typeof rawResult.field_values === 'object') {
      Object.entries(rawResult.field_values).forEach(([k, v]) => {
        let strVal = v !== null && v !== undefined ? String(v).trim() : '';
        if (k.toLowerCase().includes('date') && strVal) {
          strVal = normalizeToIsoDate(strVal);
        }
        fieldValues[k] = strVal;
      });
    }

    // Ensure all defined template fields exist
    if (handwritingTemplate) {
      handwritingTemplate.fields.forEach((f) => {
        if (fieldValues[f.field_name] === undefined) {
          fieldValues[f.field_name] = '';
        }
      });
    }

    // Table headers and rows
    const tableHeaders: string[] = Array.isArray(rawResult.table_headers)
      ? rawResult.table_headers
      : handwritingTemplate?.table_columns.map((c) => c.column_name) || [];

    const rawTableRows: any[] = Array.isArray(rawResult.table_rows) ? rawResult.table_rows : [];
    const normalizedTableRows: Array<Record<string, string>> = rawTableRows.map((row) => {
      const rowObj: Record<string, string> = {};
      tableHeaders.forEach((header) => {
        rowObj[header] = row[header] !== undefined && row[header] !== null ? String(row[header]) : '';
      });
      return rowObj;
    });

    const tableRowsArray: any[][] = normalizedTableRows.map((row) =>
      tableHeaders.map((header) => row[header] || '')
    );

    // Build Field Results
    const fieldResults: HandwritingFieldExtractionResult[] = Array.isArray(rawResult.fields) && rawResult.fields.length > 0
      ? rawResult.fields.map((f: any) => ({
          field_name: f.field_name,
          field_type: f.field_type || 'digital',
          value_type: f.value_type || 'd',
          look_for: f.look_for || 'right',
          value: fieldValues[f.field_name] || '',
          confidence: f.confidence || (fieldValues[f.field_name] ? 90 : 0),
          source: 'paddleocr_vl',
        }))
      : handwritingTemplate
      ? handwritingTemplate.fields.map((f) => ({
          field_name: f.field_name,
          field_type: f.field_type,
          value_type: f.value_type,
          look_for: f.look_for,
          value: fieldValues[f.field_name] || '',
          confidence: fieldValues[f.field_name] ? 90 : 0,
          source: 'paddleocr_vl',
        }))
      : Object.entries(fieldValues).map(([name, val]) => ({
          field_name: name,
          field_type: 'digital',
          value_type: 'd',
          look_for: 'right',
          value: String(val),
          confidence: val ? 90 : 0,
          source: 'paddleocr_vl',
        }));

    // Generate Structured Summary of Extracted Data
    const structuredSummary =
      rawResult.structured_text || this.generateStructuredSummary(fieldValues, tableHeaders, normalizedTableRows);

    // Build standard DataTemplate for the LLM schema mapping
    const effectiveLookupConfig = handwritingTemplate?.lookupConfig || template?.lookupConfig;
    const effectiveTables = (handwritingTemplate?.tables && handwritingTemplate.tables.length > 0
      ? handwritingTemplate.tables
      : DEFAULT_HANDWRITING_SCANNING_TEMPLATE.tables || []
    ).map((tbl) => ({
      id: tbl.id || `tbl_${tbl.name}`,
      name: tbl.name,
      fields: (tbl.columns || (tbl as any).fields || []).map((c: any) => ({
        id: c.id || `col_${c.column_name || c.name}`,
        name: c.column_name || c.name,
        extractionKey: c.extractionKey || c.column_name || c.name,
        type: (c.is_number ? 'number' : 'text') as any,
      })),
    }));

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
      hasTable:
        Boolean(handwritingTemplate?.table_columns && handwritingTemplate.table_columns.length > 0) ||
        effectiveTables.length > 0,
      tableFields: (handwritingTemplate?.table_columns || []).map((c) => ({
        id: c.id,
        name: c.column_name,
        extractionKey: c.column_name,
        type: 'text' as any,
      })),
      tables: effectiveTables,
      lookupConfig: effectiveLookupConfig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 4. Send ONLY the extracted fields/values/table data to the LLM (NO image sent to LLM)
    // Let the LLM normalize everything into the required JSON schema (SessionDataEntry)
    console.log('[PaddleServer] Sending extracted fields and table rows to LLM for schema normalization (zero image data sent)...');
    const entries: SessionDataEntry[] = [];
    const pages: OcrPageResult[] = [];

    const pageResults: any[] = Array.isArray(rawResult.page_results) && rawResult.page_results.length > 0
      ? rawResult.page_results
      : [{
          page_number: 1,
          field_values: fieldValues,
          table_headers: tableHeaders,
          table_rows: normalizedTableRows,
          structured_text: structuredSummary,
        }];

    for (let i = 0; i < pageResults.length; i++) {
      const p = pageResults[i];
      const pageNum = p.page_number || i + 1;
      const pageSummary = p.structured_text || this.generateStructuredSummary(
        p.field_values || fieldValues,
        p.table_headers || tableHeaders,
        p.table_rows || normalizedTableRows
      );

      // Call LLM for schema normalization using existing TrOCR structuring logic (Sends ONLY text)
      const { entry: normalizedEntry } = await HandwrittenExtractor.structureSinglePageEntry(
        pageSummary,
        pageNum,
        pageResults.length,
        lookupTemplate,
        mode,
        undefined, // Zero image transmission to LLM
        filename
      );

      normalizedEntry.sourceType = 'handwritten';
      normalizedEntry.entryNumber = pageNum;
      normalizedEntry.rawOcrText = pageSummary;

      entries.push(normalizedEntry);

      pages.push({
        pageNumber: pageNum,
        imageUrl: mimeType.startsWith('image/') ? `data:${mimeType};base64,${buffer.toString('base64')}` : undefined,
        ocrText: pageSummary,
      });
    }

    const durationMs = Date.now() - startTime;

    // Use normalized field values and table rows from LLM if available
    const primaryEntry = entries[0];
    const finalFieldValues = primaryEntry?.fieldValues && Object.keys(primaryEntry.fieldValues).length > 0
      ? primaryEntry.fieldValues
      : fieldValues;

    const extractionResponse: HandwritingExtractionApiResponse = {
      success: true,
      filename,
      template_name: handwritingTemplate?.name || template?.name || 'Handwriting Scanning Template',
      fields: fieldResults,
      field_values: finalFieldValues,
      table_headers: tableHeaders,
      table_rows: normalizedTableRows,
      tables: primaryEntry?.tables || [],
      structured_text: structuredSummary,
      raw_text: structuredSummary,
      total_pages: rawResult.total_pages || pageResults.length,
      processing_time_ms: durationMs,
      device: rawResult.device || rawResult.engineUsed || 'PaddleOCR 1.6 (Local)',
    };

    // Log complete OCR output & LLM normalized output directly to backend terminal console
    console.log('================================================================================');
    console.log(`=== [PADDLEOCR 1.6 COMPLETE EXTRACTION OUTPUT: ${filename}] ===`);
    console.log(`Device: ${extractionResponse.device} | Total Duration: ${durationMs}ms`);
    console.log('--- EXTRACTED FIELD VALUES (FROM PADDLEOCR 1.6) ---');
    console.dir(fieldValues, { depth: null });
    console.log('--- TABLE HEADERS ---');
    console.log(tableHeaders);
    console.log('--- TABLE ROWS (FROM PADDLEOCR 1.6) ---');
    console.dir(normalizedTableRows, { depth: null });
    console.log('--- STRUCTURED TEXT SENT TO LLM (NO IMAGE) ---');
    console.log(structuredSummary);
    console.log('--- LLM NORMALIZED SESSION ENTRY OUTPUT (JSON SCHEMA) ---');
    console.dir(entries, { depth: null });
    console.log('================================================================================');

    return {
      pages,
      entries,
      extractionResponse,
    };
  }

  /**
   * Fallback direct Python CLI invocation
   */
  private static async executeCliExtractor(
    buffer: Buffer,
    filename: string,
    template: any,
    mode: string
  ): Promise<any> {
    return new Promise((resolve) => {
      const tempDir = os.tmpdir();
      const ext = path.extname(filename) || '.png';
      const tempFilePath = path.join(tempDir, `paddle_input_${Date.now()}${ext}`);
      const tempTmplPath = path.join(tempDir, `paddle_tmpl_${Date.now()}.json`);

      fs.writeFileSync(tempFilePath, buffer);
      if (template) {
        fs.writeFileSync(tempTmplPath, JSON.stringify(template));
      }

      const scriptPath =
        process.env.PADDLE_SCRIPT_PATH ||
        (fs.existsSync(path.resolve(process.cwd(), '..', 'backend', 'paddle_extractor.py'))
          ? path.resolve(process.cwd(), '..', 'backend', 'paddle_extractor.py')
          : path.resolve(process.cwd(), 'backend', 'paddle_extractor.py'));
      const args = [
        scriptPath,
        '--input',
        tempFilePath,
        '--mode',
        mode,
      ];
      if (template) {
        args.push('--template-file', tempTmplPath);
      }

      const proc = spawn('python', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        // Cleanup temp files
        try { fs.unlinkSync(tempFilePath); } catch {}
        try { if (template) fs.unlinkSync(tempTmplPath); } catch {}

        if (code === 0 && stdout.trim()) {
          let jsonStr = stdout.trim();
          const startMarker = '__PADDLE_JSON_OUTPUT_START__';
          const endMarker = '__PADDLE_JSON_OUTPUT_END__';
          if (jsonStr.includes(startMarker) && jsonStr.includes(endMarker)) {
            jsonStr = jsonStr.substring(
              jsonStr.indexOf(startMarker) + startMarker.length,
              jsonStr.indexOf(endMarker)
            ).trim();
          } else {
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }
          }

          try {
            const parsed = JSON.parse(jsonStr);
            resolve(parsed);
          } catch (jsonErr) {
            console.error('[PaddleServer] CLI extractor stdout parse failure. Raw output:', stdout);
            if (stderr) console.error('[PaddleServer] CLI extractor stderr:', stderr);
            resolve({ success: false, error: `Invalid JSON from PaddleOCR CLI: ${stderr || stdout.slice(0, 200)}` });
          }
        } else {
          console.error('[PaddleServer] CLI extractor error:', stderr || stdout);
          resolve({ success: false, error: stderr || `PaddleOCR CLI exited with code ${code}` });
        }
      });
    });
  }

  /**
   * Formats structured text summary
   */
  private static generateStructuredSummary(
    fieldValues: Record<string, string>,
    headers: string[],
    rows: Array<Record<string, string>>
  ): string {
    const lines: string[] = ['=== EXTRACTED FIELDS (PADDLEOCR-VL 1.6 LOCAL) ==='];
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
