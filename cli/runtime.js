'use strict';

const crypto = require('crypto');

function createRuntime(options) {
  const store = options.store;
  const auth = {
    email: options.authEmail || 'user@example.com',
    name: options.authName || deriveName(options.authEmail || 'user@example.com'),
    isAdmin: Boolean(options.isAdmin)
  };
  const cache = new Map();

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) {
          return store.properties ? store.properties[key] : '';
        },
        setProperty(key, value) {
          store.properties = store.properties || {};
          store.properties[key] = value;
        }
      };
    }
  };

  const Session = {
    getActiveUser() {
      return {
        getEmail() {
          return auth.email;
        }
      };
    },
    getScriptTimeZone() {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
  };

  const Utilities = {
    getUuid() {
      return crypto.randomUUID();
    },
    formatDate(date, timeZone, format) {
      return formatDate(date, timeZone, format);
    },
    sleep(ms) {
      sleepSync(ms);
    }
  };

  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          return true;
        },
        tryLock() {
          return true;
        },
        releaseLock() {
          return true;
        }
      };
    }
  };

  const CacheService = {
    getScriptCache() {
      return {
        get(key) {
          return cache.has(key) ? cache.get(key) : null;
        },
        put(key, value) {
          cache.set(key, value);
        }
      };
    }
  };

  const UrlFetchApp = {
    fetch(url, options = {}) {
      return {
        getContentText() {
          return JSON.stringify({ ok: true, url, options });
        }
      };
    }
  };

  const MailApp = {
    sendEmail() {
      return true;
    }
  };

  const ScriptApp = {
    getProjectTriggers() {
      return [];
    },
    deleteTrigger() {
      return true;
    },
    newTrigger() {
      return {
        timeBased() {
          return {
            everyMinutes() {
              return {
                create() {
                  return true;
                }
              };
            }
          };
        }
      };
    }
  };

  const Logger = {
    log(message) {
      console.log(message);
    }
  };

  return {
    auth,
    PropertiesService,
    Session,
    Utilities,
    LockService,
    CacheService,
    UrlFetchApp,
    MailApp,
    ScriptApp,
    Logger
  };
}

function deriveName(email) {
  const local = String(email || '').split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) {
    return '';
  }
  return parts.map(capitalize).join(' ');
}

function capitalize(part) {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function formatDate(date, timeZone, format) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safeDate.getTime())) {
    return '';
  }

  if (format === 'yyyy-MM') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit'
    }).format(safeDate).replace(/\//g, '-');
  }

  if (format === 'yyyy-MM-dd') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(safeDate).replace(/\//g, '-');
  }

  if (format === 'MMM d') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric'
    }).format(safeDate);
  }

  if (format === 'h:mm a') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit'
    }).format(safeDate);
  }

  return new Intl.DateTimeFormat('en-US', { timeZone }).format(safeDate);
}

function sleepSync(ms) {
  if (!ms || ms <= 0) {
    return;
  }
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

module.exports = {
  createRuntime
};
