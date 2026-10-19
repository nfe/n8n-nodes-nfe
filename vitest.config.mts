import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
	resolve: {
		// Same CommonJS build that n8n loads at runtime (the ESM build's source maps are not shipped).
		alias: { 'n8n-workflow': require.resolve('n8n-workflow') },
	},
	test: {
		include: ['test/unit/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
		environment: 'node',
		server: { deps: { external: [/node_modules\/n8n-workflow/] } },
		coverage: {
			provider: 'v8',
			include: ['nodes/**/*.ts', 'credentials/**/*.ts'],
			reporter: ['text-summary', 'text'],
			thresholds: { lines: 85, branches: 80 },
		},
	},
});
