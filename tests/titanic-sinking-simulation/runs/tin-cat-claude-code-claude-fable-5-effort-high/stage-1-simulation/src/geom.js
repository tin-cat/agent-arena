// 2D polygon utilities. Polygons are arrays of {x, y}, counter-clockwise.

export function polyArea(poly) {
	let a = 0;
	for (let i = 0, n = poly.length; i < n; i++) {
		const p = poly[i], q = poly[(i + 1) % n];
		a += p.x * q.y - q.x * p.y;
	}
	return a / 2;
}

export function polyCentroid(poly) {
	let a = 0, cx = 0, cy = 0;
	for (let i = 0, n = poly.length; i < n; i++) {
		const p = poly[i], q = poly[(i + 1) % n];
		const cross = p.x * q.y - q.x * p.y;
		a += cross;
		cx += (p.x + q.x) * cross;
		cy += (p.y + q.y) * cross;
	}
	a /= 2;
	if (Math.abs(a) < 1e-9) {
		// degenerate: average the vertices
		let sx = 0, sy = 0;
		for (const p of poly) { sx += p.x; sy += p.y; }
		return { x: sx / poly.length, y: sy / poly.length, area: 0 };
	}
	return { x: cx / (6 * a), y: cy / (6 * a), area: a };
}

// Second polar moment of area about the centroid (Ix + Iy), per unit area
// density. Used to build mass moments of inertia: I = mass * (J / area).
export function polySecondMoment(poly) {
	const c = polyCentroid(poly);
	let ix = 0, iy = 0, a = 0;
	for (let i = 0, n = poly.length; i < n; i++) {
		const p = { x: poly[i].x - c.x, y: poly[i].y - c.y };
		const q = { x: poly[(i + 1) % n].x - c.x, y: poly[(i + 1) % n].y - c.y };
		const cross = p.x * q.y - q.x * p.y;
		a += cross / 2;
		ix += cross * (p.y * p.y + p.y * q.y + q.y * q.y);
		iy += cross * (p.x * p.x + p.x * q.x + q.x * q.x);
	}
	if (Math.abs(a) < 1e-9) return { J: 0, area: 0 };
	return { J: (ix + iy) / 12, area: a };
}

// Clip a polygon, keeping the part with y <= Y (Sutherland-Hodgman against
// a horizontal half-plane). Returns [] if fully above.
export function clipBelowY(poly, Y) {
	const out = [];
	for (let i = 0, n = poly.length; i < n; i++) {
		const p = poly[i], q = poly[(i + 1) % n];
		const pin = p.y <= Y, qin = q.y <= Y;
		if (pin) out.push(p);
		if (pin !== qin) {
			const t = (Y - p.y) / (q.y - p.y);
			out.push({ x: p.x + t * (q.x - p.x), y: Y });
		}
	}
	return out.length >= 3 ? out : [];
}

// Width of the polygon projected onto the axis perpendicular to unit
// direction (dx, dy). Used as the drag reference width.
export function projectedWidth(poly, dx, dy) {
	let lo = Infinity, hi = -Infinity;
	for (const p of poly) {
		const s = -dy * p.x + dx * p.y;
		if (s < lo) lo = s;
		if (s > hi) hi = s;
	}
	return Math.max(0, hi - lo);
}

// Shrink a polygon toward its centroid by factor f (0..1).
export function shrinkPoly(poly, f) {
	const c = polyCentroid(poly);
	return poly.map(p => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }));
}
