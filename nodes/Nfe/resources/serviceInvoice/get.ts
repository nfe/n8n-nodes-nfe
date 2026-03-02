import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceGet = {
	operation: ['get'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceGetDescription: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceGet,
		},
		description: 'The ID of the service invoice to retrieve',
	},
];
