// Canvas 2D rendering. The physics state (positions, rotations, water levels)
// is the source of truth; we just draw it. World coords: meters, y-down.

import * as C from './constants.js';

const STAR_COUNT = 220;

export class Renderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		this.resize();
		window.addEventListener('resize', () => this.resize());
		this.stars = generateStars();
		this.smokeParticles = [];
		this.lastSmokeSpawn = 0;
	}

	resize() {
		this.canvas.width = window.innerWidth * this.dpr;
		this.canvas.height = window.innerHeight * this.dpr;
		this.canvas.style.width = window.innerWidth + 'px';
		this.canvas.style.height = window.innerHeight + 'px';
	}

	get w() { return this.canvas.width / this.dpr; }
	get h() { return this.canvas.height / this.dpr; }

	draw(ship, camera, simTime, simulationActive) {
		const ctx = this.ctx;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		// Sky/sea background (screen-space).
		this.drawBackground(ctx, camera);
		// World-space content.
		camera.applyTo(ctx, this.w, this.h);
		this.drawSeafloor(ctx, camera);
		this.drawHullSegments(ctx, ship);
		this.drawCompartments(ctx, ship);
		this.drawFunnels(ctx, ship);
		this.drawWaterSurfaceOverlay(ctx, camera);
		this.drawJoints(ctx, ship);
		// HUD: scale bar, depth markers.
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.drawScaleBar(ctx, camera);
		this.drawDepthIndicator(ctx, camera, ship);

		// Smoke: spawned per visible funnel, simulated in world coords.
		if (simulationActive) this.updateSmoke(ship, simTime);
		camera.applyTo(ctx, this.w, this.h);
		this.drawSmoke(ctx);
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
	}

	// ------------------------------------------------------------------
	// background: sky gradient + stars (only the sky portion) + moon,
	// then a sea gradient below the sea surface in screen coords.
	// ------------------------------------------------------------------
	drawBackground(ctx, camera) {
		const w = this.w, h = this.h;
		// Sea-surface y on screen:
		const surfScreen = camera.worldToScreen(0, 0, w, h).y;
		// Sky (above surface):
		const skyGrad = ctx.createLinearGradient(0, 0, 0, Math.max(surfScreen, 0));
		skyGrad.addColorStop(0,    '#020716');
		skyGrad.addColorStop(0.55, '#091735');
		skyGrad.addColorStop(1,    '#102a55');
		ctx.fillStyle = skyGrad;
		ctx.fillRect(0, 0, w, Math.max(0, surfScreen));

		// Stars in the sky region only.
		for (const s of this.stars) {
			const sx = s.x * w;
			const sy = s.y * Math.max(1, surfScreen);
			if (sy >= surfScreen) continue;
			ctx.fillStyle = `rgba(255,255,240,${s.b})`;
			ctx.beginPath();
			ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
			ctx.fill();
		}

		// Moon (top-right of sky).
		if (surfScreen > 80) {
			ctx.save();
			const mx = w * 0.82, my = Math.min(surfScreen - 40, h * 0.18);
			const grad = ctx.createRadialGradient(mx, my, 4, mx, my, 80);
			grad.addColorStop(0,   'rgba(255,245,210,0.9)');
			grad.addColorStop(0.4, 'rgba(255,245,210,0.18)');
			grad.addColorStop(1,   'rgba(255,245,210,0)');
			ctx.fillStyle = grad;
			ctx.fillRect(mx - 80, my - 80, 160, 160);
			ctx.beginPath();
			ctx.fillStyle = '#fef5d0';
			ctx.arc(mx, my, 22, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		// Sea (below sea surface).
		if (surfScreen < h) {
			const seaGrad = ctx.createLinearGradient(0, Math.max(0, surfScreen), 0, h);
			seaGrad.addColorStop(0,    '#0a3158');
			seaGrad.addColorStop(0.35, '#04223e');
			seaGrad.addColorStop(1,    '#010812');
			ctx.fillStyle = seaGrad;
			ctx.fillRect(0, Math.max(0, surfScreen), w, h - Math.max(0, surfScreen));

			// Subtle moving god-rays (cheap parametric, not animated heavily).
			ctx.save();
			ctx.globalAlpha = 0.08;
			ctx.strokeStyle = '#a5c7ff';
			ctx.lineWidth = 1;
			for (let i = 0; i < 8; i++) {
				const x = (i / 8) * w + (performance.now() * 0.005 % (w / 8));
				ctx.beginPath();
				ctx.moveTo(x, Math.max(0, surfScreen));
				ctx.lineTo(x + 80, h);
				ctx.stroke();
			}
			ctx.restore();
		}
	}

	drawSeafloor(ctx, camera) {
		const floorY = C.SEA.depth;
		ctx.fillStyle = '#3b2e22';
		ctx.fillRect(-1e5, floorY, 2e5, 2e5);
		// Some sediment texture.
		ctx.fillStyle = '#5a4734';
		const pxStep = 30;
		const dotR = 1.2 / camera.zoom;
		for (let x = -2000; x < 2000; x += pxStep) {
			ctx.beginPath();
			ctx.arc(x, floorY + 8 + ((x * 37) % 12), dotR, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	drawHullSegments(ctx, ship) {
		for (const h of ship.hullSegments) {
			drawRectBody(ctx, h.body, h.width, h.height, '#7e95b8', '#22324e', 0.6);
		}
	}

	drawCompartments(ctx, ship) {
		for (const c of ship.compartments) {
			drawRectBody(ctx, c.body, c.width, c.height, '#3b5c8a', '#1b2942', 0.6);
			// Window strip (decorative).
			ctx.save();
			ctx.translate(c.body.position.x, c.body.position.y);
			ctx.rotate(c.body.angle);
			const winY = -c.height * 0.18;
			const winH = c.height * 0.08;
			const grad = ctx.createLinearGradient(0, winY, 0, winY + winH);
			grad.addColorStop(0, 'rgba(255,225,160,0.92)');
			grad.addColorStop(1, 'rgba(255,225,160,0.4)');
			ctx.fillStyle = grad;
			ctx.fillRect(-c.width / 2 + 0.6, winY, c.width - 1.2, winH);
			ctx.restore();
			// Water inside.
			this.drawCompartmentWater(ctx, c);
		}
	}

	drawCompartmentWater(ctx, c) {
		if (c.waterLevel <= 0.01) return;
		ctx.save();
		ctx.translate(c.body.position.x, c.body.position.y);
		ctx.rotate(c.body.angle);
		const lvl = Math.min(c.waterLevel, c.height);
		const top = c.height / 2 - lvl;
		const grad = ctx.createLinearGradient(0, top, 0, c.height / 2);
		grad.addColorStop(0,   'rgba(60,140,210,0.85)');
		grad.addColorStop(1,   'rgba(20,70,130,0.95)');
		ctx.fillStyle = grad;
		ctx.fillRect(-c.width / 2 + 0.4, top, c.width - 0.8, lvl);
		// Surface highlight.
		ctx.fillStyle = 'rgba(180,210,240,0.9)';
		ctx.fillRect(-c.width / 2 + 0.4, top, c.width - 0.8, 0.25);
		ctx.restore();
	}

	drawFunnels(ctx, ship) {
		for (const f of ship.funnels) {
			drawRectBody(ctx, f.body, f.width, f.height,
				f.working ? '#d8b66a' : '#aa9a6a',
				'#3a2a10', 0.4);
			// Black band on top
			ctx.save();
			ctx.translate(f.body.position.x, f.body.position.y);
			ctx.rotate(f.body.angle);
			ctx.fillStyle = '#1a120a';
			ctx.fillRect(-f.width / 2, -f.height / 2, f.width, f.height * 0.18);
			ctx.restore();
		}
	}

	drawWaterSurfaceOverlay(ctx, camera) {
		// Thin highlight along world y = 0 to mark the sea surface.
		ctx.save();
		ctx.strokeStyle = 'rgba(180,210,240,0.65)';
		ctx.lineWidth = 1 / camera.zoom;
		ctx.beginPath();
		ctx.moveTo(-1e5, 0);
		ctx.lineTo( 1e5, 0);
		ctx.stroke();
		ctx.restore();
	}

	drawJoints(ctx, ship) {
		ctx.save();
		ctx.lineWidth = 0.18;
		for (const j of ship.joints) {
			if (j.broken) continue;
			const c = j.constraint;
			const a = c.bodyA, b = c.bodyB;
			const sinA = Math.sin(a.angle), cosA = Math.cos(a.angle);
			const ax = a.position.x + c.pointA.x * cosA - c.pointA.y * sinA;
			const ay = a.position.y + c.pointA.x * sinA + c.pointA.y * cosA;
			const sinB = Math.sin(b.angle), cosB = Math.cos(b.angle);
			const bx = b.position.x + c.pointB.x * cosB - c.pointB.y * sinB;
			const by = b.position.y + c.pointB.x * sinB + c.pointB.y * cosB;
			const stress = Math.min(1, j.lastStress / 1.5);
			ctx.strokeStyle = `rgba(${Math.round(80 + 150 * stress)},${Math.round(160 - 120 * stress)},${Math.round(180 - 160 * stress)},0.6)`;
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.stroke();
		}
		ctx.restore();
	}

	drawScaleBar(ctx, camera) {
		const targetMeters = pickNiceLength(60 / camera.zoom);
		const px = targetMeters * camera.zoom;
		const x = this.w - 30 - px, y = this.h - 30;
		ctx.fillStyle = 'rgba(8,16,32,0.6)';
		ctx.fillRect(x - 6, y - 16, px + 12, 22);
		ctx.strokeStyle = '#e8eef7';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4);
		ctx.stroke();
		ctx.fillStyle = '#e8eef7';
		ctx.font = '11px Segoe UI, Arial';
		ctx.textAlign = 'center';
		ctx.fillText(`${targetMeters} m`, x + px / 2, y - 6);
	}

	drawDepthIndicator(ctx, camera, ship) {
		// Faint horizontal depth ticks every 50 m along left edge.
		const left = 8;
		ctx.fillStyle = 'rgba(200,220,255,0.35)';
		ctx.font = '10px Segoe UI, Arial';
		ctx.textAlign = 'left';
		for (let d = 0; d <= 4000; d += 100) {
			const sp = camera.worldToScreen(0, d, this.w, this.h);
			if (sp.y < 16 || sp.y > this.h - 4) continue;
			ctx.fillRect(left, sp.y, 6, 0.5);
			if (d % 500 === 0) ctx.fillText(`${d} m`, left + 10, sp.y + 3);
		}
	}

	updateSmoke(ship, simTime) {
		// Spawn smoke from working funnels until they sink or break.
		this.lastSmokeSpawn = (this.lastSmokeSpawn || 0) + 1;
		for (const f of ship.funnels) {
			if (!f.working) continue;
			if (f.detached) continue;
			// Funnel top (local y = -h/2)
			const c = Math.cos(f.body.angle), s = Math.sin(f.body.angle);
			const tx = f.body.position.x + (-f.height / 2) * (-s);
			const ty = f.body.position.y + (-f.height / 2) *  c;
			if (ty > -2) continue; // submerged or near water; no smoke
			if (this.smokeParticles.length > 700) continue;
			if (Math.random() < 0.5) {
				this.smokeParticles.push({
					x: tx + (Math.random() - 0.5) * f.width * 0.5,
					y: ty,
					vx: (Math.random() - 0.5) * 1.5,
					vy: -3 - Math.random() * 2,
					age: 0,
					maxAge: 80 + Math.random() * 40,
					r: 2 + Math.random() * 2,
				});
			}
		}
		// Update particles.
		for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
			const p = this.smokeParticles[i];
			p.age++;
			p.x += p.vx * 0.05;
			p.y += p.vy * 0.05;
			p.vy *= 0.99;
			p.r += 0.08;
			if (p.age > p.maxAge || p.y > 0) this.smokeParticles.splice(i, 1);
		}
	}

	drawSmoke(ctx) {
		for (const p of this.smokeParticles) {
			const a = 1 - p.age / p.maxAge;
			ctx.fillStyle = `rgba(220,225,235,${a * 0.35})`;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

// ---------------------------------------------------------------------------
function drawRectBody(ctx, body, width, height, fill, stroke, strokeW) {
	ctx.save();
	ctx.translate(body.position.x, body.position.y);
	ctx.rotate(body.angle);
	ctx.fillStyle = fill;
	ctx.fillRect(-width / 2, -height / 2, width, height);
	ctx.strokeStyle = stroke;
	ctx.lineWidth = strokeW;
	ctx.strokeRect(-width / 2, -height / 2, width, height);
	ctx.restore();
}

function generateStars() {
	const arr = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		arr.push({
			x: Math.random(),
			y: Math.random() * 0.85,
			r: Math.random() * 1.2 + 0.1,
			b: 0.3 + Math.random() * 0.7,
		});
	}
	return arr;
}

function pickNiceLength(target) {
	const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000];
	let best = candidates[0];
	for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
	return best;
}
