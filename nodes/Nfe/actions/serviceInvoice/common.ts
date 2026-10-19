import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { NFSE_V3_BASE } from '../../shared/constants';
import { shapeOutput, simplifyInvoice, type OutputMode } from '../../shared/output';
import { MAX_WAIT_SECONDS } from '../../shared/poll';
import { assertId } from '../../shared/validators';
import { apiRequestBody } from '../../transport/request';

export const RESOURCE = 'serviceInvoice';

export const INVOICE_NOT_FOUND = {
	message: 'The service invoice was not found in this company',
	hint: 'Check the Invoice ID and the selected company.',
};

export function invoicesUrl(companyId: string): string {
	return `${NFSE_V3_BASE}/companies/${companyId}/serviceinvoices`;
}

export function invoiceUrl(companyId: string, invoiceId: string): string {
	return `${invoicesUrl(companyId)}/${invoiceId}`;
}

export function getInvoiceId(ctx: IExecuteFunctions, itemIndex: number): string {
	return assertId(
		ctx.getNode(),
		ctx.getNodeParameter('invoiceId', itemIndex),
		'Invoice ID',
		itemIndex,
	);
}

export function invoiceIdProperty(operation: string[]): INodeProperties {
	return {
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0123456789abcdef01234567',
		description: 'ID of the service invoice in NFE.io',
		displayOptions: { show: { resource: [RESOURCE], operation } },
	};
}

export async function fetchInvoice(
	ctx: IExecuteFunctions,
	companyId: string,
	invoiceId: string,
	itemIndex: number,
): Promise<IDataObject> {
	return await apiRequestBody(
		ctx,
		{ method: 'GET', url: invoiceUrl(companyId, invoiceId) },
		{ itemIndex, hints: { 404: INVOICE_NOT_FOUND } },
	);
}

export function shapeInvoice(
	ctx: IExecuteFunctions,
	invoice: IDataObject,
	itemIndex: number,
): IDataObject {
	const mode = ctx.getNodeParameter('output', itemIndex, 'simplified') as OutputMode;
	const fields =
		mode === 'selected' ? (ctx.getNodeParameter('fields', itemIndex, '') as string) : '';
	return shapeOutput(invoice, mode, fields, simplifyInvoice);
}

/** "Wait for ..." toggle plus timeout, shared by Issue and Cancel. */
export function waitProperties(
	operation: string,
	name: string,
	displayName: string,
	description: string,
): INodeProperties[] {
	return [
		{
			displayName,
			name,
			type: 'boolean',
			default: true,
			description,
			displayOptions: { show: { resource: [RESOURCE], operation: [operation] } },
		},
		{
			displayName: 'Timeout (Seconds)',
			name: 'waitTimeout',
			type: 'number',
			default: 60,
			typeOptions: { minValue: 1, maxValue: MAX_WAIT_SECONDS },
			description:
				'How long to wait before returning the invoice as it is (with waitTimedOut set to true)',
			displayOptions: { show: { resource: [RESOURCE], operation: [operation], [name]: [true] } },
		},
	];
}
