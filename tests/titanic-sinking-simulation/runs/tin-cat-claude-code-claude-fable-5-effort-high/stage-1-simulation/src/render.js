// Canvas renderer for the Titanic sinking simulation. Pure 2D drawing on
// top of the physics state: night sky, moonlit sea, the ship with flooding
// compartments, smoke, bubbles, silt and the seafloor.

import { P } from './params.js';

const TAU = Math.PI * 2;

// deterministic pseudo-random, stable across frames
function hash(n) {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }

function mixColor(c1, c2, t) {
	return [
		Math.round(lerp(c1[0], c2[0], t)),
		Math.round(lerp(c1[1], c2[1], t)),
		Math.round(lerp(c1[2], c2[2], t)),
	];
}

// sea color by depth in meters (positive down)
function seaColor(d) {
	const stops = [
		[0, [22, 64, 92]],
		[60, [13, 42, 66]],
		[400, [8, 25, 43]],
		[1500, [6, 16, 29]],
		[3800, [5, 12, 22]],
	];
	for (let i = 0; i < stops.length - 1; i++) {
		const [d0, c0] = stops[i], [d1, c1] = stops[i + 1];
		if (d <= d1) return mixColor(c0, c1, clamp((d - d0) / (d1 - d0), 0, 1));
	}
	return stops[stops.length - 1][1];
}

