/**
 * The {@link LiquidGlass} element controller: measurement, tile-cache
 * routing, shared-filter groups and observers.

 * @module controller
 */

import type {
	CornerRadii,
	LiquidGlassEvents,
	LiquidGlassOptions,
	LiquidGlassRefreshDetail,
	LiquidGlassResolvedOptions,
	LiquidGlassSpecularOptions,
	LiquidGlassTiles,
} from './types';
import {DEFAULT_OPTIONS, resolveBezel, resolveOptions} from './options';
import {
	bakeSignature,
	radiusKey,
	resolveRadii,
	resolveRenderScale,
	sanitizeFilterId,
	tileExtent,
	tileKey,
} from './geometry';
import {getTiles} from './cache';
import {renderMaps} from './bake';
import {displacementScale, GlassFilterNode} from './filter';
import {checkSvgBackdropSupport} from './support';
import {throttle} from './utils';

let uid = 0;

/** Shared-filter group entry (`filterId` option). */
interface SharedFilterEntry {
	id: string;
	owner: LiquidGlass | null;
	users: Set<LiquidGlass>;
	filterNode: GlassFilterNode | null;
	tiles: LiquidGlassTiles | null;
	debugDataUrl: string | null;
	maxDisplacement: number;
	W: number;
	H: number;
	sizeKey: string;
	radiusKey: string;
	tileKey: string;
	sig: string;
}

/** Frozen bake info for the current geometry. */
interface TileInfo {
	bezel: number;
	thickness: number;
	tileKey: string;
}

/**
 * Registry of shared filters (`filterId` option): sanitized id → bake
 * entry. The first element created for an id owns the bake; the rest
 * attach as followers referencing the same `<filter>` node.
 */
const sharedFilters = new Map<string, SharedFilterEntry>();

/**
 * Attaches a liquid-glass effect to a single element: reads its layout,
 * bakes the maps, builds the SVG filter, applies `backdrop-filter` and
 * keeps everything in sync on resize / border-radius changes.
 */
export class LiquidGlass {
	/** Target element. */
	readonly el: HTMLElement;
	/** Fully-resolved current options. */
	options: LiquidGlassResolvedOptions;
	/** Latest debug map (data URL); null unless `debug: true`. */
	mapDebugDataUrl: string | null;
	/** Largest displacement magnitude in px. */
	maxDisplacement: number;
	/** Unique filter id for this instance. */
	readonly id: string;

	private _filterNode: GlassFilterNode | null;
	private _ro: ResizeObserver | null;
	private _mo: MutationObserver | null;
	private _sizeKey: string;
	private _radiusKey: string;
	/** Frozen bake info: {bezel, thickness, tileKey}. */
	private _tileInfo: TileInfo | null;
	private _tiles: LiquidGlassTiles | null;
	private _shared: SharedFilterEntry | null;
	/** True while this instance owns its shared group's bake. */
	private _sharedOwner: boolean;
	/** True while this instance owns its `filterId` group's bake. */
	get isSharedOwner(): boolean {
		return this._sharedOwner;
	}
	/** Bake key of the last shared-mismatch warning (anti-spam). */
	private _mismatchKey: string;
	/** Set by destroy() — async callbacks (fonts.ready, rAF, throttled
	 * schedules) must not touch the DOM afterwards. */
	private _destroyed = false;
	private _prevBackdrop: string;
	private _schedule: () => void;

