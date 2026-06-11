# Weekly Hours Dashboard

A local dashboard that shows **how many hours per week** you spent working on HAI
tasks — across **all** your projects. Everything runs on your machine; nothing is
hosted online.

**One person per computer:** Each fellow runs their own copy. **Login** opens
**Playwright Chromium** on **your** laptop for sign-in. Your session is saved in
`auth.json` on that machine only — never committed to git or shared between users.

## What it shows

After you sign in and the dashboard loads:

| Section | What it shows |
| --- | --- |
| **Summary cards** | Lifetime hours (platform total), this week's hours, total tasks, tasks this week |
| **Hours per week** | A bar chart of hours worked in each ISO week (Monday-start), hover a bar for hours + task count |
| **Weekly breakdown** | A table of every week: hours, tasks, and average hours per task |

Hours are computed from each task's per-activity `timeWorkedInSeconds`, attributed
to the week the work actually happened, summed across every project you've worked on
(Baseball, Fade, Breadcrumb, Helix, …). The aggregated total tracks the platform's
own lifetime hours figure to within ~1%.

If one project's task list fails to load (a transient platform error), the dashboard
still shows the rest and surfaces a small warning — your other weeks are unaffected.

## What you need

- **Node.js 18+** ([nodejs.org](https://nodejs.org))
- A terminal (PowerShell or Terminal on Windows, Terminal/iTerm on macOS)
- A Handshake AI fellow account with tasks on `ai.joinhandshake.com`

## First-time setup

```bash
git clone https://github.com/SuperGokou/baseball-task-dashboard.git
cd baseball-task-dashboard
npm install
npx playwright install chromium
```

> **Important:** Run `npx playwright install chromium` in a normal system terminal,
> not only inside an IDE sandbox. If Chromium fails to launch, login will not work.

## Run it

```bash
npm start
```

You should see:

```text
Server running at http://localhost:4173 (development mode)
```

Open **http://localhost:4173** in your normal browser. This page is only the
dashboard UI — you do **not** type your password here.

### Sign in (separate browser window)

1. Click **Login** on the dashboard.
2. A **second window** opens — **Playwright Chromium**.
3. In **that** window, sign in the way you normally would (Google OAuth / SSO are
   fine — complete the full flow there).
4. When you can see your projects/tasks in that window, login is captured:
   - The Chromium window usually **closes on its own** and the dashboard loads.
   - If it stays open, click **Save Login** on the dashboard.
5. The dashboard shows **Signed in** and your weekly hours load automatically.

Click **Refresh** any time to pull the latest data from the platform.

## Daily use

```bash
npm start
```

Open **http://localhost:4173**. Your saved session in `auth.json` is reused — you
usually don't need to log in again until you click **Log Out**.

## How login works

| Place | What happens |
| --- | --- |
| **http://localhost:4173** | Dashboard only. Shows your weekly hours **after** a session is saved. |
| **Playwright Chromium window** | Where you actually sign in (Google OAuth / SSO). |

The dashboard never talks to Google directly. Playwright opens the real platform
site, you log in there, and the app saves cookies to `auth.json` on your computer.

**Common mistake:** signing in only in your normal browser, or expecting a login
form on localhost. You must complete sign-in in the **login window** that opens when
you click **Login**.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Clicked **Login** but nothing opens | Run `npm start` from a normal terminal. Re-run `npx playwright install chromium`. |
| Google says **"This browser may not be secure"** | Sign in in **that** window (not localhost), then **Save Login** if tasks don't load. Try non-Google SSO if available. |
| Dashboard says **Not signed in** after signing in elsewhere | That session is in a different browser. Use **Login** on the dashboard so Chromium captures cookies. |
| Was signed in, now **Session expired** | Click **Log Out**, then **Login** and sign in again. |
| A warning about one project failing to load | Usually a transient platform error. Click **Refresh** — the other projects still show. |
| `Executable doesn't exist` | `npx playwright install chromium` |
| `EADDRINUSE :::4173` | Stop the other `node server.js`, or run `PORT=5050 npm start` and open http://localhost:5050 |

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

- `time-tracking.js` — pure weekly-aggregation logic (`weekStartUtc`, `aggregateWeeklyHours`)
- `platform-api.js` — tRPC calls + the `fetchWeeklyHoursDashboard` orchestrator
- `server.js` — local HTTP server, Playwright login flow, session handling
- `web/` — the dashboard UI (vanilla JS + hand-drawn SVG chart)

Built as a fork of the project task-dashboard; reused with permission.
