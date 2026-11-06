import type { IDataObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { matchesSelection, parseDelivery, resolveCompanyId } from '../../nodes/NfeTrigger/delivery';
import {
	ALL_EVENTS,
	DISCARDED_EVENT_IDS,
	eventLabel,
	FALLBACK_EVENT_TYPES,
	normalizeEventId,
	splitEventId,
	toEventOptions,
} from '../../nodes/NfeTrigger/events';
import { EVENT_TYPES_URL, NfeTrigger, WEBHOOKS_BASE } from '../../nodes/NfeTrigger/NfeTrigger.node';
import { generateSecret, isValidSignature } from '../../nodes/NfeTrigger/signature';
import eventTypesFixture from '../fixtures/event-types.json';
import { COMPANY_ID } from '../fixtures/api';
import { DELIVERIES, sign, TEST_SECRET } from '../fixtures/webhooks';
import { FakeApi, hookContext, loadOptionsContext, webhookContext } from '../helpers/context';

interface SdkVector {
	body: string;
	header_value: string;
	secret: string;
}

type SdkModule = { default?: { fixtures?: SdkVector[] }; fixtures?: SdkVector[] };

// Optional file outside this repository: the path is built at run time so CI (without the SDK
// checkout) neither resolves nor fails on it.
const sdkFixture = new URL(
	['..', '..', '..', 'client-nodejs', 'tests', 'fixtures', 'webhook-signatures.json'].join('/'),
	import.meta.url,
).href;
const sdkVectors: SdkVector[] = await import(/* @vite-ignore */ sdkFixture)
	.then((module: SdkModule) => module.default?.fixtures ?? module.fixtures ?? [])
	.catch(() => []);

const trigger = new NfeTrigger();
const hooks = trigger.webhookMethods.default;
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';
const URI = `${WEBHOOK_URL}?source=n8n-nodes-nfe`;
const HOOK_ID = 'webhook0000000000000000001';

/** Fake account whose webhook list (read before every creation) holds `list`. */
function accountApi(list: IDataObject[] = []) {
	return new FakeApi().on('GET', WEBHOOKS_BASE, { body: { webHooks: list } });
}

/** Node static data with one webhook registered by the trigger. */
function stored(webhookId: string, uri = URI, secret = TEST_SECRET): IDataObject {
	return { webhooks: { [uri]: { webhookId, secret } } };
}

describe('event list', () => {
	it('loads the API list with All Events first and without discarded ids', async () => {
		const api = new FakeApi().on('GET', EVENT_TYPES_URL, { body: eventTypesFixture });
		const options = await trigger.methods.loadOptions.getEvents.call(loadOptionsContext(api));
		expect(options[0]).toMatchObject({ name: 'All Events', value: ALL_EVENTS });
		const values = options.map((option) => option.value);
		expect(values).toHaveLength(46);
		for (const id of DISCARDED_EVENT_IDS) expect(values).not.toContain(id);
		expect(values).toContain('legal_entity_taxpayer:updated_sucessfully');
		expect(values).toContain('product_tax.created_successfully');
		expect(values).toContain('tax_payment_form.creation_not_needed');
		expect(values).toContain('transportation_invoice_inbound.issued_successfully');
		expect(api.calls[0].authenticated).toBe(false);
		const names = options.slice(1).map((option) => option.name);
		expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
	});

	it('falls back to the shipped list when the API cannot be reached or answers empty', async () => {
		for (const response of [
			{ networkError: { code: 'ENOTFOUND' } },
			{ statusCode: 500 },
			{ body: { eventTypes: [] } },
		]) {
			const api = new FakeApi().on('GET', EVENT_TYPES_URL, response);
			const options = await trigger.methods.loadOptions.getEvents.call(loadOptionsContext(api));
			expect(options).toHaveLength(FALLBACK_EVENT_TYPES.length + 1);
			expect(api.calls).toHaveLength(1);
		}
	});

	it('keeps the fallback in sync with the eventTypes fixture', () => {
		const fromApi = eventTypesFixture.eventTypes
			.map((type) => type.id)
			.filter((id) => id !== ALL_EVENTS && !DISCARDED_EVENT_IDS.includes(id))
			.sort();
		expect(FALLBACK_EVENT_TYPES.map((type) => type.id).sort()).toEqual(fromApi);
	});

	it('labels, splits and normalizes event ids', () => {
		expect(eventLabel('service_invoice.issued_successfully')).toBe(
			'Service Invoice (NFS-e): Issued Successfully',
		);
		expect(eventLabel('legal_entity_taxpayer:updated_sucessfully')).toBe(
			'Legal Entity Taxpayer: Updated Successfully',
		);
		expect(eventLabel('product_invoice.cce_error')).toBe('Product Invoice (NF-e): CC-e Error');
		expect(eventLabel('new_family.some_action')).toBe('New Family: Some Action');
		expect(eventLabel('lonely')).toBe('Lonely');
		expect(eventLabel(ALL_EVENTS)).toBe('All Events');
		expect(splitEventId('a:b.c')).toEqual({ resource: 'a', action: 'b.c' });
		expect(normalizeEventId(' Legal_Entity_Taxpayer:Updated_Sucessfully ')).toBe(
			'legal_entity_taxpayer.updated_sucessfully',
		);
	});

	it('skips inactive, duplicated and empty types', () => {
		const options = toEventOptions([
			{ id: 'a.b', status: 'Active' },
			{ id: 'A.B', status: 1 },
			{ id: 'c.d', status: 'Inactive' },
			{ id: '' },
			{ id: ALL_EVENTS },
			{ id: 'service_invoice.issued' },
		]);
		expect(options.map((option) => option.value)).toEqual([ALL_EVENTS, 'a.b']);
	});
});

describe('webhook lifecycle', () => {
	const params = {
		events: ['service_invoice.issued_successfully', 'service_invoice.cancelled_successfully'],
	};
	const created = (filters: string[] = params.events) => ({
		statusCode: 201,
		body: {
			webHook: {
				id: HOOK_ID,
				uri: URI,
				secret: 'returned',
				contentType: 'json',
				status: 'Active',
				filters,
			},
		},
	});

	it('creates the webhook with marker, secret and the selected filters', async () => {
		const api = accountApi().on('POST', WEBHOOKS_BASE, created());
		const data: IDataObject = {};
		expect(await hooks.create.call(hookContext(api, params, data, WEBHOOK_URL))).toBe(true);
		expect(api.calls.map((call) => call.options.method)).toEqual(['GET', 'POST']);
		const sent = api.calls[1].options.body as IDataObject;
		const hook = sent.webHook as IDataObject;
		expect(hook).toMatchObject({
			uri: URI,
			contentType: 'json',
			status: 'Active',
			insecureSsl: false,
			filters: params.events,
		});
		expect(hook.secret).toMatch(/^[0-9a-f]{64}$/);
		expect(data).toEqual({ webhooks: { [URI]: { webhookId: HOOK_ID, secret: hook.secret } } });
		expect(api.calls.every((call) => call.authenticated)).toBe(true);
	});

	it('sends * for All Events and refuses an empty selection', async () => {
		const api = accountApi().on('POST', WEBHOOKS_BASE, created([ALL_EVENTS]));
		await hooks.create.call(
			hookContext(api, { events: [ALL_EVENTS, 'service_invoice.pulled'] }, {}),
		);
		expect(((api.calls[1].options.body as IDataObject).webHook as IDataObject).filters).toEqual([
			ALL_EVENTS,
		]);
		await expect(hooks.create.call(hookContext(new FakeApi(), { events: [] }, {}))).rejects.toThrow(
			'No event is selected',
		);
	});

	it('removes its own webhook and fails when the API drops a filter', async () => {
		const api = accountApi()
			.on('POST', WEBHOOKS_BASE, created(['service_invoice.issued_successfully']))
			.on('DELETE', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 204 });
		const data: IDataObject = {};
		const promise = hooks.create.call(hookContext(api, params, data));
		await expect(promise).rejects.toThrow('NFE.io did not accept some of the selected events');
		await promise.catch((error: { description: string }) =>
			expect(error.description).toContain('service_invoice.cancelled_successfully'),
		);
		expect(api.callsTo('DELETE', /./)).toHaveLength(1);
		expect(data).toEqual({ webhooks: {} });
	});

	it('explains a refused creation (URL not reachable)', async () => {
		const api = accountApi().on('POST', WEBHOOKS_BASE, {
			statusCode: 400,
			body: '"uri did not answer 200"',
		});
		const promise = hooks.create.call(hookContext(api, params, {}));
		await expect(promise).rejects.toThrow('NFE.io could not register the webhook');
		await promise.catch((error: { description: string }) =>
			expect(error.description).toContain('WEBHOOK_URL'),
		);
	});

	it('checkExists: no id, 404, up to date, changed and failures', async () => {
		expect(await hooks.checkExists.call(hookContext(new FakeApi(), params, {}))).toBe(false);

		const gone = stored(HOOK_ID);
		const notFound = new FakeApi().on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 404 });
		expect(await hooks.checkExists.call(hookContext(notFound, params, gone))).toBe(false);
		expect(gone).toEqual({ webhooks: {} });

		const current = new FakeApi().on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, {
			body: {
				webHook: { id: HOOK_ID, uri: URI, status: 'Active', filters: [...params.events].reverse() },
			},
		});
		expect(
			await hooks.checkExists.call(hookContext(current, params, stored(HOOK_ID), WEBHOOK_URL)),
		).toBe(true);

		for (const changed of [
			{ uri: 'https://old.example/webhook' },
			{ status: 'Inactive' },
			{ filters: ['service_invoice.pulled'] },
		]) {
			const api = new FakeApi()
				.on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, {
					body: { webHook: { uri: URI, status: 'Active', filters: params.events, ...changed } },
				})
				.on('DELETE', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 204 });
			const data = stored(HOOK_ID);
			expect(await hooks.checkExists.call(hookContext(api, params, data))).toBe(false);
			expect(api.callsTo('DELETE', /./)).toHaveLength(1);
			expect(data).toMatchObject({
				webhooks: {},
				retiredSecrets: { [URI]: { secret: TEST_SECRET } },
			});
		}

		const broken = new FakeApi().on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 500 });
		await expect(
			hooks.checkExists.call(hookContext(broken, params, stored(HOOK_ID))),
		).rejects.toBeInstanceOf(NodeApiError);
		await expect(
			hooks.checkExists.call(hookContext(new FakeApi(), params, stored('../x'))),
		).rejects.toThrow('webhook ID is not valid');
		const odd: IDataObject = { webhooks: [] };
		expect(await hooks.checkExists.call(hookContext(new FakeApi(), params, odd))).toBe(false);
		expect(odd).toEqual({ webhooks: {} });
	});

	it('checkExists removes webhooks of an older n8n URL', async () => {
		const oldUri = 'https://old.example.com/webhook/abc/webhook?source=n8n-nodes-nfe';
		const oldId = 'webhookold000000000000001';
		const api = new FakeApi()
			.on('DELETE', `${WEBHOOKS_BASE}/${oldId}`, { statusCode: 204 })
			.on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, {
				body: { webHook: { uri: URI, status: 'Active', filters: params.events } },
			});
		const data: IDataObject = {
			webhooks: {
				...(stored(oldId, oldUri).webhooks as IDataObject),
				[URI]: { webhookId: HOOK_ID },
			},
		};
		expect(await hooks.checkExists.call(hookContext(api, params, data))).toBe(true);
		expect(api.callsTo('DELETE', /./).map((call) => call.options.url)).toEqual([
			`${WEBHOOKS_BASE}/${oldId}`,
		]);
		expect(Object.keys(data.webhooks as IDataObject)).toEqual([URI]);
	});

	it('delete: only the stored id, 404 is fine, other failures surface', async () => {
		expect(await hooks.delete.call(hookContext(new FakeApi(), params, {}))).toBe(true);
		for (const statusCode of [200, 204, 404]) {
			const api = new FakeApi().on('DELETE', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode });
			const data = stored(HOOK_ID);
			expect(await hooks.delete.call(hookContext(api, params, data))).toBe(true);
			expect(data).toMatchObject({
				webhooks: {},
				retiredSecrets: { [URI]: { secret: TEST_SECRET } },
			});
			expect(api.calls).toHaveLength(1);
		}
		const failing = new FakeApi().on('DELETE', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 500 });
		const data = stored(HOOK_ID);
		await expect(hooks.delete.call(hookContext(failing, params, data))).rejects.toBeInstanceOf(
			NodeApiError,
		);
		expect(data).toEqual(stored(HOOK_ID));
	});

	it('reads the account list only to create, and never removes webhooks of other URIs', async () => {
		const api = accountApi([
			{ id: 'webhookthirdparty0000001', uri: 'https://erp.example.com/hooks/nfe' },
			{ id: 'webhookothernode00000001', uri: URI.replace('/abc/', '/xyz/') },
			{ id: 'webhooknomarker000000001', uri: WEBHOOK_URL },
		])
			.on('POST', WEBHOOKS_BASE, created())
			.on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, {
				body: { webHook: { uri: URI, filters: params.events } },
			})
			.on('DELETE', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 204 });
		const data: IDataObject = {};
		await hooks.create.call(hookContext(api, params, data));
		await hooks.checkExists.call(hookContext(api, params, data));
		await hooks.delete.call(hookContext(api, params, data));
		expect(api.callsToUrl('GET', WEBHOOKS_BASE)).toHaveLength(1);
		expect(api.callsTo('DELETE', /./).map((call) => call.options.url)).toEqual([
			`${WEBHOOKS_BASE}/${HOOK_ID}`,
		]);
	});
});

