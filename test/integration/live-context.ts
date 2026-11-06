/**
 * Real HTTP for the opt-in integration tests: the node runs with the same credential
 * (`authenticate` by host) against the NFE.io API. Keys come from the environment and never
 * reach the output of the tests.
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { inject } from 'vitest';

import { NfeApi } from '../../credentials/NfeApi.credentials';
import { executeContext } from '../helpers/context';

// Read from the environment by vitest.integration.config.mts.
const settings = inject('nfeLive');

export const LIVE = settings.live;
export const LIVE_WRITE = settings.live && settings.write;

export function liveCredentials(): IDataObject {
	return { apiKey: settings.apiKey, dataApiKey: settings.dataApiKey };
}

export const LIVE_COMPANY_ID = settings.companyId;

/** Calls made by the node, without headers (the key stays out of reports). */
export const liveCalls: Array<{ method: string; host: string; status: number }> = [];

function urlWithQuery(options: IHttpRequestOptions): URL {
	const url = new URL(options.url, options.baseURL);
	for (const [key, value] of Object.entries((options.qs ?? {}) as IDataObject)) {
		if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	}
	return url;
}

async function send(options: IHttpRequestOptions) {
	const url = urlWithQuery(options);
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries((options.headers ?? {}) as IDataObject)) {
		if (value !== undefined) headers[key] = String(value);
	}
	let body: string | undefined;
	if (options.body !== undefined) {
		body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
		headers['Content-Type'] ??= 'application/json';
	}
	const response = await fetch(url, {
		method: options.method ?? 'GET',
		headers,
		body,
		redirect: options.disableFollowRedirect ? 'manual' : 'follow',
		signal: AbortSignal.timeout(options.timeout ?? 30_000),
	});
	liveCalls.push({ method: options.method ?? 'GET', host: url.hostname, status: response.status });
	const responseHeaders: IDataObject = {};
	response.headers.forEach((value, key) => (responseHeaders[key] = value));
	const raw = Buffer.from(await response.arrayBuffer());
	let parsed: unknown = raw;
	if (options.encoding !== 'arraybuffer') {
		const text = raw.toString('utf8');
		try {
			parsed = text === '' ? undefined : JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	if (!options.ignoreHttpStatusErrors && response.status >= 400) {
		throw new Error(`HTTP ${response.status}`);
	}
	return options.returnFullResponse
		? { statusCode: response.status, headers: responseHeaders, body: parsed }
		: parsed;
}

/** Execute context of the unit helpers with real HTTP instead of the fake API. */
export function liveContext(params: IDataObject | IDataObject[], credentials = liveCredentials()) {
	const context = executeContext({
		params,
		credentials,
		executionId: `live-${Date.now()}`,
	}) as unknown as { helpers: IDataObject };
	const credential = new NfeApi();
	context.helpers = {
		...context.helpers,
		httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
			await send(await credential.authenticate(credentials as never, options)),
		httpRequest: async (options: IHttpRequestOptions) => await send(options),
	};
	return context as unknown as IExecuteFunctions;
}
