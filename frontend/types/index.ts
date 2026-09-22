import { SapUploadStatus } from './sap';

export type FinancialIntent =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'lend'
  | 'borrow'
  | 'repayment'
  | 'query'
  | 'budget'
  | 'reminder'
  | 'correction'
  | 'unknown'
  | 'create_receipt';

export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  userId?: string;
  amount: number;
  currency: string;
  merchant?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  transactionType: TransactionType;
  description?: string | null;
  transcript?: string | null;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO String
}

export interface ExtractedIntentItem {
  intent: FinancialIntent;
  amount?: number | null;
  currency?: string | null;
  merchant?: string | null;
  category?: string | null;
  payment_method?: string | null;
  transaction_type?: TransactionType | null;
  description?: string | null;
  date?: string | null;
  person_name?: string | null;
  target_category?: string | null;
}

export interface ExtractedIntentResult {
  intent: FinancialIntent;
  amount?: number | null;
  currency?: string | null;
  merchant?: string | null;
  category?: string | null;
  payment_method?: string | null;
  transaction_type?: TransactionType | null;
  description?: string | null;
  date?: string | null;
  person_name?: string | null;
  target_category?: string | null;
  raw_transcript?: string;
  transactions?: ExtractedIntentItem[];
  entries?: ExtractedIntentItem[];
}

export interface ReceiptItem {
  id: string;
  name: string;
  hsnCode?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface ExtractedReceiptItem {
  name: string;
  hsn_code?: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
}

export type TaxType = 'gst' | 'igst' | 'none';

export interface ExtractedReceiptResult {
  intent: 'create_receipt';
  items: ExtractedReceiptItem[];
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  customer_gstin?: string | null;
  discount?: number | null;
  tax?: number | null;
  tax_percent?: number | null;
  tax_type?: TaxType | null;
  currency?: string | null;
  raw_transcript?: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  date: string; // YYYY-MM-DD
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerGstin?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  taxPercent: number;
  taxType: TaxType;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  currency: string;
  notes?: string | null;
  format?: 'standard' | 'basic_tax';
  transcript?: string | null;
  createdAt: string;
}

export interface Budget {
  id: string;
  category: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  createdAt: string;
}

export interface Debt {
  id: string;
  personName: string;
  amount: number;
  type: 'given' | 'borrowed';
  settled: boolean;
  notes?: string | null;
  date: string;
  updatedAt: string;
}

export interface RecurringPayment {
  id: string;
  title: string;
  amount: number;
  currency: string;
  frequency: 'monthly' | 'weekly' | 'yearly';
  nextDueDate: string;
  category: string;
}

export type InvoiceFormatType = 'standard' | 'basic_tax';

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
}

export interface UserSettings {
  currency: string;
  currencySymbol: string;
  businessName: string;
  businessPhone: string;
  businessAddress: string;
  gstin: string;
  receiptPrefix: string;
  invoiceFormat?: InvoiceFormatType;
  bankDetails?: BankDetails;
  customGroqApiKey?: string;
  huggingFaceApiKey?: string;
  customGeminiApiKey?: string;
  defaultExtractionMethod?: ExtractionMethodType;
  geminiModel?: string;
  ollamaBaseUrl?: string;
  ollamaVisionModel?: string;
  ollamaOptions?: OllamaGenerationOptions;
  chandraLoadingMethod?: ChandraLoadingMethodType;
  chandraMode?: ChandraModeType;
  chandraQuantization?: ChandraQuantizationType;
  chandraOllamaModel?: string;
  chandraUpscale?: boolean;
}

export interface OllamaGenerationOptions {
  temperature?: number;
  num_predict?: number;
  num_ctx?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  repeat_last_n?: number;
  seed?: number;
  stop?: string[];
  min_p?: number;
  num_batch?: number;
  num_gpu?: number;
}

export type ExtractionMethodType = 'gemini' | 'chandra_2' | 'trocr_groq' | 'paddleocr_vl' | 'ollama_vision';
export type ChandraModeType = 'full_image' | 'detected_region';
export type ChandraQuantizationType = '3-bit' | '4-bit' | '8-bit';
export type ChandraLoadingMethodType = 'local' | 'ollama';

export interface OllamaVisionModel {
  id: string;
  name: string;
  size?: number;
  parameterSize?: string;
  quantization?: string;
  isVisionCapable: boolean;
  modifiedAt?: string;
  family?: string;
}

export interface FinancialQueryResult {
  queryType: 'category_total' | 'biggest_expense' | 'payment_method_total' | 'income_vs_expense' | 'count' | 'general';
  category?: string | null;
  paymentMethod?: string | null;
  period?: 'this_month' | 'last_month' | 'all_time' | null;
  answerText?: string;
  calculatedValue?: number;
}

