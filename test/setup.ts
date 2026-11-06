import { vi } from 'vitest';

// Unit tests never wait: polling, retries and reconciliation call `sleep` from n8n-workflow.
vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return { ...actual, sleep: vi.fn(async () => {}) };
});
