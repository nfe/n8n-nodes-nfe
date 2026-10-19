import type { IDataObject } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIssueBody } from '../../nodes/Nfe/actions/serviceInvoice/issue';
import { Nfe } from '../../nodes/Nfe/Nfe.node';
import { COMPANY_ID, ERROR_BODIES, invoice, INVOICE_ID } from '../fixtures/api';
import { executeContext, FakeApi } from '../helpers/context';

const BASE = `https://api.nfe.io/v3/companies/${COMPANY_ID}/serviceinvoices`;
const EXTERNAL = new RegExp(`^${BASE}/external/`);

const required = {
	resource: 'serviceInvoice',
	operation: 'issue',
	companyId: { __rl: true, mode: 'id', value: COMPANY_ID },
	cityServiceCode: '10677',
	description: 'Consulting',
	servicesAmount: 150.5,
	borrowerInput: 'none',
	waitForAuthorization: false,
};

function issueParams(extra: IDataObject = {}): IDataObject {
	return { ...required, ...extra };
}

function body(extra: IDataObject = {}) {
	return buildIssueBody(executeContext({ params: issueParams(extra) }), 0);
}

async function run(params: IDataObject, api: FakeApi, continueOnFail = false) {
	const context = executeContext({ params, api, continueOnFail });
	return await new Nfe().execute.call(context);
}

beforeEach(() => vi.mocked(sleep).mockClear());

