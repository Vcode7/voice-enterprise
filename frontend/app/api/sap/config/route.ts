import { NextRequest, NextResponse } from 'next/server';
import { dbSapConfig } from '@/lib/db/models';

export async function GET() {
  try {
    const config = await dbSapConfig.getPublic();
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const updated = await dbSapConfig.save(body);
    const publicConfig = await dbSapConfig.getPublic();
    return NextResponse.json(publicConfig);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}
