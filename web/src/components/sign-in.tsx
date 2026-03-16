'use client';

import { signIn } from 'next-auth/react';

/**
 * Sign-in page for unauthenticated users.
 * Shows app branding and a "Sign in with Google" button.
 */
export function SignIn() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[360px] text-center">
        {/* Branding */}
        <div className="mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--color-primary-soft)] mb-4"
            aria-hidden="true"
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--color-primary)]"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <h1 className="font-[var(--font-display)] text-[28px] font-bold tracking-[-0.02em] mb-2">
            EV Charging
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            Sign in to manage charger reservations.
          </p>
        </div>

        {/* Sign-in card */}
        <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-soft)] border border-[var(--color-border)] p-6">
          <button
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 min-h-[var(--spacing-tap)] rounded-[var(--radius-md)] text-sm font-bold bg-[var(--color-dark)] text-white hover:bg-[#2d3b4f] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              aria-hidden="true"
            >
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </button>
        </div>

        <p className="mt-4 text-xs text-[var(--color-muted)]">
          Access is restricted to your organization.
        </p>
      </div>
    </div>
  );
}
