# Security Policy

## Supported versions

Atlas is developed on a rolling basis: only the latest release is supported,
and security fixes land on `main` and ship in the next tagged release. There
are no backported release branches. Run the latest published image, or `main`.

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
