/**
 * Utility to reliably extract and parse JSON from LLM responses.
 * Handles markdown code fences, trailing comments/text, balanced braces,
 * trailing commas, and unescaped characters.
 */

/**
 * Finds and extracts the first balanced JSON object {...} from text
 */
export function extractFirstJsonObject(text: string): string | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Finds and extracts the first balanced JSON array [...] from text
 */
export function extractFirstJsonArray(text: string): string | null {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Sanitizes and repairs common LLM JSON formatting defects
 */
export function sanitizeJsonString(str: string): string {
  let cleaned = str.trim();

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Strip single-line comments // ...
  cleaned = cleaned.replace(/\/\/[^\n\r]*/g, '');

  return cleaned;
}

/**
 * Intelligently repairs truncated JSON strings caused by model output token limits.
 * Balances open strings, trailing incomplete tokens, brackets, and braces.
 */
export function repairTruncatedJson(str: string): string {
  let cleaned = str.trim();

  // Strip leading code fence if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = 0;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }
  cleaned = cleaned.substring(startIdx);

  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') {
          stack.pop();
        }
      }
    }
  }

  // If ended inside a string, close it
  if (inString) {
    cleaned += '"';
  }

  // Remove any trailing incomplete key/value or trailing commas
  cleaned = cleaned.replace(/,\s*$/g, '');
  cleaned = cleaned.replace(/,\s*("[^"]*"\s*:\s*[^,}\]]*)$/g, '');
  cleaned = cleaned.replace(/,\s*("[^"]*"\s*:\s*)?$/g, '');

  // Close open brackets/braces in reverse order
  while (stack.length > 0) {
    const open = stack.pop();
    cleaned = cleaned.replace(/,\s*$/g, '');
    if (open === '{') {
      cleaned += '}';
    } else if (open === '[') {
      cleaned += ']';
    }
  }

  return sanitizeJsonString(cleaned);
}

/**
 * Robust JSON parse function that handles markdown wrappers, trailing prose,
 * unbalanced surrounding characters, and malformed syntax.
 */
export function cleanAndParseJson<T = any>(text: string): T {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty text provided for JSON parsing.');
  }

  const raw = text.trim();

  // 1. Try markdown code blocks first (e.g. ```json ... ```)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match[1]) {
      const blockContent = match[1].trim();
      const extracted =
        extractFirstJsonObject(blockContent) ||
        extractFirstJsonArray(blockContent) ||
        blockContent;

      try {
        return JSON.parse(extracted);
      } catch {
        try {
          return JSON.parse(sanitizeJsonString(extracted));
        } catch {
          // Continue searching
        }
      }
    }
  }

  // 2. Extract first matching balanced JSON object or array from raw text
  const extractedObj = extractFirstJsonObject(raw) || extractFirstJsonArray(raw);
  if (extractedObj) {
    try {
      return JSON.parse(extractedObj);
    } catch {
      try {
        return JSON.parse(sanitizeJsonString(extractedObj));
      } catch {
        // Fall through
      }
    }
  }

  // 3. Strip leading/trailing code fences and slice between first { and last }
  let cleaned = raw;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(sanitizeJsonString(cleaned));
    } catch {
      // 4. Fallback: repair truncated JSON (handles token limit exhaustion)
      const repaired = repairTruncatedJson(raw);
      return JSON.parse(repaired);
    }
  }
}

/**
 * Universal Numeric Field Normalizer & OCR Repair Helper:
 * Applies standardized numeric normalization rules across all template fields:
 * - Removes spaces between digits (e.g. "9 9 4" -> "994", "1 3 6 3" -> "1363")
 * - Removes unnecessary trailing punctuation such as '.', ',', ':', ';' (e.g. "9 9 4 ." -> "994", "994." -> "994")
 * - Strips OCR formatting artifacts while preserving meaningful decimal points (e.g. "1 2 3 . 0" -> "123.0", "99.4" -> "99.4")
 * - Handles comma thousand separators (e.g. "1,363" -> "1363")
 * - Distinguishes OCR formatting noise from non-numeric text ("unknown", "N/A", "not available" -> "")
 */
