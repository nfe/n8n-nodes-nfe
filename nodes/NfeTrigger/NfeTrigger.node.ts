import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getCompanies } from '../Nfe/methods/listSearch';
import { companyLocator } from '../Nfe/shared/company';
import { assertId } from '../Nfe/shared/validators';
import { publicGet } from '../Nfe/transport/public';
import { apiRequest } from '../Nfe/transport/request';
import { matchesSelection, parseDelivery } from './delivery';
import { ALL_EVENTS, FALLBACK_EVENT_TYPES, normalizeEventId, toEventOptions } from './events';
import { generateSecret, isValidSignature } from './signature';

export const WEBHOOKS_BASE = 'https://api.nfse.io/v2/webhooks';
export const EVENT_TYPES_URL = 'https://api.nfe.io/v2/webhooks/eventTypes';
/** Marks the webhooks created by this node in the account list. */
export const URI_MARKER = 'source=n8n-nodes-nfe';
/**
 * How long the secret of a webhook removed by this node still validates deliveries to the same
 * URI. NFE.io delivers from a cached copy of the account webhook list (seen valid for 24 to 100 s):
 * right after a replacement, events arrive signed with the removed webhook's secret.
 */
export const PREVIOUS_SECRET_TTL_MS = 5 * 60 * 1000;

interface WebhookEntry extends IDataObject {
	webhookId: string;
	secret: string;
}

interface RetiredSecret extends IDataObject {
	secret: string;
	/** Epoch milliseconds of the removal. */
	retiredAt: number;
}

interface TriggerStaticData extends IDataObject {
	/** Webhooks registered by this node, by the URI given to NFE.io. */
	webhooks?: Record<string, WebhookEntry>;
	/** Secret of the last webhook this node removed, by URI: at most one per URI. */
	retiredSecrets?: Record<string, RetiredSecret>;
}

function nodeStaticData(ctx: IHookFunctions | IWebhookFunctions): TriggerStaticData {
	return ctx.getWorkflowStaticData('node') as TriggerStaticData;
}

/**
 * Entries are keyed by the webhook URI, never by the n8n mode: n8n runs the hooks of a test listen
 * with mode "manual" but removes the listen with mode "internal", and the test and production
 * URLs differ. A test listen also gets a static data of its own, so it never sees the production
 * entry.
 */
function storedWebhooks(ctx: IHookFunctions): Record<string, WebhookEntry> {
	const staticData = nodeStaticData(ctx);
	const { webhooks } = staticData;
	if (!webhooks || typeof webhooks !== 'object' || Array.isArray(webhooks)) {
		staticData.webhooks = {};
	}
	return staticData.webhooks as Record<string, WebhookEntry>;
}

function isActiveRetired(entry: unknown, now: number): entry is RetiredSecret {
	if (!entry || typeof entry !== 'object') return false;
	const { secret, retiredAt } = entry as IDataObject;
	if (typeof secret !== 'string' || !secret || typeof retiredAt !== 'number') return false;
	const age = now - retiredAt;
	return age >= 0 && age < PREVIOUS_SECRET_TTL_MS;
}

/** Previous secrets still inside the window. */
function activeRetired(staticData: TriggerStaticData, now: number): Record<string, RetiredSecret> {
	const { retiredSecrets } = staticData;
	if (!retiredSecrets || typeof retiredSecrets !== 'object' || Array.isArray(retiredSecrets)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(retiredSecrets).filter(([, entry]) => isActiveRetired(entry, now)),
	) as Record<string, RetiredSecret>;
}

/**
 * Drops expired previous secrets. Runs only in checkExists, create and delete, never in webhook():
 * n8n writes the whole static data after a delivery, so a change made there could overwrite a
 * webhook change saved by an activation running at the same moment.
 */
function pruneRetired(ctx: IHookFunctions) {
	const staticData = nodeStaticData(ctx);
	if (staticData.retiredSecrets === undefined) return;
	const kept = activeRetired(staticData, Date.now());
	if (Object.keys(kept).length === 0) delete staticData.retiredSecrets;
	else if (Object.keys(kept).length !== Object.keys(staticData.retiredSecrets).length) {
		staticData.retiredSecrets = kept;
	}
}

/** Keeps the secret of a webhook this node removed, replacing the previous one of that URI. */
function retireSecret(ctx: IHookFunctions, uri: string, secret: unknown) {
	if (typeof secret !== 'string' || !secret) return;
	const staticData = nodeStaticData(ctx);
	const now = Date.now();
	// Assigned as a new object so n8n always marks the static data as changed.
	staticData.retiredSecrets = {
		...activeRetired(staticData, now),
		[uri]: { secret, retiredAt: now },
	};
}

