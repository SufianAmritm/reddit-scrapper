const config = require("./config");

const store = new Map();

function get(key) {
	const entry = store.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		store.delete(key);
		return undefined;
	}
	return entry.value;
}

// Returns the last cached value for `key` regardless of TTL - used as a
// last-resort fallback when Reddit is actively blocking us and we'd rather
// serve something stale than nothing.
function getStale(key) {
	const entry = store.get(key);
	return entry ? entry.value : undefined;
}

function set(key, value) {
	store.set(key, { value, expiresAt: Date.now() + config.cacheTtlMinutes * 60 * 1000 });
}

module.exports = { get, set, getStale };
