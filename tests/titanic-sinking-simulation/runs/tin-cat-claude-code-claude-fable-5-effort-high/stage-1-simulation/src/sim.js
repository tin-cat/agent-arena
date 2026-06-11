// Physics core of the Titanic sinking simulation.
//
// The ship is a chain of rigid bodies in Planck.js (Box2D): 16 outer shell
// segments plus 16 inner compartment bodies, all tied together with weld
// joints that carry finite load before failing. Buoyancy, water drag,
// compartment flooding (Torricelli flow) and floodwater mass redistribution
// are applied as forces and mass updates on top of the engine. Nothing in
// here is keyed on simulation time: the break, the funnel falls and the
// plunge all emerge from the load and flooding state.

import * as pl from '../lib/planck.mjs';
import { P } from './params.js';
import {
	polyArea, polyCentroid, polySecondMoment, clipBelowY,
	projectedWidth, shrinkPoly,
} from './geom.js';

const L = P.LENGTH;

// ---- Hull outline in ship frame (x: 0 at bow .. L at stern, y above keel) ----

function keelY(x) {
	if (x < 8) { const t = (8 - x) / 8; return 3.5 * t * t; }              // forefoot
	if (x > 240) { const t = (x - 240) / (L - 240); return 7.5 * t * t; }  // counter stern
	return 0;
}

function deckY(x) {
	const t = (x - L / 2) / (L / 2);
	let y = P.DECK_C + P.SHEER_EXTRA * t * t * t * t;                      // sheer line
	// raised forecastle and poop: the enclosed bow and stern decks stood a
	// full deck level higher, a key reserve of buoyancy at the hull ends
	const fc = Math.min(Math.max((P.FOCSLE_END + 7 - x) / 7, 0), 1);
	const pp = Math.min(Math.max((x - P.POOP_START + 8) / 8, 0), 1);
	return y + P.FOCSLE_RAISE * fc + P.POOP_RAISE * pp;
}

function envelopePoly(x0, x1) {
	// Watertight envelope of one compartment slice, ship frame, CCW.
	const pts = [];
	const curved = x0 < 10 || x1 > 238;
	const n = curved ? 3 : 1;
	for (let k = 0; k <= n; k++) {
		const x = x0 + (x1 - x0) * k / n;
		pts.push({ x, y: keelY(x) });
	}
	pts.push({ x: x1, y: deckY(x1) });
	pts.push({ x: x0, y: deckY(x0) });
	return pts;
}

function shipToWorld(p) { return { x: p.x - L / 2, y: p.y - P.DRAUGHT }; }

// ---- Helpers ----

function transformPoly(body, local, out) {
	const xf = body.getTransform();
	const c = xf.q.c, s = xf.q.s, px = xf.p.x, py = xf.p.y;
	for (let i = 0; i < local.length; i++) {
		out[i].x = px + c * local[i].x - s * local[i].y;
		out[i].y = py + s * local[i].x + c * local[i].y;
	}
	return out;
}

function topWidth(clipped, Y) {
	// Total length of the cut edges produced by clipBelowY at level Y.
	let w = 0;
	for (let i = 0, n = clipped.length; i < n; i++) {
		const p = clipped[i], q = clipped[(i + 1) % n];
		if (Math.abs(p.y - Y) < 1e-6 && Math.abs(q.y - Y) < 1e-6) w += Math.abs(q.x - p.x);
	}
	return w;
}

// Find the horizontal plane Y such that the area of worldPoly below Y equals
// target. Newton iteration with bisection bracket fallback.
function solveLevel(worldPoly, target, Yguess) {
	let lo = Infinity, hi = -Infinity;
	for (const p of worldPoly) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }
	const total = Math.abs(polyArea(worldPoly));
	if (target <= 1e-6) return lo;
	if (target >= total - 1e-6) return hi;
	let Y = Math.min(Math.max(Yguess, lo + 1e-4), hi - 1e-4);
	for (let it = 0; it < 12; it++) {
		const cut = clipBelowY(worldPoly, Y);
		const A = cut.length ? Math.abs(polyArea(cut)) : 0;
		const err = A - target;
		if (Math.abs(err) < Math.max(0.02 * target, 0.05)) return Y;
		if (err > 0) hi = Math.min(hi, Y); else lo = Math.max(lo, Y);
		const w = cut.length ? topWidth(cut, Y) : 0;
		if (w > 0.1) {
			Y -= err / w;
			if (Y <= lo || Y >= hi) Y = (lo + hi) / 2;
		} else {
			Y = (lo + hi) / 2;
		}
	}
	return Y;
}

