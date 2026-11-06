/**
 * Webhook deliveries.
 *
 * - `serviceInvoiceIssued` follows the shape seen on the wire (headers `X-Hook-Event` and
 *   `X-Hub-Signature`, body `{ action, payload }`), redacted.
 * - Every other family is SYNTHETIC: built from the NFE.io event catalog documentation
 *   (flat body with `action` next to the document fields). Not observed on the wire.
 */
import { createHmac } from 'crypto';
import type { IDataObject } from 'n8n-workflow';

import { COMPANY_ID, invoice } from './api';

export const TEST_SECRET = 'a'.repeat(64);

export function sign(body: string, secret = TEST_SECRET): string {
	return `sha1=${createHmac('sha1', secret).update(body).digest('hex').toUpperCase()}`;
}

export interface Delivery {
	hookEvent: string | undefined;
	body: IDataObject;
}

export const DELIVERIES: Record<string, Delivery> = {
	serviceInvoiceIssued: {
		hookEvent: 'service_invoice',
		body: { action: 'issued_successfully', payload: invoice() },
	},
	serviceInvoiceCancelled: {
		hookEvent: 'service_invoice',
		body: {
			action: 'cancelled_successfully',
			payload: invoice({ status: 'Cancelled', flowStatus: 'Cancelled' }),
		},
	},
	/** SYNTHETIC (catalog: NF-e is flat, company in `issuer.id`). */
	productInvoiceIssued: {
		hookEvent: 'product_invoice',
		body: {
			action: 'issued_successfully',
			id: 'nfe00000000000000000001',
			status: 'Issued',
			issuer: { id: 'company-nfe-1', accountId: 'account-1' },
			buyer: { name: 'Comprador Teste' },
		},
	},
	/** SYNTHETIC (catalog: inbound NF-e, company in `company.id`). */
	productInvoiceInbound: {
		hookEvent: 'product_invoice_inbound',
		body: {
			action: 'issued_successfully',
			id: 'inbound-nfe-1',
			company: { id: 'company-inbound-1', federalTaxNumber: '11222333000181' },
		},
	},
	/** SYNTHETIC (catalog: tax payment form, root `companyId`). */
	taxPaymentFormCreated: {
		hookEvent: 'tax_payment_form',
		body: {
			action: 'created_successfully',
			id: 'guide-1',
			companyId: 'company-guide-1',
			accountId: 'account-1',
		},
	},
	/** SYNTHETIC (catalog: product tax has no company, only `tenantId`). */
	productTaxCreated: {
		hookEvent: 'product_tax',
		body: {
			action: 'created_successfully',
			id: 'product-1',
			tenantId: 'tenant-1',
			collectionId: 'collection-1',
		},
	},
	/** SYNTHETIC and INFERRED: the delivery format of this event is not documented. */
	taxpayerUpdated: {
		hookEvent: 'legal_entity_taxpayer',
		body: { action: 'updated_sucessfully', federalTaxNumber: '11222333000181' },
	},
};

export const SERVICE_INVOICE_COMPANY_ID = COMPANY_ID;
