import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { getCompanyId } from '../../shared/company';
import { downloadDocument } from '../../transport/download';
import { getInvoiceId, INVOICE_NOT_FOUND, invoiceIdProperty, invoiceUrl, RESOURCE } from './common';

type DocumentKind = 'pdf' | 'xml' | 'cancellationXml';

const DOCUMENTS: Record<DocumentKind, { path: string; extension: string; mimeType: string }> = {
	pdf: { path: 'pdf', extension: 'pdf', mimeType: 'application/pdf' },
	xml: { path: 'xml', extension: 'xml', mimeType: 'application/xml' },
	cancellationXml: { path: 'cancellation-xml', extension: 'xml', mimeType: 'application/xml' },
};

const OPERATIONS: Record<string, DocumentKind> = {
	downloadPdf: 'pdf',
	downloadXml: 'xml',
	downloadCancellationXml: 'cancellationXml',
};

const operations = Object.keys(OPERATIONS);

export const description: INodeProperties[] = [
	invoiceIdProperty(operations),
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: { resource: [RESOURCE], operation: operations } },
	},
];

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const operation = ctx.getNodeParameter('operation', itemIndex) as string;
	const kind = OPERATIONS[operation];
	const document = DOCUMENTS[kind];
	const companyId = getCompanyId(ctx, itemIndex);
	const invoiceId = getInvoiceId(ctx, itemIndex);
	const binaryPropertyName =
		String(ctx.getNodeParameter('binaryPropertyName', itemIndex, 'data')).trim() || 'data';

	const notFound =
		kind === 'cancellationXml'
			? {
					message: 'The cancellation XML is not available for this invoice',
					hint: 'This XML only exists for invoices cancelled in the national environment (Ambiente Nacional). Cities with their own system do not provide it.',
				}
			: kind === 'pdf'
				? {
						message: 'The PDF is not available yet',
						hint: 'NFE.io renders the PDF a few seconds after authorization. Check that the invoice is issued and try again.',
					}
				: INVOICE_NOT_FOUND;

	const file = await downloadDocument(ctx, `${invoiceUrl(companyId, invoiceId)}/${document.path}`, {
		itemIndex,
		notFoundRetries: kind === 'pdf' ? 3 : 0,
		hints: { 404: notFound },
	});

	const fileName =
		file.fileName ??
		(kind === 'cancellationXml'
			? `nfse-${invoiceId}-cancellation.xml`
			: `nfse-${invoiceId}.${document.extension}`);
	const mimeType = file.contentType?.split(';')[0].trim() || document.mimeType;
	const binary = await ctx.helpers.prepareBinaryData(file.data, fileName, mimeType);

	return [
		{
			json: { invoiceId, fileName, mimeType, fileSize: file.data.length },
			binary: { [binaryPropertyName]: binary },
		},
	];
}