// Variant of solveLevel for compartments whose plan area shrinks above the
// deckhead (only hatch trunks and the E deck corridor continue upward).
// Solves g(Y) = target where g discounts area above ceilY by trunkFrac.
function solveLevelTrunk(worldPoly, target, ceilY, trunkFrac, Yguess) {
	let lo = Infinity, hi = -Infinity;
	for (const p of worldPoly) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }
	const total = Math.abs(polyArea(worldPoly));
	const cCut = ceilY <= lo ? [] : clipBelowY(worldPoly, Math.min(ceilY, hi));
	const Aceil = ceilY >= hi ? total : (cCut.length ? Math.abs(polyArea(cCut)) : 0);
	const gMax = Aceil + trunkFrac * (total - Aceil);
	if (target <= 1e-6) return lo;
	if (target >= gMax - 1e-6) return hi;
	let Y = Math.min(Math.max(Yguess, lo + 1e-4), hi - 1e-4);
	for (let it = 0; it < 14; it++) {
		const cut = clipBelowY(worldPoly, Y);
		const A = cut.length ? Math.abs(polyArea(cut)) : 0;
		const gv = Y <= ceilY ? A : Aceil + trunkFrac * (A - Aceil);
		const err = gv - target;
		if (Math.abs(err) < Math.max(0.02 * target, 0.05)) return Y;
		if (err > 0) hi = Math.min(hi, Y); else lo = Math.max(lo, Y);
		const w = (cut.length ? topWidth(cut, Y) : 0) * (Y > ceilY ? trunkFrac : 1);
		if (w > 0.05) {
			Y -= err / w;
			if (Y <= lo || Y >= hi) Y = (lo + hi) / 2;
		} else {
			Y = (lo + hi) / 2;
		}
	}
	return Y;
}

function vlen(v) { return Math.hypot(v.x, v.y); }

