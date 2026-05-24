// Auto-framing camera. Each frame it computes the axis-aligned bounding box
// of every fragment of the ship that's still relevant, pads it, and converts
// the bbox to a (zoom, offset) that maps world meters to canvas pixels.
//
// The camera smooths zoom + pan to avoid jitter while the ship rolls.

export class Camera {
	constructor() {
		this.zoom = 1;
		this.targetZoom = 1;
		this.cx = 0;
		this.cy = 0;
		this.targetCx = 0;
		this.targetCy = 0;
		this.smoothing = 0.05;
		this.minZoomCap = 0.05;
		this.maxZoomCap = 12;
	}

	update(ship, canvasW, canvasH) {
		// Gather positions of all ship parts.
		const parts = [
			...ship.hullSegments.map(h => h.body),
			...ship.compartments.map(c => c.body),
			...ship.funnels.map(f => f.body),
		];
		let minX = +Infinity, maxX = -Infinity, minY = +Infinity, maxY = -Infinity;
		for (const b of parts) {
			const bb = b.bounds;
			if (bb.min.x < minX) minX = bb.min.x;
			if (bb.max.x > maxX) maxX = bb.max.x;
			if (bb.min.y < minY) minY = bb.min.y;
			if (bb.max.y > maxY) maxY = bb.max.y;
		}
		// Always include a bit of sea surface so the viewer has visual context.
		if (minY > -30) minY = -30;
		// And a bit below the deepest piece.
		const padY = (maxY - minY) * 0.08 + 10;
		const padX = (maxX - minX) * 0.06 + 10;
		const bbW = (maxX - minX) + padX * 2;
		const bbH = (maxY - minY) + padY * 2;
		const bbCx = (minX + maxX) / 2;
		const bbCy = (minY + maxY) / 2;

		const zoomFit = Math.min(canvasW / bbW, canvasH / bbH);
		this.targetZoom = Math.max(this.minZoomCap, Math.min(this.maxZoomCap, zoomFit));
		this.targetCx = bbCx;
		this.targetCy = bbCy;

		// Stronger smoothing when the bbox jumps a lot (e.g. fragments fly apart).
		const dz = Math.abs(this.targetZoom - this.zoom) / Math.max(this.zoom, 1e-6);
		const k = dz > 0.4 ? 0.12 : this.smoothing;
		this.zoom += (this.targetZoom - this.zoom) * k;
		this.cx   += (this.targetCx   - this.cx) * k;
		this.cy   += (this.targetCy   - this.cy) * k;
	}

	applyTo(ctx, canvasW, canvasH) {
		ctx.setTransform(this.zoom, 0, 0, this.zoom,
			canvasW / 2 - this.cx * this.zoom,
			canvasH / 2 - this.cy * this.zoom);
	}

	worldToScreen(wx, wy, canvasW, canvasH) {
		return {
			x: canvasW / 2 + (wx - this.cx) * this.zoom,
			y: canvasH / 2 + (wy - this.cy) * this.zoom,
		};
	}
}
