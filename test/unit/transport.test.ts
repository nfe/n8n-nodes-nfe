import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	buildApiError,
	buildNetworkError,
	getRequestId,
	normalizeApiMessage,
	toNodeError,
} from '../../nodes/Nfe/transport/errors';
import { downloadDocument, fileNameFromDisposition } from '../../nodes/Nfe/transport/download';
import { publicGet } from '../../nodes/Nfe/transport/public';
import {
	apiRequest,
	apiRequestBody,
	rawRequest,
	retryDelayMs,
} from '../../nodes/Nfe/transport/request';
import { ERROR_BODIES } from '../fixtures/api';
import { executeContext, FakeApi, TEST_NODE } from '../helpers/context';

const FORBIDDEN = /\b(error|problem|failure|mistake)s?\b/i;
const URL = 'https://api.nfe.io/v3/companies/c1/serviceinvoices/i1';

beforeEach(() => vi.mocked(sleep).mockClear());

describe('normalizeApiMessage', () => {
	it('reads a plain JSON string', () => {
		expect(normalizeApiMessage(ERROR_BODIES.plainString)).toEqual({
			message: 'service invoice with id (000000000000000000000000) was not found',
			details: [],
		});
	});

	it('lists RFC 7807 field errors', () => {
		const result = normalizeApiMessage(ERROR_BODIES.rfc7807WithErrors);
		expect(result.message).toBe('One or more validation errors occurred.');
		expect(result.details).toEqual([
			"rpsNumber: The value 'abc' is not valid.",
			'borrower: Name is required. Too short.',
		]);
	});

	it('reads RFC 7807 without errors', () => {
		expect(normalizeApiMessage(ERROR_BODIES.rfc7807WithoutErrors)).toEqual({
			message: 'Not Found',
			details: [],
		});
	});

	it('reads { errors: [{ code, message }] } and { errors: [{ message }] }', () => {
		expect(normalizeApiMessage(ERROR_BODIES.codeAndMessage).message).toBe(
			'company not found (code 40401)',
		);
		expect(normalizeApiMessage(ERROR_BODIES.messageOnly).message).toBe(
			"postalCode with value '00000000' is not valid",
		);
		expect(normalizeApiMessage({ errors: ['first', { message: 'second' }] })).toEqual({
			message: 'first',
			details: ['second'],
		});
	});

	it('handles empty, buffer, array and odd bodies', () => {
		expect(normalizeApiMessage(ERROR_BODIES.empty)).toEqual({ message: '', details: [] });
		expect(normalizeApiMessage(undefined)).toEqual({ message: '', details: [] });
		expect(normalizeApiMessage(Buffer.from('{"message":"from buffer"}'))).toEqual({
			message: 'from buffer',
			details: [],
		});
		expect(normalizeApiMessage(new TextEncoder().encode('"x"').buffer)).toEqual({
			message: 'x',
			details: [],
		});
		expect(normalizeApiMessage([{ message: 'a' }, 'b'])).toEqual({ message: 'a; b', details: [] });
		expect(normalizeApiMessage(42)).toEqual({ message: '42', details: [] });
		expect(normalizeApiMessage('{not json')).toEqual({ message: '{not json', details: [] });
		expect(normalizeApiMessage('plain text')).toEqual({ message: 'plain text', details: [] });
		expect(normalizeApiMessage({ title: 'T', detail: 'D', errors: { field: [] } }).details).toEqual(
			['D', 'field'],
		);
	});
});

