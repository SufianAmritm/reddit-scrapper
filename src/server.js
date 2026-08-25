const express = require("express");
const config = require("./config");
const reddit = require("./reddit");

if (!config.serviceApiKey) {
	console.error("SERVICE_API_KEY is not set - refusing to start with an unauthenticated API");
	process.exit(1);
}

const app = express();

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
	const header = req.headers.authorization || "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : null;
	if (token !== config.serviceApiKey) return res.status(401).json({ error: "unauthorized" });
	next();
});

app.get("/subreddit/:name/new", async (req, res) => {
	const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
	try {
		const posts = await reddit.fetchNewPosts(req.params.name, limit);
		res.json({ posts });
	} catch (err) {
		res.status(502).json({ error: err.message });
	}
});

app.get("/post/:id", async (req, res) => {
	try {
		const post = await reddit.fetchPostById(req.params.id);
		if (!post) return res.status(404).json({ error: "not found" });
		res.json({ post });
	} catch (err) {
		res.status(502).json({ error: err.message });
	}
});

app.listen(config.port, () => {
	console.log(`reddit-scraper-service listening on :${config.port}`);
});
