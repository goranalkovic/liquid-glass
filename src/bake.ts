/**
 * Canvas rasterization: displacement/specular PNG tiles and the
 * standalone full-size maps.

 * @module bake
 */

import {clamp} from './utils';
import type {
	CornerKey,
	CornerRadii,
	LiquidGlassMaps,
	LiquidGlassResolvedOptions,
	LiquidGlassTiles,
	Radius,
} from './types';
import {makeSampler, type SampleOut, type Sampler} from './sampler';
import {computeLUT} from './surfaces';
import {resolveBezel} from './options';
import {resolveRenderScale, straightSpans} from './geometry';

/**
 * Dither amplitude in channel levels (±½ = full 8-bit swing).
 */
const DITHER_SCALE = 1;

/**
 * Interleaved gradient noise (Jimenez) - an analytic blue-noise-ish
 * threshold field in [0, 1). Unlike a small Bayer tile it has no regular
 * repeating structure, so at equal amplitude the dither reads as fine
 * texture instead of a visible cross-hatch pattern.
 */
function ign(px: number, py: number): number {
	const f = 0.06711056 * px + 0.00583715 * py;
	const f1 = f - Math.floor(f); // fract
	return 52.9829189 * f1 - Math.floor(52.9829189 * f1);
}

/** Bake output for one tile. */
export interface BakedTile {
	mapDataUrl: string;
	specularDataUrl: string;
	debugDataUrl: string | null;
}

/**
 * Rasterize a sampler over a w×h (CSS px) tile into PNG data URLs.
 *
 * The displacement PNG is always FULLY OPAQUE (premultiplied canvas
 * storage would destroy the R/G channels of transparent pixels); the
 * specular PNG is constant gray with intensity in alpha.
 *
 * The R/G channels are quantized to 8-bit with a blue-noise dither
 * (interleaved gradient noise): `feDisplacementMap` reads the channels as
 * discrete levels, so plain rounding turns the smooth displacement field
 * into coherent terraces that render as stair-stepped edges in the
 * refracted content. The dither trades those staircases for fine
 * uncorrelated texture - resolution-independent (channel depth, not
 * spatial detail, is the limit). The exactly-neutral interior (128/128)
 * is left untouched so flat areas stay perfectly still.
 *
 * @param ss Supersample factor: render at `res × ss` and
 *        area-downsample back to `res`. Cheap AA for low bake
 *        resolutions (the JS sample loop is ~4×, but PNG encoding - the
 *        expensive part - stays at the small target size).
 */
export function bakeTile(
	sample: Sampler,
	w: number,
	h: number,
	res: number,
	rimGray: number,
	withDebug: boolean,
	ss = 1,
): BakedTile {
	const cw = Math.max(1, Math.round(w * res * ss));
	const ch = Math.max(1, Math.round(h * res * ss));
	const step = 1 / (res * ss);

	const mapCanvas = document.createElement('canvas');
	mapCanvas.width = cw;
	mapCanvas.height = ch;
	const mapCtx = mapCanvas.getContext('2d') as CanvasRenderingContext2D;
	const mapImg = mapCtx.createImageData(cw, ch);

	const specCanvas = document.createElement('canvas');
	specCanvas.width = cw;
	specCanvas.height = ch;
	const specCtx = specCanvas.getContext('2d') as CanvasRenderingContext2D;
	const specImg = specCtx.createImageData(cw, ch);

	let dbgCanvas: HTMLCanvasElement | null = null;
	let dbgCtx: CanvasRenderingContext2D | null = null;
	if (withDebug) {
		dbgCanvas = document.createElement('canvas');
		dbgCanvas.width = cw;
		dbgCanvas.height = ch;
		dbgCtx = dbgCanvas.getContext('2d');
	}
	const dbgImg = dbgCtx ? dbgCtx.createImageData(cw, ch) : null;

	const out: SampleOut = [0, 0, 0];
	let p = 0;
	for (let py = 0; py < ch; py++) {
		const y = (py + 0.5) * step;
		for (let px = 0; px < cw; px++, p += 4) {
			sample((px + 0.5) * step, y, out);

			// 8-bit quantization, dithered with blue noise (see JSDoc
			// above). The exactly-neutral interior is skipped so flat areas
			// stay perfectly still.
			const d = out[0] === 128 && out[1] === 128 ? 0 : (ign(px, py) - 0.5) * DITHER_SCALE;
			mapImg.data[p] = out[0] + d;
			mapImg.data[p + 1] = out[1] + d;
			mapImg.data[p + 2] = 128;
			mapImg.data[p + 3] = 255;

			const a = clamp(Math.round(out[2] * 255), 0, 255);
			specImg.data[p] = rimGray;
			specImg.data[p + 1] = rimGray;
			specImg.data[p + 2] = rimGray;
			specImg.data[p + 3] = a;

			if (dbgImg) {
				dbgImg.data[p] = out[0];
				dbgImg.data[p + 1] = out[1];
				dbgImg.data[p + 2] = a;
				dbgImg.data[p + 3] = 255;
			}
		}
	}

	mapCtx.putImageData(mapImg, 0, 0);
	specCtx.putImageData(specImg, 0, 0);
	if (dbgCtx && dbgImg) dbgCtx.putImageData(dbgImg, 0, 0);

	// Area-downsample the supersampled render (SSAA - see `ss`). Averages
	// the 2×2 sample quads, which also averages most of the dither grain.
	let mapOut: HTMLCanvasElement = mapCanvas;
	let specOut: HTMLCanvasElement = specCanvas;
	let dbgOut: HTMLCanvasElement | null = dbgCanvas;
	if (ss > 1) {
		const dw = Math.max(1, Math.round(w * res));
		const dh = Math.max(1, Math.round(h * res));
		const shrink = (src: HTMLCanvasElement): HTMLCanvasElement => {
			const c = document.createElement('canvas');
			c.width = dw;
			c.height = dh;
			const c2 = c.getContext('2d') as CanvasRenderingContext2D;
			c2.imageSmoothingEnabled = true;
			c2.imageSmoothingQuality = 'high';
			c2.drawImage(src, 0, 0, dw, dh);
			return c;
		};
		mapOut = shrink(mapCanvas);
		specOut = shrink(specCanvas);
		if (dbgOut && dbgCanvas) dbgOut = shrink(dbgCanvas);
	}

	return {
		mapDataUrl: mapOut.toDataURL('image/png'),
		specularDataUrl: specOut.toDataURL('image/png'),
		debugDataUrl: dbgOut ? dbgOut.toDataURL('image/png') : null,
	};
}

