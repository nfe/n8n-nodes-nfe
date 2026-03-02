import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceCancel = {
	operation: ['cancel'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceCancelDescription: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceCancel,
		},
		description: 'The ID of the invoice to cancel',
	},
];
