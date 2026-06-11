const elements = {
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  connectionTitle: document.querySelector("#connection-title"),
  loadingState: document.querySelector("#loading-state"),
  dashboard: document.querySelector("#dashboard"),
  projectFilter: document.querySelector("#project-filter"),
  rangeFilter: document.querySelector("#range-filter"),
  stageFilter: document.querySelector("#stage-filter"),
  taskSearch: document.querySelector("#task-search"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  hoursChart: document.querySelector("#hours-chart"),
  totalHours: document.querySelector("#total-hours"),
  totalSub: document.querySelector("#total-sub"),
  legendUpdated: document.querySelector("#legend-updated"),
  tasksTable: document.querySelector("#tasks-table"),
  tasksWrap: document.querySelector(".tasks-wrap"),
  tasksMeta: document.querySelector("#tasks-meta"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  message: document.querySelector("#message"),
  messageText: document.querySelector("#message-text"),
  messageDismiss: document.querySelector("#message-dismiss"),
};

const ALL_PROJECTS = "__all__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const state = {
  connected: false,
  dashboard: null,
  loginPollTimer: null,
  selectedProjectId: ALL_PROJECTS,
  selectedRange: "all",
  selectedStage: "all",
  searchText: "",
};

function showMessage(text) {
  if (!elements.message) return;
  elements.messageText.textContent = text;
  elements.message.hidden = false;
}
function clearMessage() {
  if (elements.message) elements.message.hidden = true;
}

async function api(path, options) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function setConnected(connected, name) {
  state.connected = connected;
  elements.connectionTitle.textContent = connected ? `Signed in${name ? " · " + name : ""}` : "Not signed in";
  elements.saveLoginButton.hidden = true;
  elements.logoutButton.hidden = !connected;
  elements.refreshButton.hidden = !connected;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function emptyTotals() {
  return { seconds: 0, hours: 0, taskCount: 0, weekCount: 0, dayCount: 0 };
}

function dayLabelOf(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function formatDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(seconds) {
  const mins = Math.round((seconds || 0) / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** "00:05:27" — matches how the platform shows per-task time. */
function formatHMS(seconds) {
  const total = Math.round(seconds || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Color category for a pipeline stage pill. */
function stageClass(stage) {
  const s = (stage || "").toLowerCase();
  if (!s) return "pill-gray";
  if (s.includes("deliver")) return "pill-green";
  if (/pass@|evaluation|submitted/.test(s)) return "pill-violet";
  if (s.includes("audit") || /\breview\b/.test(s) || s.includes("rejected")) return "pill-blue";
  if (s.includes("fail") || s.includes("invalid")) return "pill-amber";
  return "pill-gray";
}

/** Earliest day ("YYYY-MM-DD") to include for the selected range, anchored to generatedAt. */
function rangeCutoff() {
  const d = state.dashboard;
  if (!d || state.selectedRange === "all") return null;
  const anchor = new Date(d.generatedAt);
  if (Number.isNaN(anchor.getTime())) return null;
  if (state.selectedRange === "week") {
    const dow = (anchor.getUTCDay() + 6) % 7; // Mon=0
    const mon = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - dow));
    return mon.toISOString().slice(0, 10);
  }
  const span = { "7d": 7, "14d": 14, "30d": 30 }[state.selectedRange];
  if (!span) return null;
  const from = new Date(anchor);
  from.setUTCDate(from.getUTCDate() - (span - 1));
  return from.toISOString().slice(0, 10);
}

/** Days + tasks for the selected project (or all projects), before filtering. */
function baseData() {
  const d = state.dashboard;
  if (state.selectedProjectId === ALL_PROJECTS) {
    const tasks = d.projects.flatMap((p) => (p.tasks || []).map((t) => ({ ...t, project: p.name })));
    return { days: d.days || [], tasks, lifetime: d.lifetime?.totalHours ?? 0, isAll: true, kind: "" };
  }
  const p = d.projects.find((x) => x.id === state.selectedProjectId);
  const tasks = (p?.tasks || []).map((t) => ({ ...t, project: p ? p.name : "" }));
  return { days: p?.days || [], tasks, lifetime: null, isAll: false, kind: p?.kind || "" };
}

/** Build the filtered data view for the current project + range + stage + search. */
function currentView() {
  const d = state.dashboard;
  if (!d) return { days: [], tasks: [], headline: "0h", sub: "" };
  const base = baseData();
  const cutoff = rangeCutoff();
  const inRange = (iso) => !cutoff || (!!iso && iso.slice(0, 10) >= cutoff);

  const days = base.days.filter((x) => inRange(x.day));
  const search = state.searchText.trim().toLowerCase();
  let tasks = base.tasks.filter((t) => inRange(t.date));
  if (state.selectedStage !== "all") tasks = tasks.filter((t) => (t.stage || "") === state.selectedStage);
  if (search) {
    tasks = tasks.filter((t) =>
      `${t.title || ""} ${t.taskKey || ""} ${t.id || ""}`.toLowerCase().includes(search)
    );
  }
  tasks.sort(sortTasks);

  const sumSeconds = days.reduce((s, x) => s + x.seconds, 0);
  const taskWord = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  const sub = base.isAll
    ? cutoff
      ? taskWord
      : `${taskWord} · ${base.lifetime.toFixed(1)}h lifetime`
    : `${taskWord}${base.kind ? " · " + base.kind : ""}`;

  return { days, tasks, headline: `${(sumSeconds / 3600).toFixed(1)}h`, sub };
}

function sortTasks(a, b) {
  const da = a.date || "";
  const db = b.date || "";
  if (da !== db) return da < db ? 1 : -1;
  return (b.seconds || 0) - (a.seconds || 0);
}

function niceCeil(v) {
  if (v <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

/** Fill in zero-hour days so the axis is continuous, like the reference chart. */
function continuousDays(days) {
  if (!days.length) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out = [];
  const cur = new Date(days[0].day + "T00:00:00Z");
  const end = new Date(days[days.length - 1].day + "T00:00:00Z");
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    const key = cur.toISOString().slice(0, 10);
    out.push(byDay.get(key) || { day: key, hours: 0, seconds: 0, taskCount: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function renderChart(days) {
  const series = continuousDays(days);
  if (!series.length) {
    elements.hoursChart.innerHTML = `<p class="chart-empty">No hours recorded yet.</p>`;
    return;
  }
  const VBW = 960, VBH = 320, padL = 48, padR = 16, padT = 18, padB = 40;
  const plotW = VBW - padL - padR;
  const plotH = VBH - padT - padB;
  const niceMax = niceCeil(Math.max(...series.map((d) => d.hours), 1));
  const slot = plotW / series.length;
  const barW = Math.min(28, slot * 0.6);
  const yFor = (h) => padT + plotH - (h / niceMax) * plotH;

  const ticks = [0, niceMax / 2, niceMax];
  const grid = ticks
    .map((t) => {
      const y = yFor(t);
      const label = t % 1 ? t.toFixed(1) : String(t);
      return `<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${VBW - padR}" y2="${y.toFixed(1)}"></line>` +
        `<text class="tick-label" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${label}h</text>`;
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(series.length / 10));
  const bars = series
    .map((d, i) => {
      const cx = padL + slot * (i + 0.5);
      const h = d.hours > 0 ? Math.max(2, (d.hours / niceMax) * plotH) : 0;
      const y = padT + plotH - h;
      const rect = h > 0
        ? `<rect class="bar" data-day="${d.day}" data-hours="${d.hours}" data-tasks="${d.taskCount}" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${escapeHtml(dayLabelOf(d.day))}: ${d.hours}h · ${d.taskCount} tasks</title></rect>`
        : "";
      const lab = i % labelEvery === 0
        ? `<text class="x-label" x="${cx.toFixed(1)}" y="${VBH - 16}" text-anchor="middle">${escapeHtml(dayLabelOf(d.day))}</text>`
        : "";
      return `<g>${rect}${lab}</g>`;
    })
    .join("");

  const axisY = padT + plotH + 0.5;
  elements.hoursChart.innerHTML =
    `<svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hours over time">` +
    `${grid}<line class="axis" x1="${padL}" y1="${axisY}" x2="${VBW - padR}" y2="${axisY}"></line>${bars}</svg>`;
}

function renderTasks(tasks) {
  if (!tasks.length) {
    elements.tasksTable.innerHTML = `<tr><td colspan="6" class="empty-cell">No tasks worked in this view.</td></tr>`;
    return;
  }
  elements.tasksTable.innerHTML = tasks
    .map((t) => {
      const title = escapeHtml(t.title || t.id);
      const key = t.taskKey ? `<span class="task-key">${escapeHtml(t.taskKey)}</span>` : "";
      const stage = t.stage
        ? `<span class="pill ${stageClass(t.stage)}">${escapeHtml(t.stage)}</span>`
        : `<span class="pill pill-gray">—</span>`;
      return `<tr>` +
        `<td class="nowrap">${formatDay(t.date)}</td>` +
        `<td class="task-id">${escapeHtml(t.id)}</td>` +
        `<td class="nowrap">${escapeHtml(t.project || "")}</td>` +
        `<td>${stage}</td>` +
        `<td class="num">${formatHMS(t.totalSeconds ?? t.seconds)}</td>` +
        `<td><div class="task-cell"><span class="task-title">${title}</span>${key}</div></td>` +
        `</tr>`;
    })
    .join("");
}

/** Click-and-drag horizontal scrolling for the (wide) tasks table. */
function enableDragScroll(el) {
  if (!el) return;
  let down = false, startX = 0, startLeft = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return;
    down = true;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    el.classList.add("dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!down) return;
    el.scrollLeft = startLeft - (e.clientX - startX);
  });
  const end = () => {
    down = false;
    el.classList.remove("dragging");
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointerleave", end);
}

function hideChartTooltip() {
  if (elements.chartTooltip) elements.chartTooltip.hidden = true;
}

/** Show a tooltip card above a clicked bar with the day's hours + task count. */
function showChartTooltip(rect) {
  const tip = elements.chartTooltip;
  if (!tip) return;
  const panel = elements.hoursChart.closest(".chart-panel");
  if (!panel) return;
  const pr = panel.getBoundingClientRect();
  const br = rect.getBoundingClientRect();
  const day = rect.getAttribute("data-day");
  const hours = rect.getAttribute("data-hours");
  const tasks = rect.getAttribute("data-tasks");
  tip.innerHTML =
    `<div class="tt-date">${escapeHtml(formatDay(day))}</div>` +
    `<div class="tt-row"><span class="tt-dot"></span><strong>${escapeHtml(hours)}h</strong> worked</div>` +
    `<div class="tt-sub">${escapeHtml(tasks)} task${tasks === "1" ? "" : "s"}</div>`;
  tip.hidden = false;
  const left = Math.min(Math.max(br.left + br.width / 2 - pr.left, 70), pr.width - 70);
  const top = br.top - pr.top;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function populateStageFilter(d) {
  if (!elements.stageFilter) return;
  const stages = new Set();
  for (const p of d.projects) for (const t of p.tasks || []) if (t.stage) stages.add(t.stage);
  const sorted = [...stages].sort((a, b) => a.localeCompare(b));
  elements.stageFilter.innerHTML =
    `<option value="all">All stages</option>` +
    sorted.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if (state.selectedStage !== "all" && !stages.has(state.selectedStage)) state.selectedStage = "all";
  elements.stageFilter.value = state.selectedStage;
}

function populateProjectFilter(d) {
  if (!elements.projectFilter) return;
  const options = [`<option value="${ALL_PROJECTS}">All projects</option>`].concat(
    d.projects.map((p) =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${(p.totals?.hours ?? 0).toFixed(1)}h)</option>`
    )
  );
  elements.projectFilter.innerHTML = options.join("");
  if (!d.projects.some((p) => p.id === state.selectedProjectId)) {
    state.selectedProjectId = ALL_PROJECTS;
  }
  elements.projectFilter.value = state.selectedProjectId;
}

function renderCurrentView() {
  hideChartTooltip();
  const view = currentView();
  elements.totalHours.textContent = view.headline;
  elements.totalSub.textContent = view.sub;
  renderChart(view.days);
  renderTasks(view.tasks);
  elements.tasksMeta.textContent = `${view.tasks.length} task${view.tasks.length === 1 ? "" : "s"}`;
}

function renderDashboard(d) {
  state.dashboard = d;
  populateProjectFilter(d);
  populateStageFilter(d);
  renderCurrentView();
  if (elements.mastheadMeta) elements.mastheadMeta.hidden = false;
  const stamp = new Date(d.generatedAt).toLocaleString();
  if (elements.generatedAt) elements.generatedAt.textContent = stamp;
  if (elements.legendUpdated) elements.legendUpdated.textContent = `Updated ${stamp}`;
  if (d.warnings && d.warnings.length) showMessage(d.warnings.join(" "));
}

async function loadDashboard() {
  elements.loadingState.hidden = false;
  elements.dashboard.hidden = true;
  try {
    const data = await api("/api/dashboard", { method: "POST", body: JSON.stringify({}) });
    renderDashboard(data);
    elements.dashboard.hidden = false;
  } catch (err) {
    showMessage(err.message);
    if (/sign in|expired/i.test(err.message)) setConnected(false);
  } finally {
    elements.loadingState.hidden = true;
  }
}

async function refreshStatus() {
  try {
    const status = await api("/api/status");
    setConnected(status.connected, status.profile?.name);
    if (status.connected) await loadDashboard();
  } catch (err) {
    setConnected(false);
    showMessage(err.message);
  }
}

function startLoginPoll() {
  clearInterval(state.loginPollTimer);
  let tries = 0;
  state.loginPollTimer = setInterval(async () => {
    tries += 1;
    try {
      const status = await api("/api/status");
      if (status.connected) {
        clearInterval(state.loginPollTimer);
        clearMessage();
        setConnected(true, status.profile?.name);
        await loadDashboard();
      }
    } catch {
      /* keep polling */
    }
    if (tries > 150) clearInterval(state.loginPollTimer);
  }, 2000);
}

async function onConnect() {
  try {
    showMessage("Opening login window… finish signing in there.");
    await api("/api/connect/start", { method: "POST", body: JSON.stringify({}) });
    elements.saveLoginButton.hidden = false;
    startLoginPoll();
  } catch (err) {
    showMessage(err.message);
  }
}

async function onSaveLogin() {
  try {
    const result = await api("/api/connect/save", { method: "POST", body: JSON.stringify({}) });
    clearInterval(state.loginPollTimer);
    clearMessage();
    setConnected(true, result.profile?.name);
    await loadDashboard();
  } catch (err) {
    showMessage(err.message);
  }
}

async function onLogout() {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    setConnected(false);
    elements.dashboard.hidden = true;
  }
}

elements.connectButton?.addEventListener("click", onConnect);
elements.saveLoginButton?.addEventListener("click", onSaveLogin);
elements.logoutButton?.addEventListener("click", onLogout);
elements.refreshButton?.addEventListener("click", loadDashboard);
elements.messageDismiss?.addEventListener("click", clearMessage);
elements.projectFilter?.addEventListener("change", (e) => {
  state.selectedProjectId = e.target.value;
  renderCurrentView();
});
elements.rangeFilter?.addEventListener("change", (e) => {
  state.selectedRange = e.target.value;
  renderCurrentView();
});
elements.stageFilter?.addEventListener("change", (e) => {
  state.selectedStage = e.target.value;
  renderCurrentView();
});
elements.taskSearch?.addEventListener("input", (e) => {
  state.searchText = e.target.value;
  renderCurrentView();
});
elements.hoursChart?.addEventListener("click", (e) => {
  const bar = e.target.closest(".bar");
  if (bar) showChartTooltip(bar);
  else hideChartTooltip();
});

enableDragScroll(elements.tasksWrap);
setConnected(false);
refreshStatus();
