import type { IDataObject, IHttpRequestOptions, IN8nHttpFullResponse } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { buildApiError, buildNetworkError, type FailureHint } from './errors';
import { OPEN_API_TIMEOUT_MS, retryDelayMs, type NfeContext, type NfeResponse } from './request';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

export interface PublicGetOptions {
	itemIndex?: number;
	timeout?: number;
	binary?: boolean;
	/** New attempts on network failure, 429, 502, 503 and 504 (default 3). */
	retries?: number;
	allowStatus?: number[];
	hints?: Record<number, FailureHint>;
	/** Label used in place of the URL in error messages (pre-signed URLs must never leak). */
	label?: string;
}

/**
 * GET without credentials: open.nfe.io, the public event type list and the second hop of a
 * document download (pre-signed URL). The URL is never added to errors or output.
 */
export async function publicGet(
	ctx: NfeContext,
	url: string,
	options: PublicGetOptions = {},
): Promise<NfeResponse> {
	const node = ctx.getNode();
	const request: IHttpRequestOptions = {
		method: 'GET',
		url,
		timeout: options.timeout ?? OPEN_API_TIMEOUT_MS,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.binary) {
		request.encoding = 'arraybuffer';
		request.json = false;
	} else {
		request.json = true;
		request.headers = { Accept: 'application/json' };
	}

	const maxRetries = options.retries ?? MAX_RETRIES;
	for (let attempt = 0; ; attempt++) {
		let raw: IN8nHttpFullResponse;
		try {
			raw = (await ctx.helpers.httpRequest(request)) as IN8nHttpFullResponse;
		} catch (error) {
			if (attempt < maxRetries) {
				await sleep(retryDelayMs(attempt));
				continue;
			}
			throw buildNetworkError(node, error, options.itemIndex);
		}
		const response: NfeResponse = {
			statusCode: Number(raw.statusCode ?? 0),
			headers: (raw.headers ?? {}) as IDataObject,
			body: raw.body,
		};
		const { statusCode } = response;
		if ((statusCode >= 200 && statusCode < 300) || options.allowStatus?.includes(statusCode)) {
			return response;
		}
		if (attempt < maxRetries && RETRYABLE_STATUS.has(statusCode)) {
			await sleep(retryDelayMs(attempt, response.headers));
			continue;
		}
		throw buildApiError(
			node,
			{ statusCode, body: options.binary ? '' : response.body, headers: response.headers },
			options.label ?? url,
			options.itemIndex,
			options.hints?.[statusCode],
		);
	}
}
