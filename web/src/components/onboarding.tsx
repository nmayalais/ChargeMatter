'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { trackEvent, ANALYTICS_EVENTS } from './analytics';

const STORAGE_KEY = 'ev-onboarding-complete';

interface OnboardingStep {
  title: string;
  content: React.ReactNode;
}

const STEPS: OnboardingStep[] = [
  {
    title: "Welcome! Here's how it works",
    content: (
      <>
        <p className="text-sm text-[var(--color-muted)] mb-2">
          This app helps you manage EV charger access. There are two main modes:
        </p>
        <ul className="text-sm text-[var(--color-muted)] list-disc pl-5 space-y-1">
          <li>
            <strong className="text-[var(--color-text)]">Charge Now</strong> — See which chargers
            are free and start charging immediately
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Book a Slot</strong> — Reserve a charger
            for later today
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Using a charger',
    content: (
      <>
        <p className="text-sm text-[var(--color-muted)] mb-2">
          When a charger shows <strong className="text-[var(--color-text)]">Free</strong>, tap it
          and hit <strong className="text-[var(--color-text)]">Start Charging</strong>. You will get
          a notification when your session is ending.
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          If a charger is <strong className="text-[var(--color-text)]">In Use</strong> by someone
          else, you can reserve a slot for later.
        </p>
      </>
    ),
  },
  {
    title: 'Reservations & check-in',
    content: (
      <>
        <p className="text-sm text-[var(--color-muted)] mb-2">
          After booking a slot, you will need to{' '}
          <strong className="text-[var(--color-text)]">check in</strong> when your time arrives:
        </p>
        <ol className="text-sm text-[var(--color-muted)] list-decimal pl-5 space-y-1 mb-2">
          <li>Drive to the charger and plug in</li>
          <li>
            Open this app and tap <strong className="text-[var(--color-text)]">Check In</strong>
          </li>
          <li>Your charging session starts automatically</li>
        </ol>
        <p className="text-sm text-[var(--color-muted)]">
          If you do not check in within the grace period, your reservation is released.
        </p>
      </>
    ),
  },
  {
    title: "You're all set!",
    content: (
      <>
        <p className="text-sm text-[var(--color-muted)] mb-2">
          Look for the status banner at the top — it always shows your current session or upcoming
          reservation.
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          Questions? Check the <strong className="text-[var(--color-text)]">(?)</strong> icons
          throughout the app for quick explanations.
        </p>
      </>
    ),
  },
];

export function useOnboarding() {
  const [shouldShow, setShouldShow] = useState(() => {
    if (typeof window !== 'undefined') {
      return !localStorage.getItem(STORAGE_KEY);
    }
    return false;
  });

  const dismiss = useCallback(() => {
    setShouldShow(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  }, []);

  const retrigger = useCallback(() => {
    setShouldShow(true);
  }, []);

  return { shouldShow, dismiss, retrigger };
}

interface OnboardingProps {
  open: boolean;
  onDismiss: () => void;
}

/**
 * Onboarding tour overlay. 4 steps with dot indicators and keyboard navigation.
 * Ported from the V3 Apps Script onboarding tour.
 */
export function Onboarding({ open, onDismiss }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const totalSteps = STEPS.length;
  const isLastStep = currentStep === totalSteps - 1;

  // Focus the Next button when step changes or tour opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        nextBtnRef.current?.focus();
      });
    }
  }, [open, currentStep]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  // Reset step on close
  useEffect(() => {
    if (!open) setCurrentStep(0);
  }, [open]);

  const handleNext = () => {
    if (isLastStep) {
      trackEvent(ANALYTICS_EVENTS.onboardingCompleted, { steps_viewed: totalSteps });
      onDismiss();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleSkip = () => {
    trackEvent(ANALYTICS_EVENTS.onboardingSkipped, { step: currentStep + 1 });
    onDismiss();
  };

  // Focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleSkip();
        return;
      }

      if (e.key === 'Tab' && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentStep],
  );

  if (!open) return null;

  const step = STEPS[currentStep];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(15,23,42,0.55)] animate-backdrop-in"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Card */}
      <div
        ref={cardRef}
        className="relative z-10 w-full max-w-[400px] bg-[var(--color-surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-soft)] border border-[var(--color-border)] p-5 animate-dialog-in"
      >
        <h2
          id="onboarding-title"
          className="text-base font-bold tracking-[-0.01em] mb-3"
        >
          {step.title}
        </h2>

        <div className="mb-5">{step.content}</div>

        {/* Dots */}
        <div className="flex items-center justify-between">
          <div
            className="flex gap-1.5"
            role="tablist"
            aria-label="Onboarding steps"
          >
            {STEPS.map((_, i) => (
              <span
                key={i}
                role="tab"
                aria-label={`Step ${i + 1} of ${totalSteps}`}
                aria-selected={i === currentStep}
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  i === currentStep
                    ? 'bg-[var(--color-primary)] scale-125'
                    : 'bg-[var(--color-border)]'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              className="px-3 py-2 min-h-[var(--spacing-tap)] rounded-[var(--radius-md)] text-sm font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[rgba(27,31,39,0.04)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              onClick={handleSkip}
            >
              Skip
            </button>
            <button
              ref={nextBtnRef}
              className="px-4 py-2 min-h-[var(--spacing-tap)] rounded-[var(--radius-md)] text-sm font-bold border-none bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              onClick={handleNext}
            >
              {isLastStep ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