	/**
	 * @param el Target element (any shape; corner radii are
	 *        read from computed style).
	 * @param opts Option overrides, merged onto the defaults.
	 * @throws {Error} If `el` is missing.
	 */
	constructor(el: HTMLElement, opts?: LiquidGlassOptions) {
		if (!el) throw new Error('LiquidGlass: an element is required');
		this.el = el;
		this.options = resolveOptions(DEFAULT_OPTIONS, opts);

		this.mapDebugDataUrl = null;
		this.maxDisplacement = 0;

		this.id = 'liquid-glass-' + ++uid;

		this._filterNode = null;
		this._ro = null;
		this._mo = null;
		this._sizeKey = '';
		this._radiusKey = '';
		this._tileInfo = null;
		this._tiles = null; // 9-slice tile set
		this._shared = null;
		this._sharedOwner = false;
		this._mismatchKey = '';
		this._prevBackdrop = el.style.getPropertyValue('backdrop-filter');
		this._schedule = () => {};

		el.classList.add('has-liquid-glass');

		this._schedule = throttle(() => this.refresh(), this.options.throttleMs);
		if (!checkSvgBackdropSupport()) {
			el.style.setProperty('backdrop-filter', this.options.fallback);
			el.style.setProperty('-webkit-backdrop-filter', this.options.fallback);
			// The negative may have been a transient false negative during early
			// load — keep observing and retry shortly after first paint.
			this._observe();
			requestAnimationFrame(() => this.refresh());
			return;
		}

		this.refresh();
		// Static glass: generate once, never observe. Cheap `setOptions` and
		// explicit `refresh()` still work; nothing updates automatically.
		if (!this.options.static) {
			this._observe();
			if (document.fonts && document.fonts.ready) {
				document.fonts.ready.then(() => this.refresh()).catch(() => {});
			}
		}
	}

	/**
	 * Type-safe subscription to this instance's events (the same
	 * `CustomEvent`s are also observable via `el.addEventListener`).
	 *
	 * @returns An unsubscribe function.
	 */
	on<K extends keyof LiquidGlassEvents & string>(
		type: K,
		listener: (event: CustomEvent<LiquidGlassEvents[K]>) => void,
		options?: boolean | AddEventListenerOptions,
	): () => void {
		this.el.addEventListener(type, listener as EventListener, options);
		return () => this.el.removeEventListener(type, listener as EventListener, options);
	}

	/**
	 * Regenerate the tiles and filter for the element's current size and
	 * border radius. Called automatically on init and on geometry changes;
	 * safe to call manually after external layout changes.
	 *
	 * Size-only changes are handled by the cheap {@link LiquidGlass.relayout}
	 * (tiles re-positioned, no re-baking); re-bakes happen when the radius
	 * or a baking option changed.
	 * @fires LiquidGlass#lglass:refresh
	 */
	refresh(): void {
		if (this._destroyed) return;
		const W = this.el.offsetWidth;
		const H = this.el.offsetHeight;
		if (!W || !H) return;
		const radii = resolveRadii(this.el, W, H);
		const {bezel, thickness} = resolveBezel(this.options, W, H);
		this._sizeKey = W + 'x' + H;
		this._radiusKey = radiusKey(radii);
		this._tileInfo = {bezel, thickness, tileKey: tileKey(radii, W, H, bezel)};
		if (!checkSvgBackdropSupport()) {
			// No SVG backdrop-filter support (yet) — degrade to the CSS fallback.
			this.el.style.setProperty('backdrop-filter', this.options.fallback);
			this.el.style.setProperty('-webkit-backdrop-filter', this.options.fallback);
			return;
		}

		/* ---- Shared filters (`filterId`) --------------------------------
		 * Three ways here: (1) a compatible group exists → attach to it, no
		 * bake at all; (2) no group, or this instance owns the group → bake
		 * and (re)register it under the shared id; (3) a foreign group with
		 * different geometry/options → bake privately and warn (never
		 * hijack a group other elements depend on). ---------------------- */
		const wantShared = sanitizeFilterId(this.options.filterId);
		const res = resolveRenderScale(this.options, W, H, tileExtent(radii, bezel));
		const sig = bakeSignature(this.options, bezel, thickness, res);
		let sharedId: string | null = null;
		if (wantShared) {
			const entry = sharedFilters.get(wantShared);
			if (entry && this._sharedMatches(entry, sig)) {
				this._attachShared(entry);
				const surl = 'url(#' + entry.id + ')';
				this.el.style.setProperty('backdrop-filter', surl);
				this.el.style.setProperty('-webkit-backdrop-filter', surl);
				this._emit('lglass:refresh', {
					shared: true,
					renderScale: res,
					debugUrl: entry.debugDataUrl || null,
					width: W,
					height: H,
					maxDisplacement: entry.maxDisplacement,
				});
				return;
			}
			if (entry && entry.owner && entry.owner !== this) {
				const mk = this._sizeKey + '|' + this._radiusKey + '|' + sig;
				if (this._mismatchKey !== mk) {
					this._mismatchKey = mk;
					console.warn(
						'[LiquidGlass] filterId "' +
							wantShared +
							'" is baked for ' +
							entry.sizeKey +
							' [' +
							entry.sig +
							'], but this element is ' +
							this._sizeKey +
							' [' +
							sig +
							'] — using a private filter. ' +
							'Sharers must match size, corner radii and bake options.',
					);
				}
			} else {
				sharedId = wantShared; // fresh group, or re-bake our own group
			}
			this._detachShared(); // leave any group we were attached to
		} else if (this._shared) {
			this._detachShared(); // filterId was removed
		}

		// 9-slice assembly (the only path): size-independent tiles fetched
		// from (or baked into) the shared tile cache — one bake per distinct
		// shape, not per element. The resolved bezel/thickness are frozen
		// into the bake and the tile key, so later relayouts use stable
		// values.
		const tiles = getTiles(radii, this.options, W, H);
		this._tiles = tiles;
		this.maxDisplacement = tiles.maxDisplacement;
		this.mapDebugDataUrl = null;
		this._registerShared(sharedId, sig, W, H);
		this._buildFilter(W, H);
		if (this.options.debug) this._bakeDebug(W, H, radii);

		const url = 'url(#' + this._filterId() + ')';
		this.el.style.setProperty('backdrop-filter', url);
		this.el.style.setProperty('-webkit-backdrop-filter', url);

		/**
		 * Fired on the element after every tile regeneration.
		 * @event lglass:refresh
		 * @type {CustomEvent<LiquidGlassRefreshDetail>}
		 */
		this._emit('lglass:refresh', {
			shared: !!sharedId,
			renderScale: res,
			debugUrl: null,
			width: W,
			height: H,
			maxDisplacement: tiles.maxDisplacement,
		});
	}

