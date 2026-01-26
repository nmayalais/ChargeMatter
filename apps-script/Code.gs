var APP_DEFAULTS = {
  allowedDomain: 'company.com',
  overdueRepeatMinutes: 15,
  reservationAdvanceDays: 7,
  reservationMaxUpcoming: 3,
  reservationMaxPerDay: 2,
  reservationGapMinutes: 1,
  reservationRoundingMinutes: 15,
  reservationCheckinEarlyMinutes: 5,
  reservationLateGraceMinutes: 10,
  reservationOpenHour: 6,
  reservationOpenMinute: 0
};

var SHEETS = {
  chargers: 'chargers',
  sessions: 'sessions',
  reservations: 'reservations',
  config: 'config'
};

var CHARGERS_HEADERS = [
  'charger_id',
  'name',
  'max_minutes',
  'slot_starts',
  'active_session_id'
];

var SESSIONS_HEADERS = [
  'session_id',
  'charger_id',
  'user_id',
  'user_name',
  'start_time',
  'end_time',
  'status',
  'active',
  'overdue',
  'complete',
  'reminder_10_sent',
  'reminder_5_sent',
  'reminder_0_sent',
  'overdue_last_sent_at',
  'ended_at'
];

var RESERVATIONS_HEADERS = [
  'reservation_id',
  'charger_id',
  'user_id',
  'user_name',
  'start_time',
  'end_time',
  'status',
  'checked_in_at',
  'no_show_at',
  'reminder_5_before_sent',
  'reminder_5_after_sent',
  'created_at',
  'updated_at',
  'canceled_at'
];

var CONFIG_HEADERS = ['key', 'value'];

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var template = HtmlService.createTemplateFromFile('index');
  template.userEmail = auth.email;
  template.userName = auth.name;
  template.isAdmin = auth.isAdmin;
  return template.evaluate().setTitle('ChargingMatters');
}

function getBoardData() {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var now = new Date();
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var board = buildBoard_(now, reservationsData);
  var userReservations = getUpcomingReservationsForUser_(reservationsData.rows, auth.email, now);
  return {
    user: auth,
    chargers: board.chargers,
    reservations: userReservations,
    serverTime: board.serverTime,
    timezone: Session.getScriptTimeZone(),
    config: {
      overdueRepeatMinutes: board.overdueRepeatMinutes,
      reservationAdvanceDays: board.reservationAdvanceDays,
      reservationMaxUpcoming: board.reservationMaxUpcoming,
      reservationMaxPerDay: board.reservationMaxPerDay,
      reservationGapMinutes: board.reservationGapMinutes,
      reservationRoundingMinutes: board.reservationRoundingMinutes,
      reservationCheckinEarlyMinutes: board.reservationCheckinEarlyMinutes,
      reservationLateGraceMinutes: board.reservationLateGraceMinutes,
      reservationOpenHour: board.reservationOpenHour,
      reservationOpenMinute: board.reservationOpenMinute
    }
  };
}

function startSession(chargerId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var charger = findById_(chargersData.rows, 'charger_id', chargerId);
    if (!charger) {
      throw new Error('Charger not found.');
    }
    var maxMinutes = Number(charger.max_minutes) || 0;
    if (maxMinutes <= 0) {
      throw new Error('Charger max minutes is not configured.');
    }
    var now = new Date();
    var config = getReservationConfig_(getConfig_());
    var slot = findSlotForTime_(charger, now);
    if (!slot) {
      throw new Error('Charging is only available during scheduled blocks.');
    }
    var openAt = addMinutes_(slot.startTime, config.lateGraceMinutes);
    var slotReservation = findReservationForSlot_(reservationsData.rows, chargerId, slot.startTime);
    if (slotReservation && (isReservationCanceled_(slotReservation) || isReservationNoShow_(slotReservation))) {
      slotReservation = null;
    }
    var isReservedByUser =
      slotReservation && String(slotReservation.user_id || '').toLowerCase() === String(auth.email || '').toLowerCase();
    if (now.getTime() < openAt.getTime()) {
      if (!slotReservation) {
        throw new Error('This slot opens at ' + formatTime_(openAt) + ' for walk-up charging.');
      }
      if (!isReservedByUser) {
        var reservedBy = formatUserDisplay_(slotReservation.user_name, slotReservation.user_id);
        throw new Error('Charger is reserved by ' + reservedBy + ' until ' + formatTime_(openAt) + '.');
      }
    }
    if (charger.active_session_id) {
      var existing = findById_(sessionsData.rows, 'session_id', charger.active_session_id);
      if (existing && !isComplete_(existing)) {
        throw new Error('Charger is already in use.');
      }
      updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
        active_session_id: ''
      });
    }
    var endTime = slot.endTime;
    var sessionId = Utilities.getUuid();
    var sessionRow = [
      sessionId,
      chargerId,
      auth.email,
      auth.name,
      now,
      endTime,
      'active',
      true,
      false,
      false,
      false,
      false,
      false,
      '',
      ''
    ];
    sessionsData.sheet.appendRow(sessionRow);
    updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
      active_session_id: sessionId
    });
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function createReservation(chargerId, startTimeIso) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var now = new Date();
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var charger = findById_(chargersData.rows, 'charger_id', chargerId);
    if (!charger) {
      throw new Error('Charger not found.');
    }
    var startTime = toDate_(startTimeIso);
    if (!startTime) {
      throw new Error('Invalid reservation start time.');
    }
    var maxMinutes = Number(charger.max_minutes) || 0;
    if (maxMinutes <= 0) {
      throw new Error('Charger max minutes is not configured.');
    }
    var endTime = addMinutes_(startTime, maxMinutes);
    validateReservation_({
      charger: charger,
      startTime: startTime,
      endTime: endTime,
      auth: auth,
      now: now,
      reservations: reservationsData.rows,
      excludeReservationId: ''
    });
    var reservationId = Utilities.getUuid();
    var row = [
      reservationId,
      chargerId,
      auth.email,
      auth.name,
      startTime,
      endTime,
      'active',
      '',
      '',
      now,
      now,
      ''
    ];
    reservationsData.sheet.appendRow(row);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function updateReservation(reservationId, chargerId, startTimeIso) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var now = new Date();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation)) {
      throw new Error('Reservation not found.');
    }
    if (!auth.isAdmin && String(reservation.user_id).toLowerCase() !== auth.email.toLowerCase()) {
      throw new Error('You can only update your own reservations.');
    }
    var charger = findById_(chargersData.rows, 'charger_id', chargerId);
    if (!charger) {
      throw new Error('Charger not found.');
    }
    var startTime = toDate_(startTimeIso);
    if (!startTime) {
      throw new Error('Invalid reservation start time.');
    }
    if (startTime.getTime() < now.getTime()) {
      throw new Error('Reservation time must be in the future.');
    }
    var maxMinutes = Number(charger.max_minutes) || 0;
    if (maxMinutes <= 0) {
      throw new Error('Charger max minutes is not configured.');
    }
    var endTime = addMinutes_(startTime, maxMinutes);
    validateReservation_({
      charger: charger,
      startTime: startTime,
      endTime: endTime,
      auth: auth,
      now: now,
      reservations: reservationsData.rows,
      excludeReservationId: reservationId
    });
    updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
      charger_id: chargerId,
      start_time: startTime,
      end_time: endTime,
      status: 'active',
      updated_at: now
    });
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function cancelReservation(reservationId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation)) {
      return getBoardData();
    }
    if (!auth.isAdmin && String(reservation.user_id).toLowerCase() !== auth.email.toLowerCase()) {
      throw new Error('You can only cancel your own reservations.');
    }
    updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
      status: 'canceled',
      canceled_at: new Date(),
      updated_at: new Date()
    });
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function getNextAvailableSlot() {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var now = new Date();
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var slot = getNextAvailableSlot_(now, chargersData.rows, reservationsData.rows);
  if (!slot) {
    throw new Error('No available slots found within the next week.');
  }
  return {
    chargerId: String(slot.charger_id),
    startTime: toIso_(slot.start_time)
  };
}

