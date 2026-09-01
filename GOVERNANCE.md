# Governance

## Licence promise

**Treadle's core will not be relicensed.** Everything published under this repository
is Apache-2.0 and stays Apache-2.0. We will not move it to a source-available licence,
a business-source licence, or any other non-OSI licence.

We take contributions under the [DCO](https://developercertificate.org/) rather than a
CLA specifically so that we *cannot* quietly do that later: without a copyright
assignment or a broad relicensing grant from every contributor, the core is not ours to
relicense unilaterally. The absence of a CLA is the guarantee, not the promise.

This matters in this particular market. Camunda 8 Self-Managed moved to the non-OSI
Camunda Licence 1.0 in October 2024 and Camunda 7 CE reached end of life. People
building on BPMN tooling have been burned by exactly this, and are right to ask.

## Commercial model

Treadle is maintainer-led and there is no company behind it today. There may be one
later — the intent is to eventually fund the work commercially — and that is stated
plainly rather than discovered later, because the licence promise above only means
something if you know what pressures it is meant to survive.

If that happens, the boundary is **which repository code lives in, never a licence
restriction on the core**:

- Everything in this repository — the MCP server, the CLI, the library, the linter,
  the benchmark — is Apache-2.0, and is the complete, unrestricted product for local and
  self-hosted use. No feature is withheld, time-limited, or gated behind a key.
- Commercial offerings are things that are genuinely multi-tenant systems problems and
  cannot ship as a local file tool: hosted collaboration, a shared process repository,
  org-wide lint policy enforcement, SSO and audit, a managed remote MCP endpoint.

The test we hold ourselves to: **no commercial offering may create pressure to make the
open core worse.** If a proposed feature only makes commercial sense because the free
version is deliberately limited, it does not ship.

## Decision-making

Today: maintainer-led, with decisions recorded as ADRs in
[docs/DECISIONS.md](docs/DECISIONS.md) rather than settled in private. Each ADR states
what it rests on and what would reverse it, so disagreement can be about evidence
instead of authority.

As the project grows we will move to a documented committer model. Contributors who
land substantive work will be invited to commit rights before that is formalised, not
after.

## Trademark

The Treadle name is held by the maintainers and is not covered by the Apache-2.0 grant,
which covers copyright and patents but not trademarks. No trademark registration has
been filed yet. You may say your software works with Treadle, is built on Treadle, or is
a fork of Treadle. Please do not use the name in a way that implies the project endorses
or maintains your distribution.

BPMN and the BPMN logo are trademarks of the Object Management Group. Camunda, Signavio
and ARIS are trademarks of their respective owners. Treadle is not affiliated with,
endorsed by, or sponsored by any of them.
