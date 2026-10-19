import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	IWebhookFunctions,
} from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { buildApiError, buildNetworkError, type FailureHint } from './errors';

export type NfeContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

export const CREDENTIAL_NAME = 'nfeApi';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const ISSUE_TIMEOUT_MS = 90_000;
export const OPEN_API_TIMEOUT_MS = 10_000;

/** Statuses retried on GET requests. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export interface NfeRequest {
	method: IHttpRequestMethods;
	url: string;
	qs?: IDataObject;
	body?: IDataObject;
	timeout?: number;
	/** Binary download: no JSON parsing and no redirect following. */
	binary?: boolean;
}

export interface NfeResponse {
	statusCode: number;
	headers: IDataObject;
	body: unknown;
}

export type RawResult =
	| { kind: 'response'; response: NfeResponse }
	| { kind: 'network'; error: unknown };

export interface RequestOptions {
	itemIndex?: number;
	/** Statuses returned to the caller instead of failing. */
	allowStatus?: number[];
	/** Custom message per status code. */
	hints?: Record<number, FailureHint>;
	/** Overrides the method-based retry rule (GET only by default). */
	retry?: boolean;
}

function toResponse(raw: IN8nHttpFullResponse | IDataObject): NfeResponse {
	const full = raw as IN8nHttpFullResponse;
	return {
		statusCode: Number(full.statusCode ?? 0),
		headers: (full.headers ?? {}) as IDataObject,
		body: full.body,
	};
}

function buildOptions(request: NfeRequest): IHttpRequestOptions {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		timeout: request.timeout ?? DEFAULT_TIMEOUT_MS,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { Accept: request.binary ? '*/*' : 'application/json' },
	};
	if (request.qs && Object.keys(request.qs).length > 0) options.qs = request.qs;
	if (request.body !== undefined) options.body = request.body;
	if (request.binary) {
		options.encoding = 'arraybuffer';
		options.json = false;
		options.disableFollowRedirect = true;
	} else {
		options.json = true;
	}
	return options;
}

/**
 * Single authenticated call, without retries. Network failures are returned, not thrown,
 * so the issue flow can reconcile instead of re-sending.
 */
export async function rawRequest(ctx: NfeContext, request: NfeRequest): Promise<RawResult> {
	try {
		const raw = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIAL_NAME,
			buildOptions(request),
		)) as IN8nHttpFullResponse;
		return { kind: 'response', response: toResponse(raw) };
	} catch (error) {
		return { kind: 'network', error };
	}
}

export function retryDelayMs(attempt: number, headers?: IDataObject): number {
	const retryAfter = headers?.['retry-after'];
	if (retryAfter !== undefined) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
		}
	}
	return Math.min(1000 * 2 ** attempt, MAX_RETRY_AFTER_MS);
}

/**
 * Authenticated call with the package rules: finite timeout, retries only for GET
 * (network, 429, 502, 503, 504) and actionable errors with the request ID.
 */
export async function apiRequest(
	ctx: NfeContext,
	request: NfeRequest,
	options: RequestOptions = {},
): Promise<NfeResponse> {
	const canRetry = options.retry ?? request.method === 'GET';
	const node = ctx.getNode();

	for (let attempt = 0; ; attempt++) {
		const result = await rawRequest(ctx, request);
		const retriesLeft = canRetry && attempt < MAX_RETRIES;

		if (result.kind === 'network') {
			if (retriesLeft) {
				await sleep(retryDelayMs(attempt));
				continue;
			}
			throw buildNetworkError(node, result.error, options.itemIndex);
		}

		const { response } = result;
		const { statusCode } = response;
		const isSuccess = statusCode >= 200 && statusCode < 300;
		const isRedirect = request.binary === true && statusCode >= 300 && statusCode < 400;
		if (isSuccess || isRedirect || options.allowStatus?.includes(statusCode)) {
			return response;
		}
		if (retriesLeft && RETRYABLE_STATUS.has(statusCode)) {
			await sleep(retryDelayMs(attempt, response.headers));
			continue;
		}
		throw buildApiError(
			node,
			{ statusCode, body: response.body, headers: response.headers },
			request.url,
			options.itemIndex,
			options.hints?.[statusCode],
		);
	}
}

/** Shortcut for JSON calls that only need the body. */
export async function apiRequestBody<T = IDataObject>(
	ctx: NfeContext,
	request: NfeRequest,
	options: RequestOptions = {},
): Promise<T> {
	const response = await apiRequest(ctx, request, options);
	return response.body as T;
}