function getAvailabilitySummary(startDateIso, days) {
  initSheets_();
  requireAuthorizedUser_();
  var now = new Date();
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var slots = getNextAvailableSlots_(now, chargersData.rows, reservationsData.rows, 1, 10);
  return slots.map(function(slot) {
    return {
      chargerId: String(slot.charger_id),
      startTime: toIso_(slot.start_time),
      endTime: toIso_(slot.end_time)
    };
  });
}

function getChargerTimeline(chargerId, dateIso) {
  initSheets_();
  requireAuthorizedUser_();
  var day = dateIso ? toDate_(dateIso) : new Date();
  if (!day) {
    day = new Date();
  }
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var charger = findById_(chargersData.rows, 'charger_id', chargerId);
  if (!charger) {
    throw new Error('Charger not found.');
  }
  var timeline = buildTimelineForCharger_(charger, day, reservationsData.rows);
  return timeline;
}

function getCalendarAvailability(startDateIso, days) {
  initSheets_();
  requireAuthorizedUser_();
  var start = startDateIso ? toDate_(startDateIso) : new Date();
  if (!start) {
    start = new Date();
  }
  var rangeDays = Math.max(1, Math.min(7, parseInt(days, 10) || 7));
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var calendar = [];
  for (var i = 0; i < rangeDays; i++) {
    var day = addMinutes_(startOfDay_(start), i * 1440);
    calendar.push(buildCalendarDay_(day, chargersData.rows, reservationsData.rows));
  }
  return calendar;
}

