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
  chartMeta: document.querySelector("#chart-meta"),
  projectsMeta: document.querySelector("#projects-meta"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  message: document.querySelector("#message"),
  messageText: document.querySelector("#message-text"),
  messageDismiss: document.querySelector("#message-dismiss"),
};

const state = { connected: false, dashboard: null, loginPollTimer: null };

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

function renderSummary(d) {
  const thisWeek = d.weeks.length ? d.weeks[d.weeks.length - 1] : { hours: 0, taskCount: 0 };
  const cards = [
    { label: "Lifetime hours", value: (d.lifetime?.totalHours ?? 0).toFixed(1) },
    { label: "This week", value: thisWeek.hours.toFixed(1) + "h" },
    { label: "Tasks (total)", value: d.totals.taskCount },
    { label: "Tasks this week", value: thisWeek.taskCount },
  ];
  elements.summaryGrid.innerHTML = cards
    .map((c) => `<div class="summary-card"><span class="summary-value">${escapeHtml(c.value)}</span><span class="summary-label">${escapeHtml(c.label)}</span></div>`)
    .join("");
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
  renderSummary(d);
  renderChart(d.weeks);
  renderTable(d.weeks);
  elements.chartMeta.textContent = `${d.totals.weekCount} week${d.totals.weekCount === 1 ? "" : "s"} · ${d.totals.hours.toFixed(1)}h aggregated`;
  elements.projectsMeta.textContent = `${d.projects.length} project${d.projects.length === 1 ? "" : "s"}`;
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

setConnected(false);
refreshStatus();
