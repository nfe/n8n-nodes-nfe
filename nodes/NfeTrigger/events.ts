import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

export const ALL_EVENTS = '*';

/**
 * Generic ids listed by the API that are silently dropped when a webhook is created
 * (8 filters sent, 6 returned). The specific success, failed and error ids cover them.
 */
export const DISCARDED_EVENT_IDS = ['service_invoice.issued', 'service_invoice.cancelled'];

export interface EventType {
	id: string;
	description: string;
}

/**
 * Fallback when `GET /v2/webhooks/eventTypes` cannot be reached. Same ids and descriptions as
 * the API on 2026-10-16, without the discarded generic ids and `*`. Review on each release.
 */
export const FALLBACK_EVENT_TYPES: EventType[] = [
	{
		id: 'consumer_invoice.cancelled_error',
		description:
			'Triggered when consumer invoice (NFCe) processing has been occurred an error to Cancel.',
	},
	{
		id: 'consumer_invoice.cancelled_failed',
		description: 'Triggered when consumer invoice (NFCe) processing has been failed to Cancel.',
	},
	{
		id: 'consumer_invoice.cancelled_successfully',
		description:
			'Triggered when consumer invoice (NFCe) processing has been Cancelled successfully.',
	},
	{
		id: 'consumer_invoice.issued_error',
		description:
			'Triggered when consumer invoice (NFCe) processing has been occurred an error to Issue.',
	},
	{
		id: 'consumer_invoice.issued_failed',
		description: 'Triggered when consumer invoice (NFCe) processing has been failed to Issue.',
	},
	{
		id: 'consumer_invoice.issued_successfully',
		description: 'Triggered when consumer invoice (NFCe) processing has been Issued successfully.',
	},
	{
		id: 'legal_entity_taxpayer:updated_sucessfully',
		description: 'Triggered when a legal entity taxpayer has been updated successfully.',
	},
	{
		id: 'product_invoice.cancelled_error',
		description:
			'Triggered when product invoice (NFe) processing has been occurred an error to Cancel.',
	},
	{
		id: 'product_invoice.cancelled_failed',
		description: 'Triggered when product invoice (NFe) processing has been failed to Cancel.',
	},
	{
		id: 'product_invoice.cancelled_successfully',
		description: 'Triggered when product invoice (NFe) processing has been Cancelled successfully.',
	},
	{
		id: 'product_invoice.cce_error',
		description: 'Triggered when invoice event (NFe) processing has been occurred an error to CCe.',
	},
	{
		id: 'product_invoice.cce_failed',
		description: 'Triggered when invoice event (NFe) processing has been failed to CCe.',
	},
	{
		id: 'product_invoice.cce_successfully',
		description: 'Triggered when invoice event cce (NFe) processing has been sent successfully.',
	},
	{
		id: 'product_invoice.dfe_event_error',
		description:
			'Triggered when DFe event (NT 2025.002-RTC) processing has failed with a non-retryable error.',
	},
	{
		id: 'product_invoice.dfe_event_failed',
		description:
			'Triggered when DFe event (NT 2025.002-RTC) processing has exhausted retry attempts and entered terminal failed state.',
	},
	{
		id: 'product_invoice.dfe_event_successfully',
		description:
			'Triggered when DFe event (NT 2025.002-RTC) processing has been registered successfully on SVRS.',
	},
	{
		id: 'product_invoice.disabled_error',
		description: 'Triggered when product invoice (NFe) processing has been Disabled error.',
	},
	{
		id: 'product_invoice.disabled_failed',
		description: 'Triggered when product invoice (NFe) processing has been Disabled failed.',
	},
	{
		id: 'product_invoice.disabled_successfully',
		description: 'Triggered when product invoice (NFe) processing has been Disabled successfully.',
	},
	{
		id: 'product_invoice.issued_error',
		description:
			'Triggered when product invoice (NFe) processing has been occurred an error to Issue.',
	},
	{
		id: 'product_invoice.issued_failed',
		description: 'Triggered when product invoice (NFe) processing has been failed to Issue.',
	},
	{
		id: 'product_invoice.issued_successfully',
		description: 'Triggered when product invoice (NFe) processing has been Issued successfully.',
	},
	{
		id: 'product_invoice_inbound.event_raised_successfully',
		description:
			'Triggered when an event has been successfully Raised on a product invoice (NFe) and retrieved from inbound services.',
	},
	{
		id: 'product_invoice_inbound.input_event_raised_successfully',
		description:
			'Triggered when an input event has been successfully Raised on a product invoice (NFe) and retrieved from inbound services.',
	},
	{
		id: 'product_invoice_inbound.issued_successfully',
		description:
			'Triggered when a product invoice (NFe) has been Issued successfully and retrieved from inbound services.',
	},
	{
		id: 'product_invoice_inbound_summary.event_raised_successfully',
		description:
			'Triggered when an event has been successfully Raised on a product invoice (NFe) and retrieved the summary from inbound services.',
	},
	{
		id: 'product_invoice_inbound_summary.issued_successfully',
		description:
			'Triggered when a product invoice (NFe) has been Issued successfully and retrieved the summary from inbound services.',
	},
	{
		id: 'product_tax.created_successfully',
		description: 'Triggered when a product is successfully saved and all tax rules applied.',
	},
	{
		id: 'product_tax.creation_failed',
		description:
			'Triggered when a product tax could not be saved. More details described in the event',
	},
	{
		id: 'product_tax.custom_rules_requested',
		description:
			'Triggered when a product requires custom tax rules, which will be assembled and applied as described in specific service times.',
	},
	{
		id: 'service_invoice.cancelled_error',
		description:
			'Triggered when service invoice (NFSe) processing has been occurred an error to Cancel.',
	},
	{
		id: 'service_invoice.cancelled_failed',
		description: 'Triggered when service invoice (NFSe) processing has been failed to Cancel.',
	},
	{
		id: 'service_invoice.cancelled_successfully',
		description:
			'Triggered when service invoice (NFSe) processing has been Cancelled successfully.',
	},
	{
		id: 'service_invoice.issued_error',
		description:
			'Triggered when service invoice (NFSe) processing has been occurred an error to Issue.',
	},
	{
		id: 'service_invoice.issued_failed',
		description: 'Triggered when service invoice (NFSe) processing has been failed to Issue.',
	},
	{
		id: 'service_invoice.issued_successfully',
		description: 'Triggered when service invoice (NFSe) processing has been Issued successfully.',
	},
	{
		id: 'service_invoice.pulled',
		description: 'Triggered when service invoice (NFSe) was pulled automatically.',
	},
	{
		id: 'service_invoice_inbound.event_raised_successfully',
		description:
			'Triggered when an event has been successfully Raised on a service invoice (NFS-e) and retrieved from inbound services.',
	},
	{
		id: 'service_invoice_inbound.issued_successfully',
		description:
			'Triggered when a service invoice (NFS-e) has been Issued successfully and retrieved from inbound services.',
	},
	{
		id: 'service_invoice_inbound.outbound_successfully',
		description:
			'Triggered when a service invoice outbound (NFS-e) has been Issued successfully and retrieved from inbound services.',
	},
	{
		id: 'tax_payment_form.created_successfully',
		description: 'Triggered when a tax payment has been successfully created.',
	},
	{
		id: 'tax_payment_form.creation_failed',
		description: 'Triggered when a tax payment has failed during creation.',
	},
	{
		id: 'tax_payment_form.creation_not_needed',
		description:
			'Triggered when a tax payment will not be created because it is not needed considering the UF rules.',
	},
	{
		id: 'transportation_invoice_inbound.event_raised_successfully',
		description:
			'Triggered when an event has been successfully Raised on a transportation invoice (CTe) and retrieved from inbound services.',
	},
	{
		id: 'transportation_invoice_inbound.issued_successfully',
		description:
			'Triggered when a transportation invoice (CTe) has been Issued successfully and retrieved from inbound services.',
	},
];

