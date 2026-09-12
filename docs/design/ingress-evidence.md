# Ingress evidence (S15.2)

Recorded 2026-09-12 against the `v0.10.0-rc.3` archives, `nginx:1.27-alpine`,
Node 24.14.0, macOS arm64 with Docker 29.5.2. Harness:
[`scripts/ingress-smoke.mjs`](../../scripts/ingress-smoke.mjs); raw results in
git-ignored `reports/ingress-smoke/` (`checks.json`, the rendered conf, command
logs).

## What was run

The **committed** `nginx/production.conf` from a freshly generated production
app, rendered with `DOMAIN=localhost` and the app's port, in an nginx container
in front of that app (packed archives, disposable MongoDB database, real
Redis). One deviation: `proxy_pass http://127.0.0.1:{{PORT}}` becomes the host
gateway, because the proxy is containerised and the app is not. Every other
directive — `client_max_body_size`, the five `proxy_set_header` lines, the
upgrade headers, the 3600 s timeouts — is used verbatim.

The generated app has no endpoint that reports the identity it resolved, so the
harness writes one throwaway probe module into the disposable app: it echoes
`req.ip`, `req.ips`, `req.protocol`, `req.secure`, `req.hostname` and the
forwarding headers, and serves two SSE streams that differ only in whether they
send `X-Accel-Buffering: no`. `TRUST_PROXY_CIDRS` is set as the template's own
comment instructs, plus the container network so the host gateway counts as the
proxy peer.

## Results

| # | Check | Observed |
|---|---|---|
| 1 | The rendered template passes `nginx -t` | pass |
| 2 | The app resolves the client address through the proxy | `req.ip = 192.168.65.1` (the real client), `X-Forwarded-For: 192.168.65.1` |
| 3 | A client-supplied `X-Forwarded-For` cannot become the client identity | sent `203.0.113.9`; app saw `192.168.65.1` — the template's `proxy_set_header X-Forwarded-For $remote_addr` (not `$proxy_add_x_forwarded_for`) overwrites it |
| 4 | A client-supplied `X-Forwarded-Proto` cannot forge TLS | sent `https` over plain HTTP; `req.protocol = http`, `req.secure = false` |
| 5 | A client-supplied `X-Forwarded-Host` cannot replace the host | sent `evil.example`; `req.hostname = 127.0.0.1` |
| 6 | A body over `client_max_body_size` dies at the proxy | 2 MiB → `413` with nginx's HTML page, never reaching the app; 512 KiB → `400` from the app's own JSON parser, as expected |
| 7 | SSE with `X-Accel-Buffering: no` reaches the client event by event | first two events at 105 ms and 207 ms (the stream emits every 100 ms) |
| 8 | The same stream **without** that header, for comparison | first two events at 113 ms and 211 ms |
| 9 | Reaching the backend port directly | a client connecting straight to the app from a trusted CIDR **can** set its own `X-Forwarded-For` |

## Findings

**F1 — the anti-buffering header is not what makes SSE work here (check 8).**
nginx 1.27 with this template forwarded the unmarked stream just as promptly as
the marked one, so the measurement cannot show `X-Accel-Buffering: no` doing any
work in this configuration. Keep sending it — it is correct, other proxies and
other `proxy_buffering` settings do need it — but the log-streaming endpoint's
liveness must not be *attributed* to it on this evidence. A pilot behind a
different proxy, or behind nginx with `proxy_buffering` tuned elsewhere, should
re-run check 7 rather than assume it.

**F2 — the backend port is an operator responsibility, and the templates did
not say so (check 9).** `boot()` calls `server.listen(port)`, which binds every
interface; that is right for containers and platform runtimes, where the
platform owns the network boundary. On a plain server it means the app's port
answers directly, bypassing the proxy's `client_max_body_size`, its TLS
termination and any future ingress control — and a direct client that falls
inside `TRUST_PROXY_CIDRS` (`127.0.0.1/32` per the template's instruction, i.e.
anything on the host itself) is trusted to state its own forwarded identity.
None of that is an application defect: the proxy cannot enforce a boundary the
network does not. But the templates told operators to set the trust CIDR
without telling them to close the port, so the three nginx templates and the
deployment documentation now say it explicitly. Not changed: the bind address,
because narrowing it to `127.0.0.1` would break container and platform
deployments where binding all interfaces is required.

## What this does not establish

A pilot's own topology: additional hops (a load balancer or CDN in front of
nginx) change checks 2–5 completely, TLS is commented out of the template until
a certificate exists, and no sustained concurrency, replica count or failure
injection is exercised here. Those are S15.3–S16.6, and they need the
environment listed in the [Sprint 06 plan §2](../sprints/production-readiness-06.md#2-blocked-on-inputs-what-to-provide).
