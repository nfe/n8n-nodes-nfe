import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceSendEmail = {
	operation: ['sendEmail'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceSendEmailDescription: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceSendEmail,
		},
		description: 'The ID of the invoice to send by email',
	},
];
