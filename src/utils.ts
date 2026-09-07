/**
 * Small shared utilities.

 * @module utils
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Clamp v into [a, b] (NaN-safe: returns a). */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * Throttle: at most one `fn` execution per `ms`, last call always runs.
 */
export function throttle(fn: () => void, ms: number): () => void {
	let last = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const run = () => {
		timer = null;
		last = performance.now();
		fn();
	};
	return () => {
		if (timer) return;
		const remain = ms - (performance.now() - last);
		if (remain <= 0) run();
		else timer = setTimeout(run, remain);
	};
}