export function createRenderer(canvas) {
	const ctx = canvas.getContext('2d');
	const cam = { x: 0, y: -5, s: 4, init: false };
	const smoke = [], bubbles = [], silt = [], foam = [];
	let seenEvents = 0;
	let wallT = 0;

	function fitCamera(sim, dt) {
		let lo = Infinity, hi = -Infinity, top = -Infinity, bot = Infinity;
		const consider = p => {
			if (p.x < lo) lo = p.x;
			if (p.x > hi) hi = p.x;
			if (p.y > top) top = p.y;
			if (p.y < bot) bot = p.y;
		};
		for (const cc of sim.comps) for (const p of cc.envWorld) consider(p);
		for (const f of sim.funnels) for (const p of f.world) consider(p);
		const W = canvas.width, H = canvas.height;
		const bw = Math.max(hi - lo, 60), bh = Math.max(top - bot, 50);
		const targS = clamp(Math.min(W / (bw * 1.22), H / (bh * 1.45)), 0.02, 5.2);
		let targX = (lo + hi) / 2;
		let targY = (top + bot) / 2;
		// keep a sliver of sky while the ship is near the surface
		if (top > -30 && top < 60) {
			const skyWorld = H * 0.16 / targS;
			targY = Math.max(targY, (top + skyWorld + bot) / 2 - 4);
		}
		if (!cam.init) {
			cam.x = targX; cam.y = targY; cam.s = targS; cam.init = true;
		}
		const k = 1 - Math.exp(-dt * 2.2);
		cam.x += (targX - cam.x) * k;
		cam.y += (targY - cam.y) * k;
		cam.s = Math.exp(Math.log(cam.s) + (Math.log(targS) - Math.log(cam.s)) * k * 0.8);
	}

	const wx2sx = wx => (wx - cam.x) * cam.s + canvas.width / 2;
	const wy2sy = wy => canvas.height / 2 - (wy - cam.y) * cam.s;

	// ---- scene layers ----

	function drawSky(seaY) {
		const W = canvas.width;
		const h = clamp(seaY, 0, canvas.height);
		if (h <= 0) return;
		const g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0, '#04060f');
		g.addColorStop(0.72, '#0a1226');
		g.addColorStop(1, '#15233f');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, h);

		// stars, gently parallaxed
		const par = cam.x * 0.18 * cam.s * 0.04;
		ctx.save();
		for (let i = 0; i < 160; i++) {
			const sx = ((hash(i) * 1.7 * W - par) % W + W) % W;
			const sy = hash(i + 500) ** 1.6 * h * 0.96;
			if (sy > h - 4) continue;
			const tw = 0.55 + 0.45 * Math.sin(wallT * (0.6 + hash(i + 900)) + i);
			ctx.globalAlpha = (0.25 + 0.6 * hash(i + 333)) * tw;
			const r = hash(i + 77) < 0.92 ? 0.9 : 1.7;
			ctx.fillStyle = hash(i + 51) < 0.85 ? '#cfd8ec' : '#ffe9c4';
			ctx.fillRect(sx, sy, r, r);
		}
		ctx.restore();

		// moon (artistic license: the real night was moonless, but the scene
		// must stay readable)
		const mx = W * 0.78 - par * 0.4, my = h * 0.26;
		const rad = Math.min(W, canvas.height) * 0.035;
		let g2 = ctx.createRadialGradient(mx, my, rad * 0.4, mx, my, rad * 5);
		g2.addColorStop(0, 'rgba(220,228,248,0.30)');
		g2.addColorStop(1, 'rgba(220,228,248,0)');
		ctx.fillStyle = g2;
		ctx.beginPath(); ctx.arc(mx, my, rad * 5, 0, TAU); ctx.fill();
		ctx.fillStyle = '#e8edfa';
		ctx.beginPath(); ctx.arc(mx, my, rad, 0, TAU); ctx.fill();
		ctx.fillStyle = 'rgba(150,160,190,0.35)';
		ctx.beginPath(); ctx.arc(mx - rad * 0.3, my - rad * 0.2, rad * 0.22, 0, TAU); ctx.fill();
		ctx.beginPath(); ctx.arc(mx + rad * 0.32, my + rad * 0.28, rad * 0.15, 0, TAU); ctx.fill();

		// moon glade on the water
		if (seaY < canvas.height) {
			const gl = ctx.createLinearGradient(0, seaY, 0, Math.min(seaY + 90, canvas.height));
			gl.addColorStop(0, 'rgba(214,224,248,0.20)');
			gl.addColorStop(1, 'rgba(214,224,248,0)');
			ctx.fillStyle = gl;
			ctx.fillRect(mx - rad * 2.6, seaY, rad * 5.2, 90);
		}
	}

	function drawSea(seaY) {
		const W = canvas.width, H = canvas.height;
		const y0 = clamp(seaY, 0, H);
		if (y0 >= H) return;
		const dTop = Math.max(0, -(cam.y + (H / 2 - y0) / cam.s));
		const dBot = Math.max(0, -(cam.y - H / 2 / cam.s));
		const cT = seaColor(dTop), cB = seaColor(dBot);
		const g = ctx.createLinearGradient(0, y0, 0, H);
		g.addColorStop(0, `rgb(${cT[0]},${cT[1]},${cT[2]})`);
		g.addColorStop(1, `rgb(${cB[0]},${cB[1]},${cB[2]})`);
		ctx.fillStyle = g;
		ctx.fillRect(0, y0, W, H - y0);

		// surface line and shimmer
		if (seaY > -20 && seaY < H + 20) {
			ctx.strokeStyle = 'rgba(190,215,240,0.65)';
			ctx.lineWidth = 1.4;
			ctx.beginPath();
			for (let x = 0; x <= W; x += 7) {
				const y = seaY + Math.sin(x * 0.045 + wallT * 1.6) * 1.6
					+ Math.sin(x * 0.013 - wallT * 0.7) * 2.2;
				x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		// god rays near the surface
		if (dTop < 60) {
			const rayEnd = Math.min(H, y0 + 360);
			ctx.save();
			ctx.globalAlpha = clamp(1 - dTop / 60, 0, 1) * 0.055;
			for (let i = 0; i < 5; i++) {
				const bx = W * (0.12 + 0.2 * i) + Math.sin(wallT * 0.12 + i * 2.2) * 40;
				const g = ctx.createLinearGradient(0, y0, 0, rayEnd);
				g.addColorStop(0, '#bcd8f2');
				g.addColorStop(1, 'rgba(188,216,242,0)');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.moveTo(bx - 14, y0);
				ctx.lineTo(bx + 14, y0);
				ctx.lineTo(bx + 80, rayEnd);
				ctx.lineTo(bx - 80, rayEnd);
				ctx.closePath();
				ctx.fill();
			}
			ctx.restore();
		}
	}

	function drawSeafloor(sim) {
		const fy = wy2sy(sim.FLOOR_Y);
		if (fy > canvas.height + 60) return;
		const W = canvas.width;
		ctx.fillStyle = '#241f18';
		ctx.beginPath();
		ctx.moveTo(0, canvas.height);
		ctx.lineTo(0, fy + 6);
		for (let x = 0; x <= W; x += 14) {
			const wx = (x - W / 2) / cam.s + cam.x;
			const dy = (hash(Math.floor(wx / 22)) - 0.5) * 4 * cam.s;
			ctx.lineTo(x, fy + dy);
		}
		ctx.lineTo(W, canvas.height);
		ctx.closePath();
		ctx.fill();
		ctx.strokeStyle = 'rgba(120,104,80,0.5)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
		// scattered stones
		for (let i = 0; i < 40; i++) {
			const wx = cam.x + ((hash(i + 60) - 0.5) * 1.6 * W) / cam.s;
			const sx = wx2sx(Math.round(wx / 9) * 9);
			const r = (0.5 + hash(i + 81) * 1.6) * cam.s;
			if (sx < -10 || sx > W + 10 || r < 0.5) continue;
			ctx.fillStyle = 'rgba(58,50,38,0.9)';
			ctx.beginPath();
			ctx.ellipse(sx, fy + 2 + hash(i) * 3 * cam.s, r, r * 0.55, 0, 0, TAU);
			ctx.fill();
		}
	}

	// ---- the ship ----

	function bodyTransform(body) {
		const xf = body.getTransform();
		ctx.save();
		ctx.translate(wx2sx(xf.p.x), wy2sy(xf.p.y));
		ctx.scale(cam.s, -cam.s);
		ctx.rotate(Math.atan2(xf.q.s, xf.q.c));
	}

	function pathPoly(poly) {
		ctx.beginPath();
		ctx.moveTo(poly[0].x, poly[0].y);
		for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
		ctx.closePath();
	}

	function drawShell(sh) {
		bodyTransform(sh.body);
		pathPoly(sh.local);
		ctx.fillStyle = '#0e1116';
		ctx.fill();
		ctx.restore();
	}

	function drawComp(sim, cc, powered) {
		bodyTransform(cc.body);
		const yOff = cc.shipYOff, xOff = cc.shipXOff;
		pathPoly(cc.envLocal);
		ctx.save();
		ctx.clip();
		// hull bands by height above keel (ship frame)
		const bands = [
			[-3, 1.1, '#15110e'],          // keel
			[1.1, 10.7, '#6e2d20'],        // anti-fouling red below the waterline
			[10.7, 11.25, '#cfc6b2'],      // boot top line
			[11.25, P.DECK_C - 0.35, '#16181d'], // black topsides
			[P.DECK_C - 0.35, 30, '#1d2026'],    // sheer / forecastle steel
		];
		const x0l = cc.x0 - xOff - 2, x1l = cc.x1 - xOff + 2;
		for (const [y0, y1, col] of bands) {
			ctx.fillStyle = col;
			ctx.fillRect(x0l, y0 - yOff, x1l - x0l, y1 - y0);
		}
		// gold sheer stripe
		ctx.fillStyle = 'rgba(201,164,74,0.85)';
		ctx.fillRect(x0l, P.DECK_C - 0.45 - yOff, x1l - x0l, 0.28);
		// porthole rows
		for (const [py, row] of [[12.4, 0], [15.0, 1], [17.4, 2]]) {
			const ly = py - yOff;
			for (let x = cc.x0 + 1.6; x < cc.x1 - 0.8; x += 2.6) {
				const id = Math.round(x * 7) + row * 977;
				const lit = powered && hash(id) > 0.35;
				ctx.fillStyle = lit ? 'rgba(255,213,130,0.95)' : 'rgba(70,86,104,0.8)';
				ctx.beginPath();
				ctx.arc(x - xOff, ly, lit ? 0.34 : 0.28, 0, TAU);
				ctx.fill();
			}
		}
		ctx.restore();
		// outline
		pathPoly(cc.envLocal);
		ctx.lineWidth = 0.25;
		ctx.strokeStyle = 'rgba(0,0,0,0.7)';
		ctx.stroke();

		// superstructure
		if (cc.ssLocal) {
			const s = cc.ssLocal;
			ctx.fillStyle = '#cdc9bb';
			ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
			ctx.fillStyle = '#a39e8e';
			ctx.fillRect(s.x0, s.y1 - 0.32, s.x1 - s.x0, 0.32);
			// deck lines and windows (A, B and boat deck rows)
			const rows = 3;
			for (let r = 0; r < rows; r++) {
				const wy = s.y0 + (s.y1 - s.y0) * (0.18 + r * 0.30);
				for (let x = s.x0 + 1.2; x < s.x1 - 0.9; x += 2.1) {
					const lit = powered && hash(Math.round(x * 13) + r * 389 + cc.i * 31) > 0.3;
					ctx.fillStyle = lit ? 'rgba(255,205,115,0.95)' : 'rgba(72,82,96,0.9)';
					ctx.fillRect(x, wy, 1.0, 0.85);
				}
			}
			// lifeboat davit ticks (empty falls: the boats are away)
			ctx.strokeStyle = 'rgba(50,52,58,0.9)';
			ctx.lineWidth = 0.18;
			for (let x = s.x0 + 2.5; x < s.x1 - 1.5; x += 6.5) {
				ctx.beginPath();
				ctx.moveTo(x, s.y1);
				ctx.quadraticCurveTo(x + 0.5, s.y1 + 1.5, x + 1.4, s.y1 + 1.1);
				ctx.stroke();
			}
		}

		// masts on the right slices
		if (cc.i === 2 || cc.i === 13) {
			const mx = (cc.i === 2 ? 33 : 224) - xOff;
			const baseY = P.DECK_C + 1 - yOff;
			ctx.strokeStyle = '#2b2620';
			ctx.lineWidth = 0.5;
			ctx.beginPath();
			ctx.moveTo(mx, baseY);
			ctx.lineTo(mx + (cc.i === 2 ? 2.2 : -2.2), baseY + 26);
			ctx.stroke();
			if (cc.i === 2) {
				ctx.fillStyle = '#3a342c';
				ctx.fillRect(mx + 1.35, baseY + 15.5, 1.6, 1.9);
			}
		}

		// name on the bow
		if (cc.i === 1 && cam.s > 1.9) {
			ctx.save();
			ctx.scale(1, -1);
			ctx.fillStyle = 'rgba(222,214,192,0.9)';
			ctx.font = '300 1.6px "Old Standard TT", serif';
			ctx.textAlign = 'left';
			ctx.fillText('T I T A N I C', cc.x0 + 0.8 - xOff, -(16.6 - yOff));
			ctx.restore();
		}
		ctx.restore();
	}

	function drawWater(cc) {
		if (!cc.waterPoly || cc.waterPoly.length < 3) return;
		ctx.beginPath();
		ctx.moveTo(wx2sx(cc.waterPoly[0].x), wy2sy(cc.waterPoly[0].y));
		for (let i = 1; i < cc.waterPoly.length; i++) {
			ctx.lineTo(wx2sx(cc.waterPoly[i].x), wy2sy(cc.waterPoly[i].y));
		}
		ctx.closePath();
		ctx.fillStyle = 'rgba(64,142,196,0.50)';
		ctx.fill();
		// internal water surface line
		ctx.strokeStyle = 'rgba(165,220,255,0.75)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		let started = false;
		for (let i = 0; i < cc.waterPoly.length; i++) {
			const p = cc.waterPoly[i], q = cc.waterPoly[(i + 1) % cc.waterPoly.length];
			if (Math.abs(p.y - cc.levelY) < 0.02 && Math.abs(q.y - cc.levelY) < 0.02) {
				ctx.moveTo(wx2sx(p.x), wy2sy(p.y));
				ctx.lineTo(wx2sx(q.x), wy2sy(q.y));
				started = true;
			}
		}
		if (started) ctx.stroke();
	}

	function drawCompLabel(cc) {
		if (cam.s < 1.45) return;
		const pos = cc.body.getPosition();
		ctx.save();
		ctx.font = `${Math.max(9, Math.min(11, cam.s * 4))}px "Old Standard TT", serif`;
		ctx.textAlign = 'center';
		ctx.fillStyle = 'rgba(225,232,245,0.34)';
		const frac = cc.vol / cc.cap;
		ctx.fillText(cc.name.toUpperCase(), wx2sx(pos.x), wy2sy(pos.y) + 3);
		if (frac > 0.005 && frac < 0.995) {
			ctx.fillStyle = 'rgba(150,205,250,0.55)';
			ctx.font = `${Math.max(8, Math.min(10, cam.s * 3.4))}px "Old Standard TT", serif`;
			ctx.fillText(`${Math.round(frac * 100)}%`, wx2sx(pos.x), wy2sy(pos.y) + 14);
		}
		ctx.restore();
	}

	function drawFunnel(sim, f, powered) {
		bodyTransform(f.body);
		const w2 = P.FUNNEL_W / 2, h2 = P.FUNNEL_H / 2;
		ctx.fillStyle = '#b98a52';
		ctx.fillRect(-w2, -h2, P.FUNNEL_W, P.FUNNEL_H);
		ctx.fillStyle = '#15151a';
		ctx.fillRect(-w2, h2 - 4.6, P.FUNNEL_W, 4.6);
		ctx.fillStyle = 'rgba(0,0,0,0.25)';
		ctx.fillRect(w2 - 1.4, -h2, 1.4, P.FUNNEL_H);
		ctx.strokeStyle = 'rgba(0,0,0,0.6)';
		ctx.lineWidth = 0.25;
		ctx.strokeRect(-w2, -h2, P.FUNNEL_W, P.FUNNEL_H);
		// stays while attached
		if (f.attached) {
			ctx.strokeStyle = 'rgba(180,185,195,0.4)';
			ctx.lineWidth = 0.14;
			for (const sgn of [-1, 1]) {
				ctx.beginPath();
				ctx.moveTo(sgn * w2 * 0.6, h2 - 5);
				ctx.lineTo(sgn * (w2 + 7), -h2);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	// ---- particles ----

	function spawnAndDrawParticles(sim, dt, powered) {
		// smoke from the working funnels
		for (const f of sim.funnels) {
			if (!(f.attached && powered && f.fi < 3)) continue;
			const xf = f.body.getTransform();
			const tipX = xf.p.x - xf.q.s * (P.FUNNEL_H / 2 - 1);
			const tipY = xf.p.y + xf.q.c * (P.FUNNEL_H / 2 - 1);
			if (tipY < 1) continue;
			if (Math.random() < 0.38) {
				smoke.push({
					x: tipX + (Math.random() - 0.5) * 2.5, y: tipY,
					vx: 1.5 + Math.random() * 1.6, vy: 2.6 + Math.random() * 2,
					r: 1.4 + Math.random() * 1.6, age: 0,
					life: 3.2 + Math.random() * 2.4,
				});
			}
		}
		ctx.save();
		for (let i = smoke.length - 1; i >= 0; i--) {
			const p = smoke[i];
			p.age += dt;
			if (p.age > p.life) { smoke.splice(i, 1); continue; }
			p.x += p.vx * dt; p.y += p.vy * dt;
			p.vy *= 0.995; p.r += dt * 1.1;
			const a = 0.11 * (1 - p.age / p.life);
			ctx.fillStyle = `rgba(168,170,178,${a.toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(wx2sx(p.x), wy2sy(p.y), p.r * cam.s, 0, TAU);
			ctx.fill();
		}
		ctx.restore();

		// bubbles from active flooding points
		for (const fl of sim.activeFlows) {
			if (fl.y > -0.5 || fl.q < 0.3) continue;
			if (Math.random() < clamp(fl.q / 30, 0.05, 0.5)) {
				bubbles.push({
					x: fl.x + (Math.random() - 0.5) * 3, y: fl.y,
					vy: 2 + Math.random() * 2.5, r: 0.25 + Math.random() * 0.5,
					age: 0, life: 3.5 + Math.random() * 3, ph: Math.random() * TAU,
				});
			}
		}
		for (const cc of sim.comps) {
			const v = cc.body.getLinearVelocity();
			const pos = cc.body.getPosition();
			if (v.y < -3 && pos.y < -12 && Math.random() < 0.10) {
				bubbles.push({
					x: pos.x + (Math.random() - 0.5) * 12, y: pos.y + 6,
					vy: 2.5 + Math.random() * 2.5, r: 0.3 + Math.random() * 0.6,
					age: 0, life: 4 + Math.random() * 3, ph: Math.random() * TAU,
				});
			}
		}
		ctx.save();
		for (let i = bubbles.length - 1; i >= 0; i--) {
			const b = bubbles[i];
			b.age += dt;
			b.y += b.vy * dt;
			b.x += Math.sin(wallT * 4 + b.ph) * dt * 1.4;
			if (b.age > b.life || b.y > -0.2 || bubbles.length > 260) { bubbles.splice(i, 1); continue; }
			ctx.strokeStyle = `rgba(190,225,250,${(0.5 * (1 - b.age / b.life)).toFixed(3)})`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(wx2sx(b.x), wy2sy(b.y), Math.max(0.6, b.r * cam.s), 0, TAU);
			ctx.stroke();
		}
		ctx.restore();

		// event-driven effects: foam at breaks, silt at impacts
		while (seenEvents < sim.events.length) {
			const e = sim.events[seenEvents++];
			if (e.x == null) continue;
			if (e.kind === 'impact') {
				for (let i = 0; i < 50; i++) {
					silt.push({
						x: e.x + (Math.random() - 0.5) * 60, y: e.y - 6 + Math.random() * 6,
						vx: (Math.random() - 0.5) * 9, vy: 1.5 + Math.random() * 4,
						r: 3 + Math.random() * 9, age: 0, life: 12 + Math.random() * 14,
					});
				}
			} else if (e.kind === 'break' || e.kind === 'crack' || e.kind === 'funnel') {
				const n = e.kind === 'break' ? 60 : 18;
				for (let i = 0; i < n; i++) {
					foam.push({
						x: e.x + (Math.random() - 0.5) * 14, y: e.y + (Math.random() - 0.5) * 6,
						vx: (Math.random() - 0.5) * 12, vy: Math.random() * 9,
						r: 0.7 + Math.random() * 2.2, age: 0, life: 1.6 + Math.random() * 1.8,
					});
				}
			}
		}
		ctx.save();
		for (let i = silt.length - 1; i >= 0; i--) {
			const p = silt[i];
			p.age += dt;
			if (p.age > p.life) { silt.splice(i, 1); continue; }
			p.x += p.vx * dt; p.y += p.vy * dt;
			p.vx *= 0.985; p.vy *= 0.97; p.r += dt * 2.6;
			const a = 0.13 * (1 - p.age / p.life);
			ctx.fillStyle = `rgba(120,104,82,${a.toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(wx2sx(p.x), wy2sy(p.y), p.r * cam.s, 0, TAU);
			ctx.fill();
		}
		for (let i = foam.length - 1; i >= 0; i--) {
			const p = foam[i];
			p.age += dt;
			if (p.age > p.life) { foam.splice(i, 1); continue; }
			p.x += p.vx * dt; p.y += p.vy * dt;
			p.vy -= 6 * dt;
			const a = 0.55 * (1 - p.age / p.life);
			ctx.fillStyle = `rgba(220,238,252,${a.toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(wx2sx(p.x), wy2sy(p.y), Math.max(0.8, p.r * cam.s), 0, TAU);
			ctx.fill();
		}
		ctx.restore();
	}

	function drawDepthScale(sim) {
		// subtle depth ruler on the right edge while underwater
		const H = canvas.height, W = canvas.width;
		const dTop = -(cam.y + (H / 2) / cam.s);
		if (dTop < 15) return;
		ctx.save();
		ctx.font = '11px "Old Standard TT", serif';
		ctx.fillStyle = 'rgba(190,205,225,0.4)';
		ctx.strokeStyle = 'rgba(190,205,225,0.25)';
		ctx.textAlign = 'right';
		const step = cam.s > 0.8 ? 50 : cam.s > 0.15 ? 250 : 1000;
		const wTop = cam.y + H / 2 / cam.s, wBot = cam.y - H / 2 / cam.s;
		for (let d = Math.ceil(-wTop / step) * step; d < -wBot; d += step) {
			if (d <= 0 || -d < sim.FLOOR_Y) continue;
			const sy = wy2sy(-d);
			ctx.beginPath();
			ctx.moveTo(W - 46, sy);
			ctx.lineTo(W - 34, sy);
			ctx.stroke();
			ctx.fillText(`${d} m`, W - 52, sy + 4);
		}
		ctx.restore();
	}

	function render(sim, dt) {
		wallT += dt;
		fitCamera(sim, dt);
		const seaY = wy2sy(0);

		drawSky(seaY);
		drawSea(seaY);
		drawSeafloor(sim);

		const powered = sim.state.powered;
		for (const sh of sim.shells) drawShell(sh);
		for (const cc of sim.comps) drawComp(sim, cc, powered);
		for (const f of sim.funnels) drawFunnel(sim, f, powered);
		// tint everything below the surface so submersion reads clearly
		const tintTop = clamp(seaY, 0, canvas.height);
		if (tintTop < canvas.height) {
			ctx.fillStyle = 'rgba(13, 44, 68, 0.38)';
			ctx.fillRect(0, tintTop, canvas.width, canvas.height - tintTop);
		}
		for (const cc of sim.comps) drawWater(cc);
		for (const cc of sim.comps) drawCompLabel(cc);

		spawnAndDrawParticles(sim, dt, powered);
		drawDepthScale(sim);
	}

	return { render, cam };
}
