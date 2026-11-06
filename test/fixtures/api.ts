/**
 * NFE.io API fixtures, redacted from the shapes observed in live probes (V3 service invoice,
 * list envelopes, error bodies). IDs, names and tax numbers are fictitious.
 */
import type { IDataObject } from 'n8n-workflow';

export const COMPANY_ID = 'company0000000000000000001';
export const INVOICE_ID = 'invoice000000000000000001';

export function invoice(overrides: IDataObject = {}): IDataObject {
	return {
		id: INVOICE_ID,
		externalId: 'n8n-test-00000000-0000-4000-8000-000000000000',
		environment: 'Development',
		flowStatus: 'Issued',
		flowMessage: undefined,
		status: 'Issued',
		apiVersion: 3,
		number: 106,
		checkCode: '10600000000000001',
		issuedOn: '2026-10-17T00:51:49.2397053+00:00',
		createdOn: '2026-10-17T00:51:49.2396857+00:00',
		cityServiceCode: '10677',
		federalServiceCode: '01.01',
		nbsCode: '115021000',
		description: 'Test invoice',
		servicesAmount: 1,
		taxationType: 'WithinCity',
		issRate: 0,
		issTaxAmount: 0,
		rpsSerialNumber: 'IO',
		rpsNumber: 106,
		provider: {
			id: COMPANY_ID,
			name: 'EMPRESA DE TESTE LTDA',
			federalTaxNumber: '11222333000181',
			taxRegime: 'SimplesNacional',
		},
		borrower: {
			id: 'borrower00000000000000001',
			name: 'Cliente Teste n8n',
			federalTaxNumber: '52998224725',
			type: 'NaturalPerson',
			address: {
				country: 'BRA',
				postalCode: '80010000',
				street: 'Rua XV de Novembro',
				number: '100',
				district: 'Centro',
				city: { code: '4106902', name: 'Curitiba' },
				state: 'PR',
			},
		},
		ibsCbs: {
			purpose: 'Regular',
			destinationIndicator: 'SameAsBuyer',
			operationIndicator: '100301',
			classCode: '000001',
		},
		...overrides,
	};
}

export function invoicePage(count: number, start = 0): IDataObject {
	return {
		serviceInvoices: Array.from({ length: count }, (_, index) =>
			invoice({
				id: `invoice${String(start + index).padStart(18, '0')}`,
				number: start + index + 1,
			}),
		),
		page: 1,
	};
}

export function company(index: number, overrides: IDataObject = {}): IDataObject {
	return {
		id: `company${String(index).padStart(19, '0')}`,
		name: `EMPRESA ${index} LTDA`,
		tradeName: index % 2 === 0 ? `Fantasia ${index}` : '',
		federalTaxNumber: 11222333000181,
		taxRegime: 'SimplesNacional',
		status: 'Active',
		address: { state: 'PR', city: { code: '4106902', name: 'Curitiba' } },
		...overrides,
	};
}

/** The error body formats returned by the NFE.io APIs. */
export const ERROR_BODIES = {
	plainString: '"service invoice with id (000000000000000000000000) was not found"',
	rfc7807WithErrors: {
		type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
		title: 'One or more validation errors occurred.',
		status: 400,
		errors: {
			rpsNumber: ["The value 'abc' is not valid."],
			borrower: ['Name is required.', 'Too short.'],
		},
		traceId: '00-0000-0000-01',
	},
	rfc7807WithoutErrors: {
		type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
		title: 'Not Found',
		status: 404,
		traceId: '00-0000-0000-02',
	},
	codeAndMessage: { errors: [{ code: 40401, message: 'company not found' }] },
	messageOnly: { errors: [{ message: "postalCode with value '00000000' is not valid" }] },
	empty: '',
};
