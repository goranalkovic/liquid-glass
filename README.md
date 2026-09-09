# LiquidGlass

Apple-style **"Liquid Glass"** refraction for any DOM element - SVG displacement-map
`backdrop-filter`, ported from the technique described in
[kube.io - Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/).

- Zero runtime dependencies, ~26 kB minified, TypeScript with full type declarations.
- Optional React hook at `liquid-glass/react` (React 18+ peer).
- Works from `file://` (no build step needed on the consuming page).
- Chromium only (SVG filters as `backdrop-filter`); unsupported browsers get a plain
  CSS blur/saturate fallback.

```html
<div class="card">…</div>
```

```ts
import {create} from '@goran.alkovic/liquid-glass';

create(document.querySelector('.card')!);
```

## How it works

1. A bezel profile (surface height function) describes the glass curvature from the
   element border (full thickness) to the end of the bezel (flat).
2. Snell–Descartes law converts local surface slope + thickness into a pixel
   displacement magnitude (pre-computed 128-step LUT).
3. The displacement vector field is baked into an **opaque** PNG
   (R = X, G = Y, 128 = neutral), slope-bounded (`maxDecay`) so the rim pull
   never reverses - the field cannot fold or mirror the backdrop.
4. The specular rim is a razor-thin (~1.6 px) one-sided line baked into a separate
   PNG; inside the SVG filter it masks a hyper-saturated copy of the refracted
   backdrop, topped by a faint gray glint.
5. The filter chain (blur → feImage → feDisplacementMap → rim compositing) is
   referenced from `backdrop-filter: url(#id)`.

Tiles are baked **9-slice style** and cached per shape, so resizes re-position the
tiles (cheap attribute updates) instead of re-baking. Elements sharing a `filterId`
share a single baked filter.

## Install

```sh
bun add @goran.alkovic/liquid-glass
```

Bundlers (ESM / CJS):

```ts
import {create} from '@goran.alkovic/liquid-glass';
```

Classic script (global `LiquidGlass`) - the IIFE build ships inside the npm
package:

```html
<script src="node_modules/@goran.alkovic/liquid-glass/dist/liquid-glass.min.js"></script>
```

## Usage

```ts
import {create, applyAll} from '@goran.alkovic/liquid-glass';

// one element
const glass = create(document.querySelector('.card'), {
	surface: 'convex-squircle',
	bezel: 64,
	thickness: 52,
	specular: {angle: 65, saturation: 6, opacity: 0.4},
});

// every element matching a selector
applyAll('[data-liquid-glass]');

// live tuning (cheap options don't re-bake)
glass.setOptions({scale: 1.4, blur: 2, specular: {opacity: 0.6}});

// tear down
glass.destroy();
```

### React

A hook ships at the `liquid-glass/react` subpath (React 18+ as an _optional_
peer dependency - non-React consumers never install it):

```tsx
import {useLiquidGlass} from '@goran.alkovic/liquid-glass/react';

function Card({strong}: {strong: boolean}) {
	const options = useMemo(() => ({thickness: strong ? 90 : 50}), [strong]);
	const {ref, glass, on, refresh, relayout} = useLiquidGlass(options);
	return <article ref={ref}>…</article>;
}
```

The controller is created when the node mounts and destroyed on unmount
(React 18 StrictMode-safe). Options flow through `setOptions` - memoize the
options object, identity is what triggers updates. `on` subscribes to typed
events even before the instance exists (subscriptions are queued and
re-attached across node swaps).

### Events

```ts
el.addEventListener('lglass:refresh', (e) => {
	// e.detail: { shared, renderScale, debugUrl, width, height, maxDisplacement }
});
el.addEventListener('lglass:relayout', (e) => {
	// e.detail: { width, height }
});
```

Or subscribe type-safely on the instance - `on` returns an unsubscribe
function, and event names/details are checked against the (open, declaration-mergeable)
`LiquidGlassEvents` map:

```ts
const off = glass.on('lglass:refresh', (e) => console.log(e.detail.renderScale));
off();
```

### Custom surfaces