// Order of calls and arguments taken from n8n 2.43.7 (`test-webhooks.js`, `webhook.service.js`):
// the listen runs checkExists/create with mode "manual" on a static data of its own, the event
// reaches webhook() with that static data and the production URL, and the end of the listen
// (first event, timeout or stop) calls delete with mode "internal" and the test URL.
describe('webhook lifecycle as n8n runs it', () => {
	const params = { events: ['service_invoice.issued_successfully'] };
	const TEST_URL = 'https://n8n.example.com/webhook-test/abc/webhook';
	const TEST_URI = `${TEST_URL}?source=n8n-nodes-nfe`;

	function account(id: string, uri: string, list: IDataObject[] = []) {
		return accountApi(list)
			.on('POST', WEBHOOKS_BASE, (options) => ({
				statusCode: 201,
				body: {
					webHook: {
						id,
						uri,
						filters: ((options.body as IDataObject).webHook as IDataObject).filters,
					},
				},
			}))
			.on('DELETE', `${WEBHOOKS_BASE}/${id}`, { statusCode: 204 });
	}

	it('removes the webhook of a test listen when n8n ends it (mode internal)', async () => {
		const api = account(HOOK_ID, TEST_URI);
		const listen: IDataObject = {};
		expect(await hooks.checkExists.call(hookContext(api, params, listen, TEST_URL, 'manual'))).toBe(
			false,
		);
		await hooks.create.call(hookContext(api, params, listen, TEST_URL, 'manual'));
		const post = api.calls.find((call) => call.options.method === 'POST');
		const secret = ((post?.options.body as IDataObject).webHook as IDataObject).secret as string;

		const rawBody = JSON.stringify(DELIVERIES.serviceInvoiceIssued.body);
		const event = webhookContext(
			{
				rawBody,
				headers: { 'x-hub-signature': sign(rawBody, secret), 'x-hook-event': 'service_invoice' },
			},
			params,
			listen,
			'manual',
			WEBHOOK_URL,
		);
		expect((await trigger.webhook.call(event.context)).workflowData).toBeDefined();

		for (const mode of ['internal', 'manual']) {
			const data = structuredClone(listen);
			const end = account(HOOK_ID, TEST_URI);
			expect(await hooks.delete.call(hookContext(end, params, data, TEST_URL, mode))).toBe(true);
			expect(end.callsTo('DELETE', new RegExp(`/${HOOK_ID}$`))).toHaveLength(1);
		}
	});

	it('activates and deactivates the production webhook in any mode', async () => {
		for (const [activation, deactivation] of [
			['trigger', 'internal'],
			['init', 'internal'],
			['manual', 'trigger'],
		]) {
			const api = account(HOOK_ID, URI);
			const workflow: IDataObject = {};
			await hooks.create.call(hookContext(api, params, workflow, WEBHOOK_URL, activation));
			await hooks.delete.call(hookContext(api, params, workflow, WEBHOOK_URL, deactivation));
			expect(api.callsTo('DELETE', new RegExp(`/${HOOK_ID}$`))).toHaveLength(1);
		}
	});

	// "Listen for test event" clicked again while listening: n8n 2.43.7 replaces the registration
	// with an empty static data and never calls delete for the first listen.
	it('removes the webhook of a listen started again without stopping the previous one', async () => {
		const firstId = 'webhooklisten000000000001';
		const secondId = 'webhooklisten000000000002';
		const others = [
			{ id: 'webhookthirdparty0000001', uri: 'https://erp.example.com/hooks/nfe' },
			{ id: 'webhookproduction0000001', uri: URI },
			{ id: 'webhookothernode00000001', uri: TEST_URI.replace('/abc/', '/xyz/') },
			{ id: 'webhookprefix00000000001', uri: `${TEST_URI}&copy=1` },
			{ id: 'webhookcase0000000000001', uri: TEST_URI.toUpperCase() },
		];
		const api = account(secondId, TEST_URI, [...others, { id: firstId, uri: TEST_URI }]).on(
			'DELETE',
			`${WEBHOOKS_BASE}/${firstId}`,
			{ statusCode: 204 },
		);

		const listen: IDataObject = {};
		expect(await hooks.checkExists.call(hookContext(api, params, listen, TEST_URL, 'manual'))).toBe(
			false,
		);
		await hooks.create.call(hookContext(api, params, listen, TEST_URL, 'manual'));
		expect(api.callsTo('DELETE', /./).map((call) => call.options.url)).toEqual([
			`${WEBHOOKS_BASE}/${firstId}`,
		]);
		const post = api.calls.findIndex((call) => call.options.method === 'POST');
		const removal = api.calls.findIndex((call) => call.options.method === 'DELETE');
		expect(removal).toBeLessThan(post);
		expect(listen).toMatchObject({ webhooks: { [TEST_URI]: { webhookId: secondId } } });

		await hooks.delete.call(hookContext(api, params, listen, TEST_URL, 'internal'));
		expect(api.callsTo('DELETE', /./).map((call) => call.options.url)).toEqual([
			`${WEBHOOKS_BASE}/${firstId}`,
			`${WEBHOOKS_BASE}/${secondId}`,
		]);
	});

	it('does not register when the account list cannot be read', async () => {
		const api = new FakeApi()
			.on('GET', WEBHOOKS_BASE, { statusCode: 401 })
			.on('POST', WEBHOOKS_BASE, { statusCode: 201, body: { webHook: { id: HOOK_ID } } });
		await expect(
			hooks.create.call(hookContext(api, params, {}, TEST_URL, 'manual')),
		).rejects.toBeInstanceOf(NodeApiError);
		expect(api.calls.some((call) => call.options.method === 'POST')).toBe(false);
	});

	it('never touches the production webhook from a test listen', async () => {
		const production = account(HOOK_ID, URI);
		const workflow: IDataObject = {};
		await hooks.create.call(hookContext(production, params, workflow, WEBHOOK_URL, 'trigger'));

		const testId = 'webhooktest00000000000001';
		const api = account(testId, TEST_URI);
		const listen: IDataObject = {};
		await hooks.checkExists.call(hookContext(api, params, listen, TEST_URL, 'manual'));
		await hooks.create.call(hookContext(api, params, listen, TEST_URL, 'manual'));
		await hooks.delete.call(hookContext(api, params, listen, TEST_URL, 'internal'));
		expect(api.calls.some((call) => call.options.url.endsWith(HOOK_ID))).toBe(false);
		expect(api.callsTo('DELETE', new RegExp(`/${testId}$`))).toHaveLength(1);
		expect(production.callsTo('DELETE', /./)).toHaveLength(0);
	});
});

