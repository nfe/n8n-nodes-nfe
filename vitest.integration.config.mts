import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const env = process.env;

declare module 'vitest' {
	export interface ProvidedContext {
		nfeLive: {
			live: boolean;
			write: boolean;
			apiKey: string;
			dataApiKey: string;
			companyId: string;
		};
	}
}

// Opt-in tests against the real API (see test/integration/live.test.ts). Real `sleep`, no mocks.
export default defineConfig({
	resolve: {
		alias: { 'n8n-workflow': require.resolve('n8n-workflow') },
	},
	test: {
		include: ['test/integration/**/*.test.ts'],
		environment: 'node',
		server: { deps: { external: [/node_modules\/n8n-workflow/] } },
		testTimeout: 300_000,
		fileParallelism: false,
		provide: {
			nfeLive: {
				live: env.NFE_LIVE === '1',
				write: env.NFE_LIVE_WRITE === '1',
				apiKey: env.NFE_API_KEY ?? '',
				dataApiKey: env.NFE_DATA_API_KEY ?? '',
				companyId: env.NFE_COMPANY_ID ?? '',
			},
		},
	},
});
