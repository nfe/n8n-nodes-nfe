import type { INodeProperties } from 'n8n-workflow';

import { companyLocator } from '../../shared/company';
import { outputProperties } from '../../shared/output';
import type { OperationHandler } from '../types';
import * as cancel from './cancel';
import { RESOURCE } from './common';
import * as download from './download';
import * as get from './get';
import * as getAll from './getAll';
import * as getByExternalId from './getByExternalId';
import * as issue from './issue';
import * as sendEmail from './sendEmail';

const invoiceOutputOperations = ['issue', 'get', 'getAll', 'getByExternalId', 'cancel'];

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				description: 'Request the cancellation of an issued service invoice',
				action: 'Cancel a service invoice',
			},
			{
				name: 'Download Cancellation XML',
				value: 'downloadCancellationXml',
				description: 'Download the XML of the cancellation event (national environment only)',
				action: 'Download the cancellation XML of a service invoice',
			},
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				description: 'Download the PDF of a service invoice as a file',
				action: 'Download the PDF of a service invoice',
			},
			{
				name: 'Download XML',
				value: 'downloadXml',
				description: 'Download the XML of a service invoice as a file',
				action: 'Download the XML of a service invoice',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a service invoice by its NFE.io ID',
				action: 'Get a service invoice',
			},
			{
				name: 'Get by External ID',
				value: 'getByExternalId',
				description: 'Find service invoices by the External ID sent at issue time',
				action: 'Get service invoices by external ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the service invoices of a company',
				action: 'Get many service invoices',
			},
			{
				name: 'Issue',
				value: 'issue',
				description:
					'Issue a service invoice (NFS-e). Each run sends a real fiscal document to the city.',
				action: 'Issue a service invoice',
			},
			{
				name: 'Send Email',
				value: 'sendEmail',
				description: 'Send the invoice by email to the borrower',
				action: 'Send a service invoice by email',
			},
		],
		default: 'issue',
	},
	companyLocator(
		{ resource: [RESOURCE] },
		{ required: true, description: 'Company (provider) that issues the service invoice' },
	),
	...issue.description,
	...get.description,
	...getAll.description,
	...getByExternalId.description,
	...cancel.description,
	...download.description,
	...sendEmail.description,
	...outputProperties(
		{ resource: [RESOURCE], operation: invoiceOutputOperations },
		'Return the 10 main fields of the invoice',
	),
];

export const operations: Record<string, OperationHandler> = {
	issue: issue.execute,
	get: get.execute,
	getAll: getAll.execute,
	getByExternalId: getByExternalId.execute,
	cancel: cancel.execute,
	downloadPdf: download.execute,
	downloadXml: download.execute,
	downloadCancellationXml: download.execute,
	sendEmail: sendEmail.execute,
};
