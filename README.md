# reddit-scraper-service

Standalone microservice that stands in for Reddit's official API, which is
currently gated behind approval.

**Read this before running it.** This scrapes old.reddit.com's `.json`
endpoints without Reddit's authorization under their current API terms — Reddit's
user agreement prohibits unauthorized automated access, and they're actively
litigating scrapers right now (suing Anthropic over continued scraping, as of
2026). As of May-Jul 2026 Reddit also **requires a logged-in session** to access
this content at all — see "Why a login is required" below — which means this now
runs *as* a Reddit account, not just from an IP. Ban risk is at the account level,
not just the IP level. This is a deliberate, low-volume, disclosed tradeoff (see
`mention-finder`'s README), not something to expand or point at other sites
without the same conversation happening again. Don't turn this into a general-purpose Reddit crawler, and use
a dedicated throwaway account, not a real/business one.

## Why a login is required

Confirmed by testing (Aug 2026): anonymous `.json` requests get an immediate,
consistent `403` regardless of IP class (datacenter or residential) or browser
stealth quality. That's because Reddit deprecated unauthenticated `.json` access
outright on **May 28, 2026** ("these endpoints can be used to scrape Reddit
without accountability" — Reddit's own announcement) and started requiring a
logged-in session for old.reddit.com generally in **July 2026**. No amount of
proxy/fingerprint tuning fixes a hard authentication requirement — the fix is a
real logged-in session, reused.

## Non-negotiable: this must run headed, not headless

`headless: true` **does not work** and is not a tuning knob. Patchright's stealth
patches do not cover headless mode — Chrome still reports
`HeadlessChrome/NNN` in its User-Agent (and other headless tells), which Akamai
rejects instantly on `.json` endpoints. The Patchright maintainers closed this
as [won't-fix](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python/issues/46).

Measured on the same proxy IP, same profile:

| mode | reported User-Agent | `.json` fetch |
| --- | --- | --- |
| `headless: true` | `HeadlessChrome/151.0.0.0` | 403 blocked |
| `headless: false` | `Chrome/151.0.0.0` | 200 OK |

So `src/fetcher/browser.js` and `scripts/check-ip.js` launch with
`headless: false` plus `--window-position=-2400,-2400`, which parks the window
off-screen — a real rendered browser, just not one you have to look at. Don't
"optimize" this back to headless; it will silently start 403ing again.

The documented-working Patchright combination, which this service follows
exactly: `launchPersistentContext` + `channel: "chrome"` + `headless: false` +
`viewport: null`, and **no** custom user-agent or header overrides (setting your
own UA re-introduces mismatches with Chrome's client hints).

## Rotating the exit IP

The sticky session token is an arbitrary string this service generates and
stores in `data/.proxy-session` — not something the IPRoyal (this repo used) dashboard has to
issue. So a rate-limited or blocked IP is **not** a multi-day outage:

```
npm run rotate-ip
```

That mints a new token, which gets you a new exit IP on the next launch.
Restart the service afterwards, and `npm run check-ip` to confirm the new IP is
clean. `PROXY_STICKY_LIFETIME` (default `24h`) only caps how long one IP is
held; it does not lock you in.

## "Whoa there, pardner!" (too many requests) is an IP problem, not a code problem

This wall is Reddit's raw per-IP request-volume gate, separate from the
Akamai/fingerprint bot check Patchright already handles. It fires when the
exit IP itself has made too many recent requests to Reddit — on cheap shared
residential pools (IPRoyal's lower tiers included) that's very often **other
customers'** traffic through the same IP, not yours. No amount of stealth
browser tuning fixes an already-hot IP; the fix is a clean exit IP. Before
running `npm run login`, run:

```
npm run check-ip
```

It loads reddit.com's homepage (not `/login`) through the current sticky
session and tells you if that IP is already blocked, so you're not burning a
login attempt (and further souring that IP) to find out. If it reports
`BLOCKED`, generate a fresh Sticky IP session on the IPRoyal dashboard and
check again before retrying login.

## How it works

- `npm run login` (see below) opens a real, visible browser and you manually log
  into a Reddit account through it — nothing here automates the login or reads
  credentials from anywhere, you type them into an actual Reddit page yourself,
  same as any human. Clear any CAPTCHA yourself too. Once logged in, the profile
  (cookies, storage, everything) is saved to `data/browser-profile/` — a real
  on-disk Chrome profile directory, not an exported cookie file.
- The running service (`src/fetcher/browser.js`) launches Patchright against that
  **same profile directory** via `launchPersistentContext`, reused for every
  request — not a fresh context per call, and not cookies replayed onto a
  throwaway context — so it looks like the same continuously-running browser
  session `npm run login` created, matching how Patchright's stealth patches are
  meant to be used (real Chrome channel, no forced viewport, no user-agent
  override).
- The proxy (`PROXY_MODE=rotating`, IPRoyal by default) is pinned to **one sticky
  exit IP** via a sticky-session password generated on the provider's dashboard
  (see Setup below) — a logged-in account jumping between IPs/cities on every
  request is itself a red flag, so the exit IP has to stay consistent, the
  opposite of the old anonymous-scraping approach.
- All requests are still serialized through one queue with a politeness floor +
  jitter (`src/rateLimiter.js`) — no bursting, same low volume as before (7
  subreddits, once a day, plus occasional enrichment lookups).
- If the session expires or gets invalidated, `fetchJson` throws a
  `SessionInvalidError` and `mention-finder` keeps running without Reddit
  coverage (logged, not fatal) until you run `npm run login` again.

None of this guarantees the account or IP won't eventually get blocked/banned
anyway — it minimizes the chance, it doesn't eliminate it.

## Setup

```
npm install
cp .env.example .env
```

Needs a real Google Chrome install on the host (`channel: "chrome"` — Patchright
launches your actual installed Chrome rather than a bundled/downloaded one,
which is the more stealth-accurate setup). If Chrome isn't installed, install
it normally, or fall back to Patchright's bundled Chromium with
`npx patchright install chromium` and drop `channel: "chrome"` from
`src/fetcher/browser.js` / `scripts/login.js`.

Fill in `.env`:

- `SERVICE_API_KEY` — shared secret callers (mention-finder) must send as
  `Authorization: Bearer <key>`. Generate one:
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- `ROTATING_PROXY_USERNAME` / `ROTATING_PROXY_PASSWORD` — from
  [iproyal.com](https://iproyal.com). Use your **base** password only, exactly as
  shown on the dashboard, with no `_session-…_lifetime-…` suffix appended — the
  service builds the sticky suffix itself (see "Rotating the exit IP" above).
  `ROTATING_PROXY_HOST`/`ROTATING_PROXY_PORT` already default to IPRoyal's
  gateway (`geo.iproyal.com:12321`), no need to change.
- `PROXY_STICKY_LIFETIME` — how long one exit IP is held, e.g. `30m`, `24h`,
  `168h`. Default `24h`.
- `ENABLE_BROWSER_FALLBACK=true` — required now, this is the only path that
  actually works (see "Why a login is required" above).
- Everything else has a sane default — see comments in `.env.example`.

Then log in once:

```
npm run login
```

A browser window opens. Log into your throwaway Reddit account, clear any
CAPTCHA, then press Enter in the terminal once you can see your feed. This saves
the Chrome profile to `data/browser-profile/`, which the running service reads
on startup. Re-run this any time the service logs `SessionInvalidError` (session
expired/invalidated — Reddit logged the account out).

No Docker, no database. Just:

```
npm start
```

Runs a plain Node/Express process on `PORT` (default 4100). To keep it running in
the background, use a process manager like [pm2](https://pm2.keymetrics.io/)
(`pm2 start src/server.js --name reddit-scraper-service`) rather than a raw
terminal — pm2 also restarts it automatically if it crashes (it will **not**
re-run `npm run login` for you though — that always needs a human).

## API

All endpoints (except `/healthz`) require `Authorization: Bearer <SERVICE_API_KEY>`.

- `GET /healthz` — liveness check, no auth.
- `GET /subreddit/:name/new?limit=25` — new posts in a subreddit.
  `{ "posts": [{ source, subreddit, title, url, createdUtc, numComments, score }] }`
- `GET /post/:id` — a single post by its Reddit ID (the part after `/comments/` in
  its URL). `{ "post": { created_utc, num_comments, score, subreddit, ... } }`
  (raw Reddit post shape), or `404` if not found.
#   r e d d i t - s c r a p p e r  
 