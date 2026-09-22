'use client';

import React from 'react';
import { SessionDataEntry, UserSettings } from '@/types';
import { formatDateDisplay } from '@/lib/utils/dateUtils';

interface PrintableEntriesReportProps {
  entries: SessionDataEntry[];
  settings?: UserSettings | null;
}

export function PrintableEntriesReport({ entries, settings }: PrintableEntriesReportProps) {
  if (!entries || entries.length === 0) return null;

  const todayStr = formatDateDisplay(new Date().toISOString().split('T')[0]);
  const printTimeStr = new Date().toLocaleString();

  return (
    <div className="print-only p-8 bg-white text-black font-sans max-w-4xl mx-auto">
      {/* Company & Document Header */}
      <div className="border-b-2 border-slate-900 pb-4 mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-tight text-slate-900">
            {settings?.businessName || 'Voice ERP Enterprise System'}
          </h1>
          {settings?.businessAddress && (
            <p className="text-xs text-slate-600 mt-1">{settings.businessAddress}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-slate-600 mt-1 font-mono">
            {settings?.gstin && <span>GSTIN: <strong>{settings.gstin}</strong></span>}
            {settings?.businessPhone && <span>Phone: <strong>{settings.businessPhone}</strong></span>}
          </div>
        </div>

        <div className="text-right">
          <div className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-bold uppercase tracking-wider rounded">
            Batch ERP Report
          </div>
          <p className="text-xs text-slate-600 mt-1">Date: <strong>{todayStr}</strong></p>
          <p className="text-[11px] text-slate-500">Printed: {printTimeStr}</p>
          <p className="text-xs font-semibold text-slate-800 mt-1">Total Entries: <strong>{entries.length}</strong></p>
        </div>
      </div>

      {/* Report Summary Table */}
      <div className="mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 border-b border-slate-300 pb-1">
          Entries Summary Overview
        </h2>
        <table className="w-full text-xs border-collapse border border-slate-300 mb-4">
          <thead>
            <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
              <th className="p-2 border border-slate-300 text-center w-12">#</th>
              <th className="p-2 border border-slate-300 text-left">Record / Form Name</th>
              <th className="p-2 border border-slate-300 text-left">Key Data Summary</th>
              <th className="p-2 border border-slate-300 text-center w-24">Table Rows</th>
              <th className="p-2 border border-slate-300 text-right w-28">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const summaryItems: string[] = [];
              if (entry.flexibleFields && entry.flexibleFields.length > 0) {
                entry.flexibleFields.slice(0, 3).forEach((f) => summaryItems.push(`${f.name}: ${f.value}`));
              } else if (entry.fieldValues) {
                Object.entries(entry.fieldValues).slice(0, 3).forEach(([k, v]) => summaryItems.push(`${k}: ${v}`));
              }

              return (
                <tr key={entry.id} className="border-b border-slate-200">
                  <td className="p-2 border border-slate-300 text-center font-bold">{entry.entryNumber}</td>
                  <td className="p-2 border border-slate-300 font-semibold">
                    {entry.mode === 'flexible' ? 'Flexible' : entry.templateName || 'Template'}
                  </td>
                  <td className="p-2 border border-slate-300 text-slate-700">
                    {summaryItems.join(' | ') || 'No fields'}
                  </td>
                  <td className="p-2 border border-slate-300 text-center font-mono">
                    {entry.tableRows?.length || 0}
                  </td>
                  <td className="p-2 border border-slate-300 text-right text-slate-500 font-mono text-[10px]">
                    {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Individual Detailed Entry Cards */}
      <div className="space-y-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 border-b border-slate-300 pb-1">
          Detailed Records Breakdown
        </h2>

        {entries.map((entry) => (
          <div
            key={entry.id}
            className="border border-slate-300 rounded p-4 break-inside-avoid bg-white space-y-3"
            style={{ pageBreakInside: 'avoid' }}
          >
            {/* Entry Header */}
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-slate-800 text-white text-xs font-bold rounded">
                  Entry #{entry.entryNumber}
                </span>
                <span className="text-sm font-bold text-slate-900">
                  {entry.title || entry.templateName || (entry.mode === 'flexible' ? 'Flexible Record' : 'Template Record')}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>

            {/* Transcript Snippet */}
            {entry.rawTranscript && (
              <div className="p-2 bg-slate-50 border-l-2 border-slate-400 text-slate-700 text-xs italic">
                <span className="font-semibold not-italic text-slate-900">Transcript: </span>
                "{entry.rawTranscript}"
              </div>
            )}

            {/* Structured Fields Grid */}
            <div>
              <h4 className="text-[11px] font-bold uppercase text-slate-600 mb-1.5">Fields &amp; Parameters</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {entry.mode === 'flexible' && entry.flexibleFields && entry.flexibleFields.length > 0 ? (
                  entry.flexibleFields.map((f, idx) => (
                    <div key={idx} className="p-1.5 bg-slate-50 border border-slate-200 rounded">
                      <span className="block text-[10px] text-slate-500 uppercase font-semibold">{f.name}</span>
                      <span className="font-bold text-slate-900">{String(f.value || '-')}</span>
                    </div>
                  ))
                ) : (
                  Object.entries(entry.fieldValues || {}).map(([key, val], idx) => (
                    <div key={idx} className="p-1.5 bg-slate-50 border border-slate-200 rounded">
                      <span className="block text-[10px] text-slate-500 uppercase font-semibold">{key}</span>
                      <span className="font-bold text-slate-900">{String(val !== undefined && val !== null && val !== '' ? val : '-')}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Multi-Tables or Repeated Table Rows */}
            {entry.tables && entry.tables.length > 0 ? (
              <div className="space-y-4">
                {entry.tables.map((tbl, tIdx) => (
                  <div key={tIdx}>
                    <h4 className="text-[11px] font-bold uppercase text-slate-600 mb-1.5">
                      {tbl.name || `Table ${tIdx + 1}`} ({tbl.rows?.length || 0} rows)
                    </h4>
                    <table className="w-full text-xs border-collapse border border-slate-300">
                      <thead>
                        <tr className="bg-slate-100 font-bold border-b border-slate-300">
                          <th className="p-1.5 border border-slate-300 text-center w-8">#</th>
                          {(tbl.headers || []).map((h, i) => (
                            <th key={i} className="p-1.5 border border-slate-300 text-left">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {!tbl.rows || tbl.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={(tbl.headers?.length || 1) + 1}
                              className="p-2 text-center text-slate-500 italic text-[10px]"
                            >
                              No entries in this table.
                            </td>
                          </tr>
                        ) : (
                          tbl.rows.map((row: any, rowIdx: number) => (
                            <tr key={rowIdx} className="border-b border-slate-200">
                              <td className="p-1.5 border border-slate-300 text-center font-mono">
                                {rowIdx + 1}
                              </td>
                              {(tbl.headers || []).map((h, colIdx) => {
                                const val = Array.isArray(row)
                                  ? row[colIdx]
                                  : typeof row === 'object' && row !== null
                                  ? row[h]
                                  : '';
                                return (
                                  <td key={colIdx} className="p-1.5 border border-slate-300">
                                    {String(val ?? '')}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : entry.tableRows && entry.tableRows.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold uppercase text-slate-600 mb-1.5">
                  {entry.tableTitle || 'Table Data'} ({entry.tableRows.length} rows)
                </h4>
                <table className="w-full text-xs border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 font-bold border-b border-slate-300">
                      <th className="p-1.5 border border-slate-300 text-center w-8">#</th>
                      {entry.tableHeaders && entry.tableHeaders.length > 0 ? (
                        entry.tableHeaders.map((h, i) => (
                          <th key={i} className="p-1.5 border border-slate-300 text-left">{h}</th>
                        ))
                      ) : Array.isArray(entry.tableRows[0]) ? (
                        (entry.tableRows[0] as any[]).map((_, i) => (
                          <th key={i} className="p-1.5 border border-slate-300 text-left">Col {i + 1}</th>
                        ))
                      ) : (
                        Object.keys(entry.tableRows[0] || {}).map((k) => (
                          <th key={k} className="p-1.5 border border-slate-300 text-left">{k}</th>
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {entry.tableRows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-b border-slate-200">
                        <td className="p-1.5 border border-slate-300 text-center font-mono">{rowIdx + 1}</td>
                        {Array.isArray(row) ? (
                          row.map((cell, colIdx) => (
                            <td key={colIdx} className="p-1.5 border border-slate-300">{String(cell ?? '')}</td>
                          ))
                        ) : (
                          Object.values(row).map((cell, colIdx) => (
                            <td key={colIdx} className="p-1.5 border border-slate-300">{String(cell ?? '')}</td>
                          ))
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Signature & Signoff Box */}
      <div className="mt-12 pt-6 border-t-2 border-slate-800 grid grid-cols-2 gap-8 text-xs">
        <div>
          <p className="font-bold text-slate-800">Operator / Dictated By:</p>
          <div className="mt-8 border-b border-slate-400 w-48" />
          <p className="text-[10px] text-slate-500 mt-1">Name &amp; Signature</p>
        </div>
        <div className="text-right flex flex-col items-end">
          <p className="font-bold text-slate-800">Supervisor / Authorized Signatory:</p>
          <div className="mt-8 border-b border-slate-400 w-48" />
          <p className="text-[10px] text-slate-500 mt-1">Authorized Verification Seal</p>
        </div>
      </div>
    </div>
  );
}
