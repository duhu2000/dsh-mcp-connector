# MCP Connector and Connection Manager Marketplace for DeepSeek Harness

> A general-purpose MCP connector, plugin extension, and integration marketplace initiated and maintained by the Qichacha (QCC) team

Browse and install MCP connectors from different providers in DeepSeek Harness Desktop. Connect MCP servers through OAuth, API key/URL configuration, JSON import, or a connector descriptor URL; discover tools and prompts, extend agent skills, start a new conversation, and manage installed connections.

> Here, “skill extension” means extending an agent through MCP tools and prompts; this package does not present itself as a standalone DSH Skill.

[简体中文](README.md)

[![CI](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- A primary sidebar entry below New Conversation and above workspaces/conversations, with a public footer-slot fallback for incompatible DSH DOM versions.
- Searchable Marketplace and Installed views, provider and connection-method filters, catalog refresh, and active health checks that distinguish Configured, Connected, Reauthorization Required, Partially Unavailable, and Connection Error states.
- OAuth 2.0 Authorization Code with PKCE, API key/Bearer/unauthenticated URL configuration, and `mcpServers` JSON import.
- Installation from a credential-free connector descriptor URL.
- Credential and MCP initialize validation before API-key connectors are saved as installed.
- Dynamic tool discovery grouped by MCP server, including descriptions, search, batched rendering, and an independent scroll region.
- Curated prompt templates that can open a DSH conversation and prefill its draft; missing variables are requested before the prompt is sent.
- Persistent connection lifecycle management: restore on restart, enable/disable, disconnect, refresh OAuth tokens, and revoke authorization.
- Built-in, remote, and local catalogs with `published` and `featured` controls.
- A standalone remote Registry, allowing new marketplace cards to appear after refresh without publishing a new npm version.
- Explicit, non-destructive migration of authorization from the two earlier Qichacha OAuth plugins.

The first four bundled cards are Qichacha connectors, followed by PKULaw and Wind. After a remote Registry refresh, Yingmi, QVeris, and Bazhuayu Cloud Collection are also available, for nine published marketplace cards in total. Bazhuayu is the first third-party example to exercise the complete OAuth 2.1 + PKCE dynamic-registration flow; the architecture remains provider-neutral.

## Interface and demo

![30-second MCP Connector walkthrough](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/demo.gif)

| Marketplace overview | Connector details and curated prompts |
|---|---|
| ![Marketplace overview](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/01-market-overview.jpg) | ![Connector details](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/02-connector-detail.jpg) |
| Tool discovery, descriptions, and scrolling | JSON import |
| ![Tool discovery](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/03-tool-discovery.jpg) | ![JSON import](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/04-json-import.jpg) |

The assets are captured from the credential-free local UI harness. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for provenance.

## Installation

Requirements: DeepSeek Harness Desktop or web profile, and Node.js 20 or later.

```bash
dsh plugin --profile web add dsh-mcp-connector
```

Or use the installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/install.sh)
```

Fully quit and restart DeepSeek Harness Desktop after installation or upgrade.

## Usage

1. Select **MCP Connector** in the primary sidebar.
2. Choose a connector in Marketplace and complete authorization or configuration.
3. Open its details to inspect tools or send an example prompt to a new conversation draft.
4. Use Installed or the conversation tools to enable, disable, inspect, or disconnect a connection.

Connected tools are exposed to the model with the `mcp__<serverName>__*` prefix.

## Connector catalog

The package contains a bundled fallback catalog. By default, it refreshes from the public [dsh-mcp-connector-registry](https://github.com/duhu2000/dsh-mcp-connector-registry); cached or bundled data remains available if the remote registry cannot be reached.

The public connector registration process and descriptor requirements are documented in [docs/MARKET-REGISTRATION.md](docs/MARKET-REGISTRATION.md).

## Configuration

The default bundle configuration is in `cordis.patch.yml`:

```yaml
- id: mcp-connector
  name: dsh-mcp-connector
  config:
    catalogUrl: 'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json'
    persistSecrets: true
    entryPrefix: mcp
    refreshSkewMs: 300000
    openBrowser: true
```

Set `catalogUrl` to an empty string for an explicitly offline/private setup.

## Development and release checks

```bash
npm run check
npm run registry:build
npm run registry:validate
npm run market:check
npm run dev:ui
```

`npm run check` performs syntax checks, automated tests, and an npm package allowlist/sensitive-content audit. `npm run market:check` tracks the external DSH marketplace PR and live directory. Tags matching `v*` trigger GitHub Actions; the tag must match `package.json`. npm releases use Trusted Publishing through GitHub OIDC and do not require a long-lived `NPM_TOKEN`.

The current public version is [`dsh-mcp-connector@0.2.11`](https://www.npmjs.com/package/dsh-mcp-connector), with [GitHub Release v0.2.11](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.11).

See [CHANGELOG.md](CHANGELOG.md) for version history and [docs/DESKTOP-E2E.md](docs/DESKTOP-E2E.md) for the Desktop release checklist.

## Security and limitations

- Credentials are stored only in the DSH storage domain and are not written to the catalog, Git repository, or conversation history.
- Failed API key/token validation is not persisted; authentication, timeout, DNS, and TLS/network errors are reported separately.
- External URLs must use HTTPS; HTTP is allowed only for loopback development.
- Remote descriptors and catalogs are limited to 2 MiB, Web API requests to 1 MiB, and imported JSON is scanned for credential fields before normalization.
- Streamable HTTP is the primary transport. Legacy SSE entries can still be provisioned to the DSH Host, while live health checks, tool discovery, and pagination in the connector UI target Streamable HTTP. stdio entries are explicitly skipped.
- The primary sidebar placement uses the stable DSH `data-slot` marker and falls back to the footer if that marker is removed.

## License

MIT
