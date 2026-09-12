# Browser authentication and cookies

This production starter returns access and refresh tokens in JSON. It does not
issue authentication cookies, read credentials from cookies, or install CSRF
middleware. Its current transport contract is:

| Operation | Credential source |
|---|---|
| Protected HTTP routes | `Authorization: Bearer <access_token>` |
| Login and registration | Email and password in an `application/json` body |
| Refresh | `refresh_token` in an `application/json` body |
| Logout, password change and device revocation | Access-token header |

The access-token extractor ignores cookies and URL parameters. Keep tokens out of
URLs: URLs can reach history, logs and referrers. The built-in auth routes do not
parse form or text bodies as JSON. Preserve these boundaries when extending them.

## Connect a browser using the current contract

Set `CORS_ORIGINS` to the exact browser origins, including scheme and port, such as
`https://console.example.com`. An empty value grants no cross-origin response
access. `*` allows every origin; reserve it for intentionally public APIs.
`CORS_CREDENTIALS=false` is the default. A caller can supply a Bearer header
explicitly without enabling credential mode for cookies; that header requires a
successful CORS preflight. [Fetch CORS protocol](https://fetch.spec.whatwg.org/#cors-protocol-and-credentials).

```ts
// The caller holds this token in memory after login; do not put it in the URL.
const response = await fetch(`${apiBase}/api/v1/auth/me`, {
  credentials: "omit",
  headers: { Authorization: `Bearer ${accessToken}` },
});

if (!response.ok) {
  throw new Error("The authenticated request failed");
}

const profile = await response.json();
```

CORS supplies browser response-access headers. A disallowed origin can still send
some requests, and command-line clients do not enforce CORS. Authentication and
ACLs remain necessary. `CORS_CREDENTIALS=true` only emits a CORS response header;
it neither reads cookies nor adds CSRF checks. The starter rejects combining it
with `CORS_ORIGINS=*`. [Express CORS middleware](https://expressjs.com/en/resources/middleware/cors/).

A browser frontend needs its own storage policy. Prefer memory for short-lived
Bearer credentials. Persistent JavaScript-readable storage exposes tokens to any
script running in that origin; do not treat localStorage as a secure session
vault. An XSS flaw can also steal in-memory tokens or make requests as the user.
A server-backed browser session can keep refresh credentials away from frontend
JavaScript, but requires the cookie controls below.
[OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## If the application adopts cookies

Treat cookie authentication as an application change with retained abuse tests.
Apply CSRF validation before actions on every affected route, including login,
refresh, logout, password changes and settings. Prefer an existing maintained
implementation using a session-bound synchronizer token, or a signed double-submit
token bound to the session. Reject absent or invalid tokens. Check the exact
trusted source origin, with a defined Referer fallback and missing-header policy.
Keep state-changing operations off GET. Restrict accepted content types and CORS
origins; do not trust arbitrary sibling subdomains. Same-site and same-origin are
different boundaries: sibling origins can be same-site. SameSite provides additional
protection but does not replace these checks. XSS can defeat CSRF defenses.
[OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Use HTTPS with `Secure` and `HttpOnly` authentication cookies. Choose an explicit
`SameSite=Strict` or `Lax` policy that fits the login/navigation flow. Cross-site
cookies require `SameSite=None; Secure`, and browser third-party-cookie restrictions
may still block them. Prefer host-only cookies without a Domain attribute. A
`__Host-` cookie requires Secure, Path=/ and no Domain; a narrower Path cannot use
that prefix. Path is not an authorization boundary. Align cookie lifetime with
server session expiry, and clear cookies using the same name, path and domain when
revoking the server session. HttpOnly prevents script reads, but browsers still
attach the cookie to requests. [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

For cross-origin cookie requests, configure the browser with
`credentials: "include"`, exact allowed origins and `CORS_CREDENTIALS=true`.
Browser cookie restrictions still apply. This setup does not supply CSRF
validation. [MDN CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

If HttpOnly cookies are intended to hide refresh credentials from JavaScript,
remove those credentials from response bodies as part of the adaptation too.

## Evidence required for a cookie adaptation

Test rejected CSRF tokens and hostile origins without side effects, login CSRF,
refresh/logout and administrative operations, plus expiration and revocation.
Use real browsers to check same-site sibling origins, cross-site preflights,
credential mode, cookie flags and third-party-cookie behavior through the deployed
TLS/proxy topology. Include missing Origin/Referer cases in the chosen policy.

The starter's HTTP tests retain header/body-only authentication, absent Set-Cookie,
and rejection of cookie-only, query-token and non-JSON refresh attempts. They run
in Node and do not establish browser enforcement or validate a future cookie flow.

## Refresh rotation and suspected theft

One login creates one token family, identified by the session's `sid`. Refresh
rotates within that family. Reusing any valid, unexpired superseded refresh token
expires the whole family, including its access tokens. Other devices stay active;
changing the account password invalidates all devices. This strict policy follows
the replay-detection rationale in [RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2);
the starter itself is not an OAuth authorization server.

Serialize refreshes per session, coordinating tabs that share credentials. A
concurrent duplicate causes one success and one rejection, but makes the success
pair unusable too. After a refresh rejection, lost response or
`REFRESH_UNAVAILABLE` (503), discard the local pair and sign in again. There is no
retry grace period: a request that committed before its response was lost may
already have consumed the token.

Reuse does not reveal which caller is legitimate. Someone with an old unexpired
token can force the device to sign in again; an expired token cannot trigger this
revocation. Theft without reuse is not detected. A database failure may prevent
revocation or obscure its outcome, and requests already authorized are not
cancelled. Use password change for suspected account-wide compromise and apply
your own incident-response and alerting policy.
