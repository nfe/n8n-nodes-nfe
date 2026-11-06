import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { fetchInvoice, getInvoiceId, invoiceIdProperty, shapeInvoice } from './common';

export const description: INodeProperties[] = [invoiceIdProperty(['get'])];

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const companyId = getCompanyId(ctx, itemIndex);
	const invoiceId = getInvoiceId(ctx, itemIndex);
	const invoice = await fetchInvoice(ctx, companyId, invoiceId, itemIndex);
	return [{ json: shapeInvoice(ctx, invoice, itemIndex) }];
}
