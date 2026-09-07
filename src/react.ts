/**
 * React hook for LiquidGlass - `import { useLiquidGlass } from '@goran.alkovic/liquid-glass/react'`.
 *
 * Ships as a separate entry point so non-React consumers never pull react
 * in; `react` is an optional peer dependency (18+).

 * @module react
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {LiquidGlass} from './controller';
import type {LiquidGlassEvents, LiquidGlassOptions} from './types';

/**
 * Result of {@link useLiquidGlass}.
 */
export interface UseLiquidGlassResult<El extends HTMLElement = HTMLElement> {
	/**
	 * Attach to your element - the effect is created when the node mounts and
	 * destroyed when it unmounts (React 18 StrictMode-safe):
	 *
	 * ```tsx
	 * const { ref } = useLiquidGlass({ surface: 'concave', thickness: 64 });
	 * return <div ref={ref} className="card">…</div>;
	 * ```
	 */
	ref: (node: El | null) => void;
	/** The controller instance once mounted (triggers one re-render), then
	 * null again after unmount. */
	glass: LiquidGlass | null;
	/**
	 * Subscribe to a typed event. Safe to call before the element mounts:
	 * the handler attaches as soon as the controller exists (and survives
	 * node swaps). Returns an unsubscribe function.
	 */
	on<K extends keyof LiquidGlassEvents & string>(
		type: K,
		handler: (event: CustomEvent<LiquidGlassEvents[K]>) => void,
	): () => void;
	/** Re-bake for the element's current geometry (usually automatic). */
	refresh(): void;
	/** Cheap tile re-positioning for a new size (usually automatic - the
	 * controller observes size changes itself). */
	relayout(width?: number, height?: number): void;
}

/**
 * Attach a liquid-glass effect to an element with one hook.
 *
 * ```tsx
 * import { useLiquidGlass } from '@goran.alkovic/liquid-glass/react';
 *
 * function Card({ strong }: { strong: boolean }) {
 *   const options = useMemo(
 *     () => ({ thickness: strong ? 90 : 50 }),
 *     [strong],
 *   );
 *   const { ref, glass } = useLiquidGlass(options);
 *   return <article ref={ref}>…</article>;
 * }
 * ```
 *
 * Lifecycle: the controller is created when the referenced node mounts and
 * destroyed when it unmounts or when React swaps the node for a different
 * one - no cleanup needed, and React 18 StrictMode's double-invocation is
 * handled (destroyed instances never touch the DOM again).
 *
 * Options flow through `setOptions`: cheap options (`scale`, `saturate`,
 * `blur`, `specular.opacity/saturation`) rebuild only the filter, geometry
 * options re-bake via the library's throttling. **The options object
 * identity is what matters** - memoize it (or hoist it) so the hook only
 * calls `setOptions` when something actually changed.
 */
export function useLiquidGlass<El extends HTMLElement = HTMLElement>(
	options?: LiquidGlassOptions,
): UseLiquidGlassResult<El> {
	const [node, setNode] = useState<El | null>(null);
	const [glass, setGlass] = useState<LiquidGlass | null>(null);
	// Options the mounted instance was last given (constructor or setOptions).
	const appliedOptions = useRef<LiquidGlassOptions | undefined>(options);
	// Subscriptions made before the instance existed - attached on creation.
	const pendingSubs = useRef<PendingSub[]>([]);

	// Create on node mount, destroy on unmount / node swap. The controller
	// guards async callbacks (fonts.ready, throttled refreshes) after
	// destroy(), so StrictMode's double mount cannot leave orphans.
	useEffect(() => {
		if (!node) return;
		const g = new LiquidGlass(node, appliedOptions.current);
		// Attach subscriptions queued before the instance existed. Bound via
		// closure - a detached method reference would lose `this`.
		const attach = (type: string, handler: (e: CustomEvent<unknown>) => void) =>
			g.on(type as keyof LiquidGlassEvents & string, handler as never);
		for (const p of pendingSubs.current) attach(p.type, p.handler);
		setGlass(g);
		return () => {
			g.destroy();
			setGlass(null);
		};
	}, [node]);

	// Forward option updates. Identity-checked: the constructor already
	// received the initial options, so identical objects are no-ops.
	useEffect(() => {
		if (appliedOptions.current === options) return;
		appliedOptions.current = options;
		glass?.setOptions(options);
	}, [options, glass]);

	const ref = useCallback((n: El | null) => {
		setNode(n);
	}, []);

	const on = useCallback(
		<K extends keyof LiquidGlassEvents & string>(
			type: K,
			handler: (event: CustomEvent<LiquidGlassEvents[K]>) => void,
		): (() => void) => {
			if (glass) return glass.on(type, handler);
			// Instance not mounted yet - queue; attached on creation. Calling
			// on() again once mounted re-attaches directly (and drops the
			// queue entry), so handlers never fire twice.
			pendingSubs.current = pendingSubs.current.filter((p) => p.type !== type || p.handler !== handler);
			pendingSubs.current.push({
				type,
				handler: handler as unknown as (e: CustomEvent<unknown>) => void,
			});
			return () => {
				pendingSubs.current = pendingSubs.current.filter((p) => p.type !== type || p.handler !== handler);
			};
		},
		[glass],
	);

	const refresh = useCallback(() => {
		glass?.refresh();
	}, [glass]);

	const relayout = useCallback(
		(width?: number, height?: number) => {
			glass?.relayout(width, height);
		},
		[glass],
	);

	return {ref, glass, on, refresh, relayout};
}

/** A queued subscription (attached as soon as the instance exists). */
interface PendingSub {
	type: keyof LiquidGlassEvents & string;
	handler: (e: CustomEvent<unknown>) => void;
}
