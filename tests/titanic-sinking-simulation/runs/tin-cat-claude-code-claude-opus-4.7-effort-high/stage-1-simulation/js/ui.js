// Wires the info-panel readouts and the control panel. No simulation logic.

export class UI {
	constructor(state) {
		this.state = state;
		this.elSim     = document.getElementById('sim-time');
		this.elWall    = document.getElementById('wall-time');
		this.elMult    = document.getElementById('time-mult');
		this.elWater   = document.getElementById('water-mass');
		this.elInflow  = document.getElementById('inflow');
		this.elAngle   = document.getElementById('bow-angle');
		this.elDepth   = document.getElementById('bow-depth');
		this.elHull    = document.getElementById('hull-status');
		this.elFun     = document.getElementById('funnels-lost');
		this.elRest    = document.getElementById('resting');
		this.elPhase   = document.getElementById('phase');

		this.btnPP     = document.getElementById('play-pause');
		this.btnRst    = document.getElementById('restart');
		this.slider    = document.getElementById('mult-slider');
		this.sliderVal = document.getElementById('mult-slider-val');

		this.btnPP.addEventListener('click', () => {
			state.paused = !state.paused;
			this.btnPP.textContent = state.paused ? 'Play' : 'Pause';
		});
		this.btnRst.addEventListener('click', () => {
			state.restartRequested = true;
		});
		this.slider.addEventListener('input', () => {
			const v = parseFloat(this.slider.value);
			if (v <= 0) {
				state.manualMultiplier = null;
				this.sliderVal.textContent = 'Auto';
			} else {
				state.manualMultiplier = v;
				this.sliderVal.textContent = `${v.toFixed(0)}×`;
			}
		});
	}

	update(snapshot) {
		this.elSim.textContent    = formatHMS(snapshot.simTimeSec);
		this.elWall.textContent   = `${snapshot.wallTimeSec.toFixed(1)} s`;
		this.elMult.textContent   = `${snapshot.multiplier.toFixed(snapshot.multiplier < 10 ? 1 : 0)}×`;
		this.elWater.textContent  = `${(snapshot.totalWaterMass / 1000).toFixed(0)} t`;
		this.elInflow.textContent = `${(snapshot.inflowRate / 1000).toFixed(1)} t/s`;
		this.elAngle.textContent  = `${(snapshot.bowAngleDeg).toFixed(1)}°`;
		this.elDepth.textContent  = `${snapshot.bowDepth.toFixed(1)} m`;
		this.elHull.textContent   = snapshot.hullBroken ? `Broken (${snapshot.breakCompartmentLabel})` : 'Intact';
		this.elFun.textContent    = `${snapshot.funnelsLost} / 4`;
		this.elRest.textContent   = `${snapshot.restingFragments}`;
		this.elPhase.textContent  = snapshot.phase;
	}
}

function formatHMS(s) {
	const sign = s < 0 ? '-' : '+';
	s = Math.abs(Math.floor(s));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