describe('buildApiError', () => {
	it.each([400, 401, 403, 404, 408, 409, 422, 429, 500, 503, 418])(
		'%i has an actionable message without forbidden words and with the request ID',
		(statusCode) => {
			const error = buildApiError(
				TEST_NODE,
				{ statusCode, body: '', headers: { 'x-request-id': 'abc:01' } },
				URL,
				0,
			);
			expect(error).toBeInstanceOf(NodeApiError);
			expect(error.message).not.toMatch(FORBIDDEN);
			expect(error.description).not.toMatch(FORBIDDEN);
			expect(error.description).toContain('Request ID: abc:01');
			expect(error.description).toContain(`HTTP status: ${statusCode}`);
			expect(error.httpCode).toBe(String(statusCode));
		},
	);

	it('says the key was refused on 401 with empty body', () => {
		const error = buildApiError(TEST_NODE, { statusCode: 401, body: '', headers: {} }, URL);
		expect(error.message).toBe('NFE.io did not accept the API key');
		expect(error.description).toContain('Check the API Key');
	});

	it('asks for the Data API Key on 403 from the data services', () => {
		const error = buildApiError(
			TEST_NODE,
			{ statusCode: 403, body: '', headers: {} },
			'https://legalentity.api.nfe.io/v3/legalentities/basicInfo/1',
		);
		expect(error.description).toContain('Data API Key');
	});

	it('lists each field of a 400', () => {
		const error = buildApiError(
			TEST_NODE,
			{ statusCode: 400, body: ERROR_BODIES.rfc7807WithErrors, headers: {} },
			URL,
		);
		expect(error.description).toContain("- rpsNumber: The value 'abc' is not valid.");
		expect(error.description).toContain('NFE.io says: One or more validation errors occurred.');
	});

	it('uses overrides', () => {
		const error = buildApiError(TEST_NODE, { statusCode: 404, body: '', headers: {} }, URL, 2, {
			message: 'Custom',
			hint: 'Do this.',
		});
		expect(error.message).toBe('Custom');
		expect(error.description?.startsWith('Do this.')).toBe(true);
	});

	it('reads the request ID from array headers', () => {
		expect(getRequestId({ 'x-request-id': ['r1'] })).toBe('r1');
		expect(getRequestId(undefined)).toBeUndefined();
		expect(getRequestId({})).toBeUndefined();
	});
});

describe('buildNetworkError and toNodeError', () => {
	it('tells timeouts apart from connection failures', () => {
		expect(buildNetworkError(TEST_NODE, { code: 'ETIMEDOUT' }).message).toBe(
			'NFE.io did not answer in time',
		);
		expect(buildNetworkError(TEST_NODE, { code: 'ECONNRESET' }).message).toBe(
			'Could not connect to NFE.io',
		);
		expect(buildNetworkError(TEST_NODE, {}).description).not.toContain('Code:');
		expect(
			buildNetworkError(TEST_NODE, { code: 'X' }, 1, { message: 'M', hint: 'H' }).message,
		).toBe('M');
	});

	it('keeps node errors and wraps the rest', () => {
		const api = buildApiError(TEST_NODE, { statusCode: 500, body: '', headers: {} }, URL);
		expect(toNodeError(TEST_NODE, api, 3)).toBe(api);
		expect(api.context.itemIndex).toBe(3);
		const operation = new NodeOperationError(TEST_NODE, 'x');
		expect(toNodeError(TEST_NODE, operation, 1)).toBe(operation);
		expect(toNodeError(TEST_NODE, new Error('raw'), 0)).toBeInstanceOf(NodeOperationError);
	});
});

