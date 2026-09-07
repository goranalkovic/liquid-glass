import {useEffect} from 'react';
import type {HTMLAttributes} from 'react';
import {useLiquidGlass} from 'liquid-glass/react';
import type {LiquidGlassOptions, LiquidGlassRefreshDetail} from 'liquid-glass';

export interface GlassProps extends HTMLAttributes<HTMLElement> {
	/** Element tag to render. Default `div`. */
	as?: 'div' | 'nav' | 'section' | 'button';
	/** LiquidGlass options — updates flow through `setOptions` live. Memoize
	 * (or hoist) the object: identity is what triggers updates. */
	options?: LiquidGlassOptions;
	/** Typed handler for the `lglass:refresh` event. */
	onRefresh?: (e: CustomEvent<LiquidGlassRefreshDetail>) => void;
}

/**
 * Attaches a LiquidGlass effect to an element for its lifetime and
 * forwards option updates to `setOptions` (cheap options rebuild the
 * filter, geometry options re-bake via the library's throttling).
 *
 * Built on the library's `useLiquidGlass` hook — this is example code;
 * copy it into your app or adapt it to your needs.
 */
export function Glass({as = 'div', options, onRefresh, ...rest}: GlassProps) {
	const {ref: hostRef, on} = useLiquidGlass<HTMLElement>(options);

	useEffect(() => {
		if (!onRefresh) return;
		return on('lglass:refresh', onRefresh);
	}, [on, onRefresh]);

	const Tag = as as 'div'; // polymorphic tag — ref types line up at runtime
	return <Tag ref={hostRef} {...rest} />;
}