// NFE.io delivers from a cached copy of the account webhook list: right after the trigger replaces
// its webhook, events still arrive signed with the secret of the removed one.
describe('previous webhook secret', () => {
	const params = { events: [ALL_EVENTS] };
	const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
	const MINUTE = 60 * 1000;
	const rawBody = JSON.stringify(DELIVERIES.serviceInvoiceIssued.body);

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
	});
	afterEach(() => vi.useRealTimers());

	/** Account where every POST creates a webhook with the next id; DELETE always succeeds. */
	function account() {
		let created = 0;
		return accountApi()
			.on('POST', WEBHOOKS_BASE, (options) => ({
				statusCode: 201,
				body: {
					webHook: {
						id: `webhook${String(++created).padStart(18, '0')}`,
						uri: ((options.body as IDataObject).webHook as IDataObject).uri,
						filters: ((options.body as IDataObject).webHook as IDataObject).filters,
					},
				},
			}))
			.on('DELETE', /./, { statusCode: 204 });
	}

	function sentSecrets(api: FakeApi): string[] {
		return api
			.callsToUrl('POST', WEBHOOKS_BASE)
			.map((call) => ((call.options.body as IDataObject).webHook as IDataObject).secret as string);
	}

	/** Publish, unpublish and publish again: returns the old and the new secret. */
	async function republish(data: IDataObject, url = WEBHOOK_URL) {
		const api = account();
		await hooks.create.call(hookContext(api, params, data, url));
		await hooks.delete.call(hookContext(api, params, data, url, 'internal'));
		expect(await hooks.checkExists.call(hookContext(api, params, data, url))).toBe(false);
		await hooks.create.call(hookContext(api, params, data, url));
		const [previous, current] = sentSecrets(api);
		return { api, previous, current };
	}

	async function deliverSigned(data: IDataObject, secret: string, url = WEBHOOK_URL) {
		const { context, status, json } = webhookContext(
			{
				rawBody,
				headers: { 'x-hub-signature': sign(rawBody, secret), 'x-hook-event': 'service_invoice' },
			},
			params,
			data,
			'webhook',
			url,
		);
		return { result: await trigger.webhook.call(context), status, json };
	}

	it('keeps the removed secret with its URI and accepts it for 5 minutes', async () => {
		const data: IDataObject = {};
		const { previous, current } = await republish(data);
		expect(previous).not.toBe(current);
		expect(data.retiredSecrets).toEqual({ [URI]: { secret: previous, retiredAt: T0 } });

		vi.setSystemTime(T0 + 5 * MINUTE - 1);
		expect((await deliverSigned(data, previous)).result.workflowData).toBeDefined();
		expect((await deliverSigned(data, current)).result.workflowData).toBeDefined();
	});

	it('refuses the previous secret after 5 minutes', async () => {
		const data: IDataObject = {};
		const { previous, current } = await republish(data);
		vi.setSystemTime(T0 + 5 * MINUTE);
		const { result, status } = await deliverSigned(data, previous);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(401);
		expect((await deliverSigned(data, current)).result.workflowData).toBeDefined();
		// A clock moved back does not stretch the window either.
		vi.setSystemTime(T0 - 1);
		expect((await deliverSigned(data, previous)).status).toHaveBeenCalledWith(401);
	});

	it('refuses the previous secret on another URI', async () => {
		const data: IDataObject = {};
		const { previous } = await republish(data);
		const otherUrl = 'https://other.example.com/webhook/abc/webhook';
		expect((await deliverSigned(data, previous, otherUrl)).status).toHaveBeenCalledWith(401);

		// Retired under an older n8n URL: not valid on the current one.
		const moved: IDataObject = {
			...stored(HOOK_ID),
			retiredSecrets: { [`${otherUrl}?source=n8n-nodes-nfe`]: { secret: previous, retiredAt: T0 } },
		};
		expect((await deliverSigned(moved, previous)).status).toHaveBeenCalledWith(401);
	});

	it('answers 401 when neither the current nor the previous secret signed it', async () => {
		const data: IDataObject = {};
		await republish(data);
		const { result, status, json } = await deliverSigned(data, generateSecret());
		expect(result).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(401);
		expect(json).toHaveBeenCalledWith({ message: 'Invalid signature' });
		const unsigned = webhookContext({ rawBody }, params, data);
		await trigger.webhook.call(unsigned.context);
		expect(unsigned.status).toHaveBeenCalledWith(401);
	});

	it('keeps one previous secret per URI: a newer replacement drops the older one', async () => {
		const data: IDataObject = {};
		const { api, previous, current } = await republish(data);
		vi.setSystemTime(T0 + MINUTE);
		// Events changed: checkExists replaces the webhook, so `current` leaves use too.
		const changed = { events: ['service_invoice.issued_successfully'] };
		const replaced = new FakeApi()
			.on('GET', /\/webhook0+2$/, {
				body: { webHook: { uri: URI, status: 'Active', filters: params.events } },
			})
			.on('DELETE', /./, { statusCode: 204 });
		expect(await hooks.checkExists.call(hookContext(replaced, changed, data))).toBe(false);
		await hooks.create.call(hookContext(api, changed, data));
		const newest = sentSecrets(api)[2];

		expect(data.retiredSecrets).toEqual({ [URI]: { secret: current, retiredAt: T0 + MINUTE } });
		expect((await deliverSigned(data, previous)).status).toHaveBeenCalledWith(401);
		expect((await deliverSigned(data, current)).result.workflowData).toBeDefined();
		expect((await deliverSigned(data, newest)).result.workflowData).toBeDefined();
	});

	it('does not keep the secret of a webhook removed outside n8n', async () => {
		const data = stored(HOOK_ID);
		const gone = new FakeApi().on('GET', `${WEBHOOKS_BASE}/${HOOK_ID}`, { statusCode: 404 });
		expect(await hooks.checkExists.call(hookContext(gone, params, data))).toBe(false);
		expect(data).toEqual({ webhooks: {} });
	});

	it('removes an expired previous secret at the next webhook change, not on delivery', async () => {
		const data: IDataObject = {};
		const { api } = await republish(data);
		vi.setSystemTime(T0 + 6 * MINUTE);
		// Delivery: refused, and the static data is left as it was. n8n saves the whole static data
		// after the delivery, which could overwrite a webhook change made at the same moment.
		const before = structuredClone(data);
		await deliverSigned(data, generateSecret());
		expect(data).toEqual(before);

		const current = api.calls.filter((call) => call.options.method === 'POST').length;
		expect(current).toBe(2);
		const check = new FakeApi().on('GET', /\/webhook0+2$/, {
			body: { webHook: { uri: URI, status: 'Active', filters: params.events } },
		});
		expect(await hooks.checkExists.call(hookContext(check, params, data))).toBe(true);
		expect(data).not.toHaveProperty('retiredSecrets');

		// Malformed entries are dropped too.
		const odd: IDataObject = {
			...stored(HOOK_ID),
			retiredSecrets: { [URI]: { secret: 42 }, other: 'x' },
		};
		await hooks.delete.call(hookContext(account(), params, odd));
		expect(odd.retiredSecrets).toEqual({
			[URI]: { secret: TEST_SECRET, retiredAt: T0 + 6 * MINUTE },
		});
		const list: IDataObject = { retiredSecrets: [] };
		await hooks.delete.call(hookContext(account(), params, list));
		expect(list).toEqual({ webhooks: {} });
	});

	it('never puts a secret in the output or in the 401 answer', async () => {
		const data: IDataObject = {};
		const { previous, current } = await republish(data);
		const accepted = await deliverSigned(data, previous);
		const output = JSON.stringify(accepted.result);
		expect(output).toContain('issued_successfully');
		for (const secret of [previous, current]) expect(output).not.toContain(secret);

		const refused = await deliverSigned(data, generateSecret());
		const answer = JSON.stringify([refused.result, refused.json.mock.calls]);
		for (const secret of [previous, current]) expect(answer).not.toContain(secret);
	});
});

