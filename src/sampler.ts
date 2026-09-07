/**
 * Per-pixel displacement-field sampler.

 * @module sampler
 */

import {clamp} from './utils';
import type {CornerRadii, LiquidGlassResolvedOptions} from './types';
import type {LUT} from './surfaces';

/** erf via a 512-entry lookup table over [0, 4] with linear interpolation
 * (A&S 7.1.26 seed, ~1e-4 worst-case error after lerp) - plenty for
 * 8-bit alpha and far cheaper than a per-pixel special function. */
const ERF_N = 512;
const ERF_MAX = 4;
const ERF_TAB: Float32Array = (() => {
	const t = new Float32Array(ERF_N + 1);
	for (let i = 0; i <= ERF_N; i++) {
		const x = (i / ERF_N) * ERF_MAX;
		const s = x < 0 ? -1 : 1;
		const ax = Math.abs(x);
		const z = 1 / (1 + 0.3275911 * ax);
		const y =
			1 -
			((((1.061405429 * z - 1.453152027) * z + 1.421413741) * z - 0.284496736) * z + 0.254829592) *
				z *
				Math.exp(-ax * ax);
		t[i] = s * y;
	}
	return t;
})();

function erf(x: number): number {
	const ax = Math.abs(x);
	if (ax >= ERF_MAX) return x < 0 ? -1 : 1;
	const f = (ax / ERF_MAX) * ERF_N;
	const i = f | 0;
	const v = ERF_TAB[i] + (ERF_TAB[i + 1] - ERF_TAB[i]) * (f - i);
	return x < 0 ? -v : v;
}

/** Sampler output tuple: `[R, G, rimAlpha]` (alpha on a 0–1 scale). */
export type SampleOut = [number, number, number];
/** Per-pixel field sampler. */
export type Sampler = (x: number, y: number, out: SampleOut) => void;

/**
 * Create a per-pixel field sampler for one element geometry.
 *
 * The sampler is size-aware but *local*: for any point it only uses the
 * distance to the border and the inward normal, which is what makes
 * 9-slicing exact (corner fields depend only on the corner radius; edge
 * fields are uniform along the edge axis).
 *
 * @param res Bake resolution multiplier - the rim's analytic
 *        anti-aliasing integrates over a footprint derived from it.
 * @returns `sample(x, y, out)` - writes `out[0] = R`, `out[1] = G`,
 *   `out[2] = rimAlpha` (0–1 scale).
 */
