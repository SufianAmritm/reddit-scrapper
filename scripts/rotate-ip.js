require("dotenv").config();
const proxy = require("../src/proxy");

const before = proxy.readSessionToken();
const after = proxy.newSessionToken();

console.log(`Rotated sticky proxy session: ${before} -> ${after}`);
console.log("Restart the service (and re-run `npm run check-ip`) to pick up the new exit IP.");