function checkInReservation(reservationId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var now = new Date();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation)) {
      throw new Error('Reservation not found.');
    }
    if (!auth.isAdmin && String(reservation.user_id).toLowerCase() !== auth.email.toLowerCase()) {
      throw new Error('You can only check in to your own reservation.');
    }
    var config = getReservationConfig_(getConfig_());
    var startTime = toDate_(reservation.start_time);
    if (!startTime) {
      throw new Error('Invalid reservation start time.');
    }
    var earliest = new Date(startTime.getTime() - config.checkinEarlyMinutes * 60000);
    var latest = new Date(startTime.getTime() + config.lateGraceMinutes * 60000);
    if (now.getTime() < earliest.getTime()) {
      throw new Error('Check-in is available within ' + config.checkinEarlyMinutes + ' minutes of start time.');
    }
    if (now.getTime() > latest.getTime()) {
      throw new Error('This reservation is too late to check in.');
    }
    if (!reservation.checked_in_at) {
      updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
        checked_in_at: now,
        status: 'checked_in',
        updated_at: now
      });
    }
    startSession(reservation.charger_id);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function endSession(sessionId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    endSessionInternal_(sessionId, auth, false);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function notifyOwner(chargerId) {
  initSheets_();
  requireAuthorizedUser_();
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
  var charger = findById_(chargersData.rows, 'charger_id', chargerId);
  if (!charger || !charger.active_session_id) {
    throw new Error('No active session for this charger.');
  }
  var session = findById_(sessionsData.rows, 'session_id', charger.active_session_id);
  if (!session) {
    throw new Error('Session not found.');
  }
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  notifyUser_(session, charger, 'ChargingMatters: Someone is waiting for ' + chargerName + '. Please check your car.');
  return getBoardData();
}

function forceEnd(chargerId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    assertAdmin_(auth);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var charger = findById_(chargersData.rows, 'charger_id', chargerId);
    if (!charger || !charger.active_session_id) {
      return getBoardData();
    }
    endSessionInternal_(charger.active_session_id, auth, true);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function resetCharger(chargerId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    assertAdmin_(auth);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var charger = findById_(chargersData.rows, 'charger_id', chargerId);
    if (!charger) {
      throw new Error('Charger not found.');
    }
    if (charger.active_session_id) {
      var session = findById_(sessionsData.rows, 'session_id', charger.active_session_id);
      if (session && !isComplete_(session)) {
        updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, {
          status: 'complete',
          active: false,
          overdue: false,
          complete: true,
          ended_at: new Date()
        });
      }
    }
    updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
      active_session_id: ''
    });
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function sendReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return;
  }
  try {
    initSheets_();
    var now = new Date();
    markNoShowReservations_(now);
    var config = getConfig_();
    var reservationConfig = getReservationConfig_(config);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var chargersById = {};
    chargersData.rows.forEach(function(charger) {
      chargersById[String(charger.charger_id)] = charger;
    });
    sessionsData.rows.forEach(function(session) {
      try {
        if (!session.session_id || isComplete_(session)) {
          return;
        }
        var endTime = toDate_(session.end_time);
        if (!endTime) {
          return;
        }
        var charger = chargersById[String(session.charger_id)] || {};
        var minutesToEnd = Math.floor((endTime.getTime() - now.getTime()) / 60000);
        var isOverdue = now.getTime() >= endTime.getTime();
        var updates = {};
        if (isOverdue && session.status !== 'overdue') {
          updates.status = 'overdue';
          updates.active = true;
          updates.overdue = true;
          updates.complete = false;
        }
        if (!isTrue_(session.reminder_5_sent) && minutesToEnd <= 5 && minutesToEnd > 0) {
          if (notifyUser_(session, charger, buildReminderText_('tminus5', session, charger, endTime, now))) {
            updates.reminder_5_sent = true;
          }
        }
        if (!isTrue_(session.reminder_0_sent) && minutesToEnd <= 0) {
          if (notifyUser_(session, charger, buildReminderText_('expire', session, charger, endTime, now))) {
            updates.reminder_0_sent = true;
            updates.status = 'overdue';
            updates.active = true;
            updates.overdue = true;
            updates.complete = false;
            updates.overdue_last_sent_at = now;
          }
        }
        if (Object.keys(updates).length > 0) {
          updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, updates);
        }
      } catch (err) {
        logError_('sendReminders session failed', err, {
          sessionId: session.session_id,
          chargerId: session.charger_id
        });
      }
    });
    reservationsData.rows.forEach(function(reservation) {
      try {
        if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
          return;
        }
        if (reservation.checked_in_at) {
          return;
        }
        var startTime = toDate_(reservation.start_time);
        if (!startTime) {
          return;
        }
        var charger = chargersById[String(reservation.charger_id)] || {};
        var minutesToStart = Math.floor((startTime.getTime() - now.getTime()) / 60000);
        var minutesSinceStart = Math.floor((now.getTime() - startTime.getTime()) / 60000);
        var resUpdates = {};
        if (!isTrue_(reservation.reminder_5_before_sent) && minutesToStart <= 5 && minutesToStart > 0) {
          if (notifyUser_(reservation, charger, buildReservationReminderText_('upcoming', reservation, charger, startTime, reservationConfig))) {
            resUpdates.reminder_5_before_sent = true;
          }
        }
        if (!isTrue_(reservation.reminder_5_after_sent) &&
            minutesSinceStart >= 5 &&
            minutesSinceStart < reservationConfig.lateGraceMinutes) {
          if (notifyUser_(reservation, charger, buildReservationReminderText_('late', reservation, charger, startTime, reservationConfig))) {
            resUpdates.reminder_5_after_sent = true;
          }
        }
        if (Object.keys(resUpdates).length > 0) {
          updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, resUpdates);
        }
      } catch (err) {
        logError_('sendReminders reservation failed', err, {
          reservationId: reservation.reservation_id,
          chargerId: reservation.charger_id
        });
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function initSheets() {
  initSheets_();
}

function endSessionInternal_(sessionId, auth, adminOverride) {
  var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var session = findById_(sessionsData.rows, 'session_id', sessionId);
  if (!session) {
    throw new Error('Session not found.');
  }
  if (!adminOverride && !auth.isAdmin && String(session.user_id).toLowerCase() !== auth.email.toLowerCase()) {
    throw new Error('You can only end your own session.');
  }
  updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, {
    status: 'complete',
    active: false,
    overdue: false,
    complete: true,
    ended_at: new Date()
  });
  var charger = findById_(chargersData.rows, 'charger_id', session.charger_id);
  if (charger && String(charger.active_session_id) === String(sessionId)) {
    updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
      active_session_id: ''
    });
  }
}

function buildBoard_(now, reservationsData) {
  var config = getConfig_();
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
  var reservations = reservationsData ? reservationsData.rows : [];
  var reservationConfig = getReservationConfig_(config);
  var sessionsById = {};
  sessionsData.rows.forEach(function(session) {
    if (session.session_id) {
      sessionsById[String(session.session_id)] = session;
    }
  });
  var reservationsByCharger = groupReservationsByCharger_(reservations, now);
  var chargersView = chargersData.rows
    .filter(function(charger) {
      return charger.charger_id;
    })
    .map(function(charger) {
      var session = null;
      if (charger.active_session_id) {
        session = sessionsById[String(charger.active_session_id)];
        if (!session || isComplete_(session)) {
          updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
            active_session_id: ''
          });
          session = null;
        }
      }
      var statusKey = 'free';
      var statusLabel = 'Free';
      var activeReservation = reservationsByCharger.active[String(charger.charger_id || '')] || null;
      var nextReservation = reservationsByCharger.next[String(charger.charger_id || '')] || null;
      if (session) {
        var endTime = toDate_(session.end_time);
        var isOverdue = endTime && now.getTime() >= endTime.getTime();
        if (isOverdue && session.status !== 'overdue') {
          updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, {
            status: 'overdue',
            active: true,
            overdue: true,
            complete: false
          });
        }
        if (!isOverdue && session.status !== 'active') {
          updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, {
            status: 'active',
            active: true,
            overdue: false,
            complete: false
          });
        }
        statusKey = isOverdue ? 'overdue' : 'in_use';
        statusLabel = isOverdue ? 'Overdue' : 'In use';
      } else if (activeReservation) {
        statusKey = 'reserved';
        statusLabel = 'Reserved';
      }
      return {
        id: String(charger.charger_id || ''),
        name: charger.name || ('Charger ' + charger.charger_id),
        maxMinutes: Number(charger.max_minutes) || 0,
        status: statusLabel,
        statusKey: statusKey,
        session: session ? serializeSession_(session) : null,
        reservation: activeReservation ? serializeReservation_(activeReservation) : null,
        nextReservation: nextReservation ? serializeReservation_(nextReservation) : null
      };
    });
  return {
    chargers: chargersView,
    serverTime: now.toISOString(),
    overdueRepeatMinutes: Number(config.overdue_repeat_minutes) || APP_DEFAULTS.overdueRepeatMinutes,
    reservationAdvanceDays: reservationConfig.advanceDays,
    reservationMaxUpcoming: reservationConfig.maxUpcoming,
    reservationMaxPerDay: reservationConfig.maxPerDay,
    reservationGapMinutes: reservationConfig.gapMinutes,
    reservationRoundingMinutes: reservationConfig.roundingMinutes,
    reservationCheckinEarlyMinutes: reservationConfig.checkinEarlyMinutes,
    reservationLateGraceMinutes: reservationConfig.lateGraceMinutes,
    reservationOpenHour: reservationConfig.openHour,
    reservationOpenMinute: reservationConfig.openMinute
  };
}

