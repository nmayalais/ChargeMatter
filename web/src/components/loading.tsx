'use client';

/** Inline spinner for buttons and small loading indicators. */
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-3 h-3 border-[1.5px]',
    md: 'w-5 h-5 border-2',
    lg: 'w-8 h-8 border-2',
  };

  return (
    <span
      className={`inline-block rounded-full border-current border-t-transparent animate-spin ${sizeClasses[size]}`}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Skeleton placeholder for a charger card. */
export function SkeletonCard() {
  return (
    <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] p-4 border border-[rgba(27,31,39,0.08)] shadow-[var(--shadow-soft)]">
      <div className="flex justify-between items-start mb-3">
        <div className="h-5 w-28 rounded-[var(--radius-sm)] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer" />
        <div className="h-6 w-16 rounded-full bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer" />
        <div className="h-4 w-3/4 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer" />
      </div>
      <div className="mt-4 h-12 w-full rounded-[var(--radius-md)] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-shimmer" />
    </div>
  );
}

/** Grid of skeleton cards for initial board loading. */
export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Full-page loading state. */
export function FullPageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-[var(--color-muted)]">Loading...</p>
      </div>
    </div>
  );
}
