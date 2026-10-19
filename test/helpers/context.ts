import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IWebhookFunctions,
} from 'n8n-workflow';
import { vi } from 'vitest';

/** Response returned by the fake HTTP layer, or a network failure to throw. */
export interface FakeResponse {
	statusCode?: number;
	headers?: IDataObject;
	body?: unknown;
	/** Throws instead of answering (timeout, connection reset...). */
	networkError?: { code: string; message?: string };
}

type Matcher = string | RegExp | ((options: IHttpRequestOptions) => boolean);

interface Route {
	method: string;
	matcher: Matcher;
	responses: Array<FakeResponse | ((options: IHttpRequestOptions) => FakeResponse)>;
	calls: number;
}

export interface RecordedCall {
	authenticated: boolean;
	credential?: string;
	options: IHttpRequestOptions;
}

/**
 * Table of fake NFE.io answers. Routes are matched in order; each route answers its
 * responses in sequence and repeats the last one.
 */
export class FakeApi {
	routes: Route[] = [];

	calls: RecordedCall[] = [];

	on(method: string, matcher: Matcher, ...responses: Route['responses']): this {
		this.routes.push({ method, matcher, responses, calls: 0 });
		return this;
	}

	private match(route: Route, options: IHttpRequestOptions): boolean {
		if (route.method !== (options.method ?? 'GET')) return false;
		const url = options.url;
		if (typeof route.matcher === 'string') return url === route.matcher;
		if (route.matcher instanceof RegExp) return route.matcher.test(url);
		return route.matcher(options);
	}

	async handle(options: IHttpRequestOptions, authenticated: boolean, credential?: string) {
		this.calls.push({ authenticated, credential, options });
		const route = this.routes.find((candidate) => this.match(candidate, options));
		if (!route) throw new Error(`No fake route for ${options.method ?? 'GET'} ${options.url}`);
		const next = route.responses[Math.min(route.calls, route.responses.length - 1)];
		route.calls++;
		const response = typeof next === 'function' ? next(options) : next;
		if (response.networkError) {
			const error = new Error(
				response.networkError.message ?? response.networkError.code,
			) as Error & {
				code: string;
			};
			error.code = response.networkError.code;
			throw error;
		}
		return {
			statusCode: response.statusCode ?? 200,
			headers: { 'x-request-id': 'req-test-1', ...(response.headers ?? {}) },
			body: response.body,
		};
	}

	callsTo(method: string, pattern: RegExp): RecordedCall[] {
		return this.calls.filter(
			(call) => (call.options.method ?? 'GET') === method && pattern.test(call.options.url),
		);
	}
}

export const TEST_NODE: INode = {
	id: 'node-1',
	name: 'NFE.io',
	type: 'n8n-nodes-nfe.nfe',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};

function readParameter(
	params: IDataObject,
	name: string,
	fallback: unknown,
	options?: { extractValue?: boolean },
): unknown {
	let value: unknown = name
		.split('.')
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === 'object' ? (current as IDataObject)[key] : undefined,
			params,
		);
	if (value === undefined) value = fallback;
	if (
		options?.extractValue &&
		value &&
		typeof value === 'object' &&
		'value' in (value as IDataObject)
	) {
		return (value as IDataObject).value;
	}
	return value;
}

export interface ContextOptions {
	/** Parameters for every item, or one object per item. */
	params: IDataObject | IDataObject[];
	api?: FakeApi;
	items?: number;
	continueOnFail?: boolean;
	credentials?: IDataObject;
	executionId?: string;
	/** `$thisRunIndex` of the node (0 on the first run, 1 on the second loop round...). */
	runIndex?: number;
	/** typeVersion saved in the workflow (2 by default). */
	typeVersion?: number;
}

function helpers(api: FakeApi) {
	return {
		httpRequestWithAuthentication: vi.fn(
			async (credential: string, options: IHttpRequestOptions) =>
				await api.handle(options, true, credential),
		),
		httpRequest: vi.fn(async (options: IHttpRequestOptions) => await api.handle(options, false)),
		prepareBinaryData: vi.fn(async (data: Buffer, fileName?: string, mimeType?: string) => ({
			data: data.toString('base64'),
			fileName,
			mimeType: mimeType ?? 'application/octet-stream',
			fileSize: String(data.length),
		})),
	};
}

