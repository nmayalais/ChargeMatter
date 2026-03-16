'use client';

import { useState, useCallback, useEffect } from 'react';
import type { BoardData } from '@/types';
import { Header } from './header';
import { TabBar } from './tab-bar';
import { ChargerGrid } from './charger-grid';
import { ReservationView } from './reservation-view';
import { ToastContainer, useToast } from './toast';
import { AdminPanel } from './admin-panel';
import { Onboarding, useOnboarding } from './onboarding';
import { HelpButton } from './help-popover';
import { getBoardData } from '@/actions/board';
import { identifyUser } from './analytics';

interface DashboardProps {
  initialData: BoardData;
  user: { email: string; name?: string | null };
}

export function Dashboard({ initialData, user }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'now' | 'reserve'>('now');
  const [boardData, setBoardData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toasts, addToast, removeToast } = useToast();
  const { shouldShow: showOnboarding, dismiss: dismissOnboarding, retrigger: retriggerOnboarding } = useOnboarding();

  // Identify user for analytics on mount
  useEffect(() => {
    identifyUser(user.email, user.name ?? undefined);
  }, [user.email, user.name]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await getBoardData({
        email: user.email,
        name: user.name ?? '',
        isAdmin: boardData.user.isAdmin,
      });
      setBoardData(data);
    } catch {
      addToast('Failed to refresh', 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [addToast, user.email, user.name, boardData.user.isAdmin]);

  // Auto-refresh every 2 minutes (matching V3's stale-board threshold)
  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, [refresh]);

  // Refresh when tab becomes visible after being hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refresh]);

  const handleBoardUpdate = useCallback((data: BoardData) => {
    setBoardData(data);
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 pt-4 pb-[calc(var(--spacing-bottom-nav)+140px+env(safe-area-inset-bottom))]">
        <Header
          user={user}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          onShowTour={retriggerOnboarding}
        />
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <main>
          {/* Screen reader live region for dynamic updates */}
          <div aria-live="polite" className="sr-only" id="sr-announcements" />

          {activeTab === 'now' ? (
            <div className="animate-mode-fade-in">
              {/* Section header with help button */}
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-bold text-[var(--color-text)]">Availability</h2>
                <HelpButton helpKey="availability" />
                <span className="ml-auto">
                  <HelpButton helpKey="legend" label="Status legend" />
                </span>
              </div>
              <ChargerGrid
                boardData={boardData}
                onAction={refresh}
                addToast={addToast}
              />
            </div>
          ) : (
            <div className="animate-mode-fade-in">
              <ReservationView
                boardData={boardData}
                onAction={refresh}
                addToast={addToast}
              />
            </div>
          )}

          {/* Admin panel — only renders for admins */}
          <AdminPanel
            boardData={boardData}
            onBoardUpdate={handleBoardUpdate}
            addToast={addToast}
          />
        </main>
      </div>

      {/* Bottom tab bar for mobile */}
      <nav
        className="flex fixed left-0 right-0 bottom-0 h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] bg-[var(--color-surface)] border-t-[1.5px] border-[var(--color-border)] shadow-[0_-6px_20px_rgba(15,23,42,0.1)] px-4 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-2 gap-3 justify-around z-[15]"
        aria-label="Navigation"
      >
        <button
          className={`flex-1 min-h-[48px] rounded-[var(--radius-md)] text-sm font-bold tracking-[0.01em] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
            activeTab === 'now'
              ? 'bg-[var(--color-dark)] text-white border-[1.5px] border-[var(--color-dark)]'
              : 'bg-[#f3f4f6] text-[#4b5563] border-[1.5px] border-[var(--color-border)]'
          }`}
          onClick={() => setActiveTab('now')}
          aria-current={activeTab === 'now' ? 'page' : undefined}
        >
          Charge Now
        </button>
        <button
          className={`flex-1 min-h-[48px] rounded-[var(--radius-md)] text-sm font-bold tracking-[0.01em] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
            activeTab === 'reserve'
              ? 'bg-[var(--color-dark)] text-white border-[1.5px] border-[var(--color-dark)]'
              : 'bg-[#f3f4f6] text-[#4b5563] border-[1.5px] border-[var(--color-border)]'
          }`}
          onClick={() => setActiveTab('reserve')}
          aria-current={activeTab === 'reserve' ? 'page' : undefined}
        >
          Book a Slot
        </button>
      </nav>

      {/* Onboarding tour */}
      <Onboarding open={showOnboarding} onDismiss={dismissOnboarding} />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
