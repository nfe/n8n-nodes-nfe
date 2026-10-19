import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export interface ApiFailure {
	statusCode: number;
	body: unknown;
	headers: IDataObject;
}

export interface FailureHint {
	/** What happened, shown as the error title. */
	message?: string;
	/** How to fix it, shown before the API details. */
	hint?: string;
}

export interface NormalizedApiMessage {
	/** Main message returned by the API, empty when the body had none. */
	message: string;
	/** One line per field returned by the API (`field: message`). */
	details: string[];
}

const DATA_API_HINT =
	'CNPJ, state registration and postal code lookups use the Data API Key. Add it to the NFE.io credential.';

function asText(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

function parseBody(body: unknown): unknown {
	if (body === undefined || body === null) return '';
	if (typeof body === 'string') {
		const trimmed = body.trim();
		if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
			try {
				return JSON.parse(trimmed) as unknown;
			} catch {
				return trimmed;
			}
		}
		return trimmed;
	}
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
		return parseBody(body.toString('utf8'));
	}
	if (body instanceof ArrayBuffer) {
		return parseBody(Buffer.from(body).toString('utf8'));
	}
	return body;
}

/**
 * Normalizes the error bodies returned by the NFE.io APIs:
 * plain JSON string, RFC 7807 with or without `errors`, `{ errors: [{ code, message }] }`,
 * `{ errors: [{ message }] }`, `{ message }` and empty bodies.
 */
export function normalizeApiMessage(rawBody: unknown): NormalizedApiMessage {
	const body = parseBody(rawBody);
	if (typeof body === 'string') return { message: body, details: [] };
	if (Array.isArray(body)) {
		const messages = body
			.map((entry) => asText((entry as IDataObject)?.message ?? entry))
			.filter(Boolean);
		return { message: messages.join('; '), details: [] };
	}
	if (typeof body !== 'object' || body === null) return { message: asText(body), details: [] };

	const data = body as IDataObject;
	const details: string[] = [];
	let message = asText(data.title) || asText(data.message) || asText(data.detail);
	if (asText(data.detail) && message !== asText(data.detail)) {
		details.push(asText(data.detail));
	}

	const errors = data.errors;
	if (Array.isArray(errors)) {
		const messages = errors
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				const item = entry as IDataObject;
				const text = asText(item.message);
				const code = asText(item.code);
				return code && text ? `${text} (code ${code})` : text;
			})
			.filter(Boolean);
		if (!message) message = messages.shift() ?? '';
		details.push(...messages);
	} else if (errors && typeof errors === 'object') {
		for (const [field, value] of Object.entries(errors as IDataObject)) {
			const list = Array.isArray(value) ? value : [value];
			const text = list.map(asText).filter(Boolean).join(' ');
			details.push(text ? `${field}: ${text}` : field);
		}
	}

	return { message, details };
}

export function getRequestId(headers: IDataObject | undefined): string | undefined {
	if (!headers) return undefined;
	const value = headers['x-request-id'] ?? headers['X-Request-Id'];
	const text = Array.isArray(value) ? asText(value[0]) : asText(value);
	return text || undefined;
}

function defaultsFor(statusCode: number, url: string): Required<FailureHint> {
	const isDataApi = /legalentity\.api\.nfe\.io|address\.api\.nfe\.io/.test(url);
	switch (true) {
		case statusCode === 400:
			return {
				message: 'NFE.io did not accept the request data',
				hint: 'Check the values listed below and run the node again.',
			};
		case statusCode === 401:
			return {
				message: 'NFE.io did not accept the API key',
				hint: 'Check the API Key in the NFE.io credential. You can copy it from the NFE.io dashboard.',
			};
		case statusCode === 403:
			return isDataApi
				? { message: 'This key cannot use the NFE.io data services', hint: DATA_API_HINT }
				: {
						message: 'This API key has no access to the requested resource',
						hint: 'Check that the key belongs to the account that owns the company.',
					};
		case statusCode === 404:
			return {
				message: 'The requested resource was not found',
				hint: 'Check the IDs used by this node.',
			};
		case statusCode === 408:
			return {
				message: 'NFE.io took too long to answer',
				hint: 'Try again in a few moments.',
			};
		case statusCode === 409 || statusCode === 422:
			return {
				message: 'NFE.io cannot process this request in the current state',
				hint: 'Check the current status of the resource and try again.',
			};
		case statusCode === 429:
			return {
				message: 'The NFE.io rate limit was reached',
				hint: 'Wait a moment before running the node again, or reduce the number of items per run.',
			};
		case statusCode >= 500:
			return {
				message: 'NFE.io is temporarily unavailable',
				hint: 'Try again in a few minutes. If it persists, contact NFE.io support with the request ID.',
			};
		default:
			return {
				message: `NFE.io answered with an unexpected status (${statusCode})`,
				hint: 'Contact NFE.io support with the request ID if it persists.',
			};
	}
}

/** Builds the node error for a failed API response. Never includes keys, headers or URLs. */
export function buildApiError(
	node: INode,
	failure: ApiFailure,
	url: string,
	itemIndex?: number,
	override: FailureHint = {},
): NodeApiError {
	const defaults = defaultsFor(failure.statusCode, url);
	const { message: apiMessage, details } = normalizeApiMessage(failure.body);
	const requestId = getRequestId(failure.headers);

	const lines = [override.hint ?? defaults.hint];
	if (apiMessage) lines.push(`NFE.io says: ${apiMessage}`);
	for (const detail of details) lines.push(`- ${detail}`);
	lines.push(`HTTP status: ${failure.statusCode}`);
	if (requestId) lines.push(`Request ID: ${requestId}`);

	const context: JsonObject = { statusCode: failure.statusCode, apiMessage, details };
	if (requestId) context.requestId = requestId;

	return new NodeApiError(node, context, {
		message: override.message ?? defaults.message,
		description: lines.join('\n'),
		httpCode: String(failure.statusCode),
		itemIndex,
	});
}

/** Error for a request that never got an HTTP answer (timeout or network). */
export function buildNetworkError(
	node: INode,
	error: unknown,
	itemIndex?: number,
	override: FailureHint = {},
): NodeOperationError {
	const code = asText((error as IDataObject)?.code) || asText((error as IDataObject)?.name);
	const timedOut = /timeout|ETIMEDOUT|ECONNABORTED/i.test(
		`${code} ${asText((error as IDataObject)?.message)}`,
	);
	const message =
		override.message ??
		(timedOut ? 'NFE.io did not answer in time' : 'Could not connect to NFE.io');
	const lines = [
		override.hint ?? 'Check the network connection of the n8n instance and try again.',
	];
	if (code) lines.push(`Code: ${code}`);
	return new NodeOperationError(node, message, { description: lines.join('\n'), itemIndex });
}

/** Keeps node errors as they are and wraps anything else, so callers can rethrow safely. */
export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (error.context && error.context.itemIndex === undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}
