// Diagnostics for the first seconds of the simulation.
import { createSim } from '../src/sim.js';

const sim = createSim({ fixedMultiplier: 1000 });

console.log('bEff =', sim.bEff.toFixed(2));
for (const c of sim.comps) {
	console.log(`comp ${c.i} ${c.name.padEnd(18)} structMass=${(c.structMass / 1e3).toFixed(0).padStart(6)}t ` +
		`cap=${(c.cap * 1.025 / 1e0).toFixed(0).padStart(6)}t envArea=${c.envArea.toFixed(0)}`);
}

for (let s = 0; s < 90; s++) {
	sim.step();
	if (s % 3 !== 0) continue;
	let worst = null;
	for (const rec of sim.joints) {
		if (rec.broken) continue;
		const F = Math.hypot(rec.j.getReactionForce(30).x, rec.j.getReactionForce(30).y);
		const T = Math.abs(rec.j.getReactionTorque(30));
		const u = Math.max(F / rec.fmax, T / rec.tmax);
		if (!worst || u > worst.u) worst = { u, F, T, label: rec.label, type: rec.type };
	}
	const b = sim.comps[7].body;
	console.log(`step ${String(s).padStart(3)} t=${sim.state.time.toFixed(2)} ` +
		`worst u=${worst.u.toFixed(2)} F=${worst.F.toExponential(2)} T=${worst.T.toExponential(2)} ${worst.type} ${worst.label} | ` +
		`midV=(${b.getLinearVelocity().x.toFixed(3)},${b.getLinearVelocity().y.toFixed(3)}) ` +
		`midY=${b.getPosition().y.toFixed(2)}`);
}
console.log('events:', sim.events.map(e => e.text));