function getSheetData_(name, expectedHeaders) {
  var sheet = getSheet_(name);
  var headerMap = ensureHeaders_(sheet, expectedHeaders);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) {
    return { sheet: sheet, headerMap: headerMap, rows: [] };
  }
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var rows = values.map(function(row, index) {
    var obj = { _row: index + 2 };
    expectedHeaders.forEach(function(header) {
      var col = headerMap[header];
      obj[header] = col ? row[col - 1] : '';
    });
    return obj;
  });
  return { sheet: sheet, headerMap: headerMap, rows: rows };
}

function ensureHeaders_(sheet, expectedHeaders) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    lastColumn = expectedHeaders.length;
  }
  var headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var headerMap = {};
  headerRow.forEach(function(header, index) {
    if (header) {
      headerMap[header] = index + 1;
    }
  });
  var updated = false;
  expectedHeaders.forEach(function(header) {
    if (!headerMap[header]) {
      headerRow.push(header);
      headerMap[header] = headerRow.length;
      updated = true;
    }
  });
  if (updated) {
    sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  }
  return headerMap;
}

function updateRow_(sheet, headerMap, rowIndex, updates) {
  Object.keys(updates).forEach(function(key) {
    var column = headerMap[key];
    if (column) {
      sheet.getRange(rowIndex, column).setValue(updates[key]);
    }
  });
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function initSheets_() {
  ensureHeaders_(getSheet_(SHEETS.chargers), CHARGERS_HEADERS);
  ensureHeaders_(getSheet_(SHEETS.sessions), SESSIONS_HEADERS);
  ensureHeaders_(getSheet_(SHEETS.reservations), RESERVATIONS_HEADERS);
  ensureHeaders_(getSheet_(SHEETS.config), CONFIG_HEADERS);
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('Missing SPREADSHEET_ID in Script Properties.');
  }
  return SpreadsheetApp.openById(id);
}

function getConfig_() {
  var sheet = getSheet_(SHEETS.config);
  ensureHeaders_(sheet, CONFIG_HEADERS);
  var data = getSheetData_(SHEETS.config, CONFIG_HEADERS);
  var config = {};
  data.rows.forEach(function(row) {
    if (row.key) {
      config[String(row.key).trim()] = row.value;
    }
  });
  var props = PropertiesService.getScriptProperties();
  config.allowed_domain = config.allowed_domain || props.getProperty('ALLOWED_DOMAIN') || APP_DEFAULTS.allowedDomain;
  config.slack_webhook_url = config.slack_webhook_url || props.getProperty('SLACK_WEBHOOK_URL') || '';
  config.slack_webhook_channel = config.slack_webhook_channel || props.getProperty('SLACK_WEBHOOK_CHANNEL') || '';
  config.slack_bot_token = config.slack_bot_token || props.getProperty('SLACK_BOT_TOKEN') || '';
  config.admin_emails = config.admin_emails || props.getProperty('ADMIN_EMAILS') || '';
  config.overdue_repeat_minutes = config.overdue_repeat_minutes || props.getProperty('OVERDUE_REPEAT_MINUTES') || APP_DEFAULTS.overdueRepeatMinutes;
  config.reservation_advance_days =
    config.reservation_advance_days || props.getProperty('RESERVATION_ADVANCE_DAYS') || APP_DEFAULTS.reservationAdvanceDays;
  config.reservation_max_upcoming =
    config.reservation_max_upcoming || props.getProperty('RESERVATION_MAX_UPCOMING') || APP_DEFAULTS.reservationMaxUpcoming;
  config.reservation_max_per_day =
    config.reservation_max_per_day || props.getProperty('RESERVATION_MAX_PER_DAY') || APP_DEFAULTS.reservationMaxPerDay;
  config.reservation_gap_minutes =
    config.reservation_gap_minutes || props.getProperty('RESERVATION_GAP_MINUTES') || APP_DEFAULTS.reservationGapMinutes;
  config.reservation_rounding_minutes =
    config.reservation_rounding_minutes ||
    props.getProperty('RESERVATION_ROUNDING_MINUTES') ||
    APP_DEFAULTS.reservationRoundingMinutes;
  config.reservation_checkin_early_minutes =
    config.reservation_checkin_early_minutes ||
    props.getProperty('RESERVATION_CHECKIN_EARLY_MINUTES') ||
    APP_DEFAULTS.reservationCheckinEarlyMinutes;
  config.reservation_late_grace_minutes =
    config.reservation_late_grace_minutes ||
    props.getProperty('RESERVATION_LATE_GRACE_MINUTES') ||
    APP_DEFAULTS.reservationLateGraceMinutes;
  config.reservation_open_hour =
    config.reservation_open_hour ||
    props.getProperty('RESERVATION_OPEN_HOUR') ||
    APP_DEFAULTS.reservationOpenHour;
  config.reservation_open_minute =
    config.reservation_open_minute ||
    props.getProperty('RESERVATION_OPEN_MINUTE') ||
    APP_DEFAULTS.reservationOpenMinute;
  return config;
}

