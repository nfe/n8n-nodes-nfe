# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

A rewrite of the NFE.io node with the NFS-e API V3 and the tax reform fields, plus a trigger node and lookups. See [Migrating from 0.1](README.md#migrating-from-01).

### BREAKING CHANGES

- The **NFE.io** node is now node version 2 and only version 2. Workflows built with 0.1 must replace each NFE.io node by a new one. A node saved by 0.1 stops the execution with "This node was created with version 0.1 of n8n-nodes-nfe" and sends nothing to NFE.io.
- Service invoices use the NFS-e API V3 instead of V1. CPF and CNPJ values come back as strings.
- **Issue** has new fields: borrower by fields or JSON, optional groups for ISS, federal withholdings and the tax reform (IBS/CBS). The 0.1 fields `borrowerSource`, `borrowerData`, `taxation`, `withholdings` and `advancedOptions` no longer exist.
- **Issue** waits for the city to authorize the invoice by default (60 seconds, up to 300) and returns the authorized invoice. A rejected invoice fails the node; a timeout returns the invoice with `waitTimedOut: true`.
- **Issue** always sends an External ID (yours or one created by the node). An External ID that already exists returns that invoice with `alreadyExisted: true`.
- Operations that return invoices or companies return **Simplified** output by default. Choose **Raw** for the full object.
- **Download PDF** and **Download XML** return binary files.
- The **Company** field is a list of your companies (or an ID) instead of free text.

### Added

- **NFE.io Trigger** node: starts a workflow from NFE.io webhook events (every event type of the API or All Events), with an optional company filter and signature check. The webhook is registered and removed by the node. After the node replaces its webhook, deliveries signed with the previous secret are accepted on the same URL for 5 minutes (NFE.io keeps signing with it for a short time).
- Tax reform group (IBS/CBS) in **Issue**: Operation Indicator and Classification Code, with optional overrides and recipient. NFE.io calculates IBS and CBS.
- **Download Cancellation XML** operation (national environment).
- **Company** resource: Get and Get Many.
- **Lookup** resource: company by CNPJ (numeric and alphanumeric), state registration, address by postal code (billable, need the Data API Key) and IBGE city code by postal code (free).
- **Data API Key** field in the NFE.io API credential, used only for the lookups.
- **Output** option (Simplified, Raw, Selected Fields).
- **Cancel** can wait for the cancellation.
- Get Many filters by accrual date and creation date.
- Safe issue: after a timeout, network failure or 5xx answer, the node looks for the invoice by External ID and never sends it again.
- Error messages with the NFE.io Request ID.
- Example workflows in `examples/`.

### Changed

- Taxes are sent only when you add them. Otherwise NFE.io calculates them from the company settings.
- The credential test calls `GET https://api.nfse.io/v2/companies`.
- Requests have finite timeouts. Read requests are retried on network failures, 429 and 502–504; issue, cancel, email and the billable lookups are never retried automatically.
- Built with `@n8n/node-cli` and checked by the n8n community package scanner. Published from GitHub Actions with npm provenance.

### Fixed

- **Issue** sent every tax field, including the ones left at 0, which replaced the automatic tax calculation.
- **Get by External ID** failed for every ID.
- **Get Many** returned one item with the first page only.
- **Download PDF** returned a corrupted PDF as text.

### Removed

- Node version 1 of the NFE.io node.

## [0.1.0] - 2026-03-01

### Added

- Initial release of the **NFe.io** community nodes for n8n.
- `NFe.io` node with **Service Invoice** resource.
- Support for the following operations against the NFe.io API:
	- **Issue** a new service invoice (NFS-e).
	- **Get** a service invoice by ID.
	- **Get Many** service invoices for a company.
	- **Get by External ID**.
	- **Cancel** a service invoice.
	- **Download PDF** of a service invoice.
	- **Download XML** of a service invoice.
	- **Send Email** with the service invoice to the borrower.

[0.2.0]: https://github.com/nfe/n8n-nodes-nfe/compare/v0.1.0...0.2.0
[0.1.0]: https://github.com/nfe/n8n-nodes-nfe/tree/v0.1.0
