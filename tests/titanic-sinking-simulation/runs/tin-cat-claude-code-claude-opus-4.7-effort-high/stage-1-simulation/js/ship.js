// Constructs the ship as a system of rigid bodies + breakable joints in Matter.js.
//
// Layout (side view, x = along length, y = down):
//
//             funnel  funnel  funnel  funnel
//               |       |       |       |
//   [-----------+-------+-------+-------+-----------]  <- compartments (16 in a chain)
//   [-----------+-------+-------+-------+-----------]  <- outer-hull keel (16 in a chain)
//
// Adjacent segments are joined by top + bottom breakable joints (so bending
// produces strain). Each compartment is joined to the hull segment beneath it
// by left + right breakable joints. Funnels are joined to their nearest
// compartment top by left + right breakable joints.

import * as C from './constants.js';

const { Bodies, Body, Composite, Constraint } = Matter;

const SHIP_COLLISION = { category: 0x0001, mask: 0x0004, group: -1 };
export const WORLD_COLLISION = { category: 0x0004, mask: 0xFFFF };

export function createShip(world) {
	const T = C.TITANIC;
	const compW = T.length / T.compartmentCount;
	const keelHeight = 5.5;
	const compHeight = T.hullDepth - keelHeight;

	// Initially floating at design draft: keel bottom at y = draft.
	const keelBottomY = T.draft;
	const keelCenterY = keelBottomY - keelHeight / 2;
	const compBottomY = keelBottomY - keelHeight;
	const compCenterY = compBottomY - compHeight / 2;

	// Mass split: 30% in the keel (heavy machinery + outer plating),
	// 70% in the compartment volume above (decks, bulkheads, contents).
	const totalMass = T.displacement;
	const keelMassPer = totalMass * 0.30 / T.compartmentCount;
	const compMassPer = totalMass * 0.70 / T.compartmentCount;

	const ship = {
		hullSegments: [],
		compartments: [],
		funnels: [],
		joints: [],
		dimensions: { length: T.length, beam: T.beam, hullDepth: T.hullDepth, draft: T.draft, keelHeight, compHeight, compW, compBottomY, compCenterY, keelCenterY },
	};

	// --- outer hull (keel) segments -----------------------------------------
	// Initial bow trim: by the time we "start" — moments after the iceberg
	// has gouged the starboard side and several thousand tons are already in
	// the forward holds — the ship has a slight bow-down list. We apply this
	// as an initial rotation of every body around the ship's centroid.
	const initialTrim = -0.02; // rad, ≈ 1.15° bow-down

	for (let i = 0; i < T.compartmentCount; i++) {
		const xUnrot = -T.length / 2 + (i + 0.5) * compW;
		const yUnrot = keelCenterY;
		// rotate (xUnrot, yUnrot) around origin (0,0) by initialTrim
		const cs = Math.cos(initialTrim), sn = Math.sin(initialTrim);
		const x = xUnrot * cs - yUnrot * sn;
		const y = xUnrot * sn + yUnrot * cs;
		const segW = compW * 0.999;
		const body = Bodies.rectangle(x, y, segW, keelHeight, {
			density: keelMassPer / (segW * keelHeight),
			frictionAir: 0,
			friction: 0.6,
			label: `hull-${i}`,
			collisionFilter: SHIP_COLLISION,
			angle: initialTrim,
		});
		ship.hullSegments.push({ body, index: i, width: segW, height: keelHeight, type: 'hull' });
	}

	// --- inner compartments -------------------------------------------------
	const cs = Math.cos(initialTrim), sn = Math.sin(initialTrim);
	for (let i = 0; i < T.compartmentCount; i++) {
		const xUnrot = -T.length / 2 + (i + 0.5) * compW;
		const yUnrot = compCenterY;
		const x = xUnrot * cs - yUnrot * sn;
		const y = xUnrot * sn + yUnrot * cs;
		const segW = compW * 0.999;
		const body = Bodies.rectangle(x, y, segW, compHeight, {
			density: compMassPer / (segW * compHeight),
			frictionAir: 0,
			friction: 0.4,
			label: `comp-${i}`,
			collisionFilter: SHIP_COLLISION,
			angle: initialTrim,
		});
		const breachArea = C.BREACH_AREA_PER_COMPARTMENT[i] || 0;
		const initialT = C.INITIAL_WATER_TONNES_PER_COMPARTMENT[i] || 0;
		ship.compartments.push({
			body,
			index: i,
			width: segW,
			height: compHeight,
			waterMass: initialT * 1000, // tonnes -> kg
			waterLevel: 0,
			breached: breachArea > 0,
			breachArea,
			capacity: segW * compHeight * T.beam * C.HULL_BLOCK_COEFFICIENT,
			type: 'comp',
		});
	}

	// --- joints -------------------------------------------------------------
	const addJoint = (a, b, pa, pb, role, breakStrain, breakBend, stiff, damp) => {
		const c = Constraint.create({
			bodyA: a, bodyB: b,
			pointA: pa, pointB: pb,
			length: 0,
			stiffness: stiff !== undefined ? stiff : C.JOINT_STIFFNESS,
			damping:   damp  !== undefined ? damp  : C.JOINT_DAMPING,
		});
		const j = {
			constraint: c, role,
			breakStrain,
			breakBend,
			initialAngleDiff: b.angle - a.angle,
			broken: false,
			lastStress: 0, peakStress: 0, peakBend: 0,
			stressEMA: 0,
		};
		ship.joints.push(j);
		Composite.add(world, c);
		return j;
	};

	for (let i = 0; i < T.compartmentCount - 1; i++) {
		const hL = ship.hullSegments[i], hR = ship.hullSegments[i + 1];
		const cL = ship.compartments[i], cR = ship.compartments[i + 1];

		// outer-hull (keel) chain: top and bottom of the keel segment boundary
		addJoint(hL.body, hR.body,
			{ x: hL.width / 2, y: -keelHeight / 2 },
			{ x: -hR.width / 2, y: -keelHeight / 2 }, 'keel-top',
			C.JOINT_STRAIN_BREAK_KEEL, C.JOINT_BEND_BREAK_HULL);
		addJoint(hL.body, hR.body,
			{ x: hL.width / 2, y: keelHeight / 2 },
			{ x: -hR.width / 2, y: keelHeight / 2 }, 'keel-bot',
			C.JOINT_STRAIN_BREAK_KEEL, C.JOINT_BEND_BREAK_HULL);

		// compartment chain: bulkhead connections (top + bottom of the boundary)
		addJoint(cL.body, cR.body,
			{ x: cL.width / 2, y: -compHeight / 2 },
			{ x: -cR.width / 2, y: -compHeight / 2 }, 'deck',
			C.JOINT_STRAIN_BREAK_DECK, C.JOINT_BEND_BREAK_HULL);
		addJoint(cL.body, cR.body,
			{ x: cL.width / 2, y: compHeight / 2 },
			{ x: -cR.width / 2, y: compHeight / 2 }, 'bulkhead-bot',
			C.JOINT_STRAIN_BREAK_BULK, C.JOINT_BEND_BREAK_HULL);
	}

	// Compartment-to-hull (vertical) joints: left + right of each compartment.
	for (let i = 0; i < T.compartmentCount; i++) {
		const c = ship.compartments[i];
		const h = ship.hullSegments[i];
		const halfC = c.width / 2;
		const halfH = h.width / 2;
		const useC = Math.min(halfC, halfH) * 0.85;
		addJoint(c.body, h.body,
			{ x: -useC, y: compHeight / 2 },
			{ x: -useC, y: -keelHeight / 2 }, 'comp-hull-l',
			C.JOINT_STRAIN_BREAK_VERT, C.JOINT_BEND_BREAK_VERT);
		addJoint(c.body, h.body,
			{ x: useC, y: compHeight / 2 },
			{ x: useC, y: -keelHeight / 2 }, 'comp-hull-r',
			C.JOINT_STRAIN_BREAK_VERT, C.JOINT_BEND_BREAK_VERT);
	}

	// Add bodies to world AFTER joints reference them.
	for (const h of ship.hullSegments) Composite.add(world, h.body);
	for (const c of ship.compartments) Composite.add(world, c.body);

	// --- funnels ------------------------------------------------------------
	for (const fdef of C.FUNNELS) {
		const fxUnrot = -T.length / 2 + fdef.alongFraction * T.length;
		const fH = fdef.height;
		const fW = fdef.diameter;
		const funnelCenterYUnrot = (compBottomY - compHeight) - fH / 2;
		const fx = fxUnrot * cs - funnelCenterYUnrot * sn;
		const funnelCenterY = fxUnrot * sn + funnelCenterYUnrot * cs;
		const funnelMass = 50 * 1000; // ~50 t per funnel including stays
		const body = Bodies.rectangle(fx, funnelCenterY, fW, fH, {
			density: funnelMass / (fW * fH),
			frictionAir: 0,
			label: `funnel-${fdef.name}`,
			collisionFilter: SHIP_COLLISION,
			angle: initialTrim,
		});
		// Attach to nearest compartment
		let nearestIdx = 0, best = Infinity;
		for (let i = 0; i < T.compartmentCount; i++) {
			const d = Math.abs(ship.compartments[i].body.position.x - fx);
			if (d < best) { best = d; nearestIdx = i; }
		}
		const base = ship.compartments[nearestIdx].body;
		const localBaseX = fx - base.position.x;
		addJoint(body, base,
			{ x: -fW / 2 * 0.6, y: fH / 2 },
			{ x: localBaseX - fW / 2 * 0.6, y: -compHeight / 2 }, `funnel-${fdef.name}-l`,
			C.JOINT_STRAIN_BREAK_FUNNEL, C.JOINT_BEND_BREAK_FUNNEL,
			C.FUNNEL_JOINT_STIFFNESS, C.FUNNEL_JOINT_DAMPING);
		addJoint(body, base,
			{ x: fW / 2 * 0.6, y: fH / 2 },
			{ x: localBaseX + fW / 2 * 0.6, y: -compHeight / 2 }, `funnel-${fdef.name}-r`,
			C.JOINT_STRAIN_BREAK_FUNNEL, C.JOINT_BEND_BREAK_FUNNEL,
			C.FUNNEL_JOINT_STIFFNESS, C.FUNNEL_JOINT_DAMPING);

		Composite.add(world, body);
		ship.funnels.push({
			body, width: fW, height: fH, name: fdef.name, working: fdef.working,
			detached: false, baseCompartment: nearestIdx,
		});
	}

	return ship;
}

