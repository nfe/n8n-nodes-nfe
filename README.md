## NFe.io n8n Community Nodes

Community nodes for integrating [NFe.io](https://nfe.io/) with [n8n](https://n8n.io/).

These nodes let you issue and manage Brazilian electronic service invoices (NFS-e) via the NFe.io API directly from your n8n workflows.

> Note: This is a community package. It is not officially maintained by n8n GmbH.

---

## Features

Current version focuses on the **Service Invoice** resource and supports:

- **Issue** a new service invoice (NFS-e)
- **Get** a specific service invoice by ID
- **Get Many** service invoices for a company
- **Get by External ID** using your own external identifier
- **Cancel** an issued service invoice
- **Download PDF** representation of an invoice
- **Download XML** representation of an invoice
- **Send Email** with the invoice to the borrower

All requests are made against the official NFe.io REST API and use a shared error-handling layer to surface API errors clearly inside n8n.

---

## Requirements

Before using this package you will need:

- A running **n8n instance** that supports Community Nodes (n8n v1+)
- An active **NFe.io account**
- At least one configured **company** in NFe.io
- An **NFe.io API key** with permission to access the desired company

Please refer to the official NFe.io documentation for details on account and company setup: <https://nfe.io/docs/>

---

## Installation

### Install via n8n Community Nodes (recommended)

1. Open your n8n editor UI.
2. Go to **Settings → Community Nodes**.
3. Click **Install**.
4. Enter the package name `n8n-nodes-nfe`.
5. Confirm the installation and restart n8n if requested.

After installation, the **NFe.io** node will be available in the node picker.

### Self-hosted / manual installation

If you manage n8n as a local or self-hosted instance and prefer manual installation:

1. Navigate to your n8n installation directory.
2. Install the package:

	 ```bash
	 npm install n8n-nodes-nfe
	 ```

3. Restart your n8n instance so it can load the new nodes.

For more details, see the official n8n documentation on Community Nodes: <https://docs.n8n.io/integrations/community-nodes/>

---

## Credentials

The nodes use a dedicated **Nfe API** credential type.

1. In n8n, go to **Settings → Credentials**.
2. Click **New** and search for **Nfe API**.
3. Paste your **NFe.io API Key** into the **API Key** field.
4. Save the credential.

Under the hood, requests are authenticated using the `Authorization` header with your API key. A quick test request is performed against `https://api.nfe.io/v1/companies` to validate the credential.

Once configured, select this credential in the **NFe.io** node under the *Credentials* section.

---

## Node Overview

### Node: NFe.io

- **Display name:** NFe.io
- **Resource:** `Service Invoice`
- **Inputs:** Main
- **Outputs:** Main

Each operation requires a **Company ID** field, which is the identifier of the company in NFe.io that owns the invoices.

### Supported Operations (Service Invoice)

- **Issue**
	- Create a new service invoice (NFS-e) for a given company.
	- Uses `POST /v1/companies/{companyId}/serviceinvoices`.

- **Get**
	- Retrieve full details for a single invoice by its NFe.io invoice ID.
	- Uses `GET /v1/companies/{companyId}/serviceinvoices/{invoiceId}`.

- **Get Many**
	- List multiple invoices for a company, optionally with filters (date ranges, status, pagination, etc., depending on the configured fields).
	- Uses `GET /v1/companies/{companyId}/serviceinvoices`.

- **Get by External ID**
	- Retrieve an invoice using your own external ID that was associated when issuing the invoice.
	- Uses `GET /v1/companies/{companyId}/serviceinvoices/externalId/{externalId}`.

- **Cancel**
	- Cancel an issued invoice, where allowed by the municipality and NFe.io rules.
	- Uses `DELETE /v1/companies/{companyId}/serviceinvoices/{invoiceId}`.

- **Download PDF**
	- Download the PDF representation of an invoice.
	- Uses `GET /v1/companies/{companyId}/serviceinvoices/{invoiceId}/pdf`.

- **Download XML**
	- Download the XML representation of an invoice.
	- Uses `GET /v1/companies/{companyId}/serviceinvoices/{invoiceId}/xml`.

- **Send Email**
	- Trigger an email with the invoice to be sent to the borrower.
	- Uses `PUT /v1/companies/{companyId}/serviceinvoices/{invoiceId}/sendemail`.

All operations share a common error parser so API validation and business errors from NFe.io are exposed clearly to your workflow.

---

## Usage Examples

Here are some common ways to use the **NFe.io** node inside n8n:

### 1. Issue an invoice from an order

1. Receive order data from your e-commerce/ERP system (e.g. via webhook or database node).
2. Map the customer and service details into the **Issue** operation fields of the **NFe.io** node.
3. Store the returned NFe.io invoice ID or external ID in your system for later reference.

### 2. Send the invoice by email automatically

1. After issuing an invoice, add another **NFe.io** node with the **Send Email** operation.
2. Use the `invoiceId` returned by the previous step.
3. Optionally combine with other n8n nodes (e.g. Slack, email, CRM) to notify internal teams.

### 3. Periodic invoice sync

1. Use a **Cron** node to trigger a workflow periodically.
2. Add an **NFe.io** node with the **Get Many** operation to list recent invoices.
3. Upsert the invoice data into your internal database or analytics tooling.

For request/response formats and advanced parameters, always refer to the official NFe.io API reference: <https://nfe.io/docs/rest-api/>.

---

## Limitations and Notes

- These nodes currently support only the **Service Invoice** (NFS-e) resource.
- NFe.io is specific to Brazilian tax regulations and municipalities; some behaviors may vary by city.
- You must have your company and services correctly configured in NFe.io for issuing invoices to succeed.
- Network connectivity and NFe.io availability are required for all operations.

Future versions may add additional resources and operations as needed.

---

## Development

If you want to work on this package locally:

1. Clone the repository:

	 ```bash
	 git clone https://github.com/nfeio/n8n-nodes-nfe.git
	 cd n8n-nodes-nfe
	 ```

2. Install dependencies:

	 ```bash
	 npm install
	 ```

3. Run in development mode:

	 ```bash
	 npm run dev
	 ```

	 This uses the `@n8n/node-cli` to run the node in a local n8n environment.

4. Build the production bundle:

	 ```bash
	 npm run build
	 ```

5. Lint the code:

	 ```bash
	 npm run lint
	 # or
	 npm run lint:fix
	 ```

For publishing a new version to npm, follow the usual `n8n-node` release flow using the `npm run release` script.

---

## Support & Issues

If you run into problems using these nodes:

- Check the NFe.io API status and documentation: <https://status.nfe.io/> and <https://nfe.io/docs/>
- Open an issue in this repository: <https://github.com/nfeio/n8n-nodes-nfe/issues>

Bug reports and feature requests are welcome.

---

## License

This project is licensed under the **MIT License**.

See the package metadata and repository for full license details.
