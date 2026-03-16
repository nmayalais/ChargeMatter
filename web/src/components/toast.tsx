'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

const MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_MS = 4000;

/** Hook that manages toast state. */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Start exit animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
    // Clear timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast: Toast = { id, message, type };

      setToasts((prev) => {
        const next = [...prev, toast];
        // Limit visible toasts
        if (next.length > MAX_VISIBLE_TOASTS) {
          return next.slice(-MAX_VISIBLE_TOASTS);
        }
        return next;
      });

      // Auto-dismiss
      const timer = setTimeout(() => {
        removeToast(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return { toasts, addToast, removeToast };
}

const typeStyles: Record<ToastType, string> = {
  success:
    'bg-[var(--color-status-free-bg)] text-[var(--color-status-free-text)] border border-[var(--color-status-free-border)]',
  error:
    'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[#fecaca]',
  info: 'bg-[var(--color-status-in-use-bg)] text-[var(--color-status-in-use-text)] border border-[var(--color-status-in-use-border)]',
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div
      className={`min-w-[240px] max-w-[calc(100vw-32px)] px-4 py-3 rounded-[var(--radius-md)] text-[13px] font-semibold text-center shadow-[0_8px_24px_rgba(0,0,0,0.18)] pointer-events-auto flex items-center justify-between gap-2 ${
        toast.exiting ? 'animate-toast-out' : 'animate-toast-in'
      } ${typeStyles[toast.type]}`}
      role="status"
    >
      <span>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-2 text-current opacity-60 hover:opacity-100 bg-transparent border-none cursor-pointer text-base leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none max-w-[calc(100vw-32px)]"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
