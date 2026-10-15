/**
 * DentalFlow - Google Apps Script backend
 * Spreadsheet-backed dental laboratory workflow management.
 *
 * First run: run setupDentalFlow() from the Apps Script editor.
 * Do not deploy as "Anyone" for real operational data.
 */

const DF = {
  SHEETS: {
    ORDERS: "Orders",
    PROCESSES: "Processes",
    HISTORY: "History",
    SETTINGS: "Settings"
  },
  ORDER_HEADERS: [
    "orderId", "clinic", "restoration", "material", "tooth", "technician",
    "receivedDate", "dueDate", "priority", "status", "notes",
    "isSample", "createdAt", "updatedAt"
  ],
  PROCESS_HEADERS: [
    "processId", "orderId", "code", "name", "technician", "status",
    "startedAt", "completedAt", "sequence"
  ],
  HISTORY_HEADERS: [
    "historyId", "orderId", "changedAt", "field", "beforeValue",
    "afterValue", "actor", "note"
  ],
  SETTINGS_HEADERS: ["key", "value"],
  STATUSES: ["접수 대기", "작업 진행 중", "품질검사", "출고 완료", "보류"],
  PROCESS_STATUSES: ["대기", "진행 중", "완료", "생략"],
  TIMEZONE: "Asia/Seoul"
};

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("DentalFlow | 치과기공 작업 관리")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Initialize required sheets and add clearly marked sample orders if Orders is empty.
 * Safe to run more than once: existing data is retained.
 */
function setupDentalFlow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("이 스크립트를 Google 스프레드시트에 연결한 뒤 실행하세요.");
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());

  ensureSheet_(ss, DF.SHEETS.ORDERS, DF.ORDER_HEADERS);
  ensureSheet_(ss, DF.SHEETS.PROCESSES, DF.PROCESS_HEADERS);
  ensureSheet_(ss, DF.SHEETS.HISTORY, DF.HISTORY_HEADERS);
  ensureSheet_(ss, DF.SHEETS.SETTINGS, DF.SETTINGS_HEADERS);

  const settings = ss.getSheetByName(DF.SHEETS.SETTINGS);
  if (settings.getLastRow() === 1) {
    settings.getRange(2, 1, 6, 2).setValues([
      ["appName", "DentalFlow"],
      ["timezone", DF.TIMEZONE],
      ["nearDueDays", "2"],
      ["defaultTechnician", ""],
      ["sampleDataCreated", "false"],
      ["schemaVersion", "1"]
    ]);
  }

  const orders = ss.getSheetByName(DF.SHEETS.ORDERS);
  if (orders.getLastRow() === 1) {
    seedSampleData_(ss);
  }
  formatSheets_(ss);
  return { ok: true, message: "DentalFlow 시트 초기화가 완료되었습니다.", spreadsheetUrl: ss.getUrl() };
}

function getAppData() {
  const ss = getSpreadsheet_();
  return {
    ok: true,
    orders: readObjects_(ss.getSheetByName(DF.SHEETS.ORDERS)),
    processes: readObjects_(ss.getSheetByName(DF.SHEETS.PROCESSES)),
    history: readObjects_(ss.getSheetByName(DF.SHEETS.HISTORY)).slice(-100).reverse(),
    settings: getSettings_(ss),
    serverDate: Utilities.formatDate(new Date(), DF.TIMEZONE, "yyyy-MM-dd"),
    userEmail: safeUserEmail_()
  };
}

