/**
 * Geometry helpers: border-radius resolution, tile keys and the
 * bake-resolution policy.

 * @module geometry
 */

import {clamp} from './utils';
import type {CornerKey, CornerRadii, LiquidGlassResolvedOptions, Radius} from './types';
/** Parse one border-radius token ("12px" | "50%") against the relevant
 * box dimension (px). */
function parseRadiusToken(tok: string, full: number): number {
	const n = parseFloat(tok) || 0;
	return tok.indexOf('%') >= 0 ? (n * full) / 100 : n;
}
/**
 * Per-corner border radii in CSS pixels, as elliptical {rx, ry} pairs.
 *
 * Computed style is not directly usable:
 *  - percentages are NOT resolved (e.g. "50%"), so they are resolved here
 *    (rx against width, ry against height);
 *  - elliptical corners are reported as "Rx Ry" or "Rx / Ry";
 *  - when adjacent radii overflow a side, the CSS paint scales all radii
 *    uniformly - computed style reports the unscaled values, so the same
 *    scaling is mirrored here.
 */
export function resolveRadii(el: Element, W: number, H: number): CornerRadii {
	const cs = getComputedStyle(el);
	const parse = (value: string): Radius => {
		const parts = String(value)
			.trim()
			.split(/\s*\/\s*|\s+/)
			.filter(Boolean);
		const rx = parts.length ? parseRadiusToken(parts[0], W) : 0;
		const ry = parts.length > 1 ? parseRadiusToken(parts[1], H) : rx;
		return {rx: Math.max(0, rx), ry: Math.max(0, ry)};
	};
	const c: CornerRadii = {
		tl: parse(cs.borderTopLeftRadius),
		tr: parse(cs.borderTopRightRadius),
		br: parse(cs.borderBottomRightRadius),
		bl: parse(cs.borderBottomLeftRadius),
	};
	const f = Math.min(
		1,
		W / Math.max(1e-6, c.tl.rx + c.tr.rx),
		W / Math.max(1e-6, c.bl.rx + c.br.rx),
		H / Math.max(1e-6, c.tl.ry + c.bl.ry),
		H / Math.max(1e-6, c.tr.ry + c.br.ry),
	);
	if (f < 1) {
		for (const k of Object.keys(c) as CornerKey[]) {
			c[k].rx *= f;
			c[k].ry *= f;
		}
	}
	return c;
}

/**
 * Stable key describing the resolved corner radii. Used together with the
 * raw size to route geometry changes: size-only changes are cheap
 * re-layouts; radius changes require re-baking.
 */
export function radiusKey(r: CornerRadii): string {
	return [r.tl, r.tr, r.br, r.bl].map((q) => q.rx.toFixed(2) + ',' + q.ry.toFixed(2)).join('|');
}

/**
 * Straight edge spans between the corner tangent boxes, in px. A span of 0
 * means the tangent boxes meet (wrapped: pill ends, circles).
 */
export function straightSpans(
	W: number,
	H: number,
	r: CornerRadii,
): {top: number; bottom: number; left: number; right: number} {
	return {
		top: Math.max(0, W - r.tl.rx - r.tr.rx),
		bottom: Math.max(0, W - r.bl.rx - r.br.rx),
		left: Math.max(0, H - r.tl.ry - r.bl.ry),
		right: Math.max(0, H - r.tr.ry - r.br.ry),
	};
}

/**
 * Tile-bake key: radii plus the span CLASS of each side (span ≥ bezel or
 * not). Within one class the baked tiles are exact for any size; crossing
 * a class (e.g. square → rectangle, or growing past the wrap point)
 * requires a re-bake because the seam-band field changes character.
 */
export function tileKey(r: CornerRadii, W: number, H: number, bezel: number): string {
	const s = straightSpans(W, H, r);
	return radiusKey(r) + '|' + [s.top, s.bottom, s.left, s.right].map((v) => (v >= bezel ? 1 : 0)).join('');
}

/**
 * Normalize a user-supplied `filterId` into a DOM-safe id, or null when
 * absent/empty.
 */
export function sanitizeFilterId(raw: string | number | null | undefined): string | null {
	if (raw == null) return null;
	const s = String(raw)
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '-');
	return s || null;
}

/**
 * Largest baked tile dimension for a geometry: the biggest corner extent
 * (radius + bezel) in px. Tiles are the only size-scaled bitmaps left,
 * so this - not the element's width/height - is what bake cost follows.
 */
export function tileExtent(radii: CornerRadii, bezel: number): number {
	let m = 0;
	for (const k of Object.keys(radii) as CornerKey[]) {
		m = Math.max(m, radii[k].rx + bezel, radii[k].ry + bezel);
	}
	return m;
}

/**
 * Resolve the effective bake resolution multiplier - the quality knob.
 *
 * `'auto'` scales with **how large the element renders** (geometric mean
 * of its w×h): tiny chips read clean at 0.75× - at that size the
 * softness is imperceptible and the bake is nearly free - while large
 * surfaces climb to 2×, where the effect covers enough screen area for
 * detail to matter. Element size, not devicePixelRatio, drives this:
 * DPR varies wildly across devices while the perceived difference
 * between 1× and 2× on a small phone screen is negligible, making
 * density a misleading - and costly - quality signal.
 *
 * The tiers sit exactly on the display grid (0.75×, 1×, 1.5×, 2×). An
 * earlier experiment offset them 5% off-grid so the display's bilinear
 * resampling would decorrelate residual dither grain - but the constant
 * misalignment itself read as shimmer/glitches on the displaced content,
 * so grid-aligned tiers won.
 *
 * Bake cost itself is capped by the tile extent (max corner radius +
 * bezel): small tiles may exceed the 2× default cap, large ones never
 * do. Explicit numbers are the override and clamp to [0.5, 4].
 *
 * @param tileExtentPx Largest tile dimension (px); omitted →
 *        conservative 2× cap (used for the full-size debug map).
 */
export function resolveRenderScale(
	o: LiquidGlassResolvedOptions,
	W: number,
	H: number,
	tileExtentPx = Infinity,
): number {
	if (o.renderScale !== 'auto') return clamp(o.renderScale || 1, 0.5, 4);
	const dim = Math.sqrt(Math.max(1, W) * Math.max(1, H)); // avg dimension
	const base = dim <= 150 ? 0.75 : dim <= 300 ? 1 : dim <= 450 ? 1.5 : 2;
	const cap = tileExtentPx <= 72 ? 3 : tileExtentPx <= 144 ? 2.5 : 2;
	return clamp(base, 0.75, cap);
}

/**
 * Signature of everything that changes the *bake* (tiles) - used to
 * decide whether an element may attach to an existing shared filter or
 * reuse cached tiles. Resolved bezel/thickness and the resolved render
 * scale are included so two same-size elements with different explicit
 * values (or a display whose DPR changed) don't falsely match.
 */
export function bakeSignature(o: LiquidGlassResolvedOptions, bezel: number, thickness: number, res: number): string {
	const sp = o.specular;
	return [o.surface, o.ior, res, bezel.toFixed(2), thickness.toFixed(2), sp.angle, sp.width, sp.gray].join('|');
}
