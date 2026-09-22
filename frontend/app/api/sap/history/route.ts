import { NextRequest, NextResponse } from 'next/server';
import { dbSapLogs, dbSapConfig, dbDataEntries } from '@/lib/db/models';
import { SapClient } from '@/lib/sap/sapClient';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get('templateId') || undefined;
    const status = searchParams.get('status') || undefined;
    const recordId = searchParams.get('recordId') || undefined;

    const logs = await dbSapLogs.getAll({ templateId, status, recordId });
    return NextResponse.json(logs);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { logId } = body;

    if (!logId) {
      return NextResponse.json({ error: 'logId is required to retry an upload.' }, { status: 400 });
    }

    const log = await dbSapLogs.getById(logId);
    if (!log) {
      return NextResponse.json({ error: 'Log entry not found.' }, { status: 404 });
    }

    const sapConfig = await dbSapConfig.get();
    if (!sapConfig || !sapConfig.serviceUrl) {
      return NextResponse.json({ error: 'SAP configuration not found.' }, { status: 400 });
    }

    // Execute retry with the logged payload
    const execResult = await SapClient.postRecordToSap(
      sapConfig,
      log.entitySetName,
      log.payload,
      log.recordId
    );

    // Create a new log for the retry
    const retryLog = await dbSapLogs.create({
      recordId: log.recordId,
      templateId: log.templateId,
      templateName: log.templateName,
      sapConfigId: sapConfig.id,
      entitySetName: log.entitySetName,
      status: execResult.success ? 'success' : 'failed',
      httpStatus: execResult.httpStatus,
      payload: log.payload,
      sapDocumentId: execResult.sapDocumentId,
      responseBody: execResult.responseBody,
      errorMessage: execResult.success ? null : execResult.message,
      durationMs: execResult.durationMs,
    });

    // Update the record status
    await dbDataEntries.update(log.recordId, {
      sapUploadStatus: execResult.success ? 'uploaded' : 'failed',
      sapDocumentNumber: execResult.sapDocumentId || null,
      sapLastUpload: new Date().toISOString(),
      sapErrorMessage: execResult.success ? null : execResult.message,
    });

    return NextResponse.json({
      success: execResult.success,
      result: execResult,
      newLog: retryLog,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await dbSapLogs.clear();
    return NextResponse.json({ success: true, message: 'All SAP upload logs cleared.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
