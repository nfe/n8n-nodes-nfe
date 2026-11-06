import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { encodeExternalId } from '../../shared/validators';
import { apiRequestBody } from '../../transport/request';
import { invoicesUrl, RESOURCE, shapeInvoice } from './common';

const show = { resource: [RESOURCE], operation: ['getByExternalId'] };

export const description: INodeProperties[] = [
	{
		displayName: 'External ID',
		name: 'externalId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. order-1234',
		description: 'External ID sent when the invoice was issued',
		displayOptions: { show },
	},
	{
		displayName: 'Fail If Not Found',
		name: 'failIfNotFound',
		type: 'boolean',
		default: false,
		description:
			'Whether to stop with a message when no invoice has this External ID, instead of returning no items',
		displayOptions: { show },
	},
];

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const companyId = getCompanyId(ctx, itemIndex);
	const externalId = String(ctx.getNodeParameter('externalId', itemIndex));
	const encoded = encodeExternalId(ctx.getNode(), externalId, itemIndex);
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{ method: 'GET', url: `${invoicesUrl(companyId)}/external/${encoded}` },
		{ itemIndex },
	);
	const invoices = (body.serviceInvoices as IDataObject[] | undefined) ?? [];
	if (invoices.length === 0 && ctx.getNodeParameter('failIfNotFound', itemIndex, false)) {
		throw new NodeOperationError(ctx.getNode(), 'No invoice has this External ID', {
			description: `External ID: ${externalId.trim()}\nCheck the External ID and the selected company. A new invoice takes a few seconds to be found.`,
			itemIndex,
		});
	}
	return invoices.map((invoice) => ({ json: shapeInvoice(ctx, invoice, itemIndex) }));
}
