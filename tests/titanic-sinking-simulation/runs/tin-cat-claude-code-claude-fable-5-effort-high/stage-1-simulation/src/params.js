// Real-world parameters of RMS Titanic and the sinking of April 14-15, 1912.
// All values in SI units (meters, kilograms, seconds) unless noted.
// Sources: British Wreck Commissioner's Inquiry (1912), Edward Wilding's
// flooding testimony, Harland & Wolff builder's specs, RMS Titanic Inc /
// Woods Hole survey data of the wreck site.

export const P = {
	// ---- Principal dimensions ----
	LENGTH: 269.1,           // length overall, 882 ft 9 in
	BEAM: 28.19,             // moulded breadth, 92 ft 6 in
	DRAUGHT: 10.54,          // load draught, 34 ft 7 in
	HULL_DEPTH: 19.0,        // keel to C deck (shell remains watertight to about here)
	BOAT_DECK: 27.1,         // keel to boat deck
	FUNNEL_TOP: 53.3,        // keel to top of funnels, 175 ft
	DISPLACEMENT: 52310e3,   // kg, 52,310 long tons at load draught

	// ---- Environment ----
	RHO_SEA: 1025,           // kg/m^3, cold North Atlantic seawater
	GRAVITY: 9.81,
	SEAFLOOR_DEPTH: 3784,    // m, wreck lies at about 12,415 ft
	WATER_CD: 1.05,          // bluff-body quadratic drag coefficient
	ANGULAR_CD: 1.1,         // rotational water drag coefficient
	ORIFICE_CD: 0.60,        // Torricelli discharge coefficient (sharp opening)
	WEIR_CD: 0.55,           // discharge coefficient for flow over bulkhead tops
	// Water crossing a bulkhead top did not pour over the full beam: it ran
	// through E deck corridors, stairwells and hatches. Effective spill path:
	WEIR_WIDTH: 1.2,         // m, effective corridor/stair width
	WEIR_DEPTH_MAX: 1.2,     // m, effective depth of the spill path
	// Above the bulkhead-deck deckhead only hatch trunks and the E deck
	// corridor continue upward: the floodable plan area shrinks to this
	// fraction, which throttles slow flooding above the bulkhead deck.
	TRUNK_FRAC: 0.22,

	// ---- Deck heights above keel (used for bulkhead tops and openings) ----
	DECK_E: 13.7,            // E deck, bulkhead deck amidships (~3 m above WL)
	DECK_D: 16.4,            // D deck, taller forward/aft bulkheads end here
	DECK_C: 19.0,            // C deck / weather deck of the hull proper
	SHEER_EXTRA: 3.4,        // sheer rise of the deck line at bow and stern
	FOCSLE_RAISE: 5.5,       // raised forecastle deck (to B deck level) forward
	FOCSLE_END: 33,          // forecastle extends to about frame x=33
	POOP_RAISE: 4.5,         // raised poop deck aft
	POOP_START: 238,         // poop begins near x=238

	// ---- Watertight subdivision ----
	// 16 compartments, 15 transverse bulkheads (A..P). x measured from the
	// bow in meters along the 269.1 m hull. Boundaries approximate the
	// builder's general arrangement. Two local breadth fractions collapse
	// the third dimension: widthB is the waterplane/displacement breadth
	// (the hull flares wide above water even at the ends, which stiffens
	// trim), widthF is the mean floodable-volume breadth (the fine entrance
	// and run mean end compartments hold far less water than midship ones).
	// Both are fractions of the midship effective breadth.
	COMPARTMENTS: [
		{ name: 'Fore peak',        x0: 0,   x1: 14,  perm: 0.95, machY: 8.0, widthB: 0.52, widthF: 0.18 },
		{ name: 'Cargo hold 1',     x0: 14,  x1: 30,  perm: 0.90, machY: 7.0, widthB: 0.70, widthF: 0.45 },
		{ name: 'Cargo hold 2',     x0: 30,  x1: 48,  perm: 0.90, machY: 7.0, widthB: 0.84, widthF: 0.66 },
		{ name: 'Cargo hold 3',     x0: 48,  x1: 65,  perm: 0.90, machY: 6.5, widthB: 0.94, widthF: 0.88 },
		{ name: 'Boiler room 6',    x0: 65,  x1: 82,  perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Boiler room 5',    x0: 82,  x1: 99,  perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Boiler room 4',    x0: 99,  x1: 116, perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Boiler room 3',    x0: 116, x1: 133, perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Boiler room 2',    x0: 133, x1: 149, perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Boiler room 1',    x0: 149, x1: 162, perm: 0.80, machY: 5.0, widthB: 1.00, widthF: 1.00 },
		{ name: 'Engine room',      x0: 162, x1: 186, perm: 0.75, machY: 6.0, widthB: 0.99, widthF: 0.98 },
		{ name: 'Turbine room',     x0: 186, x1: 205, perm: 0.75, machY: 5.5, widthB: 0.95, widthF: 0.92 },
		{ name: 'Electric engines', x0: 205, x1: 218, perm: 0.80, machY: 6.0, widthB: 0.90, widthF: 0.85 },
		{ name: 'Aft hold',         x0: 218, x1: 232, perm: 0.90, machY: 7.0, widthB: 0.80, widthF: 0.72 },
		{ name: 'Stores',           x0: 232, x1: 247, perm: 0.90, machY: 7.5, widthB: 0.66, widthF: 0.55 },
		{ name: 'Aft peak',         x0: 247, x1: 269.1, perm: 0.95, machY: 8.5, widthB: 0.50, widthF: 0.38 },
	],

	// Heights of the 15 bulkhead tops above keel. The two forward and five
	// aft bulkheads ran up to D deck, the middle ones only to E deck. This
	// was the famous design shortfall that let water cascade aft.
	BULKHEAD_TOP: [16.4, 16.4, 13.7, 13.7, 13.7, 13.7, 13.7, 13.7, 13.7, 13.7,
	               16.4, 16.4, 16.4, 16.4, 16.4],

	// ---- Structure masses (tonnes), per compartment slice ----
	// Hull steel distributed by profile area plus local machinery, coal and
	// cargo. Sums (with funnels and superstructure share) to DISPLACEMENT.
	COMP_MASS_T: [600, 1800, 2400, 2600, 3900, 3900, 3900, 3900, 3700, 3000,
	              6500, 4300, 2800, 2300, 2000, 1700],
	SUPERSTRUCTURE_MASS_T: 2770,   // deckhouses, spread over comps 3..12
	SUPERSTRUCTURE_X0: 50,
	SUPERSTRUCTURE_X1: 218,
	SUPERSTRUCTURE_Y: 23.0,        // its mass centroid above keel
	SHELL_MASS_FRACTION: 0.28,     // share of slice mass carried by the outer shell body
	// Cargo, coal and stores were stowed so the ship floated level without
	// excessive still-water bending: blend slice masses toward the local
	// buoyancy distribution by this fraction.
	MASS_SMOOTHING: 0.5,

	// ---- Iceberg damage (initial condition of the simulation) ----
	// Wilding's estimate: about 12 sq ft (~1.1-1.2 m^2) of narrow openings
	// spread over ~90 m of the starboard side, all below the waterline,
	// across the fore peak, holds 1-3, boiler room 6 and barely boiler room 5.
	// { comp index, area m^2, height of hole above keel }
	DAMAGE: [
		{ comp: 0, area: 0.050, y: 5.5 },
		{ comp: 1, area: 0.150, y: 5.0 },
		{ comp: 2, area: 0.220, y: 4.8 },
		{ comp: 3, area: 0.240, y: 4.5 },
		{ comp: 4, area: 0.340, y: 4.2 },
		{ comp: 5, area: 0.115, y: 4.0 },
	],

	// ---- Non-watertight deck openings (hatches, casings, skylights) ----
	// Water downfloods through these once they submerge. Heights above keel.
	// The forward hatches sat on the raised forecastle / well deck with
	// coamings and battened covers, so their effective sills are high and
	// their effective areas modest. Boiler casings and engine skylights
	// reached the boat deck.
	DECK_OPENINGS: [
		{ comp: 0,  area: 1.5,  y: 25.5 },
		{ comp: 1,  area: 3.0,  y: 24.6 },
		{ comp: 2,  area: 3.0,  y: 22.6 },
		{ comp: 3,  area: 3.0,  y: 22.0 },
		{ comp: 4,  area: 9.0,  y: 27.3 },
		{ comp: 5,  area: 9.0,  y: 27.3 },
		{ comp: 6,  area: 9.0,  y: 27.3 },
		{ comp: 7,  area: 9.0,  y: 27.3 },
		{ comp: 8,  area: 9.0,  y: 27.3 },
		{ comp: 9,  area: 9.0,  y: 27.3 },
		{ comp: 10, area: 12.0, y: 27.3 },
		{ comp: 11, area: 10.0, y: 27.3 },
		{ comp: 12, area: 4.0,  y: 19.8 },
		{ comp: 13, area: 4.0,  y: 20.0 },
		{ comp: 14, area: 4.0,  y: 20.6 },
		{ comp: 15, area: 2.5,  y: 22.0 },
	],

	// The ballast and bilge pumps discharged about 1,700 tons per hour while
	// steam and power lasted (Wilding's testimony).
	PUMP_RATE: 0.47,              // m^3/s total, while powered

	// ---- Funnels ----
	// Four funnels, ~8.5 m fore-and-aft, ~19 m above the boat deck plus
	// casing, about 60 tonnes each, held by stays and an expansion-jointed
	// casing. x is the funnel centerline from the bow.
	FUNNELS: [
		{ x: 73.0,  comp: 4 },
		{ x: 109.0, comp: 6 },
		{ x: 145.0, comp: 8 },
		{ x: 181.0, comp: 10 },
	],
	FUNNEL_W: 8.5,
	FUNNEL_H: 21.0,
	FUNNEL_MASS: 60e3,
	FUNNEL_BUOY_FACTOR: 0.25,     // trapped air fraction of casing volume
	FUNNEL_AIR_TAU: 18,           // s, air vents once the casing is in the water

	// ---- Structural strength (material limits, NOT break scripting) ----
	// Hull girder ultimate bending strength estimates for Titanic are around
	// 2.5-3 GN*m. Each interface is held by two weld rows (outer shell seam
	// and internal structure); both rows are rigid, so the bending moment
	// distributes between their torque channels. The torque limits below sum
	// to the hull girder capacity.
	SHELL_JOINT_FMAX: 2.0e8,      // N, shell seam tensile/shear limit
	SHELL_JOINT_TMAX: 4.5e8,      // N*m, shell seam bending share
	INNER_JOINT_FMAX: 1.5e8,      // N, internal structure seam limit
	INNER_JOINT_TMAX: 1.45e9,     // N*m, internal structure bending share
	// Hull girder strength along the length, per interface (15 values).
	// The long deckhouse stiffened the midship girder, but that
	// contribution was interrupted at the two expansion joints (abreast
	// funnel 1 at ~x=92 and between funnels 3 and 4 at ~x=170, where the
	// breakup actually initiated). End interfaces have shallower sections
	// but carry almost no load.
	// Interface k sits at x = COMPARTMENTS[k].x1:
	// 14, 30, 48, 65, 82, 99, 116, 133, 149, 162, 186, 205, 218, 232, 247
	STRENGTH_PROFILE: [0.90, 0.95, 1.00, 1.25, 1.30, 1.30, 1.34, 1.34, 1.30,
	                   0.92, 1.15, 1.12, 1.05, 0.95, 0.90],
	COMP_SHELL_FMAX: 4.0e8,       // N, compartment-to-shell attachment
	COMP_SHELL_TMAX: 2.5e9,
	FUNNEL_FMAX: 1.8e6,           // N, funnel stays + casing
	FUNNEL_TMAX: 2.4e6,           // N*m
	STRESS_EMA_TAU: 1.5,          // s, low-pass on joint utilization (plastic lag)
	SHOCK_FACTOR: 5.0,            // instant failure if load exceeds 5x limit

	// ---- Numerics ----
	DT: 1 / 30,                   // physics timestep, simulated seconds
	VEL_ITERS: 10,
	POS_ITERS: 8,

	// ---- Adaptive time multiplier ----
	// multiplier = clamp(SPEED_VREF / filtered(max body speed), 1, 1000)
	SPEED_VREF: 150,              // calibrated so a full auto-speed run lasts ~1 min
	SPEED_MIN: 1,
	SPEED_MAX: 1000,
	METRIC_K_UP: 0.25,            // filter gain when activity rises (fast)
	METRIC_K_DOWN: 0.0015,        // filter gain when activity falls (slow)
};
