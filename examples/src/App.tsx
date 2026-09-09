import {useCallback, useMemo, useRef, useState} from 'react';
import type {LiquidGlassOptions, LiquidGlassRefreshDetail, SurfaceName} from '@goran.alkovic/liquid-glass';
import {isSupported} from '@goran.alkovic/liquid-glass';
import {Glass} from './Glass';

const SURFACES: Array<{name: SurfaceName; label: string}> = [
	{name: 'convex-squircle', label: 'Convex squircle'},
	{name: 'convex-circle', label: 'Convex circle'},
	{name: 'concave', label: 'Concave'},
	{name: 'lip', label: 'Lip'},
];

interface SliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	display?: string;
	onChange: (v: number) => void;
}

function Slider({label, value, min, max, step, display, onChange}: SliderProps) {
	return (
		<label className='row'>
			<span>
				{label} <output>{display ?? value}</output>
			</span>
			<input
				type='range'
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value))}
			/>
		</label>
	);
}

/** Draggable glass shape - position changes never re-bake (only size matters). */
function ShapeLens({options, className, label}: {options: LiquidGlassOptions; className: string; label: string}) {
	const drag = useRef<{dx: number; dy: number} | null>(null);
	return (
		<Glass
			className={'glass lens ' + className}
			options={options}
			onPointerDown={(e) => {
				const el = e.currentTarget;
				drag.current = {dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop};
				el.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (!drag.current) return;
				e.currentTarget.style.left = e.clientX - drag.current.dx + 'px';
				e.currentTarget.style.top = e.clientY - drag.current.dy + 'px';
			}}
			onPointerUp={() => (drag.current = null)}
			onPointerCancel={() => (drag.current = null)}
		>
			<span>{label}</span>
		</Glass>
	);
}

