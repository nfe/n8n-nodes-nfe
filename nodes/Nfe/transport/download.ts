import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import type { FailureHint } from './errors';
import { publicGet } from './public';
import { apiRequest, type NfeContext } from './request';

export interface DownloadedDocument {
	data: Buffer;
	fileName?: string;
	contentType?: string;
}

export interface DownloadOptions {
	itemIndex: number;
	/** New attempts after a 404 (the PDF is rendered a few seconds after authorization). */
	notFoundRetries?: number;
	notFoundDelayMs?: number;
	hints?: Record<number, FailureHint>;
}

function header(headers: IDataObject, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0] === undefined ? undefined : String(value[0]);
	return value === undefined || value === null ? undefined : String(value);
}

/** Reads the file name from a Content-Disposition header (RFC 6266, with UTF-8 support). */
export function fileNameFromDisposition(disposition: string | undefined): string | undefined {
	if (!disposition) return undefined;
	const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
	let name: string | undefined;
	if (extended) {
		try {
			name = decodeURIComponent(extended[1].trim());
		} catch {
			name = extended[1].trim();
		}
	} else {
		const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(disposition);
		name = plain ? (plain[2] ?? plain[1]).trim() : undefined;
	}
	if (!name) return undefined;
	const safe = Array.from(name)
		.map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char))
		.join('')
		.replace(/^\.+/, '');
	return safe || undefined;
}

function toBuffer(body: unknown): Buffer {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	if (typeof body === 'string') return Buffer.from(body, 'utf8');
	return Buffer.alloc(0);
}

/**
 * Downloads a document. The API answers with a 302 to a pre-signed URL on another host:
 * the second request goes without the API key and the URL never reaches logs, errors or output.
 */
export async function downloadDocument(
	ctx: NfeContext,
	url: string,
	options: DownloadOptions,
): Promise<DownloadedDocument> {
	const node = ctx.getNode();
	const retries = options.notFoundRetries ?? 0;
	const delay = options.notFoundDelayMs ?? 2000;

	for (let attempt = 0; ; attempt++) {
		const allowStatus = attempt < retries ? [404] : [];
		const response = await apiRequest(
			ctx,
			{ method: 'GET', url, binary: true },
			{ itemIndex: options.itemIndex, allowStatus, hints: options.hints },
		);

		if (response.statusCode === 404) {
			await sleep(delay);
			continue;
		}

		if (response.statusCode >= 300 && response.statusCode < 400) {
			const location = header(response.headers, 'location');
			if (!location) {
				throw new NodeOperationError(node, 'NFE.io did not send the document link', {
					description: 'Try again in a few seconds.',
					itemIndex: options.itemIndex,
				});
			}
			let target: URL | undefined;
			try {
				target = new URL(location, url);
			} catch {
				target = undefined;
			}
			if (target?.protocol !== 'https:') {
				throw new NodeOperationError(node, 'The document link sent by NFE.io is not secure', {
					description:
						'The node only downloads documents over HTTPS. Contact NFE.io support if this keeps happening.',
					itemIndex: options.itemIndex,
				});
			}
			const file = await publicGet(ctx, target.toString(), {
				itemIndex: options.itemIndex,
				binary: true,
				timeout: 30_000,
				label: 'document storage',
				hints: {
					403: {
						message: 'The document link expired before the download',
						hint: 'Run the node again to get a new link.',
					},
					404: {
						message: 'The document is not in storage yet',
						hint: 'Try again in a few seconds.',
					},
				},
			});
			return {
				data: toBuffer(file.body),
				fileName: fileNameFromDisposition(header(file.headers, 'content-disposition')),
				contentType: header(file.headers, 'content-type'),
			};
		}

		return {
			data: toBuffer(response.body),
			fileName: fileNameFromDisposition(header(response.headers, 'content-disposition')),
			contentType: header(response.headers, 'content-type'),
		};
	}
}