describe('signature', () => {
	it('validates HMAC-SHA1 over the raw body in any hex case', () => {
		const body = '{"action":"issued_successfully"}';
		const header = sign(body);
		expect(isValidSignature(Buffer.from(body), header, TEST_SECRET)).toBe(true);
		expect(isValidSignature(Buffer.from(body), header.toLowerCase(), TEST_SECRET)).toBe(true);
		expect(isValidSignature(Buffer.from(`${body} `), header, TEST_SECRET)).toBe(false);
		expect(isValidSignature(Buffer.from(body), header, 'other-secret')).toBe(false);
		expect(isValidSignature(Buffer.from(body), 'sha256=abc', TEST_SECRET)).toBe(false);
		expect(isValidSignature(Buffer.from(body), undefined, TEST_SECRET)).toBe(false);
		expect(isValidSignature(Buffer.from(body), header, '')).toBe(false);
		expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/);
	});

	// Real deliveries captured by the NFE.io Node SDK. Kept out of this public repository (they hold
	// a sandbox webhook id); this test runs when the SDK checkout sits next to this repository.
	it.runIf(sdkVectors.length > 0)('accepts the real vectors captured by the SDK', () => {
		for (const vector of sdkVectors) {
			const raw = Buffer.from(vector.body, 'utf8');
			expect(isValidSignature(raw, vector.header_value, vector.secret)).toBe(true);
			expect(isValidSignature(raw, vector.header_value.toLowerCase(), vector.secret)).toBe(true);
			expect(
				isValidSignature(
					Buffer.concat([raw, Buffer.from(' ')]),
					vector.header_value,
					vector.secret,
				),
			).toBe(false);
		}
	});
});

