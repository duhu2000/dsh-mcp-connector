# Custom plugin index acceptance — 2026-11-10

Candidate: PR #222, `feat/dsh-plugin-index-20261110`.

## Passed

- Three published npm bundle identities and exact versions checked.
- Official index parser and install-target validation passed.
- Candidate HTTPS endpoint returned 200 without redirects in an earlier direct check.
- PR CI passed on Linux/Windows and Node 20/22/24.
- An isolated official DSH 0.2.2-rc.1 Web host started successfully.
- Custom plugin indexes enabled; Discover appeared; candidate source was saved.

## Blocked — not accepted for promotion

Discover displayed “无法读取此索引”. Two independently observed problems remain:

1. A subsequent Node fetch of GitHub Raw timed out after 15 seconds. The earlier
   successful response does not establish reliable reachability on this network.
2. The installed official market package's `lib/types/parse-thread.js` resolves
   `./worker.cjs`, but the published installation contains `worker.js` and
   `worker.d.ts`, not `worker.cjs`. Calling `parseIndexInWorker` with our local
   JSON reproduces `Cannot find module .../lib/types/worker.cjs`, independently
   of the network. This is a host/package artifact problem, not OAuth failure.

The test host lives entirely under `/tmp`; production DSH and WorkDSH profiles
and credentials were not changed. No workaround was applied to the official
host to claim a pass.

## Next gates, in order

1. Verify a corrected official market artifact or upstream packaging fix.
2. Establish a reliably reachable HTTPS index URL; repeat Discover loading.
3. Verify exact-name and Chinese searches and the npm version confirmation.
4. Install, enable and restart; verify installed/update state.
5. Verify tool discovery and representative authorized calls for each package.
6. Only then remove the draft status and advertise the source. A custom source
   is not an official listing, certification or commercial-market approval.

No npm release or tag is required for this distribution-only change. Official
listing requirements and a real submission entry still need independent
verification before application.
