/*
 * Titanic sinking — simulation core (DOM-independent).
 *
 * Runs both in the browser (attaches to window.TitanicSim) and in Node
 * (module.exports) so the exact same physics can be driven by the renderer
 * or by the headless test harness.
 *
 * Everything is in real SI units: metres, seconds, kilograms, newtons.
 * The only "3rd dimension" is the ship's beam, used to turn the 2D side-view
 * areas into real volumes/masses. See README.md for the full model.
 *
 * Nothing here is keyed on time or scripts the outcome. The hull break, the
 * funnel falls and the time multiplier all emerge from forces and joint loads.
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory(require("planck"));
	} else {
		root.TitanicSim = factory(root.planck);
	}
})(typeof self !== "undefined" ? self : this, function (planck) {
	"use strict";

	const Vec2 = planck.Vec2;

	// ---------------------------------------------------------------------
	// Real-world parameters (the "ground truth" numbers).
	// ---------------------------------------------------------------------
	const CONFIG = {
		// Hull geometry (RMS Titanic, real figures)
		LENGTH: 269.1, // m, length overall
		BEAM: 28.2, // m, max breadth — the implicit 3rd dimension
		HULL_DEPTH: 19.7, // m, moulded depth (keel to top of hull girder)
		DRAFT: 10.5, // m, load draft (keel to waterline)
		KEEL_TO_FUNNEL_TOP: 53.3, // m

		TARGET_DISPLACEMENT: 52310e3, // kg, loaded displacement (the ship's mass)

		// Environment
		RHO_WATER: 1027, // kg/m^3, cold North Atlantic seawater
		G: 9.81, // m/s^2
		SEAFLOOR_DEPTH: 3800, // m, real wreck depth
		SEA_LEVEL_Y: 0, // world y of the sea surface

		// Flooding (Torricelli). Cd ~0.6 + total breach ~1.1 m^2 reproduces
		// Wilding's testimony of ~16,000 t flooded in the first ~40 minutes.
		BREACH_TOTAL_AREA: 1.15, // m^2, total iceberg breach area
		DISCHARGE_CD: 0.6, // orifice discharge coefficient
		OVERFLOW_CD: 0.5, // over-bulkhead / over-deck weir coefficient
		DOWNFLOOD_FRAC: 0.06, // over-deck downflooding before the hull is breached open
		DOWNFLOOD_FRAC_POST: 0.4, // after a break: torn-open sections have no watertight
		//                          decks left, so submerged compartments flood fast

		// Structure strengths (physical constants — NOT the break location/time,
		// which emerge). Tuned so the girder survives early trim and fails only
		// under the extreme stern-up bending moment late in the sinking.
		// The bottom chord carries the sagging tension and peaks ~825 MN just as
		// the stern lifts; the threshold sits just below that so only the single
		// peak-stress interface fails at the surface (a clean break in two),
		// then the hinging overloads that interface's top chord and bulkhead.
		HULL_JOINT_BREAK_FORCE: 7.4e8, // N, per hull-girder weld (top/bottom chord)
		// The compartment-to-hull weld carries the full water weight of the cell;
		// it is by far the strongest so a piece always stays a coherent
		// hull+compartment unit (and sinks) — it never sheds an empty shell.
		COMP_HULL_BREAK_FORCE: 6.0e10, // N
		BULKHEAD_BREAK_FORCE: 4.5e8, // N, compartment-to-compartment weld
		FUNNEL_BREAK_FORCE: 2.6e7, // N, funnel base weld
		JOINT_BREAK_TIME: 0.03, // s, brief overload persistence (filters solver noise)
		BREAK_GRACE: 1.2, // s, after a girder break, pause further girder breaks so
		//                   stress can redistribute (models a failure relieving the
		//                   bending moment, instead of the hull shattering at once)
		OPEN_END_BREACH_AREA: 16.0, // m^2, the torn-open cross-section of a severed end floods fast

		// Drag (sea resistance). Quadratic bluff-body drag, engine-integrated.
		DRAG_CD: 1.1,
		LINEAR_DAMPING: 0.15, // baseline velocity damping in water
		ANGULAR_DAMPING: 0.6,

		// Solver
		DT: 1 / 120, // s, fixed physics substep
		VEL_ITERS: 10,
		POS_ITERS: 6,

		// Time multiplier (derived from scene activity; never time-keyed).
		// The activity metric is a RATE OF CHANGE (max body acceleration, blended
		// with joint-stress rate) so that steady motion — e.g. the long
		// terminal-velocity descent — runs fast, while the break, the plunge and
		// the seafloor impact (big accelerations) slow right down.
		MULT_MIN: 1,
		MULT_MAX: 1000,
		MULT_CALIB: 26, // activity (m/s^2-equivalent) that maps to ~1x
		MULT_SMOOTH: 0.05, // low-pass factor per frame
		STRESS_RATE_REF: 1.5e8, // N/s of joint-load change that equals 1 m/s^2 of activity

		// Discretisation
		N_COMPARTMENTS: 16,
	};

	// 16 watertight compartments, bow -> stern (lettered A..P, "I" skipped in
	// reality). Relative lengths are normalised to LENGTH. Breach flags mark the
	// forward 6 compartments opened by the iceberg. bulkheadDeck is the deck the
	// AFT bulkhead of each compartment rises to (E deck amidships, D deck at the
	// ends) expressed as a fraction of hull depth above the keel.
	const COMPARTMENTS = [
		{ name: "Fore Peak", rel: 11, breach: 0.06, bhd: 0.86 },
		{ name: "Hold 1", rel: 15, breach: 0.16, bhd: 0.86 },
		{ name: "Hold 2", rel: 15, breach: 0.18, bhd: 0.82 },
		{ name: "Hold 3", rel: 17, breach: 0.2, bhd: 0.78 },
		{ name: "Boiler Rm 6", rel: 17, breach: 0.3, bhd: 0.74 },
		{ name: "Boiler Rm 5", rel: 17, breach: 0.1, bhd: 0.74 },
		{ name: "Boiler Rm 4", rel: 17, breach: 0, bhd: 0.74 },
		{ name: "Boiler Rm 3", rel: 17, breach: 0, bhd: 0.74 },
		{ name: "Boiler Rm 2", rel: 17, breach: 0, bhd: 0.74 },
		{ name: "Boiler Rm 1", rel: 17, breach: 0, bhd: 0.74 },
		{ name: "Recip. Engine", rel: 21, breach: 0, bhd: 0.74 },
		{ name: "Turbine Engine", rel: 21, breach: 0, bhd: 0.78 },
		{ name: "Electrical", rel: 14, breach: 0, bhd: 0.82 },
		{ name: "Aft Hold", rel: 13, breach: 0, bhd: 0.86 },
		{ name: "Steering", rel: 12, breach: 0, bhd: 0.86 },
		{ name: "Aft Peak", rel: 11, breach: 0, bhd: 0.86 },
	];

	// ---------------------------------------------------------------------
	// 2D polygon geometry helpers (shoelace + clip below a horizontal line)
	// ---------------------------------------------------------------------
	function polyAreaCentroid(pts) {
		let a = 0, cx = 0, cy = 0;
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i], q = pts[(i + 1) % pts.length];
			const cross = p.x * q.y - q.x * p.y;
			a += cross;
			cx += (p.x + q.x) * cross;
			cy += (p.y + q.y) * cross;
		}
		a *= 0.5;
		if (Math.abs(a) < 1e-9) return { area: 0, x: pts[0] ? pts[0].x : 0, y: pts[0] ? pts[0].y : 0 };
		return { area: Math.abs(a), x: cx / (6 * a), y: cy / (6 * a) };
	}

	// Clip polygon, keeping the region with y <= line (Sutherland-Hodgman).
	function clipBelow(pts, line) {
		const out = [];
		for (let i = 0; i < pts.length; i++) {
			const cur = pts[i], nxt = pts[(i + 1) % pts.length];
			const curIn = cur.y <= line, nxtIn = nxt.y <= line;
			if (curIn) out.push(cur);
			if (curIn !== nxtIn) {
				const t = (line - cur.y) / (nxt.y - cur.y);
				out.push({ x: cur.x + t * (nxt.x - cur.x), y: line });
			}
		}
		return out;
	}

	// Area + centroid of the part of `pts` below horizontal `line`.
	function submergedBelow(pts, line) {
		const clipped = clipBelow(pts, line);
		if (clipped.length < 3) return { area: 0, x: 0, y: 0 };
		return polyAreaCentroid(clipped);
	}

	// Find the horizontal surface y such that area below it == targetArea.
	function solveSurfaceY(pts, targetArea, ymin, ymax) {
		if (targetArea <= 1e-6) return { y: ymin, area: 0, cx: 0, cy: ymin };
		let lo = ymin, hi = ymax;
		for (let i = 0; i < 30; i++) {
			const mid = 0.5 * (lo + hi);
			if (submergedBelow(pts, mid).area < targetArea) lo = mid; else hi = mid;
		}
		const s = submergedBelow(pts, 0.5 * (lo + hi));
		return { y: 0.5 * (lo + hi), area: s.area, cx: s.x, cy: s.y };
	}

	// Transform body-local vertices into world space.
	function worldVerts(body, local) {
		const p = body.getPosition();
		const c = Math.cos(body.getAngle()), s = Math.sin(body.getAngle());
		const w = new Array(local.length);
		for (let i = 0; i < local.length; i++) {
			const v = local[i];
			w[i] = { x: p.x + (v.x * c - v.y * s), y: p.y + (v.x * s + v.y * c) };
		}
		return w;
	}

	// ---------------------------------------------------------------------
	// Simulation
	// ---------------------------------------------------------------------
	function createSimulation(opts) {
		opts = opts || {};
		const C = CONFIG;
		const world = new planck.World({ gravity: new Vec2(0, -C.G) });

		const state = {
			world: world,
			time: 0, // simulated seconds since just after collision (23:40)
			parts: [], // hull + compartment + funnel bodies (render/inspect)
			joints: [], // breakable joints with live load
			compartments: [], // flooding state
			funnels: [],
			seafloor: null,
			events: [], // emergent, observational log (not used to drive physics)
			totals: { waterMass: 0, floodedFraction: 0 },
			brokenAt: null, // {x, time} once the girder is severed (emergent)
			timeMul: 1,
			metric: 0,
			finished: false,
		};

		// ---- Build hull station geometry (side-view quads) ----
		const totalRel = COMPARTMENTS.reduce((s, c) => s + c.rel, 0);
		const keelY = -C.DRAFT; // keel sits at -draft so the waterline is y=0
		const deckY = keelY + C.HULL_DEPTH;
		const halfL = C.LENGTH / 2;

		// longitudinal boundaries (x) of each station
		const xb = [-halfL];
		for (let i = 0; i < COMPARTMENTS.length; i++) {
			xb.push(xb[i] + (COMPARTMENTS[i].rel / totalRel) * C.LENGTH);
		}

		// keel profile: keel rises toward the raked bow and the cruiser stern so
		// the hull is ship-shaped (block coefficient < 1), matching displacement.
		function keelAt(x) {
			const f = x / halfL; // -1 .. 1
			if (f > 0.78) {
				// bow: raked stem rises sharply
				const t = (f - 0.78) / 0.22;
				return keelY + t * t * 7.2;
			}
			if (f < -0.82) {
				const t = (-f - 0.82) / 0.18;
				return keelY + t * t * 6.0;
			}
			return keelY;
		}
		function deckAt(x) {
			const f = Math.abs(x / halfL);
			return deckY + 2.2 * f * f; // gentle sheer up toward the ends
		}

		// Build each station's hull quad and inset compartment quad (local coords
		// about the station centroid).
		const stations = [];
		for (let i = 0; i < COMPARTMENTS.length; i++) {
			const xl = xb[i], xr = xb[i + 1];
			// hull quad (CCW): bottom-left, bottom-right, top-right, top-left
			const hw = [
				{ x: xl, y: keelAt(xl) },
				{ x: xr, y: keelAt(xr) },
				{ x: xr, y: deckAt(xr) },
				{ x: xl, y: deckAt(xl) },
			];
			const hc = polyAreaCentroid(hw);
			const local = hw.map((p) => ({ x: p.x - hc.x, y: p.y - hc.y }));
			// compartment quad: inset by ~0.55 m walls toward the centroid
			const inset = 0.55;
			const comp = local.map((p) => {
				const dx = p.x, dy = p.y;
				const len = Math.hypot(dx, dy) || 1;
				return { x: dx - (dx / len) * inset, y: dy - (dy / len) * inset };
			});
			stations.push({
				idx: i,
				cx: hc.x, cy: hc.y,
				area: hc.area, // side-view area (m^2)
				volume: hc.area * C.BEAM, // m^3
				local: local, // hull local verts
				comp: comp, // compartment local verts
				compArea: polyAreaCentroid(comp).area,
				xl: xl, xr: xr,
				len: xr - xl,
				meta: COMPARTMENTS[i],
			});
		}

		// ---- Mass distribution to match real displacement ----
		const fullVol = stations.reduce((s, st) => s + st.volume, 0);
		// 88% of displacement in the hull girder, 12% as compartment structure.
		const hullMassTotal = C.TARGET_DISPLACEMENT * 0.88;
		const compStructTotal = C.TARGET_DISPLACEMENT * 0.12;

		// ---- Create bodies ----
		function makeBody(st, local, isComp) {
			const body = world.createBody({
				type: "dynamic",
				position: new Vec2(st.cx, st.cy),
				linearDamping: C.LINEAR_DAMPING,
				angularDamping: C.ANGULAR_DAMPING,
			});
			body.createFixture({
				shape: new planck.Polygon(local.map((p) => new Vec2(p.x, p.y))),
				density: 1, // real mass set explicitly below via setMassData
				friction: 0.7,
				restitution: 0.02,
			});
			return body;
		}

		const hullBodies = [];
		const compBodies = [];
		for (const st of stations) {
			const hull = makeBody(st, st.local, false);
			const hullMass = hullMassTotal * (st.volume / fullVol);
			const halfH = C.HULL_DEPTH / 2, halfW = st.len / 2;
			hull.setMassData({
				mass: hullMass,
				center: new Vec2(0, 0),
				I: (hullMass * (halfW * halfW * 4 + halfH * halfH * 4)) / 12,
			});
			hullBodies.push(hull);

			const comp = makeBody(st, st.comp, true);
			const compStruct = compStructTotal / stations.length;
			comp.setMassData({ mass: compStruct, center: new Vec2(0, 0), I: compStruct * 50 });
			compBodies.push(comp);

			state.parts.push({ kind: "hull", body: hull, st: st, local: st.local });
			state.parts.push({ kind: "comp", body: comp, st: st, local: st.comp });

			// per-compartment flooding state
			const compTopLocalY = Math.max(...st.comp.map((p) => p.y));
			const compBotLocalY = Math.min(...st.comp.map((p) => p.y));
			state.compartments.push({
				idx: st.idx,
				name: st.meta.name,
				body: comp,
				st: st,
				volume: 0, // m^3 of water currently inside
				maxVolume: st.compArea * C.BEAM,
				structMass: compStruct,
				breachArea: C.BREACH_TOTAL_AREA * st.meta.breach,
				breachLocalY: compBotLocalY + 0.5, // breach low in the compartment
				bulkheadFrac: st.meta.bhd,
				topLocalY: compTopLocalY,
				botLocalY: compBotLocalY,
				surfaceY: keelAt(st.cx), // world y of internal water surface
				levelFrac: 0,
			});
		}

		// ---- Joints (breakable) ----
		function weld(a, b, anchorWorld, breakForce, kind) {
			const j = world.createJoint(
				new planck.WeldJoint({ collideConnected: false }, a, b, new Vec2(anchorWorld.x, anchorWorld.y))
			);
			state.joints.push({ joint: j, a: a, b: b, breakForce: breakForce, kind: kind, load: 0, prevLoad: 0, broken: false, anchor: { x: anchorWorld.x, y: anchorWorld.y } });
			return j;
		}

		for (let i = 0; i < stations.length; i++) {
			const st = stations[i];
			// compartment <-> its hull (top & bottom)
			weld(hullBodies[i], compBodies[i], { x: st.cx, y: deckAt(st.cx) - 1 }, C.COMP_HULL_BREAK_FORCE, "comp-hull");
			weld(hullBodies[i], compBodies[i], { x: st.cx, y: keelAt(st.cx) + 1 }, C.COMP_HULL_BREAK_FORCE, "comp-hull");
			if (i + 1 < stations.length) {
				const xj = st.xr;
				// outer hull girder: top chord (deck) and bottom chord (keel)
				weld(hullBodies[i], hullBodies[i + 1], { x: xj, y: deckAt(xj) }, C.HULL_JOINT_BREAK_FORCE, "hull-top");
				weld(hullBodies[i], hullBodies[i + 1], { x: xj, y: keelAt(xj) }, C.HULL_JOINT_BREAK_FORCE, "hull-bot");
				// bulkhead link between adjacent compartments
				weld(compBodies[i], compBodies[i + 1], { x: xj, y: (deckAt(xj) + keelAt(xj)) / 2 }, C.BULKHEAD_BREAK_FORCE, "bulkhead");
			}
		}

		// ---- Funnels (4), attached to specific hull stations by weak welds ----
		// Funnel base x-positions along the ship (real layout: between bridge and
		// stern, spread over the boiler/engine rooms).
		const funnelStations = [4, 6, 8, 10];
		const funnelH = 19; // m, funnel proper above the boat deck (real ~19 m)
		for (let k = 0; k < funnelStations.length; k++) {
			const sIdx = funnelStations[k];
			const st = stations[sIdx];
			const baseX = st.cx, baseY = deckAt(st.cx);
			const fw = 3.6, fh = funnelH;
			const body = world.createBody({
				type: "dynamic",
				position: new Vec2(baseX, baseY + fh / 2),
				linearDamping: C.LINEAR_DAMPING,
				angularDamping: C.ANGULAR_DAMPING,
			});
			body.createFixture({
				shape: new planck.Box(fw / 2, fh / 2),
				density: 1,
				friction: 0.6,
				restitution: 0.05,
			});
			// funnel + uptake casing; floods and is denser than water so it sinks
			// (it displaces ~253 t, so mass must exceed that)
			const fmass = 330e3;
			body.setMassData({ mass: fmass, center: new Vec2(0, 0), I: (fmass * (fw * fw + fh * fh)) / 12 });
			const funnel = { body: body, w: fw, h: fh, local: [
				{ x: -fw / 2, y: -fh / 2 }, { x: fw / 2, y: -fh / 2 }, { x: fw / 2, y: fh / 2 }, { x: -fw / 2, y: fh / 2 },
			], volume: fw * fh * (fw) };
			state.funnels.push(funnel);
			state.parts.push({ kind: "funnel", body: body, local: funnel.local, funnel: funnel });
			weld(hullBodies[sIdx], body, { x: baseX, y: baseY }, C.FUNNEL_BREAK_FORCE, "funnel");
		}

		// ---- Connectivity bookkeeping (for emergent piece detection) ----
		const funnelBodies = state.funnels.map((f) => f.body);
		const shipBodies = hullBodies.concat(compBodies, funnelBodies);
		const bodyIndex = new Map();
		shipBodies.forEach((b, i) => bodyIndex.set(b, i));
		state.severedInterfaces = new Set();
		state.pieceCount = 1;

		// ---- Seafloor (static) ----
		const floorY = C.SEA_LEVEL_Y - C.SEAFLOOR_DEPTH;
		const floor = world.createBody({ type: "static", position: new Vec2(0, floorY - 200) });
		floor.createFixture({ shape: new planck.Box(C.LENGTH * 6, 200), friction: 0.95, restitution: 0.01 });
		state.seafloor = { y: floorY, body: floor };

		// =====================================================================
		// Per-substep update: flooding -> forces -> physics -> joint breaks
		// =====================================================================
		function bounds(wv) {
			let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
			for (const p of wv) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
			return { minx, maxx, miny, maxy };
		}

		function updateFlooding(dt) {
			const comps = state.compartments;
			// 1) work out each compartment's internal water surface y from volume
			for (const cm of comps) {
				const wv = worldVerts(cm.body, cm.st.comp);
				cm.worldVerts = wv;
				const bb = bounds(wv);
				cm.bb = bb;
				const targetArea = cm.volume / C.BEAM;
				const sol = solveSurfaceY(wv, targetArea, bb.miny, bb.maxy);
				cm.surfaceY = sol.y;
				cm.waterCx = sol.cx;
				cm.waterCy = sol.cy;
				cm.levelFrac = cm.maxVolume > 0 ? cm.volume / cm.maxVolume : 0;
				// world y of this compartment's aft bulkhead top and deck edge
				cm.bulkheadTopY = bb.miny + cm.bulkheadFrac * (bb.maxy - bb.miny);
				cm.deckTopY = bb.maxy;
			}

			const sea = C.SEA_LEVEL_Y;
			const dV = new Array(comps.length).fill(0);

			for (let i = 0; i < comps.length; i++) {
				const cm = comps[i];
				const surf = cm.volume > 0 ? cm.surfaceY : bounds(cm.worldVerts).miny;

				// (a0) Once the hull girder fails, watertight integrity is lost
				// throughout the wreck (buckled plating, sprung seams, open hatches):
				// every compartment free-floods to fill whatever part of it is below
				// the sea surface. Since the steel adds weight beyond the matching
				// buoyancy, this is a runaway that takes both pieces to the bottom.
				if (cm.open || state.severedInterfaces.size > 0) {
					const subVol = submergedBelow(cm.worldVerts, sea).area * C.BEAM;
					const target = Math.min(cm.maxVolume, subVol);
					if (target > cm.volume) dV[i] += (target - cm.volume) * Math.min(1, 4 * dt);
				}

				// (a) iceberg breach inflow via Torricelli
				if (cm.breachArea > 0) {
					const breachWorldY = cm.bb.miny + (cm.breachLocalY - cm.botLocalY);
					if (breachWorldY < sea) {
						const head = sea - Math.max(breachWorldY, surf);
						if (head > 0) {
							const q = C.DISCHARGE_CD * cm.breachArea * Math.sqrt(2 * C.G * head);
							dV[i] += q * dt;
						}
					}
				}

				// (b) downflooding over the deck once the deck edge submerges.
				// This is what fills a section ABOVE its waterline (no trapped air
				// in a torn hull) and lets the buoyant stern finally go under.
				if (cm.deckTopY < sea && cm.volume < cm.maxVolume * 0.999) {
					const head = sea - cm.deckTopY;
					const openLen = cm.st.len;
					const dfrac = state.severedInterfaces.size > 0 ? C.DOWNFLOOD_FRAC_POST : C.DOWNFLOOD_FRAC;
					const q = C.OVERFLOW_CD * (openLen * C.BEAM) * Math.sqrt(2 * C.G * head) * dfrac;
					dV[i] += q * dt;
				}

				// (c) over-bulkhead overflow into the adjacent (aft) compartment
				// (only while the bulkhead still connects them — not across a break)
				if (i + 1 < comps.length && !state.severedInterfaces.has(i)) {
					const nb = comps[i + 1];
					const bhTop = cm.bulkheadTopY;
					const hi = Math.max(surf, nb.volume > 0 ? nb.surfaceY : -Infinity);
					if (surf > bhTop && surf > (nb.volume > 0 ? nb.surfaceY : nb.bb.miny)) {
						const head = surf - Math.max(bhTop, nb.volume > 0 ? nb.surfaceY : bhTop);
						if (head > 0) {
							const q = C.OVERFLOW_CD * (cm.st.len * C.BEAM) * Math.sqrt(2 * C.G * head) * 0.03;
							const moved = q * dt;
							dV[i] -= moved;
							dV[i + 1] += moved;
						}
					}
					// symmetric: water can also slosh back if the aft one is higher
					const nbSurf = nb.volume > 0 ? nb.surfaceY : nb.bb.miny;
					if (nbSurf > nb.bulkheadTopY && nbSurf > surf) {
						const head = nbSurf - Math.max(nb.bulkheadTopY, surf);
						if (head > 0) {
							const q = C.OVERFLOW_CD * (nb.st.len * C.BEAM) * Math.sqrt(2 * C.G * head) * 0.03;
							const moved = q * dt;
							dV[i + 1] -= moved;
							dV[i] += moved;
						}
					}
				}
			}

			// apply volume changes, clamp to capacity
			let totalWater = 0;
			for (let i = 0; i < comps.length; i++) {
				comps[i].volume = Math.max(0, Math.min(comps[i].maxVolume, comps[i].volume + dV[i]));
				totalWater += comps[i].volume;
			}
			state.totals.waterMass = totalWater * C.RHO_WATER;
			state.totals.floodedFraction = totalWater / comps.reduce((s, c) => s + c.maxVolume, 0);
		}

		function updateCompartmentMass() {
			for (const cm of state.compartments) {
				const waterMass = cm.volume * C.RHO_WATER;
				const mass = cm.structMass + waterMass;
				// centre of mass: structure at body origin, water at its centroid
				let cx = 0, cy = 0;
				if (waterMass > 0) {
					// convert world water centroid to body-local frame
					const p = cm.body.getPosition(), a = cm.body.getAngle();
					const dx = cm.waterCx - p.x, dy = cm.waterCy - p.y;
					const c = Math.cos(-a), s = Math.sin(-a);
					const lx = dx * c - dy * s, ly = dx * s + dy * c;
					const w = waterMass / mass;
					cx = lx * w; cy = ly * w;
				}
				const I = cm.structMass * 50 + waterMass * (cm.st.len * cm.st.len + C.HULL_DEPTH * C.HULL_DEPTH) / 12;
				cm.body.setMassData({ mass: mass, center: new Vec2(cx, cy), I: Math.max(I, 1) });
			}
		}

		function applyForces() {
			// hull buoyancy from full submerged hull volume
			for (const p of state.parts) {
				if (p.kind === "hull") {
					const wv = worldVerts(p.body, p.local);
					const sub = submergedBelow(wv, C.SEA_LEVEL_Y);
					if (sub.area > 0) {
						const Fb = C.RHO_WATER * C.G * sub.area * C.BEAM;
						p.body.applyForce(new Vec2(0, Fb), new Vec2(sub.x, sub.y));
						dragOn(p.body, wv, sub);
					}
				} else if (p.kind === "funnel") {
					const wv = worldVerts(p.body, p.local);
					const sub = submergedBelow(wv, C.SEA_LEVEL_Y);
					if (sub.area > 0) {
						const Fb = C.RHO_WATER * C.G * sub.area * p.funnel.w; // funnel "beam" = its width
						p.body.applyForce(new Vec2(0, Fb), new Vec2(sub.x, sub.y));
						dragOn(p.body, wv, sub, p.funnel.w);
					}
				}
				// compartments: no buoyancy (their volume is the hull's); only weight (engine gravity)
			}
		}

		function dragOn(body, wv, sub, beam) {
			beam = beam || C.BEAM;
			const v = body.getLinearVelocityFromWorldPoint(new Vec2(sub.x, sub.y));
			const speed = Math.hypot(v.x, v.y);
			if (speed < 1e-3) return;
			const total = polyAreaCentroid(wv).area || 1;
			const subFrac = Math.min(1, sub.area / total);
			const bb = bounds(wv);
			const aRef = subFrac * beam * (Math.abs(v.x) / speed * (bb.maxy - bb.miny) + Math.abs(v.y) / speed * (bb.maxx - bb.minx));
			const fd = 0.5 * C.RHO_WATER * C.DRAG_CD * aRef * speed;
			body.applyForce(new Vec2(-fd * v.x, -fd * v.y), new Vec2(sub.x, sub.y));
		}

		function updateJointLoadsAndBreak(invDt) {
			const dt = 1 / invDt;
			let maxStressRate = 0;
			for (const jr of state.joints) {
				if (jr.broken) continue;
				const rf = jr.joint.getReactionForce(invDt); // N
				const rt = jr.joint.getReactionTorque(invDt); // N·m
				// equivalent load: linear reaction + bending moment over a lever arm
				const lever = jr.kind === "funnel" ? 6 : C.HULL_DEPTH * 0.5;
				const load = rf.length() + Math.abs(rt) / lever;
				jr.prevLoad = jr.load;
				jr.load = load;
				const rate = Math.abs(load - jr.prevLoad) * invDt; // N/s
				if (rate > maxStressRate) maxStressRate = rate;
				// Once the global hull girder has failed, the remaining pieces are
				// shorter, stiffer beams far less prone to fail — so the break
				// threshold rises after the first severance (keeps it to the iconic
				// two main sections plus a little debris, not total disintegration).
				const thr = jr.breakForce * (jr.kind !== "funnel" && state.severedInterfaces.size > 0 ? 3 : 1);
				jr._thr = thr;
				// Break only on SUSTAINED overload, never on a momentary spike. A
				// slowly-rising sagging stress (the surface break) accumulates and
				// fails; transient tumbling/impact spikes decay before they do. This
				// also lets stress redistribute after the first interface goes, so
				// the hull parts in two rather than shattering everywhere at once.
				if (load > thr) {
					jr.overload = (jr.overload || 0) + dt;
				} else {
					jr.overload = Math.max(0, (jr.overload || 0) - dt * 2);
				}
				const overloaded = jr.overload > C.JOINT_BREAK_TIME || load > thr * 4;
				if (!overloaded) continue;
				// after a girder break, hold off further girder breaks briefly so the
				// solver can shed load (a real hinge relieves the moment). Funnels are
				// independent and may always go.
				const isGirder = jr.kind !== "funnel";
				if (isGirder && state.time - (state.lastGirderBreak != null ? state.lastGirderBreak : -1e9) < C.BREAK_GRACE) continue;
				jr.broken = true;
				jr.breakTime = state.time;
				world.destroyJoint(jr.joint);
				if (jr.kind === "funnel") {
					state.events.push({ t: state.time, type: "funnel", msg: "Funnel torn from its mounting" });
				} else {
					state.lastGirderBreak = state.time;
				}
			}
			// detect hull girder severance (emergent): a station interface whose
			// top+bottom hull chords have both failed
			detectSeverance();
			state.maxStressRate = maxStressRate;
		}

		// Union-find connectivity over ALL surviving joints. The ship is only
		// "in pieces" when every weld (hull chords, bulkhead and comp-hull)
		// across an interface has failed — so the two halves are truly free.
		function detectSeverance() {
			const n = shipBodies.length;
			const parent = new Array(n);
			for (let i = 0; i < n; i++) parent[i] = i;
			function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
			function union(a, b) { parent[find(a)] = find(b); }
			for (const jr of state.joints) {
				if (jr.broken) continue;
				const ai = bodyIndex.get(jr.a), bi = bodyIndex.get(jr.b);
				if (ai != null && bi != null) union(ai, bi);
			}
			// count distinct components among the hull bodies
			const roots = new Set();
			for (const h of hullBodies) roots.add(find(bodyIndex.get(h)));
			state.pieceCount = roots.size;

			// find newly severed station interfaces (adjacent hull stations now
			// in different components) -> open the exposed ends to the sea.
			for (let i = 0; i < hullBodies.length - 1; i++) {
				if (state.severedInterfaces.has(i)) continue;
				if (find(bodyIndex.get(hullBodies[i])) !== find(bodyIndex.get(hullBodies[i + 1]))) {
					state.severedInterfaces.add(i);
					// the open cross-sections of both compartments now flood from the sea
					const cmA = state.compartments[i], cmB = state.compartments[i + 1];
					// these cross-sections are now torn fully open to the sea: they
					// free-flood (fill whatever is submerged), which sinks the piece.
					cmA.open = true; cmB.open = true;
					cmA.breachArea = Math.max(cmA.breachArea, C.OPEN_END_BREACH_AREA);
					cmA.breachLocalY = cmA.botLocalY + 0.5;
					cmB.breachArea = Math.max(cmB.breachArea, C.OPEN_END_BREACH_AREA);
					cmB.breachLocalY = cmB.botLocalY + 0.5;
					if (!state.brokenAt) {
						state.brokenAt = { stationIndex: i, x: stations[i].xr, time: state.time };
						state.events.push({ t: state.time, type: "break", msg: "HULL GIRDER FAILS — ship breaks in two between " + stations[i].meta.name + " and " + stations[i + 1].meta.name });
					}
				}
			}
		}

		// ---- activity metric -> time multiplier (inverse, low-pass) ----
		function maxBodySpeed() {
			let m = 0;
			for (const p of state.parts) {
				const v = p.body.getLinearVelocity();
				const s = Math.hypot(v.x, v.y);
				if (s > m) m = s;
			}
			return m;
		}

		// max body acceleration (rate of change of velocity) this step
		function maxBodyAccel(dt) {
			let m = 0;
			for (const p of state.parts) {
				const v = p.body.getLinearVelocity();
				if (p._pv) {
					const a = Math.hypot((v.x - p._pv.x) / dt, (v.y - p._pv.y) / dt);
					if (a > m) m = a;
				}
				p._pv = { x: v.x, y: v.y };
			}
			return m;
		}

		function step(dt) {
			dt = dt || C.DT;
			const invDt = 1 / dt;
			updateFlooding(dt);
			updateCompartmentMass();
			applyForces();
			world.step(dt, C.VEL_ITERS, C.POS_ITERS);
			updateJointLoadsAndBreak(invDt);
			state.time += dt;
			// activity metric (rate of change): blend max body acceleration with
			// the normalised joint stress rate. Track the running max between
			// multiplier updates so spikes during fast-forward are never missed.
			const accel = maxBodyAccel(dt);
			const stressTerm = (state.maxStressRate || 0) / C.STRESS_RATE_REF; // -> m/s^2 equivalent
			const instant = Math.max(accel, stressTerm);
			state.frameMetricMax = Math.max(state.frameMetricMax || 0, instant);
			state.metric = instant;
			state.maxSpeed = maxBodySpeed();
			state.maxAccel = accel;
		}

		// Compute the auto time multiplier from the current metric (inverse,
		// low-passed, clamped). Called once per rendered frame, not per substep.
		function updateTimeMultiplier() {
			// use the peak activity since the last call (covers all substeps run
			// this frame), then reset the accumulator
			const m = Math.max(state.frameMetricMax || 0, state.metric || 0);
			state.frameMetricMax = 0;
			const target = Math.max(C.MULT_MIN, Math.min(C.MULT_MAX, C.MULT_CALIB / Math.max(m, 1e-3)));
			state.timeMul += (target - state.timeMul) * C.MULT_SMOOTH;
			return state.timeMul;
		}

		// Has the wreck come to rest near the seafloor?
		function isSettled() {
			let maxSpeed = 0, lowest = Infinity, nAfloat = 0;
			for (const p of state.parts) {
				const v = p.body.getLinearVelocity();
				maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y));
				const y = p.body.getPosition().y;
				lowest = Math.min(lowest, y);
				if (y > -150) nAfloat++; // still near the surface
			}
			const nearFloor = lowest < state.seafloor.y + 90;
			// settled when a section is on the floor, the wreck is quiescent, and
			// essentially nothing remains at the surface (tolerate 1 small fragment)
			return nearFloor && maxSpeed < 0.6 && nAfloat <= 1;
		}

		return {
			CONFIG: C,
			COMPARTMENTS: COMPARTMENTS,
			state: state,
			stations: stations,
			step: step,
			updateTimeMultiplier: updateTimeMultiplier,
			isSettled: isSettled,
			worldVerts: worldVerts,
			submergedBelow: submergedBelow,
			bounds: bounds,
		};
	}

	return {
		CONFIG: CONFIG,
		COMPARTMENTS: COMPARTMENTS,
		createSimulation: createSimulation,
		// expose geometry helpers for the renderer
		polyAreaCentroid: polyAreaCentroid,
		submergedBelow: submergedBelow,
		clipBelow: clipBelow,
		solveSurfaceY: solveSurfaceY,
		worldVerts: worldVerts,
	};
});