`surface` accepts any registered profile name - register your own bezel
cross-section with `registerSurface` (the profile name becomes part of the
bake signature, so custom profiles never share cached tiles with built-ins):

```ts
import {registerSurface, listSurfaces} from '@goran.alkovic/liquid-glass';

registerSurface('prism', {
	f: (t) => 1 - (1 - t) * (1 - t), // thickness envelope, f(0)=0 → f(1)=1
	fp: (t) => 6 * (1 - t) * t, // slope driving Snell refraction
});

listSurfaces(); // ['convex-squircle', 'convex-circle', 'concave', 'lip', 'prism']
```

### Sharing one filter between identical elements

```ts
create(a, {filterId: 'toolbar'});
create(b, {filterId: 'toolbar'}); // attaches - no second bake
```

The group contract (size, corner radii, bake options) is validated; mismatching
elements fall back to a private filter with a console warning.

## Options

| Option                | Default                      | Description                                                                                                                        |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `surface`             | `'convex-squircle'`          | Bezel profile: `convex-squircle`, `convex-circle`, `concave`, `lip` - or any name added via `registerSurface`.                     |
| `bezel`               | `'auto'`                     | Refracting edge width in px. `'auto'` = `min(48, min(w, h) / 2)`.                                                                  |
| `thickness`           | `'auto'`                     | Virtual glass thickness in px - the main strength knob. `'auto'` = bezel.                                                          |
| `ior`                 | `1.5`                        | Refractive index.                                                                                                                  |
| `scale`               | `1`                          | Displacement multiplier. Cheap (no re-bake).                                                                                       |
| `saturate`            | `1`                          | Global saturation of the refracted backdrop. Cheap.                                                                                |
| `blur`                | `0`                          | Pre-displacement backdrop blur (px). Cheap.                                                                                        |
| `smooth`              | `0.15`                       | Post-displacement micro-blur (px) - smooths rendered refraction grain. Keep ≤ ~0.5. Cheap.                                         |
| `dispersion`          | `0`                          | Chromatic aberration, 0–0.5 - red/blue displaced slightly off green (three passes). Cheap.                                         |
| `settle`              | `0`                          | ms. While geometry churns, show the `fallback` and debounce the re-bake until quiet this long.                                     |
| `maxDecay`            | `1`                          | Displacement decay bound (px/px). `1` = fold-free rim by design; `0` = uncapped reference look. Affects the bake.                  |
| `specular.angle`      | `65`                         | Light travel direction, degrees (0° = from left, 90° = from top).                                                                  |
| `specular.saturation` | `6`                          | Saturation boost inside the rim line only. Cheap.                                                                                  |
| `specular.opacity`    | `0.4`                        | Opacity of the gray glint line. Cheap.                                                                                             |
| `specular.width`      | `1.6`                        | Rim line width (px).                                                                                                               |
| `specular.gray`       | `120`                        | Gray level of the glint color.                                                                                                     |
| `filterId`            | `null`                       | Share one baked filter across identical elements.                                                                                  |
| `renderScale`         | `'auto'`                     | Bake resolution multiplier (quality). `'auto'` = 1.25× for every element, always supersampled. Explicit numbers clamp to [0.5, 4]. |
| `throttleMs`          | `120`                        | Throttle for re-bakes on geometry changes.                                                                                         |
| `fallback`            | `'blur(10px) saturate(1.5)'` | `backdrop-filter` value for unsupported browsers.                                                                                  |
| `debug`               | `false`                      | Also bake an inspectable debug map (`mapDebugDataUrl`).                                                                            |
| `static`              | `false`                      | Generate once for the creation geometry - no observers, no automatic updates (see below).                                          |
| `supportedClass`      | `null`                       | Class(es) added when SVG `backdrop-filter` is supported - string or array.                                                         |
| `fallbackClass`       | `null`                       | Class(es) added when the CSS fallback is active - string or array.                                                                 |

### Static glass

For elements whose size is known and fixed, `static: true` skips the observers
entirely: the effect is generated once for the geometry at creation, and no
automatic re-bakes or re-layouts ever run - zero ongoing work after setup.

