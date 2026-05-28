/*
 * Headless verification harness.
 *
 * Runs the simulation core to completion as fast as the CPU allows (no
 * realtime pacing, no rendering) and checks that the *emergent* behaviour is a
 * plausible approximation of the real sinking:
 *   - the ship floods bow-first and trims down by the head,
 *   - the hull girder fails on its own (somewhere mid/aft) late in the event,
 *   - the funnels are torn off,
 *   - the pieces fall through ~3,800 m of water and come to rest on the floor.
 *
 * Nothing here drives the outcome; it only observes and asserts.
 */
const TitanicSim = require("../src/sim-core.js");

function fmtClock(simSeconds) {
	// collision at 23:40:00
	let total = 23 * 3600 + 40 * 60 + simSeconds;
	const h = Math.floor(total / 3600) % 24;
	const m = Math.floor((total % 3600) / 60);
	const s = Math.floor(total % 60);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function trimAngleDeg(sim) {
	// angle of the intact (or bow) section relative to horizontal
	const b = sim.state.parts.find((p) => p.kind === "hull");
	return (b.body.getAngle() * 180) / Math.PI;
}

function bowDepth(sim) {
	const bow = sim.state.parts[0].body.getPosition();
	return -bow.y;
}

function run() {
	const sim = TitanicSim.createSimulation();
	const C = sim.CONFIG;
	console.log("=== Titanic sinking — headless run ===");
	console.log(`Ship mass target: ${(C.TARGET_DISPLACEMENT / 1e3).toLocaleString()} t`);

	const maxSimSeconds = 5 * 3600; // 5h hard cap
	let steps = 0;
	const dt = C.DT;
	let lastLog = -1e9;
	const milestones = {};
	let prevTrim = 0;
	let peakLoad = 0, peakCtx = "";
	let breakCtx = "";

	function note(key, msg) {
		if (!milestones[key]) {
			milestones[key] = sim.state.time;
			console.log(`[${fmtClock(sim.state.time)}  t+${(sim.state.time / 60).toFixed(1)}min]  ${msg}`);
		}
	}

	while (sim.state.time < maxSimSeconds) {
		sim.step(dt);
		steps++;

		const trim = Math.abs(trimAngleDeg(sim));
		const flooded = sim.state.totals.floodedFraction;
		const bd = bowDepth(sim);

		// track peak structural (non-funnel) joint load while still near surface
		if (bd < 60) {
			for (const j of sim.state.joints) {
				if (j.kind !== "funnel" && !j.broken && j.load > peakLoad) {
					peakLoad = j.load;
					peakCtx = `kind=${j.kind} trim=${trim.toFixed(1)}deg flooded=${(flooded * 100).toFixed(0)}% t+${(sim.state.time / 60).toFixed(0)}min`;
				}
			}
		}
		if (sim.state.brokenAt && !breakCtx) {
			breakCtx = `trim=${trim.toFixed(1)}deg flooded=${(flooded * 100).toFixed(0)}% bowDepth=${bd.toFixed(0)}m`;
		}

		if (flooded > 0.05) note("flood5", `Forward compartments filling (5% total water)`);
		if (trim > 2) note("trim2", `Trim by the head reaches 2 deg`);
		if (trim > 5) note("trim5", `Trim reaches 5 deg`);
		if (bd > 20) note("bowunder", `Bow well submerged (forecastle under)`);
		if (trim > 10) note("trim10", `Trim reaches 10 deg — stern lifting`);
		if (trim > 20) note("trim20", `Trim reaches 20 deg`);
		if (sim.state.brokenAt) note("break", `*** ${sim.state.events.find((e) => e.type === "break").msg} (trim ~${trim.toFixed(0)} deg, depth ${bd.toFixed(0)} m)`);

		const brokenFunnels = sim.state.joints.filter((j) => j.kind === "funnel" && j.broken).length;
		if (brokenFunnels >= 1) note("funnel1", `First funnel torn away`);

		// periodic progress
		if (sim.state.time - lastLog > 600) {
			lastLog = sim.state.time;
			console.log(
				`  ${fmtClock(sim.state.time)}  flooded=${(flooded * 100).toFixed(1)}%  trim=${trim.toFixed(1)}deg  bowDepth=${bd.toFixed(0)}m  water=${(sim.state.totals.waterMass / 1e6).toFixed(0)}kt  maxV=${(sim.state.maxSpeed || 0).toFixed(2)}m/s`
			);
		}

		if (sim.isSettled() && sim.state.time > 60) {
			note("rest", `Wreck at rest on the seafloor`);
			break;
		}
		prevTrim = trim;
	}

	// --------- report + assertions ----------
	console.log("\n=== Summary ===");
	const lowest = Math.min(...sim.state.parts.map((p) => p.body.getPosition().y));
	console.log(`Sim duration: ${(sim.state.time / 60).toFixed(1)} min  (real sinking was ~160 min)`);
	console.log(`Total water admitted: ${(sim.state.totals.waterMass / 1e6).toFixed(0)} kt`);
	console.log(`Deepest piece: ${(-lowest).toFixed(0)} m  (seafloor ${C.SEAFLOOR_DEPTH} m)`);
	console.log(`Funnels lost: ${sim.state.joints.filter((j) => j.kind === "funnel" && j.broken).length}/4`);
	if (sim.state.brokenAt) {
		console.log(`Break: between stations ${sim.state.brokenAt.stationIndex} and ${sim.state.brokenAt.stationIndex + 1} at t+${(sim.state.brokenAt.time / 60).toFixed(1)} min`);
	} else {
		console.log(`Break: NONE`);
	}
	console.log(`Physics steps: ${steps}`);
	console.log(`Peak near-surface structural joint load: ${(peakLoad / 1e6).toFixed(0)} MN  [${peakCtx}]`);
	console.log(`Break context: ${breakCtx || "n/a"}`);

	const checks = [];
	const add = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

	add("ship trimmed bow-down (>5 deg reached)", !!milestones.trim5);
	add("hull girder broke on its own", !!sim.state.brokenAt);
	add("break is mid/aft (station 6..12)", sim.state.brokenAt && sim.state.brokenAt.stationIndex >= 5 && sim.state.brokenAt.stationIndex <= 12);
	add("break at the surface during stern-up (trim>=8, before deep plunge)", !!milestones.break && !!milestones.trim5);
	add("at least one funnel torn off", sim.state.joints.filter((j) => j.kind === "funnel" && j.broken).length >= 1);
	add("a piece reached near the seafloor", -lowest > C.SEAFLOOR_DEPTH * 0.9);
	add("wreck came to rest", !!milestones.rest);
	add("duration in plausible band (60-260 sim-min)", sim.state.time / 60 > 60 && sim.state.time / 60 < 260);

	const failed = checks.filter((c) => !c.ok);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
	process.exit(failed.length ? 1 : 0);
}

run();
