import { createHash, randomUUID } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { TAX_REFORM_TABLES_URL } from '../../shared/constants';
import {
	CANCEL_TERMINAL,
	clampWaitSeconds,
	ISSUE_TERMINAL,
	waitForFlowStatus,
} from '../../shared/poll';
import {
	encodeExternalId,
	normalizeBorrowerTaxNumber,
	normalizeFederalServiceCode,
	normalizeNbsCode,
	normalizePostalCode,
	normalizeSixDigits,
	normalizeState,
	normalizeTaxNumber,
	parseJsonObject,
} from '../../shared/validators';
import { buildApiError, normalizeApiMessage } from '../../transport/errors';
import {
	apiRequestBody,
	ISSUE_TIMEOUT_MS,
	rawRequest,
	type NfeResponse,
} from '../../transport/request';
import { fetchInvoice, invoicesUrl, RESOURCE, shapeInvoice, waitProperties } from './common';
import { getCompanyId } from '../../shared/company';

const show = { resource: [RESOURCE], operation: ['issue'] };

/** Reconciliation after an uncertain POST: GET external/{id} every 2 s for up to 30 s. */
export const RECONCILE_ATTEMPTS = 15;
export const RECONCILE_INTERVAL_MS = 2000;
/** Lookups after "already exists" (the index may still be catching up). */
export const EXISTING_ATTEMPTS = 5;

