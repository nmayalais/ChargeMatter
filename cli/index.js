'use strict';

const path = require('path');
const { loadStore, saveStore, ensureSheet } = require('./store');
const { createEngine } = require('./engine');
const { seedStore } = require('./seed');

const argv = process.argv.slice(2);
const parsed = parseArgs(argv);
const command = parsed.args[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

const storePath = path.resolve(parsed.flags.store || 'data/store.json');
const store = loadStore(storePath);
store.properties = store.properties || {};
store.properties.SPREADSHEET_ID = store.properties.SPREADSHEET_ID || 'local';

const authEmail = parsed.flags.user || process.env.EVPARK_USER || 'user@example.com';
const authName = parsed.flags.name || process.env.EVPARK_NAME || deriveName(authEmail);
const isAdmin = Boolean(parsed.flags.admin || process.env.EVPARK_ADMIN === '1');

const engine = createEngine({ store, authEmail, authName, isAdmin });

try {
  let result;
  switch (command) {
    case 'init':
      engine.initSheets();
      ensureSheet(store, 'config');
      saveStore(storePath, store);
      result = { ok: true, store: storePath };
      break;
    case 'seed':
      seedStore(store, { userEmail: authEmail, userName: authName });
      saveStore(storePath, store);
      result = { ok: true, store: storePath };
      break;
    case 'board':
      result = engine.getBoardData();
      break;
    case 'start-session':
      result = engine.startSession(requiredArg(parsed.args, 1, 'chargerId'));
      saveStore(storePath, store);
      break;
    case 'end-session':
      result = engine.endSession(requiredArg(parsed.args, 1, 'sessionId'));
      saveStore(storePath, store);
      break;
    case 'reserve':
      result = engine.createReservation(
        requiredArg(parsed.args, 1, 'chargerId'),
        requiredArg(parsed.args, 2, 'startTimeIso')
      );
      saveStore(storePath, store);
      break;
    case 'update-reservation':
      result = engine.updateReservation(
        requiredArg(parsed.args, 1, 'reservationId'),
        requiredArg(parsed.args, 2, 'chargerId'),
        requiredArg(parsed.args, 3, 'startTimeIso')
      );
      saveStore(storePath, store);
      break;
    case 'cancel-reservation':
      result = engine.cancelReservation(requiredArg(parsed.args, 1, 'reservationId'));
      saveStore(storePath, store);
      break;
    case 'check-in':
      result = engine.checkInReservation(requiredArg(parsed.args, 1, 'reservationId'));
      saveStore(storePath, store);
      break;
    case 'next-slot':
      result = engine.getNextAvailableSlot();
      break;
    case 'availability':
      result = engine.getAvailabilitySummary();
      break;
    case 'timeline':
      result = engine.getChargerTimeline(
        requiredArg(parsed.args, 1, 'chargerId'),
        parsed.args[2]
      );
      break;
    case 'calendar':
      result = engine.getCalendarAvailability(parsed.args[1], parsed.args[2]);
      break;
    case 'send-reminders':
      result = engine.sendReminders() || { ok: true };
      saveStore(storePath, store);
      break;
    case 'notify-owner':
      result = engine.notifyOwner(requiredArg(parsed.args, 1, 'chargerId'));
      saveStore(storePath, store);
      break;
    case 'post-message':
      result = engine.postChannelMessage(requiredArg(parsed.args, 1, 'message'));
      break;
    case 'force-end':
      result = engine.forceEnd(requiredArg(parsed.args, 1, 'chargerId'));
      saveStore(storePath, store);
      break;
    case 'reset-charger':
      result = engine.resetCharger(requiredArg(parsed.args, 1, 'chargerId'));
      saveStore(storePath, store);
      break;
    case 'config-set':
      result = setConfig(store, requiredArg(parsed.args, 1, 'key'), requiredArg(parsed.args, 2, 'value'));
      saveStore(storePath, store);
      break;
    case 'prop-set':
      store.properties[requiredArg(parsed.args, 1, 'key')] = requiredArg(parsed.args, 2, 'value');
      saveStore(storePath, store);
      result = { ok: true };
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  printResult(result, parsed.flags);
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}

function parseArgs(items) {
  const args = [];
  const flags = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.startsWith('--')) {
      const [key, value] = item.slice(2).split('=');
      if (value !== undefined) {
        flags[key] = value;
      } else {
        const next = items[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (item.startsWith('-') && item.length > 1) {
      flags[item.slice(1)] = true;
    } else {
      args.push(item);
    }
  }
  return { args, flags };
}

function requiredArg(args, index, label) {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function printResult(result, flags) {
  if (flags.raw) {
    console.log(result);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function setConfig(store, key, value) {
  ensureSheet(store, 'config');
  const sheet = store.sheets.config;
  sheet.headers = sheet.headers.length ? sheet.headers : ['key', 'value'];
  const rows = sheet.rows || [];
  const existing = rows.findIndex((row) => String(row[0]) === String(key));
  if (existing >= 0) {
    rows[existing][1] = value;
  } else {
    rows.push([key, value]);
  }
  sheet.rows = rows;
  return { ok: true };
}

function deriveName(email) {
  const local = String(email || '').split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) {
    return '';
  }
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function printHelp() {
  console.log(`EV Charging CLI\n\nUsage:\n  node cli/index.js <command> [args] [--store path] [--user email] [--name name] [--admin]\n\nCommands:\n  init\n  seed\n  board\n  start-session <chargerId>\n  end-session <sessionId>\n  reserve <chargerId> <startTimeIso>\n  update-reservation <reservationId> <chargerId> <startTimeIso>\n  cancel-reservation <reservationId>\n  check-in <reservationId>\n  next-slot\n  availability\n  timeline <chargerId> [dateIso]\n  calendar [startDateIso] [days]\n  send-reminders\n  notify-owner <chargerId>\n  post-message <message>\n  force-end <chargerId>\n  reset-charger <chargerId>\n  config-set <key> <value>\n  prop-set <key> <value>\n\nFlags:\n  --store <path>   Path to JSON store (default: data/store.json)\n  --user <email>   Acting user email (default: user@example.com)\n  --name <name>    Acting user name (optional)\n  --admin          Admin mode (bypass admin checks)\n  --raw            Print raw output without JSON formatting\n\nExamples:\n  node cli/index.js seed\n  node cli/index.js board --user alice@example.com\n  node cli/index.js reserve 1 2026-02-08T09:00:00-08:00\n`);
}
