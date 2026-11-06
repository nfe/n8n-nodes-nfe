import type { IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NfeApi } from '../../credentials/NfeApi.credentials';
import { formatTaxNumber, getCompanies } from '../../nodes/Nfe/methods/listSearch';
import { companyLocator } from '../../nodes/Nfe/shared/company';
import {
	getPath,
	selectFields,
	shapeOutput,
	simplifyCompany,
	simplifyInvoice,
	simplifyLegalEntity,
} from '../../nodes/Nfe/shared/output';
import { clampWaitSeconds, ISSUE_TERMINAL, waitForFlowStatus } from '../../nodes/Nfe/shared/poll';
import {
	assertId,
	encodeExternalId,
	isValidCnpj,
	isValidCpf,
	normalizeBorrowerTaxNumber,
	normalizeCnpj,
	normalizeFederalServiceCode,
	normalizeNbsCode,
	normalizePostalCode,
	normalizeSixDigits,
	normalizeState,
	parseJsonObject,
} from '../../nodes/Nfe/shared/validators';
import { company, invoice } from '../fixtures/api';
import { FakeApi, loadOptionsContext, TEST_NODE } from '../helpers/context';

beforeEach(() => vi.mocked(sleep).mockClear());

describe('validators', () => {
	it('accepts ids and blocks path traversal', () => {
		expect(assertId(TEST_NODE, ' abc_DEF-123 ', 'Invoice ID')).toBe('abc_DEF-123');
		for (const bad of ['../webhooks', 'a/b', '', 'a'.repeat(65), 'a b', undefined]) {
			expect(() => assertId(TEST_NODE, bad, 'Invoice ID')).toThrow('The Invoice ID is not valid');
		}
		expect(assertId(TEST_NODE, 123, 'id')).toBe('123');
	});

	it('encodes External IDs and refuses separators', () => {
		expect(encodeExternalId(TEST_NODE, 'pedido #12 ç')).toBe('pedido%20%2312%20%C3%A7');
		for (const bad of ['.', '..', 'a/b', 'a\\b', '', 'x'.repeat(129)]) {
			expect(() => encodeExternalId(TEST_NODE, bad)).toThrow('The External ID is not valid');
		}
	});

	it('validates numeric and alphanumeric CNPJ check digits', () => {
		expect(isValidCnpj('00623904000173')).toBe(true);
		expect(isValidCnpj('11222333000181')).toBe(true);
		// Example from the Receita Federal for the alphanumeric CNPJ.
		expect(isValidCnpj('12ABC34501DE35')).toBe(true);
		expect(isValidCnpj('12ABC34501DE36')).toBe(false);
		expect(isValidCnpj('11222333000182')).toBe(false);
		expect(isValidCnpj('00000000000000')).toBe(false);
		expect(isValidCnpj('1122233300018')).toBe(false);
		expect(normalizeCnpj(TEST_NODE, '12.abc.345/01de-35')).toBe('12ABC34501DE35');
		expect(() => normalizeCnpj(TEST_NODE, '11.222.333/0001-82')).toThrow('The CNPJ is not valid');
	});

	it('validates CPF', () => {
		expect(isValidCpf('52998224725')).toBe(true);
		expect(isValidCpf('52998224724')).toBe(false);
		expect(isValidCpf('11111111111')).toBe(false);
		expect(isValidCpf('5299822472')).toBe(false);
		expect(normalizeBorrowerTaxNumber(TEST_NODE, '529.982.247-25')).toBe('52998224725');
		expect(normalizeBorrowerTaxNumber(TEST_NODE, '00.623.904/0001-73')).toBe('00623904000173');
		expect(() => normalizeBorrowerTaxNumber(TEST_NODE, '529.982.247-24')).toThrow(
			'Federal Tax Number',
		);
		expect(() => normalizeBorrowerTaxNumber(TEST_NODE, '123')).toThrow('Federal Tax Number');
	});

	it('normalizes postal code, state, NBS, LC 116 and six-digit codes', () => {
		expect(normalizePostalCode(TEST_NODE, '80010-000')).toBe('80010000');
		expect(() => normalizePostalCode(TEST_NODE, '8001000')).toThrow('postal code');
		expect(normalizeState(TEST_NODE, 'pr')).toBe('PR');
		expect(() => normalizeState(TEST_NODE, 'XX')).toThrow('state');
		expect(normalizeNbsCode(TEST_NODE, '1.1502.10.00')).toBe('115021000');
		expect(() => normalizeNbsCode(TEST_NODE, '1.1502.10')).toThrow('NBS Code');
		expect(normalizeFederalServiceCode(TEST_NODE, '1.07')).toBe('01.07');
		expect(normalizeFederalServiceCode(TEST_NODE, '0107')).toBe('01.07');
		expect(normalizeFederalServiceCode(TEST_NODE, '17.01')).toBe('17.01');
		expect(() => normalizeFederalServiceCode(TEST_NODE, '1701.1')).toThrow('Federal Service Code');
		expect(normalizeSixDigits(TEST_NODE, '100301', 'Operation Indicator')).toBe('100301');
		expect(() => normalizeSixDigits(TEST_NODE, '1005011', 'Operation Indicator')).toThrow(
			'The Operation Indicator must have exactly 6 digits',
		);
		expect(() => normalizeSixDigits(TEST_NODE, undefined, 'Classification Code')).toThrow(
			'6 digits',
		);
	});

	it('parses JSON objects from text or expressions', () => {
		expect(parseJsonObject(TEST_NODE, '{"a":1}', 'X')).toEqual({ a: 1 });
		expect(parseJsonObject(TEST_NODE, { a: 1 }, 'X')).toEqual({ a: 1 });
		expect(parseJsonObject(TEST_NODE, '  ', 'X')).toEqual({});
		expect(() => parseJsonObject(TEST_NODE, '{bad', 'X')).toThrow('X must be a JSON object');
		expect(() => parseJsonObject(TEST_NODE, '[1]', 'X')).toThrow(NodeOperationError);
	});
});

