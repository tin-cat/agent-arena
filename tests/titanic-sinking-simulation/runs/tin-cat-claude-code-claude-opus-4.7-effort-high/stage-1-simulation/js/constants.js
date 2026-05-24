// Real-world data taken from the RMS Titanic.
// Sources: White Star Line plans, official wreck surveys, Wilding's 1912 testimony,
// the 1986 / 2010 wreck-site sonar maps.

export const TITANIC = {
	length:           269.06,           // m, length overall
	beam:              28.19,           // m, max width (out-of-plane in 2D)
	hullDepth:         32.00,           // m, keel to top of A-deck superstructure
	draft:             10.54,           // m, design draft at load
	displacement:      52310 * 1016.05, // kg (52,310 long tons -> kg)
	compartmentCount:  16,              // 16 main watertight compartments
	bulkheadHeight:    13.4,            // m above keel; bulkheads ran up to E-deck
	hullMassFraction:  0.55,            // fraction of displacement that is structural (vs. fuel/cargo/air)
};

// Funnels: positions measured along the ship as a fraction of length from bow.
// Diameter ~7.3 m, height above boat deck ~22 m.
export const FUNNELS = [
	{ name: '1', alongFraction: 0.36, height: 22, diameter: 7.3, working: true  },
	{ name: '2', alongFraction: 0.48, height: 22, diameter: 7.3, working: true  },
	{ name: '3', alongFraction: 0.60, height: 22, diameter: 7.3, working: true  },
	{ name: '4', alongFraction: 0.71, height: 22, diameter: 7.3, working: false }, // dummy, vented galleys
];

// Compartments breached by the iceberg's starboard scrape (per Wilding):
// Forepeak, holds 1-3, boiler rooms 6 and 5 — the first six watertight compartments.
// We index from 0 = bow.
export const BREACHED_COMPARTMENT_INDICES = [0, 1, 2, 3, 4, 5];

// Per-compartment breach areas in m², plus an initial water mass already in
// each compartment to model the violent inrush during the first minutes
// after collision — the simulation begins "just after the collision with
// the iceberg", and historical estimates put 4,000-15,000 t aboard within
// the first 10-15 minutes. We bias the initial fill (and the breach inflow)
// forward because the forepeak had the deepest external hydrostatic head
// from the start, and because the simulation needs a continuous bow-heavy
// forcing to escape the static-equilibrium attractor a symmetric setup falls
// into.
export const BREACH_AREA_PER_COMPARTMENT = {
	0: 1.20,  // forepeak (lots of damage relative to size)
	1: 0.90,
	2: 0.70,
	3: 0.50,
	4: 0.30,
	5: 0.20,
};
export const INITIAL_WATER_TONNES_PER_COMPARTMENT = {
	0: 7500,
	1: 5500,
	2: 3500,
	3: 2000,
	4:  900,
	5:  300,
};
export const TOTAL_BREACH_AREA_M2 = Object.values(BREACH_AREA_PER_COMPARTMENT).reduce((a,b)=>a+b, 0);

// Effective width (m) of the bulkhead overflow once water tops the crest.
// Narrow enough that water builds up in the forward compartments (creating
// the bow-down bending moment) before propagating aft, but not so narrow
// that the cascade stalls.
export const BULKHEAD_OVERFLOW_WIDTH = 1.5;
export const BULKHEAD_OVERFLOW_CD = 0.55;

export const SEA = {
	density:    1025,  // kg/m³, North Atlantic surface water
	depth:      3784,  // m, depth at Titanic wreck site (recorded as 12,415 ft)
	dragCoeff:  1.05, // flat-plate-style drag coefficient for hull pieces
	viscousMu:  0.0014 // dynamic viscosity (Pa·s); only used for low-speed damping
};

// Titanic's block coefficient C_b = volume_displaced / (L · B · T) ≈ 0.66.
// Applied as a single multiplicative factor when converting our 2D rectangular
// bodies into 3D displaced volume. Keeps the ship floating at the real draft
// and prevents the (otherwise hollow) box from being non-sinkable.
export const HULL_BLOCK_COEFFICIENT = 0.65;

