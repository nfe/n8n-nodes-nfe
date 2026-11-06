import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { MAX_PAGES, PAGE_SIZE } from '../../shared/constants';
import { apiRequestBody } from '../../transport/request';
import { invoicesUrl, RESOURCE, shapeInvoice } from './common';

const show = { resource: [RESOURCE], operation: ['getAll'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Accrual Date From',
				name: 'issuedBegin',
				type: 'dateTime',
				default: '',
				description: 'Only invoices with accrual date (competência) on or after this day',
			},
			{
				displayName: 'Accrual Date To',
				name: 'issuedEnd',
				type: 'dateTime',
				default: '',
				description: 'Only invoices with accrual date (competência) on or before this day',
			},
			{
				displayName: 'Created From',
				name: 'createdBegin',
				type: 'dateTime',
				default: '',
				description: 'Only invoices created on or after this day',
			},
			{
				displayName: 'Created To',
				name: 'createdEnd',
				type: 'dateTime',
				default: '',
				description: 'Only invoices created on or before this day',
			},
		],
	},
];

/** The API filters by day (`yyyy-MM-dd`); n8n date fields come in the workflow timezone. */
export function toApiDate(value: unknown): string {
	const text = String(value ?? '').trim();
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
	return match ? match[1] : text;
}

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const companyId = getCompanyId(ctx, itemIndex);
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? Infinity : (ctx.getNodeParameter('limit', itemIndex, 50) as number);
	const filters = ctx.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const qs: IDataObject = { pageCount: PAGE_SIZE };
	for (const [key, value] of Object.entries(filters)) {
		if (value !== '' && value !== undefined && value !== null) qs[key] = toApiDate(value);
	}

	const results: INodeExecutionData[] = [];
	for (let pageIndex = 1; pageIndex <= MAX_PAGES && results.length < limit; pageIndex++) {
		const body = await apiRequestBody<IDataObject>(
			ctx,
			{ method: 'GET', url: invoicesUrl(companyId), qs: { ...qs, pageIndex } },
			{ itemIndex },
		);
		const invoices = (body.serviceInvoices as IDataObject[] | undefined) ?? [];
		for (const invoice of invoices) {
			if (results.length >= limit) break;
			results.push({ json: shapeInvoice(ctx, invoice, itemIndex) });
		}
		if (invoices.length < PAGE_SIZE) break;
	}
	return results;
}
