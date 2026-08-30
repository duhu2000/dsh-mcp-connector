# Discoverability and conversion baseline

This document records a reproducible growth baseline and the monthly review protocol. Growth targets are operating goals, not product promises.

## Baseline — 2026-08-30 (Asia/Shanghai)

| Metric | Baseline | Reproducible source |
|---|---:|---|
| npm downloads, trailing 30 days | 5,406 | npm downloads API, `2026-07-31` through `2026-08-29` |
| GitHub Stars | 8 | GitHub repository API |
| GitHub Forks | 2 | GitHub repository API |
| GitHub Watchers | 1 | GitHub repository API `subscribers_count` |
| Open Issues | 1 | GitHub repository API |
| Latest npm / GitHub Release | `0.2.29` / `v0.2.29` | npm registry and GitHub Releases API |
| GitHub views | 646 / 277 unique visitors | GitHub Traffic API, `2026-08-16` through `2026-08-29` |
| GitHub clones | 1,174 / 247 unique cloners | GitHub Traffic API, `2026-08-16` through `2026-08-29` |
| Popular path: Overview | 444 / 268 unique visitors | GitHub Traffic popular paths API, `2026-08-16` through `2026-08-29` |
| Natural-search visibility | npm package appeared on the first results page for `DeepSeek Harness MCP connector` | Search snapshot on 2026-08-30; rank varies by engine, locale, and personalization |

The Traffic snapshot was collected through the official GitHub API on 2026-08-30. Its referrer breakdown was:

| Referrer | Views | Unique visitors |
|---|---:|---:|
| `github.com` | 67 | 22 |
| Bing | 5 | 3 |
| `npmjs.com` | 4 | 1 |
| Baidu | 1 | 1 |
| Google | 1 | 1 |
| chatgpt | 1 | 1 |
| dshfind | 1 | 1 |
| dshmarket | 1 | 1 |
| findharness | 1 | 1 |
| 微信 | 1 | 1 |

`Open Issues = 1` is the pre-intervention baseline. The documentation-scoped [`good first issue` #29](https://github.com/duhu2000/dsh-mcp-connector/issues/29) was created afterward as part of this round, so it must be counted as a change, not folded back into the baseline.

Recheck the quantitative baseline with:

```bash
curl -fsSL https://api.npmjs.org/downloads/point/last-month/dsh-mcp-connector
gh api repos/duhu2000/dsh-mcp-connector \
  --jq '{stargazers_count,forks_count,subscribers_count,open_issues_count}'
gh api repos/duhu2000/dsh-mcp-connector/releases/latest --jq '{tag_name,published_at}'
gh api repos/duhu2000/dsh-mcp-connector/traffic/views
gh api repos/duhu2000/dsh-mcp-connector/traffic/clones
gh api repos/duhu2000/dsh-mcp-connector/traffic/popular/paths
gh api repos/duhu2000/dsh-mcp-connector/traffic/popular/referrers
npm view dsh-mcp-connector version
```

The npm download window ends on the previous UTC day. Save its returned `start` and `end` fields with the value. GitHub counters are cumulative snapshots and should include the capture timestamp. GitHub Traffic endpoints require repository push access and expose a rolling 14-day window, so archive each response at review time.

Clones and npm downloads include automation, CI installs, cache misses, reinstalls, and repeated actions. Neither metric represents independent people, and neither may be used as the denominator or numerator of an independent-user conversion rate.

## 30-day operating goals

| Metric | Goal |
|---|---:|
| Monthly npm downloads | 7,000+ |
| GitHub Stars | 12+ |
| GitHub Forks | 4+ |

Do not treat Stars divided by monthly downloads as a true conversion rate: Stars are cumulative while the download window is not. Until first-party analytics are available, use these separate proxies:

- README → install intent: trailing npm downloads and install-command copy feedback, if the host later exposes it without user tracking.
- README → community intent: net new Stars and Forks during the same review window.
- Contributor conversion: first-time Issues/PRs opened, first-time PRs merged, and median time from `good first issue` assignment to PR.
- Search discovery: first non-personalized result-page position for the fixed query set below.

## Monthly review template

Copy this section below with a new date; never overwrite the baseline.

### YYYY-MM-DD (Asia/Shanghai)

| Metric | Previous | Current | Change | Source window / timestamp |
|---|---:|---:|---:|---|
| npm downloads, trailing 30 days |  |  |  |  |
| GitHub Stars |  |  |  |  |
| GitHub Forks |  |  |  |  |
| GitHub Watchers |  |  |  |  |
| Open Issues |  |  |  |  |
| GitHub views / unique visitors, trailing 14 days |  |  |  |  |
| GitHub clones / unique cloners, trailing 14 days |  |  |  |  |
| Popular path: Overview / unique visitors |  |  |  |  |
| Top referrers (views / unique visitors) |  |  |  |  |
| First-time PRs opened / merged |  |  |  |  |

Use a signed-out or fresh browser profile, record engine and locale, and inspect at least the first two result pages:

| Query | Engine / locale | Best project-owned result | Position | Landing page |
|---|---|---|---:|---|
| `DeepSeek Harness MCP connector` |  |  |  |  |
| `dsh MCP connector marketplace` |  |  |  |  |
| `DeepSeek MCP 连接器` |  |  |  |  |
| `model context protocol connector DeepSeek Harness` |  |  |  |  |

Record the month's changes to metadata, README CTAs, screenshots, Issues, or external listings. Note likely causes, data caveats, next experiment, owner, and review date. Never purchase or automate fake downloads, Stars, or Forks.
