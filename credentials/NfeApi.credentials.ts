import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

/** NFE.io services that only accept the Data API Key (CNPJ and postal code lookups). */
const DATA_API_HOSTS = ['legalentity.api.nfe.io', 'address.api.nfe.io'];

function requestHost(requestOptions: IHttpRequestOptions): string {
	try {
		return new URL(requestOptions.url, requestOptions.baseURL).hostname.toLowerCase();
	} catch {
		return '';
	}
}

export class NfeApi implements ICredentialType {
	name = 'nfeApi';

	displayName = 'NFE.io API';

	icon = { light: 'file:nfe.svg', dark: 'file:nfe.svg' } as const;

	documentationUrl = 'https://github.com/nfe/n8n-nodes-nfe?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Main key of the NFE.io account, used for service invoices, companies and webhooks',
		},
		{
			displayName: 'Data API Key',
			name: 'dataApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Key for the data services (CNPJ, state registration and postal code lookups). Only needed for the Lookup operations.',
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const useDataKey = DATA_API_HOSTS.includes(requestHost(requestOptions));
		const key = useDataKey ? credentials.dataApiKey : credentials.apiKey;
		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: typeof key === 'string' ? key : '',
			},
		};
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.nfse.io',
			url: '/v2/companies',
			qs: { limit: 1 },
		},
	};
}
