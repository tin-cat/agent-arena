/*
 * Browser entry point: wires the simulation core to the renderer, the HUD and
 * the controls, and runs the real-time loop.
 *
 * The time multiplier is derived continuously from scene activity (see
 * sim-core: updateTimeMultiplier) and is never keyed on simulated time. A
 * manual override (the slider / FIXED_MULTIPLIER) can pin it for fast testing.
 */
(function () {
	"use strict";
	const T = window.TitanicSim;
	const C = T.CONFIG;

	const canvas = document.getElementById("scene");
	let sim, renderer;

	// ---- run-time controls ----
	const ctrl = {
		playing: true,
		// null => automatic (activity-driven). A number pins the multiplier for
		// the whole run (used for fast testing); the UI slider sets this.
		FIXED_MULTIPLIER: null,
		maxSubstepsPerFrame: 800,
		wallStart: performance.now(),
		wallElapsed: 0,
		finished: false,
		finishedWall: 0,
	};
	// expose for console / automated testing
	window.TITANIC = ctrl;

	function build() {
		sim = T.createSimulation();
		renderer = new window.TitanicRenderer(canvas, sim);
		renderer.resize();
		ctrl.wallStart = performance.now();
		ctrl.wallElapsed = 0;
		ctrl.finished = false;
		ctrl.finishedWall = 0;
		window.TITANIC.sim = sim;
	}

	function fmtClock(s) {
		let total = 23 * 3600 + 40 * 60 + s;
		const h = Math.floor(total / 3600) % 24;
		const m = Math.floor((total % 3600) / 60);
		const sec = Math.floor(total % 60);
		const p = (n) => String(n).padStart(2, "0");
		return `${p(h)}:${p(m)}:${p(sec)}`;
	}

	function statusText() {
		const st = sim.state;
		if (ctrl.finished) return "At rest on the seafloor — 3,800 m down";
		if (st.brokenAt) return "BROKEN IN TWO — sections sinking";
		const trim = Math.abs((st.parts.find((p) => p.kind === "hull").body.getAngle() * 180) / Math.PI);
		const bow = -st.parts[0].body.getPosition().y;
		if (bow > 25 && trim > 12) return "Stern rising — hull near failure";
		if (bow > 8) return "Bow submerging — forward decks awash";
		if (trim > 3) return "Down by the head, trim increasing";
		return "Flooding forward compartments";
	}

	let lastTs = 0;
	function frame(ts) {
		const realDt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
		lastTs = ts;

		// time multiplier (auto unless pinned)
		let mult;
		if (ctrl.FIXED_MULTIPLIER != null) {
			mult = ctrl.FIXED_MULTIPLIER;
			sim.state.timeMul = mult;
		} else {
			mult = sim.updateTimeMultiplier();
		}

		if (ctrl.playing && !ctrl.finished) {
			let simBudget = mult * realDt; // simulated seconds to advance this frame
			let n = Math.min(ctrl.maxSubstepsPerFrame, Math.ceil(simBudget / C.DT));
			for (let i = 0; i < n; i++) {
				sim.step(C.DT);
				if (sim.isSettled() && sim.state.time > 60) { ctrl.finished = true; ctrl.finishedWall = ctrl.wallElapsed; break; }
			}
			ctrl.wallElapsed = (performance.now() - ctrl.wallStart) / 1000;
		}

		renderer.updateCamera(realDt);
		renderer.draw(realDt);
		updateHUD(mult);
		requestAnimationFrame(frame);
	}

	// ---- HUD ----
	const el = (id) => document.getElementById(id);
	function updateHUD(mult) {
		const st = sim.state;
		const trim = ((st.parts.find((p) => p.kind === "hull").body.getAngle() * 180) / Math.PI);
		const bow = -st.parts[0].body.getPosition().y;
		const lowest = Math.min(...st.parts.map((p) => p.body.getPosition().y));
		el("clock").textContent = fmtClock(st.time);
		el("simElapsed").textContent = (st.time / 60).toFixed(1) + " min";
		el("wall").textContent = ctrl.wallElapsed.toFixed(1) + " s";
		el("mult").textContent = mult >= 1 ? (mult < 10 ? mult.toFixed(1) : Math.round(mult)) + "x" : mult.toFixed(2) + "x";
		el("water").textContent = (st.totals.waterMass / 1e6).toFixed(0) + " kt";
		el("flooded").textContent = (st.totals.floodedFraction * 100).toFixed(1) + "%";
		el("trim").textContent = Math.abs(trim).toFixed(1) + "°";
		el("depth").textContent = (Math.max(0, -lowest)).toFixed(0) + " m";
		el("pieces").textContent = st.pieceCount;
		el("status").textContent = statusText();
		if (!ctrl.FIXED_MULTIPLIER) { el("multSlider").value = Math.log10(Math.max(1, mult)).toFixed(3); }

		// compartment flood bars
		const cont = el("comps");
		if (cont.childElementCount !== st.compartments.length) {
			cont.innerHTML = "";
			for (const cm of st.compartments) {
				const row = document.createElement("div"); row.className = "comprow";
				row.innerHTML = `<span class="cname">${cm.name}</span><span class="cbar"><i></i></span>`;
				cont.appendChild(row);
			}
		}
		const rows = cont.children;
		for (let i = 0; i < st.compartments.length; i++) {
			const f = st.compartments[i].levelFrac;
			const bar = rows[i].querySelector("i");
			bar.style.width = Math.min(100, f * 100).toFixed(0) + "%";
			bar.style.background = f > 0.98 ? "#2f6da6" : "#3f93c8";
		}
	}

	// ---- UI wiring ----
	function wireUI() {
		el("playPause").addEventListener("click", () => {
			ctrl.playing = !ctrl.playing;
			el("playPause").textContent = ctrl.playing ? "⏸ Pause" : "▶ Play";
		});
		el("restart").addEventListener("click", () => {
			build();
			el("playPause").textContent = "⏸ Pause";
		});
		const slider = el("multSlider");
		const auto = el("autoMult");
		slider.addEventListener("input", () => {
			if (auto.checked) { auto.checked = false; }
			ctrl.FIXED_MULTIPLIER = Math.pow(10, parseFloat(slider.value));
			el("multManual").textContent = Math.round(ctrl.FIXED_MULTIPLIER) + "x";
		});
		auto.addEventListener("change", () => {
			ctrl.FIXED_MULTIPLIER = auto.checked ? null : Math.pow(10, parseFloat(slider.value));
			el("multManual").textContent = auto.checked ? "auto" : Math.round(ctrl.FIXED_MULTIPLIER) + "x";
		});
		el("multManual").textContent = "auto";
		window.addEventListener("resize", () => renderer && renderer.resize());
	}

	build();
	wireUI();
	requestAnimationFrame(frame);
})();
