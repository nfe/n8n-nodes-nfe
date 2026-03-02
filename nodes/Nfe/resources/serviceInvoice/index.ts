import type { INodeProperties } from 'n8n-workflow';
import { serviceInvoiceGetAllDescription } from './getAll';
import { serviceInvoiceGetDescription } from './get';
import { serviceInvoiceIssueDescription } from './issue';
import { serviceInvoiceCancelDescription } from './cancel';
import { serviceInvoiceGetByExternalIdDescription } from './getByExternalId';
import { serviceInvoiceDownloadPdfDescription } from './downloadPdf';
import { serviceInvoiceDownloadXmlDescription } from './downloadXml';
import { serviceInvoiceSendEmailDescription } from './sendEmail';
import { handleNfeApiError } from '../../utils/errorParser';

/**
 * Display options to show fields only for ServiceInvoice resource
 */
export const showOnlyForServiceInvoice = {
	resource: ['serviceInvoice'],
};

/**
 * ServiceInvoice resource description with all operations
 */
export const serviceInvoiceDescription: INodeProperties[] = [
	// Company ID
	{
		displayName: 'Company ID',
		name: 'companyId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g., 507f1f77bcf86cd799439011',
		description: 'The ID of the company',
		displayOptions: {
			show: showOnlyForServiceInvoice,
		},
	},
	// Operation selector
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForServiceInvoice,
		},
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				action: 'Cancel a service invoice',
				description: 'Cancel an issued service invoice',
				routing: {
					request: {
						method: 'DELETE',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/{{$parameter.invoiceId}}',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				action: 'Download invoice PDF',
				description: 'Download the PDF of a service invoice',
				routing: {
					request: {
						method: 'GET',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/{{$parameter.invoiceId}}/pdf',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Download XML',
				value: 'downloadXml',
				action: 'Download invoice XML',
				description: 'Download the XML of a service invoice',
				routing: {
					request: {
						method: 'GET',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/{{$parameter.invoiceId}}/xml',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a service invoice',
				description: 'Get details of a specific service invoice',
				routing: {
					request: {
						method: 'GET',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/{{$parameter.invoiceId}}',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Get by External ID',
				value: 'getByExternalId',
				action: 'Get invoice by external ID',
				description: 'Get a service invoice by your custom external ID',
				routing: {
					request: {
						method: 'GET',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/externalId/{{$parameter.externalId}}',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'List service invoices',
				description: 'List many service invoices from a company',
				routing: {
					request: {
						method: 'GET',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Issue',
				value: 'issue',
				action: 'Issue a service invoice',
				description: 'Issue a new service invoice (NFS-e)',
				routing: {
					request: {
						method: 'POST',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
			{
				name: 'Send Email',
				value: 'sendEmail',
				action: 'Send invoice by email',
				description: 'Send the invoice to the borrower by email',
				routing: {
					request: {
						method: 'PUT',
						url: '=/v1/companies/{{$parameter.companyId}}/serviceinvoices/{{$parameter.invoiceId}}/sendemail',
					},
					output: {
						postReceive: [handleNfeApiError],
					},
				},
			},
		],
		default: 'getAll',
	},
	// getAll operation fields
	...serviceInvoiceGetAllDescription,
	// get operation fields
	...serviceInvoiceGetDescription,
	// issue operation fields
	...serviceInvoiceIssueDescription,
	// cancel operation fields
	...serviceInvoiceCancelDescription,
	// getByExternalId operation fields
	...serviceInvoiceGetByExternalIdDescription,
	// downloadPdf operation fields
	...serviceInvoiceDownloadPdfDescription,
	// downloadXml operation fields
	...serviceInvoiceDownloadXmlDescription,
	// sendEmail operation fields
	...serviceInvoiceSendEmailDescription,
];
