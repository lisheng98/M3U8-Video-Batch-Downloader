// Batch Downloader — 1c redesign frontend.
// Drop-in replacement for web/app.js. Backend (yt_dlp_web.py) unchanged:
// per-task logs are routed client-side from the "[name] " prefix the server
// already writes on every log line.

const HISTORY_KEYS = {
  url: "yt_dlp_url_history",
  name: "yt_dlp_name_history",
};
const HISTORY_LIMITS = {
  [HISTORY_KEYS.url]: 10,
  [HISTORY_KEYS.name]: 100,
};

function historyLimit(storageKey) {
  return HISTORY_LIMITS[storageKey] || 10;
}

function loadHistory(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(-historyLimit(storageKey));
  } catch (_err) {
    return [];
  }
}

function saveHistory(storageKey, values) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(values.slice(-historyLimit(storageKey))));
  } catch (_err) {
    // Ignore storage write failures.
  }
}

const MAX_TASK_LOG_LINES = 2000;

const state = {
  tasks: [],
  selectedId: null,
  allMode: false,
  lastLogSeq: 0,
  globalLog: "",
  taskLogs: new Map(), // task name -> array of lines
  defaultOutputDir: "",
  outputDirInitialized: false,
  availableFormats: ["mp4", "mkv", "webm", "mov", "original"],
  defaultOutputFormat: "mp4",
  outputFormatInitialized: false,
  urlHistory: loadHistory(HISTORY_KEYS.url),
  urlHistoryIndex: null,
  urlHistoryDraft: "",
  nameHistory: loadHistory(HISTORY_KEYS.name),
  nameHistoryIndex: null,
  nameHistoryDraft: "",
  editingTaskId: null,
  statusTimer: null,
  persistentStatus: "",
};

