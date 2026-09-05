# DSH MCP Connector Distribution Ledger

Last updated: 2026-09-05 (Asia/Shanghai)

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
| Current release | `0.2.35` |
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
| [dshmarket.com](https://dshmarket.com/browse/) / `dsh-market` | Consumes awesome-dsh-plugin | Listed and searchable in the actual DSH `dshmarket@1.38.1` Discover UI | Search-ranking [PR #409](https://github.com/dsh-market/dsh-market/pull/409) merged after maintainer approval; production acceptance ranked `mcp`, `mcp连接器`, `连接器`, and `连接管理` first, with `mcp server` fifth | Canonical npm install | None; retain the five-query result as the ranking baseline and review `mcp server` only as a non-blocking future experiment | P1 / closed, production accepted | 2026-08-31 |
| [DSH Extension Hub](https://github.com/Relistencode/dsh-extension-hub) | awesome-dsh-plugin plus GitHub discovery | Actual DSH UI `Discover More` search returns `duhu2000/dsh-mcp-connector` | GitHub search result showed the current description and 8 stars; the default Curated view could not load its 2.3 MB catalog within the 15-second body timeout | Marketplace installation flow; no install action was taken during search acceptance | Discovery acceptance is complete. Track [Issue #12](https://github.com/Relistencode/dsh-extension-hub/issues/12) for the Curated HTTP-200/body-timeout defect; no listing PR | P1 / Discover passed, Curated blocked upstream | 2026-08-30 |
| [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | Scans `topic:dsh-plugin` every two hours | Present in live `registry.json` | Snapshot `0.2.29`; Bundle detected; registry seen 2026-08-30 | GitHub source and package name detected | Wait for the next scan and recheck `0.2.32`; no PR | P2 / sync watch | 2026-08-31 |
| [YELEBAI/dsh-plugin-marketplace](https://github.com/YELEBAI/dsh-plugin-marketplace) | Independent verified central Registry | Present in `registry/plugins.json` | `verifiedCommit=b0e8c630...`, corresponding to `0.2.29` | Repository installation metadata present | Recheck that the verified commit advances to the `0.2.32` release; do not submit a duplicate entry | P2 / sync watch | 2026-08-31 |
| [Harness Registry](https://github.com/majiayu000/dsh-plugin-registry) / `plugin.dshdesk.com` | Scans `topic:dsh-plugin` every two hours and validates manifests | Present in live plugin data | Snapshot `0.2.29`; `manifest_verified`; installation not tested | Commit-pinned GitHub command | Wait for the next scan to pick up `0.2.32`; correct the duplicated bilingual English-description field if a correction channel is available | P2 / sync watch, metadata follow-up | 2026-08-31 |
| [1024 Store](https://github.com/deepseek-ai/deepseek-harness/discussions/1922) / `deepseek1024.com` | GitHub topic discovery with its own API | Exact search returns one plugin entry | Added 2026-08-30; 8 stars at audit time | `dsh plugin --profile web add dsh-mcp-connector` | None; already listed | P2 / closed | 2026-08-30 |
| [w2112515/dsh-plugin-marketplace](https://github.com/w2112515/dsh-plugin-marketplace) | Daily `dsh-plugin` topic scan | Present in public catalog | Snapshot `0.2.28`; valid Bundle; one-click eligible | GitHub source, risk marked as git-source | Wait for daily sync and recheck `0.2.32`; no PR | P2 / sync watch | 2026-08-31 |
| [dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins) | Independent generated catalog | Present in `data/plugins.json` | Status `verified`; `verifiedAgainst=0.1.0-rc.8`; repository metadata current | Repository install metadata present | Re-run verification only if the directory supports a newer DSH baseline | P2 / listed | 2026-08-30 |
| [dsh.fish](https://dsh.fish/category/market) | Topic/catalog automation | Listed as a Bundle in the Market category | Version not exposed in category view | Plugin detail/install flow available | None; periodic search acceptance only | P2 / closed | 2026-08-30 |
| [dsh.pub](https://dsh.pub/en/plugins/dsh-mcp-connector/) | Daily `dsh-plugin` Topic auto-analysis; submission flow only accepts new repository/package-path coordinates | Listed through Topic auto-analysis; duplicate [submission PR #74](https://github.com/dsh-pub/dsh-pub/pull/74) was rejected with `already_listed` | Live page now shows `0.2.32`, commit `fc540a80aa...`, and the current README | Commit-pinned `npx dshpub add` command | None for metadata; only a dsh.pub maintainer or submission bot can close duplicate PR #74 | P2 / metadata current, duplicate close external | 2026-09-02 |
| [dshmarketplace.dev](https://dshmarketplace.dev/api/v1/plugins?q=dsh-mcp-connector&limit=20) | Independent discovery, install checks, and reviewed Registry | Exact API search returns one installable entry | `inRegistry=true`; `installCheck=passed`; current bilingual descriptions and repository metadata are visible after [Issue #1](https://github.com/DshMarketPlace/dshmarketplace/issues/1) was resolved | Canonical npm install command | None; nightly upstream reconciliation is now enabled by the directory | P1 / closed, resync verified | 2026-09-02 |
| [dshbase](https://www.dshbase.com/plugins/dsh-mcp-connector/) | Independent verification directory | Listed | Live page now displays `Verified · install-tested on dsh`; current README and v0.2.32 release link are visible. The accepted evidence remains recorded in [Issue #96](https://github.com/ylwl1997/dshbase/issues/96) | npm installation guidance and install-tested badge are public | None; verification objective complete | P1 / closed, verified | 2026-09-02 |
| [dshmk.com](https://dshmk.com/plugins/1340838178) / [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store) | Topic discovery plus staged validation | Listed; repository ID `1340838178` | Repository description is current, but the live validation updated on 2026-09-02 still reports `DEPENDENCY_INSTALL_FAILED`; structure and security stages passed in prior reports | Detail page and canonical npm install command are visible; v0.2.30 independently installed and loaded in actual DSH `0.1.1-rc.2` | Track [Issue #7](https://github.com/ZASENJC/dsh-plugins-store/issues/7) for sanitized install command/stderr or manual-review disposition; no further blind reruns | P1 / validator-only failure awaiting evidence | 2026-09-02 |
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
| DSH Market search relevance ranking | [`dsh-market/dsh-market#409`](https://github.com/dsh-market/dsh-market/pull/409) | Complete: maintainer approved and merged the PR; all six CI checks passed; actual DSH `dshmarket@1.38.1` acceptance completed all five baseline queries, with four ranked first and `mcp server` ranked fifth | Complete; retain the result as the production ranking baseline |
| dshplugin.dev submission | Reference `sub_279a8624-3dc7-4218-8579-8e7694880dd2` from [submission page](https://dshplugin.dev/submit) | Received; pending editorial review | Editorial decision and, if approved, canonical public listing URL recorded |
| dsh.pub metadata refresh | [Submission PR #74](https://github.com/dsh-pub/dsh-pub/pull/74) | Complete: the normal Topic path advanced the live page to `0.2.32` / `fc540a80aa...`; the duplicate PR remains open only because the submitter cannot close the bot-owned PR | Complete; a dsh.pub maintainer or submission bot may close PR #74 without merging |
| DSH Plugin Directory | [Submission #226](https://github.com/alexchenzl/dsh-plugin-directory/issues/226) | Submitted; awaiting automated validation | Accepted directory URL recorded or the seven-day retry result documented |
| HackSing DSH Plugins | [Submission #167](https://github.com/HackSing/dsh-plugins/issues/167) | Accepted by automation and closed; directory commit [`5054ed8`](https://github.com/HackSing/dsh-plugins/commit/5054ed8dbb7a2ec78da898b44e4abd31d72b3ccf) recorded | Complete; future changes use the information-update form |
| dshmarketplace.dev Registry resync | [Issue #1](https://github.com/DshMarketPlace/dshmarketplace/issues/1) | Complete: maintainer refreshed the API, closed the Issue, and added nightly upstream reconciliation; live API reports `inRegistry=true` and `installCheck=passed` | Complete; retain periodic metadata acceptance only |
| dshbase revalidation | [Evidence Issue #96](https://github.com/ylwl1997/dshbase/issues/96) | Complete: the live page now displays `Verified · install-tested on dsh`, after the maintainer accepted the actual-DSH evidence | Complete; retain periodic verification acceptance only |
| dshmk revalidation | [Revalidation Issue #7](https://github.com/ZASENJC/dsh-plugins-store/issues/7) | Live validation updated on 2026-09-02 still reports `DEPENDENCY_INSTALL_FAILED`; the public result exposes no actionable install stderr, while product CI and independent DSH installation pass | Maintainer supplies sanitized install command/stderr or records a manual-review disposition |
| Extension Hub Curated UI | [Issue #12](https://github.com/Relistencode/dsh-extension-hub/issues/12) | `Discover More` exact-name UI search passed; fresh-profile Curated view fails after the 2.3 MB catalog body exceeds its 15-second timeout | Curated catalog loads and the Registry-backed entry is searchable in the actual DSH UI |

External maintainers control review and merge times. `Submitted` is not the same
as `Accepted`, and neither is the same as `Visible in production`.

## P1 runtime acceptance evidence

The following acceptance was performed in a real local Harness runtime on
2026-08-30 and 2026-08-31. No third-party account or credential was connected
during the tests.

| Check | Environment / action | Result |
|---|---|---|
| MCP Connector install and activation | macOS 26.5.1 arm64; Node.js `v25.9.0`; DSH `0.1.1-rc.2`; `dsh plugin --profile web add dsh-mcp-connector@0.2.30` | Passed. The profile listed `dsh-mcp-connector@0.2.30`, DSH Web started, the sidebar displayed `MCP连接器`, and the dialog displayed `当前版本 v0.2.30` with marketplace and installed-card views rendered |
| Extension Hub isolated install | Fresh temporary `DSH_HOME`; `dsh-extension-hub@0.2.19`; DSH `0.1.1-rc.2` | Passed. Extension Management and Plugin Market UI mounted without modifying the normal DSH profile |
| Extension Hub `Discover More` search | Query `dsh-mcp-connector` in the actual Plugin Market UI | Passed. Exact repository result, current description, and 8-star metadata were returned |
| Extension Hub `Curated` search | Default Registry-backed view against `https://awesome-dsh-plugin.com/plugins.json` | Blocked upstream. The response is HTTP 200 with `content-length: 2343281`, but body download exceeded the plugin's 15-second timeout before JSON parsing; tracked in Issue #12 |
| DSH Market search relevance | Actual `dshmarket@1.38.1` Discover UI; all categories; approximately 2.5k entries; queries `mcp`, `mcp连接器`, `连接器`, `mcp server`, and `连接管理` | Passed. The connector ranked first for four queries and fifth for `mcp server`; the latter is recorded as a non-blocking metadata/ranking observation rather than an index or deployment failure |

## Reusable submission packet

Use the following facts for manual forms, Issues, and PRs. Adapt the category to
the destination schema without changing the product identity.

- Repository: `https://github.com/duhu2000/dsh-mcp-connector`
- npm: `https://www.npmjs.com/package/dsh-mcp-connector`
- Release: `0.2.35`
- License: MIT
- Category preference: `Integrations & Connectors`; otherwise
  `Plugins & Runtime`, `Integration`, or `Plugin Markets & Managers`
- Install: `dsh plugin --profile web add dsh-mcp-connector`
- Remove: `dsh plugin --profile web remove dsh-mcp-connector`
- Supported target: DeepSeek Harness Desktop/web profile; Node.js 20+
- English description: `DeepSeek Harness MCP Connector and MCP Server marketplace with over one hundred MCP connectors, continuously updated. Discover, authorize, and manage connections in one place; supports OAuth 2.0 PKCE, API keys, stdio/HTTP, mcpServers JSON import, and tool and prompt discovery. Maintained by Qichacha/QCC.`
- Chinese description: `DeepSeek Harness 的 MCP连接器与 MCP Server 市场，收录超百个 MCP连接器并持续更新；统一发现、授权和连接管理，支持 OAuth 2.0 PKCE、API Key、stdio/HTTP、mcpServers JSON 导入，以及工具与 Prompt 发现；由企查查/QCC 团队维护。`
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
