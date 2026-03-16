import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { config } from '@/lib/db/schema';

export async function GET() {
  try {
    await db.select().from(config).limit(1);
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Database connection failed' },
      { status: 500 },
    );
  }
}
