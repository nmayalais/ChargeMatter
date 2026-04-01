'use server';

import { setOnboardingComplete } from '@/lib/queries';
import type { Auth } from '@/types';

/**
 * Server Action: mark the onboarding tour as complete for the current user.
 */
export async function markOnboardingComplete(auth: Auth): Promise<void> {
  if (!auth.email) return;
  await setOnboardingComplete(auth.email.toLowerCase());
}