describe('apiRequest', () => {
	it('retries a GET on 503 and returns the 200', async () => {
		const api = new FakeApi().on(
			'GET',
			URL,
			{ statusCode: 503 },
			{ statusCode: 200, body: { id: 'i1' } },
		);
		const body = await apiRequestBody(executeContext({ params: {}, api }), {
			method: 'GET',
			url: URL,
		});
		expect(body).toEqual({ id: 'i1' });
		expect(api.calls).toHaveLength(2);
		expect(sleep).toHaveBeenCalledWith(1000);
	});

	it('retries network failures on GET, then fails with a network message', async () => {
		const api = new FakeApi().on('GET', URL, { networkError: { code: 'ECONNRESET' } });
		await expect(
			apiRequest(executeContext({ params: {}, api }), { method: 'GET', url: URL }),
		).rejects.toThrow('Could not connect to NFE.io');
		expect(api.calls).toHaveLength(4);
	});

	it('honours Retry-After with a 30 s ceiling', async () => {
		expect(retryDelayMs(0, { 'retry-after': '5' })).toBe(5000);
		expect(retryDelayMs(0, { 'retry-after': '120' })).toBe(30000);
		expect(retryDelayMs(2, { 'retry-after': 'soon' })).toBe(4000);
		expect(retryDelayMs(10)).toBe(30000);
	});

	it('never retries POST, PUT or DELETE', async () => {
		for (const method of ['POST', 'PUT', 'DELETE'] as const) {
			const api = new FakeApi().on(method, URL, { statusCode: 503 }, { statusCode: 200 });
			await expect(
				apiRequest(executeContext({ params: {}, api }), { method, url: URL }),
			).rejects.toBeInstanceOf(NodeApiError);
			expect(api.calls).toHaveLength(1);
		}
	});

	it('returns allowed statuses and sends JSON with a finite timeout', async () => {
		const api = new FakeApi().on('GET', URL, { statusCode: 404, body: 'gone' });
		const response = await apiRequest(
			executeContext({ params: {}, api }),
			{ method: 'GET', url: URL, qs: { a: 1 } },
			{ allowStatus: [404] },
		);
		expect(response.statusCode).toBe(404);
		const options = api.calls[0].options;
		expect(options.timeout).toBe(30000);
		expect(options.json).toBe(true);
		expect(options.qs).toEqual({ a: 1 });
		expect(options.ignoreHttpStatusErrors).toBe(true);
		expect(api.calls[0].credential).toBe('nfeApi');
	});

	it('rawRequest reports network failures instead of throwing', async () => {
		const api = new FakeApi().on('POST', URL, { networkError: { code: 'ETIMEDOUT' } });
		const result = await rawRequest(executeContext({ params: {}, api }), {
			method: 'POST',
			url: URL,
			body: {},
		});
		expect(result.kind).toBe('network');
	});
});

describe('publicGet', () => {
	it('calls without credentials and retries 502', async () => {
		const api = new FakeApi().on(
			'GET',
			/open\.nfe\.io/,
			{ statusCode: 502 },
			{ statusCode: 200, body: { ok: 1 } },
		);
		const response = await publicGet(
			executeContext({ params: {}, api }),
			'https://open.nfe.io/v1/x',
		);
		expect(response.body).toEqual({ ok: 1 });
		expect(api.calls.every((call) => !call.authenticated)).toBe(true);
		expect(api.calls[0].options.timeout).toBe(10000);
	});

	it('gives up after the configured retries and on network failures', async () => {
		const api = new FakeApi().on('GET', /a/, { networkError: { code: 'ECONNREFUSED' } });
		await expect(
			publicGet(executeContext({ params: {}, api }), 'https://a.example', { retries: 0 }),
		).rejects.toThrow('Could not connect');
		expect(api.calls).toHaveLength(1);
		const api2 = new FakeApi().on('GET', /b/, { statusCode: 400, body: ERROR_BODIES.messageOnly });
		await expect(
			publicGet(executeContext({ params: {}, api: api2 }), 'https://b.example'),
		).rejects.toThrow();
	});
});

