import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceDownloadPdf = {
	operation: ['downloadPdf'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceDownloadPdfDescription: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceDownloadPdf,
		},
		description: 'The ID of the invoice to download PDF',
	},
];
