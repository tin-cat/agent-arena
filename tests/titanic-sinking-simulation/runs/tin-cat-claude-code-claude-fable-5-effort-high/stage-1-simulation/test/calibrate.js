// Calibration probe: run with the hull made artificially indestructible and
// record the emergent bending load history at every interface. This tells us
// where and when the peak load develops, so the joint strength constants can
// be set inside the physically observed corridor (strong enough to survive
// the early flooding, weak enough to fail under the late bending peak).

import { createSim } from '../src/sim.js';
import { P } from '../src/params.js';

const sim = createSim({ fixedMultiplier: 1000, strengthScale: 1000 });
const { state } = sim;

let next = 0;
let printed = 0;
const tEnd = Number(process.argv[2] || 12000);

console.log('time     clock     water   trim   bowY   | interface torque sums (shell+inner, GN*m), every other interface 30..232 m');
while (!state.finished && state.time < tEnd) {
	sim.step();
	if (state.time >= next) {
		next += 300;
		const tor = [];
		for (let k = 0; k < 15; k++) {
			const sh = sim.joints.find(r => r.type === 'shell' && r.ix === k);
			const inn = sim.joints.find(r => r.type === 'inner' && r.ix === k);
			const T = ((sh && !sh.broken ? sh.emaT : 0) + (inn && !inn.broken ? inn.emaT : 0)) / 1e9;
			tor.push(T);
		}
		const peak = tor.reduce((b, v, i) => v > tor[b] ? i : b, 0);
		let mSh = { v: 0, ix: -1 }, mIn = { v: 0, ix: -1 };
		for (const r of sim.joints) {
			if (r.broken) continue;
			if (r.type === 'shell' && r.emaT > mSh.v) mSh = { v: r.emaT, ix: r.ix };
			if (r.type === 'inner' && r.emaT > mIn.v) mIn = { v: r.emaT, ix: r.ix };
		}
		console.log(`${String(Math.round(state.time)).padStart(6)}s ${sim.clock(state.time)} ` +
			`${state.waterTons.toFixed(0).padStart(6)}t ${state.trimDeg.toFixed(1).padStart(5)}deg ` +
			`${(-state.bowDepth).toFixed(1).padStart(7)} | ` +
			tor.map((t, i) => (i === peak ? '*' : '') + t.toFixed(2)).join(' ') +
			` | sh ${(mSh.v / 1e9).toFixed(2)}@${mSh.ix} in ${(mIn.v / 1e9).toFixed(2)}@${mIn.ix}`);
	}
	while (printed < sim.events.length) {
		const e = sim.events[printed++];
		console.log(`  >> [${e.clock}] ${e.text}`);
	}
}
console.log('comp vols (t):', sim.comps.map(c => (c.vol * 1.025).toFixed(0)).join(' '));
