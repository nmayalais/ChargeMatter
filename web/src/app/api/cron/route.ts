/**
 * Cron API endpoint — called by Vercel Cron or QStash on a schedule.
 *
 * Runs session reminders, reservation reminders, and no-show detection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processSessionReminders } from '@/lib/reminders';
import { processNoShows } from '@/lib/no-shows';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();

    const [reminderResults, noShowResults] = await Promise.all([
      processSessionReminders(now),
      processNoShows(now),
    ]);

    return NextResponse.json({
      ok: true,
      reminders: reminderResults,
      noShows: noShowResults,
    });
  } catch (err) {
    console.error('[CRON] Error running cron job:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