function requireAuthorizedUser_() {
  var email = getActiveUserEmail_();
  var config = getConfig_();
  var allowedDomain = String(config.allowed_domain || APP_DEFAULTS.allowedDomain).toLowerCase();
  if (!email || email.toLowerCase().indexOf('@' + allowedDomain) === -1) {
    throw new Error('Access denied for this domain.');
  }
  var name = nameFromEmail_(email);
  var adminEmails = getAdminEmails_(config);
  return {
    email: email,
    name: name,
    isAdmin: adminEmails.indexOf(email.toLowerCase()) !== -1
  };
}

function getActiveUserEmail_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Unable to determine active user. Check deployment settings.');
  }
  return email;
}

function assertAdmin_(auth) {
  if (!auth.isAdmin) {
    throw new Error('Admin access required.');
  }
}

function getAdminEmails_(config) {
  var list = String(config.admin_emails || '')
    .split(',')
    .map(function(item) {
      return item.trim().toLowerCase();
    })
    .filter(function(item) {
      return item;
    });
  return list;
}

function nameFromEmail_(email) {
  var local = String(email).split('@')[0];
  var parts = local.split(/[._-]+/).filter(Boolean);
  return parts
    .map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function addMinutes_(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function toDate_(value) {
  if (!value) {
    return null;
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value;
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isComplete_(session) {
  return isTrue_(session.complete) || String(session.status).toLowerCase() === 'complete';
}

function isTrue_(value) {
  return value === true || value === 'TRUE' || value === 'true' || value === 1;
}

function findById_(rows, key, idValue) {
  var idString = String(idValue);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]) === idString) {
      return rows[i];
    }
  }
  return null;
}

function serializeSession_(session) {
  return {
    sessionId: String(session.session_id || ''),
    chargerId: String(session.charger_id || ''),
    userEmail: String(session.user_id || ''),
    userName: String(session.user_name || ''),
    startTime: toIso_(session.start_time),
    endTime: toIso_(session.end_time),
    status: String(session.status || ''),
    overdue: isTrue_(session.overdue)
  };
}

function serializeReservation_(reservation) {
  return {
    reservationId: String(reservation.reservation_id || ''),
    chargerId: String(reservation.charger_id || ''),
    userEmail: String(reservation.user_id || ''),
    userName: String(reservation.user_name || ''),
    startTime: toIso_(reservation.start_time),
    endTime: toIso_(reservation.end_time),
    status: String(reservation.status || ''),
    checkedInAt: toIso_(reservation.checked_in_at),
    noShowAt: toIso_(reservation.no_show_at)
  };
}

function toIso_(value) {
  var date = toDate_(value);
  return date ? date.toISOString() : '';
}

function getReservationConfig_(config) {
  var advanceDays = parseInt(config.reservation_advance_days, 10);
  var maxUpcoming = parseInt(config.reservation_max_upcoming, 10);
  var maxPerDay = parseInt(config.reservation_max_per_day, 10);
  var gapMinutes = parseInt(config.reservation_gap_minutes, 10);
  var roundingMinutes = parseInt(config.reservation_rounding_minutes, 10);
  var checkinEarlyMinutes = parseInt(config.reservation_checkin_early_minutes, 10);
  var lateGraceMinutes = parseInt(config.reservation_late_grace_minutes, 10);
  var openHour = parseInt(config.reservation_open_hour, 10);
  var openMinute = parseInt(config.reservation_open_minute, 10);
  return {
    advanceDays: isNaN(advanceDays) ? APP_DEFAULTS.reservationAdvanceDays : advanceDays,
    maxUpcoming: isNaN(maxUpcoming) ? APP_DEFAULTS.reservationMaxUpcoming : maxUpcoming,
    maxPerDay: isNaN(maxPerDay) ? APP_DEFAULTS.reservationMaxPerDay : maxPerDay,
    gapMinutes: isNaN(gapMinutes) ? APP_DEFAULTS.reservationGapMinutes : gapMinutes,
    roundingMinutes: isNaN(roundingMinutes) ? APP_DEFAULTS.reservationRoundingMinutes : roundingMinutes,
    checkinEarlyMinutes: isNaN(checkinEarlyMinutes) ? APP_DEFAULTS.reservationCheckinEarlyMinutes : checkinEarlyMinutes,
    lateGraceMinutes: isNaN(lateGraceMinutes) ? APP_DEFAULTS.reservationLateGraceMinutes : lateGraceMinutes,
    openHour: isNaN(openHour) ? APP_DEFAULTS.reservationOpenHour : openHour,
    openMinute: isNaN(openMinute) ? APP_DEFAULTS.reservationOpenMinute : openMinute
  };
}

function getUpcomingReservationsForUser_(reservations, email, now) {
  var userEmail = String(email || '').toLowerCase();
  return reservations
    .filter(function(reservation) {
      if (!reservation.reservation_id || isReservationCanceled_(reservation)) {
        return false;
      }
      var endTime = toDate_(reservation.end_time);
      if (!endTime || endTime.getTime() < now.getTime()) {
        return false;
      }
      return String(reservation.user_id || '').toLowerCase() === userEmail;
    })
    .sort(function(a, b) {
      var aTime = toDate_(a.start_time);
      var bTime = toDate_(b.start_time);
      return (aTime ? aTime.getTime() : 0) - (bTime ? bTime.getTime() : 0);
    })
    .map(serializeReservation_);
}

