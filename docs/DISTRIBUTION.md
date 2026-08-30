# DSH MCP Connector Distribution Ledger

Last updated: 2026-08-30 (Asia/Shanghai)

This document is the source of truth for external distribution of
[`duhu2000/dsh-mcp-connector`](https://github.com/duhu2000/dsh-mcp-connector).
It records whether a directory can discover, display, install, and verify the
plugin. It also prevents duplicate submissions to downstream mirrors that share
the same upstream data source.

## Canonical plugin identity

| Field | Value |
|---|---|
| Product | MCP Connector / MCP连接器 |
| Repository | [`duhu2000/dsh-mcp-connector`](https://github.com/duhu2000/dsh-mcp-connector) |
| npm package | [`dsh-mcp-connector`](https://www.npmjs.com/package/dsh-mcp-connector) |
| Current release | `0.2.30` |
| License | MIT |
| GitHub discovery topic | `dsh-plugin` |
| Plugin type | DSH client plugin, MCP connection manager, and connector marketplace |
| Canonical install | `dsh plugin --profile web add dsh-mcp-connector` |
| GitHub install fallback | `dsh plugin --profile web add github:duhu2000/dsh-mcp-connector` |
| Bundle manifest | `package.json` `dsh.bundle.patch` -> `./cordis.patch.yml` |
| Primary category | Integration / Connectors / Plugin Markets & Managers |

The connector is not an MCP Server. Do not publish it to server-only registries
as a server. A directory is eligible only if it supports DSH plugins, clients,
connectors, aggregators, or marketplaces.

## Status model

The four acceptance dimensions are independent:

- **Discoverable**: an exact-name or relevant keyword search returns the plugin.
- **Metadata current**: the displayed description, version, commit, and install
  command match the current release.
- **Installable**: the directory exposes a correct command or has a successful
  install check.
- **Reviewed/verified**: a human review, manifest verification, or runtime test
  is recorded. Topic ingestion alone is not a security review.

`Listed` therefore does not automatically mean `Reviewed` or `Runtime tested`.

## Distribution coverage matrix

| Market / owner | Data source and sync | Listing evidence | Observed version / verification | Install information | Required action | Owner / state | Last verified |
|---|---|---|---|---|---|---|---|
| [awesome-dsh-plugin](https://awesome-dsh-plugin.com/p/duhu2000/dsh-mcp-connector/) | Curated YAML; manual PR | Listed and searchable; [initial PR #2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633) and [description PR #3656](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3656) merged | Current bilingual description; directory does not pin the npm version | Correct GitHub/npm installation guidance | None; primary upstream accepted | P2 / closed | 2026-08-30 |
| [dshmarket.com](https://dshmarket.com/browse/) / `dsh-market` | Consumes awesome-dsh-plugin | Listed and searchable | Follows awesome metadata | Canonical npm install | Do not submit a duplicate listing; separately track search-ranking PR #409 | P2 / listed | 2026-08-30 |
| [DSH Extension Hub](https://github.com/Relistencode/dsh-extension-hub) | awesome-dsh-plugin plus GitHub discovery | Ingestion mechanism confirmed | Expected to follow awesome/topic metadata | Marketplace installation flow | Perform one signed-in UI search acceptance; no listing PR | P2 / UI acceptance pending | 2026-08-30 |
| [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | Scans `topic:dsh-plugin` every two hours | Present in live `registry.json` | Snapshot `0.2.29`; Bundle detected; registry seen 2026-08-30 | GitHub source and package name detected | Wait for the next scan and recheck `0.2.30`; no PR | P2 / sync watch | 2026-08-30 |
| [YELEBAI/dsh-plugin-marketplace](https://github.com/YELEBAI/dsh-plugin-marketplace) | Independent verified central Registry | Present in `registry/plugins.json` | `verifiedCommit=b0e8c630...`, corresponding to `0.2.29` | Repository installation metadata present | Recheck that the verified commit advances to the `0.2.30` release; do not submit a duplicate entry | P2 / sync watch | 2026-08-30 |
| [Harness Registry](https://github.com/majiayu000/dsh-plugin-registry) / `plugin.dshdesk.com` | Scans `topic:dsh-plugin` every two hours and validates manifests | Present in live plugin data | Snapshot `0.2.29`; `manifest_verified`; installation not tested | Commit-pinned GitHub command | Wait for the next scan to pick up `0.2.30`; correct the duplicated bilingual English-description field if a correction channel is available | P2 / sync watch, metadata follow-up | 2026-08-30 |
| [1024 Store](https://github.com/deepseek-ai/deepseek-harness/discussions/1922) / `deepseek1024.com` | GitHub topic discovery with its own API | Exact search returns one plugin entry | Added 2026-08-30; 8 stars at audit time | `dsh plugin --profile web add dsh-mcp-connector` | None; already listed | P2 / closed | 2026-08-30 |
| [w2112515/dsh-plugin-marketplace](https://github.com/w2112515/dsh-plugin-marketplace) | Daily `dsh-plugin` topic scan | Present in public catalog | Snapshot `0.2.28`; valid Bundle; one-click eligible | GitHub source, risk marked as git-source | Wait for daily sync and recheck `0.2.30`; no PR | P2 / sync watch | 2026-08-30 |
| [dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins) | Independent generated catalog | Present in `data/plugins.json` | Status `verified`; `verifiedAgainst=0.1.0-rc.8`; repository metadata current | Repository install metadata present | Re-run verification only if the directory supports a newer DSH baseline | P2 / listed | 2026-08-30 |
| [dsh.fish](https://dsh.fish/category/market) | Topic/catalog automation | Listed as a Bundle in the Market category | Version not exposed in category view | Plugin detail/install flow available | None; periodic search acceptance only | P2 / closed | 2026-08-30 |
| [dsh.pub](https://dsh.pub/en/plugins/dsh-mcp-connector/) | Daily `dsh-plugin` Topic auto-analysis; submission flow only accepts new repository/package-path coordinates | Listed through Topic auto-analysis; duplicate [submission PR #74](https://github.com/dsh-pub/dsh-pub/pull/74) was rejected with `already_listed` | Snapshot `0.2.28`, commit `1bc825b40e...`; current release is `0.2.30` | Commit-pinned `npx dshpub add` command | Wait for the next daily Topic sync; if the snapshot remains stale after a complete cycle, use a maintainer correction channel instead of resubmitting | P2 / sync watch | 2026-08-30 |
| [dshmarketplace.dev](https://dshmarketplace.dev/api/v1/plugins?q=dsh-mcp-connector&limit=20) | Independent discovery, install checks, and reviewed Registry | Exact API search returns one installable entry | Install check passed; metadata snapshot is stale; `inRegistry=false` | Canonical npm install command | Use its submission flow to refresh/promote the existing entry, not create a duplicate listing | P2 / promotion required | 2026-08-30 |
| [dshbase](https://www.dshbase.com/plugins/dsh-mcp-connector/) | Independent verification directory | Listed | `Unverified`; old web-only/runtime validation failed against DSH `0.1.0-rc.8` | Install metadata present | Submit `0.2.30` Desktop/web verification evidence and request revalidation | P2 / verification required | 2026-08-30 |
| [dshmk.com](https://dshmk.com/plugins/1340838178) / [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store) | Topic discovery plus staged validation | Listed | Discovery, classification, and structure passed; status requires revalidation | Detail page available | Request a new sandbox validation or provide current release evidence | P2 / verification required | 2026-08-30 |
| [dsharness.org](https://dsharness.org/fr/plugin/duhu2000/dsh-mcp-connector) | Independent generated directory | Listed in multiple languages | Stale snapshot `0.2.21` | Install guidance present | Find correction/refresh path; do not create another listing | P2 / refresh required | 2026-08-30 |
| [dsh.deepseek404.com](https://dsh.deepseek404.com/detail.php?id=duhu2000%2Fdsh-mcp-connector) | Topic/generated catalog | Listed with a detail page | Current-enough repository metadata at audit time | Detail/install information present | None; periodic acceptance only | P2 / closed | 2026-08-30 |
| [dshplugin.store](https://www.dshplugin.store/plugin/awesome-dsh-plugin/awesome-dsh-plugin) | Imports awesome-dsh-plugin | Indirectly discoverable through the imported awesome catalog; no dedicated plugin page confirmed | Follows upstream catalog | Upstream installation guidance | Do not submit unless an independent correction or dedicated-listing mechanism is identified | P2 / indirect listing | 2026-08-30 |
| [deepseekharnessai.com](https://deepseekharnessai.com/categories/data/) | Secondary generated directory | Listed on a category page | Version not confirmed | Repository link available | None; low-priority periodic check | P2 / listed | 2026-08-30 |
| [dshplugin.dev](https://dshplugin.dev/submit) | Human-reviewed editorial queue followed by private-candidate validation | Submission `sub_279a8624-3dc7-4218-8579-8e7694880dd2` was received; no public detail page yet | Status `Pending editorial review` | Public repository, canonical install, release, and evidence were included in the review note | Track the editorial decision and later validation/publication; do not resubmit | P2 / submitted, editorial review pending | 2026-08-30 |
| [DSH Plugin Directory](https://github.com/alexchenzl/dsh-plugin-directory) | One GitHub Issue per plugin; accepted entries get prominent placement | [Submission #226](https://github.com/alexchenzl/dsh-plugin-directory/issues/226) is open; [v0.2.30 update](https://github.com/alexchenzl/dsh-plugin-directory/issues/226#issuecomment-5468564922) supplied | Public valid Bundle submitted under `Plugins & Runtime` | Canonical npm install command submitted | Track automated validation and accepted directory URL; do not open another issue | P2 / submitted, awaiting validation | 2026-08-30 |
| [HackSing/dsh-plugins](https://github.com/HackSing/dsh-plugins) | Scheduled Issue intake and maintainer review | [Submission #167](https://github.com/HackSing/dsh-plugins/issues/167) was accepted and automatically closed; [catalog commit `5054ed8`](https://github.com/HackSing/dsh-plugins/commit/5054ed8dbb7a2ec78da898b44e4abd31d72b3ccf) | Accepted under `integrations`; public metadata and README checks passed without executing plugin code | Canonical npm install/remove commands submitted | None; use the repository information-update form for future corrections | P2 / closed, accepted | 2026-08-30 |
| [ydhrdh/dsh-marketplace](https://github.com/ydhrdh/dsh-marketplace) | Static `registry/plugins/<id>/plugin.json` plus PR | No connector entry found | New entries begin with `verified=false` | Registry manifest provides installation metadata | Low priority: submit an `integration` entry only if maintenance activity justifies it | P2 / P2 candidate | 2026-08-30 |
| [dshplugin.me radar](https://github.com/dshplugin-me/dsh-plugin-radar) | Issue or PR | No connector record found | Not applicable | Repository link submission | Low priority after higher-reach independent directories | P2 / P2 candidate | 2026-08-30 |
| Zat DSH Engine | Unknown | No authoritative repository, directory URL, or submission policy confirmed | Unknown | Unknown | Do not submit until an exact primary URL is identified | P2 / blocked on identity | 2026-08-30 |

## Active external work

| Work item | Link | Current state | Exit criteria |
|---|---|---|---|
| DSH Market search relevance ranking | [`dsh-market/dsh-market#409`](https://github.com/dsh-market/dsh-market/pull/409) | Open; branch is `MERGEABLE/CLEAN`; all six CI checks pass; re-review requested in [comment](https://github.com/dsh-market/dsh-market/pull/409#issuecomment-5468063154); review decision remains `CHANGES_REQUESTED` | Reviewer clears the stale change request, then PR is merged and deployed |
| dshplugin.dev submission | Reference `sub_279a8624-3dc7-4218-8579-8e7694880dd2` from [submission page](https://dshplugin.dev/submit) | Received; pending editorial review | Editorial decision and, if approved, canonical public listing URL recorded |
| dsh.pub metadata refresh | [Submission PR #74](https://github.com/dsh-pub/dsh-pub/pull/74) | Quality passed; validation rejected only with `already_listed`. The submitter account cannot close the bot-owned PR, so the diagnosis and close request are recorded in [comment](https://github.com/dsh-pub/dsh-pub/pull/74#issuecomment-5468548403) | Next daily Topic sync advances the live `0.2.28` snapshot to the current release, or a maintainer correction route and result are recorded |
| DSH Plugin Directory | [Submission #226](https://github.com/alexchenzl/dsh-plugin-directory/issues/226) | Submitted; awaiting automated validation | Accepted directory URL recorded or the seven-day retry result documented |
| HackSing DSH Plugins | [Submission #167](https://github.com/HackSing/dsh-plugins/issues/167) | Accepted by automation and closed; directory commit [`5054ed8`](https://github.com/HackSing/dsh-plugins/commit/5054ed8dbb7a2ec78da898b44e4abd31d72b3ccf) recorded | Complete; future changes use the information-update form |
| dshbase revalidation | [Plugin page](https://www.dshbase.com/plugins/dsh-mcp-connector/) | Unverified | Current Desktop/web evidence accepted or latest validation result recorded |
| dshmk revalidation | [Plugin page](https://dshmk.com/plugins/1340838178) | Revalidation required | Latest sandbox result recorded |

External maintainers control review and merge times. `Submitted` is not the same
as `Accepted`, and neither is the same as `Visible in production`.

## Reusable submission packet

Use the following facts for manual forms, Issues, and PRs. Adapt the category to
the destination schema without changing the product identity.

- Repository: `https://github.com/duhu2000/dsh-mcp-connector`
- npm: `https://www.npmjs.com/package/dsh-mcp-connector`
- Release: `0.2.30`
- License: MIT
- Category preference: `Integrations & Connectors`; otherwise
  `Plugins & Runtime`, `Integration`, or `Plugin Markets & Managers`
- Install: `dsh plugin --profile web add dsh-mcp-connector`
- Remove: `dsh plugin --profile web remove dsh-mcp-connector`
- Supported target: DeepSeek Harness Desktop/web profile; Node.js 20+
- English description: `Connect and manage MCP servers in DeepSeek Harness — a universal MCP connector and marketplace with OAuth 2.0 PKCE, API keys, stdio/HTTP, mcpServers JSON import, tools, and prompts. Maintained by Qichacha/QCC.`
- Chinese description: `DeepSeek Harness 通用 MCP 连接器、连接管理与扩展市场：连接 MCP Server，发现工具与 Prompt，扩展 AI 技能；支持 OAuth 2.0 PKCE、API Key、stdio/HTTP 和 `mcpServers` JSON 导入。由企查查（Qichacha/QCC）团队发起维护。`
- Screenshots and evidence: [`docs/screenshots/README.md`](screenshots/README.md)
- Release history: [`CHANGELOG.md`](../CHANGELOG.md)

Never claim that directory ingestion is a code or security audit. Never claim
that the connector is an MCP Server.

## Acceptance and reporting cadence

After each external action, update the relevant row and report:

1. confirmed searchable markets;
2. metadata-current markets;
3. install-verified markets;
4. human-reviewed or runtime-verified markets;
5. submitted, merged, and production-visible external changes;
6. blockers, stale snapshots, and next actions;
7. evidence URLs and verification timestamp.

For topic or awesome consumers, wait for the documented synchronization SLA
before escalating. Do not open a duplicate PR merely because a downstream cache
has not refreshed yet.

## Out-of-scope directories

Do not submit the connector itself to the Official MCP Registry, Smithery,
Glama, or another server-only directory. Re-evaluate only if the destination
adds an explicit Clients, Connectors, Aggregators, or Marketplaces category.
A future remote meta-server would be a separate product and must have its own
identity, package, security review, and distribution entry.