export function makeSampler(
	W: number,
	H: number,
	radii: CornerRadii,
	o: LiquidGlassResolvedOptions,
	lut: LUT,
	res: number,
): Sampler {
	const {N, bezel, disp, maxAbs} = lut;
	const cx = W / 2,
		cy = H / 2,
		hw = W / 2,
		hh = H / 2;

	// Rim light: thin directional line, ~1.5–2px, lit only on the side
	// facing the light (inward normal · light direction).
	const aRad = (o.specular.angle * Math.PI) / 180;
	const Lx = Math.cos(aRad),
		Ly = Math.sin(aRad); // light travel direction
	const rimW = Math.max(0.5, o.specular.width || 1.6);
	const rimPeak = rimW * 0.6; // peak position from edge
	const rimSigma = rimW * 0.33; // Gaussian half-width
	const INV_SIGMA_SQRT2 = 1 / (rimSigma * Math.SQRT2);
	const HALF_SAMPLE = 0.5 / res; // half a bake sample, CSS px

	// Width of the magnitude + direction hand-off between the two candidate
	// edges around the 45° medial diagonal (see below). A fixed fraction of
	// the bezel. With the smooth-min rounding the magnitude as well as the
	// direction, a wider band is purely smoother; it stays a small fraction
	// of the bezel so the deviation never reads as its own feature.
	const blendW = Math.max(2, bezel / 6);

	return function sample(x: number, y: number, out: SampleOut): void {
		const ax = Math.abs(x - cx);
		const ay = Math.abs(y - cy);
		const sx = x < cx ? -1 : 1;
		const sy = y < cy ? -1 : 1;
		const dx = hw - ax;
		const dy = hh - ay;

		const r = sy < 0 ? (sx < 0 ? radii.tl : radii.tr) : sx < 0 ? radii.bl : radii.br;
		const qx = ax - (hw - r.rx);
		const qy = ay - (hh - r.ry);

		// Distance to the border `d` (0 at the edge, growing inward) and the
		// inward unit vector (ux, uy) at this pixel.
		let d: number, ux: number, uy: number;
		if (r.rx > 0 && r.ry > 0 && qx > 0 && qy > 0) {
			// Rounded corner: work in radius-normalized elliptical space.
			const nx = qx / r.rx,
				ny = qy / r.ry;
			const rn = Math.sqrt(nx * nx + ny * ny);
			const dist = Math.sqrt(qx * qx + qy * qy);
			d = rn > 1e-4 ? ((1 - rn) * dist) / rn : Math.max(r.rx, r.ry);
			const gx = qx / (r.rx * r.rx),
				gy = qy / (r.ry * r.ry);
			const gl = Math.sqrt(gx * gx + gy * gy) || 1e-6;
			ux = -sx * (gx / gl);
			uy = -sy * (gy / gl);
		} else {
			// Distance: smooth-min of the two axis distances. A hard `min()`
			// has a tent apex exactly on the 45° medial diagonal - the normal
			// blend below rotates the direction, but the magnitude still
			// kinked, which read as a faint diagonal line on strong-slope
			// profiles (convex circle). The polynomial smooth-min rounds the
			// apex while staying EXACT outside the band (|dx − dy| ≥ k), so
			// edge strips and 9-slice seams keep their untouched fields.
			const k = blendW;
			const h = clamp(0.5 + (0.5 * (dy - dx)) / k, 0, 1);
			d = dy + (dx - dy) * h - k * h * (1 - h);
			// Smooth hand-off between the two candidate edges around the 45°
			// diagonal - the "medial axis" where the nearest border flips
			// from a vertical edge (dx) to a horizontal one (dy). Picking one
			// edge hard makes the displacement direction jump 90° across that
			// diagonal; once the bezel extends past the corner tangent box
			// (bezel > radius) the active field reaches it and the jump
			// renders as a sharp crease running diagonally out of the corner.
			// Blending the two inward normals - weighted by a sigmoid on the
			// distance gap - rotates the direction smoothly through the
			// diagonal, like a real swept bezel would. The blend width shrinks
			// with depth (→ 0 at the bezel end): on an edge strip, whose own
			// edge is exactly `bezel` away, the weight stays a constant
			// σ(−12) - utterly negligible, so strips and 9-slice exactness
			// are unaffected.
			const w0 = blendW * (1 - (d >= bezel ? 1 : d / bezel)) + 1e-3;
			const wX = 1 / (1 + Math.exp(-(dy - dx) / w0)); // left/right edge
			const wY = 1 - wX; // top/bottom edge
			const bx = wX * -sx,
				by = wY * -sy;
			const bl = Math.sqrt(bx * bx + by * by) || 1e-6;
			ux = bx / bl;
			uy = by / bl;
		}

		let R: number = 128,
			G: number = 128,
			spec = 0;
		if (d >= 0) {
			const t = d >= bezel ? 1 : d / bezel;
			const ti = t * (N - 1);
			const i0 = ti | 0;
			const i1 = Math.min(N - 1, i0 + 1);
			const fr = ti - i0;

			// Displacement vector, normalised (inward for convex surfaces).
			// Float on purpose - bakeTile quantizes to 8-bit WITH dither.
			const mag = (disp[i0] + (disp[i1] - disp[i0]) * fr) / maxAbs;
			R = clamp(128 + 127 * mag * ux, 0, 255);
			G = clamp(128 + 127 * mag * uy, 0, 255);

			// Rim: thin Gaussian line at the border, one-sided toward the
			// light. ANALYTIC ANTI-ALIASING: the Gaussian is integrated over
			// the pixel's footprint along the border normal (half-sample wide,
			// stretched by |ux|+|uy| on diagonals) instead of point-sampled -
			// exact area coverage keeps the arc smooth at any bake resolution.
			// Normalized so a fully-covered peak keeps the designed intensity.
			const facing = ux * Lx + uy * Ly;
			if (facing > 0) {
				const h = (Math.abs(ux) + Math.abs(uy)) * HALF_SAMPLE; // footprint half-extent
				const dd = d - rimPeak;
				const cov =
					(erf((dd + h) * INV_SIGMA_SQRT2) - erf((dd - h) * INV_SIGMA_SQRT2)) / (2 * erf(h * INV_SIGMA_SQRT2) || 1e-6);
				spec = 0.85 * facing * cov;
			}
		}
		out[0] = R;
		out[1] = G;
		out[2] = spec;
	};
}
