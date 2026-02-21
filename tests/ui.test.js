const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadScriptIntoDom(options = {}) {
  const now = new Date();
  const defaultBoard = options.boardData || {
    serverTime: now.toISOString(),
    user: {},
    config: {},
    reservations: [],
    chargers: []
  };
  const runState = { success: null, failure: null };
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="refresh-btn">Refresh</button>
    <div id="user-meta"></div>
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
    <div id="mode-now"></div>
    <div id="mode-reserve"></div>
    <div id="sticky-bar"></div>
    <div id="sticky-info"></div>
    <div id="sticky-hint"></div>
    <button id="sticky-action"></button>
    <span id="last-updated"></span>
    <div id="confirm-backdrop">
      <div class="confirm-dialog">
        <div id="confirm-title"></div>
        <div id="confirm-message"></div>
        <div id="confirm-detail"></div>
        <button id="confirm-cancel"></button>
        <button id="confirm-ok"></button>
      </div>
    </div>
  </body></html>`, { runScripts: 'dangerously', url: 'http://localhost' });

  const { window } = dom;
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
  window.APP_CONFIG = {
    userEmail: options.userEmail || 'test@example.com',
    userName: options.userName || 'Test User',
    isAdmin: options.isAdmin || false
  };
  window.google = {
    script: {
      run: {
        withSuccessHandler(fn) { runState.success = fn; return this; },
        withFailureHandler(fn) { runState.failure = fn; return this; },
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

  const scriptHtml = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'script.html'), 'utf8');
  const match = scriptHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find <script> tag in apps-script/script.html');
  }
  window.eval(`${match[1]}\nwindow.__state = state;`);

  return window;
}

function buildBoardData(overrides = {}) {
  const now = new Date();
  return {
    serverTime: now.toISOString(),
    user: {},
    config: {},
    reservations: [],
    chargers: [
      { id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60 },
      { id: '2', name: 'Charger 2', statusKey: 'reserved', status: 'Reserved', maxMinutes: 90,
        reservation: { userName: 'Alex', userEmail: 'alex@example.com', startTime: now.toISOString() }
      }
    ],
    ...overrides
  };
}

describe('UI behaviors', () => {
  let activeWindow;

  afterEach(() => {
    if (activeWindow?.stopCountdowns) {
      activeWindow.stopCountdowns();
    }
    activeWindow?.close();
    activeWindow = null;
  });

  test('pauses and resumes countdowns when tab visibility changes', () => {
    jest.useFakeTimers();
    const window = loadScriptIntoDom();
    activeWindow = window;

    expect(window.__state.countdownIntervalId).toBe(null);
    window.startCountdowns();
    expect(window.__state.countdownIntervalId).not.toBe(null);

    Object.defineProperty(window.document, 'hidden', { value: true, configurable: true });
    window.handleVisibilityChange();
    expect(window.__state.countdownIntervalId).toBe(null);

    const spy = jest.spyOn(window, 'updateCountdowns');
    Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
    window.handleVisibilityChange();
    expect(window.__state.countdownIntervalId).not.toBe(null);
    expect(spy).toHaveBeenCalled();
    window.stopCountdowns();
    jest.useRealTimers();
  });

  test('renders charger cards and slots list correctly', () => {
    const window = loadScriptIntoDom();
    activeWindow = window;
    window.renderBoard(buildBoardData());

    const cards = window.document.querySelectorAll('.card');
    expect(cards.length).toBe(2);

    const slots = [
      { chargerId: '1', startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600000).toISOString() },
      { chargerId: '2', startTime: new Date().toISOString(), endTime: new Date(Date.now() + 7200000).toISOString() }
    ];
    window.renderSlotsList(slots);
    const slotRows = window.document.querySelectorAll('.slot-row');
    expect(slotRows.length).toBe(2);
  });

  test('renders walk-up timing when open', () => {
    const window = loadScriptIntoDom();
    activeWindow = window;
    const now = new Date();
    const endTime = new Date(now.getTime() + 30 * 60000).toISOString();
    window.renderBoard({
      serverTime: now.toISOString(),
      user: {},
      config: {},
      reservations: [],
      chargers: [
        {
          id: '1',
          name: 'Charger 1',
          statusKey: 'free',
          status: 'Open',
          maxMinutes: 60,
          walkup: {
            startTime: now.toISOString(),
            endTime,
            openAt: now.toISOString(),
            allUsersOpenAt: now.toISOString(),
            returningUsersOpenAt: now.toISOString(),
            isOpen: true,
            isOpenToReturning: true,
            isOpenToAll: true
          }
        }
      ]
    });

    const labels = Array.from(window.document.querySelectorAll('.info-row .label')).map((el) => el.textContent);
    expect(labels).toContain('Walk-up ends at');
    expect(labels).toContain('Time left');
    const remaining = window.document.querySelector('.walkup-remaining');
    expect(remaining).not.toBeNull();
    window.updateCountdowns();
    expect(remaining.textContent).toMatch(/minutes|hours/);
  });

  test('walk-up closed hides start charging action', () => {
    const window = loadScriptIntoDom();
    activeWindow = window;
    const now = new Date();
    const charger = {
      id: '1',
      name: 'Charger 1',
      statusKey: 'free',
      status: 'Open',
      maxMinutes: 60,
      walkup: {
        startTime: now.toISOString(),
        endTime: new Date(now.getTime() + 60 * 60000).toISOString(),
        openAt: new Date(now.getTime() + 15 * 60000).toISOString(),
        allUsersOpenAt: new Date(now.getTime() + 25 * 60000).toISOString(),
        returningUsersOpenAt: new Date(now.getTime() + 35 * 60000).toISOString(),
        isOpen: false,
        isOpenToReturning: false,
        isOpenToAll: false
      }
    };
    window.renderBoard({
      serverTime: now.toISOString(),
      user: {},
      config: {},
      reservations: [],
      chargers: [charger]
    });

    const labels = Array.from(window.document.querySelectorAll('.info-row .label')).map((el) => el.textContent);
    expect(labels).toContain('Walk-up opens at');
    const action = window.getPrimaryAction(charger);
    expect(action).toBeNull();
  });

  test('shows and clears slot loading state', () => {
    const window = loadScriptIntoDom();
    activeWindow = window;
    window.setSlotsLoading(true);
    const loading = window.document.querySelector('.loading-state');
    expect(loading).not.toBeNull();
    expect(loading.textContent).toContain('Loading available slots');

    window.renderSlotsList([]);
    expect(window.document.querySelector('.loading-state')).toBeNull();
  });

  test('adds accessibility attributes and keyboard behavior for admin menu', () => {
    const window = loadScriptIntoDom({ isAdmin: true });
    activeWindow = window;
    const card = window.createCard({
      id: '99',
      name: 'Charger 99',
      statusKey: 'free',
      status: 'Free',
      maxMinutes: 60
    });

    window.document.body.appendChild(card);
    const trigger = card.querySelector('.menu-trigger');
    const list = card.querySelector('.menu-list');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('role')).toBe('menu');
    expect(list.getAttribute('aria-hidden')).toBe('true');

    const arrowEvent = new window.KeyboardEvent('keydown', { key: 'ArrowDown' });
    trigger.dispatchEvent(arrowEvent);
    expect(list.classList.contains('active')).toBe(true);
    expect(list.getAttribute('aria-hidden')).toBe('false');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    window.setupGlobalHandlers();
    const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape' });
    window.document.dispatchEvent(escEvent);
    expect(list.classList.contains('active')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  test('non-admin can end their own active session via primary action', () => {
    const endSession = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
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
        sessionId: 'session-123',
        userEmail: 'alex@example.com',
        endTime: new Date().toISOString()
      }
    };

    const action = window.getPrimaryAction(charger);
    expect(action.label).toBe("I've moved my car");
    action.action();
    expect(endSession).toHaveBeenCalledWith('session-123');
  });

  test('active session owned by someone else shows notify owner', () => {
    const notifyOwner = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
      runMethods: { notifyOwner }
    });
    activeWindow = window;
    const charger = {
      id: '1',
      name: 'Charger 1',
      statusKey: 'in_use',
      status: 'In use',
      maxMinutes: 60,
      session: {
        sessionId: 'session-123',
        userEmail: 'someoneelse@example.com',
        endTime: new Date().toISOString()
      }
    };

    const action = window.getPrimaryAction(charger);
    expect(action.label).toBe('Notify owner');
    action.action();
    expect(notifyOwner).toHaveBeenCalledWith('1');
  });

  test('matches session owner case-insensitively', () => {
    const endSession = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'Alex@Example.com',
      isAdmin: false,
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
        sessionId: 'session-123',
        userEmail: 'alex@example.com',
        endTime: new Date().toISOString()
      }
    };

    const action = window.getPrimaryAction(charger);
    expect(action.label).toBe("I've moved my car");
    action.action();
    expect(endSession).toHaveBeenCalledWith('session-123');
  });

  test('own reserved charger outside check-in window shows Release reservation as primary', () => {
    const cancelReservation = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
      runMethods: { cancelReservation }
    });
    activeWindow = window;
    const charger = {
      id: '2',
      name: 'Charger 2',
      statusKey: 'reserved',
      status: 'Reserved',
      maxMinutes: 90,
      reservation: {
        reservationId: 'res-456',
        userEmail: 'alex@example.com',
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      }
    };

    const action = window.getPrimaryAction(charger);
    expect(action.label).toBe('Release reservation');
    action.action();
    expect(cancelReservation).toHaveBeenCalledWith('res-456');
  });

  test('own reserved charger in check-in window shows Check in as primary action', () => {
    const checkInReservation = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
      runMethods: { checkInReservation }
    });
    activeWindow = window;
    const charger = {
      id: '2',
      name: 'Charger 2',
      statusKey: 'reserved',
      status: 'Reserved',
      maxMinutes: 90,
      reservation: {
        reservationId: 'res-456',
        userEmail: 'alex@example.com',
        startTime: new Date().toISOString()
      }
    };

    const action = window.getPrimaryAction(charger);
    expect(action.label).toBe('Check in');
    action.action();
    expect(checkInReservation).toHaveBeenCalledWith('res-456');
  });

  test('checked-in reservation shows end session action in reservation list', async () => {
    const endSessionForReservation = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
      runMethods: { endSessionForReservation }
    });
    activeWindow = window;
    const now = new Date();
    window.renderBoard({
      serverTime: now.toISOString(),
      user: {},
      config: {},
      reservations: [
        {
          reservationId: 'res-999',
          chargerId: '1',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
          status: 'checked_in',
          checkedInAt: now.toISOString()
        }
      ],
      chargers: [
        {
          id: '1',
          name: 'Charger 1',
          statusKey: 'in_use',
          status: 'In use',
          maxMinutes: 60,
          session: {
            sessionId: 'session-999',
            userEmail: 'alex@example.com',
            endTime: new Date(now.getTime() + 3600000).toISOString()
          }
        }
      ]
    });

    window.renderReservationsList(window.__state.reservations);
    const endBtn = window.document.querySelector('.reservation-actions .btn.warn');
    expect(endBtn).not.toBeNull();
    endBtn.click();
    // openConfirm() returns a Promise resolved by closeConfirm. setupConfirmDialog() is
    // never called in jsdom (DOMContentLoaded fires before eval), so no listener is attached
    // to #confirm-ok. Use window.eval to call closeConfirm in the jsdom realm so its
    // microtask is queued correctly and flushed by await Promise.resolve().
    window.eval('closeConfirm(true)');
    await Promise.resolve();
    expect(endSessionForReservation).toHaveBeenCalledWith('res-999');
  });

  test('checked-in reservation matches session owner case-insensitively', async () => {
    const endSessionForReservation = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'Alex@Example.com',
      isAdmin: false,
      runMethods: { endSessionForReservation }
    });
    activeWindow = window;
    const now = new Date();
    window.renderBoard({
      serverTime: now.toISOString(),
      user: {},
      config: {},
      reservations: [
        {
          reservationId: 'res-1000',
          chargerId: '1',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
          status: 'checked_in',
          checkedInAt: now.toISOString()
        }
      ],
      chargers: [
        {
          id: '1',
          name: 'Charger 1',
          statusKey: 'in_use',
          status: 'In use',
          maxMinutes: 60,
          session: {
            sessionId: 'session-1000',
            userEmail: 'alex@example.com',
            endTime: new Date(now.getTime() + 3600000).toISOString()
          }
        }
      ]
    });

    window.renderReservationsList(window.__state.reservations);
    const endBtn = window.document.querySelector('.reservation-actions .btn.warn');
    expect(endBtn).not.toBeNull();
    endBtn.click();
    window.eval('closeConfirm(true)');
    await Promise.resolve();
    expect(endSessionForReservation).toHaveBeenCalledWith('res-1000');
  });

  test('checked-in reservation requests end by reservation id', async () => {
    const endSessionForReservation = jest.fn();
    const window = loadScriptIntoDom({
      userEmail: 'alex@example.com',
      isAdmin: false,
      runMethods: { endSessionForReservation }
    });
    activeWindow = window;
    const now = new Date();
    window.renderBoard({
      serverTime: now.toISOString(),
      user: {},
      config: {},
      reservations: [
        {
          reservationId: 'res-2000',
          chargerId: '1',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
          status: 'checked_in',
          checkedInAt: now.toISOString()
        }
      ],
      chargers: [
        {
          id: '1',
          name: 'Charger 1',
          statusKey: 'in_use',
          status: 'In use',
          maxMinutes: 60,
          session: null
        }
      ]
    });

    window.renderReservationsList(window.__state.reservations);
    const endBtn = window.document.querySelector('.reservation-actions .btn.warn');
    expect(endBtn).not.toBeNull();
    endBtn.click();
    window.eval('closeConfirm(true)');
    await Promise.resolve();
    expect(endSessionForReservation).toHaveBeenCalledWith('res-2000');
  });

  test('non-admin does not see admin-only actions', () => {
    const window = loadScriptIntoDom({ isAdmin: false });
    activeWindow = window;
    const card = window.createCard({
      id: '1',
      name: 'Charger 1',
      statusKey: 'in_use',
      status: 'In use',
      maxMinutes: 60,
      session: {
        sessionId: 'session-1',
        userEmail: 'alex@example.com',
        endTime: new Date().toISOString()
      }
    });

    window.document.body.appendChild(card);
    expect(card.querySelector('.menu-trigger')).toBeNull();
    expect(card.querySelector('.menu-list')).toBeNull();
  });

  test('board user admin flag overrides template config', () => {
    const window = loadScriptIntoDom({ isAdmin: true });
    activeWindow = window;
    window.renderBoard({
      serverTime: new Date().toISOString(),
      user: { isAdmin: false },
      config: {},
      chargers: []
    });
    const card = window.createCard({
      id: '1',
      name: 'Charger 1',
      statusKey: 'free',
      status: 'Free',
      maxMinutes: 60
    });

    window.document.body.appendChild(card);
    expect(card.querySelector('.menu-trigger')).toBeNull();
  });

  test('admin sees admin menu actions', () => {
    const window = loadScriptIntoDom({ isAdmin: true });
    activeWindow = window;
    window.renderBoard({
      serverTime: new Date().toISOString(),
      user: { isAdmin: true },
      config: {},
      chargers: []
    });
    const card = window.createCard({
      id: '1',
      name: 'Charger 1',
      statusKey: 'free',
      status: 'Free',
      maxMinutes: 60
    });

    window.document.body.appendChild(card);
    expect(card.querySelector('.menu-trigger')).not.toBeNull();
    expect(card.querySelector('.menu-list')).not.toBeNull();
  });

  // ─── My Status Banner ────────────────────────────────────────────────────────

  describe('My Status Banner', () => {
    test('shows active session with eyebrow, detail text, and end-session button', () => {
      const endSession = jest.fn();
      const now = new Date();
      const endTime = new Date(now.getTime() + 30 * 60000).toISOString();
      const window = loadScriptIntoDom({
        userEmail: 'alex@example.com',
        runMethods: { endSession }
      });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(),
        user: {},
        config: {},
        reservations: [],
        chargers: [{
          id: '1', name: 'Charger 1', statusKey: 'in_use', status: 'In use', maxMinutes: 60,
          session: { sessionId: 's1', userEmail: 'alex@example.com', endTime }
        }]
      });

      const banner = window.document.getElementById('my-status-banner');
      expect(banner.classList.contains('is-hidden')).toBe(false);
      expect(banner.querySelector('.my-status-banner__eyebrow').textContent).toBe('Your session');
      expect(banner.querySelector('.my-status-banner__detail').textContent).toContain('Charger 1');
      const btn = banner.querySelector('.btn');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toContain("I've moved my car");
    });

    test('shows check-in button when reservation is in the check-in window', () => {
      const checkInReservation = jest.fn();
      const now = new Date();
      const window = loadScriptIntoDom({
        userEmail: 'alex@example.com',
        runMethods: { checkInReservation }
      });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(),
        user: {},
        config: {},
        reservations: [{
          reservationId: 'res-1',
          chargerId: '1',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
          status: 'active'
        }],
        chargers: [{ id: '1', name: 'Charger 1', statusKey: 'reserved', status: 'Reserved', maxMinutes: 60 }]
      });

      const banner = window.document.getElementById('my-status-banner');
      expect(banner.classList.contains('is-hidden')).toBe(false);
      expect(banner.querySelector('.my-status-banner__eyebrow').textContent).toBe('Your reservation');
      const btn = banner.querySelector('.btn');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Check in');
    });

    test('shows upcoming reservation without action button when outside check-in window', () => {
      const now = new Date();
      const futureStart = new Date(now.getTime() + 2 * 60 * 60000).toISOString();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(),
        user: {},
        config: {},
        reservations: [{
          reservationId: 'res-future',
          chargerId: '1',
          startTime: futureStart,
          endTime: new Date(now.getTime() + 3 * 60 * 60000).toISOString(),
          status: 'active'
        }],
        chargers: [{ id: '1', name: 'Charger 1', statusKey: 'reserved', status: 'Reserved', maxMinutes: 60 }]
      });

      const banner = window.document.getElementById('my-status-banner');
      expect(banner.classList.contains('is-hidden')).toBe(false);
      expect(banner.querySelector('.my-status-banner__eyebrow').textContent).toBe('Upcoming reservation');
      expect(banner.querySelector('.btn')).toBeNull();
    });

    test('is hidden when user has no active session or reservation', () => {
      const now = new Date();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(),
        user: {},
        config: {},
        reservations: [],
        chargers: [{ id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60 }]
      });

      expect(window.document.getElementById('my-status-banner').classList.contains('is-hidden')).toBe(true);
    });

    test('banner countdown is populated and updated by updateCountdowns()', () => {
      const now = new Date();
      const endTime = new Date(now.getTime() + 30 * 60000).toISOString();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(),
        user: {},
        config: {},
        reservations: [],
        chargers: [{
          id: '1', name: 'Charger 1', statusKey: 'in_use', status: 'In use', maxMinutes: 60,
          session: { sessionId: 's1', userEmail: 'alex@example.com', endTime }
        }]
      });

      const countdown = window.document.querySelector('.my-status-banner__countdown');
      expect(countdown.dataset.sessionEnd).toBe(endTime);
      window.updateCountdowns();
      expect(countdown.textContent).toMatch(/\d+m \d+s/);
    });
  });

  // ─── Notice auto-dismiss ─────────────────────────────────────────────────────

  describe('notice auto-dismiss', () => {
    afterEach(() => jest.useRealTimers());

    test('success notice auto-dismisses after 4 seconds', () => {
      jest.useFakeTimers();
      const window = loadScriptIntoDom();
      activeWindow = window;

      window.setNotice('Session started.', 'success');
      const notice = window.document.getElementById('notice');
      expect(notice.textContent).toBe('Session started.');

      jest.advanceTimersByTime(4000);
      expect(notice.textContent).toBe('');
    });

    test('info notice auto-dismisses after 4 seconds', () => {
      jest.useFakeTimers();
      const window = loadScriptIntoDom();
      activeWindow = window;

      window.setNotice('Select a new slot.', 'info');
      const notice = window.document.getElementById('notice');
      expect(notice.textContent).toBe('Select a new slot.');

      jest.advanceTimersByTime(4000);
      expect(notice.textContent).toBe('');
    });

    test('error notice does not auto-dismiss', () => {
      jest.useFakeTimers();
      const window = loadScriptIntoDom();
      activeWindow = window;

      window.setNotice('Something went wrong.', 'error');
      const notice = window.document.getElementById('notice');

      jest.advanceTimersByTime(5000);
      expect(notice.textContent).toBe('Something went wrong.');
    });

    test('new notice call resets the auto-dismiss timer', () => {
      jest.useFakeTimers();
      const window = loadScriptIntoDom();
      activeWindow = window;
      const notice = window.document.getElementById('notice');

      window.setNotice('First.', 'success');        // timer T1 fires at t=4000
      jest.advanceTimersByTime(3000);               // t=3000, T1 not fired
      window.setNotice('Second.', 'success');       // T1 cancelled, T2 fires at t=7000
      jest.advanceTimersByTime(2000);               // t=5000, T2 not fired
      expect(notice.textContent).toBe('Second.');  // first timer was cancelled

      jest.advanceTimersByTime(2000);               // t=7000, T2 fires
      expect(notice.textContent).toBe('');
    });
  });

  // ─── Skeleton loading ────────────────────────────────────────────────────────

  describe('skeleton loading', () => {
    test('renders 4 skeleton cards on first load before server responds', () => {
      const window = loadScriptIntoDom({
        runMethods: { getBoardData: jest.fn() } // never calls success/failure
      });
      activeWindow = window;

      window.loadBoard(); // state.board is null → skeletons injected before request
      expect(window.document.querySelectorAll('.skeleton-card').length).toBe(4);
    });

    test('does not render skeleton cards on reload when board is already populated', () => {
      const now = new Date();
      const window = loadScriptIntoDom({
        runMethods: { getBoardData: jest.fn() }
      });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [], chargers: []
      });
      window.__state.isLoading = false;

      window.loadBoard(); // state.board is set → no skeletons
      expect(window.document.querySelectorAll('.skeleton-card').length).toBe(0);
    });
  });

  // ─── Auto-refresh on visibility restore ──────────────────────────────────────

  describe('auto-refresh on visibility restore', () => {
    test('records hiddenAt timestamp when tab goes hidden', () => {
      const window = loadScriptIntoDom();
      activeWindow = window;

      Object.defineProperty(window.document, 'hidden', { value: true, configurable: true });
      window.handleVisibilityChange();

      expect(window.__state.hiddenAt).toBeGreaterThan(0);
    });

    test('triggers loadBoard when tab was hidden for more than 60 seconds', () => {
      const getBoardData = jest.fn();
      const now = new Date();
      const window = loadScriptIntoDom({ runMethods: { getBoardData } });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [], chargers: []
      });
      window.__state.isLoading = false;
      window.__state.hiddenAt = Date.now() - 61000; // simulate 61 s hidden

      Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
      window.handleVisibilityChange();

      expect(getBoardData).toHaveBeenCalled();
    });

    test('does not trigger loadBoard when tab was hidden for less than 60 seconds', () => {
      const getBoardData = jest.fn();
      const now = new Date();
      const window = loadScriptIntoDom({ runMethods: { getBoardData } });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [], chargers: []
      });
      window.__state.isLoading = false;
      window.__state.hiddenAt = Date.now() - 30000; // simulate 30 s hidden

      Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
      window.handleVisibilityChange();

      expect(getBoardData).not.toHaveBeenCalled();
    });
  });

  // ─── Walk-up priority labels ──────────────────────────────────────────────────

  describe('walk-up priority labels', () => {
    function buildWalkupBoard(userOverrides, walkupOverrides) {
      const now = new Date();
      return {
        serverTime: now.toISOString(),
        user: { ...userOverrides },
        config: {},
        reservations: [],
        chargers: [{
          id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60,
          walkup: {
            isOpen: true,
            isOpenToAll: false,
            endTime: new Date(now.getTime() + 60 * 60000).toISOString(),
            allUsersOpenAt: new Date(now.getTime() + 15 * 60000).toISOString(),
            returningUsersOpenAt: new Date(now.getTime() + 10 * 60000).toISOString(),
            ...walkupOverrides
          }
        }]
      };
    }

    function getPriorityValue(window) {
      return Array.from(window.document.querySelectorAll('.info-row'))
        .filter((row) => row.querySelector('.label')?.textContent === 'Priority')
        .map((row) => row.querySelector('.value')?.textContent)
        .join('');
    }

    test('net-new user in Tier 1 window sees eligible message', () => {
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;
      window.renderBoard(buildWalkupBoard({ isNetNew: true }, { isOpenToReturning: false }));
      expect(getPriorityValue(window)).toContain("You're eligible");
    });

    test('non-net-new user in Tier 1 window sees priority-window message', () => {
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;
      window.renderBoard(buildWalkupBoard({ isNetNew: false }, { isOpenToReturning: false }));
      expect(getPriorityValue(window)).toContain('Priority window');
    });

    test('returning user in Tier 2 window sees eligible message', () => {
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;
      window.renderBoard(buildWalkupBoard({ isReturning: true }, { isOpenToReturning: true }));
      expect(getPriorityValue(window)).toContain("You're eligible");
    });

    test('non-returning user in Tier 2 window sees opens-to-all message', () => {
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;
      window.renderBoard(buildWalkupBoard({ isReturning: false }, { isOpenToReturning: true }));
      expect(getPriorityValue(window)).toContain('Opens to all at');
    });
  });

  // ─── Card hint text ───────────────────────────────────────────────────────────

  describe('card hint text', () => {
    test('shows action-preview hint for a charger with a primary action', () => {
      const now = new Date();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [],
        chargers: [{ id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60 }]
      });

      const hint = window.document.querySelector('.card-hint');
      expect(hint.textContent).toMatch(/tap to start charging/i);
      expect(hint.classList.contains('is-hidden')).toBe(false);
    });

    test("shows own-session action text on user's active charger", () => {
      const now = new Date();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [],
        chargers: [{
          id: '1', name: 'Charger 1', statusKey: 'in_use', status: 'In use', maxMinutes: 60,
          session: {
            sessionId: 's1', userEmail: 'alex@example.com',
            endTime: new Date(now.getTime() + 3600000).toISOString()
          }
        }]
      });

      const hint = window.document.querySelector('.card-hint');
      expect(hint.textContent).toMatch(/tap to i've moved my car/i);
    });

    test('hint is hidden when charger has no primary action', () => {
      const now = new Date();
      const window = loadScriptIntoDom({ userEmail: 'alex@example.com' });
      activeWindow = window;

      window.renderBoard({
        serverTime: now.toISOString(), user: {}, config: {}, reservations: [],
        chargers: [{
          id: '1', name: 'Charger 1', statusKey: 'free', status: 'Free', maxMinutes: 60,
          walkup: {
            isOpen: false,
            openAt: new Date(now.getTime() + 15 * 60000).toISOString()
          }
        }]
      });

      const hint = window.document.querySelector('.card-hint');
      expect(hint.classList.contains('is-hidden')).toBe(true);
    });
  });
});
