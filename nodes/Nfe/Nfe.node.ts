import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import * as company from './actions/company';
import * as lookup from './actions/lookup';
import * as serviceInvoice from './actions/serviceInvoice';
import { buildIssueBody } from './actions/serviceInvoice/issue';
import type { OperationHandler } from './actions/types';
import { getCompanies } from './methods/listSearch';
import { getCompanyId } from './shared/company';
import { toNodeError } from './transport/errors';

const ROUTES: Record<string, Record<string, OperationHandler>> = {
	serviceInvoice: serviceInvoice.operations,
	company: company.operations,
	lookup: lookup.operations,
};

export class Nfe implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NFE.io',
		name: 'nfe',
		icon: { light: 'file:nfe.svg', dark: 'file:nfe.dark.svg' },
		group: ['transform'],
		version: 2,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Issue and manage Brazilian service invoices (NFS-e) and look up CNPJ and postal codes with NFE.io',
		defaults: { name: 'NFE.io' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'nfeApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Company', value: 'company' },
					{ name: 'Lookup', value: 'lookup' },
					{ name: 'Service Invoice', value: 'serviceInvoice' },
				],
				default: 'serviceInvoice',
			},
			...serviceInvoice.description,
			...company.description,
			...lookup.description,
		],
	};

	methods = {
		listSearch: { getCompanies },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// n8n runs this class for any saved typeVersion. A node saved by version 0.1 of the package
		// has other parameter names, and running it here would issue invoices without the borrower
		// and the taxes it was configured with. Stop before any request, whatever Continue On Fail.
		const node = this.getNode();
		if (node.typeVersion < 2) {
			throw new NodeOperationError(node, 'This node was created with version 0.1 of n8n-nodes-nfe', {
				description:
					'Version 0.2 changed every field of the NFE.io node, so this node did not run and nothing was sent to NFE.io. Add a new NFE.io node, fill in its fields and remove this one. See "Migrating from 0.1" in the package README.',
			});
		}

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Without "Continue On Fail" an invalid item stops the node. Check every issue item before
		// the first POST, so a bad item 3 does not leave items 1 and 2 issued with their output lost.
		if (!this.continueOnFail()) {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				if (resource === 'serviceInvoice' && operation === 'issue') {
					getCompanyId(this, itemIndex);
					buildIssueBody(this, itemIndex);
				}
			}
		}

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const handler = ROUTES[resource]?.[operation];
				if (!handler) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported`,
						{
							itemIndex,
						},
					);
				}
				const results = await handler(this, itemIndex);
				for (const result of results) {
					returnData.push({ ...result, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const nodeError = toNodeError(this.getNode(), error, itemIndex);
					returnData.push({
						json: { error: nodeError.message, description: nodeError.description ?? null },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw toNodeError(this.getNode(), error, itemIndex);
			}
		}

		return [returnData];
	}
}
