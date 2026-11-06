#!/usr/bin/env node
// Runs the same checks as the official n8n community package scanner
// (`npx @n8n/scan-community-package`) before publishing:
//   1. source leg:  package.json + {nodes,credentials}/**/*.{js,ts,json}
//   2. tarball leg: **/*.js + package.json of what `npm pack` publishes
// and fails when the published package.json has runtime dependencies.
// Requires a fresh `npm run build`. The scanner version is pinned in tools/scanner.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The scanner lives in its own folder with a lockfile: its TypeScript 6 dependency would
// otherwise replace the `tsc` binary used by `n8n-node build`.
const scannerDir = path.join(root, 'tools', 'scanner');
const scannerModule = path.join(
	scannerDir,
	'node_modules',
	'@n8n',
	'scan-community-package',
	'dist',
	'scanner.js',
);

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited with ${result.status}\n${result.stderr}`);
	}
	return result.stdout;
}

if (!fs.existsSync(scannerModule)) {
	console.log('Installing the pinned scanner in tools/scanner ...');
	run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], scannerDir);
}
const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(pathToFileURL(scannerModule).href);

function report(label, result) {
	const status = result.passed ? 'PASS' : 'FAIL';
	console.log(`${status}  ${label}${result.message ? ` - ${result.message}` : ''}`);
	if (result.details) console.log(result.details);
	return result.passed;
}

if (!fs.existsSync(path.join(root, 'dist'))) {
	console.log('FAIL  dist/ not found, run `npm run build` first');
	process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-nodes-nfe-scan-'));
let passed = true;
try {
	passed = report('source', await analyzePackage(root, SOURCE_FILE_PATTERNS)) && passed;

	const packDir = path.join(work, 'pack');
	const packageDir = path.join(work, 'package');
	fs.mkdirSync(packDir);
	fs.mkdirSync(packageDir);
	const tarball = run(
		'npm',
		['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir],
		root,
	)
		.trim()
		.split('\n')
		.pop();
	run('tar', ['-xzf', path.join(packDir, tarball), '-C', packageDir, '--strip-components=1'], work);

	const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
	const dependencies = Object.keys(manifest.dependencies ?? {});
	if (dependencies.length > 0) {
		console.log(`FAIL  runtime dependencies are not allowed: ${dependencies.join(', ')}`);
		passed = false;
	}
	passed =
		report(`tarball (${tarball})`, await analyzePackage(packageDir, ['**/*.js', 'package.json'])) &&
		passed;
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}

console.log(passed ? '\nScan: PASS' : '\nScan: FAIL');
process.exit(passed ? 0 : 1);
