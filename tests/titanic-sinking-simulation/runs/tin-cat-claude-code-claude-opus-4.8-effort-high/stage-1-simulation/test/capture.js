/*
 * Visual capture + progress verification. Loads the page in headless Chromium,
 * pins a high time multiplier, and snapshots the scene at emergent milestones
 * (bow under, the break, the descent, the wreck at rest). Also reports the
 * wall-clock time to founder so the ~1-minute target can be checked.
 */
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

(async () => {
	const url = "file://" + path.resolve(__dirname, "..", "index.html");
	const shotDir = path.resolve(__dirname, "..", "assets");
	fs.mkdirSync(shotDir, { recursive: true });

	const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--use-gl=swiftshader"] });
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
	const errors = [];
	page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

	await page.goto(url, { waitUntil: "load" });
	await new Promise((r) => setTimeout(r, 400));
	await page.evaluate(() => { window.TITANIC.FIXED_MULTIPLIER = 1500; });

	const milestones = [
		{ key: "bowunder", test: (s) => s.bowDepth > 12, shot: "shot-bowunder.png", done: false },
		{ key: "break", test: (s) => s.broken, shot: "shot-break.png", done: false },
		{ key: "descent", test: (s) => s.deepest > 1200, shot: "shot-descent.png", done: false },
		{ key: "settled", test: (s) => s.finished, shot: "shot-settled.png", done: false },
	];

	const t0 = Date.now();
	let last = null;
	while (Date.now() - t0 < 70000) {
		await new Promise((r) => setTimeout(r, 250));
		const s = await page.evaluate(() => {
			const st = window.TITANIC.sim.state;
			return {
				time: st.time, flooded: st.totals.floodedFraction, broken: !!st.brokenAt,
				pieces: st.pieceCount, finished: window.TITANIC.finished, wall: window.TITANIC.wallElapsed,
				deepest: Math.max(...st.parts.map((p) => -p.body.getPosition().y)),
				bowDepth: -st.parts[0].body.getPosition().y,
				funnels: st.joints.filter((j) => j.kind === "funnel" && j.broken).length,
				mult: st.timeMul,
			};
		});
		last = s;
		for (const m of milestones) {
			if (!m.done && m.test(s)) { m.done = true; await page.screenshot({ path: path.join(shotDir, m.shot) }); console.log(`captured ${m.key} at t+${(s.time / 60).toFixed(0)}min wall=${s.wall.toFixed(1)}s`); }
		}
		if (s.finished) break;
	}
	await page.screenshot({ path: path.join(shotDir, "shot-end.png") });
	console.log("Errors:", errors.length ? errors : "none");
	console.log("Final:", JSON.stringify(last));
	await browser.close();
	const ok = errors.length === 0 && last.broken && last.deepest > 3400 && last.funnels >= 2;
	console.log(ok ? "CAPTURE: PASS" : "CAPTURE: FAIL");
	process.exit(ok ? 0 : 1);
})();
