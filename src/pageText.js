// reddit.com redirects/reflows client-side right after `domcontentloaded`
// fires (locale/consent handling), so a single immediate evaluate() can hit
// "Execution context was destroyed" (mid-navigation) or a null document.body
// (page swapped to a blank interstitial). Wait for the load event and retry
// through a few of these races instead of treating them as real failures.
async function getBodyText(page, { retries = 4, delayMs = 750 } = {}) {
	await page.waitForLoadState("load").catch(() => {});

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const text = await page.evaluate(() => document.body && document.body.innerText);
			if (text) return text;
		} catch {
			// execution context destroyed by a navigation - fall through and retry
		}
		await page.waitForTimeout(delayMs);
	}

	return "";
}

module.exports = { getBodyText };
