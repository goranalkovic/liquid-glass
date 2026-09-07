/**
 * Public type definitions for LiquidGlass.
 *
 * @module types
 */

/** Corner keys of the 9-slice layout. */
export type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
/** All 9-slice slice keys (corners + edge strips). */
export type SliceKey = CornerKey | 'top' | 'bottom' | 'left' | 'right';

/**
 * Bezel profile name. The built-in names are
 * `'convex-squircle' | 'convex-circle' | 'concave' | 'lip'`; custom profiles
 * registered via {@link registerSurface} type-check against the open
 * `string` arm while keeping autocomplete for the built-ins.
 */
export type SurfaceName = 'convex-squircle' | 'convex-circle' | 'concave' | 'lip' | (string & {});

/**
 * A bezel profile: the shape of the glass cross-section from the element
 * border to the end of the bezel.
 *
 * The *slope* is what bends light (via Snell's law); the profile choice
 * mostly changes how gradual that bending is.
 */
export interface LiquidGlassSurface {
	/** Glass thickness envelope at t ∈ [0..1]. t = 0 is the element border,
	 * t = 1 is the end of the bezel; f(0) = 0 (full thickness) and f(1) = 1
	 * (flat interior) for every profile. Monotonically increasing — this
	 * border-peaked, decaying envelope is what keeps rounded corners
	 * crease-free (see the `concave` profile notes). */
	f(t: number): number;
	/** Surface slope driving Snell refraction; its sign selects the bend
	 * direction (positive = rays bend inward, negative = outward). It equals
	 * f′ for the convex profiles; `concave` and `lip` stylize the slope
	 * independently. */
	fp(t: number): number;
}

/** Elliptical corner radius in px. */
export interface Radius {
	/** Horizontal radius. */
	rx: number;
	/** Vertical radius. */
	ry: number;
}

/** Per-corner radii: `{tl, tr, br, bl}`. */
export interface CornerRadii {
	tl: Radius;
	tr: Radius;
	br: Radius;
	bl: Radius;
}

/** Rim-light configuration (all fields optional; merged one level deep). */
export interface LiquidGlassSpecularOptions {
	/**
	 * Direction the light *travels*, in degrees (screen space, 0° = from the
	 * left, 90° = from the top). 65° ≈ from the top-left, matching the
	 * reference implementation. Only the border facing the light gets a rim
	 * (one-sided, like a real edge highlight).
	 */
	angle?: number;
	/**
	 * Saturation boost applied to the refracted backdrop **inside the rim
	 * line only** — this colored edge glint is the signature of the
	 * reference look. Cheap: does not re-bake the maps.
	 */
	saturation?: number;
	/**
	 * Opacity of the thin gray glint drawn on top of the saturated rim
	 * (0–1). Cheap: does not re-bake the maps.
	 */
	opacity?: number;
	/** Width of the rim line in CSS px (razor-thin, ≈1.6 in the reference). */
	width?: number;
	/** Gray level (0–255) of the glint line color. */
	gray?: number;
}

/**
 * Configuration for a liquid-glass element. Every field is optional and
 * every field is configurable via the constructor or
 * {@link LiquidGlass.setOptions}.
 */
export interface LiquidGlassOptions {
	/** Bezel profile (built-ins via {@link listSurfaces}, custom via
	 * {@link registerSurface}). */
	surface?: SurfaceName;
	/**
	 * Width of the refracting edge in CSS pixels.
	 * `'auto'` = min(48, min(width, height) / 2).
	 */
	bezel?: number | 'auto';
	/**
	 * Virtual glass thickness in CSS pixels — the main strength knob
	 * (border displacement scales roughly linearly with it).
	 * `'auto'` = bezel width.
	 */
	thickness?: number | 'auto';
	/** Refractive index (air ≈ 1, glass ≈ 1.5, diamond ≈ 2.4). */
	ior?: number;
	/**
	 * Multiplier on the computed displacement. 0 disables refraction,
	 * values > 1 exaggerate. Cheap: does not re-bake the maps.
	 */
	scale?: number;
	/**
	 * Global saturation applied to the whole refracted backdrop
	 * (1 = unchanged). Cheap. The rim has its own boost, see
	 * `specular.saturation`.
	 */
	saturate?: number;
	/**
	 * Backdrop blur in px applied *before* displacement (the reference
	 * implementation always keeps a slight blur, default 1). Cheap.
	 */
	blur?: number;
	/** Rim-light configuration. */
	specular?: LiquidGlassSpecularOptions;
	/**
	 * Share one baked SVG filter between several elements. Every instance
	 * created with the same `filterId` references a single `<filter>` —
	 * one tile bake and one filter DOM subtree for the whole group (the
	 * browser still applies the filter per element, so each element
	 * refracts its own backdrop). Group contract: identical size, corner
	 * radii and bake options (`surface`, `ior`, `renderScale`, rim
	 * angle/width/gray, resolved bezel/thickness); mismatching elements
	 * fall back to a private filter and log a warning. The first element
	 * created for an id owns the bake — its geometry changes re-bake the
	 * whole group; destroying the last member removes the shared filter.
	 * Cheap options (`scale`, `saturate`, `blur`,
	 * `specular.opacity/saturation`) rebuild the shared filter for every
	 * member.
	 */
	filterId?: string | null;
	/**
	 * Bake quality — the resolution multiplier for the tile bitmaps.
	 * `'auto'` scales with how large the element renders (geometric mean
	 * of w×h): ≤150px bakes at 0.75×, ≤300px at 1×, ≤450px at 1.5×,
	 * larger at 2× — softness is imperceptible at small sizes and the
	 * bake is nearly free. Tiers are grid-aligned multipliers; off-grid
	 * values (e.g. an early 5% offset experiment) caused visible
	 * resampling glitches. Bake cost is capped by tile size. Explicit
	 * numbers are the override and clamp to [0.5, 4]. Higher = sharper
	 * thin rim, ~quadratically more bake time and memory.
	 */
	renderScale?: number | 'auto';
	/** Throttle (ms) for regeneration on resize / radius changes. */
	throttleMs?: number;
	/** `backdrop-filter` value for browsers without SVG-filter support. */
	fallback?: string;
	/**
	 * Also generate an inspectable debug map (R/G = displacement, B =
	 * rim), exposed via {@link LiquidGlass.mapDebugDataUrl} and the
	 * `lglass:refresh` event.
	 */
	debug?: boolean;
	/**
	 * Generate the effect once for the geometry at creation and never
	 * update it automatically: no resize/radius observers, no late
	 * `fonts.ready` refresh. Ideal for elements whose size is known and
	 * fixed — zero ongoing work after setup. Cheap `setOptions` (scale,
	 * saturate, blur, specular opacity/saturation) still applies, and
	 * `refresh()` can be called manually after a known layout change. If
	 * the element is hidden (zero size) at creation, call `refresh()`
	 * once it becomes visible. In a `filterId` group the owner's updates
	 * still propagate to static followers.
	 */
	static?: boolean;
}

