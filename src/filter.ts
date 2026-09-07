/**
 * The SVG `<filter>` node: assembly of the 9-slice feImage layers and the
 * displacement/rim chain, plus cheap per-size re-layout of the slices.

 * @module filter
 */

import type {LiquidGlassTiles, SliceKey} from './types';
import {clamp, SVG_NS} from './utils';
import {getDefsHost} from './svg';

/** Placed 9-slice feImage nodes, grouped by slice key. */
interface SliceImg {
	key: SliceKey;
	nodes: SVGElement[];
}

/** Filter-level knobs (everything that changes without re-baking tiles). */
export interface GlassFilterOptions {
	/** Pre-displacement backdrop blur in px (0 disables the primitive). */
	blur: number;
	/** feDisplacementMap scale (encoded ±1 range → true px). */
	scale: number;
	/** Global saturation of the refracted backdrop (1 = skip). */
	saturate: number;
	/** Saturation boost inside the rim line only. */
	rimSaturation: number;
	/** Opacity of the gray glint line (0–1). */
	rimOpacity: number;
}

/**
 * One `<filter>` element in the hidden defs host.
 *
 * Owns the full primitive chain (see {@link GlassFilterNode.build}) and the
 * 8 positioned feImage slices; {@link GlassFilterNode.layout} re-positions
 * them for a new element size as pure attribute updates - safe to call
 * every animation frame.
 */
export class GlassFilterNode {
	private el: SVGFilterElement | null = null;
	private slices: SliceImg[] = [];
	private tiles: LiquidGlassTiles | null = null;

	/** The `<filter>` element, or null once removed. */
	get element(): SVGFilterElement | null {
		return this.el;
	}

	/**
	 * (Re)build the filter from a tile set.
	 *
	 * Chain (mirrors the reference implementation):
	 * ```
	 * blur(SourceGraphic)                          → lg_blur
	 * displace(lg_blur, map)                       → lg_refract
	 * [saturate(lg_refract, saturate)]             → lg_refract_g
	 * saturate(lg_refract_g, rim saturation)       → lg_refract_sat
	 * composite(lg_refract_sat IN specular alpha)  → lg_spec_masked
	 * blend(lg_spec_masked OVER refracted)         → lg_base
	 * componentTransfer(specular, alpha × opacity) → lg_spec_faded
	 * blend(lg_spec_faded OVER lg_base)
	 * ```
	 * The rim is therefore a hyper-saturated copy of the refracted backdrop
	 * masked to a thin line, topped by a faint gray glint - not a white
	 * screen-blend glow.
	 */
	build(id: string, tiles: LiquidGlassTiles, W: number, H: number, o: GlassFilterOptions): void {
		this.remove();
		this.tiles = tiles;

		const f = document.createElementNS(SVG_NS, 'filter') as SVGFilterElement;
		f.setAttribute('id', id);
		// Deliberately keep the default filter region (-10% .. 120%), like the
		// reference: it gives blur and displaced samples room to bleed at the
		// edges instead of clipping.
		f.setAttribute('color-interpolation-filters', 'sRGB');

		/** Create a filter primitive. */
		const mk = (tag: string, attrs: Record<string, string | number>): SVGElement => {
			const n = document.createElementNS(SVG_NS, tag);
			for (const k in attrs) n.setAttribute(k, String(attrs[k]));
			f.appendChild(n);
			return n;
		};
		const image = (href: string, result: string): SVGElement =>
			mk('feImage', {
				href,
				result,
				x: 0,
				y: 0,
				width: W,
				height: H,
				preserveAspectRatio: 'none',
			});

		// --- Load the map & specular layers -----------------------------
		// Neutral flood + 8 positioned tile feImages per layer, composed
		// with a sequential feComposite "over" chain.
		//
		// NOTE: do NOT use feMerge here - Chrome rasterizes feMerge with
		// multiple subregion'd feImages INCORRECTLY inside backdrop-filter
		// (it renders correctly in standalone SVG filters, but under
		// backdrop-filter only part of the assembly lands where it should,
		// producing neutral edges / wild saturation). A sequential
		// feComposite "over" chain is rasterized correctly in both paths.
		// Slice positions live on the feImage x/y/width/height attributes,
		// mutated by layout() without ever re-baking.
		{
			const c = tiles.corners,
				e = tiles.edges;
			this.slices = [];

			/**
			 * Compose slices into one result via sequential feComposite "over".
			 * @param floodColor Opaque base color, or null for a
			 *        transparent base (specular layer).
			 */
			const chain = (
				finalName: string,
				floodColor: string | null,
				slices: Array<{key: SliceKey; href: string}>,
			): void => {
				let acc: string | null = null;
				let lastNode: SVGElement | null = null;
				if (floodColor) {
					lastNode = mk('feFlood', {'flood-color': floodColor, result: finalName + '_f'});
					acc = finalName + '_f';
				}
				for (let i = 0; i < slices.length; i++) {
					const s = slices[i];
					const imName = finalName + '_i' + i;
					const im = image(s.href, imName);
					this.slices.push({key: s.key, nodes: [im]});
					if (acc === null) {
						acc = imName; // first image is the base layer
						lastNode = im;
					} else {
						lastNode = mk('feComposite', {
							in: imName,
							in2: acc,
							operator: 'over',
							result: finalName + '_c' + i,
						});
						acc = finalName + '_c' + i;
					}
				}
				if (lastNode) lastNode.setAttribute('result', finalName);
			};

			const SLICES: Array<{key: SliceKey; map: string; spec: string}> = [
				{key: 'tl', map: c.tl.map, spec: c.tl.spec},
				{key: 'tr', map: c.tr.map, spec: c.tr.spec},
				{key: 'br', map: c.br.map, spec: c.br.spec},
				{key: 'bl', map: c.bl.map, spec: c.bl.spec},
				{key: 'top', map: e.top.map, spec: e.top.spec},
				{key: 'bottom', map: e.bottom.map, spec: e.bottom.spec},
				{key: 'left', map: e.left.map, spec: e.left.spec},
				{key: 'right', map: e.right.map, spec: e.right.spec},
			];
			// Displacement: opaque neutral base, tiles over it.
			chain(
				'lg_map',
				'rgb(128,128,128)',
				SLICES.map((s) => ({key: s.key, href: s.map})),
			);
			// Specular: transparent base (no flood) - first tile is the base.
			chain(
				'lg_spec',
				null,
				SLICES.map((s) => ({key: s.key, href: s.spec})),
			);
		}

		// Slight pre-displacement blur of the backdrop (default: 0.2).
		let source = 'SourceGraphic';
		if (o.blur > 0) {
			mk('feGaussianBlur', {in: 'SourceGraphic', stdDeviation: o.blur, result: 'lg_blur'});
			source = 'lg_blur';
		}

		// Refraction.
		mk('feDisplacementMap', {
			in: source,
			in2: 'lg_map',
			scale: o.scale,
			xChannelSelector: 'R',
			yChannelSelector: 'G',
			result: 'lg_refract',
		});

		// Optional global saturation of the refracted backdrop.
		let base = 'lg_refract';
		const g = o.saturate;
		if (isFinite(g) && Math.abs(g - 1) > 1e-3) {
			mk('feColorMatrix', {
				in: 'lg_refract',
				type: 'saturate',
				values: String(clamp(g, 0, 4)),
				result: 'lg_gsat',
			});
			base = 'lg_gsat';
		}

		// Rim path 1: hyper-saturated copy of the backdrop, masked to the
		// thin rim line (alpha of the specular layer), drawn over the base.
		mk('feColorMatrix', {
			in: base,
			type: 'saturate',
			values: String(clamp(o.rimSaturation || 0, 0, 50)),
			result: 'lg_refract_sat',
		});
		mk('feComposite', {
			in: 'lg_refract_sat',
			in2: 'lg_spec',
			operator: 'in',
			result: 'lg_spec_masked',
		});
		mk('feBlend', {in: 'lg_spec_masked', in2: base, mode: 'normal', result: 'lg_base'});

		// Rim path 2: the gray glint itself, faded by opacity (feFuncA slope).
		const ct = mk('feComponentTransfer', {in: 'lg_spec', result: 'lg_spec_faded'});
		const func = document.createElementNS(SVG_NS, 'feFuncA');
		func.setAttribute('type', 'linear');
		func.setAttribute('slope', String(clamp(o.rimOpacity, 0, 1)));
		ct.appendChild(func);
		mk('feBlend', {in: 'lg_spec_faded', in2: 'lg_base', mode: 'normal'});

		getDefsHost().appendChild(f);
		this.el = f;
		this.layout(W, H);
	}

