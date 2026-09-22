'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  UploadCloud,
  Layers,
  Search,
  Filter,
  Calendar,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Eye,
  FileText,
  Server,
  ArrowRight,
  ExternalLink,
  History,
  CheckSquare,
  Square,
  Sparkles,
  Info,
  ChevronRight,
  Send,
  X,
  Copy,
  RotateCcw,
} from 'lucide-react';
import { DataTemplate, DataEntryRecord } from '@/types';
import {
  SapIntegrationConfig,
  SapFieldMapping,
  SapUploadLog,
  SapUploadStatus,
} from '@/types/sap';
import { SapPayloadPreviewResult } from '@/lib/sap/types';

export default function SapUploadPage() {
  // Master data
  const [templates, setTemplates] = useState<DataTemplate[]>([]);
  const [records, setRecords] = useState<DataEntryRecord[]>([]);
  const [sapConfig, setSapConfig] = useState<SapIntegrationConfig | null>(null);
  const [currentMapping, setCurrentMapping] = useState<SapFieldMapping | null>(null);

  // Filters
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [customDate, setCustomDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selection
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());

  // Loading & Action States
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Modals
  const [previewModalOpen, setPreviewModalOpen] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<{
    entitySetName: string;
    previews: SapPayloadPreviewResult[];
    allValid: boolean;
    hasPreviousUploads: boolean;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  const [duplicateWarningOpen, setDuplicateWarningOpen] = useState<boolean>(false);
  const [historyModalOpen, setHistoryModalOpen] = useState<boolean>(false);
  const [historyLogs, setHistoryLogs] = useState<SapUploadLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [selectedLogDetail, setSelectedLogDetail] = useState<SapUploadLog | null>(null);

  // Copied indicator for JSON
  const [copiedPayloadId, setCopiedPayloadId] = useState<string | null>(null);

  // 1. Initial Data Fetch
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [tmplRes, recRes, cfgRes] = await Promise.allSettled([
        fetch('/api/templates'),
        fetch('/api/data-entries'),
        fetch('/api/sap/config'),
      ]);

      if (tmplRes.status === 'fulfilled' && tmplRes.value.ok) {
        try {
          const tmplData: DataTemplate[] = await tmplRes.value.json();
          if (Array.isArray(tmplData)) {
            setTemplates(tmplData);
            if (tmplData.length > 0 && selectedTemplateId === 'All') {
              setSelectedTemplateId(tmplData[0].id);
            }
          }
        } catch (e) {
          console.warn('Could not parse templates:', e);
        }
      }

      if (recRes.status === 'fulfilled' && recRes.value.ok) {
        try {
          const recData: DataEntryRecord[] = await recRes.value.json();
          if (Array.isArray(recData)) setRecords(recData);
        } catch (e) {
          console.warn('Could not parse data entries:', e);
        }
      }

      if (cfgRes.status === 'fulfilled' && cfgRes.value.ok) {
        try {
          const cfgData: SapIntegrationConfig = await cfgRes.value.json();
          if (cfgData) setSapConfig(cfgData);
        } catch (e) {
          console.warn('Could not parse SAP config:', e);
        }
      }
    } catch (err) {
      console.warn('Failed to load initial SAP upload page data:', err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Load Mapping when Selected Template changes
  useEffect(() => {
    if (!selectedTemplateId || selectedTemplateId === 'All') {
      setCurrentMapping(null);
      return;
    }

    const loadMapping = async () => {
      try {
        const res = await fetch(`/api/sap/mappings?templateId=${encodeURIComponent(selectedTemplateId)}`);
        if (res.ok) {
          const mapping = await res.json();
          setCurrentMapping(mapping);
        } else {
          setCurrentMapping(null);
        }
      } catch (err) {
        console.error('Failed to load template mapping:', err);
        setCurrentMapping(null);
      }
    };

    loadMapping();
    // Clear selection when changing template
    setSelectedRecordIds(new Set());
  }, [selectedTemplateId]);

  const showToast = (text: string, type: 'success' | 'error' | 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // 3. Filtered Records calculation
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Template filter
      if (selectedTemplateId !== 'All') {
        if (rec.templateId !== selectedTemplateId) return false;
      }

      // Status filter
      const status: SapUploadStatus = rec.sapUploadStatus || 'not_uploaded';
      if (statusFilter !== 'All') {
        if (statusFilter === 'ready' && status !== 'ready' && status !== 'not_uploaded') return false;
        if (statusFilter !== 'ready' && status !== statusFilter) return false;
      }

      // Date filter
      const recDate = rec.date || rec.createdAt.split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      if (dateFilter === 'today' && recDate !== today) return false;
      if (dateFilter === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yStr = y.toISOString().split('T')[0];
        if (recDate !== yStr) return false;
      }
      if (dateFilter === 'last7') {
        const d7 = new Date();
        d7.setDate(d7.getDate() - 7);
        const d7Str = d7.toISOString().split('T')[0];
        if (recDate < d7Str) return false;
      }
      if (dateFilter === 'custom' && customDate && recDate !== customDate) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = rec.id.toLowerCase().includes(q);
        const matchesTitle = (rec.title || rec.templateName || '').toLowerCase().includes(q);
        const matchesDoc = (rec.sapDocumentNumber || '').toLowerCase().includes(q);
        const matchesFieldValues = Object.values(rec.fieldValues || {}).some((v) =>
          String(v).toLowerCase().includes(q)
        );
        const matchesTranscript = (rec.rawTranscript || '').toLowerCase().includes(q);

        if (!matchesId && !matchesTitle && !matchesDoc && !matchesFieldValues && !matchesTranscript) {
          return false;
        }
      }

      return true;
    });
  }, [records, selectedTemplateId, statusFilter, dateFilter, customDate, searchQuery]);

  // 4. Status Counters
  const statusCounts = useMemo(() => {
    const counts = {
      total: filteredRecords.length,
      notUploaded: 0,
      ready: 0,
      uploading: 0,
      uploaded: 0,
      failed: 0,
    };

    filteredRecords.forEach((r) => {
      const s = r.sapUploadStatus || 'not_uploaded';
      if (s === 'not_uploaded') counts.notUploaded++;
      else if (s === 'ready') counts.ready++;
      else if (s === 'uploading') counts.uploading++;
      else if (s === 'uploaded') counts.uploaded++;
      else if (s === 'failed') counts.failed++;
    });

    return counts;
  }, [filteredRecords]);

  // Selection handlers
  const handleToggleSelectRecord = (id: string) => {
    const updated = new Set(selectedRecordIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedRecordIds(updated);
  };

  const handleSelectAllFiltered = () => {
    if (selectedRecordIds.size === filteredRecords.length && filteredRecords.length > 0) {
      setSelectedRecordIds(new Set());
    } else {
      setSelectedRecordIds(new Set(filteredRecords.map((r) => r.id)));
    }
  };

  // 5. Open Preview & Run Validation (Dry Run)
  const handlePreviewPayload = async (specificRecordId?: string) => {
    const targetIds = specificRecordId ? [specificRecordId] : Array.from(selectedRecordIds);
    if (targetIds.length === 0) {
      showToast('Please select at least one record to preview.', 'info');
      return;
    }

    if (!selectedTemplateId || selectedTemplateId === 'All') {
      showToast('Please select a specific Voice Entry Template to generate SAP payloads.', 'info');
      return;
    }

    if (!currentMapping) {
      showToast(
        'No SAP Field Mapping configured for this template. Please configure it in Settings first.',
        'error'
      );
      return;
    }

    setLoadingPreview(true);
    try {
      const res = await fetch('/api/sap/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordIds: targetIds,
          templateId: selectedTemplateId,
          entitySetName: currentMapping.entitySetName,
          dryRun: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate payload preview');
      }

      setPreviewData(data);
      setPreviewModalOpen(true);
    } catch (err: any) {
      showToast(err.message || 'Error generating preview', 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  // 6. Initiate Upload Workflow
  const handleUploadInitiation = () => {
    const targetIds = Array.from(selectedRecordIds);
    if (targetIds.length === 0) {
      showToast('Please select at least one record to upload.', 'info');
      return;
    }

    if (!currentMapping) {
      showToast('No SAP Field Mapping configured for this template. Please configure it in Settings.', 'error');
      return;
    }

    // Check if any selected record was already uploaded
    const selectedRecs = records.filter((r) => targetIds.includes(r.id));
    const hasAlreadyUploaded = selectedRecs.some((r) => r.sapUploadStatus === 'uploaded');

    if (hasAlreadyUploaded) {
      setDuplicateWarningOpen(true);
    } else {
      executeUpload(targetIds);
    }
  };

  // 7. Execute Real Upload
  const executeUpload = async (recordIds: string[]) => {
    setDuplicateWarningOpen(false);
    setPreviewModalOpen(false);
    setUploading(true);
    setUploadProgress({ current: 0, total: recordIds.length });

    try {
      const res = await fetch('/api/sap/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordIds,
          templateId: selectedTemplateId,
          entitySetName: currentMapping?.entitySetName,
          dryRun: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload request failed');
      }

      showToast(
        `SAP Upload Completed: ${data.successCount} succeeded, ${data.failureCount} failed.`,
        data.failureCount === 0 ? 'success' : 'info'
      );

      // Refresh records to get updated status and document numbers
      await refreshRecords();
      setSelectedRecordIds(new Set());
    } catch (err: any) {
      showToast(err.message || 'Upload failed due to network or authentication error.', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const refreshRecords = async () => {
    try {
      const recRes = await fetch('/api/data-entries');
      if (recRes.ok) {
        const data = await recRes.json();
        setRecords(data);
      }
    } catch (err) {
      console.error('Failed to refresh records:', err);
    }
  };

  // 8. Upload History fetch
  const handleOpenHistory = async (recordId?: string) => {
    setLoadingHistory(true);
    setHistoryModalOpen(true);
    setSelectedLogDetail(null);

    try {
      let url = '/api/sap/history';
      const params = new URLSearchParams();
      if (selectedTemplateId && selectedTemplateId !== 'All') {
        params.set('templateId', selectedTemplateId);
      }
      if (recordId) {
        params.set('recordId', recordId);
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const logs = await res.json();
        setHistoryLogs(logs);
      }
    } catch (err) {
      console.error('Failed to fetch upload history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // 9. Retry failed log
  const handleRetryUpload = async (logId: string) => {
    try {
      showToast('Retrying SAP upload...', 'info');
      const res = await fetch('/api/sap/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Upload retry succeeded! Document #${data.result?.sapDocumentId} generated.`, 'success');
        await refreshRecords();
        handleOpenHistory();
      } else {
        showToast(`Retry failed: ${data.result?.message || 'Server error'}`, 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error retrying upload', 'error');
    }
  };

  const handleCopyJson = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPayloadId(id);
    setTimeout(() => setCopiedPayloadId(null), 2000);
  };

  // Helper for Status Badge
  const renderStatusBadge = (status?: SapUploadStatus, docNum?: string | null) => {
    const s = status || 'not_uploaded';

    switch (s) {
      case 'uploaded':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            Uploaded {docNum ? `(#${docNum})` : ''}
          </span>
        );
      case 'uploading':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Uploading...
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-danger/15 text-danger border border-danger/30">
            <AlertCircle className="w-3 h-3" />
            Failed
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary/15 text-primary border border-cardBorder">
            <Clock className="w-3 h-3" />
            Ready
          </span>
        );
      case 'not_uploaded':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-surface text-textSubtle border border-cardBorder">
            Not Uploaded
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 p-3.5 px-4 rounded-xl border text-xs font-bold shadow-2xl flex items-center gap-2 animate-slide-down ${
            toastMessage.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/30'
              : toastMessage.type === 'error'
              ? 'bg-danger text-white border-danger shadow-red-900/30'
              : 'bg-primary text-white border-primary shadow-primary/30'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
          {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {toastMessage.type === 'info' && <Info className="w-4 h-4" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text tracking-tight flex items-center gap-2.5">
            <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7 text-primary" />
            SAP OData Upload Center
          </h1>
          <p className="text-xs text-textMuted mt-1">
            Transform and dispatch structured Voice Entry records into SAP S/4HANA &amp; ERP OData Entity Sets.
          </p>
        </div>

        {/* Action Buttons Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleOpenHistory()}
            className="px-3.5 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text flex items-center gap-1.5 transition cursor-pointer shadow-sm"
          >
            <History className="w-3.5 h-3.5 text-secondary" />
            <span>Upload History</span>
          </button>

          <Link
            href="/settings"
            className="px-3.5 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text flex items-center gap-1.5 transition cursor-pointer shadow-sm"
          >
            <Server className="w-3.5 h-3.5 text-primary" />
            <span>SAP Config &amp; Mapping</span>
          </Link>

          <button
            type="button"
            onClick={refreshRecords}
            disabled={loading}
            className="p-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-textSubtle hover:text-text transition cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* SAP Configuration & Mapping Status Pill */}
      <div className="p-3.5 rounded-xl bg-card border border-cardBorder shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center border border-cardBorder shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-bold text-text">
              <span>Endpoint:</span>
              <span className="font-mono text-primary font-normal truncate max-w-xs sm:max-w-md">
                {sapConfig?.serviceUrl || 'No SAP URL configured'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-textSubtle">
              <span>Auth: <strong className="text-text">{sapConfig?.auth.authType || 'None'}</strong></span>
              <span>•</span>
              <span>
                Entity Set:{' '}
                <strong className="text-secondary font-mono">
                  {currentMapping ? currentMapping.entitySetName : 'No Mapping for Template'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {!currentMapping && selectedTemplateId !== 'All' && (
          <Link
            href="/settings"
            className="text-xs font-bold text-amber-400 hover:underline flex items-center gap-1 self-start sm:self-auto px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Configure Field Mapping in Settings
          </Link>
        )}
      </div>

      {/* Top Filter Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-card border border-cardBorder shadow-md space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Template Selector */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-primary" />
              Voice Entry Template
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-semibold"
            >
              <option value="All">All Templates</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Upload Status Filter */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-secondary" />
              Upload Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
            >
              <option value="All">All Statuses ({filteredRecords.length})</option>
              <option value="not_uploaded">Not Uploaded ({statusCounts.notUploaded})</option>
              <option value="ready">Ready for SAP</option>
              <option value="uploaded">Uploaded Successfully ({statusCounts.uploaded})</option>
              <option value="failed">Failed Uploads ({statusCounts.failed})</option>
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              Date Filter
            </label>
            <div className="flex items-center gap-2">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary font-medium"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 Days</option>
                <option value="custom">Specific Date...</option>
              </select>

              {dateFilter === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="px-2 py-1.5 rounded-xl bg-background border border-cardBorder text-xs text-text font-mono"
                />
              )}
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-textSubtle mb-1.5 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-primary" />
              Search Records
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ID, title, values..."
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-background border border-cardBorder text-xs text-text focus:outline-none focus:border-primary"
              />
              <Search className="w-3.5 h-3.5 text-textSubtle absolute left-2.5 top-2.5" />
            </div>
          </div>
        </div>

        {/* Upload Status Summary Counter Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-cardBorder/60">
          <div className="p-2.5 rounded-xl bg-surface/60 border border-cardBorder flex flex-col">
            <span className="text-[10px] uppercase font-bold text-textSubtle">Total Filtered</span>
            <span className="text-base sm:text-lg font-bold text-text">{statusCounts.total}</span>
          </div>

          <div className="p-2.5 rounded-xl bg-surface/60 border border-cardBorder flex flex-col">
            <span className="text-[10px] uppercase font-bold text-textSubtle">Not Uploaded</span>
            <span className="text-base sm:text-lg font-bold text-textMuted">{statusCounts.notUploaded}</span>
          </div>

          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 flex flex-col">
            <span className="text-[10px] uppercase font-bold text-primary">Ready</span>
            <span className="text-base sm:text-lg font-bold text-primary">{statusCounts.notUploaded}</span>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col">
            <span className="text-[10px] uppercase font-bold text-emerald-400">Uploaded</span>
            <span className="text-base sm:text-lg font-bold text-emerald-400">{statusCounts.uploaded}</span>
          </div>

          <div className="p-2.5 rounded-xl bg-danger/10 border border-danger/20 flex flex-col col-span-2 sm:col-span-1">
            <span className="text-[10px] uppercase font-bold text-danger">Failed</span>
            <span className="text-base sm:text-lg font-bold text-danger">{statusCounts.failed}</span>
          </div>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="border border-cardBorder rounded-2xl bg-card shadow-md overflow-hidden">
        {/* Table Controls Bar */}
        <div className="p-3 sm:p-4 bg-surface/60 border-b border-cardBorder flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="flex items-center gap-1.5 text-xs font-bold text-text hover:text-primary transition cursor-pointer"
            >
              {selectedRecordIds.size === filteredRecords.length && filteredRecords.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4 text-textSubtle" />
              )}
              <span>Select All Filtered ({filteredRecords.length})</span>
            </button>

            {selectedRecordIds.size > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-primary/20 text-primary border border-primary/30">
                {selectedRecordIds.size} Selected
              </span>
            )}
          </div>

          {selectedRecordIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePreviewPayload()}
                disabled={loadingPreview}
                className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text flex items-center gap-1.5 transition cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-primary" />
                <span>Preview SAP Payload</span>
              </button>

              <button
                type="button"
                onClick={handleUploadInitiation}
                disabled={uploading}
                className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/25 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Upload ({selectedRecordIds.size}) to SAP</span>
              </button>
            </div>
          )}
        </div>

        {/* Records Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-surface border-b border-cardBorder text-[10px] uppercase font-bold text-textSubtle">
                <th className="py-3 px-3.5 w-10"></th>
                <th className="py-3 px-3.5">Record ID &amp; Template</th>
                <th className="py-3 px-3.5">Date</th>
                <th className="py-3 px-3.5">Voice Entry Field Data</th>
                <th className="py-3 px-3.5">SAP Status</th>
                <th className="py-3 px-3.5">SAP Reference #</th>
                <th className="py-3 px-3.5">Last Uploaded</th>
                <th className="py-3 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cardBorder/60">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-textMuted space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-textSubtle opacity-60" />
                    <p className="font-semibold text-sm">No Voice Entry records match your current filters.</p>
                    <p className="text-xs text-textSubtle">
                      Try adjusting the template or date filters, or create a new entry in Voice to Data.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  const isSelected = selectedRecordIds.has(rec.id);
                  const fieldValuesCount = Object.keys(rec.fieldValues || {}).length;

                  return (
                    <tr
                      key={rec.id}
                      className={`hover:bg-surface/50 transition cursor-pointer ${
                        isSelected ? 'bg-primary/5' : ''
                      }`}
                      onClick={() => handleToggleSelectRecord(rec.id)}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRecord(rec.id)}
                          className="cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                          ) : (
                            <Square className="w-4 h-4 text-textSubtle" />
                          )}
                        </button>
                      </td>

                      {/* Record ID & Template */}
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-text truncate max-w-[140px]" title={rec.id}>
                          {rec.id}
                        </div>
                        <div className="text-[11px] text-textSubtle flex items-center gap-1.5 mt-0.5">
                          <span className="font-medium text-primary truncate max-w-[130px]">
                            {rec.title || rec.templateName}
                          </span>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3 px-3.5 text-textSubtle font-mono whitespace-nowrap">
                        {rec.date || rec.createdAt.split('T')[0]}
                      </td>

                      {/* Formatted Voice Fields preview */}
                      <td className="py-3 px-3.5 max-w-xs">
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(rec.fieldValues || {})
                              .slice(0, 3)
                              .map(([k, v]) => (
                                <span
                                  key={k}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-cardBorder text-text font-mono truncate max-w-[140px]"
                                  title={`${k}: ${String(v)}`}
                                >
                                  <strong className="text-textSubtle font-sans">{k}:</strong> {String(v)}
                                </span>
                              ))}
                            {fieldValuesCount > 3 && (
                              <span className="text-[10px] text-textSubtle px-1 self-center">
                                +{fieldValuesCount - 3} more
                              </span>
                            )}
                          </div>
                          {rec.tableRows && rec.tableRows.length > 0 && (
                            <div className="text-[10px] text-textSubtle">
                              Table: {rec.tableRows.length} item rows
                            </div>
                          )}
                        </div>
                      </td>

                      {/* SAP Status */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        {renderStatusBadge(rec.sapUploadStatus, rec.sapDocumentNumber)}
                        {rec.sapErrorMessage && (
                          <p
                            className="text-[10px] text-danger truncate max-w-[160px] mt-0.5 font-medium"
                            title={rec.sapErrorMessage}
                          >
                            {rec.sapErrorMessage}
                          </p>
                        )}
                      </td>

                      {/* SAP Ref # */}
                      <td className="py-3 px-3.5 font-mono text-text">
                        {rec.sapDocumentNumber ? (
                          <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            {rec.sapDocumentNumber}
                          </span>
                        ) : (
                          <span className="text-textSubtle">-</span>
                        )}
                      </td>

                      {/* Last Upload Time */}
                      <td className="py-3 px-3.5 text-textSubtle text-[11px] whitespace-nowrap">
                        {rec.sapLastUpload ? (
                          new Date(rec.sapLastUpload).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        ) : (
                          <span>Never</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePreviewPayload(rec.id)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder transition cursor-pointer"
                            title="Preview Payload"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenHistory(rec.id)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-surfaceMuted text-textSubtle hover:text-text border border-cardBorder transition cursor-pointer"
                            title="Upload History"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Bottom Sticky Action Bar when records are selected */}
      {selectedRecordIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-card/95 backdrop-blur-md border border-primary/40 p-3 sm:p-4 rounded-2xl shadow-2xl flex items-center gap-3 sm:gap-6 animate-slide-up max-w-xl w-[92%] sm:w-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-bold text-xs border border-primary/30">
              {selectedRecordIds.size}
            </div>
            <div>
              <p className="text-xs font-bold text-text">
                {selectedRecordIds.size} {selectedRecordIds.size === 1 ? 'Record' : 'Records'} Selected
              </p>
              <p className="text-[10px] text-textSubtle">
                Ready for SAP {currentMapping?.entitySetName || 'OData'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => handlePreviewPayload()}
              className="px-3 sm:px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text flex items-center gap-1.5 transition cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span>Preview</span>
            </button>

            <button
              type="button"
              onClick={handleUploadInitiation}
              disabled={uploading}
              className="px-4 sm:px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-lg shadow-primary/30 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading...' : 'Upload to SAP'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 1. Payload Preview Modal */}
      {previewModalOpen && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-card border border-cardBorder rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
            <div className="p-4 sm:p-5 border-b border-cardBorder flex items-center justify-between bg-surface/50">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary flex items-center justify-center border border-primary/30">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text flex items-center gap-2">
                    SAP Payload Preview &amp; Validation
                  </h2>
                  <p className="text-xs text-textMuted font-mono">
                    Target EntitySet: <strong className="text-primary">{previewData.entitySetName}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface text-textSubtle hover:text-text transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {/* Validation Status Banner */}
              {previewData.allValid ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>All required SAP fields and types validated successfully!</span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Missing Required SAP Fields Detected:</span>
                    <p className="text-[11px] text-textMuted mt-0.5">
                      Review the warnings below before dispatching to avoid SAP Gateway 400 Bad Request rejections.
                    </p>
                  </div>
                </div>
              )}

              {/* Duplicate Upload Notice */}
              {previewData.hasPreviousUploads && (
                <div className="p-3 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-primary" />
                  <span>
                    One or more selected records have already been uploaded previously. Submitting will perform a re-upload.
                  </span>
                </div>
              )}

              {/* JSON Previews list */}
              <div className="space-y-4">
                {previewData.previews.map((item, idx) => (
                  <div key={item.recordId} className="border border-cardBorder rounded-xl overflow-hidden bg-surface/30">
                    <div className="p-3 bg-surface/80 border-b border-cardBorder flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-text">Record #{idx + 1}</span>
                        <span className="font-mono text-[11px] text-textSubtle">({item.recordId})</span>
                        {item.isAlreadyUploaded && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Previously Uploaded
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyJson(JSON.stringify(item.payload, null, 2), item.recordId)}
                        className="text-xs font-semibold text-textSubtle hover:text-text flex items-center gap-1 p-1 rounded hover:bg-surface cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedPayloadId === item.recordId ? 'Copied!' : 'Copy JSON'}</span>
                      </button>
                    </div>

                    {/* Missing Fields / Warnings */}
                    {item.missingRequiredFields.length > 0 && (
                      <div className="p-2.5 bg-danger/10 text-danger text-[11px] border-b border-cardBorder">
                        Missing required: {item.missingRequiredFields.join(', ')}
                      </div>
                    )}

                    {/* Formatted JSON Payload */}
                    <pre className="p-3 text-[11px] font-mono text-emerald-400 dark:text-emerald-300 bg-background/80 overflow-x-auto max-h-52">
                      {JSON.stringify(item.payload, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-cardBorder flex items-center justify-between bg-surface/50">
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
              >
                Close Preview
              </button>

              <button
                type="button"
                onClick={() => executeUpload(previewData.previews.map((p) => p.recordId))}
                disabled={uploading}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/25 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Confirm &amp; Upload to SAP</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Duplicate Upload Prevention Warning Modal */}
      {duplicateWarningOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-card border border-amber-500/40 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text">Prevent Accidental Duplicate Upload</h3>
                <p className="text-xs text-textMuted">Record already uploaded previously</p>
              </div>
            </div>

            <p className="text-xs text-textMuted leading-relaxed">
              One or more of the selected records have <strong>already been successfully uploaded</strong> to SAP.
              Re-uploading may generate duplicate documents, orders, or journal entries in your SAP ERP system.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDuplicateWarningOpen(false)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeUpload(Array.from(selectedRecordIds))}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/30 transition cursor-pointer"
              >
                Proceed &amp; Re-Upload Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Upload History & Diagnostics Drawer/Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-card border border-cardBorder rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
            <div className="p-4 sm:p-5 border-b border-cardBorder flex items-center justify-between bg-surface/50">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-secondary/20 text-secondary flex items-center justify-center border border-secondary/30">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text flex items-center gap-2">
                    SAP Upload History &amp; Audit Logs
                  </h2>
                  <p className="text-xs text-textMuted">
                    Audit trail of payloads, response codes, documents, and diagnostics.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistoryModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface text-textSubtle hover:text-text transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {loadingHistory ? (
                <div className="py-12 text-center text-textMuted space-y-2">
                  <RefreshCw className="w-6 h-6 mx-auto animate-spin text-primary" />
                  <p className="text-xs">Loading history logs...</p>
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="py-12 text-center text-textMuted space-y-2">
                  <History className="w-8 h-8 mx-auto text-textSubtle opacity-60" />
                  <p className="font-semibold text-sm">No upload attempts recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyLogs.map((log) => (
                    <div
                      key={log.id}
                      className="border border-cardBorder rounded-xl p-3 sm:p-4 bg-surface/40 hover:bg-surface/70 transition space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          {log.status === 'success' ? (
                            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-4 h-4" />
                            </span>
                          ) : (
                            <span className="w-6 h-6 rounded-full bg-danger/20 text-danger flex items-center justify-center shrink-0">
                              <AlertCircle className="w-4 h-4" />
                            </span>
                          )}

                          <div>
                            <div className="font-bold text-xs text-text flex items-center gap-2">
                              <span>{log.templateName}</span>
                              <span className="font-mono text-[10px] text-textSubtle">({log.recordId})</span>
                              {log.sapDocumentId && (
                                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30">
                                  Doc #{log.sapDocumentId}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-textSubtle flex items-center gap-2 mt-0.5">
                              <span>Target: <code className="text-text">{log.entitySetName}</code></span>
                              <span>•</span>
                              <span>{new Date(log.uploadedAt).toLocaleString()}</span>
                              <span>•</span>
                              <span>{log.durationMs}ms</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {log.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => handleRetryUpload(log.id)}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Retry
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setSelectedLogDetail(selectedLogDetail?.id === log.id ? null : log)
                            }
                            className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surfaceMuted border border-cardBorder text-[11px] text-text font-semibold transition cursor-pointer"
                          >
                            {selectedLogDetail?.id === log.id ? 'Hide Details' : 'View Payload & Response'}
                          </button>
                        </div>
                      </div>

                      {log.errorMessage && (
                        <div className="p-2 rounded-lg bg-danger/10 text-danger text-[11px] font-medium">
                          {log.errorMessage}
                        </div>
                      )}

                      {/* Detail Drawer for Log */}
                      {selectedLogDetail?.id === log.id && (
                        <div className="pt-2 border-t border-cardBorder/60 space-y-2 animate-fade-in">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="font-bold text-[10px] uppercase text-textSubtle block mb-1">
                                Dispatched JSON Payload
                              </span>
                              <pre className="p-2.5 rounded-lg bg-background font-mono text-[10px] text-emerald-400 overflow-x-auto max-h-48">
                                {JSON.stringify(log.payload, null, 2)}
                              </pre>
                            </div>

                            <div>
                              <span className="font-bold text-[10px] uppercase text-textSubtle block mb-1">
                                SAP Gateway Response (HTTP {log.httpStatus || 0})
                              </span>
                              <pre className="p-2.5 rounded-lg bg-background font-mono text-[10px] text-textMuted overflow-x-auto max-h-48">
                                {JSON.stringify(log.responseBody || { message: log.errorMessage }, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-cardBorder flex items-center justify-end bg-surface/50">
              <button
                type="button"
                onClick={() => setHistoryModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surfaceMuted border border-cardBorder text-xs font-semibold text-text transition cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
