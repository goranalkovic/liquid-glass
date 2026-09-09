# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-09

### Added

- **`dispersion` option** (0–0.5, default `0`) — chromatic aberration: red and
  blue are displaced slightly off green using three displacement passes,
  channel-isolated and summed (`feComposite arithmetic`). Filter-level: applies
  without re-baking. Caveat: the passes sum alpha, so very translucent backdrops
  can darken slightly.
- **`maxDecay` option** (px/px, default `1`) — bounded-slope displacement
  field: caps how fast the rim pull may decay toward the border, so the sampled
  source position never reverses. Above ~1 px/px the 8-bit map folds — the rim
  mirrors the backdrop and renders as jagged, doubled fragments — and the fold
  band covers most of thick, small glass. `1` is the exact no-fold threshold
  (strongest pull that renders clean); `0` restores the uncapped reference
  profile. Affects the bake and the tile-cache/sharing signature.
- **`smooth` option** (px, default `0.15`) — post-displacement micro-blur:
  smooths the rendered refraction itself, melting the residual fine texture of
  the rim band at the cost of a touch of refracted detail. Keep it small
  (≤ ~0.5px). Filter-level: applies without re-baking.
- **`settle` option** (ms, default `0`) — while the geometry churns
  (border-radius or shape changes), the element immediately shows the plain CSS
  `fallback` and the re-bake is debounced until the geometry has been quiet for
  this long, instead of re-baking on every throttle tick. Useful for morphs into
  shapes that have never been baked.
- **`forceSupported(true | false | null)`** — exported escape hatch that
  overrides the SVG `backdrop-filter` capability verdict manually (there is no
  way to read back what a backdrop filter painted, so a browser can parse the
  value without rendering it).
- **`checkSvgBackdropSupport`** is now exported alongside `isSupported`.

### Changed

- **`supportedClass` / `fallbackClass` accept multiple classes**: a single
  class, a space-separated string, or an array of classes. Non-breaking —
  single-class strings behave exactly as before. Values are normalized
  (whitespace collapsed) and applied/removed as proper token lists.
- **`blur` default is now `0`** (was `0.2`) — crisper glass by default;
  rim-band smoothing moved to the post-displacement `smooth` filter.
- **Blue-noise map dither**: the displacement map is quantized with
  interleaved-gradient-noise dithering instead of plain rounding — the
  8-bit level boundaries no longer read as stair-stepped contours in the
  refracted content, and unlike a Bayer tile the noise has no regular
  cross-hatch structure. The exactly-neutral interior stays perfectly still.
- **Uniform `'auto'` bake quality at 1.25×**: every element now bakes at
  1.25× regardless of size — small shapes get the same rim definition as large
  ones, and every bake is supersampled at least 2× (the downsample averages
  the quantization dither into sub-level precision). Cost stays bounded by
  tile size (tiles are cached per shape). Replaces the previous size-based
  tiers (0.75×/1×/1.5×/2×).
- **WebKit detection prepped**: `backdrop-filter: url()` reference filters are
  in review at WebKit ([bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510),
  PRs 68613/68614/69566). Detection is engine-version-gated so current Safari —
  which parses the value but renders nothing — stays on the CSS fallback. Flip
  `WEBKIT_VERSION_FLOOR` in `support.ts` when the shipping release is
  confirmed, or call `forceSupported(true)` to opt in early.

[1.1.0]: https://github.com/goranalkovic/liquid-glass/compare/v1.0.0...v1.1.0
