import type { IDataObject } from 'n8n-workflow';

import { ALL_EVENTS, FALLBACK_EVENT_TYPES, normalizeEventId } from './events';

export interface Delivery {
	event: string;
	resource: string | null;
	action: string | null;
	companyId: string | null;
	deliveryId: string | null;
	payload: IDataObject;
}

function headerValue(headers: IDataObject, name: string): string | null {
	const value = headers[name.toLowerCase()] ?? headers[name];
	const text = Array.isArray(value) ? value[0] : value;
	return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
}

function isObject(value: unknown): value is IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nestedId(source: IDataObject, key: string): string | null {
	const value = source[key];
	if (!isObject(value)) return null;
	const id = value.id;
	return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

/**
 * Company of the event, per the NFE.io event catalog: `provider.id` (service invoice, seen on
 * the wire), `issuer.id` (product and consumer invoices), `company.id` (inbound documents) and
 * `companyId` (tax payment forms, inbound service invoices). `null` when none is present.
 */
export function resolveCompanyId(payload: IDataObject): string | null {
	const fromParty =
		nestedId(payload, 'provider') ?? nestedId(payload, 'issuer') ?? nestedId(payload, 'company');
	if (fromParty) return fromParty;
	const companyId = payload.companyId;
	return typeof companyId === 'string' || typeof companyId === 'number' ? String(companyId) : null;
}

/** Service invoices arrive as `{ action, payload }`; other families arrive flat. */
function extractPayload(body: IDataObject): IDataObject {
	let source = body;
	if (Object.keys(source).length === 1 && isObject(source.body)) source = source.body;
	if (isObject(source.payload)) return source.payload;
	const rest = { ...source };
	delete rest.action;
	return rest;
}

export function parseDelivery(
	headers: IDataObject,
	rawBody: unknown,
	selected: string[],
): Delivery {
	const body = isObject(rawBody) ? rawBody : {};
	const source = Object.keys(body).length === 1 && isObject(body.body) ? body.body : body;
	const action =
		typeof source.action === 'string' && source.action.trim() ? source.action.trim() : null;
	const resource = headerValue(headers, 'x-hook-event');
	const built = [resource, action].filter(Boolean).join('.');

	// Prefer the exact id of the API (it may use ":" instead of ".").
	const known = [...selected, ...FALLBACK_EVENT_TYPES.map((type) => type.id)].filter(
		(id) => id !== ALL_EVENTS,
	);
	const exact = known.find((id) => normalizeEventId(id) === normalizeEventId(built));

	const payload = extractPayload(body);
	return {
		event: exact ?? built,
		resource,
		action,
		companyId: resolveCompanyId(payload),
		deliveryId: headerValue(headers, 'x-hook-id'),
		payload,
	};
}

export function matchesSelection(event: string, selected: string[]): boolean {
	if (selected.includes(ALL_EVENTS)) return true;
	const target = normalizeEventId(event);
	return selected.some((id) => normalizeEventId(id) === target);
}
