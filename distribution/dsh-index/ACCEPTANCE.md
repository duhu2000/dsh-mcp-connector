# Custom plugin index acceptance — 2026-11-10

Candidate: PR #222, `feat/dsh-plugin-index-20261110`.

## Passed

- Three published npm bundle identities and exact versions checked.
- Official index parser and install-target validation passed.
- Candidate HTTPS endpoint returned 200 without redirects in an earlier direct check.
- PR CI passed on Linux/Windows and Node 20/22/24.
- An isolated official DSH 0.2.2-rc.1 Web host started successfully.
- Custom plugin indexes enabled; Discover appeared; candidate source was saved.

## Runtime follow-up — distribution path passed, authorized calls pending

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

## Release scope

Release this third-party distribution index after CI and the verified discovery,
installation, enablement and restart checks. This does not certify the runtime
of every listed OAuth plugin. The following broader acceptance remains open:
real authorized calls, agent per-session loading and old-to-new upgrade.
No model account or QCC production credentials are copied for acceptance.

No npm release or version tag is required: this change publishes a JSON index
of existing npm versions and changes no plugin runtime. The stable source is:
https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/distribution/dsh-index/index.json

Official listing requirements and a real submission entry still need independent
verification before application. This is not an official listing or endorsement.

## Successful UI retry

After restarting the isolated host, the same HTTPS source loaded all three
entries without a host patch. Exact package-name and Chinese `连接器` searches
found Connector. The confirmation named `dsh-mcp-connector@0.2.97` and
`https://registry.npmjs.org/`; installation completed and immediate enable
added the sidebar entry. Discover then showed the installed-state link.
Connector rendered version 0.2.97, 116 catalog entries and 10 recommendations.
Its version check completed. This is not a tested old-to-new upgrade.

An OpenAlex connection completed in the isolated `default-workspace` scope.
The global tool explorer correctly showed no project-scoped connection outside
that workspace. No model account or QCC credentials were added; agent tool
execution, per-session loading, dedicated OAuth package
runtime and old-to-new upgrade remain unverified. These are follow-up checks, not claims made by this index release.

## Restart verification

On 2026-11-10 the isolated host was fully stopped and restarted. Connector
remained enabled, reopened at 0.2.97 and retained one installed connection.
The production DSH/WorkDSH profiles remained untouched.
