var APP_DEFAULTS = {
  allowedDomain: 'example.com',
  appName: 'EV Charging',
  slackChannelName: 'ev-charging',
  slackChannelUrl: '',
  overdueRepeatMinutes: 15,
  sessionMoveGraceMinutes: 10,
  strikeThreshold: 2,
  suspensionBusinessDays: 2,
  reservationAdvanceDays: 7,
  reservationMaxUpcoming: 3,
  reservationMaxPerDay: 1,
  reservationGapMinutes: 1,
  reservationRoundingMinutes: 15,
  reservationCheckinEarlyMinutes: 5,
  reservationEarlyStartMinutes: 90,
  reservationLateGraceMinutes: 30,
  reservationOpenHour: 6,
  reservationOpenMinute: 0
};

var SHEETS = {
  chargers: 'chargers',
  sessions: 'sessions',
  reservations: 'reservations',
  strikes: 'strikes',
  suspensions: 'suspensions',
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
  'grace_notified_at',
  'late_strike_at',
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
  'no_show_strike_at',
  'reminder_5_before_sent',
  'reminder_5_after_sent',
  'created_at',
  'updated_at',
  'canceled_at'
];

var STRIKES_HEADERS = [
  'strike_id',
  'user_id',
  'user_name',
  'type',
  'source_type',
  'source_id',
  'reason',
  'occurred_at',
  'month_key'
];

var SUSPENSIONS_HEADERS = [
  'suspension_id',
  'user_id',
  'user_name',
  'start_at',
  'end_at',
  'reason',
  'active',
  'created_at'
];

var CONFIG_HEADERS = ['key', 'value'];

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var config = getConfig_();
  var appName = getAppName_(config);
  var slackChannelName = String(config.slack_channel_name || '');
  var slackChannelUrl = String(config.slack_channel_url || '');
  var slackChannelLabel = formatSlackChannelLabel_(slackChannelName);
  var template = HtmlService.createTemplateFromFile('index');
  template.userEmail = auth.email;
  template.userName = auth.name;
  template.isAdmin = auth.isAdmin;
  template.appName = appName;
  template.slackChannelName = slackChannelName;
  template.slackChannelUrl = slackChannelUrl;
  template.slackChannelLabel = slackChannelLabel;
  return template.evaluate().setTitle(appName);
}

