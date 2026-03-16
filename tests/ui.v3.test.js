const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/**
 * Loads script_v3.html into a jsdom environment.
 * Mirrors the loadScriptIntoDom pattern from ui.test.js but targets v3.
 */
function loadV3Dom(options = {}) {
  const now = options.now || new Date();
  const defaultBoard = options.boardData || {
    serverTime: now.toISOString(),
    timezone: 'America/Los_Angeles',
    user: {},
    config: {},
    reservations: [],
    chargers: []
  };
  const runState = { success: null, failure: null };
  const dom = new JSDOM(
    `<!doctype html><html><body>
    <button id="refresh-btn">Refresh</button>
    <div id="user-meta"></div>
    <div id="suspension-banner"></div>
    <div id="my-status-banner" class="my-status-banner is-hidden">
      <div class="my-status-banner__eyebrow"></div>
      <div class="my-status-banner__detail"></div>
      <div class="my-status-banner__sub"></div>
      <div class="my-status-banner__countdown" data-session-end=""></div>
    </div>
    <section id="notice"></section>
    <div id="notice-help"></div>
    <section id="checkout-reminder"></section>
    <div id="summary"></div>
    <div id="summary-caption"></div>
    <div id="board"></div>
    <div id="reservation-limits"></div>
    <div id="edit-banner"></div>
    <div id="slots-list"></div>
    <div id="reservations-list"></div>
    <div id="my-reservations-panel"></div>
    <div id="mode-now"></div>
    <div id="mode-reserve"></div>
    <div id="mode-tabs"><button data-mode="now"></button><button data-mode="reserve"></button></div>
    <div id="mobile-tabs"></div>
    <div id="channel-actions"></div>
    <div id="sticky-bar"></div>
    <div id="sticky-info"></div>
    <div id="sticky-hint"></div>
    <button id="sticky-action"></button>
    <span id="last-updated"></span>
    <div id="toast-container"></div>
    <div id="confirm-backdrop">
      <div class="confirm-dialog">
        <div id="confirm-title"></div>
        <div id="confirm-message"></div>
        <div id="confirm-detail"></div>
        <button id="confirm-cancel"></button>
        <button id="confirm-ok"></button>
      </div>
    </div>
    <div id="onboarding-overlay" aria-hidden="true" style="display:none">
      <div class="onboarding-card">
        <button id="onboarding-next">Next</button>
        <button id="onboarding-skip">Skip</button>
      </div>
    </div>
    <div id="help-popover" class="help-popover">
      <div id="help-popover-content"></div>
      <button class="help-popover__close"></button>
    </div>
  </body></html>`,
    { runScripts: 'dangerously', url: 'http://localhost' }
  );

  const { window } = dom;
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    }));
  // Stub localStorage
  const store = {};
  window.localStorage = {
    getItem(k) {
      return store[k] || null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    }
  };
  window.APP_CONFIG = {
    userEmail: options.userEmail || 'test@example.com',
    userName: options.userName || 'Test User',
    isAdmin: options.isAdmin || false,
    appName: options.appName || 'ChargeMatter',
    slackChannelName: '',
    slackChannelUrl: '',
    slackChannelLabel: '',
    posthogKey: ''
  };
  window.google = {
    script: {
      run: {
        withSuccessHandler(fn) {
          runState.success = fn;
          return this;
        },
        withFailureHandler(fn) {
          runState.failure = fn;
          return this;
        },
        ...(options.runMethods || {})
      }
    }
  };
  if (!window.google.script.run.getBoardData) {
    window.google.script.run.getBoardData = () => {
      if (runState.success) {
        runState.success(defaultBoard);
      }
    };
  }
  window.confirm = () => true;

  const scriptHtml = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'script_v3.html'), 'utf8');
  const match = scriptHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find <script> tag in apps-script/script_v3.html');
  }
  window.eval(`${match[1]}\nwindow.__state = state;`);

  return { window, runState };
}

