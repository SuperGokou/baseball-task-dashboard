const elements = {
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  connectionTitle: document.querySelector("#connection-title"),
  loadingState: document.querySelector("#loading-state"),
  dashboard: document.querySelector("#dashboard"),
  summaryGrid: document.querySelector("#summary-grid"),
  weeklyChart: document.querySelector("#weekly-chart"),
  weeklyTable: document.querySelector("#weekly-table"),
  projectFilter: document.querySelector("#project-filter"),
  chartMeta: document.querySelector("#chart-meta"),
  projectsMeta: document.querySelector("#projects-meta"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  message: document.querySelector("#message"),
  messageText: document.querySelector("#message-text"),
  messageDismiss: document.querySelector("#message-dismiss"),
};

const ALL_PROJECTS = "__all__";
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
  return { seconds: 0, hours: 0, taskCount: 0, weekCount: 0 };
}

/** Build the data view for the currently selected project (or all projects). */
function currentView() {
  const d = state.dashboard;
  if (!d) return { weeks: [], totals: emptyTotals(), headlineValue: "0.0", headlineLabel: "Lifetime hours", scopeLabel: "0 projects" };
  if (state.selectedProjectId === ALL_PROJECTS) {
    return {
      weeks: d.weeks,
      totals: d.totals,
      headlineValue: (d.lifetime?.totalHours ?? 0).toFixed(1),
      headlineLabel: "Lifetime hours",
      scopeLabel: `${d.projects.length} project${d.projects.length === 1 ? "" : "s"}`,
    };
  }
  const p = d.projects.find((x) => x.id === state.selectedProjectId);
  const totals = p?.totals || emptyTotals();
  return {
    weeks: p?.weeks || [],
    totals,
    headlineValue: totals.hours.toFixed(1),
    headlineLabel: `${p ? p.name : "Project"} hours`,
    scopeLabel: p ? p.kind + " project" : "",
  };
}

function renderSummary(view) {
  const thisWeek = view.weeks.length ? view.weeks[view.weeks.length - 1] : { hours: 0, taskCount: 0 };
  const cards = [
    { label: view.headlineLabel, value: view.headlineValue },
    { label: "This week", value: thisWeek.hours.toFixed(1) + "h" },
    { label: "Tasks (total)", value: view.totals.taskCount },
    { label: "Tasks this week", value: thisWeek.taskCount },
  ];
  elements.summaryGrid.innerHTML = cards
    .map((c) => `<div class="summary-card"><span class="summary-value">${escapeHtml(c.value)}</span><span class="summary-label">${escapeHtml(c.label)}</span></div>`)
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
  renderSummary(view);
  renderChart(view.weeks);
  renderTable(view.weeks);
  elements.chartMeta.textContent = `${view.totals.weekCount} week${view.totals.weekCount === 1 ? "" : "s"} · ${view.totals.hours.toFixed(1)}h`;
  elements.projectsMeta.textContent = view.scopeLabel;
}

function renderChart(weeks) {
  if (!weeks.length) {
    elements.weeklyChart.innerHTML = `<p class="panel-meta">No hours recorded yet.</p>`;
    return;
  }
  const W = Math.max(weeks.length * 56 + 60, 320), H = 240, padBottom = 28, padTop = 16, padLeft = 8;
  const maxHours = Math.max(...weeks.map((w) => w.hours), 1);
  const barW = 36, gap = 20, plotH = H - padBottom - padTop;
  const bars = weeks
    .map((w, i) => {
      const x = padLeft + i * (barW + gap) + 20;
      const h = Math.round((w.hours / maxHours) * plotH);
      const y = padTop + (plotH - h);
      return `<g><title>${escapeHtml(w.weekLabel)}: ${w.hours}h · ${w.taskCount} tasks</title>` +
        `<rect class="bar" x="${x}" y="${y}" width="${barW}" height="${h}" rx="4"></rect>` +
        `<text class="bar-value" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${w.hours}</text>` +
        `<text class="bar-label" x="${x + barW / 2}" y="${H - 10}" text-anchor="middle">${escapeHtml(w.weekLabel)}</text></g>`;
    })
    .join("");
  const axisY = padTop + plotH + 0.5;
  elements.weeklyChart.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours per week">` +
    `<line class="axis" x1="0" y1="${axisY}" x2="${W}" y2="${axisY}"></line>${bars}</svg>`;
}

function renderTable(weeks) {
  const rows = [...weeks].reverse().map((w) => {
    const avg = w.taskCount ? (w.hours / w.taskCount).toFixed(2) : "—";
    return `<tr><td>${escapeHtml(w.weekLabel)}</td><td>${w.hours}</td><td>${w.taskCount}</td><td>${avg}</td></tr>`;
  });
  elements.weeklyTable.innerHTML = rows.join("") || `<tr><td colspan="4">No data</td></tr>`;
}

function renderDashboard(d) {
  state.dashboard = d;
  populateProjectFilter(d);
  renderCurrentView();
  if (elements.mastheadMeta) elements.mastheadMeta.hidden = false;
  if (elements.generatedAt) elements.generatedAt.textContent = new Date(d.generatedAt).toLocaleString();
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
