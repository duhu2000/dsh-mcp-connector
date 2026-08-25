# MCP Connector and Connection Manager Marketplace for DeepSeek Harness

> A general-purpose MCP connector, plugin extension, and integration marketplace initiated and maintained by the Qichacha (QCC) team

Browse and install MCP connectors from different providers in DeepSeek Harness Desktop. Connect MCP servers through OAuth, API key/URL configuration, JSON import, or a connector descriptor URL; discover tools and prompts, extend agent skills, start a new conversation, and manage installed connections.

> Here, “skill extension” means extending an agent through MCP tools and prompts; this package does not present itself as a standalone DSH Skill.

[简体中文](README.md)

[Chinese user guide](docs/USER-GUIDE.md) · [Connector onboarding](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md) · [Issues](https://github.com/duhu2000/dsh-mcp-connector/issues)

[![CI](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Registry connectors](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fduhu2000%2Fdsh-mcp-connector-registry%2Fmain%2Fcatalog-stats.json&query=%24.registryCount&label=Registry%20connectors&color=5865f2)](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog-stats.json)
[![Marketplace cards](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fduhu2000%2Fdsh-mcp-connector-registry%2Fmain%2Fcatalog-stats.json&query=%24.marketCount&label=Marketplace%20cards&color=16a34a)](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog-stats.json)

## Features

- A primary sidebar entry below New Conversation and above workspaces/conversations, with a public footer-slot fallback for incompatible DSH DOM versions.
- Searchable Marketplace and Installed views; the default Marketplace groups cards into Featured plus nine business-category sections, previews four cards per section, keeps the category bar visible while scrolling, and shows every card when a single category is selected.
- OAuth 2.0 Authorization Code with PKCE, including DCR public clients and `client_secret_post` / `client_secret_basic`; API key/Bearer/unauthenticated HTTP configuration, stdio local-process configuration, and `mcpServers` JSON import.
- Installation from a credential-free connector descriptor URL.
- Credential and MCP initialize validation before HTTP API-key connectors are saved as installed, plus declarative multi-field credential-to-env bindings for marketplace stdio connectors.
- Dynamic tool discovery grouped by MCP server, including descriptions, search, batched rendering, and an independent scroll region.
- Curated prompt templates that can open a DSH conversation and prefill its draft; missing variables are requested before the prompt is sent.
- Persistent connection lifecycle management: restore on restart, enable/disable, disconnect, refresh OAuth tokens, and revoke authorization. DCR client secrets are kept with the local grant only.
- Built-in, remote, and local catalogs with `published` and `featured` controls.
- A standalone remote Registry, allowing new marketplace cards to appear after refresh without publishing a new npm version.
- Explicit, non-destructive migration of authorization from the two earlier Qichacha OAuth plugins.

<!-- catalog-stats:start -->
As of 2026-08-25, the public Registry publishes 78 connector descriptors. After merging and deduplicating them with the 4 bundled Qichacha cards, the Marketplace exposes 82 cards across 9 business categories. Recommendations remain limited to the four Qichacha cards, PKULaw, and Wind, for 6 featured cards in total. The Registry evolves independently; the badge shown after a client refresh and the live badges above are the authoritative current counts.
<!-- catalog-stats:end -->

## Interface and demo

![16-second MCP Connector walkthrough](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/demo.gif)

| Marketplace overview | Connector details and curated prompts |
|---|---|
| ![Marketplace overview](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/01-market-overview.jpg) | ![Connector details](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/02-connector-detail.jpg) |
| Tool discovery, descriptions, and scrolling | JSON import |
| ![Tool discovery](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/03-tool-discovery.jpg) | ![JSON import](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/04-json-import.jpg) |

The assets are captured from a local DSH `web` acceptance environment and show only public marketplace metadata, example prompts, and tool descriptions. They contain no credentials, local paths, or query results. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for provenance.

## Installation

Requirements: DeepSeek Harness Desktop or web profile, and Node.js 20 or later.

```bash
dsh plugin --profile web add dsh-mcp-connector
```

Or use the installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/install.sh)
```

Run the same command again to upgrade. Fully quit and restart DeepSeek Harness Desktop after installation or upgrade. For `dsh web`, stop the original process before starting it again; `EADDRINUSE 127.0.0.1:3080` means another instance is already listening.

## Usage

1. Select **MCP Connector** in the primary sidebar.
2. Choose a connector in Marketplace and complete authorization or configuration.
3. Open its details to inspect tools or send an example prompt to a new conversation draft.
4. Use Installed or the conversation tools to enable, disable, inspect, or disconnect a connection.

Connected tools are exposed to the model with the `mcp__<serverName>__*` prefix.

The detailed [Chinese user guide](docs/USER-GUIDE.md) covers category browsing, the four authentication modes, HTTP/stdio configuration, JSON import, connection management, and troubleshooting.

## Connector catalog

The package contains a bundled fallback catalog. By default, it refreshes the public [dsh-mcp-connector-registry](https://github.com/duhu2000/dsh-mcp-connector-registry) through jsDelivr, then tries GitHub raw if the primary source fails; cached or bundled data remains available if neither remote source can be reached. jsDelivr branch URLs can lag behind a newly merged registry commit, so new cards may not appear immediately.

The public connector registration process and descriptor requirements are documented in [docs/MARKET-REGISTRATION.md](docs/MARKET-REGISTRATION.md).
The stdio architecture, passthrough boundary, and security constraints are documented in [docs/STDIO-SUPPORT.md](docs/STDIO-SUPPORT.md).

## Configuration

The default bundle configuration is in `cordis.patch.yml`:

```yaml
- id: mcp-connector
  name: dsh-mcp-connector
  config:
    catalogUrl: 'https://cdn.jsdelivr.net/gh/duhu2000/dsh-mcp-connector-registry@main/catalog.json'
    persistSecrets: true
    entryPrefix: mcp
    refreshSkewMs: 300000
    openBrowser: true