function getBoardData() {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var now = new Date();
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var board = buildBoard_(now, reservationsData);
  var userReservations = getUpcomingReservationsForUser_(reservationsData.rows, auth.email, now);
  var suspension = getActiveSuspensionForUser_(auth.email);
  if (suspension) {
    auth.suspension = serializeSuspension_(suspension);
  }
  return {
    user: auth,
    chargers: board.chargers,
    reservations: userReservations,
    serverTime: board.serverTime,
    timezone: Session.getScriptTimeZone(),
    config: {
      appName: board.appName,
      slackChannelName: board.slackChannelName,
      slackChannelUrl: board.slackChannelUrl,
      overdueRepeatMinutes: board.overdueRepeatMinutes,
      sessionMoveGraceMinutes: board.sessionMoveGraceMinutes,
      suspensionBusinessDays: board.suspensionBusinessDays,
      reservationAdvanceDays: board.reservationAdvanceDays,
      reservationMaxUpcoming: board.reservationMaxUpcoming,
      reservationMaxPerDay: board.reservationMaxPerDay,
      reservationGapMinutes: board.reservationGapMinutes,
      reservationRoundingMinutes: board.reservationRoundingMinutes,
      reservationCheckinEarlyMinutes: board.reservationCheckinEarlyMinutes,
      reservationEarlyStartMinutes: board.reservationEarlyStartMinutes,
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
    assertNotSuspended_(auth);
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
    var activeSession = findActiveSessionForUser_(sessionsData.rows, auth.email);
    if (activeSession) {
      var activeCharger = findById_(chargersData.rows, 'charger_id', activeSession.charger_id);
      var activeName = activeCharger ? (activeCharger.name || ('Charger ' + activeCharger.charger_id)) : 'another charger';
      throw new Error('You already have an active session on ' + activeName + '. End it before starting another.');
    }
    var conflictingReservation = findUserReservationAtTime_(reservationsData.rows, auth.email, now, chargerId);
    if (conflictingReservation) {
      var reservedCharger = findById_(chargersData.rows, 'charger_id', conflictingReservation.charger_id);
      var reservedName = reservedCharger ? (reservedCharger.name || ('Charger ' + reservedCharger.charger_id)) : 'another charger';
      throw new Error('You already have a reservation on ' + reservedName + ' at this time.');
    }
    var config = getReservationConfig_(getConfig_());
    var slot = findSlotForTime_(charger, now);
    if (!slot) {
      throw new Error('Charging is only available during scheduled blocks.');
    }
    var openAt = addMinutes_(slot.startTime, config.lateGraceMinutes);
    var slotReservation = findReservationForSlot_(reservationsData.rows, chargerId, slot.startTime);
    if (slotReservation && (isReservationCanceled_(slotReservation) || isReservationNoShow_(slotReservation) || isReservationComplete_(slotReservation))) {
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
    assertNotSuspended_(auth);
    var now = new Date();
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
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
      sessions: sessionsData.rows,
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
      '',
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
    assertNotSuspended_(auth);
    var now = new Date();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
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
      sessions: sessionsData.rows,
      excludeReservationId: reservationId
    });
    updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
      charger_id: chargerId,
      start_time: startTime,
      end_time: endTime,
      status: 'active',
      checked_in_at: '',
      no_show_at: '',
      no_show_strike_at: '',
      reminder_5_before_sent: '',
      reminder_5_after_sent: '',
      canceled_at: '',
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
    if (!reservation || isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
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
    assertNotSuspended_(auth);
    var now = new Date();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
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
    var earlyWindowMinutes = Math.max(config.checkinEarlyMinutes, config.earlyStartMinutes);
    var earliest = new Date(startTime.getTime() - earlyWindowMinutes * 60000);
    var latest = new Date(startTime.getTime() + config.lateGraceMinutes * 60000);
    if (now.getTime() < earliest.getTime()) {
      throw new Error('Check-in is available within ' + earlyWindowMinutes + ' minutes of start time.');
    }
    if (now.getTime() > latest.getTime()) {
      throw new Error('This reservation is too late to check in.');
    }
    var activeSession = findActiveSessionForUser_(sessionsData.rows, auth.email);
    if (activeSession) {
      var activeCharger = findById_(chargersData.rows, 'charger_id', activeSession.charger_id);
      var activeName = activeCharger ? (activeCharger.name || ('Charger ' + activeCharger.charger_id)) : 'another charger';
      throw new Error('You already have an active session on ' + activeName + '. End it before checking in.');
    }
    if (now.getTime() < startTime.getTime()) {
      startSessionForReservation_(reservation, auth, now, config, chargersData, sessionsData, reservationsData);
    } else {
      startSession(reservation.charger_id);
    }
    if (!reservation.checked_in_at) {
      updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
        checked_in_at: now,
        status: 'checked_in',
        updated_at: now
      });
    }
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

function endMyActiveSession() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var activeSession = findActiveSessionForUser_(sessionsData.rows, auth.email);
    if (!activeSession) {
      throw new Error('Active session not found.');
    }
    endSessionInternal_(activeSession.session_id, auth, false);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function endSessionForReservation(reservationId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
      throw new Error('Reservation not found.');
    }
    if (!auth.isAdmin && String(reservation.user_id).toLowerCase() !== auth.email.toLowerCase()) {
      throw new Error('You can only end sessions for your own reservations.');
    }
    if (!reservation.checked_in_at) {
      throw new Error('Reservation is not checked in.');
    }
    var startTime = toDate_(reservation.start_time);
    var endTime = toDate_(reservation.end_time);
    if (!startTime || !endTime) {
      throw new Error('Reservation has invalid timing.');
    }
    var activeSession = findActiveSessionForUser_(sessionsData.rows, auth.email);
    if (!activeSession) {
      throw new Error('Session not found for this reservation.');
    }
    if (String(activeSession.charger_id) !== String(reservation.charger_id)) {
      throw new Error('Session does not match this reservation.');
    }
    var sessionStart = toDate_(activeSession.start_time);
    var sessionEnd = toDate_(activeSession.end_time);
    if (!sessionStart || !sessionEnd) {
      throw new Error('Session timing is invalid.');
    }
    var overlaps = sessionStart.getTime() < endTime.getTime() && sessionEnd.getTime() > startTime.getTime();
    if (!overlaps) {
      throw new Error('Session does not match this reservation.');
    }
    endSessionInternal_(activeSession.session_id, auth, false);
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function completeCheckedInReservation(reservationId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    initSheets_();
    var auth = requireAuthorizedUser_();
    var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
    var reservation = findById_(reservationsData.rows, 'reservation_id', reservationId);
    if (!reservation || isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
      throw new Error('Reservation not found.');
    }
    if (!auth.isAdmin && String(reservation.user_id).toLowerCase() !== auth.email.toLowerCase()) {
      throw new Error('You can only update your own reservations.');
    }
    if (!reservation.checked_in_at) {
      throw new Error('Reservation is not checked in.');
    }
    var now = new Date();
    updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
      status: 'complete',
      end_time: now,
      updated_at: now
    });
    return getBoardData();
  } finally {
    lock.releaseLock();
  }
}

function notifyOwner(chargerId) {
  initSheets_();
  requireAuthorizedUser_();
  var config = getConfig_();
  var appName = getAppName_(config);
  var channelMention = getSlackChannelMention_(config);
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
  notifyChannel_(
    appName + ': Someone is waiting for ' + chargerName +
      '. Please move your car and post any delays in ' + channelMention + '.',
    session.user_id
  );
  return getBoardData();
}

function postChannelMessage(message) {
  initSheets_();
  var auth = requireAuthorizedUser_();
  var config = getConfig_();
  var appName = getAppName_(config);
  var channelMention = getSlackChannelMention_(config);
  var text = String(message || '').trim();
  if (!text) {
    throw new Error('Message cannot be empty.');
  }
  var displayName = formatUserDisplay_(auth.name, auth.email);
  var payload = appName + ': ' + displayName + ' says: ' + text;
  if (!notifyChannel_(payload, auth.email)) {
    throw new Error('Unable to post to ' + channelMention + '.');
  }
  return true;
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
  runWithRetries_(sendRemindersCore_, 'sendReminders');
}