export function createSim(opts = {}) {
	const rho = P.RHO_SEA, g = P.GRAVITY, DT = P.DT;
	const FLOOD_EVERY = 2;

	const world = new pl.World({ gravity: new pl.Vec2(0, -g) });

	// ---- Seafloor (static body) ----
	const FLOOR_Y = -P.SEAFLOOR_DEPTH;
	const floor = world.createBody({ type: 'static', position: new pl.Vec2(0, 0) });
	floor.createFixture(new pl.Box(4000, 40, new pl.Vec2(0, FLOOR_Y - 40), 0), {
		density: 0, friction: 0.8, restitution: 0,
	});

	// ---- Pre-compute geometry, hydrostatics and the effective breadth ----
	// bEff collapses the third dimension: it is chosen so that the 2D side
	// profile submerged to the real load draught displaces exactly the real
	// displacement. This is the 2D equivalent of the block coefficient.
	const envShip = P.COMPARTMENTS.map(c => envelopePoly(c.x0, c.x1));
	let Asub0 = 0, AsubMx = 0;
	for (let i = 0; i < envShip.length; i++) {
		const cut = clipBelowY(envShip[i], P.DRAUGHT);
		if (cut.length) {
			const a = Math.abs(polyArea(cut)) * P.COMPARTMENTS[i].widthB;
			Asub0 += a;
			AsubMx += a * polyCentroid(cut).x;
		}
	}
	const M_TOTAL = P.DISPLACEMENT;
	const bEff = M_TOTAL / (rho * Asub0);
	const LCB = AsubMx / Asub0;

	// Structure masses per compartment (everything that is not floodwater).
	const nC = P.COMPARTMENTS.length;
	const structMass = [], structX = [], structY = [], shellMass = [];
	const ssLen = P.SUPERSTRUCTURE_X1 - P.SUPERSTRUCTURE_X0;
	for (let i = 0; i < nC; i++) {
		const c = P.COMPARTMENTS[i];
		const total = P.COMP_MASS_T[i] * 1e3;
		const shell = total * P.SHELL_MASS_FRACTION;
		const ovl = Math.max(0, Math.min(c.x1, P.SUPERSTRUCTURE_X1) - Math.max(c.x0, P.SUPERSTRUCTURE_X0));
		const ss = P.SUPERSTRUCTURE_MASS_T * 1e3 * (ovl / ssLen);
		const inner = total - shell + ss;
		const xm = (c.x0 + c.x1) / 2;
		structMass.push(inner);
		structX.push(xm);
		structY.push(((total - shell) * c.machY + ss * P.SUPERSTRUCTURE_Y) / inner);
		shellMass.push(shell);
	}

	// Cargo, coal and stores were stowed so the hull floated level without
	// extreme still-water bending. Blend each slice's mass toward the local
	// buoyancy share (total preserved), then trim with a small fore/aft
	// shift so the center of gravity sits over the center of buoyancy.
	{
		const funnelOn = P.COMPARTMENTS.map(() => 0);
		for (const f of P.FUNNELS) funnelOn[f.comp] += P.FUNNEL_MASS;
		const target = [];
		let sumStruct = 0, sumTarget = 0;
		for (let i = 0; i < nC; i++) {
			const cut = clipBelowY(envShip[i], P.DRAUGHT);
			const B = cut.length ?
				Math.abs(polyArea(cut)) * P.COMPARTMENTS[i].widthB * bEff * rho : 0;
			target.push(Math.max(B - shellMass[i] - funnelOn[i], 0.3 * structMass[i]));
			sumStruct += structMass[i];
			sumTarget += target[i];
		}
		for (let i = 0; i < nC; i++) {
			structMass[i] = (1 - P.MASS_SMOOTHING) * structMass[i] +
				P.MASS_SMOOTHING * target[i] * (sumStruct / sumTarget);
		}
		// residual trim: distribute over the hold compartments, never letting
		// any compartment drop below a small positive floor
		for (let pass = 0; pass < 4; pass++) {
			let Mx = 0, M = 0;
			for (let i = 0; i < nC; i++) {
				Mx += (structMass[i] + shellMass[i]) * structX[i];
				M += structMass[i] + shellMass[i];
			}
			for (const f of P.FUNNELS) { Mx += P.FUNNEL_MASS * f.x; M += P.FUNNEL_MASS; }
			const lcg = Mx / M;
			const fore = [1, 2, 3], aft = [12, 13, 14];
			const xF = fore.reduce((s, i) => s + structX[i], 0) / fore.length;
			const xA = aft.reduce((s, i) => s + structX[i], 0) / aft.length;
			let dm = M * (LCB - lcg) / (xF - xA);
			for (const [group, sign] of [[fore, 1], [aft, -1]]) {
				for (const i of group) {
					const want = sign * dm / group.length;
					structMass[i] = Math.max(structMass[i] + want, 200e3);
				}
			}
		}
		// exact total: the displacement must match so the ship floats at the
		// real load draught
		let sum = 0;
		for (let i = 0; i < nC; i++) sum += structMass[i];
		const targetSum = M_TOTAL - shellMass.reduce((a, b) => a + b, 0) -
			P.FUNNELS.length * P.FUNNEL_MASS;
		for (let i = 0; i < nC; i++) structMass[i] *= targetSum / sum;
	}

	// ---- Create bodies ----
	const SHIP_CAT = 0x0002;
	const comps = [], shells = [], funnels = [];
	const allBodies = [];

	function makeBody(pos, fixPolyLocal, friction) {
		const body = world.createBody({
			type: 'dynamic',
			position: new pl.Vec2(pos.x, pos.y),
			allowSleep: false,
			linearDamping: 0.002,
			angularDamping: 0.02,
		});
		body.createFixture(new pl.Polygon(fixPolyLocal.map(p => new pl.Vec2(p.x, p.y))), {
			density: 1, friction: friction, restitution: 0,
			filterCategoryBits: SHIP_CAT, filterMaskBits: 0xFFFF,
		});
		return body;
	}

	function setMass(body, mass, cLocal, Icm) {
		body.setMassData({
			mass,
			center: new pl.Vec2(cLocal.x, cLocal.y),
			I: Icm + mass * (cLocal.x * cLocal.x + cLocal.y * cLocal.y),
		});
	}

	for (let i = 0; i < nC; i++) {
		const c = P.COMPARTMENTS[i];
		const env = envShip[i];
		const centW = shipToWorld(polyCentroid(env));
		const envLocal = env.map(p => {
			const w = shipToWorld(p);
			return { x: w.x - centW.x, y: w.y - centW.y };
		});
		const body = makeBody(centW, shrinkPoly(envLocal, 0.97), 0.4);

		// superstructure block (collision and looks, mass already in struct)
		let ssLocal = null;
		if (c.x0 >= P.SUPERSTRUCTURE_X0 - 1 && c.x1 <= P.SUPERSTRUCTURE_X1 + 1) {
			const sx0 = c.x0 + (c.x1 - c.x0) * 0.06 - L / 2 - centW.x;
			const sx1 = c.x1 - (c.x1 - c.x0) * 0.06 - L / 2 - centW.x;
			const sy0 = P.DECK_C + 0.2 - P.DRAUGHT - centW.y;
			const sy1 = P.BOAT_DECK - P.DRAUGHT - centW.y;
			body.createFixture(new pl.Polygon([
				new pl.Vec2(sx0, sy0), new pl.Vec2(sx1, sy0),
				new pl.Vec2(sx1, sy1), new pl.Vec2(sx0, sy1),
			]), {
				density: 0.01, friction: 0.4, restitution: 0,
				filterCategoryBits: SHIP_CAT, filterMaskBits: 0xFFFF,
			});
			ssLocal = { x0: sx0, x1: sx1, y0: sy0, y1: sy1 };
		}

		const envA = Math.abs(polyArea(envLocal));
		const { J } = polySecondMoment(envLocal);
		const cLocal = {
			x: structX[i] - L / 2 - centW.x,
			y: structY[i] - P.DRAUGHT - centW.y,
		};
		const Icm = structMass[i] * (J / envA) * 0.5;
		setMass(body, structMass[i], cLocal, Icm);

		// Flood throttle level: the upper decks of each compartment (F and E
		// deck flats, then the 'tween decks) are pierced only by hatch trunks
		// and stair wells, so the free-surface plan area collapses well below
		// the bulkhead deck top. Slow flooding above this level is throttled
		// to the trunk fraction.
		const bkL = i > 0 ? P.BULKHEAD_TOP[i - 1] : 16.4;
		const bkR = i < nC - 1 ? P.BULKHEAD_TOP[i] : 16.4;
		const ceilShip = Math.max(bkL, bkR) - 1.5;
		comps.push({
			i, name: c.name, body,
			envLocal,
			envWorld: envLocal.map(p => ({ x: 0, y: 0 })),
			breadthB: bEff * c.widthB,
			breadthF: bEff * c.widthF,
			cap: envA * bEff * c.widthF * c.perm,
			ceilLocal: {
				x: (c.x0 + c.x1) / 2 - L / 2 - centW.x,
				y: ceilShip - P.DRAUGHT - centW.y,
			},
			perm: c.perm,
			envArea: envA,
			vol: 0,
			levelY: -1e9,
			waterPoly: null,
			structMass: structMass[i],
			structC: cLocal,
			structI: Icm,
			hasSS: c.x0 >= P.SUPERSTRUCTURE_X0 - 1 && c.x1 <= P.SUPERSTRUCTURE_X1 + 1,
			tornOpen: false,
			tornArea: 0,
			tornYLocal: 0,
			inflow: 0,
			charR: Math.sqrt(J / envA),
			x0: c.x0, x1: c.x1,
			ssLocal,
			shipXOff: centW.x + L / 2,
			shipYOff: centW.y + P.DRAUGHT,
		});
		allBodies.push(body);
	}

	// Outer shell segments: the bottom/side plating strip of each slice.
	for (let i = 0; i < nC; i++) {
		const c = P.COMPARTMENTS[i];
		const x0 = c.x0 + 0.06, x1 = c.x1 - 0.06;
		const quad = [
			{ x: x0, y: keelY(x0) }, { x: x1, y: keelY(x1) },
			{ x: x1, y: keelY(x1) + 1.3 }, { x: x0, y: keelY(x0) + 1.3 },
		];
		const centW = shipToWorld(polyCentroid(quad));
		const local = quad.map(p => {
			const w = shipToWorld(p);
			return { x: w.x - centW.x, y: w.y - centW.y };
		});
		const body = makeBody(centW, local, 0.5);
		const { J, area } = polySecondMoment(local);
		setMass(body, shellMass[i], polyCentroid(local), shellMass[i] * (Math.abs(J / area)));
		shells.push({
			i, body, local,
			world: local.map(() => ({ x: 0, y: 0 })),
			mass: shellMass[i],
			charR: Math.sqrt(Math.abs(J / area)),
		});
		allBodies.push(body);
	}

	// Funnels
	for (let fi = 0; fi < P.FUNNELS.length; fi++) {
		const f = P.FUNNELS[fi];
		const w2 = P.FUNNEL_W / 2, h2 = P.FUNNEL_H / 2;
		const baseY = P.BOAT_DECK - 1.5;
		const centW = shipToWorld({ x: f.x, y: baseY + h2 });
		const local = [
			{ x: -w2, y: -h2 }, { x: w2, y: -h2 }, { x: w2, y: h2 }, { x: -w2, y: h2 },
		];
		const body = makeBody(centW, local, 0.3);
		setMass(body, P.FUNNEL_MASS, { x: 0, y: 0 },
			P.FUNNEL_MASS * (P.FUNNEL_W ** 2 + P.FUNNEL_H ** 2) / 12);
		funnels.push({
			fi, body, comp: f.comp, x: f.x, local,
			world: local.map(() => ({ x: 0, y: 0 })),
			attached: true, tSub: 0,
			charR: Math.sqrt((P.FUNNEL_W ** 2 + P.FUNNEL_H ** 2) / 12),
		});
		allBodies.push(body);
	}

	// ---- Breakable weld joints ----
	const joints = [];

	const strengthScale = opts.strengthScale || 1;

	function weld(bodyA, bodyB, anchorShip, type, fmax, tmax, label, ix) {
		const aw = shipToWorld(anchorShip);
		const j = world.createJoint(new pl.WeldJoint(
			{ frequencyHz: 0, dampingRatio: 0, collideConnected: false },
			bodyA, bodyB, new pl.Vec2(aw.x, aw.y)));
		joints.push({
			j, type, broken: false, label, ix, x: anchorShip.x, u: 0,
			fmax: fmax * strengthScale, tmax: tmax * strengthScale,
			emaF: 0, emaT: 0,
		});
	}

	for (let k = 0; k < nC - 1; k++) {
		const xbk = P.COMPARTMENTS[k].x1;
		const sp = P.STRENGTH_PROFILE[k];
		// outer shell seam, low in the hull
		weld(shells[k].body, shells[k + 1].body,
			{ x: xbk, y: keelY(xbk) + 0.6 },
			'shell', P.SHELL_JOINT_FMAX * sp, P.SHELL_JOINT_TMAX * sp,
			`Shell seam ${Math.round(xbk)} m`, k);
		// inner structure seam, up at the bulkhead top
		weld(comps[k].body, comps[k + 1].body,
			{ x: xbk, y: Math.min(P.BULKHEAD_TOP[k], deckY(xbk) - 1.5) },
			'inner', P.INNER_JOINT_FMAX * sp, P.INNER_JOINT_TMAX * sp,
			`Internal structure ${Math.round(xbk)} m`, k);
	}
	for (let i = 0; i < nC; i++) {
		const xm = (P.COMPARTMENTS[i].x0 + P.COMPARTMENTS[i].x1) / 2;
		weld(comps[i].body, shells[i].body,
			{ x: xm, y: keelY(xm) + 0.7 },
			'mount', P.COMP_SHELL_FMAX, P.COMP_SHELL_TMAX,
			`Compartment mounting ${comps[i].name}`, i);
	}
	for (const f of funnels) {
		weld(f.body, comps[f.comp].body,
			{ x: f.x, y: P.BOAT_DECK - 1.5 },
			'funnel', P.FUNNEL_FMAX, P.FUNNEL_TMAX,
			`Funnel ${f.fi + 1} stays`, f.fi);
	}

	// ---- Openings ----
	// Iceberg damage: initial condition, holes already in the shell.
	const damage = P.DAMAGE.map(d => {
		const c = comps[d.comp];
		const xm = (c.x0 + c.x1) / 2;
		const w = shipToWorld({ x: xm, y: d.y });
		const b = c.body.getPosition();
		return { comp: d.comp, area: d.area, lx: w.x - b.x, ly: w.y - b.y };
	});
	const deckOpen = P.DECK_OPENINGS.map(d => {
		const c = comps[d.comp];
		const xm = (c.x0 + c.x1) / 2;
		const w = shipToWorld({ x: xm, y: Math.min(d.y, deckY(xm) + 8.5) });
		const b = c.body.getPosition();
		return { comp: d.comp, area: d.area, lx: w.x - b.x, ly: w.y - b.y };
	});

	// Interfaces between adjacent compartments: bulkhead weir while intact,
	// torn open to the sea when the structure separates.
	const interfaces = [];
	for (let k = 0; k < nC - 1; k++) {
		const xbk = P.COMPARTMENTS[k].x1;
		const yMid = (keelY(xbk) + P.BULKHEAD_TOP[k]) / 2;
		const w = shipToWorld({ x: xbk, y: yMid });
		const bi = comps[k].body.getPosition(), bj = comps[k + 1].body.getPosition();
		const wt = shipToWorld({ x: xbk, y: P.BULKHEAD_TOP[k] });
		interfaces.push({
			k,
			bkTopLA: { x: wt.x - bi.x, y: wt.y - bi.y },
			midLA: { x: w.x - bi.x, y: w.y - bi.y },
			midLB: { x: w.x - bj.x, y: w.y - bj.y },
			sectionH: deckY(xbk) - keelY(xbk),
			torn: false,
			overflowed: false,
		});
	}

	// ---- State ----
	const state = {
		time: 0,
		wallTime: 0,
		multiplier: P.SPEED_MAX,
		metric: 0,
		waterTons: 0,
		floodRate: 0,
		trimDeg: 0,
		bowDepth: 0,
		powered: true,
		hullBroken: false,
		breakX: null,
		breakTime: null,
		finished: false,
		maxU: 0,
		maxULabel: '',
		settleTimer: 0,
		anyLanded: false,
	};
	const events = [];
	let speedMode = opts.fixedMultiplier ? 'fixed' : 'auto';
	let fixedMult = opts.fixedMultiplier || P.SPEED_MAX;
	let metricFilt = 0;
	let stepCount = 0;
	let stepCarry = 0;
	const activeFlows = [];

	function clock(t) {
		const total = (23 * 3600 + 40 * 60 + t) % 86400;
		const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = Math.floor(total) % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	function logEvent(text, pos, kind) {
		events.push({
			t: state.time, clock: clock(state.time), text,
			x: pos ? pos.x : null, y: pos ? pos.y : null, kind: kind || 'info',
		});
	}
	logEvent('Iceberg struck. Forward compartments are open to the sea.');

	// ---- Piece bookkeeping (connected components over intact joints) ----
	function computePieces() {
		const idx = new Map();
		allBodies.forEach((b, i) => idx.set(b, i));
		const parent = allBodies.map((_, i) => i);
		const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
		for (const rec of joints) {
			if (rec.broken) continue;
			const a = find(idx.get(rec.j.getBodyA())), b = find(idx.get(rec.j.getBodyB()));
			if (a !== b) parent[a] = b;
		}
		const groups = new Map();
		allBodies.forEach((b, i) => {
			const r = find(i);
			if (!groups.has(r)) groups.set(r, []);
			groups.get(r).push(b);
		});
		return [...groups.values()];
	}

	function pieceName(bodies) {
		if (bodies.includes(comps[0].body) && bodies.includes(comps[nC - 1].body)) return 'The ship';
		if (bodies.includes(comps[0].body)) return 'The bow section';
		if (bodies.includes(comps[nC - 1].body)) return 'The stern section';
		for (const f of funnels) if (bodies.includes(f.body)) return `Funnel ${f.fi + 1}`;
		return 'Wreckage';
	}

	const landedBodies = new Set();
	const pendingContacts = [];
	world.on('begin-contact', contact => {
		const fa = contact.getFixtureA(), fb = contact.getFixtureB();
		const a = fa.getBody(), b = fb.getBody();
		if (a === floor || b === floor) {
			const other = a === floor ? b : a;
			pendingContacts.push({ body: other, speed: vlen(other.getLinearVelocity()) });
		}
	});

	function processContacts() {
		if (!pendingContacts.length) return;
		const pieces = computePieces();
		for (const pc of pendingContacts) {
			if (landedBodies.has(pc.body)) continue;
			const piece = pieces.find(p => p.includes(pc.body)) || [pc.body];
			const already = piece.some(b => landedBodies.has(b));
			piece.forEach(b => landedBodies.add(b));
			if (!already) {
				const bp = pc.body.getPosition();
				logEvent(`${pieceName(piece)} strikes the seafloor at ${pc.speed.toFixed(1)} m/s.`,
					{ x: bp.x, y: bp.y }, 'impact');
				state.anyLanded = true;
			}
		}
		pendingContacts.length = 0;
	}

	// ---- Hydrodynamics: buoyancy and drag from clipped polygons ----
	function applyHydro(body, worldPoly, breadth, buoyFrac, charLen) {
		const sub = clipBelowY(worldPoly, 0);
		if (!sub.length) return 0;
		const A = Math.abs(polyArea(sub));
		if (A < 1e-6) return 0;
		const c = polyCentroid(sub);
		if (buoyFrac > 0) {
			body.applyForce(new pl.Vec2(0, rho * g * A * breadth * buoyFrac),
				new pl.Vec2(c.x, c.y), true);
		}
		// quadratic pressure drag, reference area = projected width x breadth
		const v = body.getLinearVelocityFromWorldPoint(new pl.Vec2(c.x, c.y));
		const sp = vlen(v);
		if (sp > 1e-3) {
			const w = projectedWidth(sub, v.x / sp, v.y / sp);
			const Fd = 0.5 * rho * P.WATER_CD * w * breadth * sp * sp;
			body.applyForce(new pl.Vec2(-Fd * v.x / sp, -Fd * v.y / sp),
				new pl.Vec2(c.x, c.y), true);
		}
		// rotational damping about the body's own axis
		const om = body.getAngularVelocity();
		if (Math.abs(om) > 1e-4 && charLen > 0) {
			const r4 = (charLen / 2) ** 4;
			body.applyTorque(-0.5 * rho * P.ANGULAR_CD * breadth * r4 * om * Math.abs(om) *
				Math.min(1, A / Math.abs(polyArea(worldPoly))), true);
		}
		return A;
	}

	// ---- Flooding ----
	function orificeFlow(area, cd, yOpening, yExt, yInt) {
		// Two-reservoir orifice: yExt is the outside free surface (the sea,
		// y = 0, but only above the opening counts), yInt the inside level.
		const hExt = Math.max(yExt - yOpening, 0);
		const hInt = Math.max(yInt - yOpening, 0);
		const dh = hExt - hInt;
		if (dh === 0) return 0;
		return Math.sign(dh) * cd * area * Math.sqrt(2 * g * Math.abs(dh));
	}

	function updateFlooding(dtF) {
		activeFlows.length = 0;
		let totalIn = 0;

		// tear detection: structural separation opens compartments to the sea
		for (const itf of interfaces) {
			if (itf.torn) continue;
			const bi = comps[itf.k].body, bj = comps[itf.k + 1].body;
			const xfA = bi.getTransform(), xfB = bj.getTransform();
			const ax = xfA.p.x + xfA.q.c * itf.midLA.x - xfA.q.s * itf.midLA.y;
			const ay = xfA.p.y + xfA.q.s * itf.midLA.x + xfA.q.c * itf.midLA.y;
			const bx = xfB.p.x + xfB.q.c * itf.midLB.x - xfB.q.s * itf.midLB.y;
			const by = xfB.p.y + xfB.q.s * itf.midLB.x + xfB.q.c * itf.midLB.y;
			const gap = Math.hypot(bx - ax, by - ay);
			if (gap > 0.6) {
				itf.torn = true;
				for (const ci of [itf.k, itf.k + 1]) {
					const cc = comps[ci];
					cc.tornOpen = true;
					cc.tornArea = Math.max(cc.tornArea, 0.15 * itf.sectionH * cc.breadthF);
					cc.tornYLocal = ci === itf.k ? itf.midLA.y : itf.midLB.y;
				}
			}
		}

		for (const cc of comps) {
			cc.inflow = 0;
			const space = cc.cap - cc.vol;
			const intY = cc.vol > 1e-3 ? cc.levelY : -1e9;
			const xfc = cc.body.getTransform();
			cc.ceilWorldY = xfc.p.y + xfc.q.s * cc.ceilLocal.x + xfc.q.c * cc.ceilLocal.y;

			const flowsIn = [];
			for (const d of damage) if (d.comp === cc.i) flowsIn.push(d);
			for (const d of deckOpen) if (d.comp === cc.i) flowsIn.push(d);
			const xf = cc.body.getTransform();
			for (const d of flowsIn) {
				const ox = xf.p.x + xf.q.c * d.lx - xf.q.s * d.ly;
				const oy = xf.p.y + xf.q.s * d.lx + xf.q.c * d.ly;
				const q = orificeFlow(d.area, P.ORIFICE_CD, oy, 0, intY);
				if (q !== 0) {
					let dv = q * dtF;
					dv = Math.min(dv, space * 0.25, Math.max(space, 0));
					dv = Math.max(dv, -cc.vol);
					cc.vol += dv;
					cc.inflow += dv / dtF;
					if (dv > 0) { totalIn += dv; activeFlows.push({ x: ox, y: oy, q: dv / dtF }); }
				}
			}
			if (cc.tornOpen && cc.tornArea > 0) {
				const oy = xf.p.y + xf.q.s * 0 + xf.q.c * cc.tornYLocal;
				const q = orificeFlow(cc.tornArea, P.ORIFICE_CD, oy, 0, intY);
				if (q > 0) {
					let dv = Math.min(q * dtF, (cc.cap - cc.vol) * 0.25);
					if (dv > 0) {
						cc.vol += dv;
						cc.inflow += dv / dtF;
						totalIn += dv;
						activeFlows.push({ x: xf.p.x, y: oy, q: dv / dtF });
					}
				}
			}
		}

		// pumps: the engineers kept the bilge and ballast pumps going as long
		// as there was steam, discharging overboard
		if (state.powered) {
			let totV = 0;
			for (const cc of comps) totV += cc.vol;
			if (totV > 1) {
				const pump = P.PUMP_RATE * dtF;
				for (const cc of comps) {
					const dv = Math.min(pump * cc.vol / totV, cc.vol);
					cc.vol -= dv;
				}
			}
		}

		// overflow across bulkhead tops between still-joined compartments
		for (const itf of interfaces) {
			if (itf.torn) continue;
			const a = comps[itf.k], b = comps[itf.k + 1];
			const xf = a.body.getTransform();
			const bkY = xf.p.y + xf.q.s * itf.bkTopLA.x + xf.q.c * itf.bkTopLA.y;
			const Ya = a.vol > 1e-3 ? a.levelY : -1e9;
			const Yb = b.vol > 1e-3 ? b.levelY : -1e9;
			let from = null, to = null, Yhi = 0, Ylo = 0;
			if (Ya > bkY && Ya > Yb) { from = a; to = b; Yhi = Ya; Ylo = Yb; }
			else if (Yb > bkY && Yb > Ya) { from = b; to = a; Yhi = Yb; Ylo = Ya; }
			if (from && to.cap - to.vol > 1e-3) {
				const head = Yhi - Math.max(Ylo, bkY);
				const aFlow = Math.min(Yhi - bkY, P.WEIR_DEPTH_MAX) * P.WEIR_WIDTH;
				const q = P.WEIR_CD * aFlow * Math.sqrt(2 * g * head);
				const dv = Math.min(q * dtF, from.vol, (to.cap - to.vol) * 0.25);
				if (dv > 0) {
					from.vol -= dv;
					to.vol += dv;
					if (!itf.overflowed) {
						itf.overflowed = true;
						logEvent(`Water overtops the bulkhead between ${a.name} and ${b.name}.`);
					}
				}
			}
		}

		// re-solve internal water surfaces and update body mass data
		let tons = 0;
		for (const cc of comps) {
			tons += cc.vol * rho;
			transformPoly(cc.body, cc.envLocal, cc.envWorld);
			if (cc.vol < 1e-3) {
				cc.waterPoly = null;
				if (cc.lastApplied) {
					setMass(cc.body, cc.structMass, cc.structC, cc.structI);
					cc.lastApplied = 0;
				}
				continue;
			}
			const targetA = cc.vol / (cc.breadthF * cc.perm);
			cc.levelY = solveLevelTrunk(cc.envWorld, targetA, cc.ceilWorldY ?? 1e9,
				P.TRUNK_FRAC, cc.levelY);
			const wp = clipBelowY(cc.envWorld, cc.levelY);
			cc.waterPoly = wp.length ? wp : null;
			if (Math.abs(cc.vol - (cc.lastApplied || 0)) > cc.cap * 0.002) {
				const mw = cc.vol * rho;
				const m = cc.structMass + mw;
				let cLoc = cc.structC, Icm = cc.structI;
				if (cc.waterPoly) {
					const wc = polyCentroid(cc.waterPoly);
					// world water centroid to body-local
					const xf = cc.body.getTransform();
					const dx = wc.x - xf.p.x, dy = wc.y - xf.p.y;
					const lx = xf.q.c * dx + xf.q.s * dy, ly = -xf.q.s * dx + xf.q.c * dy;
					const cx = (cc.structC.x * cc.structMass + lx * mw) / m;
					const cy = (cc.structC.y * cc.structMass + ly * mw) / m;
					const { J, area } = polySecondMoment(cc.waterPoly);
					const Iw = area ? mw * Math.abs(J / area) : 0;
					const d1 = (cc.structC.x - cx) ** 2 + (cc.structC.y - cy) ** 2;
					const d2 = (lx - cx) ** 2 + (ly - cy) ** 2;
					cLoc = { x: cx, y: cy };
					Icm = cc.structI + cc.structMass * d1 + Iw + mw * d2;
				}
				setMass(cc.body, m, cLoc, Icm);
				cc.lastApplied = cc.vol;
			}
		}
		state.waterTons = tons / 1000;
		state.floodRate = totalIn / dtF * rho / 1000;
	}

	// ---- Joint stress and breakage ----
	function checkJoints() {
		const invDt = 1 / DT;
		let maxU = 0, maxULabel = '';
		for (const rec of joints) {
			if (rec.broken) continue;
			const F = vlen(rec.j.getReactionForce(invDt));
			const T = Math.abs(rec.j.getReactionTorque(invDt));
			const u = Math.max(F / rec.fmax, T / rec.tmax);
			const k = DT / P.STRESS_EMA_TAU;
			rec.emaF += (F - rec.emaF) * k;
			rec.emaT += (T - rec.emaT) * k;
			rec.u += (u - rec.u) * k;
			if (rec.u > maxU) { maxU = rec.u; maxULabel = rec.label; }
			if (rec.u > 1 || u > P.SHOCK_FACTOR) {
				rec.broken = true;
				const anchor = rec.j.getAnchorA();
				const pos = { x: anchor.x, y: anchor.y };
				world.destroyJoint(rec.j);
				if (rec.type === 'funnel') {
					funnels[rec.ix].attached = false;
					logEvent(`Funnel ${rec.ix + 1} tears loose and falls.`, pos, 'funnel');
				} else if (rec.type === 'shell' || rec.type === 'inner') {
					logEvent(`${rec.type === 'shell' ? 'Outer shell plating' : 'Internal structure'} fails ${Math.round(rec.x)} m from the bow.`, pos, 'crack');
					const other = joints.find(r => r !== rec && !r.broken && r.ix === rec.ix &&
						(r.type === 'shell' || r.type === 'inner'));
					if (!other && !state.hullBroken) {
						state.hullBroken = true;
						state.breakX = rec.x;
						state.breakTime = state.time;
						logEvent(`THE HULL BREAKS IN TWO, ${Math.round(rec.x)} m from the bow.`, pos, 'break');
					}
				}
			}
		}
		state.maxU = maxU;
		state.maxULabel = maxULabel;
	}

	// ---- Power and lights (state driven, not time driven) ----
	function checkPower() {
		if (!state.powered) return;
		const turbine = comps[11], electric = comps[12];
		if (turbine.vol > turbine.cap * 0.45 || electric.vol > electric.cap * 0.45 || state.hullBroken) {
			state.powered = false;
			logEvent('The dynamos flood. The lights go out.');
		}
	}

	// ---- Adaptive time multiplier ----
	function updateMultiplier() {
		let m = 0;
		for (const cc of comps) {
			const b = cc.body;
			const s = vlen(b.getLinearVelocity()) + 0.35 * Math.abs(b.getAngularVelocity()) * cc.charR;
			if (s > m) m = s;
		}
		for (const f of funnels) {
			const s = vlen(f.body.getLinearVelocity()) + 0.35 * Math.abs(f.body.getAngularVelocity()) * f.charR;
			if (s > m) m = s;
		}
		state.metric = m;
		metricFilt += (m - metricFilt) * (m > metricFilt ? P.METRIC_K_UP : P.METRIC_K_DOWN);
		const auto = Math.min(P.SPEED_MAX, Math.max(P.SPEED_MIN, P.SPEED_VREF / Math.max(metricFilt, 1e-3)));
		state.autoMultiplier = auto;
		state.multiplier = speedMode === 'fixed' ? fixedMult : auto;
	}

	function checkSettled() {
		if (!state.anyLanded || state.finished) return;
		let calm = true;
		for (const b of allBodies) {
			if (vlen(b.getLinearVelocity()) > 0.15 || Math.abs(b.getAngularVelocity()) > 0.02) {
				calm = false;
				break;
			}
		}
		// every piece must have reached the bottom region
		let deep = true;
		for (const b of allBodies) {
			if (b.getPosition().y > FLOOR_Y + 120) { deep = false; break; }
		}
		if (calm && deep) {
			state.settleTimer += DT;
			if (state.settleTimer > 15) {
				state.finished = true;
				logEvent('All wreckage rests on the seafloor. The simulation is complete.');
			}
		} else {
			state.settleTimer = 0;
		}
	}

	// ---- Main step ----
	function step() {
		if (state.finished) return;

		// hydro forces
		for (const cc of comps) {
			transformPoly(cc.body, cc.envLocal, cc.envWorld);
			applyHydro(cc.body, cc.envWorld, cc.breadthB, 1.0, cc.x1 - cc.x0);
		}
		for (const sh of shells) {
			transformPoly(sh.body, sh.local, sh.world);
			applyHydro(sh.body, sh.world, comps[sh.i].breadthB, 0, 12);
		}
		for (const f of funnels) {
			transformPoly(f.body, f.local, f.world);
			const sub = clipBelowY(f.world, 0);
			const subFrac = sub.length ? Math.abs(polyArea(sub)) / (P.FUNNEL_W * P.FUNNEL_H) : 0;
			if (subFrac > 0.02) f.tSub += DT * Math.min(1, subFrac / 0.4);
			const air = P.FUNNEL_BUOY_FACTOR * Math.exp(-f.tSub / P.FUNNEL_AIR_TAU);
			const steel = (P.FUNNEL_MASS / 7850) / (P.FUNNEL_W * P.FUNNEL_H * 6.0);
			applyHydro(f.body, f.world, 6.0, air + steel, P.FUNNEL_H);
		}

		// soft sediment near the bottom: the wreck plows into ooze (the real
		// bow buried itself about 18 m deep), which bleeds off energy fast
		for (const b of allBodies) {
			if (b.getPosition().y < FLOOR_Y + 40) {
				if (b.getLinearDamping() < 0.5) {
					b.setLinearDamping(0.6);
					b.setAngularDamping(0.8);
				}
			}
		}

		if (stepCount % FLOOD_EVERY === 0) updateFlooding(DT * FLOOD_EVERY);

		world.step(DT, P.VEL_ITERS, P.POS_ITERS);
		processContacts();
		checkJoints();
		checkPower();
		updateMultiplier();

		state.time += DT;
		state.wallTime += DT / (state.autoMultiplier || P.SPEED_MAX);
		state.trimDeg = comps[7].body.getAngle() * 180 / Math.PI;
		state.bowDepth = Math.max(0, -comps[0].body.getPosition().y);
		stepCount++;
		checkSettled();
		if (state.time > 40000) state.finished = true;
	}

	// Advance by a wall-clock interval, honoring the current multiplier.
	function advanceWall(wallDt, maxSteps = 700) {
		const mult = state.multiplier;
		stepCarry += mult * wallDt / DT;
		let n = Math.min(Math.floor(stepCarry), maxSteps);
		stepCarry = Math.min(stepCarry - n, maxSteps);
		const t0 = state.time;
		for (let i = 0; i < n && !state.finished; i++) step();
		return { steps: n, simAdvanced: state.time - t0 };
	}

	return {
		world, comps, shells, funnels, joints, events, state, activeFlows,
		bEff, FLOOR_Y,
		params: P,
		clock,
		step,
		advanceWall,
		setSpeedMode(mode) { speedMode = mode; },
		setFixedMultiplier(x) { fixedMult = Math.min(P.SPEED_MAX, Math.max(P.SPEED_MIN, x)); },
		getSpeedMode() { return speedMode; },
		getFixedMultiplier() { return fixedMult; },
		computePieces,
		pieceName,
	};
}