```

Set `catalogUrl` to an empty string for an explicitly offline/private setup. A custom non-default URL is used as-is and does not fall back to the public registry.

## Development and release checks

```bash
npm run check
npm run registry:build
npm run registry:validate
npm run market:check
npm run dev:ui
```

`npm run check` performs syntax checks, automated tests, and an npm package allowlist/sensitive-content audit. `npm run market:check` tracks the external DSH marketplace PR and live directory. Tags matching `v*` trigger GitHub Actions; the tag must match `package.json`. npm releases use Trusted Publishing through GitHub OIDC and do not require a long-lived `NPM_TOKEN`.

Every Registry merge regenerates `catalog-stats.json`; an hourly workflow in this repository synchronizes the Chinese and English product copy plus a local stats snapshot. The static npm README updates with package releases, while the live badges above read the Registry directly and therefore stay current without another npm release.

The current public version is [`dsh-mcp-connector@0.2.20`](https://www.npmjs.com/package/dsh-mcp-connector), with [GitHub Release v0.2.20](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.20).

See [CHANGELOG.md](CHANGELOG.md) for version history and [docs/DESKTOP-E2E.md](docs/DESKTOP-E2E.md) for the Desktop release checklist.

## Security and limitations

- Credentials are stored only in the DSH storage domain and are not written to the catalog, Git repository, or conversation history.
- Failed API key/token validation is not persisted; authentication, timeout, DNS, and TLS/network errors are reported separately.
- External URLs must use HTTPS; HTTP is allowed only for loopback development.
- Remote descriptors and catalogs are limited to 2 MiB, Web API requests to 1 MiB, and imported JSON is scanned for credential fields before normalization.
- Streamable HTTP and stdio are supported end to end. Legacy `sse` entries are normalized to Streamable HTTP. The connector passes stdio `command/args/env/cwd` to `@deepseek-ai/dsh-mcp-client` instead of reimplementing process transport.
- stdio starts a local process. Import or connect only trusted commands and packages. Catalog descriptors may declare `credentialFields` and `credentialBindings`, but may never contain actual token/secret values; user input is injected only into the local Host process environment.
- OAuth DCR client secrets share the same local-only boundary as access and refresh tokens and are omitted from catalog/status responses and logs.
- The primary sidebar placement uses the stable DSH `data-slot` marker and falls back to the footer if that marker is removed.

## License

MIT