describe('NfeApi credential', () => {
	const credential = new NfeApi();
	const keys = { apiKey: 'main-key', dataApiKey: 'data-key' };
	const authorization = async (
		options: Partial<IHttpRequestOptions>,
		data: Record<string, unknown> = keys,
	) =>
		(await credential.authenticate(data as never, { url: '', ...options } as IHttpRequestOptions))
			.headers?.Authorization;

	it('keeps the 0.1 name and the main key field, both keys as passwords', () => {
		expect(credential.name).toBe('nfeApi');
		expect(credential.properties.map((property) => property.name)).toEqual([
			'apiKey',
			'dataApiKey',
		]);
		expect(credential.properties.every((property) => property.typeOptions?.password)).toBe(true);
		expect(credential.properties[0].required).toBe(true);
		expect(credential.properties[1].required).toBeUndefined();
	});

	it('sends the data key only to the data services, without prefix', async () => {
		expect(
			await authorization({ url: 'https://legalentity.api.nfe.io/v3/legalentities/basicInfo/1' }),
		).toBe('data-key');
		expect(await authorization({ url: 'https://ADDRESS.api.nfe.io/v2/addresses/1' })).toBe(
			'data-key',
		);
		expect(await authorization({ url: 'https://api.nfe.io/v3/companies' })).toBe('main-key');
		expect(await authorization({ url: 'https://api.nfse.io/v2/webhooks' })).toBe('main-key');
		expect(await authorization({ baseURL: 'https://api.nfse.io', url: '/v2/companies' })).toBe(
			'main-key',
		);
		expect(await authorization({ url: 'not a url' })).toBe('main-key');
	});

	it('keeps other headers and handles a missing data key', async () => {
		const result = await credential.authenticate({ apiKey: 'main-key' } as never, {
			url: 'https://address.api.nfe.io/v2/addresses/1',
			headers: { Accept: 'application/json' },
		});
		expect(result.headers).toEqual({ Accept: 'application/json', Authorization: '' });
	});

	it('tests the main key on the v2 companies endpoint', () => {
		expect(credential.test.request).toEqual({
			baseURL: 'https://api.nfse.io',
			url: '/v2/companies',
			qs: { limit: 1 },
		});
	});
});

