import type { INodeProperties } from 'n8n-workflow';

const showOnlyForServiceInvoiceIssue = {
	operation: ['issue'],
	resource: ['serviceInvoice'],
};

export const serviceInvoiceIssueDescription: INodeProperties[] = [
	// ============================================
	// Required Fields
	// ============================================
	{
		displayName: 'City Service Code',
		name: 'cityServiceCode',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		description: 'The service code registered in the municipality',
		routing: {
			send: {
				type: 'body',
				property: 'cityServiceCode',
			},
		},
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		required: true,
		default: '',
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		description: 'Description of the services provided',
		routing: {
			send: {
				type: 'body',
				property: 'description',
			},
		},
	},
	{
		displayName: 'Services Amount',
		name: 'servicesAmount',
		type: 'number',
		typeOptions: {
			numberPrecision: 2,
			minValue: 0.01,
		},
		required: true,
		default: 0,
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		description: 'Total value of the services',
		routing: {
			send: {
				type: 'body',
				property: 'servicesAmount',
			},
		},
	},

	// ============================================
	// Borrower Source Selection
	// ============================================
	{
		displayName: 'Borrower Source',
		name: 'borrowerSource',
		type: 'options',
		default: 'none',
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		options: [
			{
				name: 'None (No Borrower)',
				value: 'none',
			},
			{
				name: 'Define Inline',
				value: 'inline',
			},
			{
				name: 'Enter as JSON',
				value: 'json',
			},
		],
		description: 'How to specify the borrower (tomador) information',
		routing: {
			send: {
				preSend: [
					async function (this, requestOptions) {
						const borrowerSource = this.getNodeParameter('borrowerSource') as string;
						const body = requestOptions.body as Record<string, unknown>;

						if (borrowerSource === 'none') {
							body.borrower = {};
						} else if (borrowerSource === 'inline') {
							// Get borrowerData from the fixedCollection
							const borrowerData = this.getNodeParameter('borrowerData', {}) as {
								borrower?: {
									type?: string;
									name?: string;
									federalTaxNumber?: string;
									email?: string;
									phoneNumber?: string;
								};
								address?: {
									country?: string;
									postalCode?: string;
									street?: string;
									number?: string;
									additionalInformation?: string;
									district?: string;
									cityCode?: string;
									cityName?: string;
									state?: string;
								};
							};

							const borrower: Record<string, unknown> = {};

							// Add borrower basic fields (only non-empty values)
							if (borrowerData.borrower?.type) borrower.type = borrowerData.borrower.type;
							if (borrowerData.borrower?.name) borrower.name = borrowerData.borrower.name;
							if (borrowerData.borrower?.federalTaxNumber) borrower.federalTaxNumber = borrowerData.borrower.federalTaxNumber;
							if (borrowerData.borrower?.email) borrower.email = borrowerData.borrower.email;
							if (borrowerData.borrower?.phoneNumber) borrower.phoneNumber = borrowerData.borrower.phoneNumber;

							// Add address (only if any address field is provided)
							if (borrowerData.address) {
								const address: Record<string, unknown> = {};
								if (borrowerData.address.country) address.country = borrowerData.address.country;
								if (borrowerData.address.postalCode) address.postalCode = borrowerData.address.postalCode;
								if (borrowerData.address.street) address.street = borrowerData.address.street;
								if (borrowerData.address.number) address.number = borrowerData.address.number;
								if (borrowerData.address.additionalInformation) address.additionalInformation = borrowerData.address.additionalInformation;
								if (borrowerData.address.district) address.district = borrowerData.address.district;
								if (borrowerData.address.state) address.state = borrowerData.address.state;

								// City object - API REQUIRES BOTH code AND name when address is provided
								const cityCode = borrowerData.address.cityCode;
								const cityName = borrowerData.address.cityName;
								if (cityCode && cityName) {
									address.city = {
										code: cityCode,
										name: cityName,
									};
								}

								if (Object.keys(address).length > 0) {
									borrower.address = address;
								}
							}

							body.borrower = borrower;
						}
						// For 'json' mode, the borrowerJson field will handle it
						return requestOptions;
					},
				],
			},
		},
	},

	// ============================================
	// Borrower Inline (fixedCollection)
	// ============================================
	{
		displayName: 'Borrower',
		name: 'borrowerData',
		type: 'fixedCollection',
		default: {},
		displayOptions: {
			show: {
				...showOnlyForServiceInvoiceIssue,
				borrowerSource: ['inline'],
			},
		},
		placeholder: 'Add Borrower Details',
		options: [
			{
				name: 'borrower',
				displayName: 'Borrower Details',
				values: [
					{
						displayName: 'Email',
						name: 'email',
						type: 'string',
						default: '',
						placeholder: 'name@email.com',
						description: 'Email address of the borrower',
					},
					{
						displayName: 'Federal Tax Number (CPF/CNPJ)',
						name: 'federalTaxNumber',
						type: 'string',
						default: '',
						placeholder: 'e.g., 12345678000199',
						description: 'CPF (11 digits) or CNPJ (14 digits) without formatting',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Name or company name of the borrower',
					},
					{
						displayName: 'Phone Number',
						name: 'phoneNumber',
						type: 'string',
						default: '',
						description: 'Phone number of the borrower',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'LegalEntity',
						options: [
							{
								name: 'Legal Entity (PJ)',
								value: 'LegalEntity',
							},
							{
								name: 'Natural Person (PF)',
								value: 'NaturalPerson',
							},
						],
						description: 'Type of borrower',
					},
			],
			},
			{
				name: 'address',
				displayName: 'Address',
				values: [
					{
						displayName: 'Country',
						name: 'country',
						type: 'string',
						default: 'BRA',
						description: 'Country code (ISO 3166-1 alpha-3)',
					},
					{
						displayName: 'Postal Code (CEP)',
						name: 'postalCode',
						type: 'string',
						default: '',
						placeholder: '01310-100',
						description: 'Postal code',
					},
					{
						displayName: 'Street',
						name: 'street',
						type: 'string',
						default: '',
						description: 'Street name',
					},
					{
						displayName: 'Number',
						name: 'number',
						type: 'string',
						default: '',
						description: 'Street number or S/N',
					},
					{
						displayName: 'Additional Information',
						name: 'additionalInformation',
						type: 'string',
						default: '',
						description: 'Complement (apartment, suite, etc.)',
					},
					{
						displayName: 'District',
						name: 'district',
						type: 'string',
						default: '',
						description: 'Neighborhood/district name',
					},
					{
						displayName: 'City Code (IBGE)',
						name: 'cityCode',
						type: 'string',
						default: '',
						description: 'IBGE city code (7 digits). Required if City Name is provided.',
					},
					{
						displayName: 'City Name',
						name: 'cityName',
						type: 'string',
						default: '',
						description: 'City name. Required if City Code is provided.',
					},
					{
						displayName: 'State',
						name: 'state',
						type: 'string',
						default: '',
						description: 'State abbreviation (2 letters)',
					},
				],
			},
		],
		// Note: preSend moved to borrowerSource field to ensure it executes
	},

	// ============================================
	// Borrower JSON
	// ============================================
	{
		displayName: 'Borrower (JSON)',
		name: 'borrowerJson',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				...showOnlyForServiceInvoiceIssue,
				borrowerSource: ['json'],
			},
		},
		description: 'Borrower data as JSON object',
		routing: {
			send: {
				type: 'body',
				property: 'borrower',
				value: '={{ JSON.parse($value) }}',
			},
		},
	},

	// ============================================
	// Taxation (fixedCollection)
	// ============================================
	{
		displayName: 'Taxation',
		name: 'taxation',
		type: 'fixedCollection',
		default: {},
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		placeholder: 'Add Taxation Options',
		options: [
			{
				name: 'values',
				displayName: 'Taxation Options',
				values: [
					{
						displayName: 'Conditional Discount',
						name: 'discountConditionedAmount',
						type: 'number',
						default: 0,
						description: 'Conditional discount amount',
					},
					{
						displayName: 'Deductions Amount',
						name: 'deductionsAmount',
						type: 'number',
						default: 0,
						description: 'Value of deductions',
					},
					{
						displayName: 'ISS Rate (%)',
						name: 'issRate',
						type: 'number',
						default: 0,
						description: 'ISS tax rate as decimal (e.g., 0.05 for 5%)',
					},
					{
						displayName: 'ISS Tax Amount',
						name: 'issTaxAmount',
						type: 'number',
						default: 0,
						description: 'Calculated ISS tax amount',
					},
					{
						displayName: 'Taxation Type',
						name: 'taxationType',
						type: 'options',
						default: 'WithinCity',
						options: [
							{
								name: 'Export',
								value: 'Export',
							},
							{
								name: 'Free',
								value: 'Free',
							},
							{
								name: 'Immune',
								value: 'Immune',
							},
							{
								name: 'Outside City',
								value: 'OutsideCity',
							},
							{
								name: 'Suspended (Administrative)',
								value: 'SuspendedAdministrativeProcedure',
							},
							{
								name: 'Suspended (Court Decision)',
								value: 'SuspendedCourtDecision',
							},
							{
								name: 'Within City',
								value: 'WithinCity',
							},
						],
						description: 'Type of taxation for the service',
					},
					{
						displayName: 'Unconditional Discount',
						name: 'discountUnconditionedAmount',
						type: 'number',
						default: 0,
						description: 'Unconditional discount amount',
					},
			],
			},
		],
		routing: {
			send: {
				preSend: [
					async function (this, requestOptions) {
						const taxation = this.getNodeParameter('taxation') as {
							values?: {
								taxationType?: string;
								issRate?: number;
								issTaxAmount?: number;
								deductionsAmount?: number;
								discountUnconditionedAmount?: number;
								discountConditionedAmount?: number;
							};
						};
						if (taxation?.values) {
							const body = requestOptions.body as Record<string, unknown>;
							if (taxation.values.taxationType !== undefined) body.taxationType = taxation.values.taxationType;
							if (taxation.values.issRate !== undefined) body.issRate = taxation.values.issRate;
							if (taxation.values.issTaxAmount !== undefined) body.issTaxAmount = taxation.values.issTaxAmount;
							if (taxation.values.deductionsAmount !== undefined) body.deductionsAmount = taxation.values.deductionsAmount;
							if (taxation.values.discountUnconditionedAmount !== undefined) body.discountUnconditionedAmount = taxation.values.discountUnconditionedAmount;
							if (taxation.values.discountConditionedAmount !== undefined) body.discountConditionedAmount = taxation.values.discountConditionedAmount;
						}
						return requestOptions;
					},
				],
			},
		},
	},

	// ============================================
	// Withholdings (fixedCollection)
	// ============================================
	{
		displayName: 'Withholdings',
		name: 'withholdings',
		type: 'fixedCollection',
		default: {},
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		placeholder: 'Add Withholdings',
		options: [
			{
				name: 'values',
				displayName: 'Withholding Values',
				values: [
					{
						displayName: 'COFINS',
						name: 'cofinsAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld COFINS amount',
					},
					{
						displayName: 'CSLL',
						name: 'csllAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld CSLL amount',
					},
					{
						displayName: 'INSS',
						name: 'inssAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld INSS amount',
					},
					{
						displayName: 'IR (Income Tax)',
						name: 'irAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld income tax amount',
					},
					{
						displayName: 'ISS',
						name: 'issAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld ISS amount',
					},
					{
						displayName: 'Others',
						name: 'othersAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Other withheld amounts',
					},
					{
						displayName: 'PIS',
						name: 'pisAmountWithheld',
						type: 'number',
						default: 0,
						description: 'Withheld PIS amount',
					},
				],
			},
		],
		routing: {
			send: {
				preSend: [
					async function (this, requestOptions) {
						const withholdings = this.getNodeParameter('withholdings') as {
							values?: {
								irAmountWithheld?: number;
								pisAmountWithheld?: number;
								cofinsAmountWithheld?: number;
								csllAmountWithheld?: number;
								inssAmountWithheld?: number;
								issAmountWithheld?: number;
								othersAmountWithheld?: number;
							};
						};
						if (withholdings?.values) {
							const body = requestOptions.body as Record<string, unknown>;
							if (withholdings.values.irAmountWithheld !== undefined) body.irAmountWithheld = withholdings.values.irAmountWithheld;
							if (withholdings.values.pisAmountWithheld !== undefined) body.pisAmountWithheld = withholdings.values.pisAmountWithheld;
							if (withholdings.values.cofinsAmountWithheld !== undefined) body.cofinsAmountWithheld = withholdings.values.cofinsAmountWithheld;
							if (withholdings.values.csllAmountWithheld !== undefined) body.csllAmountWithheld = withholdings.values.csllAmountWithheld;
							if (withholdings.values.inssAmountWithheld !== undefined) body.inssAmountWithheld = withholdings.values.inssAmountWithheld;
							if (withholdings.values.issAmountWithheld !== undefined) body.issAmountWithheld = withholdings.values.issAmountWithheld;
							if (withholdings.values.othersAmountWithheld !== undefined) body.othersAmountWithheld = withholdings.values.othersAmountWithheld;
						}
						return requestOptions;
					},
				],
			},
		},
	},

	// ============================================
	// Advanced Options (fixedCollection)
	// ============================================
	{
		displayName: 'Advanced Options',
		name: 'advancedOptions',
		type: 'fixedCollection',
		default: {},
		displayOptions: {
			show: showOnlyForServiceInvoiceIssue,
		},
		placeholder: 'Add Advanced Options',
		options: [
			{
				name: 'values',
				displayName: 'Advanced Options',
				values: [
					{
						displayName: 'Additional Information',
						name: 'additionalInformation',
						type: 'string',
						default: '',
						description: 'Additional notes or observations',
					},
					{
						displayName: 'CNAE Code',
						name: 'cnaeCode',
						type: 'string',
						default: '',
						description: 'CNAE code (required by some cities)',
					},
					{
						displayName: 'External ID',
						name: 'externalId',
						type: 'string',
						default: '',
						description: 'Your custom identifier for this invoice',
					},
					{
						displayName: 'Federal Service Code',
						name: 'federalServiceCode',
						type: 'string',
						default: '',
						description: 'Federal service code (LC 116 item)',
					},
					{
						displayName: 'Issue Date',
						name: 'issuedOn',
						type: 'dateTime',
						default: '',
						description: 'Date of competência (defaults to current date)',
					},
					{
						displayName: 'NBS Code',
						name: 'nbsCode',
						type: 'string',
						default: '',
						description: 'NBS code (required by some cities)',
					},
					{
						displayName: 'RPS Number',
						name: 'rpsNumber',
						type: 'number',
						default: 0,
						description: 'RPS (Recibo Provisório de Serviço) number',
					},
					{
						displayName: 'RPS Serial Number',
						name: 'rpsSerialNumber',
						type: 'string',
						default: '',
						description: 'RPS serial number identifier',
					},
				],
			},
		],
		routing: {
			send: {
				preSend: [
					async function (this, requestOptions) {
						const advanced = this.getNodeParameter('advancedOptions') as {
							values?: {
								externalId?: string;
								federalServiceCode?: string;
								cnaeCode?: string;
								nbsCode?: string;
								rpsSerialNumber?: string;
								rpsNumber?: number;
								issuedOn?: string;
								additionalInformation?: string;
							};
						};
						if (advanced?.values) {
							const body = requestOptions.body as Record<string, unknown>;
							if (advanced.values.externalId) body.externalId = advanced.values.externalId;
							if (advanced.values.federalServiceCode) body.federalServiceCode = advanced.values.federalServiceCode;
							if (advanced.values.cnaeCode) body.cnaeCode = advanced.values.cnaeCode;
							if (advanced.values.nbsCode) body.nbsCode = advanced.values.nbsCode;
							if (advanced.values.rpsSerialNumber) body.rpsSerialNumber = advanced.values.rpsSerialNumber;
							if (advanced.values.rpsNumber !== undefined && advanced.values.rpsNumber !== 0) body.rpsNumber = advanced.values.rpsNumber;
							if (advanced.values.issuedOn) body.issuedOn = advanced.values.issuedOn;
							if (advanced.values.additionalInformation) body.additionalInformation = advanced.values.additionalInformation;
						}
						return requestOptions;
					},
				],
			},
		},
	},
];
