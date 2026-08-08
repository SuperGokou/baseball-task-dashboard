# Weekly Hours Dashboard

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2018-5b5bd6)
![Tests](https://img.shields.io/badge/tests-47%20passing-2f6f4f)
![Login](https://img.shields.io/badge/login-Playwright-2563eb)
![Timezone](https://img.shields.io/badge/time-Pacific%20(PT)-7c3aed)
![Runs](https://img.shields.io/badge/runs-100%25%20local-b45309)
![Deps](https://img.shields.io/badge/dependencies-playwright%20only-64748b)

A local dashboard that shows **how much time you spent working on HAI tasks** — day by
day, across **all** of your projects. Everything runs on your machine; nothing is
hosted online.

**One person per computer:** Each fellow runs their own copy. **Login** opens
**Playwright Chromium** on **your** laptop for sign-in. Your session is saved in
`auth.json` on that machine only — never committed to git or shared between users.

All day and week boundaries are computed in **Pacific Time (America/Los_Angeles)**, the
platform's timezone, so the numbers line up with what Handshake shows you.

## What you need

- **Node.js 18+** ([nodejs.org](https://nodejs.org))
- A terminal (PowerShell or Terminal on Windows, Terminal / iTerm on macOS)
- A Handshake AI fellow account with tasks on `ai.joinhandshake.com`

## First-time setup

Do these once after cloning.

### 1. Clone and install

```bash
git clone https://github.com/SuperGokou/baseball-task-dashboard.git
cd baseball-task-dashboard
npm install
npx playwright install chromium
```

> **Important:** Run `npx playwright install chromium` in a normal system terminal,
> not only inside an IDE sandbox. If Chromium fails to launch, login will not work.

### 2. Start the server

```bash
npm start
```

You should see:

```text
Server running at http://localhost:4173 (development mode)
```

> **On Windows** you may instead get `EACCES: permission denied … 4173` — that port is
> reserved by the system (Hyper-V / WSL). Just pick another port:
> ```powershell
> $env:PORT=5173; npm start
> ```
> then use **http://localhost:5173** everywhere below.

### 3. Open the dashboard

In your normal browser, open **http://localhost:4173**. This page is only the
dashboard UI — you do **not** type your password here.

### 4. Sign in (separate browser window)

1. Click **Login** on the dashboard.
2. A **second window** opens — **Playwright Chromium**.
3. In **that** window, sign in the way you normally would (Google OAuth / SSO are fine —
   complete the full flow there).
4. When you can see your projects/tasks in that window, login is captured:
   - The Chromium window usually **closes on its own** and the dashboard loads.
   - If it stays open, click **Save Login** on the dashboard.
5. The dashboard shows **Signed in · <your name>** and your hours load automatically.

### 5. Confirm it worked

| What you should see | Meaning |
| --- | --- |
| **Signed in · <name>** (top right) | Session was captured |
| **Total hours** with a big number | Aggregation succeeded |
| A bar chart under **Hours over time** | Daily hours loaded |
| A **Tasks** table below | Per-task detail loaded |

## Daily use

```bash
npm start
```

Open **http://localhost:4173** (or your `PORT`). Your saved session in `auth.json` is
reused — you usually don't need to log in again until you click **Log Out**. Click
**Refresh** any time to pull the latest data from the platform.

## Reading the dashboard

### Hours over time (top panel)

- **Total hours** (top right) shows the aggregated time for what's currently in view, as
  `H:MM`, with a subline of task count and your lifetime total.
- **Project** dropdown — view **All projects** or filter to a single project (Baseball,
  Fade, Breadcrumb, Helix, …). Each option shows that project's hours.
- **Time range** dropdown — All time / Last 30 / 14 / 7 days / This week (Pacific Time).
- The **bar chart** plots hours per day. Hover a bar for a quick tooltip.
- **Click a bar** to drill into that day: the Total, the tasks table, and the tooltip all
  filter to that day, and the bar highlights. Click it again, click empty chart space, or
  press **clear** to reset.

### Tasks (bottom panel)

A row per task you worked on, newest first.

| Column | Meaning |
| --- | --- |
| **Date (PT)** | The day the work is attributed to, in Pacific Time |
| **Task ID** | The platform task UUID |
| **Project** | Which project the task belongs to |
| **Stage** | Pipeline stage, as a colored pill (Delivered, Failed, …) |
| **Time** | Time on the task, `HH:MM:SS`, matching the platform's per-task time |
| **Task** | Title (from the task's problem statement) + its instance id |

- **Search** by title or ID, and filter by **Stage**.
- **Export CSV** downloads exactly what's in view (all active filters applied), with
  columns Date · Task ID · Project · Stage · Time · Seconds · Title · Instance ID · Billable.
- The table scrolls **horizontally** — drag it left/right — and vertically.
- **Rows shown in red** are *billable activities* merged from the platform's current-week
  pay data (see below).

### How the numbers are computed

- Hours come from each task's per-activity `timeWorkedInSeconds`, bucketed into **Pacific-Time
  days and weeks**, summed across every project. The lifetime aggregate tracks the platform's
  own "hours worked" figure to within ~1%.
- **This week** is reconciled against the platform's billable **pay activities** so the
  current-week count and hours match what Handshake shows (including review work on tasks
  that aren't in your claimed-task list — those appear as the red *Billable* rows).
- If one project's task list fails to load (a transient platform error), the dashboard still
  shows the rest and surfaces a small warning — your other data is unaffected.

## How login actually works

| Place | What happens |
| --- | --- |
| **http://localhost:4173** | Dashboard only. Shows your hours **after** a session is saved. |
| **Playwright Chromium window** | Where you actually sign in (Google OAuth / SSO). |

The dashboard never talks to Google directly. Playwright opens the real platform site, you
log in there, and the app saves cookies to `auth.json` on your computer.

**Common mistake:** signing in only in your normal browser, or expecting a login form on
localhost. You must complete sign-in in the **login window** that opens when you click
**Login**.

## Troubleshooting

### Login / sign-in

| Problem | What to do |
| --- | --- |
| Clicked **Login** but nothing opens | Run `npm start` from a normal terminal. Re-run `npx playwright install chromium`. |
| Google says **"This browser may not be secure"** | Sign in in **that** window (not localhost), then **Save Login** if data doesn't load. Try non-Google SSO if available. |
| Dashboard says **Not signed in** after signing in elsewhere | That session is in a different browser. Use **Login** on the dashboard so Chromium captures cookies. |
| Was signed in, now **Session expired** | Click **Log Out**, then **Login** and sign in again. |

### Server / data

| Problem | What to do |
| --- | --- |
| `EACCES: permission denied … 4173` (Windows) | Port is OS-reserved. Run `$env:PORT=5173; npm start`, open http://localhost:5173. |
| `EADDRINUSE :::4173` | Another `node server.js` is running. Stop it, or use a different `PORT`. |
| `Executable doesn't exist` | `npx playwright install chromium` |
| A warning that a project failed to load | Usually a transient platform 503. Click **Refresh** — the other projects still show. |

## What gets stored locally

| Thing | Where | Lifetime |
| --- | --- | --- |
| Session cookies | `auth.json` (gitignored, mode 600) | Until **Log Out** |
| Session id cookie | Browser cookie on localhost (HttpOnly) | 30 days |
| Anything else | Nowhere | — |

## Development

```bash
npm test     # run the unit tests (node --test)
```

| File | Responsibility |
| --- | --- |
| `time-tracking.js` | Pure logic: PT day/week bucketing (`dayPT`, `weekStartPT`), `aggregateDailyHours` / `aggregateWeeklyHours`, `summarizeTasks`, `mergeCurrentWeekPayActivities` |
| `platform-api.js` | tRPC calls (projects, tasks, hours, pay activities) + the `fetchWeeklyHoursDashboard` orchestrator |
| `server.js` | Local HTTP server, Playwright login flow, session handling, security headers |
| `web/` | The dashboard UI — `index.html`, `styles.css`, `app.js` (vanilla JS + hand-drawn SVG chart) |

## Quick checklist (share with someone stuck on setup)

- [ ] `npm install` and `npx playwright install chromium` finished without errors
- [ ] `npm start` shows `Server running at http://localhost:<port>`
- [ ] Opened **localhost** in a normal browser
- [ ] Clicked **Login** and used the **Chromium** window (not localhost) to sign in
- [ ] Dashboard shows **Signed in** with a chart and a tasks table

## Getting help

If you're still stuck, say which step failed (install, Login button, sign-in, or empty
dashboard) and what the status line shows (**Not signed in**, **Waiting…**, or **Signed in**).

---

Built as a fork of the project task-dashboard; reused with permission.
