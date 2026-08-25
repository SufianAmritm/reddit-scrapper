const config = require("./config");
const cache = require("./cache");
const rateLimiter = require("./rateLimiter");
const circuitBreaker = require("./circuitBreaker");
const httpFetcher = require("./fetcher/http");

function mapPost(post) {
	return {
		source: "reddit",
		subreddit: post.subreddit,
		title: post.title,
		url: `https://reddit.com${post.permalink}`,
		createdUtc: post.created_utc,
		numComments: post.num_comments,
		score: post.score,
	};
}

// Fetches `path` respecting cache first. Reddit deprecated unauthenticated
// .json access in May 2026, so when ENABLE_BROWSER_FALLBACK is on, the
// authenticated browser session (see fetcher/browser.js) is the real path -
// no point spending a rate-limited request on the anonymous HTTP path first
// when we already know it's dead. The anonymous path + circuit breaker is
// kept as a legacy fallback only for when browser mode is off, in case
// Reddit ever reopens unauthenticated access.
async function fetchListing(path, cacheKey) {
	const cached = cache.get(cacheKey);
	if (cached !== undefined) return cached;

	if (config.enableBrowserFallback) {
		const browserFetcher = require("./fetcher/browser");
		try {
			const data = await rateLimiter.schedule(() => browserFetcher.fetchJson(path));
			cache.set(cacheKey, data);
			return data;
		} catch (err) {
			console.error(`[reddit] browser fetch failed for ${path}: ${err.message}`);
		}
	} else if (!circuitBreaker.isOpen()) {
		try {
			const data = await rateLimiter.schedule(() => httpFetcher.fetchJson(path));
			circuitBreaker.recordSuccess();
			cache.set(cacheKey, data);
			return data;
		} catch (err) {
			if (err.name === "BlockedError") {
				circuitBreaker.recordFailure();
			} else {
				throw err;
			}
		}
	}

	const stale = cache.getStale(cacheKey);
	if (stale !== undefined) return stale;

	throw new Error(`reddit unreachable for ${path}`);
}

async function fetchNewPosts(subreddit, limit = 25) {
	const path = `/r/${subreddit}/new.json?limit=${limit}`;
	const data = await fetchListing(path, `new:${subreddit}:${limit}`);
	return data.data.children.map((child) => mapPost(child.data));
}

async function fetchAllowlistedSubreddits(subreddits) {
	const results = [];
	for (const subreddit of subreddits) {
		try {
			results.push(...(await fetchNewPosts(subreddit)));
		} catch (err) {
			console.error(`[reddit] failed to fetch r/${subreddit}: ${err.message}`);
		}
	}
	return results;
}

async function fetchPostById(id) {
	const path = `/api/info.json?id=t3_${id}`;
	const data = await fetchListing(path, `post:${id}`);
	return data.data.children[0]?.data || null;
}

module.exports = { fetchNewPosts, fetchAllowlistedSubreddits, fetchPostById };
