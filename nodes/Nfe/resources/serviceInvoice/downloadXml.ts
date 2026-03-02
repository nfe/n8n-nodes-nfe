import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceDownloadXml = {
	operation: ['downloadXml'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceDownloadXmlDescription: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceDownloadXml,
		},
		description: 'The ID of the invoice to download XML',
	},
];
