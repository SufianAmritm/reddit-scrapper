const path = require("path");
const proxy = require("../proxy");
const { getBodyText } = require("../pageText");

const PROFILE_DIR = path.join(__dirname, "..", "..", "data", "browser-profile");

let contextPromise = null;

// Patchright is an optional dependency (`npm install patchright` +
// `npx patchright install chromium`) - only required when someone actually
// enables the fallback, so a plain HTTP-only install/run never needs it.
function loadPatchright() {
	try {
		return require("patchright");
	} catch {
		throw new Error(
			"ENABLE_BROWSER_FALLBACK is true but patchright isn't installed. Run: " +
				"npm install patchright && npx patchright install chromium",
		);
	}
}

class SessionInvalidError extends Error {
	constructor() {
		super("reddit session missing or expired - run `npm run login` to (re)authenticate");
		this.name = "SessionInvalidError";
	}
}

class BlockedError extends Error {
	constructor(kind) {
		super(
			kind === "ratelimit"
				? "reddit rate-limited this exit IP - run `npm run rotate-ip` for a fresh IP"
				: "reddit/akamai blocked this request - check headless mode and exit IP, run `npm run rotate-ip`",
		);
		this.name = "BlockedError";
	}
}

// One persistent, on-disk Chrome profile (launchPersistentContext), reused
// for every fetch across the life of the process - not a fresh context per
// call, and not a storageState cookie dump reapplied onto a throwaway
// context. This is the same profile dir `npm run login` writes to, and it's
// the setup Patchright's stealth patches assume: no custom user agent, no
// forced viewport, real Chrome channel. Keeping it persistent also means the
// exit IP (sticky, see proxy.js) stays bound to the same logged-in profile
// for as long as the process runs.
async function getContext() {
	if (!contextPromise) {
		contextPromise = (async () => {
			const { chromium } = loadPatchright();

			const contextOptions = {
				channel: "chrome",
				headless: false,
				viewport: null,
				args: ["--window-position=-2400,-2400", "--window-size=1280,800"],
			};

			const picked = proxy.pickProxy();
			if (picked) {
				contextOptions.proxy = {
					server: `http://${picked.host}:${picked.port}`,
					username: picked.username,
					password: picked.password,
				};
			}

			const context = await chromium.launchPersistentContext(PROFILE_DIR, contextOptions);
			context.on("close", () => {
				contextPromise = null;
			});
			return context;
		})().catch((err) => {
			contextPromise = null;
			throw err;
		});
	}
	return contextPromise;
}

async function fetchJson(path_) {
	const context = await getContext();
	const page = await context.newPage();

	try {
		const response = await page.goto(`https://old.reddit.com${path_}`, {
			waitUntil: "domcontentloaded",
			timeout: 20000,
		});

		const text = await getBodyText(page);

		if (!response || response.status() !== 200) {
			if (/whoa there|pardner/i.test(text)) throw new BlockedError("ratelimit");
			if (/network security|blocked/i.test(text)) throw new BlockedError("akamai");
			if (/log ?in|sign ?up/i.test(text) || /\/login/.test(page.url())) throw new SessionInvalidError();
			throw new Error(`browser fetch got status ${response ? response.status() : "none"}`);
		}

		if (!text) throw new Error(`browser fetch for ${path_} returned an empty body`);

		return JSON.parse(text);
	} finally {
		await page.close();
	}
}

module.exports = { fetchJson, SessionInvalidError, BlockedError, PROFILE_DIR };
