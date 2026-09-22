import { NextRequest, NextResponse } from 'next/server';
import { dbSapConfig, dbSapMappings, dbSapLogs, dbDataEntries } from '@/lib/db/models';
import { PayloadBuilder } from '@/lib/sap/payloadBuilder';
import { SapClient } from '@/lib/sap/sapClient';
import { SapPayloadPreviewResult } from '@/lib/sap/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { recordIds, templateId, entitySetName, dryRun = false, directPayloads, overrideConfig } = body;

    // Direct Payload Upload (from Voice to Data "Save All & Upload" Preview Modal if applicable)
    if (Array.isArray(directPayloads) && directPayloads.length > 0) {
      let sapConfig = await dbSapConfig.get();
      if (overrideConfig) {
        sapConfig = {
          ...sapConfig,
          serviceUrl: overrideConfig.serviceUrl || sapConfig.serviceUrl,
          clientNumber: overrideConfig.clientNumber || sapConfig.clientNumber,
          auth: {
            ...sapConfig.auth,
            username: overrideConfig.username || sapConfig.auth.username,
            password:
              overrideConfig.password !== undefined && overrideConfig.password !== ''
                ? overrideConfig.password
                : sapConfig.auth.password,
          },
        };
      }

      if (!sapConfig || !sapConfig.serviceUrl) {
        return NextResponse.json(
          { error: 'SAP Integration is not configured. Please configure your SAP OData Service URL in Settings.' },
          { status: 400 }
        );
      }

      const targetEntity = entitySetName || 'PurchaseOrderSet';
      const results = [];
      let successCount = 0;
      let failureCount = 0;

      for (const item of directPayloads) {
        const payload = item.payload;
        const recordId = item.recordId || `entry_${Date.now()}`;
        const itemEntity = item.entitySetName || targetEntity;

        const execResult = await SapClient.postRecordToSap(sapConfig, itemEntity, payload, recordId);

        await dbSapLogs.create({
          recordId,
          templateId: templateId || 'voice_entry',
          templateName: item.templateName || 'Voice Entry Record',
          sapConfigId: sapConfig.id,
          entitySetName: itemEntity,
          status: execResult.success ? 'success' : 'failed',
          httpStatus: execResult.httpStatus,
          payload,
          sapDocumentId: execResult.sapDocumentId,
          responseBody: execResult.responseBody,
          errorMessage: execResult.success ? null : execResult.message,
          durationMs: execResult.durationMs,
        });

        if (item.recordId) {
          await dbDataEntries.update(item.recordId, {
            sapUploadStatus: execResult.success ? 'uploaded' : 'failed',
            sapDocumentNumber: execResult.sapDocumentId || null,
            sapLastUpload: new Date().toISOString(),
            sapErrorMessage: execResult.success ? null : execResult.message,
          });
        }

        if (execResult.success) successCount++;
        else failureCount++;

        results.push(execResult);
      }

      return NextResponse.json({
        success: failureCount === 0,
        totalCount: directPayloads.length,
        successCount,
        failureCount,
        entitySetName: targetEntity,
        results,
      });
    }

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      return NextResponse.json({ error: 'recordIds must be a non-empty array of record IDs.' }, { status: 400 });
    }

    if (!templateId) {
      return NextResponse.json({ error: 'templateId is required.' }, { status: 400 });
    }

    // 1. Check that SAP config exists
    const sapConfig = await dbSapConfig.get();
    if (!sapConfig || !sapConfig.serviceUrl) {
      return NextResponse.json(
        { error: 'SAP Integration is not configured. Please configure your SAP OData Service URL in Settings.' },
        { status: 400 }
      );
    }

    // 2. Check field mapping
    let mapping = entitySetName
      ? await dbSapMappings.getByTemplateAndEntity(templateId, entitySetName)
      : await dbSapMappings.getByTemplateId(templateId);

    if (!mapping) {
      return NextResponse.json(
        {
          error: `No SAP Field Mapping found for this template. Please configure Field Mapping in Settings > SAP Integration first.`,
        },
        { status: 400 }
      );
    }

    // 3. Fetch records
    const allRecords = await dbDataEntries.getAll();
    const targetRecords = allRecords.filter((r) => recordIds.includes(r.id));

    if (targetRecords.length === 0) {
      return NextResponse.json({ error: 'No matching Voice Entry records found for the given IDs.' }, { status: 404 });
    }

    // 4. If DRY RUN: Generate previews and validation checks
    if (dryRun) {
      const previews: SapPayloadPreviewResult[] = targetRecords.map((rec) =>
        PayloadBuilder.generatePreview(rec, mapping)
      );

      const allValid = previews.every((p) => p.valid);
      const hasPreviousUploads = previews.some((p) => p.isAlreadyUploaded);

      return NextResponse.json({
        dryRun: true,
        entitySetName: mapping.entitySetName,
        previews,
        allValid,
        hasPreviousUploads,
        totalRecords: targetRecords.length,
      });
    }

    // 5. REAL UPLOAD EXECUTION
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const record of targetRecords) {
      const { payload, isValid, missingRequired, warnings } = PayloadBuilder.buildPayload(record, mapping);

      if (!isValid) {
        const errorMsg = `Missing mandatory SAP fields: ${missingRequired.join(', ')}`;

        await dbSapLogs.create({
          recordId: record.id,
          templateId: record.templateId,
          templateName: record.templateName,
          sapConfigId: sapConfig.id,
          entitySetName: mapping.entitySetName,
          status: 'failed',
          httpStatus: 400,
          payload,
          errorMessage: errorMsg,
          durationMs: 0,
        });

        await dbDataEntries.update(record.id, {
          sapUploadStatus: 'failed',
          sapErrorMessage: errorMsg,
          sapLastUpload: new Date().toISOString(),
        });

        results.push({
          recordId: record.id,
          success: false,
          message: errorMsg,
          payload,
        });
        failureCount++;
        continue;
      }

      // Mark record as 'uploading'
      await dbDataEntries.update(record.id, {
        sapUploadStatus: 'uploading',
      });

      // Post to SAP
      const execResult = await SapClient.postRecordToSap(sapConfig, mapping.entitySetName, payload, record.id);

      // Create history log
      await dbSapLogs.create({
        recordId: record.id,
        templateId: record.templateId,
        templateName: record.templateName,
        sapConfigId: sapConfig.id,
        entitySetName: mapping.entitySetName,
        status: execResult.success ? 'success' : 'failed',
        httpStatus: execResult.httpStatus,
        payload,
        sapDocumentId: execResult.sapDocumentId,
        responseBody: execResult.responseBody,
        errorMessage: execResult.success ? null : execResult.message,
        durationMs: execResult.durationMs,
      });

      // Update DataEntryRecord status
      await dbDataEntries.update(record.id, {
        sapUploadStatus: execResult.success ? 'uploaded' : 'failed',
        sapDocumentNumber: execResult.sapDocumentId || null,
        sapLastUpload: new Date().toISOString(),
        sapErrorMessage: execResult.success ? null : execResult.message,
      });

      if (execResult.success) successCount++;
      else failureCount++;

      results.push(execResult);
    }

    return NextResponse.json({
      success: failureCount === 0,
      totalCount: targetRecords.length,
      successCount,
      failureCount,
      entitySetName: mapping.entitySetName,
      results,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
