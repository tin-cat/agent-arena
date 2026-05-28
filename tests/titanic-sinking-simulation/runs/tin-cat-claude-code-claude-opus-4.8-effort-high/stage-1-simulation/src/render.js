/*
 * Canvas 2D renderer for the Titanic simulation (browser only).
 *
 * The physics state in sim-core.js is the single source of truth; this file
 * only *reads* it and draws. It frames the camera so the wreck always fits the
 * screen, paints the night scene brightly enough to follow, draws each rigid
 * body, and fills each compartment up to its real internal water level.
 */
(function (root) {
	"use strict";
	const T = root.TitanicSim;

	function lerp(a, b, t) { return a + (b - a) * t; }

	function Renderer(canvas, sim) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.sim = sim;
		this.C = sim.CONFIG;
		// camera in world units: center + metres-per-... (scale = px per metre)
		this.cam = { x: 0, y: 0, scale: 3, tx: 0, ty: 0, tscale: 3 };
		this.particles = [];
		this.bubbles = [];
		this.smokePhase = 0;
		this._init = false;
		this._prevBroken = false;
		this._funnelsDown = 0;
	}

	Renderer.prototype.resize = function () {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
		this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
		this.dpr = dpr;
	};

	// world -> screen
	Renderer.prototype.w2s = function (x, y) {
		const W = this.canvas.width, H = this.canvas.height;
		return {
			x: W / 2 + (x - this.cam.x) * this.cam.scale,
			y: H / 2 - (y - this.cam.y) * this.cam.scale,
		};
	};

	// Fit the camera to all ship parts (always frames every fragment).
	Renderer.prototype.updateCamera = function (dt) {
		const parts = this.sim.state.parts;
		let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
		for (const p of parts) {
			const wv = T.worldVerts(p.body, p.local);
			for (const v of wv) {
				if (v.x < minx) minx = v.x; if (v.x > maxx) maxx = v.x;
				if (v.y < miny) miny = v.y; if (v.y > maxy) maxy = v.y;
			}
		}
		// keep the sea surface in frame while we're still near it
		if (maxy > -120) { miny = Math.min(miny, -8); maxy = Math.max(maxy, 14); }
		const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
		const w = Math.max(maxx - minx, 40), h = Math.max(maxy - miny, 30);
		const W = this.canvas.width, H = this.canvas.height;
		const pad = 1.35;
		const scale = Math.min(W / (w * pad), H / (h * pad));
		this.cam.tx = cx; this.cam.ty = cy; this.cam.tscale = Math.max(0.02, scale);
		if (!this._init) { this.cam.x = cx; this.cam.y = cy; this.cam.scale = this.cam.tscale; this._init = true; }
		const k = 1 - Math.pow(0.0001, dt); // frame-rate independent smoothing
		this.cam.x = lerp(this.cam.x, this.cam.tx, k);
		this.cam.y = lerp(this.cam.y, this.cam.ty, k);
		this.cam.scale = lerp(this.cam.scale, this.cam.tscale, k);
	};

	Renderer.prototype.draw = function (dt) {
		const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
		const st = this.sim.state;
		this.drawBackground();
		// spawn effects from emergent state
		this.spawnEffects(dt);
		this.drawSeaAndFloor();
		this.drawBubbles(dt);
		// ship parts
		for (const p of st.parts) {
			if (p.kind === "hull") this.drawHull(p);
		}
		for (const cm of st.compartments) this.drawWater(cm);
		for (const p of st.parts) {
			if (p.kind === "hull") this.drawSuperstructure(p);
		}
		this.drawMasts();
		for (const p of st.parts) {
			if (p.kind === "funnel") this.drawFunnel(p, dt);
		}
		this.drawParticles(dt);
	};

	Renderer.prototype.drawBackground = function () {
		const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
		// brightened night sky so the scene is clearly visible
		const horizonScreen = this.w2s(0, 0).y;
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, "#0a1530");
		g.addColorStop(0.5, "#1c3358");
		g.addColorStop(1, "#33567f");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
		// stars (only above the horizon line on screen)
		if (!this._stars) {
			this._stars = [];
			for (let i = 0; i < 260; i++) this._stars.push({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.4 + 0.2, tw: Math.random() * 6.28 });
		}
		ctx.save();
		for (const s of this._stars) {
			const sy = s.y * H;
			if (sy > horizonScreen) continue;
			this.smokePhase += 0;
			const a = 0.5 + 0.5 * Math.sin(s.tw + performance.now() * 0.001);
			ctx.globalAlpha = 0.4 + 0.6 * a;
			ctx.fillStyle = "#dfe9ff";
			ctx.beginPath(); ctx.arc(s.x * W, sy, s.r * this.dpr, 0, 6.2832); ctx.fill();
		}
		ctx.restore();
		// moon
		const mx = W * 0.82, my = Math.min(H * 0.18, horizonScreen - 40 * this.dpr);
		if (my > 0) {
			const mr = 34 * this.dpr;
			const mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 2.6);
			mg.addColorStop(0, "rgba(255,250,235,0.95)");
			mg.addColorStop(0.25, "rgba(245,242,225,0.5)");
			mg.addColorStop(1, "rgba(245,242,225,0)");
			ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 2.6, 0, 6.2832); ctx.fill();
			ctx.fillStyle = "#fbf7ea"; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
		}
	};

	Renderer.prototype.drawSeaAndFloor = function () {
		const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
		const sea = this.w2s(0, this.C.SEA_LEVEL_Y).y;
		// underwater body
		const wg = ctx.createLinearGradient(0, sea, 0, H);
		wg.addColorStop(0, "rgba(28,86,120,0.86)");
		wg.addColorStop(0.4, "rgba(12,52,82,0.95)");
		wg.addColorStop(1, "rgba(3,18,34,1)");
		ctx.fillStyle = wg;
		ctx.fillRect(0, Math.max(0, sea), W, H - Math.max(0, sea));
		// sea surface line with slight shimmer
		ctx.strokeStyle = "rgba(180,220,240,0.5)"; ctx.lineWidth = 1.4 * this.dpr;
		ctx.beginPath(); ctx.moveTo(0, sea); ctx.lineTo(W, sea); ctx.stroke();
		// seafloor
		const fy = this.w2s(0, this.sim.state.seafloor.y).y;
		if (fy < H + 50) {
			const fg = ctx.createLinearGradient(0, fy - 30, 0, H);
			fg.addColorStop(0, "#2a2418"); fg.addColorStop(1, "#0d0b07");
			ctx.fillStyle = fg;
			ctx.beginPath(); ctx.moveTo(0, fy);
			for (let i = 0; i <= 20; i++) { const x = (i / 20) * W; ctx.lineTo(x, fy + Math.sin(i * 1.3) * 4 * this.dpr); }
			ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
		}
	};

	function screenPath(ctx, pts) {
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
		ctx.closePath();
	}

	Renderer.prototype.drawHull = function (p) {
		const ctx = this.ctx;
		const wv = T.worldVerts(p.body, p.local).map((v) => this.w2s(v.x, v.y));
		// black lower hull
		screenPath(ctx, wv);
		ctx.fillStyle = "#15171b"; ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1 * this.dpr; ctx.stroke();
		// red boot-topping stripe near the waterline (drawn as a thin band)
		const local = p.local;
		const topY = Math.max(...local.map((v) => v.y));
		const botY = Math.min(...local.map((v) => v.y));
		const bandLo = botY + (topY - botY) * 0.52, bandHi = botY + (topY - botY) * 0.6;
		this.fillLocalBand(p, bandLo, bandHi, "#6e2b22");
	};

	// fill the region of a part between two local-y fractions (world-aligned band)
	Renderer.prototype.fillLocalBand = function (p, loY, hiY, color) {
		const ctx = this.ctx;
		const local = p.local;
		const band = local.filter(() => true);
		// clip the local polygon to [loY, hiY] then transform
		let poly = T.clipBelow(local, hiY);
		poly = poly.map((v) => ({ x: v.x, y: -v.y }));
		poly = T.clipBelow(poly, -loY).map((v) => ({ x: v.x, y: -v.y }));
		if (poly.length < 3) return;
		const wv = T.worldVerts(p.body, poly).map((v) => this.w2s(v.x, v.y));
		screenPath(ctx, wv); ctx.fillStyle = color; ctx.fill();
	};

	Renderer.prototype.drawSuperstructure = function (p) {
		const ctx = this.ctx;
		const local = p.local;
		const topY = Math.max(...local.map((v) => v.y));
		const botY = Math.min(...local.map((v) => v.y));
		// white upper-hull / superstructure band
		this.fillLocalBand(p, botY + (topY - botY) * 0.6, topY, "#e9e6dd");
		// portholes: lit windows (warm) along the upper band
		const st = p.st;
		const n = Math.max(2, Math.round(st.len / 7));
		const wy = botY + (topY - botY) * 0.74;
		for (let i = 0; i < n; i++) {
			const lx = (st.local[0].x) + ((i + 0.5) / n) * (st.local[1].x - st.local[0].x);
			const w = T.worldVerts(p.body, [{ x: lx, y: wy }])[0];
			const s = this.w2s(w.x, w.y);
			// lights flicker out as the ship founders
			const on = !this.sim.state.brokenAt;
			ctx.fillStyle = on ? "rgba(255,214,130,0.95)" : "rgba(90,90,80,0.5)";
			ctx.fillRect(s.x - 1.1 * this.dpr, s.y - 1.1 * this.dpr, 2.2 * this.dpr, 2.2 * this.dpr);
		}
	};

	Renderer.prototype.drawWater = function (cm) {
		if (cm.volume <= 0) return;
		const ctx = this.ctx;
		const wv = T.worldVerts(cm.body, cm.st.comp);
		const below = T.clipBelow(wv, cm.surfaceY);
		if (below.length < 3) return;
		const pts = below.map((v) => this.w2s(v.x, v.y));
		screenPath(ctx, pts);
		ctx.fillStyle = "rgba(70,150,200,0.62)";
		ctx.fill();
		// bright surface line
		ctx.strokeStyle = "rgba(150,210,240,0.7)"; ctx.lineWidth = 1.2 * this.dpr; ctx.stroke();
	};

	Renderer.prototype.drawFunnel = function (p, dt) {
		const ctx = this.ctx;
		const wv = T.worldVerts(p.body, p.local).map((v) => this.w2s(v.x, v.y));
		screenPath(ctx, wv);
		ctx.fillStyle = "#caa14e"; ctx.fill(); // buff
		ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 1 * this.dpr; ctx.stroke();
		// black top band
		this.fillLocalBand(p, p.local[2].y - p.funnel.h * 0.16, p.local[2].y, "#1b1b1b");
		// smoke from upright, above-water funnels
		const top = T.worldVerts(p.body, [{ x: 0, y: p.funnel.h / 2 }])[0];
		const up = Math.cos(p.body.getAngle());
		if (top.y > 1 && up > 0.7 && !this.sim.state.brokenAt) {
			if (Math.random() < dt * 30) {
				this.particles.push({ kind: "smoke", x: top.x, y: top.y, vx: (Math.random() - 0.5) * 2 - 4, vy: 3 + Math.random() * 3, life: 1, max: 4 + Math.random() * 3, r: 3 });
			}
		}
	};

	Renderer.prototype.drawMasts = function () {
		const ctx = this.ctx;
		const sts = this.sim.stations;
		const fore = this.sim.state.parts.find((p) => p.kind === "hull" && p.st.idx === 3);
		const aft = this.sim.state.parts.find((p) => p.kind === "hull" && p.st.idx === 12);
		const drawMast = (p) => {
			if (!p) return;
			const top = Math.max(...p.local.map((v) => v.y));
			const base = T.worldVerts(p.body, [{ x: 0, y: top }])[0];
			const tip = T.worldVerts(p.body, [{ x: 0, y: top + 22 }])[0];
			const b = this.w2s(base.x, base.y), t = this.w2s(tip.x, tip.y);
			ctx.strokeStyle = "#3a2f25"; ctx.lineWidth = 1.6 * this.dpr;
			ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
		};
		drawMast(fore); drawMast(aft);
	};

	Renderer.prototype.spawnEffects = function (dt) {
		const st = this.sim.state;
		// splash when a fast body crosses the surface, bubbles from submerged hull
		for (const p of st.parts) {
			const pos = p.body.getPosition();
			const v = p.body.getLinearVelocity();
			const sp = Math.hypot(v.x, v.y);
			if (pos.y < -3 && pos.y > -800 && Math.random() < dt * 4 * Math.min(1, sp / 6)) {
				this.bubbles.push({ x: pos.x + (Math.random() - 0.5) * 30, y: pos.y, vy: 6 + Math.random() * 6, r: 0.4 + Math.random() * 1.2, life: 1 });
			}
		}
	};

	Renderer.prototype.drawBubbles = function (dt) {
		const ctx = this.ctx;
		ctx.save();
		for (let i = this.bubbles.length - 1; i >= 0; i--) {
			const b = this.bubbles[i];
			b.y += b.vy * dt * 8; b.life -= dt * 0.25;
			if (b.life <= 0 || b.y > 0) { this.bubbles.splice(i, 1); continue; }
			const s = this.w2s(b.x, b.y);
			ctx.globalAlpha = 0.35 * b.life;
			ctx.fillStyle = "#cfeaf5";
			ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.6, b.r * this.cam.scale * 0.3), 0, 6.2832); ctx.fill();
		}
		ctx.restore();
	};

	Renderer.prototype.drawParticles = function (dt) {
		const ctx = this.ctx;
		ctx.save();
		for (let i = this.particles.length - 1; i >= 0; i--) {
			const p = this.particles[i];
			p.x += p.vx * dt; p.y += p.vy * dt; p.life += dt;
			if (p.life > p.max) { this.particles.splice(i, 1); continue; }
			const s = this.w2s(p.x, p.y);
			const a = 1 - p.life / p.max;
			if (p.kind === "smoke") {
				ctx.globalAlpha = 0.28 * a;
				ctx.fillStyle = "#9aa0a6";
				const r = (p.r + p.life * 2.5) * this.cam.scale * 0.5;
				ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, r), 0, 6.2832); ctx.fill();
			}
		}
		ctx.restore();
	};

	root.TitanicRenderer = Renderer;
})(typeof self !== "undefined" ? self : this);
