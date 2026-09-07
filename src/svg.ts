/**
 * Hidden SVG `<defs>` host for the generated `<filter>` nodes.

 * @module svg
 */

import {SVG_NS} from './utils';

let defsHost: SVGElement | null = null;

/**
 * Lazily create (or reuse) the hidden SVG hosting every generated
 * `<filter>`. Must not be `display: none` - that breaks filter references.
 */
export function getDefsHost(): SVGElement {
	if (defsHost && defsHost.isConnected) return defsHost;
	defsHost = document.querySelector<SVGElement>('#liquid-glass-defs');
	if (!defsHost) {
		defsHost = document.createElementNS(SVG_NS, 'svg');
		defsHost.id = 'liquid-glass-defs';
		defsHost.setAttribute('aria-hidden', 'true');
		defsHost.setAttribute('style', 'position:fixed;width:0;height:0;pointer-events:none;');
		document.body.appendChild(defsHost);
	}
	return defsHost;
}
