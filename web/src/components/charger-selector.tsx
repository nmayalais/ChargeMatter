'use client';

import type { ChargerView } from '@/types';

interface ChargerSelectorProps {
  chargers: ChargerView[];
  selectedChargerId: string | null;
  onSelect: (chargerId: string | null) => void;
  slotCountByCharger: Record<string, number>;
}

/**
 * Charger picker for the reservation booking flow.
 * Shows each charger with name, max duration, and available slot count.
 * "All chargers" is the default to show all available slots across chargers.
 */
export function ChargerSelector({
  chargers,
  selectedChargerId,
  onSelect,
  slotCountByCharger,
}: ChargerSelectorProps) {
  const totalSlots = Object.values(slotCountByCharger).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
      {/* All chargers pill */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all duration-150 border ${
          selectedChargerId === null
            ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
            : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-dark)]'
        }`}
        aria-pressed={selectedChargerId === null}
      >
        All
        {totalSlots > 0 && (
          <span className="ml-1.5 opacity-70">{totalSlots}</span>
        )}
      </button>

      {chargers.map((charger) => {
        const count = slotCountByCharger[charger.id] ?? 0;
        const isSelected = selectedChargerId === charger.id;

        return (
          <button
            key={charger.id}
            type="button"
            onClick={() => onSelect(charger.id)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all duration-150 border ${
              isSelected
                ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
                : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-dark)]'
            }`}
            aria-pressed={isSelected}
          >
            {charger.name || `Charger ${charger.id}`}
            {count > 0 && (
              <span className="ml-1.5 opacity-70">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
