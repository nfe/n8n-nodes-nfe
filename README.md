# n8n-nodes-nfe

[n8n](https://n8n.io/) community nodes for [NFE.io](https://nfe.io/): issue and manage Brazilian service invoices (NFS-e) with the tax reform fields (IBS/CBS), start workflows from NFE.io webhook events and look up CNPJ and postal codes (CEP).

| Node | What it does |
|---|---|
| **NFE.io** | Service invoices (issue, get, list, cancel, download PDF and XML, send by email), companies of your account, CNPJ, state registration, postal code and IBGE city code lookups. Can also be used as a tool by the n8n AI Agent. |
| **NFE.io Trigger** | Starts a workflow when NFE.io sends a webhook event, for example "service invoice issued". |

This is a community package maintained by NFE.io. It is not maintained by n8n GmbH.

- [Installation](#installation)
- [Credentials](#credentials)
- [NFE.io node](#nfeio-node)
- [NFE.io Trigger node](#nfeio-trigger-node)
- [Examples](#examples)
- [Limitations](#limitations)
- [Migrating from 0.1](#migrating-from-01)
- [Security](#security)

## Requirements

- An NFE.io account ([create one](https://nfe.io/docs/documentacao/nossa-plataforma/criar-conta/)) with at least one company. Issuing invoices also needs the company's digital certificate ([upload](https://nfe.io/docs/documentacao/nossa-plataforma/upload-do-certificado-digital/)).
- n8n with community nodes enabled. The package is tested with n8n 2.43.
- For the trigger: an n8n instance reachable from the internet over HTTPS.

## Installation

### From the n8n editor

1. Go to **Settings > Community Nodes** and select **Install**.
2. Enter `n8n-nodes-nfe`, accept the risk notice and select **Install**.

The **NFE.io** and **NFE.io Trigger** nodes then show up in the nodes panel. See the n8n guide: [Install community nodes from the GUI](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/).

### Self-hosted, manual installation

Use this for queue mode or when the editor installation is turned off:

```bash
# inside the n8n container or host, as the user that runs n8n
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-nfe
```

Restart n8n afterwards. With Docker, open a shell first with `docker exec -it <container> sh`. See [Manual installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation/). In queue mode, install the package on the main instance and on every worker.

The package has no runtime dependencies.

## Credentials

Create a credential of type **NFE.io API**. It has two fields:

| Field | Required | Used for |
|---|---|---|
| **API Key** | Yes | Service invoices, companies and webhooks (the "Nota Fiscal" key of your account) |
| **Data API Key** | Only for the billable lookups | CNPJ, state registration and postal code lookups (the "Dados" key of your account) |

Both keys are in the NFE.io account app: open your subscription and the **Chaves de acesso** tab ([how to find them](https://nfe.io/docs/documentacao/nossa-plataforma/chaves-de-autenticacao/)). The node sends the right key to each NFE.io service, so one credential covers every operation. The credential test lists one company of the account with the API Key.

The free IBGE city code lookup needs no key.

## NFE.io node

### Resources and operations

| Resource | Operation | Notes |
|---|---|---|
| Service Invoice | **Issue** | Issues an NFS-e. Waits for the city to authorize it by default. |
| | **Get** | By NFE.io invoice ID |
| | **Get by External ID** | By the ID you sent at issue time. Returns no item when nothing is found, or fails with **Fail If Not Found**. |
| | **Get Many** | All invoices of a company, page by page, with **Return All** or a **Limit**. Filters: accrual date (competência) and creation date. |
| | **Cancel** | Requests the cancellation and waits for it by default |
| | **Download PDF** | Binary file |
| | **Download XML** | Binary file |
| | **Download Cancellation XML** | Binary file with the cancellation event. Only for invoices of the national environment (Ambiente Nacional). |
| | **Send Email** | Sends the invoice to the borrower's email. Returns `{ "sent": true, "invoiceId": "..." }`. |
| Company | **Get**, **Get Many** | Companies of your NFE.io account |
| Lookup | **Get Company by CNPJ** | Registration data of a company. Numeric and alphanumeric CNPJ. **Billable.** |
| | **Get State Registration** | State registrations (inscrição estadual) of a CNPJ in a state. **Billable.** |
| | **Get Address by Postal Code** | Address of a CEP. **Billable.** |
| | **Get City Code by Postal Code** | IBGE city code and name of a CEP. Free, no key. |

The **Company** field lists the companies of your account (**From List**, searchable) or takes an ID (**By ID**, accepts expressions).

Service invoices use the NFE.io NFS-e API V3, which also handles companies with an alphanumeric CNPJ. CPF and CNPJ values are returned as strings, so leading zeros are kept.

### Output

Operations that return invoices or companies have an **Output** option:

- **Simplified** (default): the 10 main fields of an invoice (`id`, `externalId`, `number`, `status`, `flowStatus`, `flowMessage`, `issuedOn`, `servicesAmount`, `borrowerName`, `borrowerFederalTaxNumber`) or the main fields of a company.
- **Raw**: the full object sent by NFE.io.
- **Selected Fields**: a comma-separated list such as `number,status,borrower.name`.

Issue also adds `externalId`, `alreadyExisted` and, when it waited, `waitTimedOut` to the item, whatever the output mode.

### Issuing an invoice

Required fields: **Company**, **City Service Code** (the service code of the company's city), **Description** and **Services Amount**.

- **Borrower** (the customer): fill in the fields (name, CPF or CNPJ, email, address) or send the `borrower` object of the API as JSON. The type (person or company) is detected from the tax number.
- **Taxes are optional.** Leave them out and NFE.io calculates ISS, rates and withholdings from the company settings. A value you add replaces the automatic calculation. Only the fields you add are sent: an empty group sends nothing.
- **Federal Withholdings**: withheld PIS and COFINS go in this group. They are not the PIS and COFINS of the company's own tax.

#### Tax reform (IBS/CBS)

Add **Operation Indicator** and **Classification Code** in the **Tax Reform (IBS/CBS)** group to send the `ibsCbs` group of the invoice. These are the only two required values, each with six digits:

- **Operation Indicator** (`cIndOp`) defines where IBS/CBS is due and which address the invoice needs. For example, `100301` (services such as consulting or software development) uses the borrower's address, so add it with the IBGE city code. See the [indicator table](https://nfe.io/docs/documentacao/reforma-tributaria/conceitos-funcionais/tabelas-de-referencia/tabela-referencia-indicador-operacao/).
- **Classification Code** (`cClassTrib`), for example `000001`.

NFE.io calculates IBS and CBS. Use **Overrides (JSON)** only to replace the calculation or to send other fields of the group, and **Recipient (JSON)** when the destination is different from the borrower. The field reference is in the [NFS-e layout with the tax reform](https://nfe.io/docs/documentacao/reforma-tributaria/conceitos-funcionais/nota-fiscal-de-servico/documentacao-layout-nfse-rtc/). Ask your accountant which codes apply to your services.

#### Waiting for authorization

NFE.io accepts the invoice right away and the city authorizes it later (seconds to minutes, depending on the city). With **Wait for Authorization** on (default), the node checks the invoice every 2 seconds until it is issued or rejected, up to **Timeout (Seconds)** (60 by default, at most 300):

- Issued: the item has the final invoice (`flowStatus: "Issued"`), ready for the PDF.
- Rejected by the city (`IssueFailed`): the node fails with the reason sent by the city.
- Timeout: the item has the invoice as it is, with `waitTimedOut: true`. Check it later with **Get**, or follow up from the **NFE.io Trigger**.

For large batches, turn the wait off and use the trigger: n8n keeps the execution running while it waits. **Cancel** has the same option.

#### External ID and safe re-runs

Every invoice is sent with an **External ID**, your unique ID for it, such as the order number.

- Issuing again with an External ID that already exists returns the existing invoice with `alreadyExisted: true` instead of issuing a second one. Re-running a workflow for the same order is safe.
- When NFE.io does not answer clearly (timeout, network failure, 5xx), the node **never sends the invoice again**. It looks for it by External ID for 30 seconds; if it is not found, the node fails with the External ID so you can check before trying again.
- If you leave External ID empty, the node creates one per execution, node run and item. It protects **Retry On Fail** inside the same execution only: retrying a failed execution, or running the workflow again, creates a new ID and can issue a second invoice. Use an ID from your own system whenever the same sale can reach the node twice.

### Files

**Download PDF**, **Download XML** and **Download Cancellation XML** put the file in a binary field (`data` by default, see **Put Output File in Field**) with the file name and MIME type, ready for an email, storage or messaging node. The PDF can take a few seconds to be available after the authorization; the node tries again for a short time.

### Lookups

CNPJ, state registration and postal code lookups are **billable per call** and need the **Data API Key**. The node validates the input (CNPJ check digits, 8-digit CEP, state) before calling, and makes **one call per run**: it does not retry them automatically, because a lookup that timed out on our side may already be billed. **Get City Code by Postal Code** is free and uses the open NFE.io endpoint.

### Use as an AI agent tool

The NFE.io node can be connected to the **AI Agent** as a tool. Each tool node runs one operation; use [`$fromAI()`](https://docs.n8n.io/build/integrate-ai/ai-examples/use-ai-for-parameters/) to let the model fill fields such as the invoice ID or the CNPJ, and keep **Output** on **Simplified** so the model gets the main fields only.

- **Issue** sends a real fiscal document. Put it behind [human review for tools](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools/) so a person approves each call, and give the model an External ID that comes from your system.
- Lookups are billable: say in the system message when the agent may call them. An agent can call a tool more often than you expect.
- Fix the company in the tool node (By ID) instead of letting the model choose it.

See [`examples/ai-agent-invoice-assistant.json`](examples/ai-agent-invoice-assistant.json).

### Errors

Messages say what happened and how to fix it, and include the NFE.io **Request ID** (`x-request-id`) to share with NFE.io support. With **Continue On Fail**, each failed item becomes an output item with the error, and the other items go on.

## NFE.io Trigger node

The trigger registers a webhook in your NFE.io account when the workflow is activated (or when you select **Listen for test event**) and removes it when the workflow is deactivated (or after the test event).

- **Events**: every event type offered by the NFE.io API, loaded when you open the node (with a built-in list when the API cannot be reached), plus **All Events**. Service invoice events include issued successfully, issue failed, cancelled successfully and cancellation failed; the list also has product (NF-e), consumer (NFC-e), received (inbound) documents, product tax and tax payment events. See the [event catalog](https://nfe.io/docs/webhooks/catalogo-de-eventos/).
- **Company** (optional): only start the workflow for events of this company. NFE.io webhooks belong to the whole account, so without this filter the workflow starts for events of every company of the account. Events with no company in them (for example product tax events) always start the workflow.
- **Signature**: every delivery is checked against the `X-Hub-Signature` header (HMAC-SHA1 of the raw body with a secret the trigger creates). Deliveries with an invalid signature get HTTP 401 and do not start the workflow.

Each event becomes one item:

```json
{
  "event": "service_invoice.issued_successfully",
  "resource": "service_invoice",
  "action": "issued_successfully",
  "companyId": "...",
  "deliveryId": "...",
  "payload": { "id": "...", "number": "...", "flowStatus": "Issued", "borrower": { "name": "..." } }
}
```

`payload` is the document sent by NFE.io (for service invoices, the invoice). `companyId` is `null` when the event does not say which company it belongs to. `deliveryId` is the delivery ID sent by NFE.io (`X-Hook-Id`).

## Examples

Importable workflows are in [`examples/`](examples/):

- Issue an NFS-e with IBS/CBS for a paid order, wait for the authorization, download the PDF and email it.
- When an NFS-e is issued, download the PDF and send it to Telegram.
- An AI agent that finds invoices, looks up a CNPJ and issues an NFS-e only after a person approves it.

## Limitations

- **Each test listen and each activation creates a webhook in your NFE.io account.** It is removed when you stop the listen, when the first test event arrives or when you deactivate the workflow.
- **Before registering, the trigger reads the webhook list of the account** and removes webhooks with exactly its own URL. They are leftovers of this same node: a test listen started again without stopping the previous one (n8n replaces the listen and the node loses track of the previous webhook) or a creation that timed out. Webhooks with any other URL are never changed. A leftover of an old n8n URL that the node no longer tracks stays in the account: webhooks created by this node have `source=n8n-nodes-nfe` in their URL, and you can list and remove them with the [NFE.io webhooks API](https://nfe.io/docs/documentacao/webhooks/integracao/).
- **NFE.io takes a moment to notice a new webhook.** In our tests, an event right after a new webhook was created was not delivered. After activating a workflow for the first time, wait two minutes before relying on events, and use **Get Many** with a date filter to catch up on events of that window.
- **After publishing, deliveries signed with the previous webhook secret are accepted for 5 minutes.** For a short time after the trigger replaces its webhook (deactivate and activate again, publish a change, change the events), NFE.io still signs events with the secret of the removed webhook. The trigger accepts that secret on the same URL for 5 minutes, then refuses it with 401. Test listens do not keep it: n8n starts each listen with empty data, so an event signed with the secret of an earlier listen gets 401.
- **Repeated deliveries are not removed.** NFE.io delivers an event again when your n8n does not answer with success (a redelivery keeps the same `deliveryId`; each webhook has its own). Use `deliveryId` to skip repeats (for example, keep the processed IDs in a data table).
- **The format of events other than service invoices comes from the NFE.io documentation.** Service invoice events were checked against real deliveries; the other families were built from the event catalog. The trigger passes their body as `payload` without changing it.
- **CNPJ, state registration and postal code lookups are billable and not retried.** If one fails with a timeout, run it again yourself.
- **The automatic External ID only protects retries inside the same execution.** See [External ID and safe re-runs](#external-id-and-safe-re-runs).
- With **All Events** and no company filter, the workflow receives the events of every company of the account.
- IBS/CBS: the node sends the group as documented and NFE.io calculates the values. How the city prints them depends on the company's tax regime and the city.
- Operations for product (NF-e) and consumer (NFC-e) invoices are not in the action node yet; the trigger already receives their events.

## Migrating from 0.1

Version 0.2.0 is a new node. **Workflows built with 0.1 do not run on 0.2**: replace each old NFE.io node by a new one and set its fields again. Until you do, an old node stops the execution with "This node was created with version 0.1 of n8n-nodes-nfe" and sends nothing to NFE.io, including in active workflows.

| | 0.1 | 0.2 |
|---|---|---|
| Node | `NFe.io`, node version 1 | `NFE.io`, node version 2. Nodes saved with version 1 do not run and must be added again. |
| API | NFS-e V1 | NFS-e V3 (alphanumeric CNPJ, tax reform fields) |
| Company | Free text | List of your companies or ID |
| Issue fields | Fixed groups that sent every tax field, including the ones left at 0 | Optional groups: only what you add is sent; NFE.io calculates the rest |
| Issue result | The first answer of NFE.io (invoice still processing) | The authorized invoice (Wait for Authorization, on by default) |
| External ID | Optional | Always sent (yours or automatic); a repeated ID returns the existing invoice |
| Get by External ID | Failed for every ID | Fixed |
| Get Many | One item with the first page | One item per invoice, every page with Return All |
| Download PDF and XML | Text in the JSON (the PDF was corrupted) | Binary files |
| Output | Raw | Simplified, Raw or Selected Fields |
| Credential | API Key | Same credential type (`nfeApi`); existing credentials keep working. Add the Data API Key for the lookups. |
| New | | Company resource, Lookup resource, Download Cancellation XML, NFE.io Trigger |

To keep a 0.1 workflow running while you migrate, stay on version 0.1.0 of the package.

## Security

Report security issues privately to [hackers@nfe.io](mailto:hackers@nfe.io). Please do not open a public issue for them.

- Keys are stored only in the n8n credential and are never written to the output or to error messages.
- Download links of PDF and XML files are followed without the API key and never appear in the output.
- The webhook secret is kept in the workflow static data, as n8n triggers do. People who can open the workflow in n8n can read it. When the trigger replaces its webhook, the previous secret stays there too and is still accepted for 5 minutes on the same URL; it is never written to the output.

## Support

- Status of the NFE.io services: <https://status.nfe.io/>
- NFE.io documentation: <https://nfe.io/docs/>
- Bugs and feature requests: [GitHub issues](https://github.com/nfe/n8n-nodes-nfe/issues)

## Development

See [docs/development.md](docs/development.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