const FAMILY_LABELS: Record<string, string> = {
	consumer_invoice: 'Consumer Invoice (NFC-e)',
	legal_entity_taxpayer: 'Legal Entity Taxpayer',
	product_invoice: 'Product Invoice (NF-e)',
	product_invoice_inbound: 'Inbound Product Invoice (NF-e)',
	product_invoice_inbound_summary: 'Inbound Product Invoice Summary (NF-e)',
	product_tax: 'Product Tax',
	service_invoice: 'Service Invoice (NFS-e)',
	service_invoice_inbound: 'Inbound Service Invoice (NFS-e)',
	tax_payment_form: 'Tax Payment Form',
	transportation_invoice_inbound: 'Inbound Transportation Invoice (CT-e)',
};

const WORD_LABELS: Record<string, string> = {
	cce: 'CC-e',
	dfe: 'DF-e',
	sucessfully: 'Successfully',
};

function titleCase(text: string): string {
	return text
		.split('_')
		.filter(Boolean)
		.map((word) => WORD_LABELS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** Lower case with `:` turned into `.`, so `a:b` and `a.b` are the same event. */
export function normalizeEventId(id: string): string {
	return id.trim().toLowerCase().replace(/:/g, '.');
}

export function splitEventId(id: string): { resource: string; action: string } {
	const index = id.search(/[.:]/);
	if (index === -1) return { resource: '', action: id };
	return { resource: id.slice(0, index), action: id.slice(index + 1) };
}

export function eventLabel(id: string): string {
	if (id === ALL_EVENTS) return 'All Events';
	const { resource, action } = splitEventId(id);
	const family = FAMILY_LABELS[resource] ?? titleCase(resource);
	return family ? `${family}: ${titleCase(action)}` : titleCase(action);
}

/** Options for the Events field: "All Events" first, then the API list sorted by label. */
export function toEventOptions(types: Array<EventType | IDataObject>): INodePropertyOptions[] {
	const discarded = new Set(DISCARDED_EVENT_IDS);
	const seen = new Set<string>();
	const options: INodePropertyOptions[] = [];
	for (const type of types) {
		const id = String(type.id ?? '').trim();
		const status = (type as IDataObject).status;
		if (!id || id === ALL_EVENTS || discarded.has(normalizeEventId(id))) continue;
		if (status !== undefined && String(status) !== 'Active' && status !== 1) continue;
		if (seen.has(normalizeEventId(id))) continue;
		seen.add(normalizeEventId(id));
		options.push({ name: eventLabel(id), value: id, description: String(type.description ?? '') });
	}
	options.sort((a, b) => a.name.localeCompare(b.name));
	return [
		{
			name: 'All Events',
			value: ALL_EVENTS,
			description: 'Every event of the account, including types added to NFE.io later',
		},
		...options,
	];
}
