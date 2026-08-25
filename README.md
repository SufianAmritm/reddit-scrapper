# Reddit Scraper Microservice

A lightweight Node.js microservice that fetches Reddit listings and posts via stealth browser automation ([Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)) and sticky residential proxying.

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Set SERVICE_API_KEY, ROTATING_PROXY_USERNAME, and ROTATING_PROXY_PASSWORD in .env

# 3. Check if your proxy IP is clean
npm run check-ip

# 4. Perform one-time manual login (opens a browser window)
npm run login

# 5. Start the service
npm start
```

---

## 📋 Available Commands

| Command | Description |
| :--- | :--- |
| `npm start` | Starts the Express server (default port `4100`). |
| `npm run check-ip` | Tests if the current proxy exit IP is blocked by Reddit. |
| `npm run rotate-ip` | Mints a new sticky proxy session token for a fresh IP. |
| `npm run login` | Opens a headed browser to log into Reddit and persist the session. |

---

## 🔌 API Endpoints

All requests (except `/healthz`) require `Authorization: Bearer <SERVICE_API_KEY>`.

### `GET /healthz`
Liveness check.
```json
{ "ok": true }
```

### `GET /subreddit/:name/new?limit=25`
Fetches newest posts from a subreddit (default `limit: 25`).

```bash
curl -H "Authorization: Bearer YOUR_KEY" "http://localhost:4100/subreddit/webdev/new?limit=5"
```

```json
{
  "posts": [
    {
      "source": "reddit",
      "subreddit": "webdev",
      "title": "Example Post Title",
      "url": "https://reddit.com/r/webdev/comments/1abc23/example/",
      "createdUtc": 1756123456,
      "numComments": 14,
      "score": 42
    }
  ]
}
```

### `GET /post/:id`
Fetches single post details by Reddit ID (e.g. `1abc23` for `t3_1abc23`).

```bash
curl -H "Authorization: Bearer YOUR_KEY" "http://localhost:4100/post/1abc23"
```

```json
{
  "post": {
    "id": "1abc23",
    "subreddit": "webdev",
    "title": "Example Post Title",
    "score": 42,
    "num_comments": 14,
    "created_utc": 1756123456,
    "permalink": "/r/webdev/comments/1abc23/example/",
    "url": "https://www.reddit.com/r/webdev/comments/1abc23/example/"
  }
}
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `4100` | HTTP server port |
| `SERVICE_API_KEY` | *(Required)* | Bearer authentication secret |
| `PROXY_MODE` | `rotating` | `rotating` (residential) or `static` |
| `ROTATING_PROXY_HOST` | `geo.iproyal.com` | Residential proxy host |
| `ROTATING_PROXY_PORT` | `12321` | Residential proxy port |
| `ROTATING_PROXY_USERNAME` | — | Proxy username |
| `ROTATING_PROXY_PASSWORD` | — | Base password (**no** `_session-` suffix) |
| `PROXY_STICKY_LIFETIME` | `24h` | Sticky duration per IP (`30m`, `24h`, `168h`) |
| `ENABLE_BROWSER_FALLBACK` | `true` | Must be `true` for authenticated browser scraping |
| `MIN_REQUEST_INTERVAL_MS`| `3000` | Minimum delay between requests |
| `CACHE_TTL_MINUTES` | `30` | In-memory response cache TTL |

---

## 💡 Important Notes

- **Login Required**: Reddit requires an active session for `.json` endpoints. Use a **throwaway account**.
- **Headed Mode**: The browser runs in headed mode off-screen (`--window-position=-2400,-2400`). Headless mode is blocked by Akamai.
- **"Whoa there, pardner!"**: Rate-limited IP. Run `npm run rotate-ip`, check with `npm run check-ip`, and restart the service.
- **Session Expired**: If `SessionInvalidError` occurs, re-run `npm run login`.
- **Production**: Recommended to run under PM2 (`pm2 start src/server.js --name reddit-scraper-service`).