describe('downloadDocument', () => {
	const presigned = 'https://api.nfse.io/storage/file.pdf?X-Amz-Signature=SECRETSIGNATURE';

	it('follows the 302 without the API key and reads the file name', async () => {
		const api = new FakeApi()
			.on('GET', `${URL}/pdf`, { statusCode: 302, headers: { location: presigned } })
			.on('GET', presigned, {
				statusCode: 200,
				headers: {
					'content-type': 'application/pdf',
					'content-disposition':
						"attachment; filename=NFSE_00000105_SVBX.pdf; filename*=UTF-8''NFSE_00000105_SVBX.pdf",
				},
				body: Buffer.from('%PDF-1.4'),
			});
		const file = await downloadDocument(executeContext({ params: {}, api }), `${URL}/pdf`, {
			itemIndex: 0,
		});
		expect(file.fileName).toBe('NFSE_00000105_SVBX.pdf');
		expect(file.data.toString()).toBe('%PDF-1.4');
		expect(api.calls[0].authenticated).toBe(true);
		expect(api.calls[0].options.disableFollowRedirect).toBe(true);
		expect(api.calls[0].options.encoding).toBe('arraybuffer');
		expect(api.calls[1].authenticated).toBe(false);
		expect(api.calls[1].options.headers).toBeUndefined();
	});

	it('retries a 404 and then downloads', async () => {
		const api = new FakeApi()
			.on(
				'GET',
				`${URL}/pdf`,
				{ statusCode: 404 },
				{ statusCode: 302, headers: { location: presigned } },
			)
			.on('GET', presigned, { statusCode: 200, body: new Uint8Array([1, 2]) });
		const file = await downloadDocument(executeContext({ params: {}, api }), `${URL}/pdf`, {
			itemIndex: 0,
			notFoundRetries: 3,
		});
		expect(file.data).toEqual(Buffer.from([1, 2]));
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('refuses plain HTTP links and never shows the link', async () => {
		const api = new FakeApi().on('GET', `${URL}/xml`, {
			statusCode: 302,
			headers: { location: 'http://api.nfse.io/file.xml?sig=SECRETSIGNATURE' },
		});
		const promise = downloadDocument(executeContext({ params: {}, api }), `${URL}/xml`, {
			itemIndex: 0,
		});
		await expect(promise).rejects.toThrow('The document link sent by NFE.io is not secure');
		await promise.catch((error: NodeOperationError) => {
			expect(JSON.stringify({ m: error.message, d: error.description })).not.toContain(
				'SECRETSIGNATURE',
			);
		});
	});

	it('fails without a Location and hides the pre-signed URL on storage failures', async () => {
		const noLocation = new FakeApi().on('GET', `${URL}/xml`, { statusCode: 302 });
		await expect(
			downloadDocument(executeContext({ params: {}, api: noLocation }), `${URL}/xml`, {
				itemIndex: 0,
			}),
		).rejects.toThrow('did not send the document link');

		const expired = new FakeApi()
			.on('GET', `${URL}/xml`, { statusCode: 302, headers: { location: [presigned] } })
			.on('GET', presigned, { statusCode: 403, body: '<Error>AccessDenied</Error>' });
		const error = await downloadDocument(
			executeContext({ params: {}, api: expired }),
			`${URL}/xml`,
			{
				itemIndex: 0,
			},
		).catch((caught: NodeApiError) => caught);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe('The document link expired before the download');
		expect(JSON.stringify(error)).not.toContain('SECRETSIGNATURE');

		const invalid = new FakeApi().on('GET', `${URL}/xml`, {
			statusCode: 302,
			headers: { location: 'http://[bad' },
		});
		await expect(
			downloadDocument(executeContext({ params: {}, api: invalid }), `${URL}/xml`, {
				itemIndex: 0,
			}),
		).rejects.toThrow('not secure');
	});

	it('accepts a direct 200 answer', async () => {
		const api = new FakeApi().on('GET', `${URL}/xml`, {
			statusCode: 200,
			headers: { 'content-type': 'application/xml' },
			body: '<Nfse/>',
		});
		const file = await downloadDocument(executeContext({ params: {}, api }), `${URL}/xml`, {
			itemIndex: 0,
		});
		expect(file.data.toString()).toBe('<Nfse/>');
		expect(file.contentType).toBe('application/xml');
	});

	it('parses file names safely', () => {
		expect(fileNameFromDisposition(undefined)).toBeUndefined();
		expect(fileNameFromDisposition('attachment')).toBeUndefined();
		expect(fileNameFromDisposition('attachment; filename="a b.xml"')).toBe('a b.xml');
		expect(fileNameFromDisposition('attachment; filename=../../etc/passwd')).toBe('_.._etc_passwd');
		expect(fileNameFromDisposition("attachment; filename*=UTF-8''nota%20fiscal.pdf")).toBe(
			'nota fiscal.pdf',
		);
		expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A.pdf")).toBe(
			'%E0%A4%A.pdf',
		);
		expect(fileNameFromDisposition('attachment; filename=...')).toBeUndefined();
	});
});
