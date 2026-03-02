import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceGetByExternalId = {
	operation: ['getByExternalId'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceGetByExternalIdDescription: INodeProperties[] = [
	{
		displayName: 'External ID',
		name: 'externalId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceGetByExternalId,
		},
		description: 'Your custom identifier for the invoice',
	},
];
