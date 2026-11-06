import type { IDataObject } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

export const POLL_INTERVAL_MS = 2000;
export const MAX_WAIT_SECONDS = 300;

export const ISSUE_TERMINAL = ['Issued', 'IssueFailed'];
/** A cancellation can only end in these two; `Issued` here means the request is still queued. */
export const CANCEL_TERMINAL = ['Cancelled', 'CancelFailed'];

export interface WaitResult {
	invoice: IDataObject;
	timedOut: boolean;
}

/**
 * Polls the invoice until `flowStatus` is terminal. `status` alone is not used: it reads
 * `Issued` while `flowStatus` is still `WaitingDownload` and the PDF is not ready.
 * A read that fails (after the GET retries) ends the wait as a timeout: the invoice was already
 * accepted, so it is returned instead of an error that would invite a duplicate issue.
 */
export async function waitForFlowStatus(
	initial: IDataObject,
	fetchInvoice: () => Promise<IDataObject>,
	terminal: string[],
	timeoutSeconds: number,
	intervalMs = POLL_INTERVAL_MS,
): Promise<WaitResult> {
	const seconds = Math.min(Math.max(Number(timeoutSeconds) || 0, 0), MAX_WAIT_SECONDS);
	const deadline = Date.now() + seconds * 1000;
	const maxPolls = Math.ceil((seconds * 1000) / intervalMs);
	let invoice = initial;

	for (let poll = 0; ; poll++) {
		if (terminal.includes(String(invoice.flowStatus))) return { invoice, timedOut: false };
		if (poll >= maxPolls || Date.now() >= deadline) return { invoice, timedOut: true };
		await sleep(intervalMs);
		try {
			invoice = await fetchInvoice();
		} catch {
			return { invoice, timedOut: true };
		}
	}
}

export function clampWaitSeconds(value: unknown): number {
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds < 1) return 1;
	return Math.min(Math.floor(seconds), MAX_WAIT_SECONDS);
}