export type RecordingState =
  | 'Ready'
  | 'Recording'
  | 'Processing'
  | 'Transcribing'
  | 'Understanding'
  | 'Complete'
  | 'Error';

export interface ImportResult {
  totalFound: number;
  importedCount: number;
  skippedCount: number;
  errors?: string[];
}

export type FieldType = 'text' | 'number' | 'date' | 'time' | 'select' | 'boolean' | 'fixed';

export interface TemplateField {
  id: string;
  name: string;
  extractionKey: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  defaultValue?: string;
  placeholder?: string;
  // Fixed Value properties
  is_fixed?: boolean;
  fixed_value?: string;
  fixed_values?: string[];
  fixed_source?: 'manual' | 'file';
  fixed_file_name?: string;
  fixed_column_name?: string;
}

export type LookupMergeStrategy = 'update' | 'skip' | 'append';

export interface LookupTableMergeStats {
  addedRows: number;
  updatedRows: number;
  duplicateRows: number;
  newColumns: string[];
  totalRows: number;
}

export interface LookupTableRow {
  id: string;
  [columnKey: string]: any;
}

export interface LookupTable {
  id: string;
  name: string;
  description?: string;
  columns: string[];
  rows: LookupTableRow[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateLookupMapping {
  fieldKey: string;     // Template field extractionKey (e.g. 'machine_name')
  tableColumn: string;  // Column in Lookup Table (e.g. 'Machine Name')
}

export interface TemplateLookupConfig {
  enabled: boolean;
  tableId: string;           // ID of the LookupTable
  tableName?: string;        // Cache name for display
  mainFieldKey: string;      // Field extractionKey (e.g. 'part_no')
  mainTableColumn: string;   // Column header in table (e.g. 'Part No')
  fieldMappings: TemplateLookupMapping[];
  strictValidation: boolean; // strict validation: only values in table accepted
}

export interface LookupValidationStatus {
  isValid: boolean;
  mainFieldKey: string;
  spokenValue?: string;
  matchedValue?: string;
  tableName?: string;
  tableId?: string;
  autoFilledFields?: string[];
  autoFilledCount?: number;
  error?: string;
}

export interface EntryTableData {
  name: string;
  headers: string[];
  rows: Array<Record<string, any>> | Array<any[]>;
}

export interface DataTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  fields: TemplateField[];
  hasTable: boolean;
  tableTitle?: string;
  tableFields: TemplateField[];
  tables?: Array<{
    id?: string;
    name: string;
    fields: TemplateField[];
  }>;
  lookupConfig?: TemplateLookupConfig;
  createdAt: string;
  updatedAt: string;
}

export interface FlexibleField {
  id?: string;
  name: string;
  value: string | number;
}

export interface FlexibleTable {
  title?: string;
  headers: string[];
  rows: Array<string[]>;
}

export type EntrySourceType = 'voice' | 'handwritten';

export interface DataEntryRecord {
  id: string;
  sourceType?: EntrySourceType;
  templateId: string;
  templateName: string;
  isFlexible?: boolean;
  title?: string;
  fieldValues: Record<string, any>;
  flexibleFields?: FlexibleField[];
  tableTitle?: string;
  tableHeaders?: string[];
  tableRows: Array<Record<string, any>> | Array<any[]>;
  tables?: EntryTableData[];
  rawTranscript?: string | null;
  rawOcrText?: string | null;
  documentUrl?: string | null;
  documentName?: string | null;
  missingFields?: string[];
  lookupValidation?: LookupValidationStatus | null;
  entries?: SessionDataEntry[];
  totalEntries?: number;
  date: string;
  createdAt: string;
  updatedAt: string;
  // SAP Upload Tracking
  sapUploadStatus?: SapUploadStatus;
  sapDocumentNumber?: string | null;
  sapLastUpload?: string | null;
  sapErrorMessage?: string | null;
}

export interface ExtractedDataResult {
  templateId: string;
  templateName: string;
  isFlexible?: boolean;
  title?: string;
  fieldValues: Record<string, any>;
  flexibleFields?: FlexibleField[];
  tableTitle?: string;
  tableHeaders?: string[];
  tableRows: Array<Record<string, any>> | Array<any[]>;
  missingFields?: string[];
  lookupValidation?: LookupValidationStatus | null;
  raw_transcript?: string;
}

export interface FlexibleExtractedResult {
  isFlexible: true;
  title?: string;
  fields: FlexibleField[];
  table?: FlexibleTable | null;
  raw_transcript?: string;
}

export interface SessionDataEntry {
  id: string;
  entryNumber: number;
  sourceType?: EntrySourceType;
  mode: 'template' | 'flexible';
  templateId?: string;
  templateName?: string;
  title?: string;
  fieldValues: Record<string, any>;
  flexibleFields?: FlexibleField[];
  tableTitle?: string;
  tableHeaders?: string[];
  tableRows?: Array<Record<string, any>> | Array<any[]>;
  tables?: EntryTableData[];
  missingFields?: string[];
  lookupValidation?: LookupValidationStatus | null;
  rawTranscript?: string | null;
  rawOcrText?: string | null;
  audioUrl?: string | null;
  documentUrl?: string | null;
  documentName?: string | null;
  confidenceScore?: number;
  createdAt: string;
}

export type ModelVariantType = 'base' | 'finetuned' | 'checkpoint';

export interface OcrCheckpointInfo {
  id: string;
  name: string;
  path?: string;
  is_base?: boolean;
  description?: string;
  timestamp?: string;
  trained_samples_count?: number;
  final_loss?: number;
  epochs?: number;
  device?: string;
  training_info?: any;
}

export interface ModelVariantsResponse {
  variants: Array<{
    id: ModelVariantType;
    name: string;
    description: string;
  }>;
  checkpoints: OcrCheckpointInfo[];
  defaultVariant: ModelVariantType;
  baseModel: string;
}

export type HandwrittenEngineType = 'trocr-large' | 'groq-vision' | 'hybrid' | 'gemini' | 'paddleocr_vl' | 'ollama_vision';

export interface OcrPageResult {
  pageNumber: number;
  imageUrl?: string;
  ocrText: string;
  rawOcrHtml?: string;
  ocrRecordId?: string;
  isEditing?: boolean;
}

export interface HandwrittenOcrResponse {
  pages: OcrPageResult[];
  rawCombinedText: string;
  engineUsed: string;
  totalPages: number;
}

export interface HandwrittenStructureRequest {
  pages: Array<{
    pageNumber: number;
    ocrText: string;
    imageUrl?: string;
  }>;
  template?: DataTemplate | null;
  mode?: 'template' | 'flexible';
  documentName?: string;
  ocrMethod?: string;
}

export interface HandwrittenExtractResult {
  entries: SessionDataEntry[];
  rawOcrText: string;
  detectedEngine: string;
  totalEntries: number;
  missingFieldsSummary?: string[];
  pages?: OcrPageResult[];
}

// ----------------------------------------------------
// Dedicated Handwriting Scanning Template Types
// ----------------------------------------------------
export type HandwritingValueType = 'h' | 'd';
export type HandwritingDirection = 'right' | 'left' | 'up' | 'down';

export interface HandwritingFieldConfig {
  id: string;
  field_name: string;
  field_type: 'digital';
  value_type: HandwritingValueType;
  look_for: HandwritingDirection;
  // Fixed Value properties
  is_fixed?: boolean;
  fixed_value?: string;
  fixed_values?: string[];
  fixed_source?: 'manual' | 'file';
  fixed_file_name?: string;
  fixed_column_name?: string;
}

export interface HandwritingTableColumnConfig {
  id: string;
  column_name: string;
  value_type: HandwritingValueType;
  is_number?: boolean;
  calculate_total?: boolean;
}

export interface HandwritingTableConfig {
  id: string;
  name: string;
  columns: HandwritingTableColumnConfig[];
}

export interface HandwritingScanningTemplate {
  id: string;
  name: string;
  description: string;
  fields: HandwritingFieldConfig[];
  table_columns: HandwritingTableColumnConfig[];
  tables?: HandwritingTableConfig[];
  lookupConfig?: TemplateLookupConfig;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface HandwritingFieldExtractionResult {
  field_name: string;
  field_type: 'digital';
  value_type: HandwritingValueType;
  look_for: HandwritingDirection;
  value: string;
  raw_value?: string;
  label_bbox?: number[];
  value_bbox?: number[];
  confidence: number;
  source: 'trocr' | 'paddleocr' | 'gemini' | 'ollama_vision' | 'paddleocr_vl' | 'chandra_2' | 'chandra_2_full_image' | 'chandra_2_crop';
}

export interface HandwritingExtractionApiResponse {
  success: boolean;
  filename?: string;
  template_name: string;
  fields: HandwritingFieldExtractionResult[];
  field_values: Record<string, string>;
  table_headers: string[];
  table_rows: Array<Record<string, string>>;
  tables?: EntryTableData[];
  structured_text: string;
  raw_text: string;
  total_pages: number;
  processing_time_ms: number;
  device?: string;
  engineUsed?: string;
  error?: string;
}

export * from './sap';