const els = {
  metaDir: document.getElementById("meta-dir"),
  metaFormat: document.getElementById("meta-format"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsDoneBtn: document.getElementById("settings-done-btn"),
  outputDir: document.getElementById("output-dir"),
  outputFormat: document.getElementById("output-format"),
  url: document.getElementById("video-url"),
  name: document.getElementById("video-name"),
  nameHistoryList: document.getElementById("video-name-history"),
  addBtn: document.getElementById("add-task-btn"),
  startBtn: document.getElementById("start-btn"),
  stopAllBtn: document.getElementById("stop-all-btn"),
  status: document.getElementById("status"),
  queueCount: document.getElementById("queue-count"),
  clearFinishedBtn: document.getElementById("clear-finished-btn"),
  queueList: document.getElementById("queue-list"),
  logTitle: document.getElementById("log-title"),
  logLive: document.getElementById("log-live"),
  allLogsBtn: document.getElementById("all-logs-btn"),
  clearLogsBtn: document.getElementById("clear-logs-btn"),
  logs: document.getElementById("logs"),
  logHint: document.getElementById("log-hint"),
  editModal: document.getElementById("edit-modal"),
  editTaskForm: document.getElementById("edit-task-form"),
  editUrl: document.getElementById("edit-video-url"),
  editName: document.getElementById("edit-video-name"),
  editModalCloseBtn: document.getElementById("edit-modal-close-btn"),
  editModalCancelBtn: document.getElementById("edit-modal-cancel-btn"),
};

function setStatus(message, isError = false) {
  clearTimeout(state.statusTimer);
  if (!message) {
    els.status.hidden = true;
    return;
  }
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
  els.status.hidden = false;
  if (!isError) {
    state.statusTimer = setTimeout(() => {
      els.status.hidden = true;
      if (state.persistentStatus) setStatus(state.persistentStatus, true);
    }, 3000);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function titleizeFormat(value) {
  return value === "original" ? "Original (source)" : value.toUpperCase();
}

function renderOutputFormatOptions() {
  const options = state.availableFormats
    .map((fmt) => `<option value="${escapeHtml(fmt)}">${escapeHtml(titleizeFormat(fmt))}</option>`)
    .join("");
  els.outputFormat.innerHTML = options;
  const selected = state.defaultOutputFormat || "mp4";
  els.outputFormat.value = state.availableFormats.includes(selected) ? selected : state.availableFormats[0];
}

function renderNameHistoryOptions() {
  const values = [...state.nameHistory].reverse();
  els.nameHistoryList.innerHTML = values
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
}

function pushHistory(kind, value) {
  const nextValue = String(value || "").trim();
  if (!nextValue) return;
  if (kind === "url") {
    state.urlHistory.push(nextValue);
    state.urlHistory = state.urlHistory.slice(-historyLimit(HISTORY_KEYS.url));
    saveHistory(HISTORY_KEYS.url, state.urlHistory);
    return;
  }
  const existingIndex = state.nameHistory.indexOf(nextValue);
  if (existingIndex !== -1) state.nameHistory.splice(existingIndex, 1);
  state.nameHistory.push(nextValue);
  state.nameHistory = state.nameHistory.slice(-historyLimit(HISTORY_KEYS.name));
  saveHistory(HISTORY_KEYS.name, state.nameHistory);
  renderNameHistoryOptions();
}

function setInputCursorToEnd(inputEl) {
  const length = inputEl.value.length;
  inputEl.setSelectionRange(length, length);
}

function handleHistoryNavigation(event, inputEl, historyKey, indexKey, draftKey) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  const history = state[historyKey];
  if (!Array.isArray(history) || history.length === 0) return false;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (state[indexKey] === null) {
      state[draftKey] = inputEl.value;
      state[indexKey] = history.length - 1;
    } else if (state[indexKey] > 0) {
      state[indexKey] -= 1;
    }
    inputEl.value = history[state[indexKey]];
    setInputCursorToEnd(inputEl);
    return true;
  }
  if (state[indexKey] === null) return false;
  event.preventDefault();
  if (state[indexKey] < history.length - 1) {
    state[indexKey] += 1;
    inputEl.value = history[state[indexKey]];
  } else {
    state[indexKey] = null;
    inputEl.value = state[draftKey] || "";
  }
  setInputCursorToEnd(inputEl);
  return true;
}

function isStartableTask(task) {
  return ["Queued", "Failed", "Cancelled"].includes(task.status);
}

function normalizeName(value) {
  let name = value.trim();
  if (name.toLowerCase().endsWith(".mp4")) name = name.slice(0, -4);
  return name.trim();
}

async function api(path, method = "GET", body = null) {
  const init = { method, headers: {} };
  if (body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getTaskById(taskId) {
  return state.tasks.find((task) => String(task.id) === String(taskId)) || null;
}

function statusClassName(status) {
  return String(status || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

// ----- Per-task log routing -----

function taskLogLines(name) {
  if (!state.taskLogs.has(name)) state.taskLogs.set(name, []);
  return state.taskLogs.get(name);
}

function routeLogText(text) {
  state.globalLog += text;
  if (state.globalLog.length > 400000) {
    state.globalLog = state.globalLog.slice(-400000);
  }
  const lines = String(text).split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^\[([^\]]+)\]\s?(.*)$/);
    if (match && state.taskLogs.has(match[1])) {
      const buf = taskLogLines(match[1]);
      buf.push(match[2]);
      if (buf.length > MAX_TASK_LOG_LINES) buf.splice(0, buf.length - MAX_TASK_LOG_LINES);
    } else if (match) {
      // A task name we have not seen in /api/state yet — register it anyway.
      const buf = taskLogLines(match[1]);
      buf.push(match[2]);
    }
    // Unprefixed lines (e.g. "All downloads finished.") stay global-only.
  }
}

function registerTaskNames() {
  for (const task of state.tasks) taskLogLines(task.name);
}

// ----- Rendering -----

function cardActionsHtml(task) {
  const buttons = [];
  if (task.status === "Running") {
    buttons.push(`<button type="button" data-action="stop" data-id="${task.id}">Stop</button>`);
  } else {
    if (isStartableTask(task)) {
      const label = task.status === "Queued" ? "Start" : "Retry";
      buttons.push(`<button type="button" data-action="start" data-id="${task.id}">${label}</button>`);
    }
    if (task.status !== "Completed") {
      buttons.push(`<button type="button" data-action="edit" data-id="${task.id}">Edit</button>`);
    }
    buttons.push(`<button type="button" data-action="remove" data-id="${task.id}">Remove</button>`);
  }
  return buttons.join("");
}

function cardHtml(task) {
  const selected = String(task.id) === String(state.selectedId) && !state.allMode ? " selected" : "";
  const statusClass = statusClassName(task.status);
  let progressHtml = "";
  if (task.status === "Running") {
    const progress = clampProgress(task.progress);
    const progressText = escapeHtml(task.progress_text || `${progress}%`);
    progressHtml = `
      <div class="qcard-bar"><div style="width: ${progress}%"></div></div>
      <div class="qcard-progress"><span>${progressText}</span></div>
    `;
  }
  return `
    <div class="qcard${selected}" data-id="${task.id}">
      <div class="qcard-head">
        <strong>${escapeHtml(task.name)}</strong>
        <span class="pill ${statusClass}">${escapeHtml(task.status)}</span>
      </div>
      <div class="qcard-url">${escapeHtml(task.url)}</div>
      ${progressHtml}
      <div class="qcard-actions">${cardActionsHtml(task)}</div>
    </div>
  `;
}

function renderQueue() {
  const running = state.tasks.filter((t) => t.status === "Running").length;
  const queued = state.tasks.filter((t) => t.status === "Queued").length;
  const parts = [`Queue \u00b7 ${state.tasks.length}`];
  if (running) parts.push(`${running} running`);
  if (queued) parts.push(`${queued} queued`);
  els.queueCount.textContent = parts.join(" \u00b7 ");

  if (state.tasks.length === 0) {
    els.queueList.innerHTML = `<div class="empty">Queue is empty. Paste a link above and press Enter.</div>`;
  } else {
    els.queueList.innerHTML = state.tasks.map(cardHtml).join("");
  }

  const hasFinished = state.tasks.some((t) => ["Completed", "Failed", "Cancelled"].includes(t.status));
  const hasRunning = running > 0;
  els.clearFinishedBtn.disabled = !hasFinished;
  els.stopAllBtn.disabled = !hasRunning;
  els.startBtn.disabled = !state.tasks.some(isStartableTask);
}

function renderLogPane() {
  const stick = els.logs.scrollTop + els.logs.clientHeight >= els.logs.scrollHeight - 8;
  els.allLogsBtn.classList.toggle("active", state.allMode);
  if (state.allMode) {
    els.logTitle.textContent = "all tasks (interleaved)";
    els.logs.textContent = state.globalLog || "No activity yet.";
    els.logLive.hidden = !state.tasks.some((t) => t.status === "Running");
    els.logHint.textContent = "Lines prefixed with [task name]. Click a queue card for a single-task view.";
  } else {
    const selected = getTaskById(state.selectedId);
    if (selected) {
      const lines = state.taskLogs.get(selected.name) || [];
      els.logTitle.textContent = selected.name;
      els.logs.textContent = lines.length ? lines.join("\n") : "No log output yet \u2014 press Start.";
      els.logLive.hidden = selected.status !== "Running";
    } else {
      els.logTitle.textContent = "\u2014";
      els.logs.textContent = "Select a task on the left to view its log.";
      els.logLive.hidden = true;
    }
    els.logHint.textContent = "Click a queue card to switch this pane to that task\u2019s log. No interleaving.";
  }
  if (stick) els.logs.scrollTop = els.logs.scrollHeight;
}

function renderMeta() {
  els.metaDir.textContent = els.outputDir.value.trim() || state.defaultOutputDir || "~/Downloads";
  els.metaFormat.textContent = titleizeFormat(els.outputFormat.value || state.defaultOutputFormat || "mp4");
}

// ----- Server sync -----

async function refreshState() {
  try {
    const data = await api("/api/state");
    if (typeof data.default_output_dir === "string" && data.default_output_dir) {
      state.defaultOutputDir = data.default_output_dir;
      if (!state.outputDirInitialized || !els.outputDir.value.trim()) {
        els.outputDir.value = state.defaultOutputDir;
      }
      state.outputDirInitialized = true;
    }
    if (Array.isArray(data.output_formats) && data.output_formats.length > 0) {
      state.availableFormats = data.output_formats;
    }
    if (typeof data.default_output_format === "string" && data.default_output_format) {
      state.defaultOutputFormat = data.default_output_format;
    }
    if (!state.outputFormatInitialized || !els.outputFormat.value) {
      renderOutputFormatOptions();
      state.outputFormatInitialized = true;
    }
    state.tasks = data.tasks || [];
    registerTaskNames();
    if (state.selectedId !== null && !getTaskById(state.selectedId)) {
      state.selectedId = null;
    }
    renderQueue();
    renderLogPane();
    renderMeta();
    if (!data.yt_dlp_found) {
      state.persistentStatus = "yt-dlp is not found. Install it with: brew install yt-dlp";
      setStatus(state.persistentStatus, true);
    } else {
      state.persistentStatus = "";
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function pollLogs() {
  try {
    const data = await api(`/api/logs?since=${state.lastLogSeq}`);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    let maxSeenSeq = state.lastLogSeq;
    if (rows.length > 0) {
      for (const row of rows) {
        const seq = Number(row.seq);
        if (Number.isFinite(seq)) {
          if (seq <= state.lastLogSeq) continue;
          maxSeenSeq = Math.max(maxSeenSeq, seq);
        }
        routeLogText(row.text);
      }
      state.lastLogSeq = maxSeenSeq;
      renderLogPane();
    } else {
      const nextSeq = Number(data.last_seq);
      if (Number.isFinite(nextSeq) && nextSeq > state.lastLogSeq) {
        state.lastLogSeq = nextSeq;
      }
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ----- Actions -----

function getDownloadSettings() {
  return {
    output_dir: els.outputDir.value.trim() || state.defaultOutputDir,
    output_format: (els.outputFormat.value || state.defaultOutputFormat || "mp4").toLowerCase(),
  };
}

async function addTask() {
  const url = els.url.value.trim();
  const name = normalizeName(els.name.value);
  if (!url || !name) {
    setStatus("Link and video name are required.", true);
    return;
  }
  try {
    const data = await api("/api/tasks", "POST", { url, name });
    pushHistory("url", url);
    pushHistory("name", name);
    state.urlHistoryIndex = null;
    state.nameHistoryIndex = null;
    state.urlHistoryDraft = "";
    state.nameHistoryDraft = "";
    els.url.value = "";
    els.name.value = "";
    if (data && data.task && data.task.id !== undefined) {
      state.selectedId = data.task.id;
      state.allMode = false;
    }
    setStatus("Task added.");
    await refreshState();
    if (state.selectedId === null && state.tasks.length > 0) {
      state.selectedId = state.tasks[state.tasks.length - 1].id;
      renderQueue();
      renderLogPane();
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function startDownloads() {
  if (!state.tasks.some(isStartableTask)) {
    setStatus("No queued downloads found.");
    return;
  }
  try {
    const data = await api("/api/start", "POST", getDownloadSettings());
    setStatus((data.started || 0) > 0 ? `Started ${data.started} download(s).` : "No queued downloads found.");
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function startTask(taskId) {
  const task = getTaskById(taskId);
  if (!task || !isStartableTask(task)) return;
  try {
    await api(`/api/tasks/${taskId}/start`, "POST", getDownloadSettings());
    state.selectedId = taskId;
    state.allMode = false;
    setStatus(`Started ${task.name}.`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function stopTask(taskId) {
  const task = getTaskById(taskId);
  if (!task || task.status !== "Running") return;
  try {
    await api(`/api/tasks/${taskId}/stop`, "POST", {});
    setStatus(`Stop requested for ${task.name}.`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function removeOne(taskId) {
  try {
    const data = await api("/api/remove", "POST", { ids: [taskId] });
    if (String(state.selectedId) === String(taskId)) state.selectedId = null;
    setStatus(`Removed ${data.removed} row(s).`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function clearFinished() {
  try {
    const data = await api("/api/clear-finished", "POST", {});
    setStatus(`Cleared ${data.removed} row(s).`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function stopAllRunning() {
  try {
    const data = await api("/api/stop-all", "POST", {});
    setStatus(`Stop requested for ${data.stopped} running task(s).`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function clearLogs() {
  try {
    if (state.allMode) {
      try {
        await api("/api/logs/clear", "POST", {});
      } catch (err) {
        if (!String(err.message || "").includes("404")) throw err;
        await api("/api/clear-logs", "POST", {});
      }
      state.lastLogSeq = 0;
      state.globalLog = "";
      state.taskLogs = new Map();
      registerTaskNames();
      setStatus("Logs cleared.");
    } else {
      const selected = getTaskById(state.selectedId);
      if (selected) {
        state.taskLogs.set(selected.name, []);
        setStatus(`Cleared log view for ${selected.name}.`);
      }
    }
    renderLogPane();
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ----- Edit modal -----

function closeEditModal() {
  els.editModal.hidden = true;
  state.editingTaskId = null;
  els.editUrl.value = "";
  els.editName.value = "";
}

function openEditModal(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;
  state.editingTaskId = taskId;
  els.editUrl.value = task.url;
  els.editName.value = task.name;
  els.editModal.hidden = false;
  els.editUrl.focus();
  setInputCursorToEnd(els.editUrl);
}

async function submitEditTask(event) {
  event.preventDefault();
  if (!state.editingTaskId) return;
  const nextUrl = els.editUrl.value.trim();
  const nextName = normalizeName(els.editName.value);
  if (!nextUrl || !nextName) {
    setStatus("Link and video name are required.", true);
    return;
  }
  try {
    await api(`/api/tasks/${state.editingTaskId}`, "PATCH", { url: nextUrl, name: nextName });
    closeEditModal();
    setStatus("Task updated.");
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ----- Events -----

function bindEvents() {
  renderNameHistoryOptions();

  els.settingsBtn.addEventListener("click", () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
  });
  els.settingsDoneBtn.addEventListener("click", () => {
    els.settingsPanel.hidden = true;
    renderMeta();
  });
  els.outputDir.addEventListener("input", renderMeta);
  els.outputFormat.addEventListener("change", renderMeta);

  els.addBtn.addEventListener("click", addTask);
  els.startBtn.addEventListener("click", startDownloads);
  els.stopAllBtn.addEventListener("click", stopAllRunning);
  els.clearFinishedBtn.addEventListener("click", clearFinished);
  els.clearLogsBtn.addEventListener("click", clearLogs);
  els.allLogsBtn.addEventListener("click", () => {
    state.allMode = !state.allMode;
    renderQueue();
    renderLogPane();
  });

  els.editTaskForm.addEventListener("submit", submitEditTask);
  els.editModalCloseBtn.addEventListener("click", closeEditModal);
  els.editModalCancelBtn.addEventListener("click", closeEditModal);
  els.editModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close-edit-modal") closeEditModal();
  });

  els.url.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTask();
      return;
    }
    handleHistoryNavigation(event, els.url, "urlHistory", "urlHistoryIndex", "urlHistoryDraft");
  });
  els.url.addEventListener("input", () => {
    state.urlHistoryIndex = null;
    state.urlHistoryDraft = els.url.value;
  });
  els.name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTask();
      return;
    }
    handleHistoryNavigation(event, els.name, "nameHistory", "nameHistoryIndex", "nameHistoryDraft");
  });
  els.name.addEventListener("input", () => {
    state.nameHistoryIndex = null;
    state.nameHistoryDraft = els.name.value;
  });

  els.queueList.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("button[data-action]");
    if (actionBtn) {
      const taskId = actionBtn.dataset.id;
      const action = actionBtn.dataset.action;
      if (action === "start") startTask(taskId);
      else if (action === "stop") stopTask(taskId);
      else if (action === "edit") openEditModal(taskId);
      else if (action === "remove") removeOne(taskId);
      return;
    }
    const card = event.target.closest(".qcard[data-id]");
    if (!card) return;
    state.selectedId = card.dataset.id;
    state.allMode = false;
    renderQueue();
    renderLogPane();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.editModal.hidden) closeEditModal();
  });
}

async function init() {
  bindEvents();
  await refreshState();
  await pollLogs();
  setInterval(refreshState, 1000);
  setInterval(pollLogs, 700);
}

init();
