require("dotenv").config();

function int(name, fallback) {
	const v = process.env[name];
	return v ? parseInt(v, 10) : fallback;
}

function bool(name, fallback) {
	const v = process.env[name];
	return v === undefined ? fallback : v === "true";
}

module.exports = {
	port: int("PORT", 4100),
	serviceApiKey: process.env.SERVICE_API_KEY,

	// "static" = round-robin a fixed PROXY_LIST (e.g. free datacenter proxies).
	// "rotating" = a paid sticky-residential gateway (IPRoyal by default).
	// Flip this once residential is purchased - everything else stays wired up.
	proxyMode: process.env.PROXY_MODE || "static",
	proxyStaticList: process.env.PROXY_LIST || "",

	// Reddit now requires a logged-in session (May-Jul 2026 changes), which
	// means the exit IP has to stay consistent for the life of that session -
	// a real login can't sensibly jump cities between requests. So
	// ROTATING_PROXY_PASSWORD must be a sticky-session password generated via
	// the provider dashboard's "Sticky IP" toggle, not the default "Randomize"
	// one - see README.md.
	rotatingProxyHost: process.env.ROTATING_PROXY_HOST || "geo.iproyal.com",
	rotatingProxyPort: process.env.ROTATING_PROXY_PORT || "12321",
	rotatingProxyUsername: process.env.ROTATING_PROXY_USERNAME,
	rotatingProxyPassword: process.env.ROTATING_PROXY_PASSWORD,
	proxyStickyLifetime: process.env.PROXY_STICKY_LIFETIME || "24h",

	minRequestIntervalMs: int("MIN_REQUEST_INTERVAL_MS", 3000),
	circuitBreakerThreshold: int("CIRCUIT_BREAKER_THRESHOLD", 3),
	circuitBreakerCooldownMs: int("CIRCUIT_BREAKER_COOLDOWN_MS", 30 * 60 * 1000),
	enableBrowserFallback: bool("ENABLE_BROWSER_FALLBACK", false),
	cacheTtlMinutes: int("CACHE_TTL_MINUTES", 30),
};
