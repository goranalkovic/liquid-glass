/**
 * SVG `backdrop-filter` capability detection.

 * @module support
 */

let svgBackdropSupported: boolean | null = null;

/** Manual override installed by {@link forceSupported}; null = sniff. */
let forced: boolean | null = null;

/**
 * Minimum Safari (`Version/x.y` UA token) assumed to include WebKit's
 * `backdrop-filter: url()` reference-filter support
 * (bugs.webkit.org/show_bug.cgi?id=245510 - WebKit PRs 68613 / 68614 /
 * 69566, in review as of 2026-09). Safari has *parsed* the value all
 * along while rendering nothing, so the parse test alone false-positives
 * there; until the release train containing the fix is known - and its
 * (initially software) raster path is validated for performance - WebKit
 * stays below this floor. Raise concerns/flip this constant (e.g. to
 * `26.4`) once the shipping version is confirmed, or call
 * {@link forceSupported}(true) to test a Technology Preview today.
 */
const WEBKIT_VERSION_FLOOR = Infinity;

/** Safari version from the UA's `Version/x.y` token, or null. */
function webkitVersion(ua: string): number | null {
	const m = /\bVersion\/(\d+)(?:\.(\d+))?.*\bSafari\//.exec(ua);
	return m ? Number(m[1]) + Number(m[2] ?? '0') / 100 : null;
}

/**
 * Whether this browser can run SVG filters as `backdrop-filter`.
 * Today: Chromium only. Safari parses the value but ignores it, and
 * Firefox's WebRender drops the whole declaration when it would need an
 * SVG filter graph - so a UA check is unfortunately required on top of
 * `CSS.supports` (`@supports` cannot distinguish "parses" from
 * "renders").
 *
 * Computed lazily (and cached) instead of at script-evaluation time -
 * some embedded browsers return false negatives for `CSS.supports`
 * during early document loading.
 */
export function checkSvgBackdropSupport(): boolean {
	if (forced !== null) return forced;
	// Only positive results are cached: a false can be a transient false
	// negative very early in document loading, while a true is stable.
	if (svgBackdropSupported === true) return true;
	let ok = false;
	try {
		if (typeof CSS !== 'undefined' && CSS.supports) {
			const parses = CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)');
			if (parses) {
				const ua = navigator.userAgent;
				ok = /Chrome\/|Chromium\/|Edg\/|Electron\//.test(ua) || (webkitVersion(ua) ?? -1) >= WEBKIT_VERSION_FLOOR;
			}
		}
	} catch {
		ok = false;
	}
	if (ok) svgBackdropSupported = true;
	return ok;
}

/**
 * Manually override the capability verdict: `true` forces the SVG
 * backdrop path on (e.g. a Safari Technology Preview carrying the WebKit
 * reference-filter work), `false` forces it off, `null` returns to
 * sniffing. This escape hatch exists because there is no way to read back
 * what a backdrop filter actually painted - a browser can parse the value
 * without rendering it, and only a human with a test page can tell.
 */
export function forceSupported(v: boolean | null): void {
	forced = v;
}
