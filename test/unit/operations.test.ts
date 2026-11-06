import type { IDataObject } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toApiDate } from '../../nodes/Nfe/actions/serviceInvoice/getAll';
import { Nfe } from '../../nodes/Nfe/Nfe.node';
import nfeCodex from '../../nodes/Nfe/Nfe.node.json';
import { NfeTrigger } from '../../nodes/NfeTrigger/NfeTrigger.node';
import triggerCodex from '../../nodes/NfeTrigger/NfeTrigger.node.json';
import packageJson from '../../package.json';
import { company, COMPANY_ID, invoice, INVOICE_ID, invoicePage } from '../fixtures/api';
import { executeContext, FakeApi } from '../helpers/context';

const BASE = `https://api.nfe.io/v3/companies/${COMPANY_ID}/serviceinvoices`;
const companyParam = { __rl: true, mode: 'list', value: COMPANY_ID };

function invoiceParams(operation: string, extra: IDataObject = {}): IDataObject {
	return {
		resource: 'serviceInvoice',
		operation,
		companyId: companyParam,
		invoiceId: INVOICE_ID,
		...extra,
	};
}

async function run(
	params: IDataObject | IDataObject[],
	api: FakeApi,
	options: { continueOnFail?: boolean; credentials?: IDataObject } = {},
) {
	const context = executeContext({ params, api, ...options });
	return (await new Nfe().execute.call(context))[0];
}

beforeEach(() => vi.mocked(sleep).mockClear());

describe('node description', () => {
	const { description } = new Nfe();

	it('is version 2, usable as a tool, with the three resources', () => {
		expect(description.version).toBe(2);
		expect(description.usableAsTool).toBe(true);
		const resource = description.properties.find((property) => property.name === 'resource');
		expect(resource?.options?.map((option) => (option as IDataObject).value)).toEqual([
			'company',
			'lookup',
			'serviceInvoice',
		]);
	});

	it('uses Whether in every boolean description and no forbidden words in the UI', () => {
		const text = JSON.stringify(description);
		for (const property of description.properties.filter((p) => p.type === 'boolean')) {
			expect(property.description?.startsWith('Whether')).toBe(true);
		}
		expect(text).not.toMatch(/\b(problem|failure|mistake)s?\b/i);
	});

	it('tells on Issue that only an own External ID makes a new run safe', () => {
		const notice = description.properties.find((property) => property.name === 'externalIdNotice');
		expect(notice?.type).toBe('notice');
		expect(notice?.displayOptions?.show).toEqual({
			resource: ['serviceInvoice'],
			operation: ['issue'],
		});
		expect(notice?.displayName).toMatch(/same execution/);
		expect(notice?.displayName).toMatch(/Retry of a failed execution/);
		expect(notice?.displayName).toMatch(/e\.g\. the order number/);
		const additional = description.properties.find(
			(property) =>
				property.name === 'additionalFields' &&
				property.displayOptions?.show?.operation?.includes('issue'),
		);
		const field = (additional?.options as IDataObject[]).find(
			(option) => option.name === 'externalId',
		);
		expect(field?.description).toMatch(/only covers retries inside the same execution/);
	});

	it('has codex files that follow the n8n convention (package name, node version)', () => {
		const codex = [
			[nfeCodex, description.version],
			[triggerCodex, new NfeTrigger().description.version],
		] as const;
		for (const [file, version] of codex) {
			expect(file.node).toBe(packageJson.name);
			expect(Number(file.nodeVersion)).toBe(Math.max(...[version].flat()));
			expect(file.categories).toEqual(['Finance & Accounting']);
		}
	});

	it('uses collections (not fixed collections) for optional tax groups', () => {
		for (const name of ['issTaxes', 'federalWithholdings', 'additionalFields', 'taxReform']) {
			expect(description.properties.find((property) => property.name === name)?.type).toBe(
				'collection',
			);
		}
	});
});

