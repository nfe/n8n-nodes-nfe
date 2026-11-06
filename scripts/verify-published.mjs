#!/usr/bin/env node
// Runs the official n8n community package scanner on a published version, the same check the
// n8n verification runs: npm provenance, lint of the source commit recorded in the provenance
// and lint of the npm tarball. Exits with 1 when the package does not pass.
//
//   node scripts/verify-published.mjs n8n-nodes-nfe@0.2.0
//   node scripts/verify-published.mjs --tarball n8n-nodes-nfe-0.2.0.tgz
//
// The scanner CLI (`npx @n8n/scan-community-package`) prints the verdict but exits with 0 even
// when the package fails, so this script calls `analyzePackageByName` and decides the exit code
// itself. A new version can take a moment to show up in the registry (metadata, provenance,
// tarball): failures without lint findings are retried, lint findings fail at once.
//
// `--tarball` is a local rehearsal before publishing: it skips the registry and provenance steps
// and lints the working tree as the source and the given `npm pack` tarball as the package.
//
// The scanner version is pinned in tools/scanner.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ATTEMPTS = 5;
const WAIT_SECONDS = 30;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannerDir = path.join(root, 'tools', 'scanner');
const scannerModule = path.join(
	scannerDir,
	'node_modules',
	'@n8n',
	'scan-community-package',
	'scanner',
	'scanner.mjs',
);

function usage() {
	console.log('Usage: node scripts/verify-published.mjs <package>@<version>');
	console.log('       node scripts/verify-published.mjs --tarball <file.tgz>');
	process.exit(1);
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited with ${result.status}\n${result.stderr}`);
	}
	return result.stdout;
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

if (!fs.existsSync(scannerModule)) {
	console.log('Installing the pinned scanner in tools/scanner ...');
	run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], scannerDir);
}
const scanner = await import(pathToFileURL(scannerModule).href);

async function scanTarball(tarball) {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-nodes-nfe-verify-'));
	try {
		run('tar', ['-xzf', path.resolve(tarball), '-C', work, '--strip-components=1'], root);
		const manifest = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8'));
		const sourceResult = await scanner.analyzePackage(root, scanner.SOURCE_FILE_PATTERNS);
		const distResult = await scanner.analyzePackage(work, ['**/*.js', 'package.json']);
		return {
			packageName: manifest.name,
			version: manifest.version,
			passed: sourceResult.passed && distResult.passed,
			message: [sourceResult, distResult].find((r) => !r.passed)?.message,
			details: [sourceResult.details, distResult.details].filter(Boolean).join('\n') || undefined,
		};
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}

async function scanPublished(spec) {
	const { packageName, version } = scanner.resolvePackage(spec);
	if (!version) {
		console.log('Give an exact version, for example n8n-nodes-nfe@0.2.0');
		process.exit(1);
	}
	for (let attempt = 1; ; attempt++) {
		const result = await scanner.analyzePackageByName(packageName, version);
		if (result.passed || result.details || attempt === ATTEMPTS) return result;
		console.log(`Attempt ${attempt} of ${ATTEMPTS} did not pass: ${result.message}`);
		console.log(`Waiting ${WAIT_SECONDS} s for the registry before trying again`);
		await wait(WAIT_SECONDS * 1000);
	}
}

let result;
if (args[0] === '--tarball') {
	if (!args[1] || !fs.existsSync(args[1])) usage();
	result = await scanTarball(args[1]);
} else {
	result = await scanPublished(args[0]);
}

const label = `${result.packageName}@${result.version}`;
if (result.passed) {
	console.log(`✅ Package ${label} has passed all security checks`);
	process.exit(0);
}
console.log(`❌ Package ${label} has failed security checks`);
console.log(`Reason: ${result.message}`);
if (result.details) console.log(`\nDetails:\n${result.details}`);
process.exit(1);
