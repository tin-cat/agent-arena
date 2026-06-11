// Headless validation run. Steps the physics as fast as possible (the
// equivalent of pinning the time multiplier at its maximum) and checks that
// the emergent timeline approximates the real events of April 14-15, 1912.
//
//   node test/run.js [--quiet] [--status-every=600]

import { createSim } from '../src/sim.js';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const statusEvery = Number((args.find(a => a.startsWith('--status-every=')) || '=600').split('=')[1]);

const sim = createSim({ fixedMultiplier: 1000 });
const { state } = sim;

let nextStatus = 0;
let printed = 0;
const t0 = Date.now();

function fmt(t) {
	const m = Math.floor(t / 60), s = Math.floor(t % 60);
	return `${m}m${String(s).padStart(2, '0')}s`;
}

while (!state.finished) {
	sim.step();
	if (!quiet && state.time >= nextStatus) {
		nextStatus += statusEvery;
		const water = state.waterTons.toFixed(0).padStart(6);
		console.log(`t=${fmt(state.time).padStart(8)} clock=${sim.clock(state.time)} ` +
			`water=${water}t trim=${state.trimDeg.toFixed(2).padStart(6)}deg ` +
			`bowY=${(-state.bowDepth).toFixed(1).padStart(8)}m ` +
			`maxU=${state.maxU.toFixed(2)} (${state.maxULabel}) ` +
			`mult=${state.multiplier.toFixed(0)} wall=${state.wallTime.toFixed(1)}s`);
	}
	while (printed < sim.events.length) {
		const e = sim.events[printed++];
		console.log(`  >> [${e.clock}] (t=${fmt(e.t)}) ${e.text}`);
	}
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s real compute, ` +
	`${fmt(state.time)} simulated, estimated auto-mode wall time ${state.wallTime.toFixed(1)}s`);

// ---- Assertions against the historical record ----
const checks = [];
function check(name, ok, detail) {
	checks.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const breakT = state.breakTime;
check('Hull breaks in two', state.hullBroken, breakT != null ? `at t=${fmt(breakT)} (real: ~2h38m after impact)` : 'no break');
if (breakT != null) {
	check('Break time ~2h40m +/- 40min', breakT > 7200 && breakT < 12000, `t=${fmt(breakT)}`);
	check('Break location 55-75% from bow', state.breakX > 0.50 * 269.1 && state.breakX < 0.78 * 269.1,
		`x=${state.breakX?.toFixed(0)} m (real: ~170-190 m, between funnels 3 and 4)`);
}
const funnelEvents = sim.events.filter(e => /Funnel \d tears/.test(e.text));
check('At least 2 funnels fall', funnelEvents.length >= 2, `${funnelEvents.length} fell`);
if (funnelEvents.length && breakT != null) {
	const firstFunnel = funnelEvents[0].t;
	check('First funnel falls near the end (>80% of sinking)', firstFunnel > 0.8 * breakT,
		`t=${fmt(firstFunnel)}`);
}
const landEvents = sim.events.filter(e => /strikes the seafloor/.test(e.text));
check('Wreckage reaches the seafloor', landEvents.length >= 1, `${landEvents.length} impact event(s)`);
check('Simulation settles (all at rest)', sim.events.some(e => /rests on the seafloor/.test(e.text)),
	state.finished ? 'finished' : 'timed out');
check('Estimated viewing time ~1 minute', state.wallTime > 35 && state.wallTime < 100,
	`${state.wallTime.toFixed(1)}s`);

// settle diagnostics: who is still moving or off the floor
let worst = null;
for (const c of [...sim.comps, ...sim.funnels]) {
	const v = Math.hypot(c.body.getLinearVelocity().x, c.body.getLinearVelocity().y);
	const om = Math.abs(c.body.getAngularVelocity());
	const y = c.body.getPosition().y;
	if (!worst || v + om > worst.v + worst.om) worst = { name: c.name || `funnel${c.fi}`, v, om, y };
}
console.log(`INFO  most active body at end: ${worst.name} v=${worst.v.toFixed(3)} om=${worst.om.toFixed(4)} y=${worst.y.toFixed(0)}`);

const lights = sim.events.find(e => /lights go out/.test(e.text));
if (lights) console.log(`INFO  Lights went out at [${lights.clock}] (real: ~02:18)`);
console.log(`INFO  Final positions: ` + sim.comps.map(c =>
	`${c.i}:${c.body.getPosition().y.toFixed(0)}`).join(' '));

process.exit(checks.every(c => c.ok) ? 0 : 1);
