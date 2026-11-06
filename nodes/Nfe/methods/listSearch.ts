import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { COMPANIES_V2_BASE, COMPANY_PAGE_SIZE } from '../shared/constants';
import { apiRequestBody } from '../transport/request';

/** Pages read per search when the user types a filter (the API has no name search). */
const MAX_SEARCH_PAGES = 10;

export function formatTaxNumber(value: unknown): string {
	if (value === undefined || value === null || value === '') return '';
	const text = typeof value === 'number' ? String(value).padStart(14, '0') : String(value);
	if (/^[0-9A-Z]{12}\d{2}$/.test(text)) {
		return `${text.slice(0, 2)}.${text.slice(2, 5)}.${text.slice(5, 8)}/${text.slice(8, 12)}-${text.slice(12)}`;
	}
	return text;
}

function matches(company: IDataObject, filter: string): boolean {
	const needle = filter.toLowerCase();
	const digits = filter.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
	const taxNumber = formatTaxNumber(company.federalTaxNumber).replace(/[^0-9A-Z]/g, '');
	return (
		String(company.name ?? '')
			.toLowerCase()
			.includes(needle) ||
		String(company.tradeName ?? '')
			.toLowerCase()
			.includes(needle) ||
		(digits.length > 0 && taxNumber.includes(digits)) ||
		String(company.id ?? '') === filter.trim()
	);
}

function toItem(company: IDataObject): INodeListSearchItems {
	const tradeName = String(company.tradeName ?? '').trim();
	const taxNumber = formatTaxNumber(company.federalTaxNumber);
	const label = [String(company.name ?? company.id), tradeName ? `(${tradeName})` : '']
		.filter(Boolean)
		.join(' ');
	return {
		name: taxNumber ? `${label} - ${taxNumber}` : label,
		value: String(company.id),
	};
}

/** Companies of the account (Contribuintes v2, cursor pagination). */
export async function getCompanies(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const results: INodeListSearchItems[] = [];
	let cursor = paginationToken;
	let hasMore = true;
	const maxPages = filter ? MAX_SEARCH_PAGES : 1;

	for (let page = 0; page < maxPages && hasMore; page++) {
		const qs: IDataObject = { limit: COMPANY_PAGE_SIZE };
		if (cursor) qs.startingAfter = cursor;
		const body = await apiRequestBody<IDataObject>(this, {
			method: 'GET',
			url: `${COMPANIES_V2_BASE}/companies`,
			qs,
		});
		const companies = (body.companies as IDataObject[] | undefined) ?? [];
		hasMore = body.hasMore === true && companies.length > 0;
		if (companies.length > 0) cursor = String(companies[companies.length - 1].id);
		for (const company of companies) {
			if (!filter || matches(company, filter)) results.push(toItem(company));
		}
		if (filter && results.length >= COMPANY_PAGE_SIZE) break;
	}

	return { results, paginationToken: hasMore ? cursor : undefined };
}