describe('V3 UI regression tests', () => {
  let activeWindow;

  afterEach(() => {
    if (activeWindow?.stopCountdowns) {
      activeWindow.stopCountdowns();
    }
    activeWindow?.close();
    activeWindow = null;
  });

  // ─── Bug #1: Toast stacking ─────────────────────────────────────────────────

  describe('toast notifications', () => {
    test('multiple toasts append as separate children in the container', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.showToast('First toast', 'success');
      window.showToast('Second toast', 'info');
      window.showToast('Third toast', 'error');

      const container = window.document.getElementById('toast-container');
      const toasts = container.querySelectorAll('.toast');
      expect(toasts.length).toBe(3);
      // Each toast should be a distinct element (not overlapping at same position)
      expect(toasts[0].textContent).toBe('First toast');
      expect(toasts[1].textContent).toBe('Second toast');
      expect(toasts[2].textContent).toBe('Third toast');
    });

    test('enforces MAX_VISIBLE_TOASTS limit by removing oldest', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.showToast('Toast 1', 'info');
      window.showToast('Toast 2', 'info');
      window.showToast('Toast 3', 'info');
      // 4th toast should evict the 1st
      window.showToast('Toast 4', 'info');

      const container = window.document.getElementById('toast-container');
      const toasts = container.querySelectorAll('.toast');
      expect(toasts.length).toBe(3);
      // Oldest toast ("Toast 1") should have been removed
      const texts = Array.from(toasts).map((t) => t.textContent);
      expect(texts).not.toContain('Toast 1');
      expect(texts).toContain('Toast 4');
    });

    test('toast auto-dismisses after timeout', () => {
      jest.useFakeTimers();
      const { window } = loadV3Dom();
      activeWindow = window;

      window.showToast('Disappearing toast', 'success');
      const container = window.document.getElementById('toast-container');
      expect(container.querySelectorAll('.toast').length).toBe(1);

      // After 4s, toast gets exit class
      jest.advanceTimersByTime(4000);
      const toast = container.querySelector('.toast');
      expect(toast.classList.contains('toast-exit')).toBe(true);

      // After exit animation (300ms), toast is removed
      jest.advanceTimersByTime(300);
      expect(container.querySelectorAll('.toast').length).toBe(0);

      jest.useRealTimers();
    });
  });

  // ─── Bug #2: Escape key priority ────────────────────────────────────────────

  describe('escape key handler priority', () => {
    test('Escape closes confirm dialog and stops propagation', () => {
      const { window } = loadV3Dom({ isAdmin: true });
      activeWindow = window;

      // Render board so state is initialized
      window.renderBoard({
        serverTime: new Date().toISOString(),
        timezone: 'America/Los_Angeles',
        user: { isAdmin: true },
        config: {},
        reservations: [],
        chargers: [
          {
            id: '1',
            name: 'Charger 1',
            statusKey: 'free',
            status: 'Free',
            maxMinutes: 60
          }
        ]
      });

      // Setup global handlers so Escape listener is active
      window.setupGlobalHandlers();

      // Open a confirm dialog via the exposed openConfirm
      // openConfirm sets confirmState.isOpen = true internally
      const confirmPromise = window.openConfirm({ title: 'Test', message: 'Test' });

      // The backdrop should be active now
      const backdrop = window.document.getElementById('confirm-backdrop');
      expect(backdrop.classList.contains('active')).toBe(true);

      // Press Escape
      const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      window.document.dispatchEvent(escEvent);

      // Backdrop should no longer be active (confirm was closed)
      expect(backdrop.classList.contains('active')).toBe(false);
    });

    test('Escape on help popover closes it without affecting other UI', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.renderBoard({
        serverTime: new Date().toISOString(),
        timezone: 'America/Los_Angeles',
        user: {},
        config: {},
        reservations: [],
        chargers: []
      });

      // Manually activate the help popover
      const popover = window.document.getElementById('help-popover');
      popover.classList.add('active');

      // Press Escape on document — popover handler should fire and stop propagation
      const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      window.document.dispatchEvent(escEvent);

      // Popover should be closed
      expect(popover.classList.contains('active')).toBe(false);
    });
  });

  // ─── Stale board: skip pre-refresh, fire action directly ─────────────────────

  describe('stale board optimization', () => {
    test('fires action directly without pre-refreshing when board is stale', () => {
      jest.useFakeTimers();
      const startSession = jest.fn();
      const getBoardData = jest.fn();
      const { window, runState } = loadV3Dom({
        runMethods: { startSession, getBoardData }
      });
      activeWindow = window;

      // Initialize board and make it stale
      const now = new Date();
      window.renderBoard({
        serverTime: now.toISOString(),
        timezone: 'America/Los_Angeles',
        user: {},
        config: {},
        reservations: [],
        chargers: [{ id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60 }]
      });
      window.__state.isLoading = false;
      // Make board stale (>2 min ago)
      window.__state.lastFetch = Date.now() - 130000;

      // Trigger a server call — should go directly to startSession, not getBoardData
      window.eval(`
        callServer('startSession', ['1'], {});
      `);

      // startSession should be called directly (no pre-refresh via getBoardData)
      expect(startSession).toHaveBeenCalled();
      expect(getBoardData).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // ─── Bug #4: Toast-only for success/info ────────────────────────────────────

  describe('toast-only notifications for success/info', () => {
    test('success notice shows toast but clears inline notice', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.setNotice('Session started!', 'success');

      // Inline notice should be empty
      const notice = window.document.getElementById('notice');
      expect(notice.textContent).toBe('');

      // Toast should exist
      const container = window.document.getElementById('toast-container');
      const toasts = container.querySelectorAll('.toast');
      expect(toasts.length).toBe(1);
      expect(toasts[0].textContent).toBe('Session started!');
      expect(toasts[0].classList.contains('toast-success')).toBe(true);
    });

    test('info notice shows toast but clears inline notice', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.setNotice('Select a new slot.', 'info');

      const notice = window.document.getElementById('notice');
      expect(notice.textContent).toBe('');

      const container = window.document.getElementById('toast-container');
      const toasts = container.querySelectorAll('.toast');
      expect(toasts.length).toBe(1);
      expect(toasts[0].textContent).toBe('Select a new slot.');
      expect(toasts[0].classList.contains('toast-info')).toBe(true);
    });

    test('error notice still shows inline notice (no toast)', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.setNotice('Something went wrong.', 'error');

      const notice = window.document.getElementById('notice');
      expect(notice.textContent).toBe('Something went wrong.');
      expect(notice.classList.contains('notice--error')).toBe(true);

      // No toast for errors
      const container = window.document.getElementById('toast-container');
      expect(container.querySelectorAll('.toast').length).toBe(0);
    });
  });

  // ─── Bug #5: Timezone-aware slot grouping ───────────────────────────────────

  describe('timezone-aware display', () => {
    test('stores server timezone from board data', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.renderBoard({
        serverTime: new Date().toISOString(),
        timezone: 'America/Los_Angeles',
        user: {},
        config: {},
        reservations: [],
        chargers: []
      });

      expect(window.__state.timezone).toBe('America/Los_Angeles');
    });

    test('getDatePartsInTz returns server-timezone parts', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      // Set timezone to a known value
      window.__state.timezone = 'America/New_York';

      // Create a date that is midnight UTC on Jan 2
      // In ET (UTC-5), this would be 7:00 PM Jan 1
      const date = new Date('2026-01-02T00:00:00Z');
      const parts = window.getDatePartsInTz(date);

      // In New York timezone, midnight UTC = 7 PM previous day
      expect(parts.day).toBe(1); // Jan 1 in ET
      expect(parts.hours).toBe(19); // 7 PM in ET
    });

    test('getDatePartsInTz falls back to local when no timezone set', () => {
      const { window } = loadV3Dom();
      activeWindow = window;
      window.__state.timezone = null;

      const date = new Date(2026, 5, 15, 14, 30); // June 15, 2:30 PM local
      const parts = window.getDatePartsInTz(date);

      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(6);
      expect(parts.day).toBe(15);
      expect(parts.hours).toBe(14);
      expect(parts.minutes).toBe(30);
    });

    test('slot grouping uses server timezone for day boundaries', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      // Set server timezone
      window.__state.timezone = 'America/Los_Angeles';

      // Create a "now" in PST: March 10, 2026, 8:00 PM PST = March 11 03:00 UTC
      const now = new Date('2026-03-11T03:00:00Z');
      window.__state.serverTime = now;
      window.__state.lastFetch = Date.now();

      // Create a slot at 9:00 PM PST same day = March 11 04:00 UTC
      const slotStart = new Date('2026-03-11T04:00:00Z');
      const slotEnd = new Date('2026-03-11T07:00:00Z');

      const slots = [
        {
          chargerId: '1',
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString()
        }
      ];

      const groups = window.groupSlotsByWindow(slots);

      // The slot should be grouped under "today" categories (Next 2 hours, Later today, Tonight)
      // NOT under a different date heading — because in PST it's still March 10
      const otherDateKeys = Object.keys(groups.find?.((g) => g.label && g.label.match(/Mar/)) || {});
      // If it were incorrectly using UTC, the slot would appear under "Wed, Mar 11"
      // In PST, both "now" and slot start are on March 10, so it should be in tonight/next
      const allLabels = groups.map((g) => g.label);
      const hasMar11 = allLabels.some((l) => l && l.includes('Mar 11'));
      expect(hasMar11).toBe(false);
    });
  });

  // ─── V3 basic rendering ─────────────────────────────────────────────────────

  describe('v3 basic rendering', () => {
    test('renders charger cards', () => {
      const { window } = loadV3Dom();
      activeWindow = window;

      window.renderBoard({
        serverTime: new Date().toISOString(),
        timezone: 'America/Los_Angeles',
        user: {},
        config: {},
        reservations: [],
        chargers: [
          { id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60 },
          { id: '2', name: 'Charger 2', statusKey: 'in_use', status: 'In use', maxMinutes: 90 }
        ]
      });

      const cards = window.document.querySelectorAll('.card');
      expect(cards.length).toBe(2);
    });

    test('v3 end session button says "End Session" not "I\'ve moved my car"', () => {
      const endSession = jest.fn();
      const { window } = loadV3Dom({
        userEmail: 'alex@example.com',
        runMethods: { endSession }
      });
      activeWindow = window;

      const charger = {
        id: '1',
        name: 'Charger 1',
        statusKey: 'in_use',
        status: 'In use',
        maxMinutes: 60,
        session: {
          sessionId: 'session-1',
          userEmail: 'alex@example.com',
          endTime: new Date(Date.now() + 3600000).toISOString()
        }
      };

      const action = window.getPrimaryAction(charger);
      expect(action.label).toBe('End Session');
    });
  });
});
