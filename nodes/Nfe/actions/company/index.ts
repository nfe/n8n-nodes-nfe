import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

import { getCompanyId, companyLocator } from '../../shared/company';
import { COMPANIES_V2_BASE, COMPANY_PAGE_SIZE, MAX_PAGES } from '../../shared/constants';
import {
	outputProperties,
	shapeOutput,
	simplifyCompany,
	type OutputMode,
} from '../../shared/output';
import { apiRequestBody } from '../../transport/request';
import type { OperationHandler } from '../types';

const RESOURCE = 'company';

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a company of the NFE.io account',
				action: 'Get a company',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the companies of the NFE.io account',
				action: 'Get many companies',
			},
		],
		default: 'get',
	},
	companyLocator(
		{ resource: [RESOURCE], operation: ['get'] },
		{ required: true, description: 'Company to get' },
	),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'], returnAll: [false] } },
	},
	...outputProperties(
		{ resource: [RESOURCE], operation: ['get', 'getAll'] },
		'Return the 8 main fields of the company',
	),
];

function shape(ctx: IExecuteFunctions, company: IDataObject, itemIndex: number): IDataObject {
	const mode = ctx.getNodeParameter('output', itemIndex, 'simplified') as OutputMode;
	const fields =
		mode === 'selected' ? (ctx.getNodeParameter('fields', itemIndex, '') as string) : '';
	return shapeOutput(company, mode, fields, simplifyCompany);
}

async function get(ctx: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const companyId = getCompanyId(ctx, itemIndex);
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{ method: 'GET', url: `${COMPANIES_V2_BASE}/companies/${companyId}` },
		{
			itemIndex,
			hints: {
				404: {
					message: 'The company was not found in this NFE.io account',
					hint: 'Check the Company ID and that the API key belongs to the same account.',
				},
			},
		},
	);
	const company = (body.company as IDataObject | undefined) ?? body;
	return [{ json: shape(ctx, company, itemIndex) }];
}

async function getAll(ctx: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? Infinity : (ctx.getNodeParameter('limit', itemIndex, 50) as number);
	const results: INodeExecutionData[] = [];
	let startingAfter: string | undefined;

	for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
		const qs: IDataObject = { limit: COMPANY_PAGE_SIZE };
		if (startingAfter) qs.startingAfter = startingAfter;
		const body = await apiRequestBody<IDataObject>(
			ctx,
			{ method: 'GET', url: `${COMPANIES_V2_BASE}/companies`, qs },
			{ itemIndex },
		);
		const companies = (body.companies as IDataObject[] | undefined) ?? [];
		for (const company of companies) {
			if (results.length >= limit) break;
			results.push({ json: shape(ctx, company, itemIndex) });
		}
		if (body.hasMore !== true || companies.length === 0) break;
		startingAfter = String(companies[companies.length - 1].id);
	}
	return results;
}

export const operations: Record<string, OperationHandler> = { get, getAll };