	/**
	 * Cheap re-layout: re-position the baked 9-slice tiles
	 * for a new element size (pure filter-attribute updates — no canvas
	 * baking, no PNG re-encoding). Safe to call every animation frame.
	 *
	 * @fires LiquidGlass#lglass:relayout
	 */
	relayout(W?: number, H?: number): void {
		if (this._destroyed) return;
		// Only an owner may re-layout: followers reference the group's
		// filter node, which is laid out at the group's (owner's) size.
		if (this._shared && !this._sharedOwner) return;
		if (!this._tiles || !this._filterNode) return;
		const w = W == null ? this.el.offsetWidth : W;
		const h = H == null ? this.el.offsetHeight : H;
		if (!w || !h) return;
		this._filterNode.layout(w, h);
		this._sizeKey = w + 'x' + h;

		/**
		 * Fired on the element after every cheap slice re-layout.
		 * @event lglass:relayout
		 * @type {CustomEvent<LiquidGlassRelayoutDetail>}
		 */
		this._emit('lglass:relayout', {width: w, height: h});
	}

	/**
	 * Merge option overrides into the current options and apply them.
	 *
	 * Cheap options (`scale`, `saturate`, `blur`, `specular.opacity`,
	 * `specular.saturation`) only rebuild the filter node from cached
	 * maps/tiles. Anything geometry-related (`surface`, `bezel`,
	 * `thickness`, `ior`, `renderScale`, `debug`,
	 * `specular.angle`, `specular.width`, `specular.gray`) triggers a full
	 * regeneration.
	 *
	 * @returns this (chainable)
	 */
	setOptions(patch?: LiquidGlassOptions): this {
		const cheap = new Set<string>(['scale', 'saturate', 'blur']);
		let needsMaps = false;
		if (patch) {
			for (const k of Object.keys(patch) as (keyof LiquidGlassOptions)[]) {
				if (k === 'specular') {
					for (const sk of Object.keys(patch.specular ?? {}) as (keyof LiquidGlassSpecularOptions)[]) {
						if (sk !== 'opacity' && sk !== 'saturation') needsMaps = true;
					}
				} else if (!cheap.has(k)) needsMaps = true;
			}
		}
		this.options = resolveOptions(this.options, patch);
		if (!checkSvgBackdropSupport()) return this;
		if (needsMaps) this.refresh();
		else this._rebuildCheap();
		return this;
	}

