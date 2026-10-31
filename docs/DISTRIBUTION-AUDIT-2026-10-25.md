# Distribution audit — 2026-10-25

This audit records public evidence for `dsh-mcp-connector` after release
`0.2.81`. Checks were performed between 22:50 and 23:05 Asia/Shanghai on
2026-10-25. A directory listing is not treated as a successful installation,
runtime test, security review, or endorsement.

## Canonical release

| Source | Observed value | Evidence |
|---|---|---|
| npm | `dsh-mcp-connector@0.2.81`; Node.js `>=20`; DSH `^0.1.1-rc.2 || >=0.2.0-rc.1 <0.3.0-0` | [npm registry](https://registry.npmjs.org/dsh-mcp-connector/latest) |
| GitHub | Release `v0.2.81`; commit `28bc03df80b467e14f235a5f7056def15332c897`; 83 stars, 17 forks | [release](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.81), [repository API](https://api.github.com/repos/duhu2000/dsh-mcp-connector) |
| Install coordinate | `dsh plugin --profile web add dsh-mcp-connector` | [`package.json`](https://github.com/duhu2000/dsh-mcp-connector/blob/28bc03df80b467e14f235a5f7056def15332c897/package.json) |

## Market acceptance matrix

| Market | Public source and refresh semantics | Search and detail evidence | Package/profile path | Observed version | Disposition |
|---|---|---|---|---|---|
| [awesome-dsh-plugin](https://awesome-dsh-plugin.com/p/duhu2000/dsh-mcp-connector/) | Generated [`plugins.json`](https://awesome-dsh-plugin.com/plugins.json); DSH Market consumes this upstream. The entry is derived from curated YAML plus repository/npm probes. | Exact entry, current bilingual description, canonical repository/npm identity, and seven repository screenshot URLs are present. The source YAML has no tutorial field. | `dsh plugin --profile web add dsh-mcp-connector` | `0.2.79` | Listed and install coordinate valid; two releases behind immediately after `0.2.81`. Wait for automatic rebuild. |
| [DSH Market](https://dshmarket.com/) | `dshmarket@1.70.2` consumes the same awesome feed; the market can also be added with `https://dshmarket.com/index.json`. | Historical actual-UI search acceptance is retained in [the distribution ledger](DISTRIBUTION.md). Current source code ranks a non-empty query by relevance first; download/star ordering is only a tie-break. No current UI screenshot was captured in this audit. | Install from the shared entry into the `web` profile. | Follows awesome feed (`0.2.79` at check time) | Do not submit a duplicate listing PR. Preserve fixed-query acceptance conditions for future rank comparisons. |
| [Open Plugin Market / dshopen](https://dshopen.org/plugins/dsh-mcp-connector/) | Format-1 [`index.json`](https://dshopen.org/index.json); the project documents a six-hour index rebuild and UTC+8 daily recommendation rotation. | Exact package detail exists with category `tools`, repository identity, 83-star snapshot, and npm source. It exposes sorting by GitHub stars, new stars in seven days, Smart picks, and random resources. | Add `https://dshopen.org/index.json` as a custom market, search `dsh-mcp-connector`, then install its npm source. The entry declares the canonical DSH compatibility range. No runtime install was performed in this audit. | `0.2.80` | Listed and one release behind; wait for the next six-hour rebuild. The source is now included in the strict synchronization monitor. |

The `0.2.81` release was less than 30 minutes old when these snapshots were
taken. The observed `0.2.79`/`0.2.80` lag is normal cache convergence evidence,
not a missing registration. No new listing Issue or PR is warranted. Connector
[Issue #69](https://github.com/duhu2000/dsh-mcp-connector/issues/69) remains the
single deduplicated convergence tracker.

## Download and ranking semantics

Download numbers must retain their exact date window:

| Metric | Downloads | UTC window | Meaning |
|---|---:|---|---|
| Seven complete days | 2,722 | 2026-10-18 through 2026-10-24 | Reproducible explicit npm interval; not cumulative. |
| Thirty complete days | 21,486 | 2026-09-25 through 2026-10-24 | Reproducible explicit npm interval; not weekly or cumulative. This matches the awesome feed fields observed during the audit. |
| Since first publication | 41,477 | 2026-08-20 through 2026-10-24 | Date-bounded derived cumulative total, not an npm lifetime field. |

Evidence: [seven days](https://api.npmjs.org/downloads/point/2026-10-18:2026-10-24/dsh-mcp-connector),
[thirty days](https://api.npmjs.org/downloads/point/2026-09-25:2026-10-24/dsh-mcp-connector),
and [since first publication](https://api.npmjs.org/downloads/point/2026-08-20:2026-10-24/dsh-mcp-connector).

The npm aliases `last-week` and `last-month` returned older rolling windows
(5,682 for 2026-10-16 through 2026-10-22 and 22,701 for 2026-09-23 through
2026-10-22). They must not be mixed with the complete-day baseline above.

DSH Market has an unresolved presentation ambiguity: source comments describe
the `downloads` field as a trailing 30-day total, while the website labels
"Most installed" as last week and displays `/wk`. Until the upstream
`downloadsStart` and `downloadsEnd` fields and UI label agree, do not claim a
weekly rank from that screen. A search result position is relevance under a
specific query, locale, category, sort, market version, page, and timestamp;
it is not a global download rank or featured placement.

dshopen's `downloads-10k` label is a tier, not an exact count or cumulative
total. Its default and Smart picks rotate, so their order must not be described
as a permanent ranking.

## Screenshots, tutorials, and historical submissions

- The awesome feed resolves seven images from repository `HEAD`. Four are
  `0.2.73` mock UI assets and the others are historical `0.2.37`/`0.2.46`
  assets. They describe the interface but are not `0.2.81` real-account or
  successful-call evidence.
- dshopen currently uses its market placeholder whale image for this entry and
  exposes no connector-specific tutorial field.
- [One-success case](https://github.com/duhu2000/dsh-mcp-connector/blob/28bc03df80b467e14f235a5f7056def15332c897/docs/tutorials/ONE-SUCCESS-CASE.md)
  and [sharing kit](https://github.com/duhu2000/dsh-mcp-connector/blob/28bc03df80b467e14f235a5f7056def15332c897/docs/tutorials/SHARING-KIT.md)
  are publicly reachable at the release commit. Neither awesome's source YAML
  nor dshopen's entry exposes a dedicated tutorial field, so reachability does
  not prove that a market detail page displays these links.
- awesome registration and corrections are already merged:
  [#2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633),
  [#3656](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3656),
  [#4982](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4982),
  [#5309](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5309),
  and search-phrase [#5737](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5737).
  DSH Market relevance [#409](https://github.com/dsh-market/dsh-market/pull/409)
  is also merged. dshopen has no open connector submission Issue or PR because
  the connector is already present.

## Follow-up

1. Let automatic sources refresh and use Issue #69 for convergence; do not
   create duplicate directory submissions.
2. Re-run `npm run distribution:check:live` after the documented refresh
   windows. A stale or unavailable result blocks convergence but is not proof
   of an installation failure.
3. Ask the DSH Market maintainer to reconcile the 30-day source definition with
   the `/wk` website label before making ranking or weekly-download claims.
4. Repeat actual UI search acceptance when browser automation is available,
   recording the query, locale, category, sort, market version, page, and time.