export default function App() {
	// playground config - applied live to every glass element
	const [surface, setSurface] = useState<SurfaceName>('convex-squircle');
	const [bezel, setBezel] = useState(64);
	const [thickness, setThickness] = useState(52);
	const [ior, setIor] = useState(1.5);
	const [scale, setScale] = useState(1);
	const [blur, setBlur] = useState(0);
	const [smooth, setSmooth] = useState(0.15);
	const [dispersion, setDispersion] = useState(0);
	const [maxDecay, setMaxDecay] = useState(1);
	const [sat, setSat] = useState(6);
	const [rimOpacity, setRimOpacity] = useState(0.4);
	const [angle, setAngle] = useState(65);
	const [rimWidth, setRimWidth] = useState(1.6);

	// bake quality: auto, or explicit 0.5–4×
	const [rsAuto, setRsAuto] = useState(true);
	const [rsExplicit, setRsExplicit] = useState(2);
	const [resolvedRs, setResolvedRs] = useState(1);

	// debug map preview (from the card's refresh events)
	const [preview, setPreview] = useState<{url: string; w: number; h: number} | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const supported = useMemo(() => isSupported(), []);

	const options = useMemo<LiquidGlassOptions>(
		() => ({
			surface,
			bezel,
			thickness,
			ior,
			scale,
			blur,
			smooth,
			dispersion,
			maxDecay,
			renderScale: rsAuto ? 'auto' : rsExplicit,
			specular: {saturation: sat, opacity: rimOpacity, angle, width: rimWidth},
		}),
		[
			surface,
			bezel,
			thickness,
			ior,
			scale,
			blur,
			smooth,
			dispersion,
			maxDecay,
			rsAuto,
			rsExplicit,
			sat,
			rimOpacity,
			angle,
			rimWidth,
		],
	);
	const cardOptions = useMemo<LiquidGlassOptions>(() => ({...options, debug: true}), [options]);

	const onCardRefresh = useCallback((e: CustomEvent<LiquidGlassRefreshDetail>) => {
		const d = e.detail;
		if (d.debugUrl && d.width && d.height) setPreview({url: d.debugUrl, w: d.width, h: d.height});
		if (d.renderScale != null) setResolvedRs(d.renderScale);
	}, []);

	return (
		<>
			{/* ================= backdrop scene ================= */}
			<div className='scene' aria-hidden='true'>
				<div className='blob b1' />
				<div className='blob b2' />
				<div className='blob b3' />
				<div className='gridlines' />
				<div className='marquee m1'>
					<span>
						LIQUID GLASS · REFRACTION · LIQUID GLASS · REFRACTION · LIQUID GLASS · REFRACTION · LIQUID GLASS ·
						REFRACTION ·&nbsp;
					</span>
				</div>
				<div className='marquee m2'>
					<span>
						DISPLACEMENT · SPECULAR · DISPLACEMENT · SPECULAR · DISPLACEMENT · SPECULAR · DISPLACEMENT · SPECULAR
						·&nbsp;
					</span>
				</div>
				<div className='marquee m3'>
					<span>SNELL DESCARTES · n₁sinθ₁ = n₂sinθ₂ · SNELL DESCARTES · n₁sinθ₁ = n₂sinθ₂ ·&nbsp;</span>
				</div>
				<div className='vignette' />
			</div>

			{/* ================= glass elements ================= */}
			<Glass as='section' className='glass card' options={cardOptions} onRefresh={onCardRefresh}>
				<div className='eyebrow'>Lorem ipsum · dolor sit amet</div>
				<h1>
					Lorem ipsum,
					<br />
					dolor sit amet.
				</h1>
				<p>
					Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
					minim veniam, quis nostrud <code>exercitation ullamco</code> laboris.
				</p>
				<div className='row-actions'>
					<button className='btn solid'>Lorem ipsum</button>
					<a className='btn ghost' href='#'>
						Dolor sit amet
					</a>
				</div>
				<div className='hint'>
					<b>Lorem ipsum dolor</b> sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et
					dolore magna aliqua.
				</div>
			</Glass>

			<Glass as='button' className='glass fab' options={options} aria-label='Add'>
				+
			</Glass>

			<ShapeLens options={options} className='lens-circle' label='drag me' />

			{/* shape lab - sharp corners (r = 0) work like any other radius */}
			<ShapeLens options={options} className='lens-sq-sharp' label='sharp' />
			<ShapeLens options={options} className='lens-sq-rounded' label='rounded' />
			<ShapeLens options={options} className='lens-rect-sharp' label='rect · sharp' />
			<ShapeLens options={options} className='lens-rect-rounded' label='rect · rounded' />

			<Glass as='button' className='glass grow' options={options} aria-label='Grow on hover'>
				Grow <span className='chev'>→</span>
			</Glass>

			<Glass
				as='button'
				className='glass morph'
				options={options}
				aria-label='Square that becomes a rectangle on hover'
			>
				<span className='glyph' />
			</Glass>

			{/* ================= controls ================= */}
			<button className='panel-toggle show' onClick={() => setCollapsed((c) => !c)} aria-label='Toggle controls'>
				{collapsed ? '⚙' : '✕'}
			</button>
			<aside className={'panel' + (collapsed ? ' collapsed' : '')}>
				<h2>Playground</h2>
				<div className='sub'>Applies live to every glass element on the page.</div>

				<div className='seg' role='group' aria-label='Surface profile'>
					{SURFACES.map((s) => (
						<button key={s.name} className={surface === s.name ? 'on' : ''} onClick={() => setSurface(s.name)}>
							{s.label}
						</button>
					))}
				</div>

				<Slider label='Bezel width' value={bezel} min={8} max={96} step={1} onChange={setBezel} />
				<Slider label='Glass thickness' value={thickness} min={4} max={120} step={1} onChange={setThickness} />
				<Slider label='Refractive index' value={ior} min={1} max={2.5} step={0.01} onChange={setIor} />
				<Slider label='Refraction level' value={scale} min={0} max={2} step={0.01} onChange={setScale} />
				<Slider label='Backdrop blur' value={blur} min={0} max={8} step={0.1} onChange={setBlur} />
				<Slider label='Smooth' value={smooth} min={0} max={1.5} step={0.05} onChange={setSmooth} />
				<Slider label='Dispersion' value={dispersion} min={0} max={0.5} step={0.01} onChange={setDispersion} />
				<Slider label='Fold guard' value={maxDecay} min={0} max={1} step={0.05} onChange={setMaxDecay} />

				<div className='row'>
					<span>
						Bake quality
						<button
							type='button'
							className={'auto-btn' + (rsAuto ? ' on' : '')}
							title='Grid-aligned tier by rendered size (0.75×, 1×, 1.5×, 2×), capped by tile extent'
							onClick={() => setRsAuto(true)}
						>
							auto
						</button>
						<output>{rsAuto ? `auto → ${resolvedRs}×` : `${rsExplicit}×`}</output>
					</span>
					<input
						type='range'
						min={0.5}
						max={4}
						step={0.25}
						value={rsAuto ? resolvedRs : rsExplicit}
						aria-label='Bake quality multiplier'
						onChange={(e) => {
							setRsAuto(false);
							setRsExplicit(parseFloat(e.target.value));
						}}
					/>
				</div>

				<hr className='divider' />

				<Slider label='Rim saturation' value={sat} min={0} max={20} step={0.5} onChange={setSat} />
				<Slider label='Rim opacity' value={rimOpacity} min={0} max={1} step={0.01} onChange={setRimOpacity} />
				<Slider label='Light angle (°)' value={angle} min={-180} max={180} step={1} onChange={setAngle} />
				<Slider label='Rim width' value={rimWidth} min={0.5} max={6} step={0.1} onChange={setRimWidth} />

				<hr className='divider' />
				{preview && (
					<img
						className='map-preview'
						alt='Generated displacement + specular map (debug view)'
						src={preview.url}
						width={preview.w}
						height={preview.h}
					/>
				)}
				<div className='maplabel'>
					Card map - R/G channels encode X/Y displacement (128 = neutral), blue is the razor-thin rim line.
				</div>
				<div className='maplabel'>
					{preview ? `baked at ${resolvedRs}× · card ${preview.w}×${preview.h} · radius 30px` : ''}
				</div>
				<div className={'support-badge ' + (supported ? 'ok' : 'no')}>
					{supported
						? 'SVG backdrop-filter: supported ✓'
						: 'SVG backdrop-filter unsupported here - blur fallback active'}
				</div>
			</aside>
		</>
	);
}
