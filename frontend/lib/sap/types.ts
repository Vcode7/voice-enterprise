export interface SapConnectionTestResult {
  success: boolean;
  message: string;
  statusCode?: number;
  serviceRoot: string;
  metadataUrl: string;
  isMockFallback?: boolean;
  diagnostics?: {
    dnsResolved?: boolean;
    resolvedIp?: string;
    networkReachable?: boolean;
    sslVerified?: boolean;
    sslBypassed?: boolean;
    authValid?: boolean;
    csrfSupported?: boolean;
    detectedODataVersion?: '2.0' | '4.0';
    latencyMs?: number;
    errorType?: 'DNS' | 'NETWORK' | 'SSL' | 'AUTH' | 'CSRF' | 'PARSER' | 'TIMEOUT' | 'UNKNOWN';
    rawErrorCode?: string;
  };
  entitySetsCount?: number;
}

export interface SapUploadExecutionResult {
  recordId: string;
  success: boolean;
  sapDocumentId?: string | null;
  message: string;
  httpStatus?: number;
  payload: any;
  responseBody?: any;
  rawError?: string;
  durationMs: number;
}

export interface SapPayloadPreviewResult {
  recordId: string;
  templateName: string;
  entitySetName: string;
  payload: Record<string, any>;
  valid: boolean;
  missingRequiredFields: string[];
  typeWarnings: string[];
  isAlreadyUploaded: boolean;
  previousUploadDocId?: string | null;
  previousUploadTime?: string | null;
}

export interface SapPreset {
  id: string;
  name: string;
  description: string;
  serviceUrl: string;
  defaultEntitySet: string;
}

export const SAP_COMMON_PRESETS: SapPreset[] = [
  {
    id: 's4_purchase_order',
    name: 'S/4HANA Purchase Orders (API_PURCHASEORDER_PROCESS_SRV)',
    description: 'SAP S/4HANA Cloud & On-Premise Purchase Order header & item operations',
    serviceUrl: 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV',
    defaultEntitySet: 'A_PurchaseOrder',
  },
  {
    id: 's4_prod_order_conf',
    name: 'Production Order Confirmation (PP_PROD_ORDER_CONF_SRV)',
    description: 'Manufacturing production order yield, scrap, machine time & counters',
    serviceUrl: 'https://my-sap-host.corp:8443/sap/opu/odata/sap/PP_PROD_ORDER_CONF_SRV',
    defaultEntitySet: 'ProductionOrderConfirmations',
  },
  {
    id: 's4_material_doc',
    name: 'Goods Movement / Material Document (API_MATERIAL_DOCUMENT_SRV)',
    description: 'Post goods receipt, issue, and stock transfer material documents',
    serviceUrl: 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV',
    defaultEntitySet: 'A_MaterialDocumentHeader',
  },
  {
    id: 'custom_zvoice_service',
    name: 'Custom Voice Entry OData Service (ZVOICE_DATA_ENTRY_SRV)',
    description: 'Custom ABAP Gateway service for direct voice production logging',
    serviceUrl: 'https://erp.enterprise.local/sap/opu/odata/sap/ZVOICE_DATA_ENTRY_SRV',
    defaultEntitySet: 'VoiceProductionLogs',
  },
];