function groupReservationsByCharger_(reservations, now) {
  var active = {};
  var next = {};
  reservations.forEach(function(reservation) {
    if (!reservation.reservation_id || isReservationCanceled_(reservation)) {
      return;
    }
    var startTime = toDate_(reservation.start_time);
    var endTime = toDate_(reservation.end_time);
    if (!startTime || !endTime) {
      return;
    }
    var chargerId = String(reservation.charger_id || '');
    if (now.getTime() >= startTime.getTime() && now.getTime() < endTime.getTime()) {
      active[chargerId] = active[chargerId] || reservation;
    } else if (startTime.getTime() > now.getTime()) {
      if (!next[chargerId]) {
        next[chargerId] = reservation;
      } else {
        var existing = toDate_(next[chargerId].start_time);
        if (existing && startTime.getTime() < existing.getTime()) {
          next[chargerId] = reservation;
        }
      }
    }
  });
  return { active: active, next: next };
}

function isReservationCanceled_(reservation) {
  return String(reservation.status || '').toLowerCase() === 'canceled' || reservation.canceled_at;
}

function isReservationNoShow_(reservation) {
  return String(reservation.status || '').toLowerCase() === 'no_show' || reservation.no_show_at;
}

function validateReservation_(params) {
  var config = getReservationConfig_(getConfig_());
  var startTime = params.startTime;
  var endTime = params.endTime;
  var now = params.now;
  var auth = params.auth;
  var reservations = params.reservations || [];
  var excludeId = String(params.excludeReservationId || '');
  var userEmail = String(auth.email || '').toLowerCase();

  if (startTime.getTime() < now.getTime()) {
    throw new Error('Reservation time must be in the future.');
  }
  var openTime = getReservationOpenTime_(now, config);
  if (now.getTime() < openTime.getTime()) {
    throw new Error('Booking opens at ' + formatTime_(openTime) + ' for same-day slots.');
  }
  if (!isSameDay_(startTime, now)) {
    throw new Error('Reservations can only be made for today.');
  }
  if (!isSlotStart_(params.charger, startTime)) {
    throw new Error('Reservations must start at a scheduled slot time.');
  }

  var upcoming = reservations.filter(function(reservation) {
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      return false;
    }
    if (String(reservation.reservation_id) === excludeId) {
      return false;
    }
    var end = toDate_(reservation.end_time);
    if (!end || end.getTime() < now.getTime()) {
      return false;
    }
    return String(reservation.user_id || '').toLowerCase() === userEmail;
  });

  if (upcoming.length >= config.maxUpcoming) {
    throw new Error('You can only have ' + config.maxUpcoming + ' upcoming reservations.');
  }

  var dayKey = dayKey_(startTime);
  var perDayCount = upcoming.filter(function(reservation) {
    var resStart = toDate_(reservation.start_time);
    return resStart && dayKey_(resStart) === dayKey;
  }).length;
  if (perDayCount >= config.maxPerDay) {
    throw new Error('You can only have ' + config.maxPerDay + ' reservations per day.');
  }

  var gapMs = config.gapMinutes * 60000;
  reservations.forEach(function(reservation) {
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      return;
    }
    if (String(reservation.reservation_id) === excludeId) {
      return;
    }
    if (String(reservation.charger_id) !== String(params.charger.charger_id)) {
      return;
    }
    var existingStart = toDate_(reservation.start_time);
    var existingEnd = toDate_(reservation.end_time);
    if (!existingStart || !existingEnd) {
      return;
    }
    var newStartMs = startTime.getTime();
    var newEndMs = endTime.getTime();
    var existingStartMs = existingStart.getTime();
    var existingEndMs = existingEnd.getTime();
    var conflict = newStartMs < existingEndMs + gapMs && newEndMs > existingStartMs - gapMs;
    if (conflict) {
      throw new Error('That time slot conflicts with another reservation on this charger.');
    }
  });
}

function dayKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isSameDay_(first, second) {
  return dayKey_(first) === dayKey_(second);
}

function parseSlotStarts_(value) {
  if (!value) {
    return [];
  }
  var raw = Array.isArray(value) ? value.join(',') : String(value);
  var starts = raw
    .split(/[,;\n]/)
    .map(function(item) {
      return String(item || '').trim();
    })
    .filter(function(item) {
      return item;
    })
    .map(function(item) {
      var parts = item.split(':');
      if (parts.length < 2) {
        return null;
      }
      var hours = parseInt(parts[0], 10);
      var minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
      }
      return hours * 60 + minutes;
    })
    .filter(function(value) {
      return value !== null;
    });
  starts.sort(function(a, b) {
    return a - b;
  });
  return starts.filter(function(value, index) {
    return starts.indexOf(value) === index;
  });
}

function buildSlotsForDay_(charger, day) {
  var maxMinutes = Number(charger.max_minutes) || 0;
  if (maxMinutes <= 0) {
    return [];
  }
  var slotStarts = parseSlotStarts_(charger.slot_starts);
  if (!slotStarts.length) {
    return [];
  }
  var base = startOfDay_(day);
  return slotStarts.map(function(minutes) {
    var start = addMinutes_(base, minutes);
    return {
      start_time: start,
      end_time: addMinutes_(start, maxMinutes)
    };
  });
}

function findSlotForTime_(charger, time) {
  var day = startOfDay_(time);
  var slots = buildSlotsForDay_(charger, day);
  for (var i = 0; i < slots.length; i++) {
    if (time.getTime() >= slots[i].start_time.getTime() && time.getTime() < slots[i].end_time.getTime()) {
      return {
        startTime: slots[i].start_time,
        endTime: slots[i].end_time
      };
    }
  }
  return null;
}

function isSlotStart_(charger, startTime) {
  var slotStarts = parseSlotStarts_(charger.slot_starts);
  var minutes = startTime.getHours() * 60 + startTime.getMinutes();
  return slotStarts.indexOf(minutes) !== -1;
}

function findReservationForSlot_(reservations, chargerId, slotStart) {
  var slotStartMs = slotStart.getTime();
  for (var i = 0; i < reservations.length; i++) {
    var reservation = reservations[i];
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      continue;
    }
    if (String(reservation.charger_id) !== String(chargerId)) {
      continue;
    }
    var resStart = toDate_(reservation.start_time);
    if (resStart && resStart.getTime() === slotStartMs) {
      return reservation;
    }
  }
  return null;
}

