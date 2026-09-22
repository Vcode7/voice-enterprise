import { UserSettings, DataTemplate, LookupTable, HandwritingScanningTemplate, OllamaGenerationOptions } from '../types';

export const DEFAULT_PARTS_LOOKUP_TABLE: LookupTable = {
  id: 'lookup_parts_catalog',
  name: 'Parts & Machines Master',
  description: 'Master catalog linking Part No to Machine Name, Description, Raw Material, and Cycle Time.',
  columns: ['Part No', 'Machine Name', 'Description', 'Raw Material', 'Cycle Time (s)'],
  rows: [
    {
      id: 'row_1',
      'Part No': 'PRT-4029',
      'Machine Name': 'Injection Machine 01',
      'Description': 'Housing Gear Box',
      'Raw Material': 'ABS Resin Grade A',
      'Cycle Time (s)': '45',
    },
    {
      id: 'row_2',
      'Part No': 'PRT-1002',
      'Machine Name': 'CNC Milling 03',
      'Description': 'Shaft Rotor Pin',
      'Raw Material': 'Stainless Steel 304',
      'Cycle Time (s)': '120',
    },
    {
      id: 'row_3',
      'Part No': 'PRT-8831',
      'Machine Name': 'Hydraulic Press 02',
      'Description': 'Bracket Base Plate',
      'Raw Material': 'Carbon Steel',
      'Cycle Time (s)': '30',
    },
    {
      id: 'row_4',
      'Part No': 'PRT-5510',
      'Machine Name': 'Extruder Line 04',
      'Description': 'Polymer Gasket Ring',
      'Raw Material': 'EPDM Rubber',
      'Cycle Time (s)': '15',
    },
    {
      id: 'row_5',
      'Part No': 'PRT-2204',
      'Machine Name': 'Laser Cutter 01',
      'Description': 'Flange Mounting Disc',
      'Raw Material': 'Aluminum 6061',
      'Cycle Time (s)': '60',
    },
    {
      id: 'row_6',
      'Part No': '29465634',
      'Machine Name': 'NEW-150',
      'Description': 'FR BTM',
      'Raw Material': 'PPCP NC',
      'Cycle Time (s)': '70',
    },
  ],
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Food',
  'Transport',
  'Shopping',
  'Entertainment',
  'Bills',
  'Rent',
  'Healthcare',
  'Education',
  'Travel',
  'Subscriptions',
  'Fuel',
  'Salary',
  'Investment',
  'Other',
] as const;

export const PAYMENT_METHOD_CATEGORIES = [
  {
    category: 'Cash',
    methods: ['Cash'],
  },
  {
    category: 'Cards',
    methods: ['Credit Card', 'Debit Card', 'RuPay Credit Card', 'RuPay Debit Card', 'Other Card'],
  },
  {
    category: 'UPI',
    methods: ['UPI', 'Google Pay', 'PhonePe', 'Paytm', 'Amazon Pay', 'BHIM', 'Other UPI'],
  },
] as const;

export const DEFAULT_PAYMENT_METHODS = [
  'Cash',
  'Credit Card',
  'Debit Card',
  'RuPay Credit Card',
  'RuPay Debit Card',
  'Other Card',
  'UPI',
  'Google Pay',
  'PhonePe',
  'Paytm',
  'Amazon Pay',
  'BHIM',
  'Other UPI',
] as const;

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
] as const;

export const DEFAULT_OLLAMA_OPTIONS: OllamaGenerationOptions = {
  temperature: 0.1,
  num_predict: 2048,
  num_ctx: 2048,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  repeat_last_n: 64,
};

