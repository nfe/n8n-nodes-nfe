import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceGetAll = {
	operation: ['getAll'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceGetAllDescription: INodeProperties[] = [
	// Pagination - Return All toggle
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: {
			show: showOnlyForServiceInvoiceGetAll,
		},
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	// Pagination - Limit
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: {
			show: {
				...showOnlyForServiceInvoiceGetAll,
				returnAll: [false],
			},
		},
		typeOptions: {
			minValue: 1,
			maxValue: 100,
		},
		default: 50,
		description: 'Max number of results to return',
		routing: {
			send: {
				type: 'query',
				property: 'pageCount',
			},
			output: {
				maxResults: '={{$value}}',
			},
		},
	},
	// Filters collection
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: showOnlyForServiceInvoiceGetAll,
		},
		options: [
			{
				displayName: 'Created Date End',
				name: 'createdEnd',
				type: 'dateTime',
				default: '',
				description: 'Filter invoices created until this date',
				routing: {
					send: {
						type: 'query',
						property: 'createdEnd',
						value: '={{ $value ? new Date($value).toISOString().split("T")[0] : undefined }}',
					},
				},
			},
			{
				displayName: 'Created Date Start',
				name: 'createdBegin',
				type: 'dateTime',
				default: '',
				description: 'Filter invoices created from this date',
				routing: {
					send: {
						type: 'query',
						property: 'createdBegin',
						value: '={{ $value ? new Date($value).toISOString().split("T")[0] : undefined }}',
					},
				},
			},
			{
				displayName: 'Include Totals',
				name: 'hasTotals',
				type: 'boolean',
				default: false,
				description: 'Whether to include totals in the response',
				routing: {
					send: {
						type: 'query',
						property: 'hasTotals',
					},
				},
			},
			{
				displayName: 'Issued Date End',
				name: 'issuedEnd',
				type: 'dateTime',
				default: '',
				description: 'Filter invoices issued until this date (competência)',
				routing: {
					send: {
						type: 'query',
						property: 'issuedEnd',
						value: '={{ $value ? new Date($value).toISOString().split("T")[0] : undefined }}',
					},
				},
			},
			{
				displayName: 'Issued Date Start',
				name: 'issuedBegin',
				type: 'dateTime',
				default: '',
				description: 'Filter invoices issued from this date (competência)',
				routing: {
					send: {
						type: 'query',
						property: 'issuedBegin',
						value: '={{ $value ? new Date($value).toISOString().split("T")[0] : undefined }}',
					},
				},
			},
		],
	},
];