function getReservationOpenTime_(now, config) {
  var openHour = Number(config.openHour);
  var openMinute = Number(config.openMinute);
  if (isNaN(openHour)) {
    openHour = APP_DEFAULTS.reservationOpenHour;
  }
  if (isNaN(openMinute)) {
    openMinute = APP_DEFAULTS.reservationOpenMinute;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), openHour, openMinute, 0);
}

function findBlockingReservationForSession_(reservations, chargerId, startTime, endTime, userEmail) {
  var user = String(userEmail || '').toLowerCase();
  for (var i = 0; i < reservations.length; i++) {
    var reservation = reservations[i];
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      continue;
    }
    if (String(reservation.charger_id) !== String(chargerId)) {
      continue;
    }
    var resStart = toDate_(reservation.start_time);
    var resEnd = toDate_(reservation.end_time);
    if (!resStart || !resEnd) {
      continue;
    }
    var overlaps = resStart.getTime() < endTime.getTime() && resEnd.getTime() > startTime.getTime();
    if (!overlaps) {
      continue;
    }
    var resUser = String(reservation.user_id || '').toLowerCase();
    if (resUser !== user) {
      return reservation;
    }
  }
  return null;
}

function roundUpToIncrement_(date, minutes) {
  var incrementMs = Math.max(1, minutes) * 60000;
  var time = date.getTime();
  var rounded = Math.ceil(time / incrementMs) * incrementMs;
  return new Date(rounded);
}

function getNextAvailableSlot_(now, chargers, reservations) {
  var slots = getNextAvailableSlots_(now, chargers, reservations, 1, 1);
  return slots.length ? slots[0] : null;
}

function getNextAvailableSlots_(now, chargers, reservations, rangeDays, limit) {
  var config = getReservationConfig_(getConfig_());
  var openTime = getReservationOpenTime_(now, config);
  if (now.getTime() < openTime.getTime()) {
    return [];
  }
  var slots = [];
  var day = startOfDay_(now);
  chargers.forEach(function(charger) {
    var maxMinutes = Number(charger.max_minutes) || 0;
    if (maxMinutes <= 0) {
      return;
    }
    var daySlots = buildSlotsForDay_(charger, day);
    daySlots.forEach(function(slot) {
      if (slot.start_time.getTime() < now.getTime()) {
        return;
      }
      var conflict = hasReservationConflict_(
        reservations,
        charger.charger_id,
        slot.start_time,
        slot.end_time,
        config.gapMinutes
      );
      if (!conflict) {
        slots.push({
          charger_id: charger.charger_id,
          start_time: slot.start_time,
          end_time: slot.end_time
        });
      }
    });
  });
  slots.sort(function(a, b) {
    return a.start_time.getTime() - b.start_time.getTime();
  });
  return slots.slice(0, limit || 10);
}

function buildTimelineForCharger_(charger, day, reservations) {
  var config = getReservationConfig_(getConfig_());
  var start = startOfDay_(day);
  var blocks = [];
  var maxMinutes = Number(charger.max_minutes) || 0;
  if (maxMinutes <= 0) {
    return {
      chargerId: String(charger.charger_id),
      chargerName: charger.name || ('Charger ' + charger.charger_id),
      date: Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      blocks: []
    };
  }
  var slots = buildSlotsForDay_(charger, start);
  slots.forEach(function(slot) {
    var conflict = hasReservationConflict_(reservations, charger.charger_id, slot.start_time, slot.end_time, config.gapMinutes);
    blocks.push({
      startTime: toIso_(slot.start_time),
      endTime: toIso_(slot.end_time),
      status: conflict ? 'reserved' : 'available'
    });
  });
  return {
    chargerId: String(charger.charger_id),
    chargerName: charger.name || ('Charger ' + charger.charger_id),
    date: Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    blocks: blocks
  };
}

function buildCalendarDay_(day, chargers, reservations) {
  var config = getReservationConfig_(getConfig_());
  var start = startOfDay_(day);
  var totalSlots = 0;
  var availableSlots = 0;
  chargers.forEach(function(charger) {
    var maxMinutes = Number(charger.max_minutes) || 0;
    if (maxMinutes <= 0) {
      return;
    }
    var slots = buildSlotsForDay_(charger, start);
    slots.forEach(function(slot) {
      totalSlots += 1;
      var conflict = hasReservationConflict_(reservations, charger.charger_id, slot.start_time, slot.end_time, config.gapMinutes);
      if (!conflict) {
        availableSlots += 1;
      }
    });
  });
  return {
    date: Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    totalSlots: totalSlots,
    availableSlots: availableSlots
  };
}

function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function hasReservationConflict_(reservations, chargerId, startTime, endTime, gapMinutes) {
  var gapMs = Math.max(0, gapMinutes) * 60000;
  for (var i = 0; i < reservations.length; i++) {
    var reservation = reservations[i];
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      continue;
    }
    if (String(reservation.charger_id) !== String(chargerId)) {
      continue;
    }
    var existingStart = toDate_(reservation.start_time);
    var existingEnd = toDate_(reservation.end_time);
    if (!existingStart || !existingEnd) {
      continue;
    }
    var conflict = startTime.getTime() < existingEnd.getTime() + gapMs &&
      endTime.getTime() > existingStart.getTime() - gapMs;
    if (conflict) {
      return true;
    }
  }
  return false;
}

function markNoShowReservations_(now) {
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var config = getReservationConfig_(getConfig_());
  reservationsData.rows.forEach(function(reservation) {
    if (!reservation.reservation_id || isReservationCanceled_(reservation) || isReservationNoShow_(reservation)) {
      return;
    }
    if (reservation.checked_in_at) {
      return;
    }
    var startTime = toDate_(reservation.start_time);
    if (!startTime) {
      return;
    }
    var latest = new Date(startTime.getTime() + config.lateGraceMinutes * 60000);
    if (now.getTime() > latest.getTime()) {
      updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
        status: 'no_show',
        no_show_at: now,
        updated_at: now
      });
      var releasedCharger = reservation.charger_id ? 'Charger ' + reservation.charger_id : 'the charger';
      var releasedUser = formatUserDisplay_(reservation.user_name, reservation.user_id);
      notifyUser_(
        reservation,
        {},
        'ChargingMatters: ' + releasedUser + '\'s reservation on ' + releasedCharger + ' was released after 30 minutes.'
      );
    }
  });
}