describe('nodes saved by version 0.1', () => {
	// n8n runs the current class for any saved typeVersion: without the guard, a 0.1 Issue node
	// sent an invoice without its borrower and taxes (seen in n8n 2.43.7 against a local fake API).
	const v1Issue = {
		resource: 'serviceInvoice',
		operation: 'issue',
		companyId: COMPANY_ID,
		cityServiceCode: '0107',
		description: 'Consulting',
		servicesAmount: 100,
		borrowerSource: 'inline',
		borrowerData: { borrower: { name: 'Customer', federalTaxNumber: '12345678909' } },
		taxation: { values: { issRate: 0.05 } },
	};

	it.each([false, true])(
		'stops before any request (Continue On Fail %s)',
		async (continueOnFail) => {
			const api = new FakeApi();
			const context = executeContext({ params: v1Issue, api, continueOnFail, typeVersion: 1 });
			await expect(new Nfe().execute.call(context)).rejects.toThrow(
				'This node was created with version 0.1 of n8n-nodes-nfe',
			);
			expect(api.calls).toHaveLength(0);
		},
	);
});

describe('service invoice operations', () => {
	it('gets an invoice with each output mode', async () => {
		const api = new FakeApi().on('GET', `${BASE}/${INVOICE_ID}`, { body: invoice() });
		const [simplified] = await run(invoiceParams('get'), api);
		expect(Object.keys(simplified.json)).toHaveLength(10);
		const [raw] = await run(invoiceParams('get', { output: 'raw' }), api);
		expect(raw.json).toEqual(invoice());
		const [selected] = await run(
			invoiceParams('get', { output: 'selected', fields: 'number,provider.id' }),
			api,
		);
		expect(selected.json).toEqual({ number: 106, provider: { id: COMPANY_ID } });
	});

	it('explains a 404 and refuses path traversal before calling', async () => {
		const api = new FakeApi().on('GET', `${BASE}/${INVOICE_ID}`, {
			statusCode: 404,
			body: '"service invoice with id (x) was not found"',
		});
		await expect(run(invoiceParams('get'), api)).rejects.toThrow(
			'The service invoice was not found in this company',
		);
		const untouched = new FakeApi();
		await expect(
			run(invoiceParams('get', { invoiceId: '../webhooks' }), untouched),
		).rejects.toThrow('The Invoice ID is not valid');
		await expect(
			run(invoiceParams('get', { companyId: { __rl: true, mode: 'id', value: 'a/b' } }), untouched),
		).rejects.toThrow('The Company ID is not valid');
		expect(untouched.calls).toHaveLength(0);
	});

	it('returns all 105 invoices over 3 pages, one item per invoice', async () => {
		const api = new FakeApi().on(
			'GET',
			BASE,
			{ body: invoicePage(50, 0) },
			{ body: invoicePage(50, 50) },
			{ body: invoicePage(5, 100) },
		);
		const items = await run(invoiceParams('getAll', { returnAll: true, output: 'raw' }), api);
		expect(items).toHaveLength(105);
		expect(api.calls.map((call) => call.options.qs)).toEqual([
			{ pageCount: 50, pageIndex: 1 },
			{ pageCount: 50, pageIndex: 2 },
			{ pageCount: 50, pageIndex: 3 },
		]);
		expect(
			items.every((item) => item.pairedItem && (item.pairedItem as IDataObject).item === 0),
		).toBe(true);
	});

	it('stops at the limit and sends date filters as days', async () => {
		const api = new FakeApi().on(
			'GET',
			BASE,
			{ body: invoicePage(50, 0) },
			{ body: invoicePage(50, 50) },
		);
		const items = await run(
			invoiceParams('getAll', {
				returnAll: false,
				limit: 60,
				filters: {
					issuedBegin: '2026-10-01T00:00:00',
					createdEnd: '2026-10-16T23:59:59-03:00',
					issuedEnd: '',
				},
			}),
			api,
		);
		expect(items).toHaveLength(60);
		expect(api.calls).toHaveLength(2);
		expect(api.calls[0].options.qs).toEqual({
			pageCount: 50,
			pageIndex: 1,
			issuedBegin: '2026-10-01',
			createdEnd: '2026-10-16',
		});
		expect(toApiDate('16/10/2026')).toBe('16/10/2026');
		const empty = new FakeApi().on('GET', BASE, { body: {} });
		expect(await run(invoiceParams('getAll', { returnAll: true }), empty)).toHaveLength(0);
	});

	it('gets by External ID, with zero items or a message when not found', async () => {
		const api = new FakeApi()
			.on('GET', `${BASE}/external/pedido%2012`, {
				body: { serviceInvoices: [invoice()], page: 1 },
			})
			.on('GET', `${BASE}/external/missing`, { body: { serviceInvoices: [], page: 1 } });
		expect(
			await run(invoiceParams('getByExternalId', { externalId: 'pedido 12' }), api),
		).toHaveLength(1);
		expect(
			await run(invoiceParams('getByExternalId', { externalId: 'missing' }), api),
		).toHaveLength(0);
		await expect(
			run(invoiceParams('getByExternalId', { externalId: 'missing', failIfNotFound: true }), api),
		).rejects.toThrow('No invoice has this External ID');
	});

	it('cancels once and waits for Cancelled', async () => {
		const api = new FakeApi()
			.on('DELETE', `${BASE}/${INVOICE_ID}`, {
				statusCode: 202,
				body: invoice({ flowStatus: 'WaitingSendCancel' }),
			})
			.on('GET', `${BASE}/${INVOICE_ID}`, {
				body: invoice({ status: 'Cancelled', flowStatus: 'Cancelled' }),
			});
		const [item] = await run(
			invoiceParams('cancel', { waitForCancellation: true, waitTimeout: 60 }),
			api,
		);
		expect(item.json).toMatchObject({ flowStatus: 'Cancelled', waitTimedOut: false });
		expect(api.callsTo('DELETE', /./)).toHaveLength(1);
	});

	it('fails on CancelFailed and reads the invoice when DELETE has no body', async () => {
		const api = new FakeApi()
			.on('DELETE', `${BASE}/${INVOICE_ID}`, { statusCode: 202, body: '' })
			.on('GET', `${BASE}/${INVOICE_ID}`, {
				body: invoice({ flowStatus: 'CancelFailed', flowMessage: 'Prazo expirado' }),
			});
		await expect(run(invoiceParams('cancel'), api)).rejects.toThrow(
			'The city did not cancel the invoice',
		);
		const noWait = await run(invoiceParams('cancel', { waitForCancellation: false }), api);
		expect(noWait[0].json).not.toHaveProperty('waitTimedOut');
	});

	it('sends the email once', async () => {
		const api = new FakeApi().on('PUT', `${BASE}/${INVOICE_ID}/sendemail`, {
			statusCode: 200,
			body: '',
		});
		const [item] = await run(invoiceParams('sendEmail'), api);
		expect(item.json).toEqual({ sent: true, invoiceId: INVOICE_ID });
		expect(api.calls).toHaveLength(1);
	});

	it('downloads PDF, XML and cancellation XML as binary', async () => {
		const presigned = 'https://api.nfse.io/files/x?sig=1';
		const api = new FakeApi()
			.on(
				'GET',
				`${BASE}/${INVOICE_ID}/pdf`,
				{ statusCode: 404 },
				{ statusCode: 302, headers: { location: presigned } },
			)
			.on('GET', `${BASE}/${INVOICE_ID}/xml`, { statusCode: 302, headers: { location: presigned } })
			.on('GET', presigned, {
				statusCode: 200,
				headers: {
					'content-type': 'application/pdf',
					'content-disposition': 'attachment; filename=NFSE_00000105_SVBX.pdf',
				},
				body: Buffer.from('%PDF'),
			});
		const [pdf] = await run(invoiceParams('downloadPdf', { binaryPropertyName: 'invoice' }), api);
		expect(pdf.json).toEqual({
			invoiceId: INVOICE_ID,
			fileName: 'NFSE_00000105_SVBX.pdf',
			mimeType: 'application/pdf',
			fileSize: 4,
		});
		expect(pdf.binary?.invoice).toMatchObject({
			fileName: 'NFSE_00000105_SVBX.pdf',
			mimeType: 'application/pdf',
		});

		const xmlApi = new FakeApi().on('GET', `${BASE}/${INVOICE_ID}/xml`, {
			statusCode: 200,
			headers: { 'content-type': 'application/xml; charset=utf-8' },
			body: '<Nfse/>',
		});
		const [xml] = await run(invoiceParams('downloadXml'), xmlApi);
		expect(xml.json).toMatchObject({
			fileName: `nfse-${INVOICE_ID}.xml`,
			mimeType: 'application/xml',
		});
		expect(xml.binary?.data).toBeDefined();

		const cancellation = new FakeApi().on('GET', `${BASE}/${INVOICE_ID}/cancellation-xml`, {
			statusCode: 200,
			body: '<Evento/>',
		});
		const [event] = await run(invoiceParams('downloadCancellationXml'), cancellation);
		expect(event.json.fileName).toBe(`nfse-${INVOICE_ID}-cancellation.xml`);
	});

	it('explains a missing cancellation XML and a PDF that never appears', async () => {
		const api = new FakeApi()
			.on('GET', `${BASE}/${INVOICE_ID}/cancellation-xml`, {
				statusCode: 404,
				body: '"Cancellation event XML not available"',
			})
			.on('GET', `${BASE}/${INVOICE_ID}/pdf`, { statusCode: 404, body: '' });
		await expect(run(invoiceParams('downloadCancellationXml'), api)).rejects.toThrow(
			'The cancellation XML is not available for this invoice',
		);
		await expect(run(invoiceParams('downloadPdf'), api)).rejects.toThrow(
			'The PDF is not available yet',
		);
		expect(api.callsTo('GET', /\/pdf$/)).toHaveLength(4);
	});

	it('keeps going with Continue On Fail and links every item', async () => {
		const api = new FakeApi()
			.on('GET', `${BASE}/good-1`, { body: invoice({ id: 'good-1' }) })
			.on('GET', `${BASE}/good-3`, { body: invoice({ id: 'good-3' }) });
		const items = await run(
			[
				invoiceParams('get', { invoiceId: 'good-1' }),
				invoiceParams('get', { invoiceId: 'bad/2' }),
				invoiceParams('get', { invoiceId: 'good-3' }),
			],
			api,
			{ continueOnFail: true },
		);
		expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
		expect(items[1].json.error).toBe('The Invoice ID is not valid');
		expect(items[2].json.id).toBe('good-3');
	});

	it('rejects an unknown operation', async () => {
		await expect(
			run({ resource: 'serviceInvoice', operation: 'nope' }, new FakeApi()),
		).rejects.toThrow('The operation "nope" is not supported');
	});
});

