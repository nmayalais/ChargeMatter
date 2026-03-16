'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { trackEvent, ANALYTICS_EVENTS } from './analytics';

// ---------------------------------------------------------------------------
// Help content (mirrors V3 HELP_CONTENT)
// ---------------------------------------------------------------------------

const HELP_CONTENT: Record<string, { title: string; body: React.ReactNode }> = {
  availability: {
    title: 'About Availability',
    body: (
      <p>
        This board shows all EV chargers in real time. Green means free — tap a charger to start
        charging. Blue means someone is using it. Purple means reserved for an upcoming slot.
      </p>
    ),
  },
  legend: {
    title: 'Status Legend',
    body: (
      <dl className="space-y-1.5">
        <div className="flex gap-2 items-start">
          <dt>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-status-free-bg)] border border-[var(--color-status-free-border)] mt-0.5" />
          </dt>
          <dd>
            <strong>Free</strong> = available to use now
          </dd>
        </div>
        <div className="flex gap-2 items-start">
          <dt>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-status-in-use-bg)] border border-[var(--color-status-in-use-border)] mt-0.5" />
          </dt>
          <dd>
            <strong>In Use</strong> = someone is actively charging
          </dd>
        </div>
        <div className="flex gap-2 items-start">
          <dt>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-status-reserved-bg)] border border-[var(--color-status-reserved-border)] mt-0.5" />
          </dt>
          <dd>
            <strong>Reserved</strong> = booked for an upcoming time slot
          </dd>
        </div>
        <div className="flex gap-2 items-start">
          <dt>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-status-overdue-bg)] border border-[var(--color-status-overdue-border)] mt-0.5" />
          </dt>
          <dd>
            <strong>Overdue</strong> = session has exceeded the maximum time limit
          </dd>
        </div>
      </dl>
    ),
  },
};

// ---------------------------------------------------------------------------
// HelpButton — the (?) trigger
// ---------------------------------------------------------------------------

interface HelpButtonProps {
  helpKey: string;
  className?: string;
  label?: string;
}

/**
 * Small (?) button that toggles a contextual help popover.
 */
export function HelpButton({ helpKey, className = '', label }: HelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const content = HELP_CONTENT[helpKey];

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  if (!content) return null;

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      trackEvent(ANALYTICS_EVENTS.helpPopoverOpened, { help_key: helpKey });
    }
  };

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] text-[11px] font-bold leading-none hover:bg-[rgba(27,31,39,0.06)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={label || `Help: ${content.title}`}
      >
        ?
      </button>

      {isOpen && (
        <HelpPopoverContent
          ref={popoverRef}
          title={content.title}
          onClose={close}
        >
          {content.body}
        </HelpPopoverContent>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Popover content panel
// ---------------------------------------------------------------------------

import { forwardRef } from 'react';

interface HelpPopoverContentProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

const HelpPopoverContent = forwardRef<HTMLDivElement, HelpPopoverContentProps>(
  function HelpPopoverContent({ title, children, onClose }, ref) {
    const innerRef = useRef<HTMLDivElement>(null);
    const closeBtnRef = useRef<HTMLButtonElement>(null);

    // Use the forwarded ref or the inner ref
    const popoverRef = (ref as React.RefObject<HTMLDivElement | null>) || innerRef;

    // Click outside to close
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        const el = popoverRef.current;
        if (el && !el.contains(e.target as Node)) {
          onClose();
        }
      };
      // Delay so the trigger click doesn't immediately close
      const timer = setTimeout(() => {
        document.addEventListener('click', handler);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handler);
      };
    }, [onClose, popoverRef]);

    // Escape to close
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // Focus close button on mount
    useEffect(() => {
      closeBtnRef.current?.focus();
    }, []);

    return (
      <div
        ref={popoverRef}
        role="dialog"
        aria-label={title}
        className="absolute top-full left-0 mt-2 w-[280px] bg-[var(--color-surface)] rounded-[var(--radius-md)] shadow-[var(--shadow-soft)] border border-[var(--color-border)] p-3 z-30 animate-dialog-in text-sm text-[var(--color-text)]"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">
            {title}
          </h3>
          <button
            ref={closeBtnRef}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)] bg-transparent border-none text-base leading-none cursor-pointer p-0 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
            onClick={onClose}
            aria-label="Close help"
          >
            &times;
          </button>
        </div>
        <div className="text-[13px] leading-relaxed">{children}</div>
      </div>
    );
  },
);
