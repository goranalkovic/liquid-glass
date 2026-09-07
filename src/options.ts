/**
 * Default options and option resolution.

 * @module options
 */

import {clamp} from './utils';
import type {LiquidGlassOptions, LiquidGlassResolvedOptions} from './types';

export const DEFAULT_OPTIONS: Readonly<LiquidGlassResolvedOptions> = {
	surface: 'convex-squircle',
	bezel: 'auto',
	thickness: 'auto',
	ior: 1.5,
	scale: 1,
	saturate: 1,
	blur: 0.2,
	specular: {angle: 65, saturation: 6, opacity: 0.4, width: 1.6, gray: 120},
	filterId: null,
	renderScale: 'auto',
	throttleMs: 120,
	fallback: 'blur(10px) saturate(1.5)',
	debug: false,
	static: false,
	supportedClass: null,
	fallbackClass: null,
};

/**
 * Deep-merge (one level for `specular`) an option patch onto a
 * fully-resolved base.
 */
export function resolveOptions(
	base: LiquidGlassResolvedOptions,
	patch?: LiquidGlassOptions,
): LiquidGlassResolvedOptions {
	const out: LiquidGlassResolvedOptions = {...base, specular: {...base.specular}};
	if (!patch) return out;
	if (patch.surface !== undefined) out.surface = patch.surface;
	if (patch.bezel !== undefined) out.bezel = patch.bezel;
	if (patch.thickness !== undefined) out.thickness = patch.thickness;
	if (patch.ior !== undefined) out.ior = patch.ior;
	if (patch.scale !== undefined) out.scale = patch.scale;
	if (patch.saturate !== undefined) out.saturate = patch.saturate;
	if (patch.blur !== undefined) out.blur = patch.blur;
	if (patch.filterId !== undefined) out.filterId = patch.filterId;
	if (patch.renderScale !== undefined) out.renderScale = patch.renderScale;
	if (patch.throttleMs !== undefined) out.throttleMs = patch.throttleMs;
	if (patch.fallback !== undefined) out.fallback = patch.fallback;
	if (patch.debug !== undefined) out.debug = patch.debug;
	if (patch.static !== undefined) out.static = patch.static;
	if (patch.supportedClass !== undefined) out.supportedClass = patch.supportedClass;
	if (patch.fallbackClass !== undefined) out.fallbackClass = patch.fallbackClass;
	if (patch.specular) out.specular = {...out.specular, ...patch.specular};
	return out;
}

/**
 * Resolve the effective bezel / thickness in px for a given element size.
 * Reference proportions: bezel ≈ ⅓–⅖ of the smaller dimension (their pill
 * demos measure ~21px on 56–63px elements), capped for large elements.
 */
export function resolveBezel(o: LiquidGlassResolvedOptions, W: number, H: number): {bezel: number; thickness: number} {
	const bezel = o.bezel === 'auto' ? Math.min(48, Math.min(W, H) * 0.4) : clamp(o.bezel, 1, Math.min(W, H) / 2);
	const thickness = o.thickness === 'auto' ? bezel : Math.max(0.1, o.thickness);
	return {bezel, thickness};
}
