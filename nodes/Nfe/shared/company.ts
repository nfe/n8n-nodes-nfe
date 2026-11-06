import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { assertId } from './validators';

export function companyLocator(
	show: Record<string, string[]> | undefined,
	options: { required: boolean; description: string },
): INodeProperties {
	const property: INodeProperties = {
		displayName: 'Company',
		name: 'companyId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: options.required,
		description: options.description,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'getCompanies', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 5f8a1c2b3d4e5f6a7b8c9d0e',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9_-]{1,64}$',
							errorMessage: 'Use the company ID shown by NFE.io (letters, digits, - and _)',
						},
					},
				],
			},
		],
	};
	if (show) property.displayOptions = { show };
	return property;
}

export function getCompanyId(ctx: IExecuteFunctions, itemIndex: number): string {
	const value = ctx.getNodeParameter('companyId', itemIndex, '', { extractValue: true });
	return assertId(ctx.getNode(), value, 'Company ID', itemIndex);
}
