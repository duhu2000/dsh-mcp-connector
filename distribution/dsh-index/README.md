# Third-party DSH plugin index (acceptance candidate)

This is an independent index in the upstream DSH `format: 1` format. It is
not the official DeepSeek marketplace, a certification, or a usage ranking.
The Connector's internal MCP server catalog is a separate format and must not
be supplied to DSH as a plugin index.

## Refresh

Run `node scripts/build-dsh-plugin-index.mjs` from the repository. It reads the
public npm registry, checks that each latest package is a public, non-deprecated
DSH bundle, and pins exact published versions and publication timestamps.
It does not install or execute package code. Review the diff before publishing.
A failure leaves the existing index unchanged. Refresh after npm publication,
not before it; never infer availability from the Git tag alone.

Package identities:

- `dsh-mcp-connector`: professional data marketplace and connection management.
- `qcc-dsh-mcp-oauth`: dedicated enterprise-data OAuth plugin; repository name
  is `qcc-mcp-oauth`, **not** its npm install name.
- `qcc-dsh-mcp-legal-oauth`: dedicated legal-data OAuth plugin; repository name
  is `qcc-mcp-legal-oauth`, **not** its npm install name.

No package currently declares `engines.dsh`. The index does not invent one.
The host still checks package peer dependencies at installation. Successful
index parsing does not establish runtime compatibility of any package.

## Acceptance and publication gate

The 2026-11-10 candidate passed upstream `parseMarketIndex` and
`marketInstallTarget`; this is schema/installation-coordinate validation only.
Before advertising an index URL:

1. Serve the reviewed JSON via HTTPS, with 2xx and no redirects.
2. Use an isolated DSH home/profile supporting Custom plugin indexes.
3. Add the source in Discover. Verify exact-name and Chinese search, selected
   version, npm source, and installed/update status.
4. Install/enable/restart and confirm tool discovery and a representative
   authorized call. Do not copy credentials from production into test evidence.
5. Validate the two dedicated OAuth packages separately before promoting them.
6. Keep the previous reviewed JSON for rollback. Never change an npm tarball
   or version tag to roll back an index.

This repository has no configured GitHub Pages site as of the initial check.
This PR prepares a static artifact; it does not enable Pages or silently add a
market source to users' profiles. A merged raw GitHub JSON URL can be evaluated
as a simple HTTPS source before provisioning a dedicated site.

## Application packet

Positioning: a professional-data MCP marketplace for DeepSeek Harness, covering
enterprise, financial, legal, patent and research sources, with authorization,
tool search, per-session loading and troubleshooting.

Plugin licensing and provider data terms are separate. Before applying for an
official listing, provide a verified publisher/contact, current screenshots,
permissions/data-flow inventory, credential lifecycle and revocation evidence,
provider fee/privacy links, tested host versions and support/rollback guidance.
Do not claim official endorsement, universal compatibility, or free data.

References:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/util/plugin-market-index
