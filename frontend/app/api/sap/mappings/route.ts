import { NextRequest, NextResponse } from 'next/server';
import { dbSapMappings } from '@/lib/db/models';
import { SapFieldMapping } from '@/types/sap';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get('templateId');
    const entitySet = searchParams.get('entitySet');

    if (templateId && entitySet) {
      const mapping = await dbSapMappings.getByTemplateAndEntity(templateId, entitySet);
      return NextResponse.json(mapping || null);
    }

    if (templateId) {
      const mapping = await dbSapMappings.getByTemplateId(templateId);
      return NextResponse.json(mapping || null);
    }

    const all = await dbSapMappings.getAll();
    return NextResponse.json(all);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SapFieldMapping = await req.json();

    if (!body.templateId || !body.entitySetName) {
      return NextResponse.json(
        { error: 'templateId and entitySetName are required.' },
        { status: 400 }
      );
    }

    const saved = await dbSapMappings.save(body);
    return NextResponse.json(saved, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
