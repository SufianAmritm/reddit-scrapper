const axios = require("axios");
const proxy = require("../proxy");

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const BASE_HEADERS = {
	"User-Agent": USER_AGENT,
	Accept: "application/json, text/plain, */*",
	"Accept-Language": "en-US,en;q=0.9",
};

class BlockedError extends Error {
	constructor(status) {
		super(`reddit blocked the request (status ${status})`);
		this.name = "BlockedError";
		this.status = status;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// old.reddit.com's .json endpoints have historically been less aggressively
// gated than www/oauth for plain read requests - used as the primary path.
async function fetchJson(path, { maxRetries = 2 } = {}) {
	let lastErr;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await axios.get(`https://old.reddit.com${path}`, {
				headers: BASE_HEADERS,
				httpsAgent: proxy.newAgent() || undefined,
				timeout: 10000,
				validateStatus: () => true,
			});

			if (response.status === 200) return response.data;

			if (response.status === 403 || response.status === 429) {
				lastErr = new BlockedError(response.status);
				const retryAfterSec = parseInt(response.headers["retry-after"], 10);
				const backoffMs = retryAfterSec
					? retryAfterSec * 1000
					: 1000 * 2 ** attempt + Math.random() * 500;
				if (attempt < maxRetries) await sleep(backoffMs);
				continue;
			}

			throw new Error(`unexpected status ${response.status}`);
		} catch (err) {
			lastErr = err;
			if (err.name === "BlockedError") continue;
			break;
		}
	}

	throw lastErr;
}

module.exports = { fetchJson, BlockedError };
