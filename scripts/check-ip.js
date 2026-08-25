require("dotenv").config();
const proxy = require("../src/proxy");
const { getBodyText } = require("../src/pageText");

// Cheap pre-flight: loads reddit.com's homepage (NOT /login) through the
// current sticky proxy session and reports whether the exit IP is already
// rate-limited/flagged, before you spend a login attempt on it. The "whoa
// there, pardner!" wall is Reddit's raw per-IP request-volume gate - it's
// unrelated to browser fingerprint/stealth, so this doesn't need Patchright,
// a plain headless check is enough to tell if the IP itself is burned.
function loadPatchright() {
	try {
		return require("patchright");
	} catch {
		throw new Error("Run: npm install patchright && npx patchright install chromium");
	}
}

async function main() {
	const { chromium } = loadPatchright();
	const picked = proxy.pickProxy();
	if (!picked) {
		console.error("No proxy configured - check PROXY_MODE / ROTATING_PROXY_* in .env");
		process.exit(1);
	}
	console.log(`Checking exit IP via ${picked.host}:${picked.port}...`);

	const browser = await chromium.launch({
		channel: "chrome",
		headless: false,
		args: ["--window-position=-2400,-2400", "--window-size=1280,800"],
	});
	const context = await browser.newContext({
		viewport: null,
		proxy: { server: `http://${picked.host}:${picked.port}`, username: picked.username, password: picked.password },
	});
	const page = await context.newPage();

	try {
		const ipRes = await page.goto("https://ipv4.icanhazip.com/", { timeout: 15000 });
		const ip = (await ipRes.text()).trim();
		console.log(`Exit IP: ${ip}`);

		const response = await page.goto("https://www.reddit.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
		const text = await getBodyText(page);

		if (/whoa there|pardner/i.test(text)) {
			console.log("RESULT: BLOCKED - this exit IP is already rate-limited by Reddit.");
			console.log("Generate a fresh Sticky IP session on the IPRoyal dashboard and re-run this check " +
				"BEFORE attempting `npm run login` again - don't burn login attempts on a dead IP.");
		} else if (!response || response.status() >= 400) {
			console.log(`RESULT: UNCLEAR - got HTTP ${response ? response.status() : "no response"}. Inspect manually.`);
		} else {
			console.log("RESULT: CLEAN - homepage loaded normally. Safe to run `npm run login` on this session now.");
		}
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