function buildReminderText_(type, session, charger, endTime, now) {
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  var endDisplay = formatTime_(endTime);
  var userName = formatUserDisplay_(session.user_name, session.user_id);
  if (type === 'tminus5') {
    return 'ChargingMatters: ' + userName + '\'s session on ' + chargerName +
      ' ends in 5 minutes (ends at ' + endDisplay + '). Please move within 10 minutes of ending.';
  }
  if (type === 'expire') {
    return 'ChargingMatters: ' + userName + '\'s session on ' + chargerName +
      ' just ended at ' + endDisplay + '. Please move within 10 minutes.';
  }
  return '';
}

function buildReservationReminderText_(type, reservation, charger, startTime, config) {
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  var startDisplay = formatTime_(startTime);
  var releaseTime = addMinutes_(startTime, config.lateGraceMinutes);
  var releaseDisplay = formatTime_(releaseTime);
  var userName = formatUserDisplay_(reservation.user_name, reservation.user_id);
  if (type === 'upcoming') {
    return 'ChargingMatters: ' + userName + '\'s reservation on ' + chargerName +
      ' starts in 5 minutes at ' + startDisplay + '.';
  }
  if (type === 'late') {
    return 'ChargingMatters: ' + userName + '\'s reservation on ' + chargerName +
      ' started at ' + startDisplay + ' and will be released at ' + releaseDisplay + ' if unused.';
  }
  return '';
}

function formatTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'h:mm a');
}

function deriveFullNameFromEmail_(email) {
  if (!email) {
    return '';
  }
  var local = String(email).split('@')[0] || '';
  var parts = local.split(/[._-]+/).filter(function(part) {
    return part;
  });
  if (parts.length < 2) {
    return '';
  }
  return parts
    .map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function formatUserDisplay_(name, email) {
  var safeName = String(name || '').trim();
  var safeEmail = String(email || '').trim();
  var derivedName = deriveFullNameFromEmail_(safeEmail);
  var displayName = safeName;
  if (displayName && displayName.split(/\s+/).length < 2 && derivedName) {
    displayName = derivedName;
  }
  if (!displayName) {
    displayName = derivedName;
  }
  if (!displayName) {
    return safeEmail || 'A driver';
  }
  return displayName;
}

function notifyUser_(session, charger, text) {
  var config = getConfig_();
  var email = String(session.user_id || '');
  var sentSlack = false;
  var sentEmail = false;
  var slackText = text;
  if (config.slack_bot_token && email) {
    try {
      var userId = getSlackUserId_(email, config.slack_bot_token);
      if (userId) {
        slackText = '<@' + userId + '> ' + text;
      }
    } catch (err) {
      logError_('Slack user lookup failed', err, { email: email });
    }
  }
  if (config.slack_bot_token && config.slack_webhook_channel) {
    try {
      sendSlackChannelMessage_(config.slack_bot_token, config.slack_webhook_channel, slackText);
      sentSlack = true;
    } catch (err) {
      logError_('Slack bot channel failed', err, { channel: config.slack_webhook_channel });
    }
  }
  if (!sentSlack) {
    if (config.slack_webhook_url) {
      try {
        sendSlackWebhook_(config.slack_webhook_url, slackText, config.slack_webhook_channel);
        sentSlack = true;
      } catch (err) {
        logError_('Slack webhook failed', err, { channel: config.slack_webhook_channel });
      }
    } else {
      logError_('Slack webhook missing', '', {});
    }
  }
  if (email) {
    try {
      MailApp.sendEmail(email, 'ChargingMatters reminder', text);
      sentEmail = true;
    } catch (err) {
      logError_('Email notification failed', err, { email: email });
    }
  }
  return sentSlack || sentEmail;
}

function sendSlackWebhook_(webhookUrl, text, channel) {
  if (!webhookUrl) {
    return;
  }
  var payload = {
    text: text
  };
  if (channel) {
    payload.channel = channel;
  }
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function sendSlackChannelMessage_(token, channel, text) {
  if (!token || !channel) {
    throw new Error('Missing Slack token or channel.');
  }
  UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify({
      channel: channel,
      text: text
    }),
    muteHttpExceptions: true
  });
}

function sendSlackDm_(token, email, text) {
  var userId = lookupSlackUserId_(token, email);
  if (!userId) {
    throw new Error('Slack user not found for email.');
  }
  var channelId = openSlackDm_(token, userId);
  if (!channelId) {
    throw new Error('Slack DM channel not created.');
  }
  UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify({
      channel: channelId,
      text: text
    }),
    muteHttpExceptions: true
  });
}

function lookupSlackUserId_(token, email) {
  var response = UrlFetchApp.fetch('https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email), {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText() || '{}');
  return data && data.ok && data.user ? data.user.id : '';
}

function openSlackDm_(token, userId) {
  var response = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify({
      users: userId
    }),
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText() || '{}');
  return data && data.ok && data.channel ? data.channel.id : '';
}

function logError_(message, err, context) {
  var detail = err && err.stack ? err.stack : String(err || '');
  var payload = context ? JSON.stringify(context) : '';
  Logger.log(message + (detail ? ' :: ' + detail : '') + (payload ? ' :: ' + payload : ''));
}

function getSlackUserId_(email, token) {
  if (!email || !token) {
    return '';
  }
  var cache = CacheService.getScriptCache();
  var cacheKey = 'slack_user_' + String(email).toLowerCase();
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }
  var userId = '';
  try {
    userId = lookupSlackUserId_(token, email) || '';
  } catch (err) {
    logError_('Slack lookup failed', err, { email: email });
  }
  cache.put(cacheKey, userId, userId ? 21600 : 3600);
  return userId;
}

