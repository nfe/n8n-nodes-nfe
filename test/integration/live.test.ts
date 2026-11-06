/**
 * Opt-in tests against the real NFE.io API. Never run in CI.
 *
 *   NFE_LIVE=1 NFE_API_KEY=... NFE_COMPANY_ID=... npm run test:integration
 *
 * Read only by default. NFE_LIVE_WRITE=1 also issues one service invoice (External ID
 * `n8n-test-<uuid>`) and cancels it at the end. Charged lookups (CNPJ, postal code) are not run.
 */
import { randomUUID } from 'crypto';
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Nfe } from '../../nodes/Nfe/Nfe.node';
import { LIVE, LIVE_COMPANY_ID, LIVE_WRITE, liveCalls, liveContext } from './live-context';

const node = new Nfe();
const company = { __rl: true, mode: 'id', value: LIVE_COMPANY_ID };

async function run(params: IDataObject | IDataObject[], credentials?: IDataObject) {
	const [items] = await node.execute.call(liveContext(params, credentials as never));
	return items as INodeExecutionData[];
}

describe.runIf(LIVE)('NFE.io API (live, read)', () => {
	it('reads the company and lists companies', async () => {
		const [one] = await run({
			resource: 'company',
			operation: 'get',
			companyId: company,
			output: 'raw',
		});
		expect(one.json.id).toBe(LIVE_COMPANY_ID);
		const many = await run({
			resource: 'company',
			operation: 'getAll',
			returnAll: false,
			limit: 3,
			output: 'simplified',
		});
		expect(many).toHaveLength(3);
	});

	it('lists, reads and finds service invoices by External ID', async () => {
		const page = await run({
			resource: 'serviceInvoice',
			operation: 'getAll',
			companyId: company,
			returnAll: false,
			limit: 60,
			filters: {},
			output: 'raw',
		});
		expect(page).toHaveLength(60);
		expect(new Set(page.map((item) => item.json.id)).size).toBe(60);
		const withExternal = page.find((item) => item.json.externalId);
		const [invoice] = await run({
			resource: 'serviceInvoice',
			operation: 'get',
			companyId: company,
			invoiceId: page[0].json.id,
			output: 'raw',
		});
		expect(invoice.json.id).toBe(page[0].json.id);
		expect(typeof (invoice.json.provider as IDataObject)?.federalTaxNumber).toBe('string');
		if (withExternal) {
			const found = await run({
				resource: 'serviceInvoice',
				operation: 'getByExternalId',
				companyId: company,
				externalId: withExternal.json.externalId,
				output: 'raw',
			});
			expect(found.map((item) => item.json.id)).toContain(withExternal.json.id);
		}
		const missing = await run({
			resource: 'serviceInvoice',
			operation: 'getByExternalId',
			companyId: company,
			externalId: `n8n-test-missing-${randomUUID()}`,
			output: 'raw',
		});
		expect(missing).toHaveLength(0);
	});

	it('downloads the XML of an issued invoice as binary', async () => {
		const page = await run({
			resource: 'serviceInvoice',
			operation: 'getAll',
			companyId: company,
			returnAll: false,
			limit: 50,
			filters: {},
			output: 'raw',
		});
		const issued = page.find((item) => item.json.flowStatus === 'Issued');
		if (!issued) return;
		const [file] = await run({
			resource: 'serviceInvoice',
			operation: 'downloadXml',
			companyId: company,
			invoiceId: issued.json.id,
			binaryPropertyName: 'data',
		});
		const data = Buffer.from(String(file.binary?.data.data), 'base64');
		expect(data.subarray(0, 5).toString()).toBe('<Nfse');
	});

	it('gets a city code for free and refuses charged lookups without the data key', async () => {
		const [city] = await run({
			resource: 'lookup',
			operation: 'getCityCode',
			postalCode: '80010-000',
		});
		expect(city.json).toMatchObject({ code: '4106902' });
		const before = liveCalls.length;
		await expect(
			run(
				{
					resource: 'lookup',
					operation: 'getCompanyByCnpj',
					cnpj: '11.444.777/0001-61',
					output: 'raw',
				},
				{ apiKey: 'any', dataApiKey: '' },
			),
		).rejects.toThrow(/Data API Key/);
		expect(liveCalls.length).toBe(before);
	});

	it('explains an unknown company and a rejected key', async () => {
		await expect(
			run({
				resource: 'company',
				operation: 'get',
				companyId: { __rl: true, mode: 'id', value: '000000000000000000000000' },
				output: 'raw',
			}),
		).rejects.toThrow();
		await expect(
			run(
				{ resource: 'company', operation: 'getAll', returnAll: false, limit: 1 },
				{ apiKey: 'not-a-valid-key', dataApiKey: '' },
			),
		).rejects.toThrow(/key/i);
	});
});

describe.runIf(LIVE_WRITE)('NFE.io API (live, write: 1 invoice, cancelled)', () => {
	it('issues with the tax reform group, waits, finds it again and cancels it', async () => {
		const externalId = `n8n-test-${randomUUID()}`;
		const issue = {
			resource: 'serviceInvoice',
			operation: 'issue',
			companyId: company,
			cityServiceCode: '10677',
			description: 'n8n-nodes-nfe integration test',
			servicesAmount: 1,
			borrowerInput: 'fields',
			borrowerName: 'Cliente Teste n8n',
			borrowerFederalTaxNumber: '529.982.247-25',
			borrowerDetails: {
				postalCode: '80010-000',
				street: 'Rua XV de Novembro',
				number: '100',
				district: 'Centro',
				cityCode: '4106902',
				cityName: 'Curitiba',
				state: 'PR',
			},
			additionalFields: { externalId, federalServiceCode: '01.01', nbsCode: '115021000' },
			taxReform: { operationIndicator: '100301', classCode: '000001' },
			waitForAuthorization: true,
			waitTimeout: 120,
			output: 'raw',
		};
		const [issued] = await run(issue);
		expect(issued.json).toMatchObject({ externalId, alreadyExisted: false });
		try {
			expect(issued.json.flowStatus).toBe('Issued');
			const [again] = await run(issue);
			expect(again.json).toMatchObject({ id: issued.json.id, alreadyExisted: true });
		} finally {
			const [cancelled] = await run({
				resource: 'serviceInvoice',
				operation: 'cancel',
				companyId: company,
				invoiceId: issued.json.id,
				waitForCancellation: true,
				waitTimeout: 120,
				output: 'raw',
			});
			expect(cancelled.json.flowStatus).toBe('Cancelled');
		}
	});
});
