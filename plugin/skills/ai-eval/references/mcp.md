# Building or reviewing an MCP server or client

Read this when a task builds, changes or reviews a Model Context Protocol server or client. It
follows the specification at modelcontextprotocol.io, revision 2026-07-28 (read 2026-09-23), and
its security best practices. Check the revision the project targets before relying on any line:
the protocol changed a lot in this revision, and most tutorials describe the older one.

## What the 2026-07-28 revision changed

- No handshake and no protocol sessions: `initialize` / `notifications/initialized` and the
  `Mcp-Session-Id` header are gone. Each request carries its protocol version and client
  capabilities in `_meta`; servers implement `server/discover`.
- Server-to-client requests became multi-round-trip requests: the server answers
  `resultType: "input_required"` with `inputRequests` and a `requestState`, and the client calls
  again. Treat `requestState` as attacker-controlled; if it affects authorisation or business
  logic, protect it (HMAC or authenticated encryption).
- Deprecated, with at least a 12-month window: Roots, Sampling, Logging, the HTTP+SSE transport
  (deprecated since 2025-03-26), and Dynamic Client Registration (use Client ID Metadata Documents).

## Transports

- stdio for a local server; Streamable HTTP for a remote one. Streamable HTTP is POST-only (GET and
  DELETE return 405); requests send `Mcp-Method` / `Mcp-Name` headers; servers validate `Origin`.
- A local server runs with the user's privileges: bind to localhost, never to all interfaces.

## Authorisation (HTTP transports; stdio servers should not use it)

- OAuth 2.1 with PKCE `S256`; a client refuses to continue when the server's metadata does not
  list `code_challenge_methods_supported`.
- The server publishes Protected Resource Metadata (RFC 9728). The client sends `resource`
  (RFC 8707) on both the authorisation and the token request, and validates `iss` (RFC 9207).
- The server validates that each token was issued for it (its audience). No token passthrough:
  never forward a token you received to another service; get one for that service.
- Ask for the smallest scopes; step up only when a tool needs more.

## Tools

- Narrow purpose, a schema, and validation in the server: the protocol does not validate
  arguments for you.
- Protocol failures are JSON-RPC errors (an unknown tool is `-32602`); a tool that ran and failed
  returns a result with `isError: true` and a message the model can act on.
- Tool descriptions and annotations are untrusted input to the client. Pin the tool descriptors
  you approved and treat a changed description as a new tool (a "rug pull").
- Tools that change the world (send, pay, delete, publish) need a confirmation or an allowlist, and
  an idempotency key: a new JSON-RPC id is not idempotency, so a retry can repeat the side effect.
- Results from tools that fetch external content can carry instructions (prompt injection):
  they are data, and the client validates them.

## Security review list

The specification's security best practices: confused deputy, token passthrough, SSRF (validate
URLs the server fetches, including redirects and metadata URLs), state-handle hijacking, local
server compromise, authorisation-URL validation, mix-up attacks, localhost redirects, scope
minimisation. The OWASP MCP Top 10 (a beta project; 2025 IDs) adds: token mismanagement and
secret exposure, privilege escalation through scope creep, tool poisoning, supply chain,
command injection, intent-flow subversion, weak authentication and authorisation, missing audit
and telemetry, shadow MCP servers, and context over-sharing.

## Checks

- MCP Inspector (`npx @modelcontextprotocol/inspector`, Node 22.19+): the web UI on port 6274 for
  exploring, `--cli` with exit codes for CI. Never combine `DANGEROUSLY_OMIT_AUTH` with
  `DANGEROUSLY_BIND_ALL_INTERFACES`.
- Evaluate a server the way `SKILL.md` evaluates any model feature: cases for each tool, injected
  tool results, an unauthorised caller, a token for another audience, and a changed tool
  description.

## Traps from popular courses (checked against the spec)

- Examples that still use `initialize`, `Mcp-Session-Id`, session affinity or session-hijacking
  controls describe revision 2025-11-25 or older.
- A multi-round-trip example with a bare base64 `requestState` for a destructive action is unsafe.
- A token whose audience is the client id is wrong: the audience is the MCP server.
- Sampling is deprecated (still in the spec for its deprecation window), not a core primitive to build on; SSE was deprecated in 2025-03-26, not later.
- Inspector `--sse` and port 5173 are out of date. Sample servers that write `notes/${title}` or
  run a caller's SQL show path traversal and injection, not practice. The npm package is
  `@modelcontextprotocol/sdk`.
- "Always use the latest version of a tool" and "don't hardcode tool names" work against pinning
  approved tool descriptors.
