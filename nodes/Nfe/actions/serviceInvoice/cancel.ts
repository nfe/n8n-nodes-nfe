import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { CANCEL_TERMINAL, clampWaitSeconds, waitForFlowStatus } from '../../shared/poll';
import { apiRequest } from '../../transport/request';
import {
	fetchInvoice,
	getInvoiceId,
	INVOICE_NOT_FOUND,
	invoiceIdProperty,
	invoiceUrl,
	shapeInvoice,
	waitProperties,
} from './common';

export const description: INodeProperties[] = [
	invoiceIdProperty(['cancel']),
	...waitProperties(
		'cancel',
		'waitForCancellation',
		'Wait for Cancellation',
		'Whether to wait until the city confirms or rejects the cancellation before returning the invoice',
	),
];

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = ctx.getNode();
	const companyId = getCompanyId(ctx, itemIndex);
	const invoiceId = getInvoiceId(ctx, itemIndex);

	const response = await apiRequest(
		ctx,
		{ method: 'DELETE', url: invoiceUrl(companyId, invoiceId) },
		{ itemIndex, hints: { 404: INVOICE_NOT_FOUND } },
	);
	let invoice =
		response.body && typeof response.body === 'object' && (response.body as IDataObject).id
			? (response.body as IDataObject)
			: await fetchInvoice(ctx, companyId, invoiceId, itemIndex);

	const output: IDataObject = {};
	if (ctx.getNodeParameter('waitForCancellation', itemIndex, true)) {
		const timeout = clampWaitSeconds(ctx.getNodeParameter('waitTimeout', itemIndex, 60));
		const waited = await waitForFlowStatus(
			invoice,
			async () => await fetchInvoice(ctx, companyId, invoiceId, itemIndex),
			CANCEL_TERMINAL,
			timeout,
		);
		invoice = waited.invoice;
		output.waitTimedOut = waited.timedOut;
		if (invoice.flowStatus === 'CancelFailed') {
			throw new NodeOperationError(node, 'The city did not cancel the invoice', {
				description: [
					invoice.flowMessage
						? `Reason: ${String(invoice.flowMessage)}`
						: 'NFE.io did not send a reason.',
					`Invoice ID: ${invoiceId}`,
					'Check the cancellation rules of the city and the invoice status in NFE.io.',
				].join('\n'),
				itemIndex,
			});
		}
	}

	return [{ json: { ...shapeInvoice(ctx, invoice, itemIndex), ...output } }];
}