export const description: INodeProperties[] = [
	{
		displayName: 'City Service Code',
		name: 'cityServiceCode',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 10677',
		description: 'Service code of the city where the company is registered',
		displayOptions: { show },
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		description: 'Description of the services, printed on the invoice',
		displayOptions: { show },
	},
	{
		displayName: 'Services Amount',
		name: 'servicesAmount',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { minValue: 0, numberPrecision: 2 },
		description: 'Total amount of the services, in BRL',
		displayOptions: { show },
	},
	{
		displayName: 'Borrower Input',
		name: 'borrowerInput',
		type: 'options',
		default: 'fields',
		description: 'How to enter the borrower (the customer who receives the invoice)',
		displayOptions: { show },
		options: [
			{ name: 'Fields', value: 'fields', description: 'Fill in the borrower fields' },
			{ name: 'JSON', value: 'json', description: 'Send the borrower object of the API as JSON' },
			{ name: 'None', value: 'none', description: 'Issue the invoice without a borrower' },
		],
	},
	{
		displayName: 'Borrower Name',
		name: 'borrowerName',
		type: 'string',
		default: '',
		placeholder: 'e.g. ACME Ltda',
		description: 'Legal name of the company or full name of the person',
		displayOptions: { show: { ...show, borrowerInput: ['fields'] } },
	},
	{
		displayName: 'Borrower Federal Tax Number',
		name: 'borrowerFederalTaxNumber',
		type: 'string',
		default: '',
		placeholder: 'e.g. 00.623.904/0001-73',
		description:
			'CPF or CNPJ (numeric or alphanumeric). Punctuation is removed and leading zeros are kept.',
		displayOptions: { show: { ...show, borrowerInput: ['fields'] } },
	},
	{
		displayName: 'Borrower Type',
		name: 'borrowerType',
		type: 'options',
		default: 'auto',
		description: 'Type of the borrower',
		displayOptions: { show: { ...show, borrowerInput: ['fields'] } },
		options: [
			{
				name: 'Detect From Tax Number',
				value: 'auto',
				description: 'CPF means natural person, CNPJ means legal entity',
			},
			{ name: 'Legal Entity', value: 'LegalEntity' },
			{ name: 'Natural Person', value: 'NaturalPerson' },
		],
	},
	{
		displayName: 'Borrower Details',
		name: 'borrowerDetails',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, borrowerInput: ['fields'] } },
		options: [
			{
				displayName: 'City Code (IBGE)',
				name: 'cityCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 4106902',
				description:
					'Seven-digit IBGE code of the city. Use the Lookup resource to find it by postal code.',
			},
			{
				displayName: 'City Name',
				name: 'cityName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Curitiba',
			},
			{
				displayName: 'Complement',
				name: 'additionalInformation',
				type: 'string',
				default: '',
				placeholder: 'e.g. Room 12',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: 'BRA',
				description: 'Three-letter country code (ISO 3166-1 alpha-3)',
			},
			{
				displayName: 'District',
				name: 'district',
				type: 'string',
				default: '',
				placeholder: 'e.g. Centro',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Email address that receives the invoice',
			},
			{
				displayName: 'Municipal Tax Number',
				name: 'municipalTaxNumber',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Number',
				name: 'number',
				type: 'string',
				default: '',
				placeholder: 'e.g. 100',
			},
			{
				displayName: 'Phone',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				placeholder: 'e.g. 4133334444',
			},
			{
				displayName: 'Postal Code',
				name: 'postalCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 80010-000',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'string',
				default: '',
				placeholder: 'e.g. PR',
			},
			{
				displayName: 'State Tax Number',
				name: 'stateTaxNumber',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Street',
				name: 'street',
				type: 'string',
				default: '',
				placeholder: 'e.g. Rua XV de Novembro',
			},
		],
	},
	{
		displayName: 'Borrower (JSON)',
		name: 'borrowerJson',
		type: 'json',
		default:
			'{\n  "type": "LegalEntity",\n  "name": "",\n  "federalTaxNumber": "",\n  "email": ""\n}',
		description: 'Borrower object of the NFE.io API (V3)',
		displayOptions: { show: { ...show, borrowerInput: ['json'] } },
	},
	{
		displayName:
			'Without an External ID, the node creates one that only protects retries inside the same execution. To run an invoice again safely, including Retry of a failed execution, add External ID with an ID from your own system, e.g. the order number.',
		name: 'externalIdNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Accrual Date',
				name: 'accrualOn',
				type: 'dateTime',
				default: '',
				description: 'Date the service was provided (competência). Defaults to the issue date.',
			},
			{
				displayName: 'Additional Information',
				name: 'additionalInformation',
				type: 'string',
				default: '',
				typeOptions: { rows: 2 },
			},
			{
				displayName: 'CNAE Code',
				name: 'cnaeCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 6201501',
				description: 'Only when the city requires it',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1234',
				description:
					'Your unique ID for this invoice, e.g. the order number. Issuing again with the same ID returns the existing invoice instead of a new one. When empty, the node creates an ID that only covers retries inside the same execution.',
			},
			{
				displayName: 'Federal Service Code',
				name: 'federalServiceCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 01.07',
				description: 'Service item of the LC 116 list, in the NN.NN format',
			},
			{
				displayName: 'Intermediary (JSON)',
				name: 'intermediary',
				type: 'json',
				default: '{}',
				description: 'Intermediary object of the NFE.io API, same structure as the borrower',
			},
			{
				displayName: 'Issued On',
				name: 'issuedOn',
				type: 'dateTime',
				default: '',
				description: 'Issue date of the invoice. Defaults to now.',
			},
			{
				displayName: 'Location (JSON)',
				name: 'location',
				type: 'json',
				default: '{}',
				description: 'Where the service was provided, when different from the company address',
			},
			{
				displayName: 'NBS Code',
				name: 'nbsCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1.1502.10.00',
				description: 'Nine-digit NBS code. Dots are removed.',
			},
			{
				displayName: 'Paid Amount',
				name: 'paidAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'RPS Number',
				name: 'rpsNumber',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
			},
			{
				displayName: 'RPS Serial Number',
				name: 'rpsSerialNumber',
				type: 'string',
				default: '',
			},
		],
	},
	{
		displayName:
			'Tax fields are optional. Leave them out and NFE.io calculates ISS, rates and withholdings from the company settings. A value you add replaces the automatic calculation.',
		name: 'taxNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'ISS',
		name: 'issTaxes',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Conditioned Discount',
				name: 'discountConditionedAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'Deductions Amount',
				name: 'deductionsAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'Immunity Type',
				name: 'immunityType',
				type: 'options',
				default: 'Unspecified',
				description: 'Only when Taxation Type is Immune',
				options: [
					{ name: 'Books, Press and Paper', value: 'BooksPressPaper' },
					{ name: 'Brazilian Music Phonograms', value: 'BrazilianMusicPhonograms' },
					{
						name: 'Parties, Unions, Education and Nonprofit',
						value: 'PartiesUnionsEducationSocialNonprofit',
					},
					{ name: 'Public Entities', value: 'PublicEntitiesMutual' },
					{ name: 'Temples', value: 'Temples' },
					{ name: 'Unspecified', value: 'Unspecified' },
				],
			},
			{
				displayName: 'ISS Rate',
				name: 'issRate',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 4 },
				description: 'ISS rate as a fraction, e.g. 0.02 for 2%',
			},
			{
				displayName: 'ISS Tax Amount',
				name: 'issTaxAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'Retention Type',
				name: 'retentionType',
				type: 'options',
				default: 'NotWithheld',
				description: 'Who pays the ISS',
				options: [
					{ name: 'Not Withheld', value: 'NotWithheld' },
					{ name: 'Withheld by Buyer', value: 'WithheldByBuyer' },
					{ name: 'Withheld by Intermediary', value: 'WithheldByIntermediary' },
				],
			},
			{
				displayName: 'Taxation Type',
				name: 'taxationType',
				type: 'options',
				default: 'WithinCity',
				options: [
					{ name: 'Export', value: 'Export' },
					{ name: 'Free', value: 'Free' },
					{ name: 'Immune', value: 'Immune' },
					{ name: 'None', value: 'None' },
					{ name: 'Objective Immunity', value: 'ObjectiveImune' },
					{ name: 'Outside City', value: 'OutsideCity' },
					{ name: 'Outside City, Free', value: 'OutsideCityFree' },
					{ name: 'Outside City, Immune', value: 'OutsideCityImmune' },
					{ name: 'Outside City, Suspended', value: 'OutsideCitySuspended' },
					{
						name: 'Outside City, Suspended by Administrative Procedure',
						value: 'OutsideCitySuspendedAdministrativeProcedure',
					},
					{
						name: 'Suspended by Administrative Procedure',
						value: 'SuspendedAdministrativeProcedure',
					},
					{ name: 'Suspended by Court Decision', value: 'SuspendedCourtDecision' },
					{ name: 'Within City', value: 'WithinCity' },
				],
			},
			{
				displayName: 'Unconditioned Discount',
				name: 'discountUnconditionedAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
		],
	},
	{
		displayName:
			'Withheld PIS and COFINS go in this group. The PIS and COFINS fields of the API without "withheld" are the company\'s own tax, not a withholding.',
		name: 'withholdingNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'Federal Withholdings',
		name: 'federalWithholdings',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'COFINS Withheld',
				name: 'cofinsAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'CSLL Withheld',
				name: 'csllAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'INSS Withheld',
				name: 'inssAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'IR Withheld',
				name: 'irAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'ISS Withheld',
				name: 'issAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'Others Withheld',
				name: 'othersAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
			{
				displayName: 'PIS Withheld',
				name: 'pisAmountWithheld',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
			},
		],
	},
	{
		displayName: `Tax reform (IBS/CBS): add Operation Indicator and Classification Code to send the group. NFE.io calculates IBS and CBS. The operation indicator defines which address the invoice needs, see the <a href="${TAX_REFORM_TABLES_URL}" target="_blank">indicator tables</a>.`,
		name: 'taxReformNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'Tax Reform (IBS/CBS)',
		name: 'taxReform',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Classification Code',
				name: 'classCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 000001',
				description: 'Six-digit IBS/CBS tax classification code (cClassTrib)',
			},
			{
				displayName: 'Destination Indicator',
				name: 'destinationIndicator',
				type: 'options',
				default: 'SameAsBuyer',
				options: [
					{
						name: 'Different From Buyer',
						value: 'DifferentFromBuyer',
						description: 'Needs the Recipient (JSON) field',
					},
					{ name: 'Same as Buyer', value: 'SameAsBuyer' },
				],
			},
			{
				displayName: 'Operation Indicator',
				name: 'operationIndicator',
				type: 'string',
				default: '',
				placeholder: 'e.g. 100301',
				description: 'Six-digit operation indicator (cIndOp) that defines where IBS/CBS is due',
			},
			{
				displayName: 'Overrides (JSON)',
				name: 'overrides',
				type: 'json',
				default: '{}',
				description:
					'Other fields of the ibsCbs group, merged as sent (for example ibs and cbs to replace the calculation)',
			},
			{
				displayName: 'Recipient (JSON)',
				name: 'recipient',
				type: 'json',
				default: '{}',
				description: 'Final recipient of the service, when different from the borrower',
			},
			{
				displayName: 'Situation Code',
				name: 'situationCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 000',
				description: 'IBS/CBS tax situation code. Derived from the classification code when empty.',
			},
		],
	},
	...waitProperties(
		'issue',
		'waitForAuthorization',
		'Wait for Authorization',
		'Whether to wait until the city authorizes or rejects the invoice before returning it',
	),
];

function hasValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === 'string') return value.trim() !== '';
	return true;
}

function datePart(value: unknown): string {
	const text = String(value);
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
	return match ? match[1] : text;
}

function jsonField(ctx: IExecuteFunctions, value: unknown, label: string, itemIndex: number) {
	const parsed = parseJsonObject(ctx.getNode(), value, label, itemIndex);
	return Object.keys(parsed).length > 0 ? (parsed as IDataObject) : undefined;
}

/** Drops empty strings (for example the untouched fields of the JSON template). */
function withoutEmpty(value: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string' && entry.trim() === '') continue;
		if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const nested = withoutEmpty(entry as IDataObject);
			if (Object.keys(nested).length > 0) result[key] = nested;
			continue;
		}
		result[key] = entry;
	}
	return result;
}

function normalizeParty(input: IDataObject): IDataObject | undefined {
	const party = withoutEmpty(input);
	if (hasValue(party.federalTaxNumber)) {
		party.federalTaxNumber = normalizeTaxNumber(party.federalTaxNumber);
	}
	return Object.keys(party).length > 0 ? party : undefined;
}

function buildBorrower(ctx: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const node = ctx.getNode();
	const input = ctx.getNodeParameter('borrowerInput', itemIndex, 'none') as string;
	if (input === 'none') return undefined;
	if (input === 'json') {
		const borrower = jsonField(
			ctx,
			ctx.getNodeParameter('borrowerJson', itemIndex, '{}'),
			'Borrower (JSON)',
			itemIndex,
		);
		return borrower ? normalizeParty(borrower) : undefined;
	}

	const borrower: IDataObject = {};
	const name = String(ctx.getNodeParameter('borrowerName', itemIndex, '')).trim();
	const taxNumberInput = ctx.getNodeParameter('borrowerFederalTaxNumber', itemIndex, '');
	const type = ctx.getNodeParameter('borrowerType', itemIndex, 'auto') as string;
	const details = ctx.getNodeParameter('borrowerDetails', itemIndex, {}) as IDataObject;

	if (name) borrower.name = name;
	if (hasValue(taxNumberInput)) {
		const taxNumber = normalizeBorrowerTaxNumber(node, taxNumberInput, itemIndex);
		borrower.federalTaxNumber = taxNumber;
		if (type === 'auto') borrower.type = taxNumber.length === 11 ? 'NaturalPerson' : 'LegalEntity';
	}
	if (type !== 'auto') borrower.type = type;
	for (const key of ['email', 'phoneNumber', 'municipalTaxNumber', 'stateTaxNumber']) {
		if (hasValue(details[key])) borrower[key] = String(details[key]).trim();
	}

	const address: IDataObject = {};
	for (const key of ['street', 'number', 'additionalInformation', 'district']) {
		if (hasValue(details[key])) address[key] = String(details[key]).trim();
	}
	if (hasValue(details.postalCode)) {
		address.postalCode = normalizePostalCode(node, details.postalCode, itemIndex);
	}
	if (hasValue(details.state)) address.state = normalizeState(node, details.state, itemIndex);
	if (hasValue(details.cityCode) || hasValue(details.cityName)) {
		const city: IDataObject = {};
		if (hasValue(details.cityCode)) city.code = String(details.cityCode).trim();
		if (hasValue(details.cityName)) city.name = String(details.cityName).trim();
		address.city = city;
	}
	if (Object.keys(address).length > 0 || hasValue(details.country)) {
		address.country = hasValue(details.country)
			? String(details.country).trim().toUpperCase()
			: 'BRA';
		borrower.address = address;
	}

	return Object.keys(borrower).length > 0 ? borrower : undefined;
}