describe('company operations', () => {
	const URL = 'https://api.nfse.io/v2/companies';

	it('gets a company from the envelope', async () => {
		const api = new FakeApi().on('GET', `${URL}/${COMPANY_ID}`, { body: { company: company(1) } });
		const [item] = await run(
			{ resource: 'company', operation: 'get', companyId: companyParam },
			api,
		);
		expect(item.json).toMatchObject({ name: 'EMPRESA 1 LTDA', city: 'Curitiba' });
		const missing = new FakeApi().on('GET', `${URL}/${COMPANY_ID}`, {
			statusCode: 404,
			body: { errors: [{ code: 40401, message: 'x' }] },
		});
		await expect(
			run({ resource: 'company', operation: 'get', companyId: companyParam }, missing),
		).rejects.toThrow('The company was not found');
		const flat = new FakeApi().on('GET', `${URL}/${COMPANY_ID}`, { body: company(1) });
		const [flatItem] = await run(
			{ resource: 'company', operation: 'get', companyId: companyParam, output: 'raw' },
			flat,
		);
		expect(flatItem.json.id).toBe(company(1).id);
	});

	it('follows the cursor with Return All and stops at the limit', async () => {
		const api = new FakeApi().on(
			'GET',
			URL,
			{ body: { hasMore: true, companies: [company(1), company(2)] } },
			{ body: { hasMore: false, companies: [company(3)] } },
		);
		const all = await run({ resource: 'company', operation: 'getAll', returnAll: true }, api);
		expect(all).toHaveLength(3);
		expect(api.calls[1].options.qs).toEqual({ limit: 50, startingAfter: company(2).id });

		const limited = new FakeApi().on('GET', URL, {
			body: { hasMore: true, companies: [company(1), company(2)] },
		});
		expect(
			await run({ resource: 'company', operation: 'getAll', returnAll: false, limit: 1 }, limited),
		).toHaveLength(1);
		expect(limited.calls).toHaveLength(1);
	});
});

