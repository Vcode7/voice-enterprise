'use client';

import React, { useState, useEffect } from 'react';
import {
  Server,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Wifi,
  WifiOff,
  Sparkles,
  Lock,
} from 'lucide-react';
import { DataTemplate } from '@/types';
import { SapIntegrationConfig, SapMetadata, SapAuthType, SapEntitySet } from '@/types/sap';
import { SAP_COMMON_PRESETS, SapConnectionTestResult } from '@/lib/sap/types';
import { SapFieldMappingModal } from './SapFieldMappingModal';

interface SapSettingsSectionProps {
  onNotify?: (msg: string) => void;
}

export function SapSettingsSection({ onNotify }: SapSettingsSectionProps) {
  const [config, setConfig] = useState<SapIntegrationConfig>({
    id: 'sap_config_default',
    name: 'SAP S/4HANA OData Service',
    serviceUrl: 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV',
    clientNumber: '100',
    auth: {
      authType: 'basic',
      username: '',
      hasPassword: false,
    },
    csrfEnabled: true,
    timeoutMs: 30000,
    isActive: true,
    useMockFallback: false,
    allowInsecureSsl: true,
    proxyUrl: '',
    createdAt: '',
    updatedAt: '',
  });

  // Password / Secret input states (never sent from server, only entered by user)
  const [passwordInput, setPasswordInput] = useState('');
  const [bearerTokenInput, setBearerTokenInput] = useState('');
  const [apiKeyValueInput, setApiKeyValueInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');

  // Metadata & Testing state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SapConnectionTestResult | null>(null);
  const [metadata, setMetadata] = useState<SapMetadata | null>(null);
  const [expandedEntitySet, setExpandedEntitySet] = useState<string | null>(null);
  const [fieldSearch, setFieldSearch] = useState('');

  // Templates list for field mapping
  const [templates, setTemplates] = useState<DataTemplate[]>([]);
  const [showMappingModal, setShowMappingModal] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load SAP configuration and templates on mount
  useEffect(() => {
    loadSapConfig();
    loadTemplates();
  }, []);

  const loadSapConfig = async () => {
    try {
      const res = await fetch('/api/sap/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Failed to load SAP config:', err);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = SAP_COMMON_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setConfig({
      ...config,
      name: preset.name,
      serviceUrl: preset.serviceUrl,
    });
    setTestResult(null);
    setMetadata(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);

    // Build payload including newly typed credentials
    const testPayload: Partial<SapIntegrationConfig> = {
      serviceUrl: config.serviceUrl,
      clientNumber: config.clientNumber,
      csrfEnabled: config.csrfEnabled,
      timeoutMs: config.timeoutMs,
      useMockFallback: config.useMockFallback,
      allowInsecureSsl: config.allowInsecureSsl !== false,
      proxyUrl: config.proxyUrl,
      auth: {
        ...config.auth,
        password: passwordInput || undefined,
        bearerToken: bearerTokenInput || undefined,
        apiKeyValue: apiKeyValueInput || undefined,
        clientSecret: clientSecretInput || undefined,
      },
    };

    try {
      const res = await fetch('/api/sap/test-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });

      const data = await res.json();
      setTestResult(data.testResult);

      if (data.metadata && data.metadata.entitySets?.length > 0) {
        setMetadata(data.metadata);
        if (data.metadata.entitySets.length > 0) {
          setExpandedEntitySet(data.metadata.entitySets[0].name);
        }
      }

      if (data.success && onNotify) {
        onNotify('SAP connection verified and metadata fetched!');
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to reach backend SAP proxy.',
        serviceRoot: config.serviceUrl,
        metadataUrl: `${config.serviceUrl}/$metadata`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setErrorMessage(null);

    const updatePayload: Partial<SapIntegrationConfig> = {
      ...config,
      allowInsecureSsl: config.allowInsecureSsl !== false,
      proxyUrl: config.proxyUrl,
      auth: {
        ...config.auth,
        password: passwordInput || undefined,
        bearerToken: bearerTokenInput || undefined,
        apiKeyValue: apiKeyValueInput || undefined,
        clientSecret: clientSecretInput || undefined,
      },
    };

    try {
      const res = await fetch('/api/sap/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save SAP configuration');
      }

      const updated = await res.json();
      setConfig(updated);
      setPasswordInput('');
      setBearerTokenInput('');
      setApiKeyValueInput('');
      setClientSecretInput('');

      setSaveSuccess(true);
      if (onNotify) onNotify('SAP Integration settings saved securely!');
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 rounded-2xl bg-card border border-cardBorder shadow-md space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cardBorder/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center border border-cardBorder">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
              SAP OData Integration &amp; Metadata
            </h2>
            <p className="text-[10px] sm:text-[11px] text-textSubtle">
              Configure SAP ERP / S/4HANA OData endpoint, authentication, and dynamic field mapping.
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {testResult?.success ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              Connected ({testResult.entitySetsCount || 0} Entity Sets)
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface text-textSubtle border border-cardBorder flex items-center gap-1">
              <WifiOff className="w-3 h-3" />
              Not Verified
            </span>
          )}
        </div>
      </div>

      {/* Preset Quick Selectors */}
      <div>
        <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1.5 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-secondary" />
          Quick Service Presets
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {SAP_COMMON_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleApplyPreset(p.id)}
              className="p-2 text-left rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-[11px] text-text transition cursor-pointer flex flex-col justify-between"
            >
              <span className="font-bold truncate text-primary">{p.name.split('(')[0]}</span>
              <span className="text-[9px] text-textSubtle truncate font-mono mt-0.5">
                {p.defaultEntitySet}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSaveConfig} className="space-y-4">
        {/* Service URL & Client */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
              SAP OData Service URL <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={config.serviceUrl}
              onChange={(e) => setConfig({ ...config, serviceUrl: e.target.value })}
              placeholder="https://my-sap-host:port/sap/opu/odata/sap/SERVICE_NAME_SRV"
              className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
              required
            />
            <p className="text-[10px] text-textSubtle mt-1">
              Base OData service root. The <code className="text-text">/$metadata</code> endpoint will be fetched dynamically.
            </p>
          </div>

          <div>
            <label className="block text-[10px] sm:text-[11px] font-semibold uppercase text-textSubtle mb-1">
              SAP Client (Optional)
            </label>
            <input
              type="text"
              value={config.clientNumber || ''}
              onChange={(e) => setConfig({ ...config, clientNumber: e.target.value })}
              placeholder="e.g. 100 or 800"
              className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-[10px] text-textSubtle mt-1">Appended as <code className="text-text">?sap-client=100</code></p>
          </div>
        </div>

        {/* Authentication Configuration */}
        <div className="p-4 rounded-xl bg-surface/50 border border-cardBorder space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-secondary" />
              Authentication &amp; Security (Never Exposed in Frontend)
            </h3>
            <span className="text-[10px] text-textSubtle flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Encrypted Server-Side Storage
            </span>
          </div>

          {/* Auth Type Selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'basic', label: 'Basic Auth', desc: 'Username & Password' },
              { id: 'oauth2', label: 'OAuth2 / Bearer', desc: 'Bearer Access Token' },
              { id: 'apiKey', label: 'API Key Header', desc: 'Custom Key Header' },
              { id: 'mock', label: 'Sandbox Mock', desc: 'Live Local Simulation' },
            ].map((method) => {
              const isSelected = config.auth.authType === method.id;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, authType: method.id as SapAuthType },
                    })
                  }
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    isSelected
                      ? 'bg-primary/15 border-primary text-text font-bold'
                      : 'bg-background border-cardBorder text-textMuted hover:border-primary/40'
                  }`}
                >
                  <div className="text-xs font-bold text-text">{method.label}</div>
                  <div className="text-[10px] text-textSubtle truncate">{method.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Conditional Credential Inputs */}
          {config.auth.authType === 'basic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1">
                  SAP Username
                </label>
                <input
                  type="text"
                  value={config.auth.username || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, username: e.target.value },
                    })
                  }
                  placeholder="e.g. SAP_INTEGRATION_USER"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1 flex items-center justify-between">
                  <span>SAP Password</span>
                  {config.auth.hasPassword && (
                    <span className="text-emerald-400 font-normal lowercase text-[10px]">
                      (password configured)
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={config.auth.hasPassword ? '•••••••• (leave blank to keep current)' : 'Enter password'}
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>
            </div>
          )}

          {config.auth.authType === 'oauth2' && (
            <div className="space-y-2 pt-1">
              <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1 flex items-center justify-between">
                <span>Bearer Token / Access Token</span>
                {config.auth.hasBearerToken && (
                  <span className="text-emerald-400 font-normal lowercase text-[10px]">
                    (token configured)
                  </span>
                )}
              </label>
              <input
                type="password"
                value={bearerTokenInput}
                onChange={(e) => setBearerTokenInput(e.target.value)}
                placeholder={config.auth.hasBearerToken ? '•••••••• (leave blank to keep current)' : 'Bearer eyJhbGci...'}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
              />
            </div>
          )}

          {config.auth.authType === 'apiKey' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1">
                  Header Name
                </label>
                <input
                  type="text"
                  value={config.auth.apiKeyHeader || 'APIKey'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, apiKeyHeader: e.target.value },
                    })
                  }
                  placeholder="APIKey or X-API-Key"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1 flex items-center justify-between">
                  <span>API Key Value</span>
                  {config.auth.hasApiKey && (
                    <span className="text-emerald-400 font-normal lowercase text-[10px]">
                      (key configured)
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={apiKeyValueInput}
                  onChange={(e) => setApiKeyValueInput(e.target.value)}
                  placeholder={config.auth.hasApiKey ? '•••••••• (leave blank to keep current)' : 'Secret key value'}
                  className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>
            </div>
          )}

          {config.auth.authType === 'mock' && (
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs">
              <p className="font-bold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                SAP Sandbox Simulation Mode Active
              </p>
              <p className="text-[11px] text-textMuted mt-0.5">
                Simulates live SAP responses, authentications, CSRF token handshakes, and document ID generation offline without requiring an active SAP VPN.
              </p>
            </div>
          )}

          {/* Toggles (CSRF, SSL & VPN Fallback) */}
          <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-cardBorder/60 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.csrfEnabled}
                onChange={(e) => setConfig({ ...config, csrfEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-primary focus:ring-0 cursor-pointer"
              />
              <span className="text-text font-medium">
                Fetch &amp; Pass CSRF Token (<code className="text-primary font-mono">x-csrf-token</code>)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.allowInsecureSsl !== false}
                onChange={(e) => setConfig({ ...config, allowInsecureSsl: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-500 focus:ring-0 cursor-pointer"
              />
              <span className="text-text font-medium">
                Allow Enterprise / Self-Signed SSL Certificates (Recommended for VPN/Intranet SAP)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.useMockFallback}
                onChange={(e) => setConfig({ ...config, useMockFallback: e.target.checked })}
                className="w-4 h-4 rounded text-secondary focus:ring-0 cursor-pointer"
              />
              <span className="text-text font-medium">
                Fallback to Mock Schema if Live Endpoint Unavailable
              </span>
            </label>
          </div>

          {/* Optional Corporate Proxy */}
          <div className="pt-2 border-t border-cardBorder/40">
            <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1">
              Corporate HTTP / HTTPS Proxy URL (Optional)
            </label>
            <input
              type="text"
              value={config.proxyUrl || ''}
              onChange={(e) => setConfig({ ...config, proxyUrl: e.target.value })}
              placeholder="e.g. http://proxy.corporate.local:8080 (leave blank for direct connection)"
              className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-[10px] text-textSubtle mt-1">
              Specify if your corporate network requires routing through a proxy server to reach internal SAP gateways.
            </p>
          </div>

          {/* Request Timeout (seconds) */}
          <div className="pt-2 border-t border-cardBorder/40">
            <label className="block text-[10px] font-semibold uppercase text-textSubtle mb-1">
              SAP Request Timeout (Seconds)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="10"
                max="300"
                value={Math.round((config.timeoutMs || 60000) / 1000)}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    timeoutMs: Math.max(10, parseInt(e.target.value, 10) || 60) * 1000,
                  })
                }
                className="w-28 px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-mono"
              />
              <span className="text-[11px] text-textSubtle">
                Default: 60s. Increase (e.g. 90s or 120s) if your SAP Gateway over VPN takes time to process records.
              </span>
            </div>
          </div>
        </div>

        {/* Buttons Row: Test Connection & Save */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/20 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Testing & Fetching...' : 'Test Connection & Fetch Metadata'}
            </button>

            {metadata && (
              <button
                type="button"
                onClick={() => setShowMappingModal(true)}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/20 transition cursor-pointer flex items-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                Configure Field Mapping
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                Configuration Saved!
              </span>
            )}
            {errorMessage && (
              <span className="text-xs text-danger font-bold flex items-center gap-1 animate-fade-in">
                <AlertCircle className="w-4 h-4" />
                {errorMessage}
              </span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-lg shadow-primary/25 transition cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </form>

      {/* Test Connection Diagnostics Banner */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2 animate-fade-in ${
            testResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-danger shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>

            {testResult.isMockFallback && (
              <span className="px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 text-[10px] font-bold">
                Simulation Active
              </span>
            )}
          </div>

          {testResult.diagnostics && (
            <div className="space-y-2 pt-2 border-t border-cardBorder/40 text-[11px]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-textMuted">
                <div>
                  <span className="text-textSubtle">DNS Resolution: </span>
                  <strong className={testResult.diagnostics.dnsResolved ? 'text-emerald-400' : 'text-danger'}>
                    {testResult.diagnostics.dnsResolved
                      ? `Resolved ${testResult.diagnostics.resolvedIp ? `(${testResult.diagnostics.resolvedIp})` : 'OK'}`
                      : 'Failed'}
                  </strong>
                </div>
                <div>
                  <span className="text-textSubtle">Port / Network: </span>
                  <strong className={testResult.diagnostics.networkReachable ? 'text-emerald-400' : 'text-danger'}>
                    {testResult.diagnostics.networkReachable ? 'Reachable' : 'Unreachable'}
                  </strong>
                </div>
                <div>
                  <span className="text-textSubtle">SSL Verification: </span>
                  <strong className={testResult.diagnostics.sslBypassed ? 'text-primary' : (testResult.diagnostics.sslVerified ? 'text-emerald-400' : 'text-danger')}>
                    {testResult.diagnostics.sslBypassed
                      ? 'Bypassed (Self-Signed Allowed)'
                      : (testResult.diagnostics.sslVerified ? 'Verified Valid' : 'Failed')}
                  </strong>
                </div>
                <div>
                  <span className="text-textSubtle">Latency: </span>
                  <strong className="text-text">{testResult.diagnostics.latencyMs || 0}ms</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-textMuted pt-1 border-t border-cardBorder/20">
                <div>
                  <span className="text-textSubtle">OData Version: </span>
                  <strong className="text-text">{testResult.diagnostics.detectedODataVersion || '2.0'}</strong>
                </div>
                <div>
                  <span className="text-textSubtle">CSRF Support: </span>
                  <strong className="text-text">{testResult.diagnostics.csrfSupported ? 'Yes' : 'No'}</strong>
                </div>
                <div>
                  <span className="text-textSubtle">Entity Sets: </span>
                  <strong className="text-text">{testResult.entitySetsCount || 0}</strong>
                </div>
                {testResult.diagnostics.rawErrorCode && (
                  <div>
                    <span className="text-textSubtle">Error Code: </span>
                    <strong className="font-mono text-danger">{testResult.diagnostics.rawErrorCode}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Parsed Metadata Viewer */}
      {metadata && metadata.entitySets.length > 0 && (
        <div className="space-y-4 pt-2 border-t border-cardBorder/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Discovered SAP Entity Sets ({metadata.entitySets.length})
              </h3>
              <p className="text-[11px] text-textSubtle">
                Namespace: <code className="text-text font-mono">{metadata.namespace}</code> (OData v{metadata.version})
              </p>
            </div>

            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 text-textSubtle absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Filter entity sets or fields..."
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value.toLowerCase())}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Entity Sets Accordion */}
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {metadata.entitySets
              .filter(
                (es) =>
                  !fieldSearch ||
                  es.name.toLowerCase().includes(fieldSearch) ||
                  es.fields.some((f) => f.name.toLowerCase().includes(fieldSearch))
              )
              .map((es) => {
                const isExpanded = expandedEntitySet === es.name;

                return (
                  <div
                    key={es.name}
                    className="border border-cardBorder rounded-xl bg-surface/40 overflow-hidden"
                  >
                    {/* Entity Set Header */}
                    <div
                      onClick={() => setExpandedEntitySet(isExpanded ? null : es.name)}
                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-surface/70 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-text">{es.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/20 text-primary border border-primary/30">
                          {es.fields.length} fields
                        </span>
                        {es.keyFields.length > 0 && (
                          <span className="text-[10px] text-textSubtle">
                            Keys: [{es.keyFields.join(', ')}]
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {es.creatable && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400">
                            POST
                          </span>
                        )}
                        {es.updatable && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary">
                            PATCH
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-textSubtle" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-textSubtle" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Fields Table */}
                    {isExpanded && (
                      <div className="p-3 border-t border-cardBorder/60 bg-background/50">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase font-bold text-textSubtle border-b border-cardBorder/60">
                              <th className="py-1.5 px-2">Property Name</th>
                              <th className="py-1.5 px-2">Label</th>
                              <th className="py-1.5 px-2">OData Type</th>
                              <th className="py-1.5 px-2">Constraints</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-cardBorder/40 font-mono">
                            {es.fields
                              .filter(
                                (f) =>
                                  !fieldSearch ||
                                  f.name.toLowerCase().includes(fieldSearch) ||
                                  (f.label && f.label.toLowerCase().includes(fieldSearch))
                              )
                              .map((f) => (
                                <tr key={f.name} className="hover:bg-surface/30">
                                  <td className="py-1.5 px-2 font-bold text-text flex items-center gap-1.5">
                                    <span>{f.name}</span>
                                    {f.isKey && (
                                      <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-400 font-bold">
                                        KEY
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 px-2 text-textSubtle font-sans">{f.label || '-'}</td>
                                  <td className="py-1.5 px-2 text-secondary">{f.type.replace('Edm.', '')}</td>
                                  <td className="py-1.5 px-2 text-[10px] text-textMuted font-sans">
                                    {!f.nullable ? (
                                      <span className="text-danger font-semibold">Required</span>
                                    ) : (
                                      'Optional'
                                    )}
                                    {f.maxLength ? `, Max: ${f.maxLength}` : ''}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Field Mapping Modal */}
      {showMappingModal && metadata && (
        <SapFieldMappingModal
          metadata={metadata}
          templates={templates}
          onClose={() => setShowMappingModal(false)}
          onSaved={() => {
            if (onNotify) onNotify('Field mapping saved successfully!');
          }}
        />
      )}
    </div>
  );
}
