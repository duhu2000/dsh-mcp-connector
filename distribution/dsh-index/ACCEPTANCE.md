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

Discover displayed “无法读取此索引”. A subsequent Node fetch of GitHub Raw
timed out after 15 seconds. The earlier successful response does not establish
reliable reachability on this network.

Correction after inspecting the actual runtime bundle: `lib/index.js` embeds
the parser and resolves `lib/worker.cjs`, which exists. Running this published
Worker against the candidate index returned `{ok:true}`. The earlier failure
came from directly importing an internal `lib/types/parse-thread.js` file;
that is not the host's runtime path and does not establish an upstream defect.
No upstream packaging bug is claimed. Continue with HTTPS reachability diagnosis.

The test host lives entirely under `/tmp`; production DSH and WorkDSH profiles
and credentials were not changed. No workaround was applied to the official
host to claim a pass.

## Next gates, in order

1. Published runtime Worker verified successfully; no package patch required.
2. Establish a reliably reachable HTTPS index URL; repeat Discover loading.
3. Verify exact-name and Chinese searches and the npm version confirmation.
4. Install, enable and restart; verify installed/update state.
5. Verify tool discovery and representative authorized calls for each package.
6. Only then remove the draft status and advertise the source. A custom source
   is not an official listing, certification or commercial-market approval.

No npm release or tag is required for this distribution-only change. Official
listing requirements and a real submission entry still need independent
verification before application.
