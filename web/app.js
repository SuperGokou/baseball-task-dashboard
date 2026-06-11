const elements = {
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  connectionTitle: document.querySelector("#connection-title"),
  loadingState: document.querySelector("#loading-state"),
  dashboard: document.querySelector("#dashboard"),
  projectFilter: document.querySelector("#project-filter"),
  hoursChart: document.querySelector("#hours-chart"),
  totalHours: document.querySelector("#total-hours"),
  totalSub: document.querySelector("#total-sub"),
  legendUpdated: document.querySelector("#legend-updated"),
  tasksTable: document.querySelector("#tasks-table"),
  tasksMeta: document.querySelector("#tasks-meta"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  message: document.querySelector("#message"),
  messageText: document.querySelector("#message-text"),
  messageDismiss: document.querySelector("#message-dismiss"),
};

const ALL_PROJECTS = "__all__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const state = { connected: false, dashboard: null, loginPollTimer: null, selectedProjectId: ALL_PROJECTS };

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

/** Build the data view for the selected project (or all projects combined). */
function currentView() {
  const d = state.dashboard;
  if (!d) return { days: [], tasks: [], totals: emptyTotals(), headline: "0h", sub: "" };
  if (state.selectedProjectId === ALL_PROJECTS) {
    const tasks = d.projects
      .flatMap((p) => (p.tasks || []).map((t) => ({ ...t, project: p.name })))
      .sort(sortTasks);
    return {
      days: d.days || [],
      tasks,
      totals: d.totals,
      headline: `${d.totals.hours.toFixed(1)}h`,
      sub: `${d.totals.taskCount} tasks · ${(d.lifetime?.totalHours ?? 0).toFixed(1)}h lifetime`,
    };
  }
  const p = d.projects.find((x) => x.id === state.selectedProjectId);
  const totals = p?.totals || emptyTotals();
  const tasks = (p?.tasks || []).map((t) => ({ ...t, project: p ? p.name : "" })).sort(sortTasks);
  return {
    days: p?.days || [],
    tasks,
    totals,
    headline: `${totals.hours.toFixed(1)}h`,
    sub: `${totals.taskCount} tasks${p ? " · " + p.kind : ""}`,
  };
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
        ? `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${escapeHtml(dayLabelOf(d.day))}: ${d.hours}h · ${d.taskCount} tasks</title></rect>`
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
    elements.tasksTable.innerHTML = `<tr><td colspan="5" class="empty-cell">No tasks worked in this view.</td></tr>`;
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
        `<td><div class="task-cell"><span class="task-title">${title}</span>${key}</div></td>` +
        `<td>${escapeHtml(t.project || "")}</td>` +
        `<td>${stage}</td>` +
        `<td class="num">${formatDuration(t.seconds)}</td>` +
        `</tr>`;
    })
    .join("");
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

setConnected(false);
refreshStatus();
