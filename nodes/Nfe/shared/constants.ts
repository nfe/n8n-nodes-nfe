export const NFSE_V3_BASE = 'https://api.nfe.io/v3';
export const COMPANIES_V2_BASE = 'https://api.nfse.io/v2';
export const LEGAL_ENTITY_BASE = 'https://legalentity.api.nfe.io/v3';
export const ADDRESS_BASE = 'https://address.api.nfe.io/v2';
export const OPEN_API_BASE = 'https://open.nfe.io/v1';

export const PAGE_SIZE = 50;
export const COMPANY_PAGE_SIZE = 50;
/** Guard against endless pagination if the API ever repeats a page. */
export const MAX_PAGES = 2000;

export const BILLABLE_NOTICE =
	'Each run of this operation is a billable NFE.io lookup and needs the Data API Key in the credential.';

export const TAX_REFORM_TABLES_URL =
	'https://nfe.io/docs/documentacao/reforma-tributaria/conceitos-funcionais/tabelas-de-referencia/tabela-referencia-indicador-operacao/';