function saveOrder(payload) {
  payload = payload || {};
  validateOrder_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(DF.SHEETS.ORDERS);
    const rows = readObjects_(sheet);
    const orderId = clean_(payload.orderId) || generateOrderId_();
    const exists = rows.find(r => String(r.orderId) === orderId);
    const isUpdate = Boolean(payload.orderId);

    if (isUpdate && !exists) throw new Error("수정할 의뢰를 찾을 수 없습니다.");
    if (!isUpdate && exists) throw new Error("중복 의뢰번호입니다. 다시 시도해 주세요.");

    const now = new Date();
    const record = {
      orderId: orderId,
      clinic: clean_(payload.clinic),
      restoration: clean_(payload.restoration),
      material: clean_(payload.material),
      tooth: clean_(payload.tooth),
      technician: clean_(payload.technician),
      receivedDate: clean_(payload.receivedDate),
      dueDate: clean_(payload.dueDate),
      priority: clean_(payload.priority) || "보통",
      status: DF.STATUSES.includes(payload.status) ? payload.status : "접수 대기",
      notes: clean_(payload.notes),
      isSample: isUpdate ? Boolean(exists.isSample) : false,
      createdAt: isUpdate ? exists.createdAt : now,
      updatedAt: now
    };

    if (isUpdate) {
      const rowNum = findRowByKey_(sheet, "orderId", orderId);
      const before = exists;
      writeObjectRow_(sheet, DF.ORDER_HEADERS, rowNum, record);
      logChanges_(ss, orderId, before, record, ["clinic","restoration","material","tooth","technician","receivedDate","dueDate","priority","status","notes"]);
    } else {
      sheet.appendRow(DF.ORDER_HEADERS.map(h => record[h] === undefined ? "" : record[h]));
      logHistory_(ss, orderId, "의뢰 등록", "", "신규 의뢰", "의뢰가 등록되었습니다.");
      createProcessesForOrder_(ss, record, payload.processes);
    }
    return { ok: true, orderId: orderId, message: isUpdate ? "의뢰 정보가 수정되었습니다." : "새 의뢰가 등록되었습니다." };
  } finally {
    lock.releaseLock();
  }
}

function deleteOrder(orderId) {
  orderId = clean_(orderId);
  if (!orderId) throw new Error("의뢰번호가 필요합니다.");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const orders = ss.getSheetByName(DF.SHEETS.ORDERS);
    const row = findRowByKey_(orders, "orderId", orderId);
    if (!row) throw new Error("삭제할 의뢰를 찾을 수 없습니다.");
    const obj = readObjectAtRow_(orders, DF.ORDER_HEADERS, row);
    if (obj.isSample === true || String(obj.isSample).toLowerCase() === "true") {
      // Sample records can be deleted, but are explicitly logged.
    }
    orders.deleteRow(row);
    deleteRowsByOrderId_(ss.getSheetByName(DF.SHEETS.PROCESSES), orderId);
    logHistory_(ss, orderId, "의뢰 삭제", obj.clinic || "", "삭제됨", "의뢰 및 연결 공정이 삭제되었습니다.");
    return { ok: true, message: "의뢰와 연결된 공정이 삭제되었습니다." };
  } finally {
    lock.releaseLock();
  }
}

function updateOrderStatus(orderId, status) {
  orderId = clean_(orderId);
  if (!DF.STATUSES.includes(status)) throw new Error("올바르지 않은 작업 상태입니다.");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(DF.SHEETS.ORDERS);
    const row = findRowByKey_(sheet, "orderId", orderId);
    if (!row) throw new Error("의뢰를 찾을 수 없습니다.");
    const record = readObjectAtRow_(sheet, DF.ORDER_HEADERS, row);
    const before = record.status;
    record.status = status;
    record.updatedAt = new Date();
    writeObjectRow_(sheet, DF.ORDER_HEADERS, row, record);
    logHistory_(ss, orderId, "상태", before, status, "작업 상태 변경");
    return { ok: true, message: "작업 상태가 변경되었습니다." };
  } finally {
    lock.releaseLock();
  }
}

function updateProcess(payload) {
  payload = payload || {};
  const processId = clean_(payload.processId);
  const status = clean_(payload.status);
  if (!processId) throw new Error("공정 ID가 필요합니다.");
  if (!DF.PROCESS_STATUSES.includes(status)) throw new Error("올바르지 않은 공정 상태입니다.");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(DF.SHEETS.PROCESSES);
    const row = findRowByKey_(sheet, "processId", processId);
    if (!row) throw new Error("공정을 찾을 수 없습니다.");
    const rec = readObjectAtRow_(sheet, DF.PROCESS_HEADERS, row);
    const before = rec.status;
    rec.status = status;
    if (status === "진행 중" && !rec.startedAt) rec.startedAt = new Date();
    if (status === "완료") rec.completedAt = new Date();
    if (status !== "완료") rec.completedAt = "";
    rec.technician = clean_(payload.technician) || rec.technician;
    writeObjectRow_(sheet, DF.PROCESS_HEADERS, row, rec);
    logHistory_(ss, rec.orderId, "공정: " + rec.name, before, status, "공정 상태 변경");

    syncOrderStatus_(ss, rec.orderId);
    return { ok: true, message: "공정 상태가 변경되었습니다." };
  } finally {
    lock.releaseLock();
  }
}

