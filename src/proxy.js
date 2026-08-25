const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");
const config = require("./config");

let staticIndex = 0;

const SESSION_FILE = path.join(__dirname, "..", "data", ".proxy-session");

function basePassword() {
	return String(config.rotatingProxyPassword || "").split("_session-")[0];
}

function readSessionToken() {
	try {
		const v = fs.readFileSync(SESSION_FILE, "utf8").trim();
		if (v) return v;
	} catch {}
	return newSessionToken();
}

function newSessionToken() {
	const token = crypto.randomBytes(4).toString("hex");
	fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
	fs.writeFileSync(SESSION_FILE, token);
	return token;
}

function stickyPassword() {
	return `${basePassword()}_session-${readSessionToken()}_lifetime-${config.proxyStickyLifetime}`;
}

function parseStaticList(raw) {
	return raw
		.split(/[\n,;]+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [host, port, username, password] = line.split(":");
			return { host, port, username, password };
		});
}

const staticList = parseStaticList(config.proxyStaticList);

function isConfigured() {
	if (config.proxyMode === "rotating")
		return Boolean(config.rotatingProxyUsername && config.rotatingProxyPassword);
	return staticList.length > 0;
}

// Returns { host, port, username, password } for the next proxy to use, or
// null if none configured. In "static" mode this round-robins a fixed list
// (each entry a dedicated, non-rotating exit IP); in "rotating" mode it uses
// ROTATING_PROXY_PASSWORD as-is - this must be a sticky-session password
// generated via the provider dashboard's "Sticky IP" toggle (not the default
// "Randomize" one), so the exit IP stays fixed rather than changing per
// request. See reddit-scraper-service/README.md.
function pickProxy() {
	if (config.proxyMode === "rotating") {
		if (!config.rotatingProxyUsername || !config.rotatingProxyPassword) return null;
		return {
			host: config.rotatingProxyHost,
			port: config.rotatingProxyPort,
			username: config.rotatingProxyUsername,
			password: stickyPassword(),
		};
	}

	if (staticList.length === 0) return null;
	const proxy = staticList[staticIndex % staticList.length];
	staticIndex += 1;
	return proxy;
}

function newAgent() {
	const proxy = pickProxy();
	if (!proxy) return null;

	const proxyUrl = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(
		proxy.password,
	)}@${proxy.host}:${proxy.port}`;

	return new HttpsProxyAgent(proxyUrl, { keepAlive: false });
}

module.exports = { newAgent, pickProxy, isConfigured, newSessionToken, readSessionToken };
