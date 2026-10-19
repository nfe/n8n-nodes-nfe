# Example workflows

Workflows you can import into n8n to try the NFE.io nodes. They need the `n8n-nodes-nfe` package installed (see the [main README](../README.md#installation)).

To import one: download the JSON file, then in n8n open **Workflows > Create workflow**, open the **...** menu and choose **Import from File** (or copy the file content and paste it on the canvas).

Credentials are referenced by name only. After the import, open each node with a credential warning and select or create the credential. Values such as `your-nfe-company-id` are placeholders: replace them before running.

| File | What it does | Nodes besides NFE.io |
|---|---|---|
| [`issue-nfse-from-paid-order.json`](issue-nfse-from-paid-order.json) | Issues an NFS-e with the tax reform group (IBS/CBS) for a paid order, waits for the city to authorize it, downloads the PDF and emails it to the customer | Manual Trigger, Edit Fields, If, Gmail |
| [`send-pdf-when-invoice-issued.json`](send-pdf-when-invoice-issued.json) | Starts when NFE.io reports an issued NFS-e, downloads the PDF and sends it to a Telegram chat | Telegram |
| [`ai-agent-invoice-assistant.json`](ai-agent-invoice-assistant.json) | A chat agent that finds invoices, looks up a CNPJ and issues an NFS-e only after a person approves the call in the chat | Chat Trigger, AI Agent, OpenAI Chat Model, Simple Memory, Chat (human review), Respond to Chat |

## Before you run them

- **Issuing is real.** Every successful run of the Issue operation sends a fiscal document to the city. Start with a test company of your NFE.io account.
- **Issue NFS-e for a paid order**: edit the **Paid Order (sample)** node. It holds the company ID, the service codes of your company (`cityServiceCode`, `federalServiceCode`, `nbsCode`) and the tax reform codes (`operationIndicator`, `classCode`). The sample uses item 01.01 of LC 116 with NBS `1.1502.10.00`, operation indicator `100301` and classification `000001`; ask your accountant which codes apply to your service. Indicator `100301` needs the customer address with the IBGE city code, which is why the sample fills it in. The External ID is `order-<order id>`, so running the same order again returns the invoice that already exists instead of issuing a second one.
- **Send the PDF when an NFS-e is issued**: n8n must be reachable over public HTTPS, because NFE.io calls the webhook URL when the trigger registers it. Choose your company in the trigger to ignore events of other companies of the account.
- **AI agent**: the model is yours. The workflow wires an OpenAI chat model as an example; connect any chat model and its credential, and you pay for its use. NFE.io does not provide the model. The Issue tool goes through **Ask for Approval** (Chat human review), so the agent cannot issue an invoice without a person approving it in the chat; this requires the Chat Trigger response mode **Using Response Nodes**, already set. The CNPJ lookup is billable and needs the Data API Key; the system message asks the agent to call it only when the user asks for company data, but an agent can still call it more often than you expect.

These workflows were imported and checked in n8n 2.43.7. Built-in nodes evolve; if n8n shows a node as outdated, it still works, and you can update it from the node settings.
