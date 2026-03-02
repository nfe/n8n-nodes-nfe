import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NfeApi implements ICredentialType {
	name = 'nfeApi';

	displayName = 'Nfe API';

	icon = { light: 'file:nfe.svg', dark: 'file:nfe.svg' } as const;

	// Link to your community node's README
	documentationUrl = 'https://github.com/org/-nfe?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.nfe.io',
			url: '/v1/companies',
		},
	};
}