describe('webhook delivery', () => {
	const staticData = stored(HOOK_ID);

	async function deliver(
		delivery: { hookEvent?: string; body: IDataObject },
		params: IDataObject = { events: [ALL_EVENTS] },
		headers: IDataObject = {},
	) {
		const rawBody = JSON.stringify(delivery.body);
		const request = {
			rawBody,
			headers: {
				'x-hub-signature': sign(rawBody),
				'x-hook-id': 'delivery-1',
				...(delivery.hookEvent ? { 'x-hook-event': delivery.hookEvent } : {}),
				...headers,
			},
		};
		const { context, status } = webhookContext(request, params, staticData);
		return { result: await trigger.webhook.call(context), status };
	}

	it('answers the creation check with the echo value and does not run', async () => {
		const { context } = webhookContext(
			{ query: { echo: '0123456789abcdef0123456789abcdef' } },
			{ events: [] },
			{},
		);
		expect(await trigger.webhook.call(context)).toEqual({
			webhookResponse: '0123456789abcdef0123456789abcdef',
		});
		const odd = webhookContext({ rawBody: '', query: { echo: '<script>' } }, { events: [] }, {});
		expect(await trigger.webhook.call(odd.context)).toEqual({ webhookResponse: 'ok' });
	});

	it('answers 401 and does not run on missing or forged signatures', async () => {
		for (const headers of [
			{ 'x-hub-signature': 'sha1=' + '0'.repeat(40) },
			{ 'x-hub-signature': undefined },
		]) {
			const { result, status } = await deliver(DELIVERIES.serviceInvoiceIssued, undefined, headers);
			expect(result).toEqual({ noWebhookResponse: true });
			expect(status).toHaveBeenCalledWith(401);
		}
		const body = JSON.stringify(DELIVERIES.serviceInvoiceIssued.body);
		const withoutSecret = webhookContext(
			{ rawBody: body, headers: { 'x-hub-signature': sign(body) } },
			{ events: [ALL_EVENTS] },
			{},
		);
		expect(await trigger.webhook.call(withoutSecret.context)).toEqual({ noWebhookResponse: true });
		// A signed delivery without an action is authentic but carries no event: 200, no run.
		const noRaw = webhookContext(
			{ headers: { 'x-hub-signature': sign('') } },
			{ events: [ALL_EVENTS] },
			staticData,
		);
		expect(await trigger.webhook.call(noRaw.context)).toEqual({
			webhookResponse: { received: true },
		});
	});

	it('emits a service invoice event with the company and the invoice', async () => {
		const { result } = await deliver(DELIVERIES.serviceInvoiceIssued, {
			events: ['service_invoice.issued_successfully'],
		});
		const item = result.workflowData?.[0][0].json as IDataObject;
		expect(item).toMatchObject({
			event: 'service_invoice.issued_successfully',
			resource: 'service_invoice',
			action: 'issued_successfully',
			companyId: COMPANY_ID,
			deliveryId: 'delivery-1',
		});
		expect((item.payload as IDataObject).flowStatus).toBe('Issued');
	});

	it('ignores events outside the selection with 200', async () => {
		const { result } = await deliver(DELIVERIES.serviceInvoiceCancelled, {
			events: ['service_invoice.issued_successfully'],
		});
		expect(result).toEqual({ webhookResponse: { received: true } });
	});

	it('ignores manual pings even when signed', async () => {
		const { result } = await deliver({
			hookEvent: undefined,
			body: { action: 'ping', webHook: { id: HOOK_ID } },
		});
		expect(result).toEqual({ webhookResponse: { received: true } });
	});

	it('handles flat events of other families (synthetic fixtures)', async () => {
		const cases: Array<[string, string, string | null]> = [
			['productInvoiceIssued', 'product_invoice.issued_successfully', 'company-nfe-1'],
			['productInvoiceInbound', 'product_invoice_inbound.issued_successfully', 'company-inbound-1'],
			['taxPaymentFormCreated', 'tax_payment_form.created_successfully', 'company-guide-1'],
			['productTaxCreated', 'product_tax.created_successfully', null],
		];
		for (const [name, event, companyId] of cases) {
			const { result } = await deliver(DELIVERIES[name], { events: [event] });
			const item = result.workflowData?.[0][0].json as IDataObject;
			expect(item.event).toBe(event);
			expect(item.companyId).toBe(companyId);
			expect(item.payload).not.toHaveProperty('action');
		}
	});

	it('matches the taxpayer event with ":" and returns the exact API id', async () => {
		const { result } = await deliver(DELIVERIES.taxpayerUpdated, {
			events: ['legal_entity_taxpayer:updated_sucessfully'],
		});
		const item = result.workflowData?.[0][0].json as IDataObject;
		expect(item.event).toBe('legal_entity_taxpayer:updated_sucessfully');
		expect(item.companyId).toBeNull();
		const all = await deliver(DELIVERIES.taxpayerUpdated);
		expect((all.result.workflowData?.[0][0].json as IDataObject).event).toBe(
			'legal_entity_taxpayer:updated_sucessfully',
		);
	});

	it('filters by company and lets events without a company through', async () => {
		const other = {
			events: [ALL_EVENTS],
			companyId: { __rl: true, mode: 'list', value: 'another-company' },
		};
		expect((await deliver(DELIVERIES.serviceInvoiceIssued, other)).result).toEqual({
			webhookResponse: { received: true },
		});
		const mine = { events: [ALL_EVENTS], companyId: { __rl: true, mode: 'id', value: COMPANY_ID } };
		expect(
			(await deliver(DELIVERIES.serviceInvoiceIssued, mine)).result.workflowData,
		).toBeDefined();
		const noCompany = await deliver(DELIVERIES.productTaxCreated, other);
		expect((noCompany.result.workflowData?.[0][0].json as IDataObject).companyId).toBeNull();
	});

	it('parses unusual bodies without losing the event', () => {
		const wrapped = parseDelivery(
			{ 'x-hook-event': ['service_invoice_inbound'] },
			{ body: { action: 'issued_successfully', companyId: 7, document: {} } },
			[],
		);
		expect(wrapped).toMatchObject({
			event: 'service_invoice_inbound.issued_successfully',
			companyId: '7',
			deliveryId: null,
		});
		const noHeader = parseDelivery({}, { action: 'issued_successfully' }, []);
		expect(noHeader).toMatchObject({ event: 'issued_successfully', resource: null, payload: {} });
		const notObject = parseDelivery({ 'x-hook-event': 'x' }, 'text', []);
		expect(notObject).toMatchObject({ event: 'x', action: null, companyId: null });
		expect(resolveCompanyId({ provider: { id: 12 } })).toBe('12');
		expect(resolveCompanyId({ provider: 'x', companyId: { nested: true } })).toBeNull();
		expect(matchesSelection('A.B', ['a:b'])).toBe(true);
		expect(matchesSelection('a.c', ['a.b'])).toBe(false);
	});

	it('is a trigger without inputs and not usable as a tool', () => {
		expect(trigger.description.inputs).toEqual([]);
		expect(trigger.description.usableAsTool).toBeUndefined();
		expect(trigger.description.name).toBe('nfeTrigger');
	});
});
