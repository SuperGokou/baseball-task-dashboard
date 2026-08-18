const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const handshakeApi = require("./platform-api");

const DEFAULT_PORT = Number(process.env.PORT || 4173);
const SESSION_COOKIE = "hai_session";
const WEB_DIR = path.join(__dirname, "web");
const AUTH_PATH = path.join(__dirname, "auth.json");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const SESSION_SWEEP_MS = 60 * 60 * 1000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      })
  );
}

function createSessionId() {
  return crypto.randomBytes(24).toString("base64url");
}

function loadAuthFromDisk() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
    return parsed && Array.isArray(parsed.cookies) ? parsed : null;
  } catch {
    return null;
  }
}

function saveAuthToDisk(authState) {
  try {
    fs.writeFileSync(AUTH_PATH, JSON.stringify(authState, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    console.warn(`[auth] failed to persist auth.json: ${err.message}`);
  }
}

function deleteAuthFromDisk() {
  try {
    if (fs.existsSync(AUTH_PATH)) fs.unlinkSync(AUTH_PATH);
  } catch (err) {
    console.warn(`[auth] failed to delete auth.json: ${err.message}`);
  }
}

const DASHBOARD_CACHE_PATH = path.join(__dirname, "dashboard-cache.json");
const PROJECT_STORE_PATH = path.join(__dirname, "project-cache.json");
const SYNC_TICK_MS = 45 * 1000;
const META_REFRESH_MS = 15 * 60 * 1000;
const PROJECT_REFRESH_MS = 20 * 60 * 1000;

function loadProjectStore() {
  try {
    if (fs.existsSync(PROJECT_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(PROJECT_STORE_PATH, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.projects) return parsed;
    }
  } catch {}
  return { projects: {}, meta: null };
}

function saveProjectStore(store) {
  try {
    fs.writeFileSync(PROJECT_STORE_PATH, JSON.stringify(store));
  } catch (err) {
    console.warn(`[cache] failed to persist project store: ${err.message}`);
  }
}

function loadDashboardCache() {
  try {
    if (!fs.existsSync(DASHBOARD_CACHE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(DASHBOARD_CACHE_PATH, "utf8"));
    return parsed && parsed.totals ? parsed : null;
  } catch {
    return null;
  }
}

function saveDashboardCache(dashboard) {
  try {
    fs.writeFileSync(DASHBOARD_CACHE_PATH, JSON.stringify(dashboard));
  } catch (err) {
    console.warn(`[cache] failed to persist dashboard cache: ${err.message}`);
  }
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function createSessionStore() {
  const store = new Map();

  function get(id) {
    const entry = store.get(id);
    if (!entry) return null;
    if (Date.now() - entry.lastSeen > SESSION_IDLE_MS) {
      store.delete(id);
      return null;
    }
    entry.lastSeen = Date.now();
    return entry;
  }

  function ensure(id) {
    let entry = store.get(id);
    if (!entry) {
      entry = { authState: null, lastSeen: Date.now() };
      store.set(id, entry);
    } else {
      entry.lastSeen = Date.now();
    }
    return entry;
  }

  function setAuth(id, authState) {
    const entry = ensure(id);
    entry.authState = authState;
    entry.lastSeen = Date.now();
  }

  function clear(id) {
    store.delete(id);
  }

  function sweep() {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.lastSeen > SESSION_IDLE_MS) store.delete(id);
    }
  }

  return { get, ensure, setAuth, clear, sweep, size: () => store.size };
}

function buildSessionCookie(sessionId) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  return parts.join("; ");
}

function buildLogoutCookie() {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  return parts.join("; ");
}

function ensureSession(req, res, sessions) {
  const cookies = parseCookies(req.headers.cookie);
  let sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    sessionId = createSessionId();
    res.setHeader("Set-Cookie", buildSessionCookie(sessionId));
  }
  sessions.ensure(sessionId);
  return sessionId;
}

function getLoginStartUrl() {
  return "https://ai.joinhandshake.com/fellow/projects";
}

const LOGIN_PROFILE_DIR = path.join(__dirname, ".login-profile");

async function launchLoginSession(chromium, log = console.log) {
  // Prefer the REAL installed Google Chrome with a persistent profile dedicated
  // to this app: Google/the platform block it far less than bare Chromium, and
  // the profile stays signed in, so later logins usually complete instantly.
  try {
    const context = await chromium.launchPersistentContext(LOGIN_PROFILE_DIR, {
      channel: "chrome",
      headless: false,
    });
    log("[login] Using installed Google Chrome (persistent profile)");
    return { context, browser: null };
  } catch (err) {
    log(`[login] Chrome unavailable, falling back to Playwright Chromium (${String(err.message).split("\n")[0]})`);
  }
  const browser = await chromium.launch({ headless: false });
  log("[login] Using Playwright Chromium");
  return { context: await browser.newContext(), browser };
}

async function closeLoginSession(session) {
  if (session.browser) {
    await session.browser.close().catch(() => {});
  } else {
    await session.context.close().catch(() => {});
  }
}

function createLoginManager(options = {}) {
  const flows = new Map();
  const api = options.api || handshakeApi;

  async function start(sessionId, startUrl, onAuthCaptured) {
    await cancel(sessionId);

    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      throw new Error(
        "Playwright is not installed. Run: npm install && npx playwright install chromium"
      );
    }

    const loginSession = await launchLoginSession(chromium);
    const { context, browser } = loginSession;
    const page = context.pages()[0] || (await context.newPage());
    const targetUrl = startUrl || getLoginStartUrl();
    const targetOrigin = new URL(targetUrl).origin;

    const flow = {
      loginSession,
      browser,
      context,
      page,
      pollHandle: null,
      onFrameNavigated: null,
      captured: false,
      capturedState: null,
    };
    let inFlight = false;

    async function tryCapture() {
      if (flow.captured || inFlight) return;
      inFlight = true;
      try {
        const currentUrl = page.url();
        if (!currentUrl.startsWith(targetOrigin)) return;

        // The session cookie is set on the unauthenticated login page too,
        // so verify by actually hitting the API.
        const authState = await context.storageState();
        try {
          await api.fetchProfile(authState);
        } catch {
          return;
        }

        flow.captured = true;
        flow.capturedState = authState;
        if (flow.pollHandle) clearInterval(flow.pollHandle);
        if (flow.onFrameNavigated) {
          page.off("framenavigated", flow.onFrameNavigated);
          flow.onFrameNavigated = null;
        }
        try {
          onAuthCaptured?.(authState);
        } catch (err) {
          console.warn(`[login] onAuthCaptured failed: ${err.message}`);
        }
        await closeLoginSession(loginSession);
        flows.delete(sessionId);
      } catch {
        // browser or page closed mid-check
      } finally {
        inFlight = false;
      }
    }

    flow.onFrameNavigated = (frame) => {
      if (frame === page.mainFrame()) tryCapture();
    };
    page.on("framenavigated", flow.onFrameNavigated);
    const onLoginWindowClosed = () => {
      if (flow.pollHandle) clearInterval(flow.pollHandle);
      flows.delete(sessionId);
    };
    if (browser) browser.on("disconnected", onLoginWindowClosed);
    else context.on("close", onLoginWindowClosed);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    flow.pollHandle = setInterval(tryCapture, 2000);
    flows.set(sessionId, flow);

    return { opened: true };
  }

  async function cancel(sessionId) {
    const flow = flows.get(sessionId);
    if (!flow) return;
    if (flow.pollHandle) clearInterval(flow.pollHandle);
    if (flow.onFrameNavigated) {
      flow.page.off("framenavigated", flow.onFrameNavigated);
      flow.onFrameNavigated = null;
    }
    await closeLoginSession(flow.loginSession);
    flows.delete(sessionId);
  }

  async function save(sessionId) {
    const flow = flows.get(sessionId);
    if (!flow) {
      throw new Error("No active login window. Click Login first.");
    }
    if (flow.captured) {
      return flow.capturedState;
    }
    flow.captured = true;
    if (flow.pollHandle) {
      clearInterval(flow.pollHandle);
      flow.pollHandle = null;
    }
    if (flow.onFrameNavigated) {
      flow.page.off("framenavigated", flow.onFrameNavigated);
      flow.onFrameNavigated = null;
    }
    const authState = await flow.context.storageState();
    flow.capturedState = authState;
    await closeLoginSession(flow.loginSession);
    flows.delete(sessionId);
    return authState;
  }

  return { start, cancel, save };
}

