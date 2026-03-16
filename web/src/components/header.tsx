'use client';

import { Spinner } from './loading';

interface HeaderProps {
  user: { email: string; name?: string | null };
  isRefreshing: boolean;
  onRefresh: () => void;
  onShowTour?: () => void;
}

export function Header({ user, isRefreshing, onRefresh, onShowTour }: HeaderProps) {
  return (
    <header className="flex flex-col items-stretch gap-3 mb-4">
      <div>
        <h1 className="font-[var(--font-display)] text-[28px] font-bold tracking-[-0.02em]">
          EV Charging
        </h1>
        <p className="mt-[6px] text-[var(--color-muted)] text-[13px]">
          Tap a charger to get started.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap w-full">
        <div className="text-xs text-[var(--color-muted)] overflow-hidden text-ellipsis whitespace-nowrap max-w-[70%]">
          {user.name || user.email}
        </div>
        <div className="flex items-center gap-2">
          {onShowTour && (
            <button
              onClick={onShowTour}
              className="bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)] text-xs px-2.5 py-2 min-h-[44px] rounded-[var(--radius-md)] font-semibold inline-flex items-center gap-1 hover:bg-[rgba(27,31,39,0.04)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              aria-label="Show help tour"
            >
              ? Help
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="bg-[var(--color-dark)] text-white border-none text-sm px-3.5 py-2.5 min-h-[44px] rounded-[var(--radius-md)] font-bold inline-flex items-center gap-1.5 tracking-[0.01em] hover:bg-[#2d3b4f] disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {isRefreshing ? (
              <>
                <Spinner size="sm" />
                Refreshing...
              </>
            ) : (
              <>&#8635; Refresh</>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