export interface MapsParams {
	width: number;
	height: number;
	radii: CornerRadii;
	options: LiquidGlassResolvedOptions;
}

/**
 * Generate the displacement and specular maps for a rectangle with
 * per-corner (elliptical) radii.
 *
 * Pure with respect to the DOM except for offscreen canvases, so it can be
 * unit-tested or reused in isolation via {@link generateMaps}.
 */
export function renderMaps({width: W, height: H, radii, options: o}: MapsParams): LiquidGlassMaps {
	const {bezel, thickness} = resolveBezel(o, W, H);
	const lut = computeLUT(o, bezel, thickness);
	const res = resolveRenderScale(o);
	const rimGray = clamp(Math.round(o.specular.gray || 120), 0, 255);
	// Supersample low bake resolutions (render above the target grid, then
	// area-downsample) - near-free AA where samples are sparse (the JS
	// sample loop is ~ss² but PNG encoding, the expensive part, stays at
	// the small target size). Tiered so dense grids don't balloon.
	const ss = res <= 1 ? 4 : res < 2 ? 2 : 1;
	const sample = makeSampler(W, H, radii, o, lut, res * ss);
	const baked = bakeTile(sample, W, H, res, rimGray, !!o.debug, ss);
	return {
		mapDataUrl: baked.mapDataUrl,
		specularDataUrl: baked.specularDataUrl,
		debugDataUrl: baked.debugDataUrl,
		maxDisplacement: lut.maxAbs,
		width: W,
		height: H,
	};
}

export interface TilesParams {
	radii: CornerRadii;
	options: LiquidGlassResolvedOptions;
	width: number;
	height: number;
}

/** Coordinate map: bake-tile pixel → virtual-element pixel. */
type MapFn = (x: number, y: number) => [number, number];
/** Corner coordinate map, with the virtual/tile extents available. */
type CornerMapFn = (x: number, y: number, vw: number, vh: number, tw: number, th: number) => [number, number];

/**
 * Generate size-independent 9-slice tiles for a border radius.
 *
 * Why this is *exact*: the field is a pure function of
 * (distance-to-border, inward normal). Each corner tile is baked by
 * sampling a **virtual element that mirrors the real element's end
 * geometry**: `width = 2·rx + straightSpan`, `height = 2·ry + straightSpan`
 * (straightSpan = the edge length between tangent boxes). When the
 * straight span is ≥ bezel, the tile is a plain corner + straight
 * continuation; when it wraps (pills, circles - tangent boxes meet at the
 * midline), the virtual element *is* the real end shape, so the wrapping
 * arc field is reproduced exactly and the opposite strips simply collapse
 * to zero length. Seams match analytically at tile/strip boundaries.
 *
 * Exact for uniform radii (rounded rects, pills, circles) - which
 * `resolveRadii`'s CSS overlap scaling produces for the common CSS
 * patterns. Mixed per-corner radii in a wrapped dimension fall back to a
 * mirrored approximation of the dominant corner.
 */