function buildTaxReform(ctx: IExecuteFunctions, body: IDataObject, itemIndex: number) {
	const node = ctx.getNode();
	const group = ctx.getNodeParameter('taxReform', itemIndex, {}) as IDataObject;
	const overrides = hasValue(group.overrides)
		? jsonField(ctx, group.overrides, 'Overrides (JSON)', itemIndex)
		: undefined;
	const recipient = hasValue(group.recipient)
		? jsonField(ctx, group.recipient, 'Recipient (JSON)', itemIndex)
		: undefined;
	const used = ['operationIndicator', 'classCode', 'destinationIndicator', 'situationCode'].some(
		(key) => hasValue(group[key]),
	);
	if (!used && !overrides && !recipient) return;

	const ibsCbs: IDataObject = {
		...(overrides ?? {}),
		operationIndicator: normalizeSixDigits(
			node,
			group.operationIndicator,
			'Operation Indicator',
			itemIndex,
		),
		classCode: normalizeSixDigits(node, group.classCode, 'Classification Code', itemIndex),
	};
	if (hasValue(group.destinationIndicator))
		ibsCbs.destinationIndicator = group.destinationIndicator;
	if (hasValue(group.situationCode)) ibsCbs.situationCode = String(group.situationCode).trim();

	if (ibsCbs.destinationIndicator === 'DifferentFromBuyer' && !recipient) {
		throw new NodeOperationError(node, 'The recipient is missing', {
			description:
				'Destination Indicator "Different From Buyer" needs the Recipient (JSON) field in the Tax Reform group.',
			itemIndex,
		});
	}
	body.ibsCbs = ibsCbs;
	const party = recipient ? normalizeParty(recipient) : undefined;
	if (party) body.recipient = party;
}