function sendRemindersCore_() {
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
    var sessionMoveGraceMinutes = parseInt(config.session_move_grace_minutes, 10);
    var overdueRepeatMinutes = parseInt(config.overdue_repeat_minutes, 10);
    sessionMoveGraceMinutes = isNaN(sessionMoveGraceMinutes) ? APP_DEFAULTS.sessionMoveGraceMinutes : sessionMoveGraceMinutes;
    overdueRepeatMinutes = isNaN(overdueRepeatMinutes) ? APP_DEFAULTS.overdueRepeatMinutes : overdueRepeatMinutes;
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
        var graceCutoff = addMinutes_(endTime, sessionMoveGraceMinutes);
        var isOverdue = now.getTime() >= graceCutoff.getTime();
        var updates = {};
        if (isOverdue && session.status !== 'overdue') {
          updates.status = 'overdue';
          updates.active = true;
          updates.overdue = true;
          updates.complete = false;
        }
        if (!isOverdue && session.status !== 'active') {
          updates.status = 'active';
          updates.active = true;
          updates.overdue = false;
          updates.complete = false;
        }
        if (!isTrue_(session.reminder_10_sent) && minutesToEnd <= 10 && minutesToEnd > 5) {
          if (notifyChannel_(buildReminderText_('tminus10', session, charger, endTime, now, sessionMoveGraceMinutes), session.user_id)) {
            updates.reminder_10_sent = true;
          }
        }
        if (!isTrue_(session.reminder_5_sent) && minutesToEnd <= 5 && minutesToEnd > 0) {
          if (notifyChannel_(buildReminderText_('tminus5', session, charger, endTime, now, sessionMoveGraceMinutes), session.user_id)) {
            updates.reminder_5_sent = true;
          }
        }
        if (!isTrue_(session.reminder_0_sent) && minutesToEnd <= 0) {
          if (notifyChannel_(buildReminderText_('expire', session, charger, endTime, now, sessionMoveGraceMinutes), session.user_id)) {
            updates.reminder_0_sent = true;
            updates.overdue_last_sent_at = now;
          }
        }
        if (isOverdue) {
          if (!session.grace_notified_at) {
            if (notifyChannel_(buildReminderText_('grace', session, charger, endTime, now, sessionMoveGraceMinutes), session.user_id)) {
              updates.grace_notified_at = now;
              updates.overdue_last_sent_at = now;
            }
          }
          if (!session.late_strike_at) {
            recordStrike_({
              type: 'late',
              sourceType: 'session',
              sourceId: session.session_id,
              userEmail: session.user_id,
              userName: session.user_name,
              reason: 'Late move after grace period',
              occurredAt: now
            });
            updates.late_strike_at = now;
          }
          var lastSent = toDate_(session.overdue_last_sent_at);
          if (!lastSent || now.getTime() - lastSent.getTime() >= overdueRepeatMinutes * 60000) {
            if (notifyChannel_(buildReminderText_('overdue', session, charger, endTime, now, sessionMoveGraceMinutes), session.user_id)) {
              updates.overdue_last_sent_at = now;
            }
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
        if (!reservation.reservation_id ||
            isReservationCanceled_(reservation) ||
            isReservationNoShow_(reservation) ||
            isReservationComplete_(reservation)) {
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
          if (notifyChannel_(buildReservationReminderText_('upcoming', reservation, charger, startTime, reservationConfig), reservation.user_id)) {
            resUpdates.reminder_5_before_sent = true;
          }
        }
        if (!isTrue_(reservation.reminder_5_after_sent) &&
            minutesSinceStart >= 5 &&
            minutesSinceStart < reservationConfig.lateGraceMinutes) {
          if (notifyChannel_(buildReservationReminderText_('late', reservation, charger, startTime, reservationConfig), reservation.user_id)) {
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

function installReminderTrigger() {
  installReminderTrigger_(5);
}

function installReminderTriggerEveryMinute() {
  installReminderTrigger_(1);
}

function installReminderTrigger_(minutes) {
  var interval = parseInt(minutes, 10);
  if (isNaN(interval) || interval < 1 || interval > 60) {
    throw new Error('Trigger interval must be between 1 and 60 minutes.');
  }
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'sendReminders') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('sendReminders')
    .timeBased()
    .everyMinutes(interval)
    .create();
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
  var now = new Date();
  var sessionEnd = toDate_(session.end_time);
  updateRow_(sessionsData.sheet, sessionsData.headerMap, session._row, {
    status: 'complete',
    active: false,
    overdue: false,
    complete: true,
    ended_at: now
  });
  var charger = findById_(chargersData.rows, 'charger_id', session.charger_id);
  if (charger && String(charger.active_session_id) === String(sessionId)) {
    updateRow_(chargersData.sheet, chargersData.headerMap, charger._row, {
      active_session_id: ''
    });
  }
  if (sessionEnd && now.getTime() < sessionEnd.getTime()) {
    var chargerDetails = charger || { charger_id: session.charger_id };
    var earlyText = buildEarlyEndText_(session, chargerDetails, sessionEnd, now);
    if (earlyText) {
      notifyChannel_(earlyText);
    }
  }
  completeReservationForSession_(session, now);
}

function completeReservationForSession_(session, now) {
  var reservationsData = getSheetData_(SHEETS.reservations, RESERVATIONS_HEADERS);
  var sessionStart = toDate_(session.start_time);
  var sessionEnd = toDate_(session.end_time);
  if (!sessionStart || !sessionEnd) {
    return;
  }
  var userEmail = String(session.user_id || '').toLowerCase();
  var chargerId = String(session.charger_id || '');
  reservationsData.rows.forEach(function(reservation) {
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
      return;
    }
    if (!reservation.checked_in_at) {
      return;
    }
    if (String(reservation.user_id || '').toLowerCase() !== userEmail) {
      return;
    }
    if (String(reservation.charger_id || '') !== chargerId) {
      return;
    }
    var resStart = toDate_(reservation.start_time);
    var resEnd = toDate_(reservation.end_time);
    if (!resStart || !resEnd) {
      return;
    }
    var overlaps = sessionStart.getTime() < resEnd.getTime() && sessionEnd.getTime() > resStart.getTime();
    if (!overlaps) {
      return;
    }
    updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, {
      status: 'complete',
      end_time: now,
      updated_at: now
    });
  });
}

function buildBoard_(now, reservationsData) {
  var config = getConfig_();
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var sessionsData = getSheetData_(SHEETS.sessions, SESSIONS_HEADERS);
  var reservations = reservationsData ? reservationsData.rows : [];
  var reservationConfig = getReservationConfig_(config);
  var sessionMoveGraceMinutes = Number(config.session_move_grace_minutes) || APP_DEFAULTS.sessionMoveGraceMinutes;
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
      var statusLabel = 'Open';
      var activeReservation = reservationsByCharger.active[String(charger.charger_id || '')] || null;
      var nextReservation = reservationsByCharger.next[String(charger.charger_id || '')] || null;
      var walkup = null;
      if (session) {
        var endTime = toDate_(session.end_time);
        var graceCutoff = endTime ? addMinutes_(endTime, sessionMoveGraceMinutes) : null;
        var isOverdue = graceCutoff && now.getTime() >= graceCutoff.getTime();
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
      } else {
        var slot = findSlotForTime_(charger, now);
        if (slot) {
          var openAt = addMinutes_(slot.startTime, reservationConfig.lateGraceMinutes);
          walkup = {
            startTime: toIso_(slot.startTime),
            endTime: toIso_(slot.endTime),
            openAt: toIso_(openAt),
            isOpen: now.getTime() >= openAt.getTime()
          };
        }
      }
      return {
        id: String(charger.charger_id || ''),
        name: charger.name || ('Charger ' + charger.charger_id),
        maxMinutes: Number(charger.max_minutes) || 0,
        status: statusLabel,
        statusKey: statusKey,
        session: session ? serializeSession_(session) : null,
        reservation: activeReservation ? serializeReservation_(activeReservation) : null,
        nextReservation: nextReservation ? serializeReservation_(nextReservation) : null,
        walkup: walkup
      };
    });
  return {
    chargers: chargersView,
    serverTime: now.toISOString(),
    appName: getAppName_(config),
    slackChannelName: String(config.slack_channel_name || ''),
    slackChannelUrl: String(config.slack_channel_url || ''),
    overdueRepeatMinutes: Number(config.overdue_repeat_minutes) || APP_DEFAULTS.overdueRepeatMinutes,
    sessionMoveGraceMinutes: sessionMoveGraceMinutes,
    suspensionBusinessDays: Number(config.suspension_business_days) || APP_DEFAULTS.suspensionBusinessDays,
    reservationAdvanceDays: reservationConfig.advanceDays,
    reservationMaxUpcoming: reservationConfig.maxUpcoming,
    reservationMaxPerDay: reservationConfig.maxPerDay,
    reservationGapMinutes: reservationConfig.gapMinutes,
    reservationRoundingMinutes: reservationConfig.roundingMinutes,
    reservationCheckinEarlyMinutes: reservationConfig.checkinEarlyMinutes,
    reservationEarlyStartMinutes: reservationConfig.earlyStartMinutes,
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
  ensureHeaders_(getSheet_(SHEETS.strikes), STRIKES_HEADERS);
  ensureHeaders_(getSheet_(SHEETS.suspensions), SUSPENSIONS_HEADERS);
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
  config.app_name = config.app_name || props.getProperty('APP_NAME') || APP_DEFAULTS.appName;
  config.slack_channel_name = config.slack_channel_name || props.getProperty('SLACK_CHANNEL_NAME') || APP_DEFAULTS.slackChannelName;
  config.slack_channel_url = config.slack_channel_url || props.getProperty('SLACK_CHANNEL_URL') || APP_DEFAULTS.slackChannelUrl;
  config.slack_webhook_url = config.slack_webhook_url || props.getProperty('SLACK_WEBHOOK_URL') || '';
  config.slack_webhook_channel = config.slack_webhook_channel || props.getProperty('SLACK_WEBHOOK_CHANNEL') || '';
  config.slack_bot_token = config.slack_bot_token || props.getProperty('SLACK_BOT_TOKEN') || '';
  config.admin_emails = config.admin_emails || props.getProperty('ADMIN_EMAILS') || '';
  config.overdue_repeat_minutes = config.overdue_repeat_minutes || props.getProperty('OVERDUE_REPEAT_MINUTES') || APP_DEFAULTS.overdueRepeatMinutes;
  config.session_move_grace_minutes =
    config.session_move_grace_minutes ||
    props.getProperty('SESSION_MOVE_GRACE_MINUTES') ||
    APP_DEFAULTS.sessionMoveGraceMinutes;
  config.strike_threshold =
    config.strike_threshold ||
    props.getProperty('STRIKE_THRESHOLD') ||
    APP_DEFAULTS.strikeThreshold;
  config.suspension_business_days =
    config.suspension_business_days ||
    props.getProperty('SUSPENSION_BUSINESS_DAYS') ||
    APP_DEFAULTS.suspensionBusinessDays;
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
  config.reservation_checkin_early_minutes = resolveConfigValue_(
    config.reservation_checkin_early_minutes,
    props.getProperty('RESERVATION_CHECKIN_EARLY_MINUTES'),
    APP_DEFAULTS.reservationCheckinEarlyMinutes
  );
  config.reservation_early_start_minutes = resolveConfigValue_(
    config.reservation_early_start_minutes,
    props.getProperty('RESERVATION_EARLY_START_MINUTES'),
    APP_DEFAULTS.reservationEarlyStartMinutes
  );
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

function resolveConfigValue_(value, fallbackValue, defaultValue) {
  if (value !== null && value !== undefined && String(value).trim() !== '') {
    return value;
  }
  if (fallbackValue !== null && fallbackValue !== undefined && String(fallbackValue).trim() !== '') {
    return fallbackValue;
  }
  return defaultValue;
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

function findActiveSessionForUser_(sessions, userEmail) {
  var email = String(userEmail || '').toLowerCase();
  for (var i = 0; i < sessions.length; i++) {
    var session = sessions[i];
    if (!session || !session.session_id) {
      continue;
    }
    if (isComplete_(session)) {
      continue;
    }
    if (String(session.user_id || '').toLowerCase() === email) {
      return session;
    }
  }
  return null;
}

function findUserReservationAtTime_(reservations, userEmail, moment, excludeChargerId) {
  var email = String(userEmail || '').toLowerCase();
  var target = moment ? moment.getTime() : 0;
  for (var i = 0; i < reservations.length; i++) {
    var reservation = reservations[i];
    if (!reservation || !reservation.reservation_id) {
      continue;
    }
    if (isReservationCanceled_(reservation) || isReservationNoShow_(reservation) || isReservationComplete_(reservation)) {
      continue;
    }
    if (String(reservation.user_id || '').toLowerCase() !== email) {
      continue;
    }
    if (excludeChargerId && String(reservation.charger_id) === String(excludeChargerId)) {
      continue;
    }
    var start = toDate_(reservation.start_time);
    var end = toDate_(reservation.end_time);
    if (!start || !end) {
      continue;
    }
    if (target >= start.getTime() && target < end.getTime()) {
      return reservation;
    }
  }
  return null;
}

function monthKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

function addBusinessDays_(date, days) {
  var result = new Date(date.getTime());
  var remaining = Math.max(0, days);
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    var day = result.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return result;
}

function getActiveSuspensionForUser_(email) {
  var data = getSheetData_(SHEETS.suspensions, SUSPENSIONS_HEADERS);
  var now = new Date();
  var normalized = String(email || '').toLowerCase();
  var active = null;
  data.rows.forEach(function(row) {
    if (!row.user_id || String(row.user_id).toLowerCase() !== normalized) {
      return;
    }
    var endAt = toDate_(row.end_at);
    var isActive = isTrue_(row.active);
    if (endAt && now.getTime() > endAt.getTime()) {
      if (isActive) {
        updateRow_(data.sheet, data.headerMap, row._row, { active: false });
      }
      return;
    }
    if (isActive && endAt) {
      active = row;
    }
  });
  return active;
}

function assertNotSuspended_(auth) {
  var suspension = getActiveSuspensionForUser_(auth.email);
  if (suspension) {
    var endAt = toDate_(suspension.end_at);
    var endDisplay = endAt ? formatTime_(endAt) + ' on ' + Utilities.formatDate(endAt, Session.getScriptTimeZone(), 'MMM d') : 'soon';
    throw new Error('Charging privileges suspended until ' + endDisplay + '.');
  }
}

function getMonthlyStrikeCount_(strikes, email, monthKey) {
  var normalized = String(email || '').toLowerCase();
  return strikes.filter(function(strike) {
    return strike.user_id &&
      String(strike.user_id).toLowerCase() === normalized &&
      String(strike.month_key) === String(monthKey);
  }).length;
}

function recordStrike_(params) {
  var strikesData = getSheetData_(SHEETS.strikes, STRIKES_HEADERS);
  var userEmail = String(params.userEmail || '').toLowerCase();
  var sourceId = String(params.sourceId || '');
  var sourceType = String(params.sourceType || '');
  var type = String(params.type || '');
  for (var i = 0; i < strikesData.rows.length; i++) {
    var existing = strikesData.rows[i];
    if (String(existing.source_id) === sourceId && String(existing.type) === type) {
      return existing;
    }
  }
  var now = params.occurredAt || new Date();
  var monthKey = monthKey_(now);
  strikesData.sheet.appendRow([
    Utilities.getUuid(),
    userEmail,
    params.userName || '',
    type,
    sourceType,
    sourceId,
    params.reason || '',
    now,
    monthKey
  ]);
  var refreshed = getSheetData_(SHEETS.strikes, STRIKES_HEADERS);
  var count = getMonthlyStrikeCount_(refreshed.rows, userEmail, monthKey);
  maybeApplySuspension_(params.userEmail, params.userName, monthKey, now, count);
  return null;
}

function maybeApplySuspension_(userEmail, userName, monthKey, now, strikeCount) {
  var config = getConfig_();
  var appName = getAppName_(config);
  var threshold = parseInt(config.strike_threshold, 10);
  var suspensionDays = parseInt(config.suspension_business_days, 10);
  var required = isNaN(threshold) ? APP_DEFAULTS.strikeThreshold : threshold;
  var days = isNaN(suspensionDays) ? APP_DEFAULTS.suspensionBusinessDays : suspensionDays;
  if (strikeCount < required) {
    return null;
  }
  var existing = getActiveSuspensionForUser_(userEmail);
  if (existing) {
    return existing;
  }
  var suspensionsData = getSheetData_(SHEETS.suspensions, SUSPENSIONS_HEADERS);
  var startAt = now || new Date();
  var endAt = addBusinessDays_(startAt, days);
  suspensionsData.sheet.appendRow([
    Utilities.getUuid(),
    userEmail,
    userName || '',
    startAt,
    endAt,
    'Two-strike rule',
    true,
    new Date()
  ]);
  notifyChannel_(appName + ': ' + formatUserDisplay_(userName, userEmail) +
    ' has reached ' + required + ' strikes and is suspended until ' + formatTime_(endAt) + '.');
  return null;
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

function serializeSuspension_(suspension) {
  return {
    startAt: toIso_(suspension.start_at),
    endAt: toIso_(suspension.end_at),
    reason: String(suspension.reason || '')
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
  var earlyStartMinutes = parseInt(config.reservation_early_start_minutes, 10);
  var lateGraceMinutes = parseInt(config.reservation_late_grace_minutes, 10);
  var openHour = parseInt(config.reservation_open_hour, 10);
  var openMinute = parseInt(config.reservation_open_minute, 10);
  var resolvedMaxPerDay = isNaN(maxPerDay) ? APP_DEFAULTS.reservationMaxPerDay : maxPerDay;
  resolvedMaxPerDay = Math.max(1, resolvedMaxPerDay);
  return {
    advanceDays: isNaN(advanceDays) ? APP_DEFAULTS.reservationAdvanceDays : advanceDays,
    maxUpcoming: isNaN(maxUpcoming) ? APP_DEFAULTS.reservationMaxUpcoming : maxUpcoming,
    maxPerDay: resolvedMaxPerDay,
    gapMinutes: isNaN(gapMinutes) ? APP_DEFAULTS.reservationGapMinutes : gapMinutes,
    roundingMinutes: isNaN(roundingMinutes) ? APP_DEFAULTS.reservationRoundingMinutes : roundingMinutes,
    checkinEarlyMinutes: isNaN(checkinEarlyMinutes) ? APP_DEFAULTS.reservationCheckinEarlyMinutes : checkinEarlyMinutes,
    earlyStartMinutes: isNaN(earlyStartMinutes) ? APP_DEFAULTS.reservationEarlyStartMinutes : earlyStartMinutes,
    lateGraceMinutes: isNaN(lateGraceMinutes) ? APP_DEFAULTS.reservationLateGraceMinutes : lateGraceMinutes,
    openHour: isNaN(openHour) ? APP_DEFAULTS.reservationOpenHour : openHour,
    openMinute: isNaN(openMinute) ? APP_DEFAULTS.reservationOpenMinute : openMinute
  };
}

function getUpcomingReservationsForUser_(reservations, email, now) {
  var userEmail = String(email || '').toLowerCase();
  return reservations
    .filter(function(reservation) {
      if (!reservation.reservation_id ||
          isReservationCanceled_(reservation) ||
          isReservationNoShow_(reservation) ||
          isReservationComplete_(reservation)) {
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
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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

function isReservationComplete_(reservation) {
  return String(reservation.status || '').toLowerCase() === 'complete';
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

  var sessions = params.sessions || [];
  var activeSession = findActiveSessionForUser_(sessions, auth.email);
  if (activeSession) {
    var sessionStart = toDate_(activeSession.start_time);
    var sessionEnd = toDate_(activeSession.end_time);
    if (!sessionStart || !sessionEnd) {
      throw new Error('You already have an active session. End it before booking another slot.');
    }
    var overlapsSession =
      startTime.getTime() < sessionEnd.getTime() && endTime.getTime() > sessionStart.getTime();
    if (overlapsSession) {
      throw new Error('You already have an active session that overlaps this reservation.');
    }
  }

  var upcoming = reservations.filter(function(reservation) {
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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
  var perDayCount = reservations.filter(function(reservation) {
    if (!reservation.reservation_id || isReservationCanceled_(reservation)) {
      return false;
    }
    if (String(reservation.reservation_id) === excludeId) {
      return false;
    }
    if (String(reservation.user_id || '').toLowerCase() !== userEmail) {
      return false;
    }
    var resStart = toDate_(reservation.start_time);
    return resStart && dayKey_(resStart) === dayKey;
  }).length;
  if (perDayCount >= config.maxPerDay) {
    throw new Error('You already have a reservation for today. Change or cancel it to book another.');
  }

  var gapMs = config.gapMinutes * 60000;
  reservations.forEach(function(reservation) {
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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

function findPreviousReservation_(reservations, chargerId, startTime) {
  var startMs = startTime.getTime();
  var previous = null;
  reservations.forEach(function(reservation) {
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
      return;
    }
    if (String(reservation.charger_id) !== String(chargerId)) {
      return;
    }
    var resStart = toDate_(reservation.start_time);
    if (!resStart || resStart.getTime() >= startMs) {
      return;
    }
    if (!previous) {
      previous = reservation;
      return;
    }
    var prevStart = toDate_(previous.start_time);
    if (prevStart && resStart.getTime() > prevStart.getTime()) {
      previous = reservation;
    }
  });
  return previous;
}

function startSessionForReservation_(reservation, auth, now, config, chargersData, sessionsData, reservationsData) {
  var charger = findById_(chargersData.rows, 'charger_id', reservation.charger_id);
  if (!charger) {
    throw new Error('Charger not found.');
  }
  var maxMinutes = Number(charger.max_minutes) || 0;
  if (maxMinutes <= 0) {
    throw new Error('Charger max minutes is not configured.');
  }
  var startTime = toDate_(reservation.start_time);
  var endTime = toDate_(reservation.end_time);
  if (!startTime || !endTime) {
    throw new Error('Invalid reservation time.');
  }
  var earliest = new Date(startTime.getTime() - config.earlyStartMinutes * 60000);
  if (now.getTime() < earliest.getTime()) {
    throw new Error('Check-in is available within ' + config.earlyStartMinutes + ' minutes of start time.');
  }

  var previous = findPreviousReservation_(reservationsData.rows, reservation.charger_id, startTime);
  if (previous && !previous.checked_in_at) {
    var previousStart = toDate_(previous.start_time);
    if (previousStart) {
      var graceEnd = addMinutes_(previousStart, config.lateGraceMinutes);
      if (now.getTime() < graceEnd.getTime()) {
        throw new Error('Previous reservation can still check in until ' + formatTime_(graceEnd) + '.');
      }
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

  var hasConflict = reservationsData.rows.some(function(other) {
    if (!other.reservation_id ||
        isReservationCanceled_(other) ||
        isReservationNoShow_(other) ||
        isReservationComplete_(other)) {
      return false;
    }
    if (String(other.reservation_id) === String(reservation.reservation_id)) {
      return false;
    }
    if (String(other.charger_id) !== String(reservation.charger_id)) {
      return false;
    }
    var otherStart = toDate_(other.start_time);
    var otherEnd = toDate_(other.end_time);
    if (!otherStart || !otherEnd) {
      return false;
    }
    var overlaps = otherStart.getTime() < endTime.getTime() && otherEnd.getTime() > now.getTime();
    if (!overlaps) {
      return false;
    }
    var otherUser = String(other.user_id || '').toLowerCase();
    if (otherUser === String(auth.email || '').toLowerCase()) {
      return false;
    }
    var graceEnd = addMinutes_(otherStart, config.lateGraceMinutes);
    if (otherEnd.getTime() === startTime.getTime() && now.getTime() >= graceEnd.getTime()) {
      return false;
    }
    return true;
  });

  if (hasConflict) {
    throw new Error('Charger is reserved for another user before your slot.');
  }

  var sessionId = Utilities.getUuid();
  var sessionRow = [
    sessionId,
    reservation.charger_id,
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
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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
  var appName = getAppName_(getConfig_());
  var chargersData = getSheetData_(SHEETS.chargers, CHARGERS_HEADERS);
  var chargersById = {};
  chargersData.rows.forEach(function(charger) {
    chargersById[String(charger.charger_id)] = charger;
  });
  reservationsData.rows.forEach(function(reservation) {
    if (!reservation.reservation_id ||
        isReservationCanceled_(reservation) ||
        isReservationNoShow_(reservation) ||
        isReservationComplete_(reservation)) {
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
      var updates = {
        status: 'no_show',
        no_show_at: now,
        updated_at: now
      };
      if (!reservation.no_show_strike_at) {
        recordStrike_({
          type: 'no_show',
          sourceType: 'reservation',
          sourceId: reservation.reservation_id,
          userEmail: reservation.user_id,
          userName: reservation.user_name,
          reason: 'No-show for reservation',
          occurredAt: now
        });
        updates.no_show_strike_at = now;
      }
      updateRow_(reservationsData.sheet, reservationsData.headerMap, reservation._row, updates);
      var charger = chargersById[String(reservation.charger_id)] || {};
      var chargerName = charger.name || ('Charger ' + reservation.charger_id);
      var releasedUser = formatUserDisplay_(reservation.user_name, reservation.user_id);
      notifyChannel_(
        appName + ': ' + releasedUser + '\'s reservation on ' + chargerName +
          ' was released (no-show after ' + config.lateGraceMinutes + ' minutes).',
        reservation.user_id
      );
    }
  });
}

function buildReminderText_(type, session, charger, endTime, now, graceMinutes) {
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  var endDisplay = formatTime_(endTime);
  var userName = formatUserDisplay_(session.user_name, session.user_id);
  var config = getConfig_();
  var appName = getAppName_(config);
  var channelMention = getSlackChannelMention_(config);
  var grace = graceMinutes || APP_DEFAULTS.sessionMoveGraceMinutes;
  if (type === 'tminus10') {
    return appName + ': ' + userName + '\'s session on ' + chargerName +
      ' ends in 10 minutes (ends at ' + endDisplay + '). Please move within ' + grace + ' minutes of ending.';
  }
  if (type === 'tminus5') {
    return appName + ': ' + userName + '\'s session on ' + chargerName +
      ' ends in 5 minutes (ends at ' + endDisplay + '). Please move within ' + grace + ' minutes of ending.';
  }
  if (type === 'expire') {
    return appName + ': ' + userName + '\'s session on ' + chargerName +
      ' just ended at ' + endDisplay + '. Please move within ' + grace + ' minutes.';
  }
  if (type === 'grace') {
    return appName + ': ' + userName + '\'s session on ' + chargerName +
      ' is past the ' + grace + '-minute grace period. Please move now and post updates in ' + channelMention + '. ' +
      'If the cable reaches the next spot, unlock the charge port remotely.';
  }
  if (type === 'overdue') {
    return appName + ': ' + userName + '\'s session on ' + chargerName +
      ' is still overdue. Please move now and post updates in ' + channelMention + '.';
  }
  return '';
}

function buildReservationReminderText_(type, reservation, charger, startTime, config) {
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  var startDisplay = formatTime_(startTime);
  var releaseTime = addMinutes_(startTime, config.lateGraceMinutes);
  var releaseDisplay = formatTime_(releaseTime);
  var userName = formatUserDisplay_(reservation.user_name, reservation.user_id);
  var appName = getAppName_(getConfig_());
  if (type === 'upcoming') {
    return appName + ': ' + userName + '\'s reservation on ' + chargerName +
      ' starts in 5 minutes at ' + startDisplay + '.';
  }
  if (type === 'late') {
    return appName + ': ' + userName + '\'s reservation on ' + chargerName +
      ' started at ' + startDisplay + ' and will be released at ' + releaseDisplay + ' if unused.';
  }
  return '';
}

function formatTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'h:mm a');
}

function formatDurationMinutes_(minutes) {
  var total = Math.max(0, Math.round(minutes));
  if (total === 1) {
    return '1 minute';
  }
  if (total < 60) {
    return total + ' minutes';
  }
  var hours = Math.floor(total / 60);
  var remainder = total % 60;
  var hourLabel = hours === 1 ? '1 hour' : hours + ' hours';
  if (!remainder) {
    return hourLabel;
  }
  var minuteLabel = remainder === 1 ? '1 minute' : remainder + ' minutes';
  return hourLabel + ' ' + minuteLabel;
}

function buildEarlyEndText_(session, charger, sessionEnd, now) {
  var remainingMinutes = Math.ceil((sessionEnd.getTime() - now.getTime()) / 60000);
  if (remainingMinutes <= 0) {
    return '';
  }
  var chargerName = charger.name || ('Charger ' + charger.charger_id);
  var userName = formatUserDisplay_(session.user_name, session.user_id);
  var remainingLabel = formatDurationMinutes_(remainingMinutes);
  var endDisplay = formatTime_(sessionEnd);
  var appName = getAppName_(getConfig_());
  return appName + ': ' + userName + ' ended early on ' + chargerName +
    '. ' + remainingLabel + ' left in the slot (until ' + endDisplay + ').';
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

function getAppName_(config) {
  return String((config && config.app_name) || APP_DEFAULTS.appName || 'EV Charging');
}

function formatSlackChannelLabel_(name) {
  var raw = String(name || '').trim();
  if (!raw) {
    return '';
  }
  var clean = raw.charAt(0) === '#' ? raw.slice(1) : raw;
  return '#' + clean;
}

function getSlackChannelMention_(config) {
  var label = formatSlackChannelLabel_(config && config.slack_channel_name);
  return label || 'the Slack channel';
}

function notifyChannel_(text, email) {
  var config = getConfig_();
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
  if (!sentSlack && email) {
    try {
      MailApp.sendEmail(email, getAppName_(config) + ' reminder', text);
      sentEmail = true;
    } catch (err) {
      logError_('Email notification failed', err, { email: email });
    }
  }
  return sentSlack || sentEmail;
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
      MailApp.sendEmail(email, getAppName_(config) + ' reminder', text);
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

function runWithRetries_(fn, label) {
  var maxAttempts = 3;
  var baseDelayMs = 1000;
  for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      var transient = isTransientError_(err);
      var context = { attempt: attempt, transient: transient };
      if (!transient || attempt === maxAttempts) {
        logError_(label + ' failed', err, context);
        throw err;
      }
      logError_(label + ' transient error, retrying', err, context);
      var jitter = Math.floor(Math.random() * 250);
      Utilities.sleep(baseDelayMs * Math.pow(2, attempt - 1) + jitter);
    }
  }
}

function isTransientError_(err) {
  var message = String(err && err.message ? err.message : err || '');
  var normalized = message.toLowerCase();
  return (
    normalized.indexOf('server error occurred') !== -1 ||
    normalized.indexOf('please wait a bit and try again') !== -1 ||
    normalized.indexOf('service invoked too many times') !== -1 ||
    normalized.indexOf('rate limit exceeded') !== -1 ||
    normalized.indexOf('service unavailable') !== -1 ||
    normalized.indexOf('internal error') !== -1 ||
    normalized.indexOf('backenderror') !== -1 ||
    normalized.indexOf('socketexception') !== -1 ||
    normalized.indexOf('timeout') !== -1
  );
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
