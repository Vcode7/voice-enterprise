/**
 * Database Models and Access Layer for Next.js.
 * All database operations are forwarded to the Python FastAPI backend backed by SQLite.
 */

import {
  Transaction,
  Receipt,
  Budget,
  Debt,
  DataTemplate,
  DataEntryRecord,
  UserSettings,
  LookupTable,
  HandwritingScanningTemplate,
  SapIntegrationConfig,
  SapFieldMapping,
  SapUploadLog,
} from '../../types';
import {
  DEFAULT_SETTINGS,
  NEW_DEFAULT_TEMPLATE,
  INDEPTH_TEMPLATE,
  DEFAULT_PARTS_LOOKUP_TABLE,
  DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
} from '../constants';
import { apiUrl } from '../api/apiClient';

// ----------------------------------------------------
// 1. Transactions Collection
// ----------------------------------------------------
export const dbTransactions = {
  async getAll(): Promise<Transaction[]> {
    try {
      const res = await fetch(apiUrl('/api/transactions'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbTransactions.getAll error]', e);
    }
    return [];
  },

  async getById(id: string): Promise<Transaction | null> {
    try {
      const res = await fetch(apiUrl(`/api/transactions/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbTransactions.getById error]', e);
    }
    return null;
  },

  async create(data: Partial<Transaction>): Promise<Transaction> {
    const res = await fetch(apiUrl('/api/transactions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create transaction: ${res.statusText}`);
    return await res.json();
  },

  async createMany(items: Transaction[]): Promise<Transaction[]> {
    const created: Transaction[] = [];
    for (const item of items) {
      created.push(await this.create(item));
    }
    return created;
  },

  async update(id: string, updates: Partial<Transaction>): Promise<Transaction | null> {
    const res = await fetch(apiUrl(`/api/transactions/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) return await res.json();
    return null;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/transactions/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'transactions' }),
    });
  },
};

// ----------------------------------------------------
// 2. Receipts Collection
// ----------------------------------------------------
export const dbReceipts = {
  async getAll(): Promise<Receipt[]> {
    try {
      const res = await fetch(apiUrl('/api/receipts'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbReceipts.getAll error]', e);
    }
    return [];
  },

  async getById(id: string): Promise<Receipt | null> {
    try {
      const res = await fetch(apiUrl(`/api/receipts/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbReceipts.getById error]', e);
    }
    return null;
  },

  async getNextReceiptNumber(): Promise<string> {
    try {
      const res = await fetch(apiUrl('/api/receipts/next-number'), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return data.receiptNumber || data.nextNumber || 'INV-1001';
      }
    } catch (e) {
      console.warn('[dbReceipts.getNextReceiptNumber error]', e);
    }
    return 'INV-1001';
  },

  async create(data: Partial<Receipt>): Promise<Receipt> {
    const res = await fetch(apiUrl('/api/receipts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create receipt: ${res.statusText}`);
    return await res.json();
  },

  async createMany(items: Receipt[]): Promise<Receipt[]> {
    const created: Receipt[] = [];
    for (const item of items) {
      created.push(await this.create(item));
    }
    return created;
  },

  async update(id: string, updates: Partial<Receipt>): Promise<Receipt | null> {
    const res = await fetch(apiUrl(`/api/receipts/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) return await res.json();
    return null;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/receipts/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'receipts' }),
    });
  },
};

// ----------------------------------------------------
// 3. Budgets Collection
// ----------------------------------------------------
export const dbBudgets = {
  async getAll(): Promise<Budget[]> {
    try {
      const res = await fetch(apiUrl('/api/budgets'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbBudgets.getAll error]', e);
    }
    return [];
  },

  async setBudget(category: string, amount: number, period: Budget['period'] = 'monthly'): Promise<Budget> {
    const res = await fetch(apiUrl('/api/budgets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, amount, period }),
    });
    if (!res.ok) throw new Error(`Failed to set budget: ${res.statusText}`);
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/budgets/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'budgets' }),
    });
  },
};

// ----------------------------------------------------
// 4. Debts Collection
// ----------------------------------------------------
export const dbDebts = {
  async getAll(): Promise<Debt[]> {
    try {
      const res = await fetch(apiUrl('/api/debts'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbDebts.getAll error]', e);
    }
    return [];
  },

  async recordDebt(
    personName: string,
    amount: number,
    type: 'given' | 'borrowed',
    notes?: string | null,
    date?: string
  ): Promise<Debt> {
    const res = await fetch(apiUrl('/api/debts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, amount, type, notes, date }),
    });
    if (!res.ok) throw new Error(`Failed to record debt: ${res.statusText}`);
    return await res.json();
  },

  async recordRepayment(personName: string, amount: number): Promise<Debt | null> {
    const res = await fetch(apiUrl('/api/debts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repayment', personName, amount }),
    });
    if (res.ok) return await res.json();
    return null;
  },

  async toggleSettled(id: string): Promise<Debt | null> {
    const res = await fetch(apiUrl(`/api/debts/${id}/toggle`), {
      method: 'PATCH',
    });
    if (res.ok) return await res.json();
    return null;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/debts/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'debts' }),
    });
  },
};

// ----------------------------------------------------
// 5. Templates Collection
// ----------------------------------------------------
export const dbTemplates = {
  async getAll(): Promise<DataTemplate[]> {
    try {
      const res = await fetch(apiUrl('/api/templates'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbTemplates.getAll error]', e);
    }
    return [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE];
  },

  async getById(id: string): Promise<DataTemplate | null> {
    try {
      const res = await fetch(apiUrl(`/api/templates/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbTemplates.getById error]', e);
    }
    return null;
  },

  async save(template: DataTemplate): Promise<DataTemplate> {
    const res = await fetch(apiUrl('/api/templates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });
    if (!res.ok) throw new Error(`Failed to save template: ${res.statusText}`);
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    if (id === NEW_DEFAULT_TEMPLATE.id) return false;
    const res = await fetch(apiUrl(`/api/templates/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async resetDefaults(): Promise<DataTemplate[]> {
    const res = await fetch(apiUrl('/api/templates/reset'), { method: 'POST' });
    if (res.ok) return await res.json();
    return [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE];
  },
};

// ----------------------------------------------------
// 5.6 Dedicated Handwriting Scanning Template Collection
// ----------------------------------------------------
export const dbHandwritingTemplate = {
  async getAll(): Promise<HandwritingScanningTemplate[]> {
    try {
      const res = await fetch(apiUrl('/api/handwritten/template'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbHandwritingTemplate.getAll error]', e);
    }
    return [{ ...DEFAULT_HANDWRITING_SCANNING_TEMPLATE }];
  },

  async getById(id: string): Promise<HandwritingScanningTemplate | null> {
    try {
      const res = await fetch(apiUrl(`/api/handwritten/template?id=${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbHandwritingTemplate.getById error]', e);
    }
    return null;
  },

  async get(): Promise<HandwritingScanningTemplate> {
    try {
      const res = await fetch(apiUrl('/api/handwritten/template?single=true'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbHandwritingTemplate.get error]', e);
    }
    return { ...DEFAULT_HANDWRITING_SCANNING_TEMPLATE };
  },

  async save(template: HandwritingScanningTemplate): Promise<HandwritingScanningTemplate> {
    const res = await fetch(apiUrl('/api/handwritten/template'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });
    if (!res.ok) throw new Error(`Failed to save handwriting template: ${res.statusText}`);
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/handwritten/template?id=${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async reset(): Promise<HandwritingScanningTemplate[]> {
    const res = await fetch(apiUrl('/api/handwritten/template'), { method: 'DELETE' });
    if (res.ok) return await res.json();
    return [{ ...DEFAULT_HANDWRITING_SCANNING_TEMPLATE }];
  },
};

// ----------------------------------------------------
// 5.5 Lookup Tables Collection
// ----------------------------------------------------
export const dbLookupTables = {
  async getAll(): Promise<LookupTable[]> {
    try {
      const res = await fetch(apiUrl('/api/lookup-tables'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbLookupTables.getAll error]', e);
    }
    return [DEFAULT_PARTS_LOOKUP_TABLE];
  },

  async getById(id: string): Promise<LookupTable | null> {
    try {
      const res = await fetch(apiUrl(`/api/lookup-tables/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbLookupTables.getById error]', e);
    }
    return null;
  },

  async save(table: LookupTable): Promise<LookupTable> {
    const res = await fetch(apiUrl('/api/lookup-tables'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(table),
    });
    if (!res.ok) throw new Error(`Failed to save lookup table: ${res.statusText}`);
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    if (id === DEFAULT_PARTS_LOOKUP_TABLE.id) return false;
    const res = await fetch(apiUrl(`/api/lookup-tables/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async resetDefaults(): Promise<LookupTable[]> {
    const res = await fetch(apiUrl('/api/lookup-tables/reset'), { method: 'POST' });
    if (res.ok) return await res.json();
    return [DEFAULT_PARTS_LOOKUP_TABLE];
  },
};

// ----------------------------------------------------
// 6. Data Entries (ERP Records) Collection
// ----------------------------------------------------
export const dbDataEntries = {
  async getAll(): Promise<DataEntryRecord[]> {
    try {
      const res = await fetch(apiUrl('/api/data-entries'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbDataEntries.getAll error]', e);
    }
    return [];
  },

  async getById(id: string): Promise<DataEntryRecord | null> {
    try {
      const res = await fetch(apiUrl(`/api/data-entries/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbDataEntries.getById error]', e);
    }
    return null;
  },

  async create(data: Partial<DataEntryRecord>): Promise<DataEntryRecord> {
    const res = await fetch(apiUrl('/api/data-entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create data entry: ${res.statusText}`);
    return await res.json();
  },

  async createMany(items: DataEntryRecord[]): Promise<DataEntryRecord[]> {
    const created: DataEntryRecord[] = [];
    for (const item of items) {
      created.push(await this.create(item));
    }
    return created;
  },

  async update(id: string, updates: Partial<DataEntryRecord>): Promise<DataEntryRecord | null> {
    const res = await fetch(apiUrl(`/api/data-entries/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) return await res.json();
    return null;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/data-entries/${id}`), { method: 'DELETE' });
    return res.ok;
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'data_entries' }),
    });
  },
};

// ----------------------------------------------------
// 7. Settings Collection
// ----------------------------------------------------
export const dbSettings = {
  async get(): Promise<UserSettings> {
    try {
      const res = await fetch(apiUrl('/api/settings'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSettings.get error]', e);
    }
    return { ...DEFAULT_SETTINGS };
  },

  async update(updates: Partial<UserSettings>): Promise<UserSettings> {
    const res = await fetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update settings: ${res.statusText}`);
    return await res.json();
  },
};

// ----------------------------------------------------
// 8. SAP Integration Config Model
// ----------------------------------------------------
export const DEFAULT_SAP_CONFIG: SapIntegrationConfig = {
  id: 'sap_active_config',
  name: 'Primary SAP S/4HANA System',
  serviceUrl: '',
  clientNumber: '100',
  auth: {
    authType: 'basic',
    username: '',
    password: '',
  },
  csrfEnabled: true,
  timeoutMs: 60000,
  isActive: true,
  useMockFallback: true,
  allowInsecureSsl: true,
  proxyUrl: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const dbSapConfig = {
  async get(): Promise<SapIntegrationConfig> {
    try {
      const res = await fetch(apiUrl('/api/sap-storage/config?public=false'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSapConfig.get error]', e);
    }
    return { ...DEFAULT_SAP_CONFIG };
  },

  async getPublic(): Promise<SapIntegrationConfig> {
    try {
      const res = await fetch(apiUrl('/api/sap-storage/config?public=true'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSapConfig.getPublic error]', e);
    }
    const cfg = await this.get();
    return {
      ...cfg,
      auth: {
        ...cfg.auth,
        password: undefined,
        hasPassword: !!(cfg.auth?.password && cfg.auth.password.trim().length > 0),
        clientSecret: undefined,
        hasClientSecret: !!(cfg.auth?.clientSecret && cfg.auth.clientSecret.trim().length > 0),
        bearerToken: undefined,
        hasBearerToken: !!(cfg.auth?.bearerToken && cfg.auth.bearerToken.trim().length > 0),
        apiKeyValue: undefined,
        hasApiKey: !!(cfg.auth?.apiKeyValue && cfg.auth.apiKeyValue.trim().length > 0),
      },
    };
  },

  async save(updates: Partial<SapIntegrationConfig>): Promise<SapIntegrationConfig> {
    const res = await fetch(apiUrl('/api/sap-storage/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to save SAP configuration: ${res.statusText}`);
    return await res.json();
  },
};

// ----------------------------------------------------
// 9. SAP Field Mappings Model
// ----------------------------------------------------
export const dbSapMappings = {
  async getAll(): Promise<SapFieldMapping[]> {
    try {
      const res = await fetch(apiUrl('/api/sap-storage/mappings'), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSapMappings.getAll error]', e);
    }
    return [];
  },

  async getByTemplateAndEntity(templateId: string, entitySetName: string): Promise<SapFieldMapping | null> {
    try {
      const res = await fetch(
        apiUrl(`/api/sap-storage/mappings?templateId=${encodeURIComponent(templateId)}&entitySet=${encodeURIComponent(entitySetName)}`),
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        return data || null;
      }
    } catch (e) {
      console.warn('[dbSapMappings.getByTemplateAndEntity error]', e);
    }
    return null;
  },

  async getByTemplateId(templateId: string): Promise<SapFieldMapping | null> {
    try {
      const res = await fetch(
        apiUrl(`/api/sap-storage/mappings?templateId=${encodeURIComponent(templateId)}`),
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        return data || null;
      }
    } catch (e) {
      console.warn('[dbSapMappings.getByTemplateId error]', e);
    }
    return null;
  },

  async save(mapping: SapFieldMapping): Promise<SapFieldMapping> {
    const res = await fetch(apiUrl('/api/sap-storage/mappings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    });
    if (!res.ok) throw new Error(`Failed to save SAP mapping: ${res.statusText}`);
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/sap-storage/mappings/${id}`), { method: 'DELETE' });
    return res.ok;
  },
};

// ----------------------------------------------------
// 10. SAP Upload History Logs Model
// ----------------------------------------------------
export const dbSapLogs = {
  async getAll(filters?: { templateId?: string; status?: string; recordId?: string }): Promise<SapUploadLog[]> {
    try {
      const params = new URLSearchParams();
      if (filters?.templateId && filters.templateId !== 'All') params.set('templateId', filters.templateId);
      if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
      if (filters?.recordId) params.set('recordId', filters.recordId);

      const qs = params.toString();
      const res = await fetch(apiUrl(`/api/sap-storage/logs${qs ? `?${qs}` : ''}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSapLogs.getAll error]', e);
    }
    return [];
  },

  async getById(id: string): Promise<SapUploadLog | null> {
    try {
      const res = await fetch(apiUrl(`/api/sap-storage/logs/${id}`), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[dbSapLogs.getById error]', e);
    }
    return null;
  },

  async getLatestByRecordId(recordId: string): Promise<SapUploadLog | null> {
    try {
      const logs = await this.getAll({ recordId });
      return logs.length > 0 ? logs[0] : null;
    } catch (e) {
      return null;
    }
  },

  async create(data: Omit<SapUploadLog, 'id' | 'uploadedAt'> & { id?: string; uploadedAt?: string }): Promise<SapUploadLog> {
    const res = await fetch(apiUrl('/api/sap-storage/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create SAP upload log: ${res.statusText}`);
    return await res.json();
  },

  async clear(): Promise<void> {
    await fetch(apiUrl('/api/sap-storage/logs'), { method: 'DELETE' });
  },
};