describe('issue body', () => {
	it('sends only the required fields and a generated External ID', () => {
		const result = body();
		expect(Object.keys(result).sort()).toEqual([
			'cityServiceCode',
			'description',
			'externalId',
			'servicesAmount',
		]);
		expect(result.externalId).toMatch(
			/^n8n-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result.servicesAmount).toBe(150.5);
	});

	it('derives the automatic External ID from execution, node and item (stable on retry)', () => {
		const first = buildIssueBody(executeContext({ params: issueParams() }), 0).externalId;
		expect(buildIssueBody(executeContext({ params: issueParams() }), 0).externalId).toBe(first);
		expect(
			buildIssueBody(executeContext({ params: issueParams(), items: 2 }), 1).externalId,
		).not.toBe(first);
		expect(
			buildIssueBody(executeContext({ params: issueParams(), executionId: 'execution-2' }), 0)
				.externalId,
		).not.toBe(first);
		const noExecution = executeContext({ params: issueParams(), executionId: '' });
		expect(buildIssueBody(noExecution, 0).externalId).toMatch(
			/^n8n-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		const throwing = executeContext({ params: issueParams() });
		(throwing as unknown as { getExecutionId: () => string }).getExecutionId = () => {
			throw new Error('no execution');
		};
		expect(buildIssueBody(throwing, 0).externalId).toMatch(/^n8n-/);
	});

	it('gives each loop round its own automatic External ID and keeps it on retry', () => {
		const id = (runIndex: number, itemIndex: number) =>
			buildIssueBody(executeContext({ params: issueParams(), items: 2, runIndex }), itemIndex)
				.externalId;
		// Loop Over Items: item indexes restart at 0 on every round of the node.
		expect(new Set([id(0, 0), id(0, 1), id(1, 0), id(1, 1)]).size).toBe(4);
		// Retry On Fail runs the same round again: same ID, so the API answers "already exists".
		expect(id(1, 0)).toBe(id(1, 0));
		const noProxy = executeContext({ params: issueParams() });
		(noProxy as unknown as { getWorkflowDataProxy: () => never }).getWorkflowDataProxy = () => {
			throw new Error('no proxy');
		};
		expect(buildIssueBody(noProxy, 0).externalId).toBe(id(0, 0));
	});

	it('drops the untouched fields of the JSON template', () => {
		expect(
			body({
				borrowerInput: 'json',
				borrowerJson:
					'{"type":"LegalEntity","name":"","federalTaxNumber":"","email":"","address":{"street":""}}',
			}).borrower,
		).toEqual({ type: 'LegalEntity' });
		expect(
			body({ borrowerInput: 'json', borrowerJson: '{"name":" ","address":{}}' }),
		).not.toHaveProperty('borrower');
		expect(body({ additionalFields: { intermediary: '{"name":""}' } })).not.toHaveProperty(
			'intermediary',
		);
	});

	it('does not let overrides replace the validated tax reform codes', () => {
		const result = body({
			taxReform: {
				operationIndicator: '100301',
				classCode: '000001',
				overrides: '{"operationIndicator":"1005011","classCode":"x","basis":10}',
			},
		});
		expect(result.ibsCbs).toEqual({ operationIndicator: '100301', classCode: '000001', basis: 10 });
	});

	it('keeps the External ID the user sent', () => {
		expect(body({ additionalFields: { externalId: ' order-1234 ' } }).externalId).toBe(
			'order-1234',
		);
		expect(() => body({ additionalFields: { externalId: '../x' } })).toThrow(
			'The External ID is not valid',
		);
	});

	it('sends only Taxation Type when it is the only ISS field', () => {
		const result = body({ issTaxes: { taxationType: 'WithinCity' } });
		expect(result.taxationType).toBe('WithinCity');
		for (const key of [
			'issRate',
			'issTaxAmount',
			'deductionsAmount',
			'discountUnconditionedAmount',
			'discountConditionedAmount',
		]) {
			expect(result).not.toHaveProperty(key);
		}
	});

	it('sends only ISS Withheld when it is the only withholding', () => {
		const result = body({ federalWithholdings: { issAmountWithheld: 0.2 } });
		expect(result.issAmountWithheld).toBe(0.2);
		for (const key of [
			'irAmountWithheld',
			'pisAmountWithheld',
			'cofinsAmountWithheld',
			'csllAmountWithheld',
			'inssAmountWithheld',
			'othersAmountWithheld',
		]) {
			expect(result).not.toHaveProperty(key);
		}
	});

	it('sends an explicit zero', () => {
		expect(body({ issTaxes: { issRate: 0 } }).issRate).toBe(0);
	});

	it('normalizes service codes and additional fields', () => {
		const result = body({
			additionalFields: {
				nbsCode: '1.1502.10.00',
				federalServiceCode: '1.07',
				cnaeCode: ' 6201501 ',
				rpsNumber: 12,
				paidAmount: 0,
				issuedOn: '2026-10-16T10:00:00.000-03:00',
				accrualOn: '2026-10-01T00:00:00',
				location: '{"state":"PR","city":{"code":"4106902"}}',
				intermediary: { name: 'Broker', federalTaxNumber: '11.222.333/0001-81' },
				additionalInformation: '',
			},
		});
		expect(result).toMatchObject({
			nbsCode: '115021000',
			federalServiceCode: '01.07',
			cnaeCode: '6201501',
			rpsNumber: 12,
			paidAmount: 0,
			issuedOn: '2026-10-16T10:00:00.000-03:00',
			accrualOn: '2026-10-01',
			location: { state: 'PR', city: { code: '4106902' } },
			intermediary: { name: 'Broker', federalTaxNumber: '11222333000181' },
		});
		expect(result).not.toHaveProperty('additionalInformation');
		expect(body({ additionalFields: { location: '{}' } })).not.toHaveProperty('location');
	});

	it('sends the borrower tax number as a string with leading zeros', () => {
		const result = body({
			borrowerInput: 'fields',
			borrowerName: 'ACME',
			borrowerFederalTaxNumber: '00.623.904/0001-73',
			borrowerType: 'auto',
			borrowerDetails: {
				email: 'a@b.com',
				postalCode: '80010-000',
				state: 'pr',
				cityCode: '4106902',
				cityName: 'Curitiba',
			},
		});
		expect(result.borrower).toEqual({
			name: 'ACME',
			federalTaxNumber: '00623904000173',
			type: 'LegalEntity',
			email: 'a@b.com',
			address: {
				postalCode: '80010000',
				state: 'PR',
				city: { code: '4106902', name: 'Curitiba' },
				country: 'BRA',
			},
		});
	});

	it('detects a natural person, honours an explicit type and omits an empty borrower', () => {
		expect(
			body({ borrowerInput: 'fields', borrowerFederalTaxNumber: '529.982.247-25' }).borrower,
		).toEqual({ federalTaxNumber: '52998224725', type: 'NaturalPerson' });
		expect(
			body({
				borrowerInput: 'fields',
				borrowerName: 'X',
				borrowerType: 'LegalEntity',
				borrowerDetails: { country: 'usa' },
			}).borrower,
		).toEqual({ name: 'X', type: 'LegalEntity', address: { country: 'USA' } });
		expect(body({ borrowerInput: 'fields' })).not.toHaveProperty('borrower');
		expect(body({ borrowerInput: 'none', borrowerName: 'ignored' })).not.toHaveProperty('borrower');
	});

	it('accepts the borrower as JSON', () => {
		expect(
			body({
				borrowerInput: 'json',
				borrowerJson: '{"name":"J","federalTaxNumber":"00.623.904/0001-73"}',
			}).borrower,
		).toEqual({ name: 'J', federalTaxNumber: '00623904000173' });
		expect(body({ borrowerInput: 'json', borrowerJson: '{}' })).not.toHaveProperty('borrower');
		expect(() => body({ borrowerInput: 'json', borrowerJson: 'nope' })).toThrow(
			'Borrower (JSON) must be a JSON object',
		);
	});

	it('sends the tax reform group with 6-digit codes and merges overrides', () => {
		const result = body({
			taxReform: {
				operationIndicator: '100301',
				classCode: '000001',
				situationCode: '000',
				overrides: '{"cbs":{"rate":0.9,"effectiveRate":0.9}}',
			},
		});
		expect(result.ibsCbs).toEqual({
			operationIndicator: '100301',
			classCode: '000001',
			situationCode: '000',
			cbs: { rate: 0.9, effectiveRate: 0.9 },
		});
		expect(body()).not.toHaveProperty('ibsCbs');
	});

	it('refuses a 7-digit operation indicator and a missing classification', () => {
		expect(() =>
			body({ taxReform: { operationIndicator: '1005011', classCode: '000001' } }),
		).toThrow('The Operation Indicator must have exactly 6 digits');
		expect(() => body({ taxReform: { operationIndicator: '100301' } })).toThrow(
			'Classification Code',
		);
		expect(() => body({ taxReform: { overrides: '{"x":1}' } })).toThrow('Operation Indicator');
	});

	it('requires the recipient when the destination differs from the buyer', () => {
		expect(() =>
			body({
				taxReform: {
					operationIndicator: '100301',
					classCode: '000001',
					destinationIndicator: 'DifferentFromBuyer',
				},
			}),
		).toThrow('The recipient is missing');
		const result = body({
			taxReform: {
				operationIndicator: '100301',
				classCode: '000001',
				destinationIndicator: 'DifferentFromBuyer',
				recipient: '{"name":"R","federalTaxNumber":"529.982.247-25"}',
			},
		});
		expect(result.recipient).toEqual({ name: 'R', federalTaxNumber: '52998224725' });
		expect((result.ibsCbs as IDataObject).destinationIndicator).toBe('DifferentFromBuyer');
	});
});

describe('issue flow', () => {
	it('posts once with a 90 s timeout and returns the invoice with markers', async () => {
		const api = new FakeApi().on('POST', BASE, {
			statusCode: 202,
			body: invoice({ flowStatus: 'WaitingCalculateTaxes' }),
		});
		const [items] = await run(issueParams({ additionalFields: { externalId: 'order-1' } }), api);
		expect(api.calls).toHaveLength(1);
		expect(api.calls[0].options.timeout).toBe(90000);
		expect(items[0].json).toMatchObject({
			id: INVOICE_ID,
			alreadyExisted: false,
			flowStatus: 'WaitingCalculateTaxes',
		});
		expect(items[0].json).not.toHaveProperty('waitTimedOut');
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('reconciles a 504 through the External ID without a second POST', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 504, body: '' })
			.on(
				'GET',
				EXTERNAL,
				{ body: { serviceInvoices: [], page: 1 } },
				{ body: { serviceInvoices: [invoice()], page: 1 } },
			);
		const [items] = await run(issueParams({ additionalFields: { externalId: 'order 2' } }), api);
		expect(api.callsTo('POST', /serviceinvoices$/)).toHaveLength(1);
		expect(api.callsTo('GET', /external\/order%202$/)).toHaveLength(2);
		expect(items[0].json.id).toBe(INVOICE_ID);
	});

	it('reconciles a timeout and a 408 too', async () => {
		for (const failure of [
			{ networkError: { code: 'ETIMEDOUT' } },
			{ statusCode: 408 },
			{ statusCode: 202, body: '' },
		]) {
			const api = new FakeApi()
				.on('POST', BASE, failure)
				.on('GET', EXTERNAL, { body: { serviceInvoices: [invoice()] } });
			const [items] = await run(issueParams(), api);
			expect(items[0].json.id).toBe(INVOICE_ID);
			expect(api.callsTo('POST', /serviceinvoices$/)).toHaveLength(1);
		}
	});

	it('fails with the External ID when nothing is found for 30 s', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { networkError: { code: 'ETIMEDOUT' } })
			.on(
				'GET',
				EXTERNAL,
				{ body: { serviceInvoices: [], page: 1 } },
				{ statusCode: 500 },
				{ body: { serviceInvoices: [] } },
			);
		const promise = run(issueParams({ additionalFields: { externalId: 'order-3' } }), api);
		await expect(promise).rejects.toThrow('The issuance outcome is unknown');
		await promise.catch((error: { description: string }) => {
			expect(error.description).toContain('External ID: order-3');
			expect(error.description).toContain('did not send it again');
		});
		expect(api.callsTo('POST', /serviceinvoices$/)).toHaveLength(1);
		expect(api.callsTo('GET', /external/).length).toBeGreaterThanOrEqual(15);
	});

	it('returns the existing invoice when the External ID already exists', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 400, body: '"externalId order-4 already exists"' })
			.on('GET', EXTERNAL, {
				body: { serviceInvoices: [invoice({ externalId: 'order-4' })], page: 1 },
			});
		const [items] = await run(issueParams({ additionalFields: { externalId: 'order-4' } }), api);
		expect(items[0].json).toMatchObject({
			id: INVOICE_ID,
			externalId: 'order-4',
			alreadyExisted: true,
		});
		expect(api.callsTo('POST', /serviceinvoices$/)).toHaveLength(1);
	});

	it('fails when the existing invoice cannot be read', async () => {
		const api = new FakeApi()
			.on('POST', BASE, {
				statusCode: 400,
				body: { errors: [{ message: 'External Id already exists' }] },
			})
			.on('GET', EXTERNAL, { body: { serviceInvoices: [] } });
		await expect(run(issueParams(), api)).rejects.toThrow(
			'An invoice with this External ID already exists',
		);
	});

	it('does not re-send on 429 and lists fields on 400', async () => {
		const limited = new FakeApi().on('POST', BASE, { statusCode: 429 });
		const promise = run(issueParams(), limited);
		await expect(promise).rejects.toThrow('The NFE.io rate limit was reached');
		await promise.catch((error: { description: string }) =>
			expect(error.description).toContain('did not send it again'),
		);
		expect(limited.calls).toHaveLength(1);

		const invalid = new FakeApi().on('POST', BASE, {
			statusCode: 400,
			body: ERROR_BODIES.rfc7807WithErrors,
		});
		await expect(run(issueParams(), invalid)).rejects.toThrow(
			'NFE.io did not accept the request data',
		);
	});

	it('waits for flowStatus Issued (status alone is not enough)', async () => {
		const api = new FakeApi()
			.on('POST', BASE, {
				statusCode: 202,
				body: invoice({ status: 'Created', flowStatus: 'WaitingCalculateTaxes' }),
			})
			.on(
				'GET',
				`${BASE}/${INVOICE_ID}`,
				{ body: invoice({ status: 'Issued', flowStatus: 'WaitingDownload' }) },
				{ body: invoice({ status: 'Issued', flowStatus: 'Issued' }) },
			);
		const [items] = await run(issueParams({ waitForAuthorization: true, waitTimeout: 60 }), api);
		expect(items[0].json).toMatchObject({ flowStatus: 'Issued', waitTimedOut: false });
		expect(api.callsTo('GET', new RegExp(`${INVOICE_ID}$`))).toHaveLength(2);
	});

	it('fails with the city message on IssueFailed', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 202, body: invoice({ flowStatus: 'WaitingSend' }) })
			.on('GET', `${BASE}/${INVOICE_ID}`, {
				body: invoice({ flowStatus: 'IssueFailed', flowMessage: 'Código de serviço inválido' }),
			});
		const promise = run(issueParams({ waitForAuthorization: true }), api);
		await expect(promise).rejects.toThrow('The city did not authorize the invoice');
		await promise.catch((error: { description: string }) => {
			expect(error.description).toContain('Reason: Código de serviço inválido');
			expect(error.description).toContain(`Invoice ID: ${INVOICE_ID}`);
		});
	});

	it('returns the invoice with waitTimedOut on timeout, in simplified output too', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 202, body: invoice({ flowStatus: 'WaitingSend' }) })
			.on('GET', `${BASE}/${INVOICE_ID}`, { body: invoice({ flowStatus: 'WaitingReturn' }) });
		const [items] = await run(
			issueParams({ waitForAuthorization: true, waitTimeout: 4, output: 'simplified' }),
			api,
		);
		expect(items[0].json).toMatchObject({
			flowStatus: 'WaitingReturn',
			waitTimedOut: true,
			alreadyExisted: false,
		});
		expect(Object.keys(items[0].json)).toHaveLength(12);
	});

	it('returns an error item with Continue On Fail', async () => {
		const api = new FakeApi().on('POST', BASE, { statusCode: 401, body: '' });
		const [items] = await run(issueParams(), api, true);
		expect(items[0].json.error).toBe('NFE.io did not accept the API key');
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});
});

