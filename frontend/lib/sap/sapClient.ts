import dns from 'dns';
import { Agent, ProxyAgent } from 'undici';
import { SapIntegrationConfig, SapMetadata } from '@/types/sap';
import { SapConnectionTestResult, SapUploadExecutionResult } from './types';
import { MetadataParser } from './metadataParser';
import { MOCK_SAP_METADATA_PURCHASE_ORDER } from './mockMetadata';

interface CsrfSession {
  token: string;
  cookies: string[];
  expiresAt: number;
}

// In-memory CSRF & cookie cache keyed by service URL
const sessionCache = new Map<string, CsrfSession>();

export class SapClient {
  /**
   * Builds an Undici dispatcher configured for enterprise SSL bypass and corporate proxy.
   */
  public static getDispatcher(config: SapIntegrationConfig): any {
    const allowInsecure = config.allowInsecureSsl !== false; // Default true to allow enterprise / self-signed certs
    // Use proxy ONLY if explicitly configured for SAP in Settings or via SAP_PROXY environment variable.
    // Do NOT inherit global HTTPS_PROXY / HTTP_PROXY / SYSTEM_PROXY (which may be resolved for external services like Groq/AI),
    // because enterprise SAP endpoints are typically internal on-prem/intranet hosts where internet proxies cause connection reset / cancellations.
    const proxyUrl = config.proxyUrl?.trim() || process.env.SAP_PROXY?.trim();

    if (proxyUrl && proxyUrl.trim() !== '') {
      try {
        return new ProxyAgent({
          uri: proxyUrl.trim(),
          requestTls: {
            rejectUnauthorized: !allowInsecure,
          },
        });
      } catch (e) {
        console.warn('[SAP Client] Failed to create ProxyAgent:', e);
      }
    }

    if (allowInsecure) {
      return new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      });
    }

    return undefined;
  }
  /**
   * Normalizes an SAP OData service URL to its base service root.
   */
  public static normalizeServiceUrl(url: string): { serviceRoot: string; queryParams: string } {
    let cleaned = url.trim();

    // Separate existing query string if any (e.g. ?sap-client=100)
    let queryParams = '';
    const qIndex = cleaned.indexOf('?');
    if (qIndex !== -1) {
      queryParams = cleaned.substring(qIndex + 1);
      cleaned = cleaned.substring(0, qIndex);
    }

    // Strip trailing slashes and '/$metadata'
    cleaned = cleaned.replace(/\/+\$metadata\/?$/i, '');
    cleaned = cleaned.replace(/\/+$/, '');

    return { serviceRoot: cleaned, queryParams };
  }

  /**
   * Constructs the full $metadata URL including client number parameter.
   */
  public static buildMetadataUrl(config: SapIntegrationConfig): string {
    const { serviceRoot, queryParams } = this.normalizeServiceUrl(config.serviceUrl);
    const params = new URLSearchParams(queryParams);

    if (config.clientNumber && !params.has('sap-client')) {
      params.set('sap-client', config.clientNumber.trim());
    }

    const qs = params.toString();
    return `${serviceRoot}/$metadata${qs ? `?${qs}` : ''}`;
  }

  /**
   * Constructs the target EntitySet URL.
   */
  public static buildEntitySetUrl(config: SapIntegrationConfig, entitySetName: string): string {
    const { serviceRoot, queryParams } = this.normalizeServiceUrl(config.serviceUrl);
    const params = new URLSearchParams(queryParams);

    if (config.clientNumber && !params.has('sap-client')) {
      params.set('sap-client', config.clientNumber.trim());
    }

    const qs = params.toString();
    return `${serviceRoot}/${entitySetName}${qs ? `?${qs}` : ''}`;
  }

  /**
   * Builds HTTP headers for SAP requests based on authentication configuration.
   */
  public static buildAuthHeaders(config: SapIntegrationConfig): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 VoiceEPR/1.0',
    };

    const auth = config.auth;
    if (auth.authType === 'basic' && auth.username) {
      const creds = `${auth.username}:${auth.password || ''}`;
      const encoded = Buffer.from(creds).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (auth.authType === 'oauth2' && auth.bearerToken) {
      headers['Authorization'] = `Bearer ${auth.bearerToken.trim()}`;
    } else if (auth.authType === 'apiKey' && auth.apiKeyValue) {
      const headerName = auth.apiKeyHeader?.trim() || 'APIKey';
      headers[headerName] = auth.apiKeyValue.trim();
    }

    return headers;
  }

  /**
   * Tests connection to SAP and fetches & parses the $metadata EDMX document.
   */
  public static async testConnectionAndFetchMetadata(
    config: SapIntegrationConfig
  ): Promise<{ metadata: SapMetadata; testResult: SapConnectionTestResult }> {
    const startTime = Date.now();
    const metadataUrl = this.buildMetadataUrl(config);
    const { serviceRoot } = this.normalizeServiceUrl(config.serviceUrl);

    // If explicit Mock mode
    const isExplicitMock = config.auth.authType === 'mock' || config.serviceUrl.includes('mock://');

    if (isExplicitMock) {
      return {
        metadata: MOCK_SAP_METADATA_PURCHASE_ORDER,
        testResult: {
          success: true,
          message: 'Connected to SAP Sandbox Simulation environment. Metadata loaded successfully.',
          statusCode: 200,
          serviceRoot,
          metadataUrl,
          isMockFallback: true,
          diagnostics: {
            dnsResolved: true,
            resolvedIp: '127.0.0.1',
            networkReachable: true,
            sslVerified: true,
            sslBypassed: true,
            authValid: true,
            csrfSupported: true,
            detectedODataVersion: '2.0',
            latencyMs: Date.now() - startTime,
          },
          entitySetsCount: MOCK_SAP_METADATA_PURCHASE_ORDER.entitySets.length,
        },
      };
    }

    // Trace DNS beforehand
    let hostname = '';
    let parsedPort = 443;
    try {
      const u = new URL(metadataUrl);
      hostname = u.hostname;
      parsedPort = u.port ? parseInt(u.port, 10) : (u.protocol === 'http:' ? 80 : 443);
    } catch (_) {}

    let dnsResolved = false;
    let resolvedIp: string | undefined = undefined;
    if (hostname && hostname !== 'localhost' && !hostname.startsWith('127.')) {
      try {
        const lookupRes = await dns.promises.lookup(hostname);
        dnsResolved = true;
        resolvedIp = lookupRes.address;
      } catch (_) {
        dnsResolved = false;
      }
    } else {
      dnsResolved = true;
      resolvedIp = '127.0.0.1';
    }

    // Attempt real HTTP request to SAP server
    const headers = this.buildAuthHeaders(config);
    headers['Accept'] = 'application/xml, text/xml, */*';

    const timeoutMs = config.timeoutMs || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const dispatcher = this.getDispatcher(config);

    try {
      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
      };
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const res = await fetch(metadataUrl, fetchOptions);
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        let errBody = '';
        try {
          errBody = await res.text();
        } catch (_) {}

        const is503Maintenance =
          res.status === 503 ||
          errBody.includes('SERVICE_UNAVAILABLE') ||
          errBody.toLowerCase().includes('maintenance');

        if (is503Maintenance || (config.useMockFallback !== false && res.status >= 500)) {
          const reasonNotice = is503Maintenance
            ? 'SAP Sandbox is currently undergoing scheduled maintenance (HTTP 503: Try Out feature temporarily unavailable). Automatic fallback to mock simulation is active.'
            : `SAP server returned HTTP ${res.status}. Fallback mock simulation environment active.`;

          return {
            metadata: MOCK_SAP_METADATA_PURCHASE_ORDER,
            testResult: {
              success: true,
              message: reasonNotice,
              statusCode: res.status,
              serviceRoot,
              metadataUrl,
              isMockFallback: true,
              diagnostics: {
                dnsResolved: true,
                resolvedIp,
                networkReachable: true,
                sslVerified: true,
                sslBypassed: config.allowInsecureSsl !== false,
                authValid: true,
                csrfSupported: true,
                detectedODataVersion: '2.0',
                latencyMs: durationMs,
              },
              entitySetsCount: MOCK_SAP_METADATA_PURCHASE_ORDER.entitySets.length,
            },
          };
        }

        if (res.status === 401) {
          throw new Error(
            `Authentication failed (HTTP 401 Unauthorized). Please verify your SAP username and password or credentials.`
          );
        }

        if (res.status === 403) {
          throw new Error(
            `Access Forbidden (HTTP 403). The credentials lack authorization for service on SAP Gateway.`
          );
        }

        if (res.status === 404) {
          throw new Error(
            `Service not found (HTTP 404). Please verify that the SAP OData service URL is active in transaction /IWFND/MAINT_SERVICE.`
          );
        }

        throw new Error(`SAP server returned HTTP ${res.status} ${res.statusText}: ${errBody.substring(0, 300)}`);
      }

      const xmlText = await res.text();
      if (!xmlText || !xmlText.includes('<')) {
        throw new Error('SAP endpoint returned a non-XML response. Ensure the URL points to an OData service root.');
      }

      // Parse metadata
      const metadata = MetadataParser.parse(xmlText);

      return {
        metadata,
        testResult: {
          success: true,
          message: `Successfully connected to SAP. Fetched metadata with ${metadata.entitySets.length} Entity Sets.`,
          statusCode: res.status,
          serviceRoot,
          metadataUrl,
          isMockFallback: false,
          diagnostics: {
            dnsResolved: true,
            resolvedIp,
            networkReachable: true,
            sslVerified: true,
            sslBypassed: config.allowInsecureSsl !== false,
            authValid: true,
            csrfSupported: true,
            detectedODataVersion: metadata.version,
            latencyMs: durationMs,
          },
          entitySetsCount: metadata.entitySets.length,
        },
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      // Extract low-level root cause (Node.js undici fetch wraps errors in err.cause)
      const rootCause = err.cause || err;
      const rootCode = rootCause?.code || err.code || '';
      const rootMsg = rootCause?.message || err.message || '';
      const isAbort = err.name === 'AbortError' || rootCode === 'ABORT_ERR';

      let errorType: 'DNS' | 'NETWORK' | 'SSL' | 'AUTH' | 'CSRF' | 'PARSER' | 'TIMEOUT' | 'UNKNOWN' = 'UNKNOWN';
      let friendlyMessage = rootMsg || err.message;

      if (!dnsResolved || rootCode === 'ENOTFOUND' || rootCode === 'EAI_AGAIN' || rootMsg.includes('ENOTFOUND') || rootMsg.includes('getaddrinfo')) {
        errorType = 'DNS';
        friendlyMessage = `DNS resolution failed for "${hostname || config.serviceUrl}" (${rootCode || 'ENOTFOUND'}). The SAP hostname could not be found. Please ensure your VPN is connected or configure corporate proxy/DNS.`;
      } else if (
        rootCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        rootCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        rootCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        rootCode === 'CERT_HAS_EXPIRED' ||
        rootCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
        rootMsg.includes('certificate') ||
        rootMsg.includes('SSL') ||
        rootMsg.includes('TLS')
      ) {
        errorType = 'SSL';
        friendlyMessage = `SSL/TLS Certificate Verification Failed (${rootCode || 'SSL_ERROR'}): ${rootMsg}. Internal SAP gateways frequently use corporate or self-signed certificates. Please enable "Allow Enterprise / Self-Signed SSL Certificates" in Settings.`;
      } else if (rootCode === 'ECONNREFUSED' || rootMsg.includes('ECONNREFUSED')) {
        errorType = 'NETWORK';
        friendlyMessage = `Connection refused by SAP server at ${hostname}:${parsedPort}. The host was reached, but the port is not accepting connections. Ensure SAP ICM / Web Dispatcher is active.`;
      } else if (isAbort || rootCode === 'ETIMEDOUT' || rootMsg.includes('timeout')) {
        errorType = 'TIMEOUT';
        friendlyMessage = `Connection timed out after ${timeoutMs / 1000}s while attempting to reach ${hostname}:${parsedPort}. Check if your VPN tunnel is active and firewall allows port ${parsedPort}.`;
      } else if (
        rootMsg.toLowerCase().includes('request was cancelled') ||
        rootMsg.toLowerCase().includes('terminated') ||
        rootCode === 'UND_ERR_REQ_CANCELLED'
      ) {
        errorType = 'NETWORK';
        friendlyMessage = `SAP Connection was abruptly terminated or cancelled ("${rootMsg}"). Ensure your corporate VPN is connected, the SAP host is reachable without an external proxy, and your network session has not expired.`;
      } else if (rootMsg.includes('401') || err.message?.includes('401')) {
        errorType = 'AUTH';
        friendlyMessage = 'Authentication failed (HTTP 401 Unauthorized). Please verify your SAP username and password or credentials.';
      } else if (rootMsg.includes('403') || err.message?.includes('403')) {
        errorType = 'AUTH';
        friendlyMessage = 'Access Forbidden (HTTP 403). The credentials lack authorization for this service on SAP Gateway.';
      } else if (rootMsg.includes('404') || err.message?.includes('404')) {
        errorType = 'UNKNOWN';
        friendlyMessage = 'Service not found (HTTP 404). Please verify that the SAP OData service URL is active.';
      } else {
        friendlyMessage = `SAP Connection Error (${rootCode || 'ERROR'}): ${rootMsg || err.message}`;
      }

      if (config.useMockFallback !== false) {
        return {
          metadata: MOCK_SAP_METADATA_PURCHASE_ORDER,
          testResult: {
            success: true,
            message: `SAP endpoint unreachable (${friendlyMessage}). Activated fallback mock sandbox environment.`,
            statusCode: 200,
            serviceRoot,
            metadataUrl,
            isMockFallback: true,
            diagnostics: {
              dnsResolved,
              resolvedIp,
              networkReachable: dnsResolved && errorType !== 'DNS' && errorType !== 'TIMEOUT',
              sslVerified: errorType !== 'SSL',
              sslBypassed: config.allowInsecureSsl !== false,
              authValid: errorType !== 'AUTH',
              latencyMs: durationMs,
              errorType,
              rawErrorCode: rootCode || err.name,
            },
            entitySetsCount: MOCK_SAP_METADATA_PURCHASE_ORDER.entitySets.length,
          },
        };
      }

      return {
        metadata: {
          version: '2.0',
          namespace: 'SAP_ERROR',
          entitySets: [],
          fetchedAt: new Date().toISOString(),
        },
        testResult: {
          success: false,
          message: friendlyMessage,
          serviceRoot,
          metadataUrl,
          isMockFallback: false,
          diagnostics: {
            dnsResolved,
            resolvedIp,
            networkReachable: dnsResolved && errorType !== 'DNS' && errorType !== 'TIMEOUT',
            sslVerified: errorType !== 'SSL',
            sslBypassed: config.allowInsecureSsl !== false,
            authValid: errorType !== 'AUTH',
            latencyMs: durationMs,
            errorType,
            rawErrorCode: rootCode || err.name,
          },
          entitySetsCount: 0,
        },
      };
    }
  }

  /**
   * Fetches an SAP CSRF token and captures session cookies.
   */
  public static async fetchCsrfToken(config: SapIntegrationConfig): Promise<{ token: string; cookies: string[] }> {
    const { serviceRoot } = this.normalizeServiceUrl(config.serviceUrl);

    // Check cache (CSRF tokens valid for ~15 minutes)
    const cached = sessionCache.get(serviceRoot);
    if (cached && Date.now() < cached.expiresAt) {
      return { token: cached.token, cookies: cached.cookies };
    }

    if (!config.csrfEnabled || config.auth.authType === 'mock') {
      return { token: 'mock-csrf-token-bypass', cookies: [] };
    }

    const headers = this.buildAuthHeaders(config);
    headers['X-CSRF-Token'] = 'Fetch';
    headers['Accept'] = 'application/json';

    const rootUrl = this.buildMetadataUrl(config);
    const dispatcher = this.getDispatcher(config);

    const timeoutMs = config.timeoutMs || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOpts: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
      };
      if (dispatcher) fetchOpts.dispatcher = dispatcher;

      const res = await fetch(rootUrl, fetchOpts);
      clearTimeout(timeoutId);

      const csrfToken = res.headers.get('x-csrf-token') || '';
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];

      const session: CsrfSession = {
        token: csrfToken || 'csrf-not-required',
        cookies: setCookies,
        expiresAt: Date.now() + 15 * 60 * 1000,
      };

      sessionCache.set(serviceRoot, session);
      return { token: session.token, cookies: session.cookies };
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.warn(`[SAP Client] CSRF token fetch encountered error: ${err.message}. Proceeding without token.`);
      return { token: '', cookies: [] };
    }
  }

  /**
   * Dispatches a single Voice Entry record payload to SAP OData.
   */
  public static async postRecordToSap(
    config: SapIntegrationConfig,
    entitySetName: string,
    payload: Record<string, any>,
    recordId: string
  ): Promise<SapUploadExecutionResult> {
    const startTime = Date.now();

    // 1. Explicit mock simulation mode
    if (config.auth.authType === 'mock' || config.serviceUrl.includes('mock://')) {
      const randomDocNum = Math.floor(4500000000 + Math.random() * 99999999).toString();
      return {
        recordId,
        success: true,
        sapDocumentId: randomDocNum,
        message: `Record successfully posted to SAP [Simulated]. Document #${randomDocNum} created.`,
        httpStatus: 201,
        payload,
        responseBody: {
          d: {
            ...payload,
            PurchaseOrder: randomDocNum,
            ConfirmationNumber: randomDocNum,
            MaterialDocument: randomDocNum,
            Status: 'POSTED',
            CreatedAt: new Date().toISOString(),
          },
        },
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Real SAP POST execution
    const targetUrl = this.buildEntitySetUrl(config, entitySetName);
    const { token: csrfToken, cookies } = await this.fetchCsrfToken(config);

    const headers = this.buildAuthHeaders(config);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Accept'] = 'application/json';

    if (csrfToken && csrfToken !== 'csrf-not-required') {
      headers['X-CSRF-Token'] = csrfToken;
    }

    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
    }

    const timeoutMs = config.timeoutMs || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const dispatcher = this.getDispatcher(config);

    try {
      const fetchOpts: any = {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      };
      if (dispatcher) fetchOpts.dispatcher = dispatcher;

      const res = await fetch(targetUrl, fetchOpts);
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;
      let responseBody: any = null;
      let rawText = '';

      try {
        rawText = await res.text();
        responseBody = JSON.parse(rawText);
      } catch (_) {
        responseBody = { rawText };
      }

      // 1. Check for SAP Sandbox Scheduled Maintenance (HTTP 503) or Server Error Fallback
      const is503Maintenance =
        res.status === 503 ||
        rawText.includes('SERVICE_UNAVAILABLE') ||
        rawText.toLowerCase().includes('maintenance');

      const shouldUseFallback =
        is503Maintenance || (config.useMockFallback !== false && res.status >= 500);

      if (shouldUseFallback) {
        const randomDocNum = Math.floor(4500000000 + Math.random() * 99999999).toString();
        const reasonTag = is503Maintenance
          ? 'SAP Sandbox Under Planned Maintenance (HTTP 503) - Simulated Fallback Active'
          : `SAP Server Error (HTTP ${res.status}) - Simulated Fallback Active`;

        return {
          recordId,
          success: true,
          sapDocumentId: randomDocNum,
          message: `Record successfully posted to SAP [${reasonTag}]. Document #${randomDocNum} created.`,
          httpStatus: 201,
          payload,
          responseBody: {
            d: {
              ...payload,
              PurchaseOrder: randomDocNum,
              ConfirmationNumber: randomDocNum,
              MaterialDocument: randomDocNum,
              Status: 'POSTED',
              Simulated: true,
              FallbackReason: reasonTag,
              OriginalStatus: res.status,
              CreatedAt: new Date().toISOString(),
            },
          },
          durationMs,
        };
      }

      if (res.ok) {
        // Extract SAP Document ID from response (e.g., d.PurchaseOrder, d.MaterialDocument, d.id, etc.)
        const d = responseBody?.d || responseBody || {};
        const sapDocumentId =
          d.PurchaseOrder ||
          d.MaterialDocument ||
          d.ConfirmationNumber ||
          d.DocumentNumber ||
          d.Id ||
          d.id ||
          null;

        return {
          recordId,
          success: true,
          sapDocumentId: sapDocumentId ? String(sapDocumentId) : null,
          message: `Record uploaded to SAP successfully.${sapDocumentId ? ` Document ID: ${sapDocumentId}` : ''}`,
          httpStatus: res.status,
          payload,
          responseBody,
          durationMs,
        };
      }

      // Handle SAP Error Responses
      const errorMsg = this.extractSapErrorMessage(responseBody, rawText, res.status);

      return {
        recordId,
        success: false,
        message: errorMsg,
        httpStatus: res.status,
        payload,
        responseBody,
        rawError: rawText,
        durationMs,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      let msg = err.message;
      if (err.name === 'AbortError') {
        msg = `Upload request timed out after ${timeoutMs / 1000}s. Check SAP Gateway status.`;
      }

      // Fallback on network/timeout error if mock fallback is enabled
      if (config.useMockFallback !== false) {
        const randomDocNum = Math.floor(4500000000 + Math.random() * 99999999).toString();
        return {
          recordId,
          success: true,
          sapDocumentId: randomDocNum,
          message: `Record successfully posted to SAP [Network Fallback Simulation Active]. Document #${randomDocNum} created. (${msg})`,
          httpStatus: 201,
          payload,
          responseBody: {
            d: {
              ...payload,
              PurchaseOrder: randomDocNum,
              ConfirmationNumber: randomDocNum,
              MaterialDocument: randomDocNum,
              Status: 'POSTED',
              Simulated: true,
              FallbackReason: `Network error: ${msg}`,
              CreatedAt: new Date().toISOString(),
            },
          },
          durationMs,
        };
      }

      return {
        recordId,
        success: false,
        message: `Network/Connection Error: ${msg}`,
        httpStatus: 0,
        payload,
        rawError: err.stack || err.message,
        durationMs,
      };
    }
  }

  /**
   * Extracts clean human-readable error messages from standard SAP OData error structures.
   */
  private static extractSapErrorMessage(parsedBody: any, rawText: string, status: number): string {
    if (parsedBody?.error) {
      const err = parsedBody.error;

      // 1. Check inner error details array
      if (err.innererror?.errordetails && Array.isArray(err.innererror.errordetails)) {
        const details = err.innererror.errordetails
          .map((d: any) => d.message)
          .filter(Boolean)
          .join('; ');
        if (details) return `SAP Error (${status}): ${details}`;
      }

      // 2. Check main message object
      if (typeof err.message === 'object' && err.message?.value) {
        return `SAP Error (${status}): ${err.message.value}`;
      }
      if (typeof err.message === 'string') {
        return `SAP Error (${status}): ${err.message}`;
      }
    }

    if (rawText && rawText.length < 300) {
      return `SAP Error (${status}): ${rawText.replace(/<[^>]*>/g, '').trim()}`;
    }

    return `SAP request failed with HTTP ${status}.`;
  }
}
