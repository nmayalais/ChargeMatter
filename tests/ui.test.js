const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadScriptIntoDom(options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="refresh-btn">Refresh</button>
    <div id="user-meta"></div>
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
  </body></html>`, { runScripts: 'dangerously', url: 'http://localhost' });

  const { window } = dom;
  window.APP_CONFIG = {
    userEmail: options.userEmail || 'test@example.com',
    userName: options.userName || 'Test User',
    isAdmin: options.isAdmin || false
  };
  window.google = {
    script: {
      run: {
        withSuccessHandler() { return this; },
        withFailureHandler() { return this; },
        getBoardData() {}
      }
    }
  };
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
});
