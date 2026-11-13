# npm download trend

Source: npm public Downloads API, package `dsh-mcp-connector`. Daily UTC counts
are collected from npm package creation date through the last available day.
The Chinese chart shows only cumulative counts summed over that exact range.
An increasing cumulative total does not imply accelerating recent growth.
The PNG renderer uses Noto CJK fonts in CI to preserve Chinese labels.

Downloads include upgrades, repeat installations and automation. These are not
unique users, successful installations or connector-card connection counts.
Historical values may be revised by npm; do not force monotonic snapshots.

Run `node scripts/build-download-trend.mjs` to regenerate JSON and SVG.
The scheduled workflow runs at 03:20 UTC (11:20 Asia/Shanghai), renders PNG and
updates one maintenance PR. Merge the PR to refresh the shared main-branch image.
Errors or missing days stop generation; the last published snapshot stays visible
with its original cutoff. No user telemetry or QCC backend is involved.

The Connector and Registry READMEs use the same absolute PNG URL. npm will receive
the README change with the next normal package publication; thereafter the remote
image can refresh independently, subject to platform image caching.