export const DEFAULT_SETTINGS: UserSettings = {
  currency: 'INR',
  currencySymbol: '₹',
  businessName: 'My Enterprise / Shop',
  businessPhone: '+91 98765 43210',
  businessAddress: '123 Market Street, Main City',
  gstin: '22AAAAA0000A1Z5',
  receiptPrefix: 'INV-',
  invoiceFormat: 'standard',
  bankDetails: {
    bankName: 'HDFC Bank',
    accountHolder: 'My Enterprise / Shop',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0001234',
    branch: 'Main City Branch',
  },
  defaultExtractionMethod: 'chandra_2',
  geminiModel: 'gemini-3.5-flash-lite',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaVisionModel: 'qwen2.5vl:7b',
  ollamaOptions: { ...DEFAULT_OLLAMA_OPTIONS },
  chandraLoadingMethod: 'ollama',
  chandraMode: 'full_image',
  chandraQuantization: '3-bit',
  chandraOllamaModel: 'ahmgam/chandra-ocr-2:q4',
  chandraUpscale: false,
};

// 1. Indepth Template (formerly Monitoring Details)
export const INDEPTH_TEMPLATE: DataTemplate = {
  id: 'template_indepth_monitoring',
  name: 'Indepth Template',
  description: 'Detailed production run monitoring log with counters, cycle time, cavities, weights & hourly logs.',
  isDefault: false,
  fields: [
    { id: 'f_part_no', name: 'Part No', extractionKey: 'part_no', type: 'text', placeholder: 'e.g. PRT-4029' },
    { id: 'f_description', name: 'Description', extractionKey: 'description', type: 'text', placeholder: 'e.g. Housing Gear Box' },
    { id: 'f_raw_material', name: 'Raw Material', extractionKey: 'raw_material', type: 'text', placeholder: 'e.g. ABS Resin Grade A' },
    { id: 'f_planned_date', name: 'Planned Production Date', extractionKey: 'planned_production_date', type: 'date', placeholder: 'YYYY-MM-DD' },
    { id: 'f_batch_no', name: 'Batch No', extractionKey: 'batch_no', type: 'text', placeholder: 'e.g. B-2026-08' },
    { id: 'f_shift', name: 'Shift', extractionKey: 'shift', type: 'select', options: ['A', 'B', 'C'], placeholder: 'Select Shift (A, B, or C)' },
    { id: 'f_opening_counter', name: 'Opening Counter', extractionKey: 'opening_counter', type: 'number', placeholder: 'e.g. 12500' },
    { id: 'f_closing_counter', name: 'Closing Counter', extractionKey: 'closing_counter', type: 'number', placeholder: 'e.g. 13800' },
    { id: 'f_cycle_time', name: 'Cycle Time', extractionKey: 'cycle_time', type: 'text', placeholder: 'e.g. 45 sec' },
    { id: 'f_startup_time', name: 'Startup Time', extractionKey: 'startup_time', type: 'time', placeholder: 'e.g. 08:30 AM' },
    { id: 'f_operator_no', name: 'Operator No', extractionKey: 'operator_no', type: 'text', placeholder: 'e.g. OP-104' },
    { id: 'f_no_of_cavities', name: 'No. of Cavities', extractionKey: 'no_of_cavities', type: 'number', placeholder: 'e.g. 4' },
    { id: 'f_purge_weight', name: 'Purge Weight', extractionKey: 'purge_weight', type: 'number', placeholder: 'e.g. 250 g' },
    { id: 'f_runner_weight', name: 'Runner Weight', extractionKey: 'runner_weight', type: 'number', placeholder: 'e.g. 45 g' },
  ],
  hasTable: true,
  tableTitle: 'Repeated Entries',
  tableFields: [
    { id: 'tf_start_time', name: 'Start Time', extractionKey: 'start_time', type: 'time', placeholder: '08:00 AM' },
    { id: 'tf_end_time', name: 'End Time', extractionKey: 'end_time', type: 'time', placeholder: '09:00 AM' },
    { id: 'tf_planned_qty', name: 'Planned Qty', extractionKey: 'planned_qty', type: 'number', placeholder: '100' },
    { id: 'tf_produced_qty', name: 'Produced Qty', extractionKey: 'produced_qty', type: 'number', placeholder: '98' },
    { id: 'tf_rejection', name: 'Rejection', extractionKey: 'rejection', type: 'number', placeholder: '2' },
    { id: 'tf_remarks', name: 'Remarks', extractionKey: 'remarks', type: 'text', placeholder: 'e.g. Normal Run' },
  ],
  lookupConfig: {
    enabled: true,
    tableId: 'lookup_parts_catalog',
    tableName: 'Parts & Machines Master',
    mainFieldKey: 'part_no',
    mainTableColumn: 'Part No',
    fieldMappings: [
      { fieldKey: 'description', tableColumn: 'Description' },
      { fieldKey: 'raw_material', tableColumn: 'Raw Material' },
      { fieldKey: 'cycle_time', tableColumn: 'Cycle Time (s)' },
    ],
    strictValidation: true,
  },
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

// 2. New Default Template (No table, concise 9 fields with Table Lookup)
export const NEW_DEFAULT_TEMPLATE: DataTemplate = {
  id: 'template_default_concise',
  name: 'Default Template',
  description: 'Standard daily production log with machine, part, description, material, quantities, date, and shift.',
  isDefault: true,
  fields: [
    { id: 'f_part_no', name: 'Part No', extractionKey: 'part_no', type: 'text', placeholder: 'e.g. PRT-4029' },
    { id: 'f_machine_name', name: 'Machine Name', extractionKey: 'machine_name', type: 'text', placeholder: 'e.g. Injection Machine 01' },
    { id: 'f_description', name: 'Description', extractionKey: 'description', type: 'text', placeholder: 'e.g. Housing Gear Box' },
    { id: 'f_raw_material', name: 'Raw Material', extractionKey: 'raw_material', type: 'text', placeholder: 'e.g. ABS Resin Grade A' },
    { id: 'f_prod_n_qty', name: 'Prod n Qty', extractionKey: 'prod_n_qty', type: 'text', placeholder: 'e.g. 500 pcs' },
    { id: 'f_reg_n_qty', name: 'Reg n Qty', extractionKey: 'reg_n_qty', type: 'text', placeholder: 'e.g. 12 pcs' },
    { id: 'f_ok_qty', name: 'OK Qty', extractionKey: 'ok_qty', type: 'text', placeholder: 'e.g. 488 pcs' },
    { id: 'f_date', name: 'Date', extractionKey: 'date', type: 'text', placeholder: 'e.g. 21-08-2026' },
    { id: 'f_shift', name: 'Shift', extractionKey: 'shift', type: 'select', options: ['A', 'B', 'C'], placeholder: 'Select Shift (A, B, or C)' },
  ],
  hasTable: false,
  tableFields: [],
  lookupConfig: {
    enabled: true,
    tableId: 'lookup_parts_catalog',
    tableName: 'Parts & Machines Master',
    mainFieldKey: 'part_no',
    mainTableColumn: 'Part No',
    fieldMappings: [
      { fieldKey: 'machine_name', tableColumn: 'Machine Name' },
      { fieldKey: 'description', tableColumn: 'Description' },
      { fieldKey: 'raw_material', tableColumn: 'Raw Material' },
    ],
    strictValidation: true,
  },
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
};

// Aliases
export const DEFAULT_MONITORING_DETAILS_TEMPLATE = NEW_DEFAULT_TEMPLATE;
export const SYSTEM_DEFAULT_TEMPLATES = [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE];
export const SYSTEM_DEFAULT_LOOKUP_TABLES = [DEFAULT_PARTS_LOOKUP_TABLE];

export const COLORS = {
  primary: '#6366F1',
  primaryDark: '#4F46E5',
  secondary: '#10B981',
  accent: '#F59E0B',
  danger: '#EF4444',
  background: '#0F172A',
  card: '#1E293B',
  cardBorder: '#334155',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  inputBg: '#0F172A',
  dataColor: '#06B6D4',
};

// ----------------------------------------------------
// Dedicated Handwriting Scanning Template
// ----------------------------------------------------
export const DEFAULT_HANDWRITING_SCANNING_TEMPLATE: HandwritingScanningTemplate = {
  id: 'handwriting_scanning_default',
  name: 'Handwriting Scanning Template',
  description: 'Dedicated default template for handwriting scanning with direction-based extraction and table extraction.',
  fields: [
    { id: 'hw_part_no', field_name: 'Part No', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_machine_name', field_name: 'Machine Name', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_description', field_name: 'Description', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_raw_material', field_name: 'Raw Material', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_planned_production', field_name: 'Planned Production', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_date', field_name: 'Date', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_shift', field_name: 'Shift', field_type: 'digital', value_type: 'd', look_for: 'right' },
    { id: 'hw_batch_no', field_name: 'Batch No', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_opening_cycle', field_name: 'Opening Cycle', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_closing_cycle', field_name: 'Closing Cycle', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_cycle_time', field_name: 'Cycle Time', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_startup_time', field_name: 'Startup Time', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_operator', field_name: 'Operator', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_no_of_cavities', field_name: 'No of Cavities', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_purge_weight', field_name: 'Purge Weight', field_type: 'digital', value_type: 'h', look_for: 'right' },
    { id: 'hw_runner_weight', field_name: 'Runner Weight', field_type: 'digital', value_type: 'h', look_for: 'right' },
  ],
  table_columns: [
    { id: 'tc_start_time', column_name: 'Start Time', value_type: 'd', is_number: false, calculate_total: false },
    { id: 'tc_end_time', column_name: 'End Time', value_type: 'd', is_number: false, calculate_total: false },
    { id: 'tc_planned_qty', column_name: 'Planned Qty', value_type: 'h', is_number: true, calculate_total: true },
    { id: 'tc_produced_qty', column_name: 'Produced Qty', value_type: 'h', is_number: true, calculate_total: true },
    { id: 'tc_rejection', column_name: 'Rejection', value_type: 'h', is_number: true, calculate_total: true },
  ],
  tables: [
    {
      id: 'table_production_log',
      name: 'Production Table',
      columns: [
        { id: 'tc_start_time', column_name: 'Start Time', value_type: 'd', is_number: false, calculate_total: false },
        { id: 'tc_end_time', column_name: 'End Time', value_type: 'd', is_number: false, calculate_total: false },
        { id: 'tc_planned_qty', column_name: 'Planned Qty', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'tc_produced_qty', column_name: 'Produced Qty', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'tc_rejection', column_name: 'Rejection', value_type: 'h', is_number: true, calculate_total: true },
      ],
    },
    {
      id: 'table_rejection',
      name: 'Rejection',
      columns: [
        { id: 'rej_col_1', column_name: 'STRUP', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_2', column_name: 'BD', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_3', column_name: 'SS', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_4', column_name: 'SM', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_5', column_name: 'BM', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_6', column_name: 'ST', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_7', column_name: 'WL', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_8', column_name: 'SC', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_9', column_name: 'PC', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_10', column_name: 'AB', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_11', column_name: 'PH', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_12', column_name: 'FS', value_type: 'h', is_number: true, calculate_total: true },
        { id: 'rej_col_13', column_name: 'TOTAL', value_type: 'h', is_number: true, calculate_total: true },
      ],
    },
  ],
  lookupConfig: {
    enabled: true,
    tableId: 'lookup_parts_catalog',
    tableName: 'Parts & Machines Master',
    mainFieldKey: 'Part No',
    mainTableColumn: 'Part No',
    fieldMappings: [
      { fieldKey: 'Machine Name', tableColumn: 'Machine Name' },
      { fieldKey: 'Description', tableColumn: 'Description' },
      { fieldKey: 'Raw Material', tableColumn: 'Raw Material' },
      { fieldKey: 'Cycle Time', tableColumn: 'Cycle Time (s)' },
    ],
    strictValidation: true,
  },
  updatedAt: '2026-09-03T00:00:00.000Z',
};


