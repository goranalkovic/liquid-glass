/**
 * SVG `backdrop-filter` capability detection.

 * @module support
 */

let svgBackdropSupported: boolean | null = null;

/**
 * Whether this browser can run SVG filters as `backdrop-filter`.
 * Only Chromium implements it; Safari parses the value but ignores it,
 * so a UA check is unfortunately required.
 *
 * Computed lazily (and cached) instead of at script-evaluation time -
 * some embedded browsers return false negatives for `CSS.supports`
 * during early document loading.
 */
export function checkSvgBackdropSupport(): boolean {
	// Only positive results are cached: a false can be a transient false
	// negative very early in document loading, while a true is stable.
	if (svgBackdropSupported === true) return true;
	let ok = false;
	try {
		if (typeof CSS !== 'undefined' && CSS.supports) {
			const parses = CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)');
			ok = !!parses && /Chrome\/|Chromium\/|Edg\/|Electron\//.test(navigator.userAgent);
		}
	} catch {
		ok = false;
	}
	if (ok) svgBackdropSupported = true;
	return ok;
}