describe('output', () => {
	it('simplifies an invoice to 10 flat fields', () => {
		const simplified = simplifyInvoice(invoice());
		expect(Object.keys(simplified)).toHaveLength(10);
		expect(simplified).toMatchObject({
			id: invoice().id,
			borrowerName: 'Cliente Teste n8n',
			borrowerFederalTaxNumber: '52998224725',
			flowMessage: null,
		});
	});

	it('simplifies companies and legal entities', () => {
		expect(simplifyCompany(company(2))).toEqual({
			id: company(2).id,
			name: 'EMPRESA 2 LTDA',
			tradeName: 'Fantasia 2',
			federalTaxNumber: 11222333000181,
			taxRegime: 'SimplesNacional',
			status: 'Active',
			city: 'Curitiba',
			state: 'PR',
		});
		const entity = simplifyLegalEntity({
			legalEntity: { name: 'X', economicActivities: [{ code: 6201501 }], address: { state: 'SP' } },
		});
		expect(Object.keys(entity)).toHaveLength(10);
		expect(entity).toMatchObject({ name: 'X', economicActivity: 6201501, state: 'SP', city: null });
		expect(simplifyLegalEntity({ name: 'Flat' }).name).toBe('Flat');
	});

	it('selects nested fields and blocks prototype keys', () => {
		expect(selectFields(invoice(), 'number, borrower.name,provider.missing')).toEqual({
			number: 106,
			borrower: { name: 'Cliente Teste n8n' },
			provider: { missing: null },
		});
		expect(getPath({ a: 1 }, '__proto__.x')).toBeUndefined();
		for (const unsafe of ['__proto__.polluted', 'constructor.prototype.polluted', 'a..b']) {
			expect(selectFields({ a: 1 }, unsafe)).toEqual({});
		}
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
		expect(shapeOutput({ a: 1 }, 'raw', '', simplifyInvoice)).toEqual({ a: 1 });
		expect(shapeOutput({ a: 1 }, 'selected', 'a', simplifyInvoice)).toEqual({ a: 1 });
	});

	it('never pollutes Object.prototype through selected field paths', () => {
		const unsafe = [
			'__proto__',
			'__proto__.polluted',
			'a.__proto__.polluted',
			'constructor.prototype.polluted',
			'a.constructor.prototype.polluted',
			'prototype.polluted',
			'a.prototype',
		];
		for (const path of unsafe) {
			const result = selectFields({ a: { b: 1 } }, path);
			expect(result).toEqual({});
			expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		}
		expect(shapeOutput({ a: 1 }, 'selected', unsafe.join(','), simplifyInvoice)).toEqual({});
		expect(Object.prototype).not.toHaveProperty('polluted');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		// Inherited members are not reused as containers for nested writes.
		expect(selectFields({}, 'toString.x')).toEqual({ toString: { x: null } });
		expect(Object.prototype.toString).toBeTypeOf('function');
	});
});

