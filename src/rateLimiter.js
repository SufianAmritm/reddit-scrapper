const config = require("./config");

let queue = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Serializes every outbound reddit.com request behind a single queue so we
// never burst, and waits at least minRequestIntervalMs (+ random jitter)
// since the previous request finished.
function schedule(task) {
	const run = queue.then(async () => {
		const elapsed = Date.now() - lastRequestAt;
		const jitter = Math.floor(Math.random() * 1500);
		const wait = Math.max(0, config.minRequestIntervalMs - elapsed) + jitter;
		if (wait > 0) await sleep(wait);

		try {
			return await task();
		} finally {
			lastRequestAt = Date.now();
		}
	});

	// Keep the chain alive even if this task rejects.
	queue = run.catch(() => {});
	return run;
}

module.exports = { schedule };