```ts
create(document.querySelector('.badge'), {static: true});
```

Cheap `setOptions` (scale, saturate, blur, specular opacity/saturation) still
applies - handy for hover effects - and `refresh()` can be called manually
after a known layout change. If the element is hidden (zero size) at creation,
call `refresh()` once it becomes visible. In a `filterId` group the owner's
updates still propagate to static followers.

### Standalone map generation

```ts
import {generateMaps, generateTiles} from '@goran.alkovic/liquid-glass';

const maps = generateMaps({width: 420, height: 56, borderRadius: 28});
// maps.mapDataUrl / maps.specularDataUrl - feed your own filter chain

const tiles = generateTiles({borderRadius: 28}); // 9-slice, size-independent
```

### Static filters

Need just the SVG filter - no element controller, no observers? Generate one
for a border radius and reference it from CSS yourself:

```ts
import {createFilter} from '@goran.alkovic/liquid-glass';

const f = createFilter({borderRadius: 28, width: 420, height: 56});
el.style.backdropFilter = f.url; // Chromium: full refraction

f.layout(480, 64); // cheap re-layout for a new size (no re-bake)
f.destroy(); // remove the <filter> from the DOM
```

Returns `{ id, url, element, maxDisplacement, layout(), destroy() }`. Tiles
come from the same cache as the element controllers, so identical geometries
share bakes. As `backdrop-filter` this is Chromium-only; as a regular
`filter` it works anywhere SVG filters do.

### Browser support

```ts
import {isSupported} from '@goran.alkovic/liquid-glass';
if (!isSupported()) {
	/* the CSS fallback is active */
}
```

Or let the library tag your elements - `supportedClass` / `fallbackClass` are
added/removed automatically (and swapped if detection changes), so you can
branch your CSS on capability:

```ts
create(el, {supportedClass: 'glass-ok glass-ready', fallbackClass: ['glass-fallback', 'no-refraction']});
```

### Safari (in progress)

WebKit has an implementation of `backdrop-filter: url()` reference filters in
review ([bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510), PRs
68613/68614/69566). Detection is version-gated for it, so the library stays on
the CSS fallback until the shipping Safari version is confirmed. To test a
Technology Preview that carries the work today:

```ts
import {forceSupported} from '@goran.alkovic/liquid-glass';
forceSupported(true); // false disables, null returns to sniffing
```

### Firefox

Firefox's WebRender silently drops `backdrop-filter` when it would need an SVG
filter graph ([bug 1961378](https://bugzilla.mozilla.org/show_bug.cgi?id=1961378)),
so those browsers get the CSS `fallback`. (An interoperable spec solution - a
`BackdropGraphic` filter input - is being discussed in
[svgwg#1142](https://github.com/w3c/svgwg/issues/1142).)

## Development

```sh
bun install
bun run build # typecheck + lint + dist (esm, cjs, iife, iife.min, .d.ts)
bun run dev # watch the browser (IIFE) bundle
bun run check # typecheck only
bun run lint # oxlint
bun run format # prettier
```

Open `examples/` for the interactive React demo - served by Bun standalone
(HTML imports + HMR, no bundler config):

```sh
cd examples
bun install
bun run dev # http://localhost:5173 (or from the repo root: bun run example)
bun run build # static production build → examples/dist
```

`examples/src/Glass.tsx` is a small wrapper component built on the hook (create
on mount, `setOptions` on prop changes, `destroy` on unmount) - copy it into
your app or adapt it. Note bun's watcher only covers the project directory it
runs from: `bun run example` from the repo root watches both the app and the
library source.

Source layout (`src/`): `types` (public types) · `options` · `surfaces` (the
profile registry + `registerSurface`) · `sampler` · `bake` · `cache` ·
`geometry` · `svg` · `filter` (the SVG `<filter>` node + slice layout) ·
`static-filter` (`createFilter`) · `react` (the `useLiquidGlass` hook) ·
`controller` (the `LiquidGlass` class) - everything below the controller is
pure (or canvas-only) and unit-testable in isolation.

## License

[MIT](./LICENSE)
