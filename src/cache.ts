/**
 * Slice-tile cache: one bake per distinct shape, shared across elements.

 * @module cache
 */

import type {CornerRadii, LiquidGlassResolvedOptions, LiquidGlassTiles} from './types';
import {resolveBezel, resolveOptions} from './options';
import {bakeSignature, resolveRenderScale, tileExtent, tileKey} from './geometry';
import {renderTiles} from './bake';

/**
 * Bake key → tile set. Corner/strip tiles depend on the
 * corner radii, the per-side span classes and the bake options — but NOT
 * on the element size — so every element whose key matches reuses an
 * existing bake instead of re-rendering it. (The `<filter>` DOM itself
 * stays per element: tile *positions* differ per size.)
 */
const tileCache = new Map<string, LiquidGlassTiles>();
/** Upper bound on cached tile sets (FIFO eviction; entries are small). */
const TILE_CACHE_MAX = 24;

/**
 * Fetch (or bake and cache) the 9-slice tile set for an element geometry.
 * The key is the tile key (radii + span classes) plus the bake signature
 * (profile, resolved bezel/thickness, rim shaping) — two elements share a
 * cached set iff their tiles would be pixel-identical. Note that
 * `'auto'` bezel/thickness resolve per size, so differently-sized auto
 * elements correctly get separate entries.
 */
export function getTiles(radii: CornerRadii, o: LiquidGlassResolvedOptions, W: number, H: number): LiquidGlassTiles {
	const {bezel, thickness} = resolveBezel(o, W, H);
	const res = resolveRenderScale(o, W, H, tileExtent(radii, bezel));
	const key = tileKey(radii, W, H, bezel) + '|' + bakeSignature(o, bezel, thickness, res);
	let tiles = tileCache.get(key);
	if (!tiles) {
		tiles = renderTiles({
			radii,
			options: resolveOptions(o, {bezel, thickness}),
			width: W,
			height: H,
		});
		tileCache.set(key, tiles);
		if (tileCache.size > TILE_CACHE_MAX) {
			tileCache.delete(tileCache.keys().next().value!);
		}
	}
	return tiles;
}
