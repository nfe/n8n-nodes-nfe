import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const BRAZILIAN_STATES = [
	'AC',
	'AL',
	'AM',
	'AP',
	'BA',
	'CE',
	'DF',
	'ES',
	'GO',
	'MA',
	'MG',
	'MS',
	'MT',
	'PA',
	'PB',
	'PE',
	'PI',
	'PR',
	'RJ',
	'RN',
	'RO',
	'RR',
	'RS',
	'SC',
	'SE',
	'SP',
	'TO',
];

function invalid(node: INode, message: string, description: string, itemIndex?: number): never {
	throw new NodeOperationError(node, message, { description, itemIndex });
}

/** Company, invoice and webhook IDs: letters, digits, `-` and `_` only (no path traversal). */
export function assertId(node: INode, value: unknown, label: string, itemIndex?: number): string {
	const id = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	if (!ID_PATTERN.test(id)) {
		invalid(
			node,
			`The ${label} is not valid`,
			`Use the ${label} exactly as NFE.io shows it: letters, digits, "-" and "_" only, up to 64 characters.`,
			itemIndex,
		);
	}
	return id;
}

/** External IDs are free text but must not change the URL path. */
export function encodeExternalId(node: INode, value: unknown, itemIndex?: number): string {
	const id = String(value ?? '').trim();
	if (
		!id ||
		id === '.' ||
		id === '..' ||
		id.includes('/') ||
		id.includes('\\') ||
		id.length > 128
	) {
		invalid(
			node,
			'The External ID is not valid',
			'Use up to 128 characters without "/" or "\\" (for example, your order number).',
			itemIndex,
		);
	}
	return encodeURIComponent(id);
}

function cnpjCharValue(char: string): number {
	return char.charCodeAt(0) - 48;
}

function cnpjCheckDigit(base: string): number {
	let weight = 2;
	let sum = 0;
	for (let index = base.length - 1; index >= 0; index--) {
		sum += cnpjCharValue(base[index]) * weight;
		weight = weight === 9 ? 2 : weight + 1;
	}
	const rest = sum % 11;
	return rest < 2 ? 0 : 11 - rest;
}

/** Validates a numeric or alphanumeric CNPJ (Receita Federal algorithm, IN RFB 2.229/2024). */
export function isValidCnpj(value: string): boolean {
	if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(value)) return false;
	if (/^(\d)\1{13}$/.test(value)) return false;
	const first = cnpjCheckDigit(value.slice(0, 12));
	const second = cnpjCheckDigit(value.slice(0, 12) + String(first));
	return value.endsWith(`${first}${second}`);
}

export function isValidCpf(value: string): boolean {
	if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
	const digits = value.split('').map(Number);
	for (const length of [9, 10]) {
		let sum = 0;
		for (let index = 0; index < length; index++) sum += digits[index] * (length + 1 - index);
		const check = ((sum * 10) % 11) % 10;
		if (check !== digits[length]) return false;
	}
	return true;
}

/** Removes punctuation and upper-cases a CPF/CNPJ (keeps letters of alphanumeric CNPJ). */
export function normalizeTaxNumber(value: unknown): string {
	return String(value ?? '')
		.replace(/[\s./-]/g, '')
		.toUpperCase();
}

export function normalizeCnpj(node: INode, value: unknown, itemIndex?: number): string {
	const cnpj = normalizeTaxNumber(value);
	if (!isValidCnpj(cnpj)) {
		invalid(
			node,
			'The CNPJ is not valid',
			'Enter the 14 characters of the CNPJ (numeric or alphanumeric) and check the last two digits. No lookup was made.',
			itemIndex,
		);
	}
	return cnpj;
}

/** Borrower tax number: CPF (11 digits) or CNPJ (14 characters), sent as a string. */
export function normalizeBorrowerTaxNumber(
	node: INode,
	value: unknown,
	itemIndex?: number,
): string {
	const taxNumber = normalizeTaxNumber(value);
	if (taxNumber.length === 11 ? !isValidCpf(taxNumber) : !isValidCnpj(taxNumber)) {
		invalid(
			node,
			'The borrower Federal Tax Number is not valid',
			'Enter a CPF (11 digits) or a CNPJ (14 characters, numeric or alphanumeric) and check the last two digits.',
			itemIndex,
		);
	}
	return taxNumber;
}

export function normalizePostalCode(node: INode, value: unknown, itemIndex?: number): string {
	const postalCode = String(value ?? '').replace(/[\s.-]/g, '');
	if (!/^\d{8}$/.test(postalCode)) {
		invalid(
			node,
			'The postal code is not valid',
			'Enter the 8 digits of the CEP, e.g. 80010-000.',
			itemIndex,
		);
	}
	return postalCode;
}

export function normalizeState(node: INode, value: unknown, itemIndex?: number): string {
	const state = String(value ?? '')
		.trim()
		.toUpperCase();
	if (!BRAZILIAN_STATES.includes(state)) {
		invalid(
			node,
			'The state is not valid',
			'Use the two-letter state code, e.g. SP or PR.',
			itemIndex,
		);
	}
	return state;
}

/** NBS code: 9 digits, dots allowed in the input (`1.1502.10.00` → `115021000`). */
export function normalizeNbsCode(node: INode, value: unknown, itemIndex?: number): string {
	const code = String(value ?? '').replace(/[\s.]/g, '');
	if (!/^\d{9}$/.test(code)) {
		invalid(
			node,
			'The NBS Code is not valid',
			'Enter the 9 digits of the NBS code, e.g. 1.1502.10.00.',
			itemIndex,
		);
	}
	return code;
}

/** LC 116 service item (`NN.NN`); accepts `1.01` and `0101`. */
export function normalizeFederalServiceCode(
	node: INode,
	value: unknown,
	itemIndex?: number,
): string {
	const text = String(value ?? '').trim();
	const dotted = /^(\d{1,2})\.(\d{2})$/.exec(text);
	if (dotted) return `${dotted[1].padStart(2, '0')}.${dotted[2]}`;
	if (/^\d{4}$/.test(text)) return `${text.slice(0, 2)}.${text.slice(2)}`;
	return invalid(
		node,
		'The Federal Service Code is not valid',
		'Use the LC 116 service item in the NN.NN format, e.g. 01.07.',
		itemIndex,
	);
}

/** Six-digit codes of the tax reform group (operation indicator and classification code). */
export function normalizeSixDigits(
	node: INode,
	value: unknown,
	label: string,
	itemIndex?: number,
): string {
	const code = String(value ?? '').trim();
	if (!/^\d{6}$/.test(code)) {
		invalid(
			node,
			`The ${label} must have exactly 6 digits`,
			`Check the ${label} in the NFE.io tax reform tables, e.g. 100301 or 000001.`,
			itemIndex,
		);
	}
	return code;
}

/** Parses a JSON parameter that may come as text or as an object from an expression. */
export function parseJsonObject(
	node: INode,
	value: unknown,
	label: string,
	itemIndex?: number,
): Record<string, unknown> {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return {};
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = undefined;
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		invalid(
			node,
			`${label} must be a JSON object`,
			`Enter an object such as {"name": "value"}.`,
			itemIndex,
		);
	}
	return parsed as Record<string, unknown>;
}
