import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** 64 hex characters, inside the 32-64 range accepted by NFE.io. */
export function generateSecret(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Checks `X-Hub-Signature: sha1=<hex>` = HMAC-SHA1(secret, raw body). The hex digest is
 * compared in constant time, without case sensitivity (NFE.io sends it in upper case).
 */
export function isValidSignature(rawBody: Buffer, header: unknown, secret: string): boolean {
	if (!secret || typeof header !== 'string') return false;
	const match = /^sha1=([0-9a-fA-F]{40})$/.exec(header.trim());
	if (!match) return false;
	const expected = createHmac('sha1', secret).update(rawBody).digest();
	const received = Buffer.from(match[1], 'hex');
	return received.length === expected.length && timingSafeEqual(received, expected);
}
