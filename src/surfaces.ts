/**
 * Surface profiles (bezel cross-sections) and the Snell–Descartes
 * lookup tables derived from them.

 * @module surfaces
 */

import {clamp} from './utils';
import type {LiquidGlassResolvedOptions, LiquidGlassSurface, SurfaceName} from './types';

/** Apple-like soft transition; the default. */
const CONVEX_SQUIRCLE: LiquidGlassSurface = {
	f: (t) => Math.pow(1 - Math.pow(1 - t, 4), 0.25),
	fp: (t) => {
		const u = 1 - t;
		return (u * u * u) / Math.max(Math.pow(1 - u * u * u * u, 0.75), 1e-6);
	},
};

/**
 * Registry of surface profiles by name. Seeded with the four built-ins;
 * extended at runtime via {@link registerSurface}.
 */
const SURFACES = new Map<SurfaceName, LiquidGlassSurface>([
	['convex-squircle', CONVEX_SQUIRCLE],
	// Simple circular arc; sharper refraction at the bezel end.
	[
		'convex-circle',
		{
			f: (t) => 1 - (1 - t) * (1 - t),
			fp: (t) => 2 * (1 - t),
		},
	],
	/**
	 * Bowl-like depression; rays diverge past the element edge (content
	 * just inside the border is magnified).
	 *
	 * The thickness envelope matches convex-circle (full at the border,
	 * decaying to zero) while the slope is negated (bowl): rays bend
	 * *outward*. The border-peaked, monotonic envelope is deliberate -
	 * displacement peaks in the middle of the bezel overlap the corner
	 * arcs, where the inward normal rotates through 90° and shears the
	 * backdrop into diagonal creases.
	 */
	[
		'concave',
		{
			f: (t) => 1 - (1 - t) * (1 - t),
			fp: (t) => -2 * (1 - t),
		},
	],
	/**
	 * Raised rim with a shallow centre dip (Apple's Switch look).
	 *
	 * Same border-peaked thickness envelope; the slope starts strong and
	 * inward (the raised rim hugging the border), then flips gently
	 * outward for the shallow dip before dying out at the bezel end. The
	 * decaying envelope keeps the outward lobe soft, so the sign flip
	 * stays crease-free at the corners.
	 */
	[
		'lip',
		{
			f: (t) => 1 - (1 - t) * (1 - t),
			fp: (t) => {
				const u = 1 - t;
				const c = 1 - u * u;
				const ss = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
				const dss = 30 * t * t * (t - 1) * (t - 1);
				return 2 * u * (1 - 2 * ss) + (1 - 2 * c) * dss;
			},
		},
	],
]);

/**
 * Register (or replace) a named bezel profile. Elements can then select it
 * with `surface: <name>`; the name becomes part of the bake signature, so
 * different profiles never share cached tiles.
 *
 * ```ts
 * registerSurface('prism', {
 *   f: (t) => 1 - (1 - t) * (1 - t),
 *   fp: (t) => 6 * (1 - t) * t,   // example: bulge mid-bezel
 * });
 * ```
 */
export function registerSurface(name: string, surface: LiquidGlassSurface): void {
	SURFACES.set(name, surface);
}

/** Names of all registered surface profiles (built-ins first). */
export function listSurfaces(): SurfaceName[] {
	return Array.from(SURFACES.keys());
}

/** Snell–Descartes lookup tables along the bezel. */
export interface LUT {
	N: number;
	bezel: number;
	/** displacement (px), > 0 = inward */
	disp: Float32Array;
	/** surface slope dy/dx at t */
	slope: Float32Array;
	maxAbs: number;
}

/**
 * Snell–Descartes lookup tables along the bezel (the article's symmetry
 * observation: one "half slice" suffices, rotated around the border).
 *
 * Displacement is maximal at the border (full glass thickness at t = 0)
 * and decays to neutral at the bezel end (t = 1).
 */
export function computeLUT(o: LiquidGlassResolvedOptions, bezel: number, thickness: number): LUT {
	const N = 128;
	const disp = new Float32Array(N);
	const slope = new Float32Array(N);
	const S = SURFACES.get(o.surface) ?? CONVEX_SQUIRCLE;
	const eta = 1 / Math.max(1.0001, o.ior);

	for (let i = 0; i < N; i++) {
		const t = i / (N - 1);
		const fp = S.fp(t);
		// Ray path through the glass: full thickness at the border (t = 0),
		// decaying to zero at the bezel end (t = 1) - this makes refraction
		// reach the element edge, matching the reference implementation.
		const hPx = (1 - S.f(t)) * thickness;
		const s = clamp(fp * (thickness / bezel), -1e3, 1e3); // slope in px/px
		const cos1 = 1 / Math.sqrt(1 + s * s);
		const sin1 = Math.abs(s) * cos1;
		const sin2 = Math.min(1, sin1 * eta);
		const cos2 = Math.sqrt(1 - sin2 * sin2);
		const k = eta * cos1 - cos2;
		const rx = k * (-s * cos1);
		const ry = -eta + k * cos1;
		disp[i] = ry < -1e-6 ? (rx * hPx) / -ry : 0;
		slope[i] = s;
	}
	let maxAbs = 0;
	for (let i = 0; i < N; i++) maxAbs = Math.max(maxAbs, Math.abs(disp[i]));
	return {N, bezel, disp, slope, maxAbs: Math.max(maxAbs, 1e-4)};
}
