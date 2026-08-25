# Reddit Scraper Microservice

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-4.21.1-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![Patchright](https://img.shields.io/badge/Patchright-Stealth_Automation-8A2BE2?style=flat)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
[![License](https://img.shields.io/badge/License-Private-lightgrey?style=flat)]()

A robust, low-volume Node.js microservice designed to fetch Reddit subreddit listings and post details via stealth browser automation and sticky residential proxying. Built as an alternative data ingestion layer for upstream consumers (such as `mention-finder`).

> [!WARNING]
> **Important Compliance & Risk Notice:**
> Reddit strictly prohibits unauthorized automated access and actively enforces bot protections (Akamai, Cloudflare, per-IP rate gating). As of mid-2026, Reddit requires authenticated user sessions for `.json` endpoints.
> - Always use a **dedicated throwaway account**, never personal or business accounts.
> - Run this service for **low-volume, rate-controlled polling only** (e.g., daily scheduled ingestion).
> - Account-level and IP-level ban risks are inherent; do not use as a high-concurrency or high-volume crawler.

---

## Table of Contents

- [Architecture & Key Concepts](#architecture--key-concepts)
  - [Why Authenticated Sessions Are Required](#why-authenticated-sessions-are-required)
  - [Non-Negotiable: Headed Execution](#non-negotiable-this-must-run-headed-not-headless)
  - [Sticky Residential IP Management](#sticky-residential-ip-management)
  - [Rate Limiting, Jitter & Caching](#rate-limiting-jitter--caching)
- [Prerequisites](#prerequisites)
- [Installation & Quick Start](#installation--quick-start)
- [Configuration Reference](#configuration-reference)
- [CLI Scripts](#cli-scripts)
- [API Reference](#api-reference)
  - [Health Check (`GET /healthz`)](#1-health-check)
  - [Fetch Subreddit Posts (`GET /subreddit/:name/new`)](#2-fetch-new-subreddit-posts)
  - [Fetch Single Post (`GET /post/:id`)](#3-fetch-post-by-id)
- [Production Deployment](#production-deployment)
- [Troubleshooting & Gotchas](#troubleshooting--gotchas)
- [Project Structure](#project-structure)

---

## Architecture & Key Concepts

```
┌─────────────────────────┐
│  Caller (e.g. Service)  │
└───────────┬─────────────┘
            │ HTTP + Bearer Token
            ▼
┌──────────────────────────────────────────────────────────┐
│              reddit-scraper-service (Express)             │
│                                                          │
│  1. Bearer Token Authentication Check                    │
│  2. In-Memory Cache Lookup (TTL: 30 min)                 │
│  3. FIFO Rate Limiter (Politeness Floor + Jitter)        │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│             Stealth Engine (Patchright + Chrome)         │
│                                                          │
│  - Persistent On-Disk Profile (`data/browser-profile`)   │
│  - Headed Mode parked off-screen (-2400, -2400)          │
│  - Sticky Residential Exit IP (`geo.iproyal.com:12321`)  │
└───────────┬──────────────────────────────────────────────┘
            │ Authenticated GET old.reddit.com/r/.../new.json
            ▼
┌─────────────────────────┐
│       Reddit.com        │
└─────────────────────────┘
```

### Why Authenticated Sessions Are Required
Anonymous `.json` requests return an immediate `403 Forbidden` across both datacenter and residential IPs due to Reddit's anti-scraping policy updates. Reddit deprecated unauthenticated `.json` access and mandates an active, logged-in session. To reliably fetch data, this microservice reuses a genuine, human-authenticated Chrome profile.

### Non-Negotiable: This Must Run Headed, Not Headless
`headless: true` **does not work**. Stealth patches in automation frameworks do not fully mask headless artifacts (such as `HeadlessChrome` in the User-Agent and missing graphics stack parameters), which Akamai and Reddit bot-defense systems detect and block immediately on `.json` endpoints.

| Mode | User-Agent Reported | Reddit `.json` Fetch | Result |
| :--- | :--- | :--- | :--- |
| `headless: true` | `HeadlessChrome/151.x` | 403 Forbidden | **Blocked** |
| `headless: false` | `Chrome/151.x` | 200 OK | **Success** |

To solve this without disturbing your desktop, the browser runs in headed mode (`headless: false`) positioned off-screen using the Chromium flag:
```js
args: ["--window-position=-2400,-2400", "--window-size=1280,800"]
```

### Sticky Residential IP Management
A logged-in account hopping IP addresses or geographic locations between every request triggers fraud and account takeover flags. Therefore:
- The service uses **Sticky Residential Proxies** (IPRoyal by default).
- The sticky session token is stored locally in `data/.proxy-session`.
- You can instantly rotate to a clean exit IP at any time without accessing the provider dashboard by running `npm run rotate-ip`.
- `PROXY_STICKY_LIFETIME` (default: `24h`) controls sticky session persistence.

### Rate Limiting, Jitter & Caching
- **Serialization & Jitter**: All outbound requests pass through a serialized async queue (`src/rateLimiter.js`) with a configurable politeness delay (`MIN_REQUEST_INTERVAL_MS=3000`) and randomized jitter (+0–1500ms).
- **In-Memory Cache**: Responses are cached for `CACHE_TTL_MINUTES=30`. If Reddit encounters transient upstream issues, the service serves stale cached data as a fallback to avoid downtime.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Google Chrome**: Installed on the host system (Patchright uses `channel: "chrome"` for optimal stealth).
- **Residential Proxy**: An active account with [IPRoyal](https://iproyal.com) (or compatible HTTP/HTTPS proxy provider).
- **Throwaway Reddit Account**: Required for manual one-time login.

---

## Installation & Quick Start

### 1. Clone & Install Dependencies
```bash
git clone <repo-url>
cd reddit-scraper-service
npm install
```

*(Optional)* If Google Chrome is not installed on your host machine, install Patchright's Chromium build:
```bash
npx patchright install chromium
```

### 2. Configure Environment
Copy the sample environment file and configure your credentials:
```bash
cp .env.example .env
```

Generate a secure API key for microservice authentication:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Paste this key as `SERVICE_API_KEY` in your `.env` file along with your proxy credentials.

### 3. Verify Proxy Exit IP
Before attempting to log in, verify that your assigned residential IP is not flagged or rate-limited by Reddit:
```bash
npm run check-ip
```
- If the output shows `RESULT: CLEAN`, proceed to step 4.
- If the output shows `RESULT: BLOCKED ("whoa there, pardner")`, run `npm run rotate-ip` and test again.

### 4. Perform One-Time Login
Authenticate your throwaway Reddit account to initialize the persistent profile:
```bash
npm run login
```
1. A real browser window will appear.
2. Manually enter your throwaway account credentials and solve any CAPTCHA.
3. Once you can view your Reddit home feed, return to the terminal and press **Enter**.
4. The authenticated session is saved to `data/browser-profile/`.

### 5. Start the Microservice
```bash
npm start
```
The server will start on port `4100` (or the configured `PORT`).

---

## Configuration Reference

All options can be configured via `.env`:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `number` | `4100` | Port for the Express HTTP server |
| `SERVICE_API_KEY` | `string` | *(Required)* | Secret token expected in `Authorization: Bearer <KEY>` |
| `PROXY_MODE` | `string` | `rotating` | Proxy strategy: `rotating` (IPRoyal residential) or `static` (legacy list) |
| `ROTATING_PROXY_HOST` | `string` | `geo.iproyal.com` | Residential proxy gateway hostname |
| `ROTATING_PROXY_PORT` | `number` | `12321` | Residential proxy gateway port |
| `ROTATING_PROXY_USERNAME` | `string` | `""` | Proxy account username |
| `ROTATING_PROXY_PASSWORD` | `string` | `""` | Proxy **base password** (plain dashboard password without session suffixes) |
| `PROXY_STICKY_LIFETIME` | `string` | `24h` | Target lifetime for sticky session (`30m`, `1h`, `24h`, `168h`) |
| `PROXY_LIST` | `string` | `""` | Delimited list of `host:port:user:pass` (used only when `PROXY_MODE=static`) |
| `ENABLE_BROWSER_FALLBACK` | `boolean` | `true` | Enables authenticated Patchright browser fetching (**must be `true`**) |
| `MIN_REQUEST_INTERVAL_MS`| `number` | `3000` | Minimum delay between outbound Reddit requests |
| `CACHE_TTL_MINUTES` | `number` | `30` | Duration to keep fetched responses in cache |
| `CIRCUIT_BREAKER_THRESHOLD` | `number` | `3` | Consecutive failures before tripping legacy HTTP circuit breaker |
| `CIRCUIT_BREAKER_COOLDOWN_MS` | `number` | `1800000` | Cooldown period (30 min) for legacy HTTP circuit breaker |

---

## CLI Scripts

| Command | Script | Description |
| :--- | :--- | :--- |
| `npm start` | `src/server.js` | Launches the Express API service. |
| `npm run check-ip` | `scripts/check-ip.js` | Pre-flight test checking if the current sticky proxy IP is blocked or rate-limited. |
| `npm run rotate-ip` | `scripts/rotate-ip.js` | Mints a new session token in `data/.proxy-session` for an immediate fresh exit IP. |
| `npm run login` | `scripts/login.js` | Opens a visible browser through the proxy to create or refresh `data/browser-profile/`. |

---

## API Reference

All endpoints except `/healthz` require an Authorization header:
```http
Authorization: Bearer <SERVICE_API_KEY>
```

### 1. Health Check
Liveness probe for monitoring systems.

- **URL**: `/healthz`
- **Method**: `GET`
- **Auth**: None

#### Response (`200 OK`)
```json
{
  "ok": true
}
```

---

### 2. Fetch New Subreddit Posts
Fetches the newest posts from a specified subreddit.

- **URL**: `/subreddit/:name/new`
- **Method**: `GET`
- **URL Parameters**:
  - `name` *(string, required)*: Subreddit name (e.g. `technology`, `webdev`, `node`).
- **Query Parameters**:
  - `limit` *(number, optional)*: Number of posts to retrieve (default: `25`).

#### Example Request
```bash
curl -X GET "http://localhost:4100/subreddit/webdev/new?limit=5" \
  -H "Authorization: Bearer YOUR_SERVICE_API_KEY"
```

#### Example Response (`200 OK`)
```json
{
  "posts": [
    {
      "source": "reddit",
      "subreddit": "webdev",
      "title": "Show Reddit: New microservice architecture overview",
      "url": "https://reddit.com/r/webdev/comments/1abc23/show_reddit_new_microservice/",
      "createdUtc": 1756123456,
      "numComments": 14,
      "score": 42
    }
  ]
}
```

---

### 3. Fetch Post by ID
Retrieves detailed information for a single post using its Reddit ID (`t3_<id>`).

- **URL**: `/post/:id`
- **Method**: `GET`
- **URL Parameters**:
  - `id` *(string, required)*: The post's base36 Reddit ID (e.g. `1abc23` from `reddit.com/comments/1abc23/...`).

#### Example Request
```bash
curl -X GET "http://localhost:4100/post/1abc23" \
  -H "Authorization: Bearer YOUR_SERVICE_API_KEY"
```

#### Example Response (`200 OK`)
```json
{
  "post": {
    "id": "1abc23",
    "name": "t3_1abc23",
    "subreddit": "webdev",
    "title": "Show Reddit: New microservice architecture overview",
    "selftext": "Detailed post body content here...",
    "author": "throwaway_user",
    "score": 42,
    "num_comments": 14,
    "created_utc": 1756123456,
    "permalink": "/r/webdev/comments/1abc23/show_reddit_new_microservice/",
    "url": "https://www.reddit.com/r/webdev/comments/1abc23/show_reddit_new_microservice/"
  }
}
```

#### Error Responses
- **`401 Unauthorized`**: Missing or invalid `Authorization` header.
  ```json
  { "error": "unauthorized" }
  ```
- **`404 Not Found`**: The requested post ID does not exist or has been deleted.
  ```json
  { "error": "not found" }
  ```
- **`502 Bad Gateway`**: Upstream Reddit block, rate limit, or session expiration.
  ```json
  { "error": "reddit session missing or expired - run `npm run login` to (re)authenticate" }
  ```

---

## Production Deployment

For continuous background execution, use a process manager like [PM2](https://pm2.keymetrics.io/):

```bash
# Start microservice with PM2
pm2 start src/server.js --name reddit-scraper-service

# View live logs
pm2 logs reddit-scraper-service

# Save PM2 state across system reboots
pm2 save
pm2 startup
```

> [!NOTE]
> PM2 will automatically restart the service if an unhandled error occurs. However, if the Reddit session expires, PM2 cannot perform interactive re-login automatically. A manual execution of `npm run login` is required.

---

## Troubleshooting & Gotchas

### 1. "Whoa there, pardner!" (Reddit Rate Limit)
- **Cause**: The current residential exit IP has made too many requests across all customers sharing the pool.
- **Fix**: Run `npm run rotate-ip`, then run `npm run check-ip` to confirm the new IP is clean, and restart the service.

### 2. `SessionInvalidError` / Redirect to `/login`
- **Cause**: Reddit invalidated or expired the authentication cookies.
- **Fix**: Run `npm run login` in your terminal to refresh the browser profile, then restart the service.

### 3. Akamai / Bot Protection 403
- **Cause**: Headless detection triggered or proxy IP flagged.
- **Fix**: Ensure `channel: "chrome"` is available and `headless: false` is not modified. Rotate proxy IP using `npm run rotate-ip`.

### 4. Patchright installation missing
- **Cause**: `patchright` npm package or Chromium binaries not installed.
- **Fix**:
  ```bash
  npm install patchright
  npx patchright install chromium
  ```

---

## Project Structure

```
reddit-scraper-service/
├── .env.example              # Sample configuration & proxy credentials
├── package.json              # Service dependencies & lifecycle scripts
├── README.md                 # Project documentation
├── scripts/
│   ├── check-ip.js           # Pre-flight diagnostic for current exit IP
│   ├── login.js              # Interactive one-time manual login session
│   └── rotate-ip.js          # Sticky session IP rotation utility
└── src/
    ├── cache.js              # In-memory TTL cache with stale fallback
    ├── circuitBreaker.js     # Circuit breaker for legacy requests
    ├── config.js             # Environment variable validation & defaults
    ├── pageText.js           # Helper for extracting DOM text from browser
    ├── proxy.js              # Proxy agent builder & session token manager
    ├── rateLimiter.js        # Queue scheduler with delay and random jitter
    ├── reddit.js             # Reddit business logic & mapper methods
    ├── server.js             # Express API application & route definitions
    └── fetcher/
        ├── browser.js        # Stealth Patchright browser fetch implementation
        └── http.js           # Legacy HTTP axios client fallback
```

---

## License

Private & Proprietary. Internal use only.