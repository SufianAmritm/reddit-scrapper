require("dotenv").config();
const path = require("path");
const readline = require("readline");
const proxy = require("../src/proxy");
const { getBodyText } = require("../src/pageText");

const PROFILE_DIR = path.join(__dirname, "..", "data", "browser-profile");

function loadPatchright() {
	try {
		return require("patchright");
	} catch {
		throw new Error("Run: npm install patchright && npx patchright install chromium");
	}
}

function waitForEnter(prompt) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(prompt, () => {
			rl.close();
			resolve();
		});
	});
}

// One-time (or re-run-when-expired) manual login: opens a real, visible
// browser window through the same sticky proxy IP the running service will
// use, so the human logging in and the service reusing that session both
// look like the same person/location. Nothing here automates the login
// itself - no credentials are read from env or typed by code - you log in
// by hand, clear any CAPTCHA yourself, then the profile is closed cleanly.
//
// Uses launchPersistentContext (a real on-disk Chrome profile dir) instead
// of launch()+newContext()+storageState - this is the setup Patchright's
// stealth patches are built around, and browser.js reuses this exact
// profile dir, so there's no separate cookie-export step that can drift
// from what a real browser would persist (no custom user agent, no forced
// viewport - Patchright leaves these as the real launched browser reports).
async function main() {
	const { chromium } = loadPatchright();
	const picked = proxy.pickProxy();
	if (!picked) {
		console.error("No proxy configured - check PROXY_MODE / ROTATING_PROXY_* in .env");
		process.exit(1);
	}

	console.log(`Using proxy exit: ${picked.host}:${picked.port} (sticky - the running service will reuse this same IP)`);

	const context = await chromium.launchPersistentContext(PROFILE_DIR, {
		channel: "chrome",
		headless: false,
		viewport: null,
		proxy: { server: `http://${picked.host}:${picked.port}`, username: picked.username, password: picked.password },
	});
	const page = context.pages()[0] || (await context.newPage());

	// Land on the homepage first, like a real visitor, instead of jumping
	// straight to /login cold - and it doubles as a check that this exit IP
	// isn't already rate-limited before you bother typing credentials in.
	await page.goto("https://www.reddit.com/", { waitUntil: "domcontentloaded" });
	const landingText = await getBodyText(page);
	if (/whoa there|pardner/i.test(landingText)) {
		console.error(
			"\nThis exit IP is already rate-limited by Reddit (whoa there, pardner) before login was even attempted.\n" +
				"This is IP-level, not a code/fingerprint issue - generate a fresh Sticky IP session on the IPRoyal\n" +
				"dashboard and re-run `npm run login` (or `node scripts/check-ip.js` first to confirm it's clean).",
		);
		await context.close();
		process.exit(1);
	}

	await page.waitForTimeout(1500 + Math.random() * 1500);
	await page.goto("https://www.reddit.com/login");

	console.log("\nLog into the throwaway Reddit account in the opened browser window.");
	console.log("Clear any CAPTCHA/verification step yourself. Once you're fully logged in");
	await waitForEnter("and can see your feed, come back here and press Enter to save the session... ");

	await context.close();
	console.log(`Saved profile to ${PROFILE_DIR} - restart the service to pick it up.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