export function normalizeNumericFieldValue(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return isNaN(val) ? '' : String(val);
  }

  let str = String(val).trim();
  if (!str) return '';

  // 1. Distinguish actual non-numeric text (e.g. "unknown", "N/A", "not available", "none", "null")
  const lower = str.toLowerCase().replace(/[\s_\-–—]+/g, '');
  if (
    lower === 'unknown' ||
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'notavailable' ||
    lower === 'none' ||
    lower === 'null' ||
    lower === 'nil' ||
    lower === '-' ||
    lower === '--' ||
    lower === '?' ||
    lower === 'empty' ||
    lower === 'undefined'
  ) {
    return '';
  }

  // 2. Strip leading labels or prefixes if present, e.g. "Opening Counter: 9 9 4 ." -> "9 9 4 ."
  if (str.includes(':')) {
    const afterColon = str.split(':').pop()?.trim();
    if (afterColon && /\d/.test(afterColon)) {
      str = afterColon;
    }
  }

  // 3. Strip surrounding quotes, colons, semicolons, brackets
  str = str.replace(/^["'([{;:\s]+|["')\]};:\s]+$/g, '');

  // Count total dots in original raw string before stripping
  const originalDotCount = (str.match(/\./g) || []).length;

  // 4. Strip trailing punctuation such as '.', ',', ':', ';', '-', '_'
  str = str.replace(/[.,:;_\-\s]+$/, '').trim();

  // If no digits remain, return empty
  if (!/\d/.test(str)) {
    return '';
  }

  // 5. Remove thousand separator commas between digits (e.g. "1,363" -> "1363", "1, 363" -> "1363")
  str = str.replace(/(\d)\s*,\s*(\d)/g, '$1$2');

  // 5b. Evaluate mathematical addition expressions (e.g. "300 + 8", "300+8" -> 308, NOT 3008)
  if (str.includes('+')) {
    const addParts = str.split('+').map((p) => p.trim());
    if (addParts.length >= 2 && addParts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) {
      const sum = addParts.reduce((acc, curr) => acc + parseFloat(curr), 0);
      return Number.isInteger(sum) ? String(sum) : String(parseFloat(sum.toFixed(4)));
    }
  }

  // 6. If multiple dots existed in input (e.g. "4. 33 .", "1.2.3."), they are OCR noise artifacts in an integer
  if (originalDotCount > 1) {
    const isNegative = str.startsWith('-');
    const digitsOnly = str.replace(/[^\d]/g, '');
    if (!digitsOnly) return '';
    return isNegative ? `-${digitsOnly}` : digitsOnly;
  }

  // 7. Check for a single valid decimal point vs OCR noise
  const dotMatches = str.match(/\./g);
  const dotCount = dotMatches ? dotMatches.length : 0;

  if (dotCount === 1) {
    const dotIndex = str.indexOf('.');
    const beforeDot = str.substring(0, dotIndex);
    const afterDot = str.substring(dotIndex + 1);

    const intDigits = beforeDot.replace(/[^\d+-]/g, '');
    const decDigits = afterDot.replace(/[^\d]/g, '');

    // Check if dot was immediately followed by a space and multiple integer digits (e.g. "4. 33")
    const isDotSpaceNoise = !beforeDot.endsWith(' ') && afterDot.startsWith(' ') && decDigits.length >= 2;

    if (decDigits.length > 0 && !isDotSpaceNoise) {
      const cleanInt = intDigits.length > 0 ? intDigits : '0';
      return `${cleanInt}.${decDigits}`;
    } else {
      // Dot was trailing or space noise (e.g. "994.", "4. 33")
      const digitsOnly = str.replace(/[^\d]/g, '');
      const isNegative = str.startsWith('-');
      return isNegative ? `-${digitsOnly}` : digitsOnly;
    }
  }

  // Integer with spaced digits or simple number (e.g. "9 9 4", "1 3 6 3", "427")
  const isNegative = str.startsWith('-');
  const digitsOnly = str.replace(/[^\d]/g, '');
  if (!digitsOnly) return '';

  return isNegative ? `-${digitsOnly}` : digitsOnly;
}

export const repairOcrNumericValue = normalizeNumericFieldValue;