export const G = 9.81;  // m/s²

// Joint failure: triggered when an exponentially-smoothed stress signal
// exceeds the threshold. Stress combines (a) the world distance between the
// two anchor points (tension) and (b) the relative rotation of the two end
// bodies (bending), normalised to the same units. Smoothing rejects transient
// spikes (e.g. from a funnel impact) and lets the integrated bending load
// — which is what physically breaks plate seams — accumulate.
// Same threshold for every joint of a given role.
export const JOINT_STRAIN_BREAK_KEEL = 1.6;    // m equivalent, outer-hull (keel) seams
export const JOINT_STRAIN_BREAK_DECK = 2.8;    // m, deck seams (above neutral axis, slower to fail)
export const JOINT_STRAIN_BREAK_BULK = 2.3;    // m, bulkhead bottom seams
export const JOINT_STRAIN_BREAK_VERT = 3.0;    // m, compartment-to-keel verticals
export const JOINT_STRAIN_BREAK_FUNNEL = 1.6;  // m, funnel mounts

// Bending tolerances in radians.
export const JOINT_BEND_BREAK_HULL   = 0.18;   // ≈ 10°
export const JOINT_BEND_BREAK_VERT   = 0.25;
export const JOINT_BEND_BREAK_FUNNEL = 0.40;   // ≈ 23°: funnels rip free when toppled hard

// How much weight to put on bend vs. strain in the combined stress measure.
// strain (in metres) + BEND_WEIGHT × bend (in radians) is what we threshold.
export const BEND_WEIGHT = 8.0;                // 1 radian of bend ~ 8 m of strain

// EMA factor for smoothing stress measurements; smaller = more inertia.
export const STRESS_EMA = 0.05;

// Constraint stiffness / damping. Tuned for a near-rigid hull that still
// allows a measurable bending strain to develop under the bow-heavy load —
// that is what the failure test reads.
export const JOINT_STIFFNESS = 0.90;
export const JOINT_DAMPING   = 0.45;
export const FUNNEL_JOINT_STIFFNESS = 0.75;
export const FUNNEL_JOINT_DAMPING   = 0.35;

// Hard caps applied after every engine substep, to prevent numerical blowups
// once the ship has broken and isolated bodies might otherwise tumble at
// physically meaningless speeds. Set well above any realistic motion so that
// they only catch NaN explosions.
export const MAX_LINEAR_SPEED  = 200;  // m/s
export const MAX_ANGULAR_SPEED = 50;   // rad/s

// Time-multiplier configuration.
// FIXED_TIME_MULTIPLIER: set to a number to lock the multiplier (useful for tests,
// e.g. 1000 to fast-forward the whole simulation in a few seconds). Null = automatic.
export const FIXED_TIME_MULTIPLIER = null;

// Bounds for the dynamic multiplier.
export const MULT_MIN = 1;
export const MULT_MAX = 1000;

// Smoothing on the multiplier (low-pass filter: each frame we blend toward target).
export const MULT_SMOOTHING = 0.05;

// Activity-to-multiplier sensitivity. The multiplier follows
//   target = MULT_MAX / (1 + ACTIVITY_GAIN * activity)
// where 'activity' combines max body velocity (m/s) and max joint strain rate (1/s).
export const ACTIVITY_GAIN = 1.6;

// Physics substepping. Each rendered frame, we advance simulated time by
// (real_dt * multiplier). We split that into fixed-size substeps so Matter.js
// stays stable under the heavy/stiff hull constraints.
export const PHYSICS_DT = 1 / 120;
// At 60 fps wall and dt = 1/120 s, this many substeps allows a peak effective
// multiplier of roughly (substeps / 60 / dt) ≈ 1000× simulated-per-real second.
export const MAX_SUBSTEPS_PER_FRAME = 700;
