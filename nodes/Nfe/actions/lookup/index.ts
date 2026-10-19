import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	ADDRESS_BASE,
	BILLABLE_NOTICE,
	LEGAL_ENTITY_BASE,
	OPEN_API_BASE,
} from '../../shared/constants';
import {
	outputProperties,
	shapeOutput,
	simplifyLegalEntity,
	type OutputMode,
} from '../../shared/output';
import {
	BRAZILIAN_STATES,
	normalizeCnpj,
	normalizePostalCode,
	normalizeState,
} from '../../shared/validators';
import { publicGet } from '../../transport/public';
import { apiRequestBody, CREDENTIAL_NAME } from '../../transport/request';
import type { OperationHandler } from '../types';

const RESOURCE = 'lookup';
const BILLABLE = ['getCompanyByCnpj', 'getStateRegistration', 'getAddress'];

const NOT_FOUND = {
	message: 'NFE.io has no record for this value',
	hint: 'Check the value you entered.',
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get Address by Postal Code',
				value: 'getAddress',
				description: 'Get the address of a CEP. Billable lookup, needs the Data API Key.',
				action: 'Get an address by postal code',
			},
			{
				name: 'Get City Code by Postal Code',
				value: 'getCityCode',
				description: 'Get the IBGE city code and name of a CEP. Free, no key needed.',
				action: 'Get a city code by postal code',
			},
			{
				name: 'Get Company by CNPJ',
				value: 'getCompanyByCnpj',
				description:
					'Get the registration data of a company from the CNPJ (numeric or alphanumeric). Billable lookup, needs the Data API Key.',
				action: 'Get a company by CNPJ',
			},
			{
				name: 'Get State Registration',
				value: 'getStateRegistration',
				description:
					'Get the state registrations (inscrição estadual) of a CNPJ in a state. Billable lookup, needs the Data API Key.',
				action: 'Get the state registration of a company',
			},
		],
		default: 'getCompanyByCnpj',
	},
	{
		displayName: BILLABLE_NOTICE,
		name: 'billableNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: BILLABLE } },
	},
	{
		displayName: 'CNPJ',
		name: 'cnpj',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 00.623.904/0001-73',
		description:
			'CNPJ with or without punctuation. Validated before the lookup, so a typo is not billed.',
		displayOptions: {
			show: { resource: [RESOURCE], operation: ['getCompanyByCnpj', 'getStateRegistration'] },
		},
	},
	{
		displayName: 'State',
		name: 'state',
		type: 'options',
		required: true,
		default: 'SP',
		description: 'State where the registration is searched',
		options: BRAZILIAN_STATES.map((state) => ({ name: state, value: state })),
		displayOptions: { show: { resource: [RESOURCE], operation: ['getStateRegistration'] } },
	},
	{
		displayName: 'Postal Code',
		name: 'postalCode',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 80010-000',
		description: 'CEP with 8 digits, with or without the dash',
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAddress', 'getCityCode'] } },
	},
	...outputProperties(
		{ resource: [RESOURCE], operation: ['getCompanyByCnpj'] },
		'Return the 10 main fields of the company',
	).map((property) => (property.name === 'output' ? { ...property, default: 'raw' } : property)),
];

/**
 * Billable services need the Data API Key; checking first avoids a call that can only be refused.
 * They are also never retried automatically: a lookup that timed out may have been charged.
 */
async function requireDataKey(ctx: IExecuteFunctions, itemIndex: number) {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME, itemIndex);
	if (typeof credentials.dataApiKey !== 'string' || credentials.dataApiKey.trim() === '') {
		throw new NodeOperationError(ctx.getNode(), 'The Data API Key is missing in the credential', {
			description:
				'CNPJ, state registration and postal code lookups use the NFE.io Data API Key. Add it to the NFE.io credential and run again. No lookup was made.',
			itemIndex,
		});
	}
}

async function getCompanyByCnpj(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const cnpj = normalizeCnpj(ctx.getNode(), ctx.getNodeParameter('cnpj', itemIndex), itemIndex);
	await requireDataKey(ctx, itemIndex);
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{ method: 'GET', url: `${LEGAL_ENTITY_BASE}/legalentities/basicInfo/${cnpj}` },
		{ itemIndex, retry: false, hints: { 404: NOT_FOUND } },
	);
	const mode = ctx.getNodeParameter('output', itemIndex, 'raw') as OutputMode;
	const fields =
		mode === 'selected' ? (ctx.getNodeParameter('fields', itemIndex, '') as string) : '';
	return [{ json: shapeOutput(body, mode, fields, simplifyLegalEntity) }];
}

async function getStateRegistration(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = ctx.getNode();
	const cnpj = normalizeCnpj(node, ctx.getNodeParameter('cnpj', itemIndex), itemIndex);
	const state = normalizeState(node, ctx.getNodeParameter('state', itemIndex), itemIndex);
	await requireDataKey(ctx, itemIndex);
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{ method: 'GET', url: `${LEGAL_ENTITY_BASE}/legalentities/stateTaxInfo/${state}/${cnpj}` },
		{ itemIndex, retry: false, hints: { 404: NOT_FOUND } },
	);
	return [{ json: body }];
}

async function getAddress(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const postalCode = normalizePostalCode(
		ctx.getNode(),
		ctx.getNodeParameter('postalCode', itemIndex),
		itemIndex,
	);
	await requireDataKey(ctx, itemIndex);
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{ method: 'GET', url: `${ADDRESS_BASE}/addresses/${postalCode}` },
		{ itemIndex, retry: false, hints: { 404: NOT_FOUND } },
	);
	return [{ json: body }];
}

async function getCityCode(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const postalCode = normalizePostalCode(
		ctx.getNode(),
		ctx.getNodeParameter('postalCode', itemIndex),
		itemIndex,
	);
	const response = await publicGet(ctx, `${OPEN_API_BASE}/cities/${postalCode}/postalcode`, {
		itemIndex,
		hints: {
			400: { message: 'This postal code was not found', hint: 'Check the 8 digits of the CEP.' },
			404: { message: 'This postal code was not found', hint: 'Check the 8 digits of the CEP.' },
		},
	});
	const body = (response.body ?? {}) as IDataObject;
	const city = (body.city as IDataObject | undefined) ?? {};
	return [{ json: { postalCode, code: city.code ?? null, name: city.name ?? null } }];
}

export const operations: Record<string, OperationHandler> = {
	getCompanyByCnpj,
	getStateRegistration,
	getAddress,
	getCityCode,
};