	/**
	 * Position the 9-slice feImage nodes for a given element size.
	 *
	 * Layout (CSS px, filter user space): corner tiles keep their baked
	 * size at the four corners; the 1-px edge strips stretch between them
	 * (lossless - they are uniform along their axis); the neutral interior
	 * comes from the `feFlood`. Degenerate spans collapse to ~0.
	 */
	layout(W: number, H: number): void {
		const t = this.tiles;
		if (!t || !this.el) return;
		const B = t.bezel;
		const c = t.corners;
		const rects: Record<SliceKey, [number, number, number, number]> = {
			tl: [0, 0, c.tl.w, c.tl.h],
			tr: [W - c.tr.w, 0, c.tr.w, c.tr.h],
			br: [W - c.br.w, H - c.br.h, c.br.w, c.br.h],
			bl: [0, H - c.bl.h, c.bl.w, c.bl.h],
			top: [c.tl.w, 0, Math.max(0, W - c.tl.w - c.tr.w), B],
			bottom: [c.bl.w, H - B, Math.max(0, W - c.bl.w - c.br.w), B],
			left: [0, c.tl.h, B, Math.max(0, H - c.tl.h - c.bl.h)],
			right: [W - B, c.tr.h, B, Math.max(0, H - c.tr.h - c.br.h)],
		};
		for (const s of this.slices) {
			const r = rects[s.key];
			for (const n of s.nodes) {
				if (!r || r[2] <= 0 || r[3] <= 0) {
					n.setAttribute('x', '0');
					n.setAttribute('y', '0');
					n.setAttribute('width', '0.01');
					n.setAttribute('height', '0.01');
				} else {
					n.setAttribute('x', String(r[0]));
					n.setAttribute('y', String(r[1]));
					n.setAttribute('width', String(r[2]));
					n.setAttribute('height', String(r[3]));
				}
			}
		}
	}

	/** Remove the `<filter>` from the DOM and drop all state. */
	remove(): void {
		if (this.el) {
			this.el.remove();
			this.el = null;
		}
		this.slices = [];
		this.tiles = null;
	}
}

/**
 * The feDisplacementMap `scale` mapping the encoded ±1 channel range back
 * to true pixel displacement: channel c ⇒ (c / 255 − 0.5) · scale.
 */
export function displacementScale(maxDisplacement: number, scale: number): number {
	return maxDisplacement * (255 / 127) * clamp(scale || 0, 0, 4);
}