describe('issue safety', () => {
	it('checks every item before the first POST', async () => {
		const api = new FakeApi().on('POST', BASE, { statusCode: 202, body: invoice() });
		const params = [
			issueParams(),
			issueParams({ borrowerInput: 'fields', borrowerFederalTaxNumber: '529.982.247-24' }),
		];
		await expect(run(params, api)).rejects.toThrow('The borrower Federal Tax Number is not valid');
		expect(api.calls).toHaveLength(0);
	});

	it('reconciles a 2xx without an invoice ID', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 202, body: {} })
			.on('GET', EXTERNAL, { body: { serviceInvoices: [invoice()] } });
		const [items] = await run(issueParams(), api);
		expect(items[0].json.id).toBe(INVOICE_ID);
		expect(api.callsTo('POST', /serviceinvoices$/)).toHaveLength(1);
	});

	it('waits for the index after "already exists"', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 400, body: '"externalId already exists"' })
			.on(
				'GET',
				EXTERNAL,
				{ body: { serviceInvoices: [] } },
				{ body: { serviceInvoices: [invoice()] } },
			);
		const [items] = await run(issueParams({ additionalFields: { externalId: 'order-9' } }), api);
		expect(items[0].json.alreadyExisted).toBe(true);
		expect(api.callsTo('GET', /external/)).toHaveLength(2);
	});

	it('returns the accepted invoice when a read fails during the wait', async () => {
		const api = new FakeApi()
			.on('POST', BASE, { statusCode: 202, body: invoice({ flowStatus: 'WaitingSend' }) })
			.on('GET', `${BASE}/${INVOICE_ID}`, { networkError: { code: 'ECONNRESET' } });
		const [items] = await run(issueParams({ waitForAuthorization: true, output: 'raw' }), api);
		expect(items[0].json).toMatchObject({
			id: INVOICE_ID,
			flowStatus: 'WaitingSend',
			waitTimedOut: true,
		});
	});
});
