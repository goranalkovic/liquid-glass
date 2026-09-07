/**
 * Tiny server for the React example - Bun standalone, zero bundler config.
 *
 * The HTML import below is bundled by Bun's built-in pipeline (TSX, CSS and
 * the `liquid-glass` source resolved through tsconfig `paths`), and running
 * with `bun --hot` adds client-side HMR on top.
 *
 *   bun --hot server.ts   # dev (HMR)
 *   bun server.ts         # prod-style serving
 */
import index from './index.html';

const port = Number(process.env.PORT) || 5173;

Bun.serve({
	port,
	routes: {
		'/': index,
	},
});

console.log(`Liquid Glass React example → http://localhost:${port}`);
