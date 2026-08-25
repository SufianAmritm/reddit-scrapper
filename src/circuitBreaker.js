const config = require("./config");

let consecutiveFailures = 0;
let openedAt = null;

function isOpen() {
	if (openedAt === null) return false;
	if (Date.now() - openedAt > config.circuitBreakerCooldownMs) {
		// Cooldown elapsed - let one request through (half-open) to test the water.
		openedAt = null;
		consecutiveFailures = 0;
		return false;
	}
	return true;
}

function recordSuccess() {
	consecutiveFailures = 0;
	openedAt = null;
}

function recordFailure() {
	consecutiveFailures += 1;
	if (consecutiveFailures >= config.circuitBreakerThreshold) {
		openedAt = Date.now();
	}
}

module.exports = { isOpen, recordSuccess, recordFailure };
