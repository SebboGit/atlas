# Security Policy

## Supported versions

Atlas is pre-1.0 and developed on a rolling basis. Security fixes land on
`main`; there are no backported release branches yet. Run the latest `main`
(or the latest published image once 1.0 ships).

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Use GitHub's
private vulnerability reporting instead: open the repository's **Security** tab
and choose **Report a vulnerability**. That starts a private advisory only the
maintainer can see, so a fix can land before any details are public.

Include what you found, how to reproduce it, and the impact you think it has.
You'll get an acknowledgement, and the report stays private until a patch is
ready.

## Scope

Atlas is a self-hosted, single-household app meant to run on a private network
behind Tailscale or a TLS reverse proxy, with Postgres unexposed (see
[`docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md)). The most useful reports
concern authentication and sessions, the document upload and download path,
storage path-safety, SSRF in outbound calls, and secret handling.

Out of scope: anything that assumes an already-compromised host or PocketID
instance, or that depends on exposing the app raw to the public internet
against the documented deployment model.