describe('lookup operations', () => {
	const credentials = { apiKey: 'main-key', dataApiKey: 'data-key' };

	it('looks up a CNPJ on v3 without converting the alphanumeric CNPJ', async () => {
		const api = new FakeApi().on(
			'GET',
			'https://legalentity.api.nfe.io/v3/legalentities/basicInfo/12ABC34501DE35',
			{
				body: { legalEntity: { name: 'ACME', federalTaxNumber: '12ABC34501DE35' } },
			},
		);
		const [raw] = await run(
			{ resource: 'lookup', operation: 'getCompanyByCnpj', cnpj: '12.ABC.345/01DE-35' },
			api,
			{ credentials },
		);
		expect(raw.json).toEqual({ legalEntity: { name: 'ACME', federalTaxNumber: '12ABC34501DE35' } });
		const [simple] = await run(
			{
				resource: 'lookup',
				operation: 'getCompanyByCnpj',
				cnpj: '12ABC34501DE35',
				output: 'simplified',
			},
			api,
			{ credentials },
		);
		expect(simple.json.name).toBe('ACME');
	});

	it('never retries a billable lookup (a timed out call may have been charged)', async () => {
		const cases: Array<[IDataObject, RegExp]> = [
			[{ operation: 'getCompanyByCnpj', cnpj: '12ABC34501DE35' }, /legalentity/],
			[{ operation: 'getStateRegistration', state: 'PR', cnpj: '12ABC34501DE35' }, /legalentity/],
			[{ operation: 'getAddress', postalCode: '80010-000' }, /address\.api/],
		];
		for (const [params, host] of cases) {
			for (const failure of [{ statusCode: 503 }, { networkError: { code: 'ETIMEDOUT' } }]) {
				const api = new FakeApi().on('GET', host, failure);
				await expect(
					run({ resource: 'lookup', ...params }, api, { credentials }),
				).rejects.toThrow();
				expect(api.calls).toHaveLength(1);
			}
		}
	});

	it('never calls a billable lookup with invalid input or without the Data API Key', async () => {
		const api = new FakeApi();
		await expect(
			run({ resource: 'lookup', operation: 'getCompanyByCnpj', cnpj: '11.222.333/0001-82' }, api, {
				credentials,
			}),
		).rejects.toThrow('The CNPJ is not valid');
		await expect(
			run({ resource: 'lookup', operation: 'getAddress', postalCode: '123' }, api, { credentials }),
		).rejects.toThrow('The postal code is not valid');
		for (const missing of [{ apiKey: 'main-key' }, { apiKey: 'main-key', dataApiKey: '  ' }]) {
			await expect(
				run({ resource: 'lookup', operation: 'getAddress', postalCode: '80010-000' }, api, {
					credentials: missing,
				}),
			).rejects.toThrow('The Data API Key is missing in the credential');
		}
		expect(api.calls).toHaveLength(0);
	});

	it('gets the state registration and the address', async () => {
		const api = new FakeApi()
			.on('GET', 'https://legalentity.api.nfe.io/v3/legalentities/stateTaxInfo/PR/11222333000181', {
				body: { taxPayer: {} },
			})
			.on('GET', 'https://address.api.nfe.io/v2/addresses/80010000', {
				body: { address: { city: 'Curitiba' } },
			});
		const [state] = await run(
			{
				resource: 'lookup',
				operation: 'getStateRegistration',
				cnpj: '11222333000181',
				state: 'pr',
			},
			api,
			{ credentials },
		);
		expect(state.json).toEqual({ taxPayer: {} });
		const [address] = await run(
			{ resource: 'lookup', operation: 'getAddress', postalCode: '80010-000' },
			api,
			{ credentials },
		);
		expect(address.json).toEqual({ address: { city: 'Curitiba' } });
		expect(api.calls.every((call) => call.authenticated)).toBe(true);
	});

	it('gets the IBGE city code for free, without credentials', async () => {
		const api = new FakeApi()
			.on('GET', 'https://open.nfe.io/v1/cities/80010000/postalcode', {
				body: { city: { code: '4106902', name: 'Curitiba' } },
			})
			.on('GET', 'https://open.nfe.io/v1/cities/00000000/postalcode', {
				statusCode: 400,
				body: { errors: [{ message: "postalCode with value '00000000' is not valid" }] },
			})
			.on('GET', 'https://open.nfe.io/v1/cities/11111111/postalcode', { body: {} });
		const context = executeContext({
			params: { resource: 'lookup', operation: 'getCityCode', postalCode: '80010-000' },
			api,
		});
		const [[item]] = await new Nfe().execute.call(context);
		expect(item.json).toEqual({ postalCode: '80010000', code: '4106902', name: 'Curitiba' });
		expect(api.calls[0].authenticated).toBe(false);
		expect(api.calls[0].options.timeout).toBe(10000);
		expect(context.getCredentials).not.toHaveBeenCalled();
		await expect(
			run({ resource: 'lookup', operation: 'getCityCode', postalCode: '00000000' }, api),
		).rejects.toThrow('This postal code was not found');
		const [empty] = await run(
			{ resource: 'lookup', operation: 'getCityCode', postalCode: '11111111' },
			api,
		);
		expect(empty.json).toEqual({ postalCode: '11111111', code: null, name: null });
	});
});
