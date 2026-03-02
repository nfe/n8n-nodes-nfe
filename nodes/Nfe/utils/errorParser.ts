/**
 * NFe.io API Error Parser
 *
 * Parses different error response formats from NFe.io API and transforms them
 * into user-friendly messages for n8n error display.
 *
 * Error formats handled:
 * 1. Simple string (400 validation): "fieldName can not be null or empty"
 * 2. RFC7807 Problem Details (404, etc): {type, title, status, traceId}
 * 3. RFC7807 with field errors (400 schema): {type, title, status, errors: {...}, traceId}
 * 4. Empty body (401 auth): no body content
 */

import type {
	IExecuteSingleFunctions,
	INodeExecutionData,
	IN8nHttpFullResponse,
	PostReceiveAction,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export interface ParsedNfeError {
	message: string;
	description?: string;
	details?: JsonObject;
}

/**
 * RFC7807 Problem Details structure
 * @see https://tools.ietf.org/html/rfc7807
 */
interface Rfc7807Error {
	type?: string;
	title?: string;
	status?: number;
	detail?: string;
	traceId?: string;
}

/**
 * RFC7807 with validation errors (ASP.NET style)
 */
interface Rfc7807WithErrors extends Rfc7807Error {
	errors?: Record<string, string[]>;
}

/**
 * Parse simple string validation errors
 * Format: "fieldName can not be null or empty"
 */
export function parseSimpleStringError(body: string): ParsedNfeError {
	// Remove surrounding quotes if present (API returns JSON string)
	const message = body.replace(/^"|"$/g, '');
	return {
		message,
	};
}

/**
 * Parse RFC7807 Problem Details errors
 * Format: {type, title, status, traceId}
 */
export function parseRfc7807Error(body: Rfc7807Error): ParsedNfeError {
	const message = body.title || 'Unknown error';
	const details: JsonObject = {};

	if (body.traceId) {
		details.traceId = body.traceId;
	}
	if (body.type) {
		details.type = body.type;
	}
	if (body.detail) {
		details.detail = body.detail;
	}

	return {
		message,
		description: body.detail,
		details: Object.keys(details).length > 0 ? details : undefined,
	};
}

/**
 * Clean up JSON path notation for display
 * e.g., "$.borrower.federalTaxNumber" → "borrower.federalTaxNumber"
 */
function cleanJsonPath(path: string): string {
	return path.replace(/^\$\.?/, '');
}

/**
 * Parse RFC7807 errors with field-level validation details
 * Format: {type, title, status, errors: {"$.field": ["message"]}, traceId}
 */
export function parseRfc7807WithErrors(body: Rfc7807WithErrors): ParsedNfeError {
	const message = body.title || 'Validation error';
	const errorLines: string[] = [];
	const details: JsonObject = {};

	// Format field errors as readable list
	if (body.errors) {
		for (const [field, messages] of Object.entries(body.errors)) {
			const cleanField = cleanJsonPath(field);
			for (const msg of messages) {
				errorLines.push(`${cleanField}: ${msg}`);
			}
		}
		details.fieldErrors = body.errors;
	}

	if (body.traceId) {
		details.traceId = body.traceId;
	}

	return {
		message,
		description: errorLines.length > 0 ? errorLines.join('\n') : undefined,
		details: Object.keys(details).length > 0 ? details : undefined,
	};
}

/**
 * Detect the error format and return the appropriate type
 */
function detectErrorFormat(
	body: unknown,
): 'string' | 'rfc7807' | 'rfc7807_with_errors' | 'empty' | 'unknown' {
	// Empty body
	if (body === null || body === undefined || body === '') {
		return 'empty';
	}

	// Simple string
	if (typeof body === 'string') {
		return 'string';
	}

	// Object - check for RFC7807 structure
	if (typeof body === 'object' && body !== null) {
		const obj = body as Record<string, unknown>;

		// RFC7807 with errors (has errors object)
		if ('errors' in obj && typeof obj.errors === 'object') {
			return 'rfc7807_with_errors';
		}

		// RFC7807 basic (has type or title or status)
		if ('type' in obj || 'title' in obj || 'status' in obj) {
			return 'rfc7807';
		}
	}

	return 'unknown';
}

/**
 * Default messages for HTTP status codes
 */
const defaultMessages: Record<number, string> = {
	400: 'Bad request - please check your parameters',
	401: 'Authentication failed - check your API key',
	403: 'Access forbidden',
	404: 'Resource not found',
	409: 'Resource conflict',
	422: 'Validation error',
	429: 'Rate limit exceeded',
	500: 'Internal server error',
	502: 'Bad gateway',
	503: 'Service unavailable',
	504: 'Gateway timeout',
};

/**
 * Main error parser function
 * Detects the error format and delegates to the appropriate parser
 */
export function parseNfeError(statusCode: number, body: unknown): ParsedNfeError {
	const format = detectErrorFormat(body);

	switch (format) {
		case 'string':
			return parseSimpleStringError(body as string);

		case 'rfc7807_with_errors':
			return parseRfc7807WithErrors(body as Rfc7807WithErrors);

		case 'rfc7807':
			return parseRfc7807Error(body as Rfc7807Error);

		case 'empty':
			// Use default message for status code
			return {
				message: defaultMessages[statusCode] || `HTTP ${statusCode} error`,
			};

		case 'unknown':
		default: {
			// Fallback: try to stringify the body
			let rawBody: string;
			try {
				rawBody = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
			} catch {
				rawBody = String(body);
			}
			return {
				message: defaultMessages[statusCode] || `HTTP ${statusCode} error`,
				description: `Unexpected error format from API:\n${rawBody}`,
				details: { rawBody },
			};
		}
	}
}

/**
 * PostReceive handler for NFe.io API responses
 * Checks for HTTP errors and throws NodeApiError with parsed error message
 *
 * Usage in operation routing:
 * routing: {
 *   request: { ... },
 *   output: {
 *     postReceive: [handleNfeApiError],
 *   },
 * }
 */
export const handleNfeApiError: PostReceiveAction = async function (
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const statusCode = response.statusCode;

	// If response is successful, return items as-is
	if (statusCode < 400) {
		return items;
	}

	// Parse the error from response body
	const parsedError = parseNfeError(statusCode, response.body);

	// Build error response object (only include defined values)
	const errorResponse: JsonObject = {
		message: parsedError.message,
	};
	if (parsedError.description) {
		errorResponse.description = parsedError.description;
	}
	if (parsedError.details) {
		Object.assign(errorResponse, parsedError.details);
	}

	// Build options (only include defined values)
	const options: { message: string; description?: string; httpCode: string } = {
		message: parsedError.message,
		httpCode: String(statusCode),
	};
	if (parsedError.description) {
		options.description = parsedError.description;
	}

	// Throw NodeApiError with parsed information
	throw new NodeApiError(this.getNode(), errorResponse, options);
};