	/**
	 * Detach the effect: disconnect observers, remove the generated filter
	 * and restore the previous inline `backdrop-filter`.
	 */
	destroy(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		if (this._ro) this._ro.disconnect();
		if (this._mo) this._mo.disconnect();
		this._detachShared(); // refcount the shared filter
		if (this._filterNode) this._filterNode.remove();
		this.el.style.setProperty('backdrop-filter', this._prevBackdrop);
		this.el.classList.remove('has-liquid-glass');
	}

	/* ------------------------- internals ------------------------- */

	/** Dispatch a typed event on the target element. */
	private _emit<K extends keyof LiquidGlassEvents & string>(type: K, detail: LiquidGlassEvents[K]): void {
		this.el.dispatchEvent(new CustomEvent<LiquidGlassEvents[K]>(type, {detail}));
	}

	/**
	 * Observe size + radius changes. A size-only change with
	 * an unchanged tile key (same radii AND same span classes) is routed to
	 * the cheap {@link LiquidGlass.relayout} (per-frame safe); anything else
	 * — radius change, or a span crossing the bezel (square ↔ rectangle,
	 * wrap ↔ straight) — re-bakes via the throttled `refresh`.
	 */
	private _observe(): void {
		const measure = (): {W: number; H: number; size: string; tileKey: string} | null => {
			const W = this.el.offsetWidth,
				H = this.el.offsetHeight;
			if (!W || !H) return null;
			const radii = resolveRadii(this.el, W, H);
			const B = this._tileInfo ? this._tileInfo.bezel : resolveBezel(this.options, W, H).bezel;
			return {W, H, size: W + 'x' + H, tileKey: tileKey(radii, W, H, B)};
		};
		const onChange = (): void => {
			const m = measure();
			if (!m) return;
			const curKey = this._tileInfo ? this._tileInfo.tileKey : null;
			if (m.size === this._sizeKey && m.tileKey === curKey) return;
			if (this._shared) {
				// Followers don't own the bake — re-validate the sharing
				// contract (re-attach, or warn + fall back to a private filter).
				this._schedule();
				return;
			}
			if (m.tileKey === curKey) {
				this.relayout(m.W, m.H); // cheap: re-position tiles only
			} else {
				this._schedule(); // re-bake (throttled)
			}
		};
		if (typeof ResizeObserver !== 'undefined') {
			this._ro = new ResizeObserver(onChange);
			this._ro.observe(this.el);
		} else {
			window.addEventListener('resize', this._schedule);
		}
		if (typeof MutationObserver !== 'undefined') {
			// border-radius can change without a resize (class / style toggles)
			this._mo = new MutationObserver(onChange);
			this._mo.observe(this.el, {attributes: true, attributeFilter: ['style', 'class']});
		}
	}

	/**
	 * Bake a full-size debug map (diagnostics only — this is
	 * the one full-size bake, done on refresh, never on relayout).
	 */
	private _bakeDebug(W: number, H: number, radii: CornerRadii): void {
		const maps = renderMaps({width: W, height: H, radii, options: this.options});
		this.mapDebugDataUrl = maps.debugDataUrl;
		if (this._shared) this._shared.debugDataUrl = maps.debugDataUrl;
		this.el.dispatchEvent(
			new CustomEvent<Partial<LiquidGlassRefreshDetail>>('lglass:refresh', {
				detail: {debugUrl: maps.debugDataUrl, width: W, height: H},
			}),
		);
	}

	/**
	 * DOM id for the `<filter>` this instance (re)builds: the shared group
	 * id when this instance belongs to a `filterId` group, its private id
	 * otherwise.
	 */
	private _filterId(): string {
		return this._shared ? this._shared.id : this.id;
	}

	/**
	 * Whether `entry` can serve this instance: same baked geometry and
	 * bake signature.
	 */
	private _sharedMatches(entry: SharedFilterEntry, sig: string): boolean {
		return (
			entry.sizeKey === this._sizeKey &&
			entry.radiusKey === this._radiusKey &&
			entry.sig === sig &&
			entry.tileKey === (this._tileInfo ? this._tileInfo.tileKey : '')
		);
	}