function getReportData() {
  const data = getAppData();
  const orders = data.orders;
  const processes = data.processes;
  const byStatus = {};
  DF.STATUSES.forEach(s => byStatus[s] = 0);
  orders.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });

  const byTechnician = {};
  orders.forEach(o => {
    const name = o.technician || "미지정";
    if (!byTechnician[name]) byTechnician[name] = { technician: name, total: 0, active: 0, completed: 0, delayed: 0 };
    byTechnician[name].total++;
    if (o.status === "출고 완료") byTechnician[name].completed++;
    else byTechnician[name].active++;
    if (isDelayed_(o, data.serverDate)) byTechnician[name].delayed++;
  });

  const processCounts = {};
  processes.forEach(p => {
    if (!processCounts[p.name]) processCounts[p.name] = { name: p.name, pending: 0, active: 0, complete: 0, skipped: 0 };
    if (p.status === "대기") processCounts[p.name].pending++;
    if (p.status === "진행 중") processCounts[p.name].active++;
    if (p.status === "완료") processCounts[p.name].complete++;
    if (p.status === "생략") processCounts[p.name].skipped++;
  });

  const shipped = orders.filter(o => o.status === "출고 완료");
  const onTime = shipped.filter(o => !o.dueDate || String(o.dueDate) >= String(o.updatedAt || data.serverDate).slice(0,10)).length;
  return {
    ok: true,
    statusCounts: byStatus,
    technicianStats: Object.values(byTechnician),
    processStats: Object.values(processCounts),
    onTimeRate: shipped.length ? Math.round(onTime / shipped.length * 100) : 0,
    total: orders.length,
    delayed: orders.filter(o => isDelayed_(o, data.serverDate)).length
  };
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("연결된 스프레드시트를 찾을 수 없습니다. README의 설정 단계를 확인하세요. setupDentalFlow()를 먼저 실행하세요.");
  [DF.SHEETS.ORDERS, DF.SHEETS.PROCESSES, DF.SHEETS.HISTORY, DF.SHEETS.SETTINGS].forEach(name => {
    if (!ss.getSheetByName(name)) throw new Error("필수 시트 '" + name + "'가 없습니다. setupDentalFlow()를 먼저 실행하세요.");
  });
  return ss;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  else {
    const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
    if (headers.some((h, i) => existing[i] !== h)) {
      if (sh.getLastRow() === 1) {
        sh.clear();
        sh.appendRow(headers);
      } else {
        throw new Error("시트 '" + name + "'의 헤더가 예상과 다릅니다. 기존 데이터를 백업하고 헤더를 확인하세요.");
      }
    }
  }
  sh.setFrozenRows(1);
}

function readObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== "")).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = serializeValue_(row[i]));
    return obj;
  });
}

function serializeValue_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, DF.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  return value;
}

function readObjectAtRow_(sheet, headers, rowNum) {
  const values = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const out = {};
  headers.forEach((h, i) => out[h] = serializeValue_(values[i]));
  return out;
}

function writeObjectRow_(sheet, headers, rowNum, obj) {
  sheet.getRange(rowNum, 1, 1, headers.length).setValues([headers.map(h => obj[h] === undefined ? "" : obj[h])]);
}

