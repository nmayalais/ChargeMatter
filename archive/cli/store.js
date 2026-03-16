'use strict';

const fs = require('fs');
const path = require('path');

function defaultStore() {
  return {
    properties: {},
    sheets: {}
  };
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const rowIndex = this.row + r;
      if (rowIndex === 1) {
        const headerRow = this.sheet.data.headers.slice();
        values.push(headerRow.slice(this.col - 1, this.col - 1 + this.numCols));
        continue;
      }
      const dataIndex = rowIndex - 2;
      const dataRow = this.sheet.data.rows[dataIndex] || [];
      const rowValues = [];
      for (let c = 0; c < this.numCols; c += 1) {
        const value = dataRow[this.col - 1 + c];
        rowValues.push(value === undefined ? '' : value);
      }
      values.push(rowValues);
    }
    return values;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r += 1) {
      const rowIndex = this.row + r;
      const rowValues = values[r] || [];
      if (rowIndex === 1) {
        const nextHeaders = this.sheet.data.headers.slice();
        for (let c = 0; c < rowValues.length; c += 1) {
          const headerIndex = this.col - 1 + c;
          nextHeaders[headerIndex] = rowValues[c];
        }
        this.sheet.data.headers = trimTrailingEmpty(nextHeaders);
        continue;
      }
      const dataIndex = rowIndex - 2;
      while (this.sheet.data.rows.length <= dataIndex) {
        this.sheet.data.rows.push([]);
      }
      const target = this.sheet.data.rows[dataIndex];
      for (let c = 0; c < rowValues.length; c += 1) {
        target[this.col - 1 + c] = rowValues[c];
      }
      this.sheet.data.rows[dataIndex] = trimTrailingEmpty(target);
    }
  }

  setValue(value) {
    this.setValues([[value]]);
  }
}

class Sheet {
  constructor(name, data) {
    this.name = name;
    this.data = data;
  }

  getLastRow() {
    if (!this.data.headers.length && !this.data.rows.length) {
      return 0;
    }
    return this.data.rows.length + 1;
  }

  getLastColumn() {
    return this.data.headers.length;
  }

  getRange(row, col, numRows, numCols) {
    return new Range(this, row, col, numRows, numCols);
  }

  setFrozenRows() {
    return null;
  }

  appendRow(row) {
    const next = Array.isArray(row) ? row.slice() : [];
    this.data.rows.push(next);
  }
}

class Spreadsheet {
  constructor(store) {
    this.store = store;
  }

  getSheetByName(name) {
    const entry = this.store.sheets[name];
    if (!entry) {
      return null;
    }
    return new Sheet(name, entry);
  }

  insertSheet(name) {
    if (!this.store.sheets[name]) {
      this.store.sheets[name] = { headers: [], rows: [] };
    }
    return new Sheet(name, this.store.sheets[name]);
  }
}

function trimTrailingEmpty(values) {
  let end = values.length;
  while (end > 0) {
    const value = values[end - 1];
    if (value !== '' && value !== undefined && value !== null) {
      break;
    }
    end -= 1;
  }
  return values.slice(0, end);
}

function loadStore(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return defaultStore();
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  if (!raw.trim()) {
    return defaultStore();
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    return defaultStore();
  }
  parsed.properties = parsed.properties || {};
  parsed.sheets = parsed.sheets || {};
  return parsed;
}

function saveStore(filePath, store) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const payload = JSON.stringify(store, null, 2);
  fs.writeFileSync(resolved, payload);
}

function ensureSheet(store, name) {
  if (!store.sheets[name]) {
    store.sheets[name] = { headers: [], rows: [] };
  }
}

module.exports = {
  Spreadsheet,
  loadStore,
  saveStore,
  ensureSheet,
  defaultStore
};