	private _registerShared(id: string | null, sig: string, W: number, H: number): void {
		if (!id) return;
		let entry = sharedFilters.get(id);
		if (!entry) {
			entry = {
				id,
				owner: null,
				users: new Set(),
				filterNode: null,
				tiles: null,
				debugDataUrl: null,
				maxDisplacement: 0,
				W: 0,
				H: 0,
				sizeKey: '',
				radiusKey: '',
				tileKey: '',
				sig: '',
			};
			sharedFilters.set(id, entry);
		}
		entry.owner = this;
		entry.W = W;
		entry.H = H;
		entry.sizeKey = this._sizeKey;
		entry.radiusKey = this._radiusKey;
		entry.tileKey = this._tileInfo ? this._tileInfo.tileKey : '';
		entry.sig = sig;
		entry.tiles = this._tiles;
		entry.debugDataUrl = this.mapDebugDataUrl;
		entry.maxDisplacement = this.maxDisplacement;
		entry.users.add(this);
		this._shared = entry;
		this._sharedOwner = true;
		this._mismatchKey = '';
	}

	/**
	 * Attach this instance to an existing shared-filter entry (follower
	 * role): no baking — reference the group's filter and mirror its bake
	 * outputs so cheap option rebuilds keep working locally.
	 */
	private _attachShared(entry: SharedFilterEntry): void {
		if (this._shared === entry) return; // already attached
		this._detachShared();
		entry.users.add(this);
		this._shared = entry;
		this._sharedOwner = false;
		this._mismatchKey = '';
		this._tiles = entry.tiles;
		this.mapDebugDataUrl = entry.debugDataUrl || null;
		this.maxDisplacement = entry.maxDisplacement;
		this._filterNode = entry.filterNode;
	}

	/**
	 * Leave the shared group this instance belongs to, if any. The last
	 * leaver removes the shared `<filter>` from the DOM and the registry.
	 */
	private _detachShared(): void {
		const e = this._shared;
		if (!e) return;
		e.users.delete(this);
		if (e.owner === this) e.owner = null;
		this._shared = null;
		this._sharedOwner = false;
		this._filterNode = null;
		if (e.users.size === 0) {
			sharedFilters.delete(e.id);
			if (e.filterNode) {
				e.filterNode.remove();
				e.filterNode = null;
			}
		}
	}

	/**
	 * The feDisplacementMap `scale` mapping the encoded ±1 channel range back
	 * to true pixel displacement: channel c ⇒ (c / 255 − 0.5) · scale.
	 */
	private _filterScale(): number {
		return displacementScale(this.maxDisplacement, this.options.scale);
	}

	/**
	 * (Re)build the SVG filter from the current tiles.
	 */
	private _buildFilter(W: number, H: number): void {
		// For shared groups the previous filter may be tracked on the entry
		// (e.g. a follower rebuilding it) — always retire the old node.
		const prev = this._shared ? this._shared.filterNode : this._filterNode;
		if (prev) prev.remove();

		const o = this.options;
		const node = new GlassFilterNode();
		node.build(this._filterId(), this._tiles!, W, H, {
			blur: o.blur,
			scale: this._filterScale(),
			saturate: o.saturate,
			rimSaturation: o.specular.saturation,
			rimOpacity: o.specular.opacity,
		});
		this._filterNode = node;
		if (this._shared) this._shared.filterNode = node;
	}

	/** Rebuild the filter from cached tiles (cheap options only). */
	private _rebuildCheap(): void {
		if (!this._tiles) {
			this.refresh();
			return;
		}
		// Shared filters rebuild at the group's bake size — never at the
		// local element's size, or the group's tile layout would corrupt.
		const s = this._shared;
		const W = s ? s.W : this.el.offsetWidth;
		const H = s ? s.H : this.el.offsetHeight;
		// Tiles are still valid — only filter attributes changed.
		this._buildFilter(W, H);
		const url = 'url(#' + this._filterId() + ')';
		this.el.style.setProperty('backdrop-filter', url);
		this.el.style.setProperty('-webkit-backdrop-filter', url);
	}
}
