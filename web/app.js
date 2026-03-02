const state = {
  tasks: [],
  selected: new Set(),
  lastLogSeq: 0,
  defaultOutputDir: "",
  outputDirInitialized: false,
  nameHistory: [],
  nameHistoryIndex: null,
  drag: {
    active: false,
    startId: null,
    additive: false,
    baseSelection: new Set(),
  },
};

const els = {
  outputDir: document.getElementById("output-dir"),
  url: document.getElementById("video-url"),
  name: document.getElementById("video-name"),
  workers: document.getElementById("workers"),
  addBtn: document.getElementById("add-task-btn"),
  removeSelectedBtn: document.getElementById("remove-selected-btn"),
  clearFinishedBtn: document.getElementById("clear-finished-btn"),
  stopAllBtn: document.getElementById("stop-all-btn"),
  startBtn: document.getElementById("start-btn"),
  clearLogsBtn: document.getElementById("clear-logs-btn"),
  tableBody: document.getElementById("tasks-body"),
  logs: document.getElementById("logs"),
  status: document.getElementById("status"),
  statTotal: document.getElementById("stat-total"),
  statQueued: document.getElementById("stat-queued"),
  statRunning: document.getElementById("stat-running"),
  statCompleted: document.getElementById("stat-completed"),
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function hasStartableTasks() {
  return state.tasks.some((task) => task.status === "Queued" || task.status === "Failed");
}

function normalizeName(value) {
  let name = value.trim();
  if (name.toLowerCase().endsWith(".mp4")) {
    name = name.slice(0, -4);
  }
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
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function orderedTaskIds() {
  return state.tasks.map((task) => task.id);
}

function getTaskById(taskId) {
  return state.tasks.find((task) => task.id === taskId) || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusClassName(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

function updateActionStates() {
  const hasSelection = state.selected.size > 0;
  const hasRunning = state.tasks.some((task) => task.status === "Running");
  const hasFinished = state.tasks.some((task) =>
    ["Completed", "Failed", "Cancelled"].includes(task.status),
  );
  els.removeSelectedBtn.disabled = !hasSelection;
  els.stopAllBtn.disabled = !hasRunning;
  els.clearFinishedBtn.disabled = !hasFinished;
}

function renderSummary() {
  const summary = {
    total: state.tasks.length,
    queued: 0,
    running: 0,
    completed: 0,
  };
  for (const task of state.tasks) {
    if (task.status === "Queued") {
      summary.queued += 1;
    } else if (task.status === "Running") {
      summary.running += 1;
    } else if (task.status === "Completed") {
      summary.completed += 1;
    }
  }
  if (els.statTotal) {
    els.statTotal.textContent = String(summary.total);
  }
  if (els.statQueued) {
    els.statQueued.textContent = String(summary.queued);
  }
  if (els.statRunning) {
    els.statRunning.textContent = String(summary.running);
  }
  if (els.statCompleted) {
    els.statCompleted.textContent = String(summary.completed);
  }
}

function getRangeIds(firstId, lastId) {
  const ids = orderedTaskIds();
  const firstIdx = ids.indexOf(firstId);
  const lastIdx = ids.indexOf(lastId);
  if (firstIdx < 0 || lastIdx < 0) {
    return [];
  }
  const [start, end] = firstIdx <= lastIdx ? [firstIdx, lastIdx] : [lastIdx, firstIdx];
  return ids.slice(start, end + 1);
}

function applyDragSelection(currentId) {
  const rangeIds = getRangeIds(state.drag.startId, currentId);
  const rangeSet = new Set(rangeIds);
  if (state.drag.additive) {
    state.selected = new Set([...state.drag.baseSelection, ...rangeSet]);
  } else {
    state.selected = rangeSet;
  }
  renderTable();
}

function beginDragSelection(taskId, additive) {
  state.drag.active = true;
  state.drag.startId = taskId;
  state.drag.additive = additive;
  state.drag.baseSelection = additive ? new Set(state.selected) : new Set();
  applyDragSelection(taskId);
}

function endDragSelection() {
  state.drag.active = false;
  state.drag.startId = null;
  state.drag.baseSelection = new Set();
}

function rowHtml(task) {
  const selectedClass = state.selected.has(task.id) ? "selected" : "";
  const statusClass = statusClassName(task.status);
  return `
    <tr data-id="${task.id}" class="${selectedClass}">
      <td>${escapeHtml(task.url)}</td>
      <td>${escapeHtml(task.name)}</td>
      <td><span class="status-tag ${statusClass}">${escapeHtml(task.status)}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" data-action="edit" data-id="${task.id}">Edit</button>
          <button type="button" data-action="remove" data-id="${task.id}">Remove</button>
        </div>
      </td>
    </tr>
  `;
}

function renderTable() {
  if (state.tasks.length === 0) {
    els.tableBody.innerHTML = `
      <tr class="empty-state">
        <td colspan="4">No downloads in the queue yet. Add a link and output name to get started.</td>
      </tr>
    `;
  } else {
    els.tableBody.innerHTML = state.tasks.map(rowHtml).join("");
  }
  updateActionStates();
  renderSummary();
}

function keepSelectionValid() {
  const validIds = new Set(orderedTaskIds());
  state.selected = new Set([...state.selected].filter((taskId) => validIds.has(taskId)));
}

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
    state.tasks = data.tasks || [];
    keepSelectionValid();
    renderTable();
    els.startBtn.disabled = !!data.running || !hasStartableTasks();
    if (!data.yt_dlp_found) {
      setStatus("yt-dlp is not found. Install it with: brew install yt-dlp", true);
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function pollLogs() {
  try {
    const data = await api(`/api/logs?since=${state.lastLogSeq}`);
    const rows = data.rows || [];
    const nextSeq = Number(data.last_seq);
    if (Number.isFinite(nextSeq) && nextSeq >= 0) {
      state.lastLogSeq = nextSeq;
    }
    if (rows.length > 0) {
      const shouldStick = els.logs.scrollTop + els.logs.clientHeight >= els.logs.scrollHeight - 8;
      for (const row of rows) {
        els.logs.textContent += row.text;
      }
      if (shouldStick) {
        els.logs.scrollTop = els.logs.scrollHeight;
      }
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function addTask() {
  const url = els.url.value.trim();
  const name = normalizeName(els.name.value);
  if (!url || !name) {
    setStatus("Link and video name are required.", true);
    return;
  }
  try {
    await api("/api/tasks", "POST", { url, name });
    state.nameHistory.push(name);
    state.nameHistoryIndex = null;
    els.url.value = "";
    els.name.value = "";
    setStatus("Task added.");
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function startDownloads() {
  const outputDir = els.outputDir.value.trim() || state.defaultOutputDir;
  const workers = Number(els.workers.value || 4);
  if (!hasStartableTasks()) {
    setStatus("No queued downloads found.");
    return;
  }
  try {
    const data = await api("/api/start", "POST", { output_dir: outputDir, workers });
    if ((data.started || 0) > 0) {
      setStatus(`Started ${data.started} download(s).`);
    } else {
      setStatus("No queued downloads found.");
    }
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function removeSelected() {
  const ids = [...state.selected];
  if (ids.length === 0) {
    setStatus("No rows selected.", true);
    return;
  }
  try {
    const data = await api("/api/remove", "POST", { ids });
    state.selected = new Set();
    setStatus(`Removed ${data.removed} row(s).`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function removeOne(taskId) {
  try {
    const data = await api("/api/remove", "POST", { ids: [taskId] });
    state.selected.delete(taskId);
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
    state.selected = new Set();
    setStatus(`Stopped ${data.stopped} running task(s).`);
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function clearLogs() {
  try {
    try {
      await api("/api/logs/clear", "POST", {});
    } catch (err) {
      if (!String(err.message || "").includes("404")) {
        throw err;
      }
      await api("/api/clear-logs", "POST", {});
    }
    state.lastLogSeq = 0;
    els.logs.textContent = "";
    setStatus("Logs cleared.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function editTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) {
    return;
  }
  const nextUrl = window.prompt("Edit link (.m3u8):", task.url);
  if (nextUrl === null) {
    return;
  }
  const nextNameRaw = window.prompt("Edit output name:", task.name);
  if (nextNameRaw === null) {
    return;
  }
  const nextName = normalizeName(nextNameRaw);
  if (!nextUrl.trim() || !nextName) {
    setStatus("Link and video name are required.", true);
    return;
  }
  try {
    await api(`/api/tasks/${taskId}`, "PATCH", { url: nextUrl.trim(), name: nextName });
    setStatus("Task updated.");
    await refreshState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function bindEvents() {
  els.addBtn.addEventListener("click", addTask);
  els.startBtn.addEventListener("click", startDownloads);
  els.removeSelectedBtn.addEventListener("click", removeSelected);
  els.clearFinishedBtn.addEventListener("click", clearFinished);
  els.stopAllBtn.addEventListener("click", stopAllRunning);
  els.clearLogsBtn.addEventListener("click", clearLogs);

  els.url.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTask();
    }
  });

  els.name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTask();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (state.nameHistory.length === 0) {
        return;
      }
      if (state.nameHistoryIndex === null) {
        state.nameHistoryIndex = state.nameHistory.length - 1;
      } else if (state.nameHistoryIndex > 0) {
        state.nameHistoryIndex -= 1;
      }
      els.name.value = state.nameHistory[state.nameHistoryIndex];
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (state.nameHistory.length === 0 || state.nameHistoryIndex === null) {
        return;
      }
      if (state.nameHistoryIndex < state.nameHistory.length - 1) {
        state.nameHistoryIndex += 1;
        els.name.value = state.nameHistory[state.nameHistoryIndex];
      } else {
        state.nameHistoryIndex = null;
        els.name.value = "";
      }
      return;
    }

    state.nameHistoryIndex = null;
  });

  els.tableBody.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest("button")) {
      return;
    }
    const row = event.target.closest("tr[data-id]");
    if (!row) {
      return;
    }
    const taskId = row.dataset.id;
    const additive = event.metaKey || event.ctrlKey;
    beginDragSelection(taskId, additive);
    event.preventDefault();
  });

  els.tableBody.addEventListener("mouseover", (event) => {
    if (!state.drag.active) {
      return;
    }
    const row = event.target.closest("tr[data-id]");
    if (!row) {
      return;
    }
    const taskId = row.dataset.id;
    applyDragSelection(taskId);
  });

  document.addEventListener("mouseup", () => {
    endDragSelection();
  });

  els.tableBody.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("button[data-action]");
    if (!actionBtn) {
      return;
    }
    const taskId = actionBtn.dataset.id;
    const action = actionBtn.dataset.action;
    if (action === "edit") {
      editTask(taskId);
    } else if (action === "remove") {
      removeOne(taskId);
    }
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