describe('waitForFlowStatus', () => {
	it('uses flowStatus, not status, as the end signal', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(invoice({ status: 'Issued', flowStatus: 'WaitingDownload' }))
			.mockResolvedValueOnce(invoice({ status: 'Issued', flowStatus: 'Issued' }));
		const result = await waitForFlowStatus(
			invoice({ status: 'Created', flowStatus: 'WaitingCalculateTaxes' }),
			fetch,
			ISSUE_TERMINAL,
			60,
		);
		expect(result.timedOut).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('times out after timeout / interval polls', async () => {
		const fetch = vi.fn().mockResolvedValue(invoice({ flowStatus: 'WaitingSend' }));
		const result = await waitForFlowStatus(
			invoice({ flowStatus: 'WaitingSend' }),
			fetch,
			ISSUE_TERMINAL,
			10,
		);
		expect(result.timedOut).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(5);
	});

	it('clamps the timeout between 1 and 300 seconds', () => {
		expect(clampWaitSeconds(1000)).toBe(300);
		expect(clampWaitSeconds(0)).toBe(1);
		expect(clampWaitSeconds('abc')).toBe(1);
		expect(clampWaitSeconds(59.9)).toBe(59);
	});
});

describe('company list (resource locator)', () => {
	it('shows name, trade name and CNPJ and returns the cursor', async () => {
		const api = new FakeApi().on('GET', 'https://api.nfse.io/v2/companies', {
			body: {
				hasMore: true,
				companies: [company(1), company(2, { federalTaxNumber: '12ABC34501DE35' })],
			},
		});
		const result = await getCompanies.call(loadOptionsContext(api));
		expect(result.results).toEqual([
			{ name: 'EMPRESA 1 LTDA - 11.222.333/0001-81', value: company(1).id },
			{ name: 'EMPRESA 2 LTDA (Fantasia 2) - 12.ABC.345/01DE-35', value: company(2).id },
		]);
		expect(result.paginationToken).toBe(company(2).id);
		expect(api.calls[0].options.qs).toEqual({ limit: 50 });
	});

	it('continues from the cursor and filters by name, trade name or CNPJ', async () => {
		const pages = [
			{ hasMore: true, companies: [company(1), company(2)] },
			{
				hasMore: false,
				companies: [company(3, { name: 'SINTETICA TECH', federalTaxNumber: 11444777000161 })],
			},
		];
		const api = new FakeApi().on(
			'GET',
			'https://api.nfse.io/v2/companies',
			{ body: pages[0] },
			{ body: pages[1] },
		);
		const result = await getCompanies.call(loadOptionsContext(api), 'sintetica', 'company-start');
		expect(result.results.map((item) => item.value)).toEqual([company(3).id]);
		expect(result.paginationToken).toBeUndefined();
		expect(api.calls[0].options.qs).toEqual({ limit: 50, startingAfter: 'company-start' });
		expect(api.calls[1].options.qs).toEqual({ limit: 50, startingAfter: company(2).id });

		const byTaxNumber = new FakeApi().on('GET', /companies/, { body: pages[1] });
		const found = await getCompanies.call(loadOptionsContext(byTaxNumber), '11.444.777');
		expect(found.results).toHaveLength(1);
		const byTrade = new FakeApi().on('GET', /companies/, { body: { ...pages[0], hasMore: false } });
		expect((await getCompanies.call(loadOptionsContext(byTrade), 'fantasia')).results).toHaveLength(
			1,
		);
		const empty = new FakeApi().on('GET', /companies/, { body: {} });
		expect(await getCompanies.call(loadOptionsContext(empty))).toEqual({
			results: [],
			paginationToken: undefined,
		});
	});

	it('formats tax numbers and builds the locator', () => {
		expect(formatTaxNumber(623904000173)).toBe('00.623.904/0001-73');
		expect(formatTaxNumber('')).toBe('');
		expect(formatTaxNumber('52998224725')).toBe('52998224725');
		const locator = companyLocator(undefined, { required: false, description: 'x' });
		expect(locator.displayOptions).toBeUndefined();
		expect(locator.modes?.map((mode) => mode.name)).toEqual(['list', 'id']);
		expect(
			companyLocator({ resource: ['a'] }, { required: true, description: 'x' }).displayOptions,
		).toEqual({
			show: { resource: ['a'] },
		});
	});
});