function findRowByKey_(sheet, key, value) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = headers.indexOf(key) + 1;
  if (!col) throw new Error("키 컬럼을 찾을 수 없습니다: " + key);
  const found = sheet.getRange(2, col, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function validateOrder_(p) {
  const required = [
    ["clinic", "거래 치과"],
    ["restoration", "보철물 종류"],
    ["material", "재료"],
    ["technician", "담당 기공사"],
    ["receivedDate", "접수일"],
    ["dueDate", "납기일"]
  ];
  required.forEach(pair => {
    if (!clean_(p[pair[0]])) throw new Error(pair[1] + " 항목은 필수입니다.");
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean_(p.receivedDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(clean_(p.dueDate))) {
    throw new Error("접수일과 납기일은 YYYY-MM-DD 형식이어야 합니다.");
  }
  if (p.dueDate < p.receivedDate) throw new Error("납기일은 접수일보다 빠를 수 없습니다.");
  if (clean_(p.orderId) && clean_(p.orderId).length > 40) throw new Error("의뢰번호는 40자 이내로 입력하세요.");
  if (!["낮음","보통","높음","긴급"].includes(p.priority || "보통")) throw new Error("올바른 우선순위를 선택하세요.");
}

function createProcessesForOrder_(ss, order, requestedProcesses) {
  const defaults = defaultProcesses_(order.restoration, order.material);
  const selected = Array.isArray(requestedProcesses) && requestedProcesses.length
    ? requestedProcesses.map((p, i) => ({
        code: clean_(p.code) || "CUSTOM_" + (i + 1),
        name: clean_(p.name) || "사용자 공정 " + (i + 1),
        technician: clean_(p.technician) || order.technician,
        sequence: i + 1
      }))
    : defaults;
  const sh = ss.getSheetByName(DF.SHEETS.PROCESSES);
  selected.forEach(p => sh.appendRow([
    Utilities.getUuid(), order.orderId, p.code, p.name, p.technician || order.technician,
    "대기", "", "", p.sequence
  ]));
}

function defaultProcesses_(restoration, material) {
  const steps = [
    ["INTAKE", "의뢰 접수"],
    ["PREP", "작업 준비 및 모델 확인"],
    ["CAD", "CAD 디자인"],
    ["CAM", "CAM 가공 및 밀링"]
  ];
  if (!/PMMA 임시|임시 보철/i.test(restoration + " " + material)) steps.push(["SINTER", "소결 또는 후처리"]);
  steps.push(["FINISH", "컨투어링 및 마무리"], ["QC", "품질검사 및 적합성 확인"], ["SHIP", "최종 출고"]);
  return steps.map((p, i) => ({ code: p[0], name: p[1], technician: "", sequence: i + 1 }));
}

function syncOrderStatus_(ss, orderId) {
  const ps = readObjects_(ss.getSheetByName(DF.SHEETS.PROCESSES)).filter(p => String(p.orderId) === String(orderId));
  if (!ps.length) return;
  let next = "작업 진행 중";
  if (ps.every(p => p.status === "완료" || p.status === "생략")) next = "출고 완료";
  else if (ps.some(p => p.code === "QC" && p.status === "진행 중")) next = "품질검사";
  else if (ps.every(p => p.status === "대기")) next = "접수 대기";
  const sheet = ss.getSheetByName(DF.SHEETS.ORDERS);
  const row = findRowByKey_(sheet, "orderId", orderId);
  if (!row) return;
  const rec = readObjectAtRow_(sheet, DF.ORDER_HEADERS, row);
  if (rec.status !== "보류") {
    const before = rec.status;
    rec.status = next;
    rec.updatedAt = new Date();
    writeObjectRow_(sheet, DF.ORDER_HEADERS, row, rec);
    if (before !== next) logHistory_(ss, orderId, "상태(자동)", before, next, "공정 진행에 따라 자동 갱신");
  }
}

function logChanges_(ss, orderId, before, after, fields) {
  fields.forEach(field => {
    if (String(before[field] == null ? "" : before[field]) !== String(after[field] == null ? "" : after[field])) {
      logHistory_(ss, orderId, field, before[field], after[field], "의뢰 정보 수정");
    }
  });
}

function logHistory_(ss, orderId, field, beforeValue, afterValue, note) {
  ss.getSheetByName(DF.SHEETS.HISTORY).appendRow([
    Utilities.getUuid(), orderId, new Date(), field,
    beforeValue == null ? "" : String(beforeValue),
    afterValue == null ? "" : String(afterValue),
    safeUserEmail_(), note || ""
  ]);
}

function deleteRowsByOrderId_(sheet, orderId) {
  if (sheet.getLastRow() < 2) return;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const col = headers.indexOf("orderId");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(orderId)) sheet.deleteRow(i + 1);
  }
}

function getSettings_(ss) {
  const out = {};
  readObjects_(ss.getSheetByName(DF.SHEETS.SETTINGS)).forEach(r => out[r.key] = r.value);
  return out;
}

function seedSampleData_(ss) {
  const today = new Date();
  const dateStr = d => Utilities.formatDate(d, DF.TIMEZONE, "yyyy-MM-dd");
  const addDays = n => { const d = new Date(today); d.setDate(d.getDate() + n); return dateStr(d); };
  const sample = [
    ["DF-DEMO-1001","서울미소치과","크라운","지르코니아","11","김기공",addDays(-2),addDays(0),"높음","품질검사","샘플 데이터 · 전치부 심미 확인",true,new Date(),new Date()],
    ["DF-DEMO-1002","바른이치과","브리지","지르코니아","35-37","이기공",addDays(-1),addDays(1),"보통","작업 진행 중","샘플 데이터 · 커넥터 두께 확인",true,new Date(),new Date()],
    ["DF-DEMO-1003","온유치과","인레이","세라믹","26","박기공",addDays(0),addDays(3),"보통","접수 대기","샘플 데이터 · 교합면 형태 확인",true,new Date(),new Date()],
    ["DF-DEMO-1004","한결치과","임플란트 보철","지르코니아","46","김기공",addDays(-5),addDays(-1),"긴급","작업 진행 중","샘플 데이터 · 임플란트 연결부 확인",true,new Date(),new Date()],
    ["DF-DEMO-1005","늘봄치과","임시 크라운","PMMA","21","이기공",addDays(-1),addDays(2),"낮음","출고 완료","샘플 데이터 · 임시 보철",true,new Date(),new Date()]
  ];
  const sh = ss.getSheetByName(DF.SHEETS.ORDERS);
  sh.getRange(2, 1, sample.length, DF.ORDER_HEADERS.length).setValues(sample);
  sample.forEach(row => {
    const order = {};
    DF.ORDER_HEADERS.forEach((h, i) => order[h] = row[i]);
    const defaults = defaultProcesses_(order.restoration, order.material);
    defaults.forEach((p, i) => {
      let status = "대기";
      if (order.status === "출고 완료") status = "완료";
      else if (order.status === "품질검사" && p.code === "QC") status = "진행 중";
      else if (order.status === "작업 진행 중" && i < 3) status = "완료";
      ss.getSheetByName(DF.SHEETS.PROCESSES).appendRow([
        Utilities.getUuid(), order.orderId, p.code, p.name, order.technician,
        status, status === "진행 중" || status === "완료" ? new Date() : "",
        status === "완료" ? new Date() : "", p.sequence
      ]);
    });
    logHistory_(ss, order.orderId, "샘플 데이터", "", "생성", "테스트용 가상 의뢰 데이터");
  });
  const settings = ss.getSheetByName(DF.SHEETS.SETTINGS);
  const rows = settings.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === "sampleDataCreated") settings.getRange(i + 1, 2).setValue("true");
}

function formatSheets_(ss) {
  Object.values(DF.SHEETS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold").setBackground("#102C4A").setFontColor("#FFFFFF");
    sh.autoResizeColumns(1, sh.getLastColumn());
  });
}

function generateOrderId_() {
  return "DF-" + Utilities.formatDate(new Date(), DF.TIMEZONE, "yyyyMMdd-HHmmss") + "-" + Math.floor(Math.random() * 900 + 100);
}
function clean_(value) { return String(value == null ? "" : value).trim(); }
function safeUserEmail_() {
  try { return Session.getActiveUser().getEmail() || "미확인"; }
  catch (e) { return "미확인"; }
}
function isDelayed_(order, today) {
  return order.status !== "출고 완료" && order.status !== "보류" && order.dueDate && String(order.dueDate).slice(0,10) < today;
}
