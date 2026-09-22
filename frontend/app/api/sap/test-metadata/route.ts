import { NextRequest, NextResponse } from 'next/server';
import { dbSapConfig } from '@/lib/db/models';
import { SapClient } from '@/lib/sap/sapClient';
import { SapIntegrationConfig } from '@/types/sap';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Use current saved config or merge with incoming values from test form
    const currentSaved = await dbSapConfig.get();
    const configToTest: SapIntegrationConfig = {
      ...currentSaved,
      ...body,
      auth: {
        ...currentSaved.auth,
        ...(body.auth || {}),
        // If password wasn't sent or is empty/masked, preserve saved password
        password:
          body.auth?.password && !body.auth.password.includes('•••')
            ? body.auth.password
            : currentSaved.auth.password,
      },
    };

    if (!configToTest.serviceUrl || configToTest.serviceUrl.trim() === '') {
      return NextResponse.json(
        { error: 'SAP Service URL is required to test connection.' },
        { status: 400 }
      );
    }

    const { metadata, testResult } = await SapClient.testConnectionAndFetchMetadata(configToTest);

    return NextResponse.json({
      success: testResult.success,
      testResult,
      metadata,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to connect to SAP service',
      },
      { status: 500 }
    );
  }
}