export function renderTiles({radii, options: o, width: W, height: H}: TilesParams): LiquidGlassTiles {
	const {bezel, thickness} = resolveBezel(o, W, H);
	const lut = computeLUT(o, bezel, thickness);
	const res = resolveRenderScale(o);
	const rimGray = clamp(Math.round(o.specular.gray || 120), 0, 255);
	// Supersample low bake resolutions (render above the target grid, then
	// area-downsample) - near-free AA where samples are sparse (the JS
	// sample loop is ~ss² but PNG encoding, the expensive part, stays at
	// the small target size). Tiered so dense grids don't balloon.
	const ss = res <= 1 ? 4 : res < 2 ? 2 : 1;
	const B = bezel;

	/** Bake one tile by sampling a virtual element through a coordinate map. */
	const bake = (vw: number, vh: number, vradii: CornerRadii, tw: number, th: number, mapFn: MapFn): BakedTile => {
		const sample = makeSampler(vw, vh, vradii, o, lut, res * ss);
		const wrapped: Sampler = (x, y, out) => {
			const v = mapFn(x, y);
			sample(v[0], v[1], out);
		};
		return bakeTile(wrapped, tw, th, res, rimGray, false, ss);
	};
	const R0: Radius = {rx: 0, ry: 0};
	const zero: CornerRadii = {tl: R0, tr: R0, br: R0, bl: R0};

	// Straight spans between the corner tangent boxes (0 = wrapped: pill
	// ends, circles - the tangent boxes meet at the midline). The TRUE
	// spans are used: the virtual element then reproduces the baked size's
	// field exactly, including seam bands where two corner fields meet at
	// the midline. Sizes whose span crosses the bezel (square → rectangle)
	// get their own bake - the tile key includes the span class of each
	// side, so the controller re-bakes on span-class changes.
	const spans = straightSpans(W, H, radii);

	// Corner tiles. Virtual element per corner = the mirrored end shape
	// (2·rx + span) × (2·ry + span) with uniform radii; the tile is the
	// corner-side half, clamped to rx + bezel when the span is long.
	const corners = {} as Record<CornerKey, {map: string; spec: string; w: number; h: number}>;
	const SPEC: Record<CornerKey, {sx: number; sy: number; map: CornerMapFn}> = {
		tl: {sx: spans.top, sy: spans.left, map: (x, y) => [x, y]},
		tr: {sx: spans.top, sy: spans.right, map: (x, y, vw, _vh, tw) => [vw - tw + x, y]},
		br: {
			sx: spans.bottom,
			sy: spans.right,
			map: (x, y, vw, vh, tw, th) => [vw - tw + x, vh - th + y],
		},
		bl: {sx: spans.bottom, sy: spans.left, map: (x, y, _vw, vh, _tw, th) => [x, vh - th + y]},
	};
	for (const key of Object.keys(SPEC) as CornerKey[]) {
		const r = radii[key];
		const spec = SPEC[key];
		const vw = 2 * r.rx + spec.sx;
		const vh = 2 * r.ry + spec.sy;
		const tw = Math.min(r.rx + B, vw);
		const th = Math.min(r.ry + B, vh);
		const vr: CornerRadii = {tl: r, tr: r, br: r, bl: r};
		const baked = bake(vw, vh, vr, tw, th, (x, y) => spec.map(x, y, vw, vh, tw, th));
		corners[key] = {map: baked.mapDataUrl, spec: baked.specularDataUrl, w: tw, h: th};
	}

	// Edge strips: a sharp-cornered virtual square sampled along its centre
	// line - a pure straight-edge field, uniform along the axis. Each strip
	// is baked so its STRONG end (d = 0) lands on the border side at
	// placement, with the inward direction pointing into the element:
	//   top    row 0        at the top border,    pulling down  ✓
	//   bottom last row     at the bottom border, pulling up
	//   left   column 0     at the left border,   pulling right ✓
	//   right  last column  at the right border,  pulling left
	// In wrapped dimensions the strips collapse to zero length at placement.
	const S = 2 * B;
	const strip = (w: number, h: number, mapFn: MapFn): {map: string; spec: string} => {
		const b = bake(S, S, zero, w, h, mapFn);
		return {map: b.mapDataUrl, spec: b.specularDataUrl};
	};
	const edges: LiquidGlassTiles['edges'] = {
		top: strip(1, B, (_x, y) => [B, y]),
		bottom: strip(1, B, (_x, y) => [B, B + y]),
		left: strip(B, 1, (x, _y) => [x, B]),
		right: strip(B, 1, (x, _y) => [B + x, B]),
	};

	return {bezel: B, res, maxDisplacement: lut.maxAbs, corners, edges};
}