function serveStatic(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = path.resolve(WEB_DIR, relativePath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function loadSession(sessions, sessionId) {
  let session = sessions.get(sessionId);
  if (!session?.authState) {
    const persisted = loadAuthFromDisk();
    if (persisted) {
      sessions.setAuth(sessionId, persisted);
      session = sessions.get(sessionId);
    }
  }
  return session;
}

function createAppServer(options = {}) {
  const api = options.api || handshakeApi;
  const sessions = options.sessions || createSessionStore();
  const loginManager = options.loginManager || createLoginManager();

  const sweepInterval = setInterval(() => sessions.sweep(), SESSION_SWEEP_MS);
  sweepInterval.unref?.();

  // ---- Rolling sync ------------------------------------------------------
  // Full multi-project sweeps get soft-throttled by the platform (200s with
  // EMPTY task lists), but single-project fetches are reliable. So each tick
  // fetches at most ONE thing (the meta bundle, or one project's tasks) and
  // keeps an assembled dashboard cached — the UI always reads the cache.
  const store = loadProjectStore();
  let syncing = false;

  function assembleAndCache() {
    const meta = store.meta;
    if (!meta?.profile) return;
    const list = meta.projectList || [];
    const entries = list.map((p) => ({
      ...p,
      tasks: store.projects[p.id]?.tasks || [],
    }));
    const pending = list.filter((p) => !store.projects[p.id]).length;
    const warnings = pending
      ? [`Syncing ${pending} of ${list.length} projects — data completes over the next few minutes.`]
      : [];
    const dashboard = api.buildDashboardFromProjects(meta.profile, entries, {
      lifetime: meta.lifetime,
      payRecords: meta.payRecords,
      warnings,
    });
    saveDashboardCache(dashboard);
  }

  async function syncTick() {
    if (syncing) return;
    const authState = loadAuthFromDisk();
    if (!authState) return;
    syncing = true;
    try {
      const metaAge = Date.now() - (store.meta?.metaFetchedAt || 0);
      if (!store.meta?.profile || metaAge > META_REFRESH_MS) {
        const profile = await api.fetchProfile(authState);
        const projectList = await api.listProjects(authState, profile.id);
        let lifetime = store.meta?.lifetime || null;
        try {
          lifetime = await api.getHoursWorked(authState, profile.id);
        } catch {}
        let payRecords = store.meta?.payRecords || [];
        try {
          payRecords = await api.fetchCurrentWeekPayActivities(authState, profile.id);
        } catch {}
        store.meta = {
          profile: { id: profile.id, name: profile.name || profile.fullName || "User" },
          projectList,
          lifetime,
          payRecords,
          metaFetchedAt: Date.now(),
        };
        console.log(`[sync] meta refreshed: ${projectList.length} projects`);
      } else {
        const list = store.meta.projectList || [];
        const next = list
          .map((p) => ({ p, at: store.projects[p.id]?.fetchedAt || 0 }))
          .sort((a, b) => a.at - b.at)[0];
        if (next && Date.now() - next.at > PROJECT_REFRESH_MS) {
          const tasks = await api.fetchAllTasksForProject(next.p.id, authState);
          const previous = store.projects[next.p.id];
          if (tasks.length > 0 || !previous || previous.tasks.length === 0) {
            store.projects[next.p.id] = { fetchedAt: Date.now(), tasks };
          } else {
            // A previously non-empty project coming back empty is almost
            // always throttling — keep the old tasks, just rotate onward.
            store.projects[next.p.id] = { ...previous, fetchedAt: Date.now() };
            console.warn(`[sync] ${next.p.name} returned empty; keeping previous data`);
          }
          console.log(`[sync] ${next.p.name}: ${tasks.length} tasks`);
        }
      }
      assembleAndCache();
      saveProjectStore(store);
    } catch (err) {
      console.warn(`[sync] tick failed: ${err.message}`);
    } finally {
      syncing = false;
    }
  }

  const syncInterval = setInterval(syncTick, SYNC_TICK_MS);
  syncInterval.unref?.();
  const initialSync = setTimeout(syncTick, 5 * 1000);
  initialSync.unref?.();

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url, "http://localhost");
    const sessionId = ensureSession(req, res, sessions);

    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        const session = loadSession(sessions, sessionId);
        if (!session?.authState) {
          sendJson(res, 200, { connected: false });
          return;
        }
        try {
          const profile = await api.fetchProfile(session.authState);
          sendJson(res, 200, {
            connected: true,
            profile: { name: profile.name || profile.fullName || "User" },
          });
        } catch {
          sessions.clear(sessionId);
          deleteAuthFromDisk();
          sendJson(res, 200, { connected: false });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/start") {
        const body = await readRequestBody(req);
        const result = await loginManager.start(
          sessionId,
          body.startUrl || getLoginStartUrl(),
          (authState) => {
            sessions.setAuth(sessionId, authState);
            saveAuthToDisk(authState);
          }
        );
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/save") {
        const storageState = await loginManager.save(sessionId);
        let profile;
        try {
          profile = await api.fetchProfile(storageState);
        } catch {
          sendJson(res, 401, {
            error: "Login window closed but authentication failed. Try again.",
          });
          return;
        }
        sessions.setAuth(sessionId, storageState);
        saveAuthToDisk(storageState);
        sendJson(res, 200, {
          connected: true,
          profile: { name: profile.name || profile.fullName || "User" },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/logout") {
        await loginManager.cancel(sessionId);
        sessions.clear(sessionId);
        deleteAuthFromDisk();
        res.setHeader("Set-Cookie", buildLogoutCookie());
        sendJson(res, 200, { connected: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/dashboard") {
        const session = loadSession(sessions, sessionId);
        if (!session?.authState) {
          sendJson(res, 401, { error: "Sign in first." });
          return;
        }
        // The dashboard is always served from the rolling-sync cache; the
        // route itself never sweeps the platform. Refresh (force) just runs
        // one extra sync tick (a single small fetch) before responding.
        const body = await readRequestBody(req).catch(() => ({}));
        if (body.force) {
          await syncTick();
        }
        const cached = loadDashboardCache();
        if (cached) {
          sendJson(res, 200, cached);
          return;
        }
        sendJson(res, 200, {
          warming: true,
          generatedAt: new Date().toISOString(),
          profile: null,
          lifetime: { totalHours: 0, totalSeconds: 0 },
          weeks: [],
          days: [],
          totals: { seconds: 0, hours: 0, taskCount: 0, weekCount: 0 },
          projects: [],
          payTasks: [],
          warnings: ["First sync is running — your data will appear here automatically over the next few minutes."],
        });
        return;
      }

      if (req.method === "GET" && serveStatic(req, res)) return;

      sendJson(res, 404, { error: "Not found." });
    } catch (err) {
      const message = err?.message || "Server error.";
      console.error(`[${req.method} ${url.pathname}] ${message}`);
      sendJson(res, 500, { error: message });
    }
  });

  server.on("close", () => {
    clearInterval(sweepInterval);
    clearInterval(syncInterval);
    clearTimeout(initialSync);
  });
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${DEFAULT_PORT} is already in use — dashboard is probably already running.`);
      process.exit(0);
    }
    throw err;
  });
  server.listen(DEFAULT_PORT, () => {
    console.log(
      `Server running at http://localhost:${DEFAULT_PORT} (${
        IS_PRODUCTION ? "production" : "development"
      } mode)`
    );
  });
}

module.exports = {
  createAppServer,
  createSessionId,
  createSessionStore,
  getLoginStartUrl,
  closeLoginSession,
  launchLoginSession,
  parseCookies,
};
