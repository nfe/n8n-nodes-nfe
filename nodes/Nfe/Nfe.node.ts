import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { serviceInvoiceDescription } from './resources/serviceInvoice';

export class Nfe implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NFe.io',
		name: 'nfe',
		icon: { light: 'file:nfe.svg', dark: 'file:nfe.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the NFe.io API for Brazilian fiscal documents',
		defaults: {
			name: 'NFe.io',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'nfeApi', required: true }],
		requestDefaults: {
			baseURL: 'https://api.nfe.io',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			// Allow error responses through so postReceive can handle them
			ignoreHttpStatusErrors: true,
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Service Invoice',
						value: 'serviceInvoice',
					},
				],
				default: 'serviceInvoice',
			},
			...serviceInvoiceDescription,
		],
	};
}