export function executeContext(options: ContextOptions): IExecuteFunctions {
	const api = options.api ?? new FakeApi();
	const perItem = Array.isArray(options.params);
	const count = options.items ?? (perItem ? (options.params as IDataObject[]).length : 1);
	const paramsFor = (index: number) =>
		perItem ? (options.params as IDataObject[])[index] : (options.params as IDataObject);
	const node = { ...TEST_NODE, typeVersion: options.typeVersion ?? TEST_NODE.typeVersion };
	const context = {
		getNode: () => node,
		getInputData: () => Array.from({ length: count }, () => ({ json: {} })),
		getNodeParameter: (
			name: string,
			index: number,
			fallback?: unknown,
			opts?: { extractValue?: boolean },
		) => readParameter(paramsFor(index), name, fallback, opts),
		continueOnFail: () => options.continueOnFail ?? false,
		getCredentials: vi.fn(
			async () => options.credentials ?? { apiKey: 'main-key', dataApiKey: 'data-key' },
		),
		getTimezone: () => 'America/Sao_Paulo',
		getExecutionId: () => options.executionId ?? 'execution-1',
		getWorkflowDataProxy: () => ({ $thisRunIndex: options.runIndex ?? 0 }),
		helpers: helpers(api),
	};
	return context as unknown as IExecuteFunctions;
}

export function loadOptionsContext(api: FakeApi, params: IDataObject = {}): ILoadOptionsFunctions {
	const context = {
		getNode: () => TEST_NODE,
		getNodeParameter: (name: string, fallback?: unknown) => readParameter(params, name, fallback),
		getCurrentNodeParameter: (name: string) => readParameter(params, name, undefined),
		helpers: helpers(api),
	};
	return context as unknown as ILoadOptionsFunctions;
}

/** `staticData` is the node static data (`getWorkflowStaticData('node')`), shared by reference. */
export function hookContext(
	api: FakeApi,
	params: IDataObject,
	staticData: IDataObject = {},
	webhookUrl = 'https://n8n.example.com/webhook/abc/webhook',
	mode = 'trigger',
): IHookFunctions {
	const workflowStaticData = staticData;
	const context = {
		getMode: () => mode,
		getNode: () => ({
			...TEST_NODE,
			name: 'NFE.io Trigger',
			type: 'n8n-nodes-nfe.nfeTrigger',
			typeVersion: 1,
		}),
		getNodeParameter: (name: string, fallback?: unknown, opts?: { extractValue?: boolean }) =>
			readParameter(params, name, fallback, opts),
		getNodeWebhookUrl: () => webhookUrl,
		getWorkflowStaticData: () => workflowStaticData,
		helpers: helpers(api),
	};
	return context as unknown as IHookFunctions;
}

export interface WebhookRequest {
	rawBody?: string;
	headers?: IDataObject;
	query?: IDataObject;
}

export function webhookContext(
	request: WebhookRequest,
	params: IDataObject,
	staticData: IDataObject,
	mode = 'webhook',
	// n8n 2.43.7 answers the production URL here even during a test listen.
	webhookUrl = 'https://n8n.example.com/webhook/abc/webhook',
) {
	const workflowStaticData = staticData;
	const raw = request.rawBody === undefined ? undefined : Buffer.from(request.rawBody, 'utf8');
	let parsed: unknown = {};
	if (request.rawBody) {
		try {
			parsed = JSON.parse(request.rawBody);
		} catch {
			parsed = {};
		}
	}
	const json = vi.fn();
	const status = vi.fn(() => ({ json }));
	const context = {
		getNode: () => ({
			...TEST_NODE,
			name: 'NFE.io Trigger',
			type: 'n8n-nodes-nfe.nfeTrigger',
			typeVersion: 1,
		}),
		getMode: () => mode,
		getNodeWebhookUrl: () => webhookUrl,
		getRequestObject: () => ({ rawBody: raw, body: parsed }),
		getResponseObject: () => ({ status }),
		getQueryData: () => request.query ?? {},
		getHeaderData: () => request.headers ?? {},
		getBodyData: () => parsed,
		getNodeParameter: (name: string, fallback?: unknown, opts?: { extractValue?: boolean }) =>
			readParameter(params, name, fallback, opts),
		getWorkflowStaticData: () => workflowStaticData,
	};
	return { context: context as unknown as IWebhookFunctions, status, json };
}
