/**
 * LiquidGlass - Apple-style "Liquid Glass" refraction for any DOM element.
 *
 * Implements the technique described in
 * https://kube.io/blog/liquid-glass-css-svg/ :
 *
 *  1. A bezel profile (surface height function) describes the glass curvature
 *     from the element border (t = 0, full thickness) to the end of the bezel
 *     (t = 1, flat). Displacement is therefore maximal at the element edge and
 *     decays to neutral (no displacement) in the interior.
 *  2. Snell–Descartes law converts the local surface slope + glass thickness
 *     into a pixel displacement magnitude, pre-computed once per profile into
 *     a 128-step lookup table.
 *  3. The displacement vector field is baked into an **opaque** PNG
 *     (R = X axis, G = Y axis, 128 = neutral). Alpha MUST stay fully opaque:
 *     canvases store pixels premultiplied by alpha, so any transparent pixel
 *     would corrupt the R/G channels and shatter the effect.
 *  4. The specular rim is a razor-thin (~1.6px) directional line baked into a
 *     separate gray-on-alpha PNG: only the border facing the light gets a
 *     line. Inside the SVG filter that line masks a hyper-saturated copy of
 *     the refracted backdrop (`feComposite in`), plus a faint gray glint on
 *     top (`feComponentTransfer` fade) - both blended `normal`.
 *  5. An SVG filter chain (blur → feImage → feDisplacementMap → rim
 *     compositing) is referenced from `backdrop-filter: url(#id)` so the
 *     element refracts whatever is painted beneath it.
 *
 * The effect is assembled 9-slice style: size-independent corner/edge
 * tiles are baked once per shape (corner radii + bake options - cached and
 * shared across elements), then re-positioned as pure filter-attribute
 * updates whenever the element resizes, so animated widths/heights (hover
 * stretches, transitions) never trigger a re-bake. Re-bakes (throttled)
 * happen only when the resolved radii change or a straight span crosses
 * the bezel width; `'auto'` bezel/thickness freeze at their first
 * resolution.
 *
 * Elements created with the same `filterId` share one baked filter: a
 * single bake and one `<filter>` node serve any number of identical
 * elements (each still refracts its own backdrop).
 *
 * Browser support: SVG filters referenced from `backdrop-filter` currently
 * work only in Chromium. Unsupported browsers get a plain CSS `backdrop-filter`
 * fallback. Everything runs from `file://`; no dependencies.
 *
 * Source layout: `types` (public types) · `options` · `surfaces` ·
 * `sampler` · `bake` · `cache` · `geometry` · `svg` · `filter` ·
 * `controller` - everything below the controller is pure (or canvas-only)
 * and unit-testable in isolation.
 *
 * @module liquid-glass
 * @license MIT
 */

import type {
	GenerateMapsParams,
	GenerateTilesParams,
	LiquidGlassMaps,
	LiquidGlassOptions,
	LiquidGlassTiles,
} from './types';
import {DEFAULT_OPTIONS, resolveOptions} from './options';
import {renderMaps, renderTiles} from './bake';
import {checkSvgBackdropSupport} from './support';
import {LiquidGlass} from './controller';

export * from './types';
export {LiquidGlass} from './controller';
export {registerSurface, listSurfaces} from './surfaces';
export {createFilter} from './static-filter';
export type {CreateFilterParams, StaticFilter} from './static-filter';
/**
 * Create a liquid-glass effect on one element.
 *
 * @example
 * ```ts
 * import { create } from '@goran.alkovic/liquid-glass';
 * create(document.querySelector('.card')!, { surface: 'convex-squircle' });
 * ```
 */
export function create(el: HTMLElement, opts?: LiquidGlassOptions): LiquidGlass {
	return new LiquidGlass(el, opts);
}

/**
 * Create effects for every element matching `selector`
 * (default `[data-liquid-glass]`), sharing one options object.
 */
export function applyAll(selector?: string, opts?: LiquidGlassOptions): LiquidGlass[] {
	return Array.from(document.querySelectorAll<HTMLElement>(selector || '[data-liquid-glass]')).map(
		(el) => new LiquidGlass(el, opts),
	);
}

/**
 * Generate maps standalone (no element, filter or observers) - useful
 * for testing, inspection or custom compositing.
 *
 * @throws {Error} If neither `radii` nor `borderRadius` is given.
 */
export function generateMaps(params: GenerateMapsParams): LiquidGlassMaps {
	const {width, height, radii, borderRadius, options} = params;
	const o = resolveOptions(DEFAULT_OPTIONS, options);
	const base = typeof borderRadius === 'number' ? {rx: borderRadius, ry: borderRadius} : null;
	const rr = base ? {tl: base, tr: base, br: base, bl: base} : radii;
	if (!rr) throw new Error('generateMaps: radii or borderRadius required');
	return renderMaps({width, height, radii: rr, options: o});
}

/**
 * Generate size-independent 9-slice tiles standalone (no element, filter
 * or observers) - one bake per border radius, reusable across sizes.
 *
 * @throws {Error} If neither `radii` nor `borderRadius` is given.
 */
export function generateTiles(params: GenerateTilesParams): LiquidGlassTiles {
	const {radii, borderRadius, width, height, options} = params;
	const o = resolveOptions(DEFAULT_OPTIONS, options);
	const base = typeof borderRadius === 'number' ? {rx: borderRadius, ry: borderRadius} : null;
	const rr = base ? {tl: base, tr: base, br: base, bl: base} : radii;
	if (!rr) throw new Error('generateTiles: radii or borderRadius required');
	return renderTiles({radii: rr, options: o, width: width ?? 200, height: height ?? 200});
}

/**
 * Whether SVG backdrop-filters work in this browser. Lazy and cached -
 * call it (don't read it) so early-load false negatives can recover.
 */
export function isSupported(): boolean {
	return checkSvgBackdropSupport();
}

/** Library version. */
export const version = '1.0.0';