function webhookUri(ctx: IHookFunctions | IWebhookFunctions): string {
	const url = ctx.getNodeWebhookUrl('default') as string;
	return `${url}${url.includes('?') ? '&' : '?'}${URI_MARKER}`;
}

function selectedFilters(ctx: IHookFunctions): string[] {
	const events = (ctx.getNodeParameter('events', []) as string[])
		.map((id) => id.trim())
		.filter(Boolean);
	if (events.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'No event is selected', {
			description: 'Choose at least one event in the Events field, or "All Events".',
		});
	}
	if (events.includes(ALL_EVENTS)) return [ALL_EVENTS];
	return [...new Set(events)];
}

function sameFilters(a: unknown, b: string[]): boolean {
	const left = new Set((Array.isArray(a) ? a : []).map((id) => normalizeEventId(String(id))));
	const right = new Set(b.map(normalizeEventId));
	return left.size === right.size && [...right].every((id) => left.has(id));
}

async function deleteWebhook(ctx: IHookFunctions, webhookId: unknown) {
	await apiRequest(
		ctx,
		{
			method: 'DELETE',
			url: `${WEBHOOKS_BASE}/${assertId(ctx.getNode(), webhookId, 'webhook ID')}`,
		},
		{ allowStatus: [404] },
	);
}

/**
 * Removes account webhooks whose URI is exactly the one this node registers. They were created by
 * this node but are no longer stored: n8n gives a test listen started again, without stopping the
 * previous one, an empty static data and never removes the first webhook. Their secret is lost, so
 * every delivery to them would be refused anyway.
 */
async function deleteSameUri(ctx: IHookFunctions, uri: string) {
	const response = await apiRequest(ctx, { method: 'GET', url: WEBHOOKS_BASE });
	const body = (response.body ?? {}) as IDataObject;
	const hooks = Array.isArray(body.webHooks) ? (body.webHooks as IDataObject[]) : [];
	for (const hook of hooks) {
		if (hook?.uri === uri) await deleteWebhook(ctx, hook.id);
	}
}

/**
 * Removes the stored webhooks (all created by this node), the current URI first, and keeps the
 * secret of each one as the previous secret of its URI.
 */
async function deleteStored(ctx: IHookFunctions, keep?: string) {
	const webhooks = storedWebhooks(ctx);
	const current = webhookUri(ctx);
	const uris = Object.keys(webhooks)
		.filter((uri) => uri !== keep)
		.sort((a, b) => Number(b === current) - Number(a === current));
	for (const uri of uris) {
		// 404 means it is already gone; any other failure is thrown and the entry is kept.
		if (webhooks[uri]?.webhookId) await deleteWebhook(ctx, webhooks[uri].webhookId);
		retireSecret(ctx, uri, webhooks[uri]?.secret);
		delete webhooks[uri];
	}
}

