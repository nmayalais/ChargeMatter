'use client';

import { useState, useEffect, useRef } from 'react';

interface SessionTimerProps {
  /** ISO end-time string for the session */
  endTime: string;
  /** Optional: label prefix (e.g. "Time left") */
  label?: string;
  /** Optional: className for the container */
  className?: string;
}

/**
 * Formats a millisecond delta into a human-readable countdown string.
 * Positive = time remaining. Negative = overdue.
 */
function formatDelta(diffMs: number): { text: string; overdue: boolean } {
  const overdue = diffMs <= 0;
  const abs = Math.abs(diffMs);
  const totalMinutes = Math.ceil(abs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (overdue) {
    if (hours > 0) {
      return { text: `${hours}h ${minutes}m overdue`, overdue: true };
    }
    return { text: `${totalMinutes}m overdue`, overdue: true };
  }

  if (hours > 0) {
    return { text: `${hours}h ${minutes}m remaining`, overdue: false };
  }
  return { text: `${totalMinutes}m remaining`, overdue: false };
}

/**
 * Live countdown timer that updates every second.
 * Shows time remaining or overdue duration relative to the given endTime.
 */
export function SessionTimer({ endTime, label, className }: SessionTimerProps) {
  const initialEndMs = new Date(endTime).getTime();
  const endMs = useRef(initialEndMs);
  const [delta, setDelta] = useState(() => formatDelta(initialEndMs - Date.now()));

  useEffect(() => {
    endMs.current = new Date(endTime).getTime();
    setDelta(formatDelta(endMs.current - Date.now()));
  }, [endTime]);

  useEffect(() => {
    const tick = () => {
      setDelta(formatDelta(endMs.current - Date.now()));
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className={`font-semibold tabular-nums transition-colors duration-300 ${
        delta.overdue ? 'text-[var(--color-status-overdue-text)]' : ''
      } ${className ?? ''}`}
    >
      {label ? `${label} ` : ''}
      {delta.text}
    </span>
  );
}
