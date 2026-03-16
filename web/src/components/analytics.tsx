'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';

/**
 * PostHog analytics provider.
 * Wraps the app to enable event tracking.
 * Pass `posthogKey` from an environment variable; when absent, analytics are disabled.
 */
export function AnalyticsProvider({
  children,
  posthogKey,
}: {
  children: React.ReactNode;
  posthogKey?: string;
}) {
  useEffect(() => {
    if (posthogKey && typeof window !== 'undefined') {
      posthog.init(posthogKey, {
        api_host: 'https://us.i.posthog.com',
        capture_pageview: true,
        persistence: 'localStorage',
        // Respect Do Not Track browser setting
        respect_dnt: true,
      });
    }
  }, [posthogKey]);

  if (!posthogKey) return <>{children}</>;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

// ---------------------------------------------------------------------------
// Event names (mirrors PH_EVENT_NAMES from V3)
// ---------------------------------------------------------------------------

export const ANALYTICS_EVENTS = {
  sessionStarted: 'session_started',
  sessionEnded: 'session_ended',
  reservationCreated: 'reservation_created',
  reservationUpdated: 'reservation_updated',
  reservationCancelled: 'reservation_cancelled',
  reservationCheckedIn: 'reservation_checked_in',
  ownerNotified: 'owner_notified',
  sessionForceEnded: 'session_force_ended',
  chargerReset: 'charger_reset',
  reservationCompletedManually: 'reservation_completed_manually',
  onboardingCompleted: 'onboarding_completed',
  onboardingSkipped: 'onboarding_skipped',
  helpPopoverOpened: 'help_popover_opened',
  adminPanelOpened: 'admin_panel_opened',
} as const;

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Track a custom event. No-op when PostHog is not initialised. */
export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.capture(event, properties);
  }
}

/** Identify the current user. */
export function identifyUser(email: string, name?: string) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.identify(email, { email, name });
  }
}
