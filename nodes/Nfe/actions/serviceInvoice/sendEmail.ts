import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { apiRequest } from '../../transport/request';
import { getInvoiceId, INVOICE_NOT_FOUND, invoiceIdProperty, invoiceUrl } from './common';

export const description: INodeProperties[] = [invoiceIdProperty(['sendEmail'])];

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const companyId = getCompanyId(ctx, itemIndex);
	const invoiceId = getInvoiceId(ctx, itemIndex);
	await apiRequest(
		ctx,
		{ method: 'PUT', url: `${invoiceUrl(companyId, invoiceId)}/sendemail` },
		{ itemIndex, hints: { 404: INVOICE_NOT_FOUND } },
	);
	return [{ json: { sent: true, invoiceId } }];
}