export class NfeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NFE.io Trigger',
		name: 'nfeTrigger',
		icon: { light: 'file:nfe.svg', dark: 'file:nfe.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when NFE.io sends a webhook event',
		defaults: { name: 'NFE.io Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'nfeApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'NFE.io webhooks belong to the whole account: this trigger registers one webhook while active (and one per test listen) and removes it when stopped. The n8n URL must be public and use HTTPS.',
				name: 'accountNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description:
					'Events that start the workflow. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getEvents' },
			},
			companyLocator(undefined, {
				required: false,
				description:
					'Only start for events of this company. Events without a company (for example product tax events) always start the workflow.',
			}),
		],
	};

	methods = {
		listSearch: { getCompanies },
		loadOptions: {
			/** Event types of the API, or the list shipped with the package when it cannot be reached. */
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const response = await publicGet(this, EVENT_TYPES_URL, { retries: 0 });
					const types =
						((response.body as IDataObject)?.eventTypes as IDataObject[] | undefined) ?? [];
					const options = toEventOptions(types);
					if (options.length > 1) return options;
				} catch {
					// Offline or API change: use the list shipped with the package.
				}
				return toEventOptions(FALLBACK_EVENT_TYPES);
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				pruneRetired(this);
				const uri = webhookUri(this);
				// Entries of another URI (the n8n URL changed) point nowhere: remove those webhooks.
				await deleteStored(this, uri);
				const webhooks = storedWebhooks(this);
				const entry = webhooks[uri];
				if (!entry?.webhookId) {
					delete webhooks[uri];
					return false;
				}
				const webhookId = assertId(this.getNode(), entry.webhookId, 'webhook ID');
				const response = await apiRequest(
					this,
					{ method: 'GET', url: `${WEBHOOKS_BASE}/${webhookId}` },
					{ allowStatus: [404] },
				);
				if (response.statusCode === 404) {
					delete webhooks[uri];
					return false;
				}
				const body = (response.body ?? {}) as IDataObject;
				const hook = ((body.webHook as IDataObject | undefined) ?? body) as IDataObject;
				const upToDate =
					hook.uri === uri &&
					String(hook.status ?? 'Active') === 'Active' &&
					sameFilters(hook.filters, selectedFilters(this));
				if (upToDate) return true;
				// Our webhook, but the URL, status or events changed: replace it.
				await deleteWebhook(this, webhookId);
				retireSecret(this, uri, entry.secret);
				delete webhooks[uri];
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				pruneRetired(this);
				const webhooks = storedWebhooks(this);
				const uri = webhookUri(this);
				const filters = selectedFilters(this);
				const secret = generateSecret();
				await deleteSameUri(this, uri);

				const response = await apiRequest(
					this,
					{
						method: 'POST',
						url: WEBHOOKS_BASE,
						body: {
							webHook: {
								uri,
								secret,
								contentType: 'json',
								status: 'Active',
								filters,
								insecureSsl: false,
							},
						},
					},
					{
						hints: {
							400: {
								message: 'NFE.io could not register the webhook',
								hint: 'NFE.io calls the webhook URL when it is created and needs an HTTP 200 answer. Make sure n8n is reachable from the internet over HTTPS (set WEBHOOK_URL on self-hosted n8n) and that the events are valid.',
							},
						},
					},
				);

				const body = (response.body ?? {}) as IDataObject;
				const hook = ((body.webHook as IDataObject | undefined) ?? body) as IDataObject;
				const webhookId = assertId(this.getNode(), hook.id, 'webhook ID');
				webhooks[uri] = { webhookId, secret };

				const returned = new Set(
					(Array.isArray(hook.filters) ? hook.filters : filters).map((id) =>
						normalizeEventId(String(id)),
					),
				);
				const dropped = filters.filter((id) => !returned.has(normalizeEventId(id)));
				if (dropped.length > 0) {
					await deleteWebhook(this, webhookId);
					delete webhooks[uri];
					throw new NodeOperationError(
						this.getNode(),
						'NFE.io did not accept some of the selected events',
						{
							description: `Not accepted: ${dropped.join(', ')}. The webhook was removed. Choose other events and activate again.`,
						},
					);
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				pruneRetired(this);
				await deleteStored(this);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const query = this.getQueryData() as IDataObject;
		const headers = this.getHeaderData() as IDataObject;
		const rawBody: Buffer = Buffer.isBuffer(request.rawBody) ? request.rawBody : Buffer.alloc(0);

		// Creation check from NFE.io: empty POST, no signature, `?echo=<value>`. Answer 200 and do
		// not run the workflow (a test listener would otherwise be consumed and the webhook removed).
		if (rawBody.length === 0 && query.echo !== undefined && !headers['x-hub-signature']) {
			const echo = String(query.echo);
			return { webhookResponse: /^[A-Za-z0-9_-]{1,128}$/.test(echo) ? echo : 'ok' };
		}

		// The static data here is the one of the listen (test) or of the active workflow. The URL
		// does not pick the entry: during a test listen n8n 2.43.7 answers the production URL here.
		const staticData = nodeStaticData(this);
		const stored = staticData.webhooks;
		const secrets = Object.values(stored && typeof stored === 'object' ? stored : {}).map((entry) =>
			String(entry?.secret ?? ''),
		);
		// Then the secret of the webhook this node replaced on this same URI, for 5 minutes. Read
		// only: the static data is not changed here (see pruneRetired). During a test listen the URI
		// resolves to the production one and the listen keeps no previous secret: nothing matches.
		const previous = activeRetired(staticData, Date.now())[webhookUri(this)]?.secret;
		if (previous) secrets.push(previous);
		const signature = headers['x-hub-signature'];
		if (!secrets.some((secret) => isValidSignature(rawBody, signature, secret))) {
			const response = this.getResponseObject();
			response.status(401).json({ message: 'Invalid signature' });
			return { noWebhookResponse: true };
		}

		const selected = this.getNodeParameter('events', []) as string[];
		const delivery = parseDelivery(headers, this.getBodyData(), selected);

		// Manual pings from NFE.io are signed but are not business events; nor is a body without action.
		if (!delivery.action || delivery.action === 'ping')
			return { webhookResponse: { received: true } };
		if (!matchesSelection(delivery.event, selected)) return { webhookResponse: { received: true } };

		const companyFilter = String(
			this.getNodeParameter('companyId', '', { extractValue: true }) ?? '',
		).trim();
		if (companyFilter && delivery.companyId && delivery.companyId !== companyFilter) {
			return { webhookResponse: { received: true } };
		}

		return {
			workflowData: [[{ json: { ...delivery } }]],
		};
	}
}
