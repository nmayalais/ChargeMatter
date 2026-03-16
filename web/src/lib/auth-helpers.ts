import { db } from '@/lib/db';
import { suspensions } from '@/lib/db/schema';
import { eq, and, lte, gte } from 'drizzle-orm';
import type { Suspension } from '@/types';
import { formatTime, formatDate } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

/**
 * Check if a user email is in the admin_emails config list.
 * Mirrors getAdminEmails_() + assertAdmin_() from engine.js.
 */
export function isAdmin(email: string, configMap: Record<string, string>): boolean {
  const adminEmails = (configMap.admin_emails || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

/**
 * Throw if the user is not an admin.
 */
export function assertAdmin(email: string, configMap: Record<string, string>): void {
  if (!isAdmin(email, configMap)) {
    throw new Error('Admin access required.');
  }
}

// ---------------------------------------------------------------------------
// Suspension check
// ---------------------------------------------------------------------------

/**
 * Find the active suspension for a user, if any.
 * Returns the suspension row or null.
 */
export async function getActiveSuspensionForUser(
  email: string,
): Promise<Suspension | null> {
  const now = new Date();
  const normalized = email.toLowerCase();

  const rows = await db
    .select()
    .from(suspensions)
    .where(
      and(
        eq(suspensions.userId, normalized),
        eq(suspensions.active, true),
        lte(suspensions.startAt, now),
        gte(suspensions.endAt, now),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Throw an error if the user is currently suspended.
 */
export async function assertNotSuspended(email: string): Promise<void> {
  const suspension = await getActiveSuspensionForUser(email);
  if (suspension) {
    const endAt = suspension.endAt;
    const endDisplay = `${formatTime(endAt)} on ${formatDate(endAt)}`;
    throw new Error(`Charging privileges suspended until ${endDisplay}.`);
  }
}
