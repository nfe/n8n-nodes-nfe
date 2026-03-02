# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