/** Run of this node in the execution: 0, then 1, 2... on each round of a loop. */
function runIndex(ctx: IExecuteFunctions, itemIndex: number): number {
	try {
		const value = Number(ctx.getWorkflowDataProxy(itemIndex).$thisRunIndex);
		return Number.isInteger(value) && value >= 0 ? value : 0;
	} catch {
		return 0;
	}
}

/**
 * External ID used when the user leaves it empty. It is derived from the execution, the node, the
 * run of the node and the item: a node-level "Retry On Fail" repeats the same run and sends the
 * same ID (the API answers "already exists" and the node returns that invoice), while each round
 * of a loop, where item indexes restart at 0, gets new IDs. Random only without an execution ID.
 */
export function automaticExternalId(ctx: IExecuteFunctions, itemIndex: number): string {
	let executionId = '';
	try {
		executionId = String(ctx.getExecutionId() ?? '');
	} catch {
		executionId = '';
	}
	if (!executionId) return `n8n-${randomUUID()}`;
	const hex = createHash('sha256')
		.update(`${executionId}:${ctx.getNode().id}:${runIndex(ctx, itemIndex)}:${itemIndex}`)
		.digest('hex');
	return `n8n-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Builds the V3 issue body with only what the user filled in. */
export function buildIssueBody(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = ctx.getNode();
	const body: IDataObject = {
		cityServiceCode: String(ctx.getNodeParameter('cityServiceCode', itemIndex)).trim(),
		description: String(ctx.getNodeParameter('description', itemIndex)),
		servicesAmount: Number(ctx.getNodeParameter('servicesAmount', itemIndex)),
	};

	const borrower = buildBorrower(ctx, itemIndex);
	if (borrower) body.borrower = borrower;

	const additional = ctx.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	for (const key of ['cnaeCode', 'rpsSerialNumber', 'additionalInformation']) {
		if (hasValue(additional[key])) body[key] = String(additional[key]).trim();
	}
	for (const key of ['paidAmount', 'rpsNumber']) {
		if (hasValue(additional[key])) body[key] = Number(additional[key]);
	}
	if (hasValue(additional.federalServiceCode)) {
		body.federalServiceCode = normalizeFederalServiceCode(
			node,
			additional.federalServiceCode,
			itemIndex,
		);
	}
	if (hasValue(additional.nbsCode))
		body.nbsCode = normalizeNbsCode(node, additional.nbsCode, itemIndex);
	if (hasValue(additional.issuedOn)) body.issuedOn = String(additional.issuedOn);
	if (hasValue(additional.accrualOn)) body.accrualOn = datePart(additional.accrualOn);
	for (const key of ['location', 'intermediary']) {
		if (!hasValue(additional[key])) continue;
		const value = jsonField(
			ctx,
			additional[key],
			key === 'location' ? 'Location (JSON)' : 'Intermediary (JSON)',
			itemIndex,
		);
		const fieldValue = key === 'intermediary' ? normalizeParty(value ?? {}) : value;
		if (fieldValue) body[key] = fieldValue;
	}

	for (const group of ['issTaxes', 'federalWithholdings']) {
		const values = ctx.getNodeParameter(group, itemIndex, {}) as IDataObject;
		for (const [key, value] of Object.entries(values)) {
			if (hasValue(value)) body[key] = typeof value === 'number' ? value : String(value);
		}
	}

	buildTaxReform(ctx, body, itemIndex);

	const externalId = hasValue(additional.externalId)
		? String(additional.externalId).trim()
		: automaticExternalId(ctx, itemIndex);
	encodeExternalId(node, externalId, itemIndex);
	body.externalId = externalId;
	return body;
}

function isAlreadyExists(response: NfeResponse): boolean {
	if (response.statusCode !== 400) return false;
	const { message, details } = normalizeApiMessage(response.body);
	return /already exist/i.test([message, ...details].join(' '));
}

async function findByExternalId(
	ctx: IExecuteFunctions,
	companyId: string,
	externalId: string,
	itemIndex: number,
): Promise<IDataObject | undefined> {
	const body = await apiRequestBody<IDataObject>(
		ctx,
		{
			method: 'GET',
			url: `${invoicesUrl(companyId)}/external/${encodeExternalId(ctx.getNode(), externalId, itemIndex)}`,
		},
		{ itemIndex },
	);
	const invoices = (body.serviceInvoices as IDataObject[] | undefined) ?? [];
	return invoices[0];
}

/** The External ID index can lag a few seconds behind a concurrent issue. */
async function findExisting(
	ctx: IExecuteFunctions,
	companyId: string,
	externalId: string,
	itemIndex: number,
): Promise<IDataObject | undefined> {
	for (let attempt = 0; attempt < EXISTING_ATTEMPTS; attempt++) {
		if (attempt > 0) await sleep(RECONCILE_INTERVAL_MS);
		const found = await findByExternalId(ctx, companyId, externalId, itemIndex);
		if (found) return found;
	}
	return undefined;
}

/** After a timeout, network failure, 408 or 5xx the invoice may exist: look for it, never re-send. */
async function reconcile(
	ctx: IExecuteFunctions,
	companyId: string,
	externalId: string,
	itemIndex: number,
): Promise<IDataObject> {
	for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
		if (attempt > 0) await sleep(RECONCILE_INTERVAL_MS);
		let found: IDataObject | undefined;
		try {
			found = await findByExternalId(ctx, companyId, externalId, itemIndex);
		} catch {
			// A failed lookup is not an answer: keep looking until the window ends.
			found = undefined;
		}
		if (found) return found;
	}
	throw new NodeOperationError(ctx.getNode(), 'The issuance outcome is unknown', {
		description: [
			'NFE.io did not confirm the invoice and it was not found by its External ID after 30 seconds.',
			'The node did not send it again, to avoid a duplicate invoice.',
			`External ID: ${externalId}`,
			'Check the invoice with the "Get by External ID" operation before running this item again.',
		].join('\n'),
		itemIndex,
	});
}

export async function execute(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = ctx.getNode();
	const companyId = getCompanyId(ctx, itemIndex);
	const body = buildIssueBody(ctx, itemIndex);
	const externalId = String(body.externalId);
	const url = invoicesUrl(companyId);

	const result = await rawRequest(ctx, { method: 'POST', url, body, timeout: ISSUE_TIMEOUT_MS });

	let invoice: IDataObject;
	let alreadyExisted = false;
	if (result.kind === 'network') {
		invoice = await reconcile(ctx, companyId, externalId, itemIndex);
	} else {
		const { response } = result;
		const status = response.statusCode;
		if (
			status >= 200 &&
			status < 300 &&
			response.body &&
			typeof response.body === 'object' &&
			(response.body as IDataObject).id
		) {
			invoice = response.body as IDataObject;
		} else if (isAlreadyExists(response)) {
			const existing = await findExisting(ctx, companyId, externalId, itemIndex);
			if (!existing) {
				throw buildApiError(node, response, url, itemIndex, {
					message: 'An invoice with this External ID already exists',
					hint: `NFE.io reports the External ID "${externalId}" as used, but the invoice could not be read. Check the company or use another External ID.`,
				});
			}
			invoice = existing;
			alreadyExisted = true;
		} else if (status === 408 || status >= 500 || (status >= 200 && status < 300)) {
			invoice = await reconcile(ctx, companyId, externalId, itemIndex);
		} else {
			const hint =
				status === 429
					? {
							message: 'The NFE.io rate limit was reached',
							hint: 'The invoice was not issued and the node did not send it again. Wait a moment and run the node again.',
						}
					: {};
			throw buildApiError(node, response, url, itemIndex, hint);
		}
	}

	const output: IDataObject = {};
	const wait = ctx.getNodeParameter('waitForAuthorization', itemIndex, true) as boolean;
	if (wait && invoice.id) {
		const invoiceId = String(invoice.id);
		const timeout = clampWaitSeconds(ctx.getNodeParameter('waitTimeout', itemIndex, 60));
		const terminal = [...ISSUE_TERMINAL, ...CANCEL_TERMINAL];
		const waited = await waitForFlowStatus(
			invoice,
			async () => await fetchInvoice(ctx, companyId, invoiceId, itemIndex),
			terminal,
			timeout,
		);
		invoice = waited.invoice;
		output.waitTimedOut = waited.timedOut;
		if (invoice.flowStatus === 'IssueFailed') {
			throw new NodeOperationError(node, 'The city did not authorize the invoice', {
				description: [
					invoice.flowMessage
						? `Reason: ${String(invoice.flowMessage)}`
						: 'NFE.io did not send a reason.',
					`Invoice ID: ${invoiceId}`,
					`External ID: ${externalId}`,
					'Fix the data and issue it again with a new External ID.',
				].join('\n'),
				itemIndex,
			});
		}
	}

	return [
		{
			json: {
				...shapeInvoice(ctx, invoice, itemIndex),
				externalId: invoice.externalId ?? externalId,
				alreadyExisted,
				...output,
			},
		},
	];
}
