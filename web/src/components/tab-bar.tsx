'use client';

interface TabBarProps {
  activeTab: 'now' | 'reserve';
  onTabChange: (tab: 'now' | 'reserve') => void;
}

/**
 * Desktop tab bar, hidden on mobile (mobile uses the bottom nav in Dashboard).
 * Matches the V3 `.mode-tabs` pattern: hidden by default on mobile,
 * shown on larger screens.
 */
export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <nav className="hidden md:flex gap-2 mb-4">
      <button
        className={`border rounded-[var(--radius-sm)] text-[13px] font-semibold px-3 py-2 min-h-[var(--spacing-tap)] transition-all duration-150 cursor-pointer ${
          activeTab === 'now'
            ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
            : 'bg-[#f8fafc] text-[#2f3745] border-[var(--color-border)] hover:bg-[rgba(27,31,39,0.06)]'
        }`}
        onClick={() => onTabChange('now')}
      >
        Charge Now
      </button>
      <button
        className={`border rounded-[var(--radius-sm)] text-[13px] font-semibold px-3 py-2 min-h-[var(--spacing-tap)] transition-all duration-150 cursor-pointer ${
          activeTab === 'reserve'
            ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
            : 'bg-[#f8fafc] text-[#2f3745] border-[var(--color-border)] hover:bg-[rgba(27,31,39,0.06)]'
        }`}
        onClick={() => onTabChange('reserve')}
      >
        Book a Slot
      </button>
    </nav>
  );
}
