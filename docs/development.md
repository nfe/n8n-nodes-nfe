# Development

This guide covers building the package and running it inside a local n8n instance.

## Requirements

- Node.js 22 or later and npm
- Docker with the Compose plugin (for the local n8n instance)
- Optional: [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) to expose the local n8n to the internet when testing the trigger node

## Build and lint

```bash
npm ci
npm run lint    # n8n-node lint (strict mode, same rules as the n8n verification)
npm run build   # compiles to dist/
npm test        # unit tests (Vitest, no network) with the coverage thresholds
npm run scan    # the official scanner checks on the source and on the npm tarball (needs a build)
```

`npm run dev` (from `@n8n/node-cli`) also works: it starts the latest n8n with the package linked and rebuilds on change. The Docker setup below pins an exact n8n version instead.

## Local n8n in Docker

Keep the Compose file outside the repository (for example in a sibling folder), so local data and keys never end up in git. The package is mounted read-only as a custom extension, the same layout `n8n-node dev` uses (`<custom folder>/node_modules/<package name>`):

```yaml
# docker-compose.yml (in a folder next to this repository)
name: n8n-nodes-nfe-dev

services:
  n8n:
    image: n8nio/n8n:2.43.7
    ports:
      - '127.0.0.1:5678:5678'
    environment:
      - N8N_CUSTOM_EXTENSIONS=/opt/custom
      - N8N_SECURE_COOKIE=false
      - N8N_DIAGNOSTICS_ENABLED=false
      - GENERIC_TIMEZONE=America/Sao_Paulo
      # Public base URL used by the trigger node to register its webhook
      - WEBHOOK_URL=${WEBHOOK_URL:-http://localhost:5678/}
    volumes:
      - n8n_data:/home/node/.n8n
      - ../n8n-nodes-nfe/package.json:/opt/custom/node_modules/n8n-nodes-nfe/package.json:ro
      - ../n8n-nodes-nfe/dist:/opt/custom/node_modules/n8n-nodes-nfe/dist:ro

volumes:
  n8n_data:
```

| Task | Command |
|---|---|
| Start | `npm run build` in this repository, then `docker compose up -d` in the Compose folder. Open <http://127.0.0.1:5678> and create the owner account. |
| Reload the node after a code change | `npm run build`, then `docker compose up -d --force-recreate n8n` |
| Stop (keeps data) | `docker compose down` |
| Destroy (removes the n8n data volume) | `docker compose down -v` |

Nodes loaded from a custom extension folder get the `CUSTOM.` type prefix (for example `CUSTOM.nfe`). When the package is installed from npm, the prefix is the package name (`n8n-nodes-nfe.nfe`). Keep this in mind when importing workflow JSON between the two setups.

The image needs about 2 GB of disk; the data volume stays small.

### Driving n8n through its REST API

End-to-end tests create and run workflows through the [n8n public API](https://docs.n8n.io/api/). Create an API key in **Settings > n8n API** and send it in the `X-N8N-API-KEY` header. The public API has no "run workflow" endpoint, so tests start workflows with a Webhook trigger (production URL of an active workflow) and read the result from `GET /api/v1/executions/{id}?includeData=true`.

### Testing the trigger node

NFE.io delivers webhooks over the internet and checks the URL when the webhook is created, so the local n8n needs a public HTTPS URL:

```bash
cloudflared tunnel --url http://127.0.0.1:5678
# copy the https://<random>.trycloudflare.com URL, then restart n8n with it:
WEBHOOK_URL=https://<random>.trycloudflare.com/ docker compose up -d n8n
```

If you have a `~/.cloudflared/config.yml` for a named tunnel, pass `--config` with an empty file so the quick tunnel does not pick up its ingress rules. Close the tunnel when you are done and restart n8n without `WEBHOOK_URL`.

Use a test account or an API key whose webhooks you can manage: NFE.io webhooks belong to the whole account.

## Before a release

The n8n verification runs the [`@n8n/scan-community-package`](https://www.npmjs.com/package/@n8n/scan-community-package) scanner on the published version and on the source commit recorded in its npm provenance:

```bash
npx -y @n8n/scan-community-package n8n-nodes-nfe
```

Run the same checks locally before tagging a release:

```bash
npm run lint && npm run build && npm test && npm run scan
```

`npm run scan` (`scripts/scan.mjs`) loads the scanner's own `analyzePackage` function and runs it on the source files (`package.json`, `nodes/**`, `credentials/**`) and on the extracted `npm pack` tarball, and fails if the package declares runtime `dependencies`. The scanner version is pinned in `tools/scanner/` with its own lockfile, because it depends on TypeScript 6 and would otherwise replace the `tsc` binary used by the build.

## Tests

Unit tests live in `test/unit` and use fake n8n contexts (`test/helpers/context.ts`) with a table of fake NFE.io answers, so they never call the API. `npm test` enforces the coverage thresholds of `vitest.config.mts`. Fixtures in `test/fixtures` are redacted or synthetic; webhook events of document families other than service invoices are synthetic, built from the NFE.io event catalog.

Integration tests in `test/integration` call the real API and only run when you ask for them. They read keys from the environment and never print them:

```bash
NFE_LIVE=1 NFE_API_KEY=... NFE_DATA_API_KEY=... NFE_COMPANY_ID=... npm run test:integration
```

By default they only read. `NFE_LIVE_WRITE=1` also issues one service invoice in the given company and cancels it: use a test company. They never run in CI.

## Releasing

Releases are published by `.github/workflows/publish.yml` when a tag equal to the `package.json` version (for example `0.2.0`, without `v`) is pushed. The workflow runs lint, build, tests and the scan, publishes with npm provenance through Trusted Publishing (OIDC, no npm token), and then runs the official scanner on the published version.

That last step uses `scripts/verify-published.mjs`. The scanner CLI prints the verdict but exits with 0 even when the package fails, so the script calls the scanner's `analyzePackageByName` and exits with 1 on failure. It retries while the registry catches up with a new version and fails at once on lint findings. You can run it yourself:

```bash
node scripts/verify-published.mjs n8n-nodes-nfe@0.2.0
# rehearsal before publishing, on a local tarball (skips the registry and provenance steps)
npm pack --ignore-scripts && node scripts/verify-published.mjs --tarball n8n-nodes-nfe-0.2.0.tgz
```
