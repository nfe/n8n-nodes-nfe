import type { IDataObject, INodeProperties } from 'n8n-workflow';

export type OutputMode = 'simplified' | 'raw' | 'selected';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function getPath(source: unknown, path: string): unknown {
	let current: unknown = source;
	for (const key of path.split('.')) {
		if (current === null || typeof current !== 'object') return undefined;
		if (UNSAFE_KEYS.has(key)) return undefined;
		current = (current as IDataObject)[key];
	}
	return current;
}

function setPath(target: IDataObject, path: string, value: unknown) {
	const keys = path.split('.');
	// Field paths may come from an AI agent: never write to object prototypes.
	if (keys.some((key) => UNSAFE_KEYS.has(key) || key === '')) return;
	let current = target;
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
		if (index === keys.length - 1) {
			current[key] = value as IDataObject[string];
			return;
		}
		const next = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
		if (typeof next !== 'object' || next === null) current[key] = {};
		current = current[key] as IDataObject;
	}
}

function valueOrNull(value: unknown) {
	return value === undefined ? null : value;
}

/** Ten top-level fields of a service invoice. */
export function simplifyInvoice(invoice: IDataObject): IDataObject {
	return {
		id: valueOrNull(invoice.id),
		externalId: valueOrNull(invoice.externalId),
		number: valueOrNull(invoice.number),
		status: valueOrNull(invoice.status),
		flowStatus: valueOrNull(invoice.flowStatus),
		flowMessage: valueOrNull(invoice.flowMessage),
		issuedOn: valueOrNull(invoice.issuedOn),
		servicesAmount: valueOrNull(invoice.servicesAmount),
		borrowerName: valueOrNull(getPath(invoice, 'borrower.name')),
		borrowerFederalTaxNumber: valueOrNull(getPath(invoice, 'borrower.federalTaxNumber')),
	};
}

export function simplifyCompany(company: IDataObject): IDataObject {
	return {
		id: valueOrNull(company.id),
		name: valueOrNull(company.name),
		tradeName: valueOrNull(company.tradeName),
		federalTaxNumber: valueOrNull(company.federalTaxNumber),
		taxRegime: valueOrNull(company.taxRegime),
		status: valueOrNull(company.status),
		city: valueOrNull(getPath(company, 'address.city.name')),
		state: valueOrNull(getPath(company, 'address.state')),
	};
}

export function simplifyLegalEntity(entity: IDataObject): IDataObject {
	const data = (entity.legalEntity as IDataObject | undefined) ?? entity;
	return {
		federalTaxNumber: valueOrNull(data.federalTaxNumber),
		name: valueOrNull(data.name),
		tradeName: valueOrNull(data.tradeName),
		status: valueOrNull(data.status),
		openedOn: valueOrNull(data.openedOn),
		size: valueOrNull(data.size),
		email: valueOrNull(data.email),
		city: valueOrNull(getPath(data, 'address.city.name')),
		state: valueOrNull(getPath(data, 'address.state')),
		economicActivity: valueOrNull(
			getPath(data, 'economicActivities.0.description') ??
				getPath(data, 'economicActivities.0.code'),
		),
	};
}

export function selectFields(source: IDataObject, fields: string): IDataObject {
	const result: IDataObject = {};
	for (const path of fields
		.split(',')
		.map((field) => field.trim())
		.filter(Boolean)) {
		setPath(result, path, valueOrNull(getPath(source, path)));
	}
	return result;
}

export function shapeOutput(
	source: IDataObject,
	mode: OutputMode,
	fields: string,
	simplify: (data: IDataObject) => IDataObject,
): IDataObject {
	if (mode === 'raw') return source;
	if (mode === 'selected') return selectFields(source, fields);
	return simplify(source);
}

/** Output selector shared by every operation that returns an invoice or a company. */
export function outputProperties(
	show: { resource: string[]; operation: string[] },
	simplifiedDescription: string,
): INodeProperties[] {
	return [
		{
			displayName: 'Output',
			name: 'output',
			type: 'options',
			displayOptions: { show },
			options: [
				{
					name: 'Raw',
					value: 'raw',
					description: 'Return the full object as sent by NFE.io',
				},
				{
					name: 'Selected Fields',
					value: 'selected',
					description: 'Return only the fields listed below',
				},
				{
					name: 'Simplified',
					value: 'simplified',
					description: simplifiedDescription,
				},
			],
			default: 'simplified',
		},
		{
			displayName: 'Fields',
			name: 'fields',
			type: 'string',
			displayOptions: { show: { ...show, output: ['selected'] } },
			default: '',
			placeholder: 'e.g. number,status,borrower.name',
			description: 'Comma-separated list of fields to return. Use dots for nested fields.',
		},
	];
}
