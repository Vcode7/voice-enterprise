export type SapAuthType = 'basic' | 'oauth2' | 'apiKey' | 'none' | 'mock';

export interface SapAuthConfig {
  authType: SapAuthType;
  username?: string;
  password?: string; // Server-side only
  hasPassword?: boolean; // Client-safe indicator
  tokenUrl?: string; // For OAuth2 Client Credentials
  clientId?: string;
  clientSecret?: string; // Server-side only
  hasClientSecret?: boolean;
  bearerToken?: string; // Server-side only
  hasBearerToken?: boolean;
  apiKeyHeader?: string; // e.g. 'APIKey' or 'Authorization'
  apiKeyValue?: string; // Server-side only
  hasApiKey?: boolean;
}

export interface SapIntegrationConfig {
  id: string;
  name: string;
  serviceUrl: string;
  clientNumber?: string; // e.g. '100'
  auth: SapAuthConfig;
  csrfEnabled: boolean;
  timeoutMs?: number;
  isActive: boolean;
  useMockFallback?: boolean; // If real endpoint is unreachable, fall back to mock sandbox
  allowInsecureSsl?: boolean; // Allow enterprise / self-signed SSL certificates for intranet/VPN SAP gateways
  proxyUrl?: string; // Optional HTTP/HTTPS proxy URL for corporate network routing
  createdAt: string;
  updatedAt: string;
}

export interface SapField {
  name: string;
  label?: string;
  type: string; // e.g. 'Edm.String', 'Edm.Int32', 'Edm.Decimal', 'Edm.DateTime', 'Edm.Boolean'
  maxLength?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  isKey: boolean;
}

export interface SapEntitySet {
  name: string;
  entityType: string;
  creatable?: boolean;
  updatable?: boolean;
  deletable?: boolean;
  fields: SapField[];
  keyFields: string[];
}

export interface SapMetadata {
  version: '2.0' | '4.0';
  namespace: string;
  entitySets: SapEntitySet[];
  fetchedAt: string;
}

export type SapFieldTransform =
  | 'none'
  | 'uppercase'
  | 'lowercase'
  | 'trim'
  | 'date_iso'
  | 'date_sap'
  | 'number'
  | 'boolean';

export interface SapFieldMappingRule {
  templateFieldKey: string; // Template extractionKey or 'table.<tf_key>'
  templateFieldName: string;
  templateFieldType: string; // 'text' | 'number' | 'date' | 'time' | 'select' | 'boolean'
  sapFieldName: string; // SAP Property Name
  sapFieldType: string; // 'Edm.String', 'Edm.Decimal', etc.
  isKey?: boolean;
  isRequired?: boolean;
  defaultValue?: any;
  transformation?: SapFieldTransform;
}

export interface SapFieldMapping {
  id: string;
  templateId: string;
  templateName: string;
  sapConfigId?: string;
  entitySetName: string;
  mappings: SapFieldMappingRule[];
  staticValues?: Record<string, any>; // Default constant values for required SAP fields without template match
  updatedAt: string;
}

export type SapUploadStatus =
  | 'not_uploaded'
  | 'ready'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export interface SapUploadLog {
  id: string;
  recordId: string;
  templateId: string;
  templateName: string;
  sapConfigId?: string;
  entitySetName: string;
  status: 'success' | 'failed';
  httpStatus?: number;
  payload: any; // sanitized
  sapDocumentId?: string | null; // e.g. PurchaseOrder #, MaterialDocument #
  responseBody?: any;
  errorMessage?: string | null;
  uploadedAt: string;
  durationMs: number;
}