/** Rim options with every default filled in. */
export interface LiquidGlassResolvedSpecular {
	angle: number;
	saturation: number;
	opacity: number;
	width: number;
	gray: number;
}

/** Fully-resolved options (defaults filled in); used internally. */
export interface LiquidGlassResolvedOptions {
	surface: SurfaceName;
	bezel: number | 'auto';
	thickness: number | 'auto';
	ior: number;
	scale: number;
	saturate: number;
	blur: number;
	specular: LiquidGlassResolvedSpecular;
	filterId: string | null;
	renderScale: number | 'auto';
	throttleMs: number;
	fallback: string;
	debug: boolean;
	static: boolean;
}

/**
 * Baked artifacts for one element size.
 */
export interface LiquidGlassMaps {
	/** Opaque displacement PNG (R = X, G = Y, 128 = neutral). */
	mapDataUrl: string;
	/** Thin rim-line PNG (gray RGB, intensity in alpha; the alpha doubles
	 * as the rim mask). */
	specularDataUrl: string;
	/** Combined debug PNG (R/G = displacement, B = specular), or null
	 * unless `debug: true`. */
	debugDataUrl: string | null;
	/** Largest displacement magnitude in px. */
	maxDisplacement: number;
	/** Map width in CSS px. */
	width: number;
	/** Map height in CSS px. */
	height: number;
}

/**
 * Baked 9-slice tile set — size-independent, re-positionable.
 */
export interface LiquidGlassTiles {
	/** Bezel width the tiles were baked with. */
	bezel: number;
	/** Resolution multiplier used. */
	res: number;
	/** Largest displacement magnitude in px. */
	maxDisplacement: number;
	/**
	 * Corner tiles (`tl`, `tr`, `br`, `bl`); `w = rx + bezel`,
	 * `h = ry + bezel`.
	 */
	corners: Record<CornerKey, {map: string; spec: string; w: number; h: number}>;
	/**
	 * Edge strips (`top`, `bottom` — 1×bezel; `left`, `right` — bezel×1).
	 * Uniform along their axis, so stretching them is lossless.
	 */
	edges: Record<'top' | 'bottom' | 'left' | 'right', {map: string; spec: string}>;
}

/** Detail of the `lglass:refresh` event. */
export interface LiquidGlassRefreshDetail {
	/** Resolved bake resolution multiplier (the effective quality). */
	renderScale: number;
	/** Debug map data URL (only with the `debug` option). */
	debugUrl: string | null;
	/** Element width in px. */
	width: number;
	/** Element height in px. */
	height: number;
	/** Max displacement in px. */
	maxDisplacement: number;
	/** True when the element attached to an existing `filterId` group
	 * instead of baking. */
	shared: boolean;
}

/** Detail of the `lglass:relayout` event. */
export interface LiquidGlassRelayoutDetail {
	width: number;
	height: number;
}

/**
 * Typed event map for the events a {@link LiquidGlass} instance fires on
 * its element. The interface is open — declare-merge extra custom events:
 *
 * ```ts
 * declare module 'liquid-glass' {
 *   interface LiquidGlassEvents {
 *     'myapp:custom': { reason: string };
 *   }
 * }
 * ```
 */
export interface LiquidGlassEvents {
	'lglass:refresh': LiquidGlassRefreshDetail;
	'lglass:relayout': LiquidGlassRelayoutDetail;
}

/** Parameters for the standalone {@link generateMaps}. */
export interface GenerateMapsParams {
	/** Width in CSS px. */
	width: number;
	/** Height in CSS px. */
	height: number;
	/** Resolved per-corner radii (optional). */
	radii?: CornerRadii;
	/** Shorthand uniform radius (px). */
	borderRadius?: number;
	/** Option overrides. */
	options?: LiquidGlassOptions;
}

/** Parameters for the standalone {@link generateTiles}. */
export interface GenerateTilesParams {
	/** Resolved per-corner radii. */
	radii?: CornerRadii;
	/** Shorthand uniform radius (px). */
	borderRadius?: number;
	/** Used to resolve `'auto'` bezel/thickness. */
	width?: number;
	height?: number;
	/** Option overrides. */
	options?: LiquidGlassOptions;
}
