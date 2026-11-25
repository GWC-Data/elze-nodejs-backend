# MCP: personal tokens and read-only context data

This backend is what `elze-context-mcp` (a separate MCP server) talks to. That
server holds no database connection and no credential of its own: it forwards
the caller's personal MCP token, and everything below decides what the token may
read.

```
modules/mcp/mcpTokenFormat.ts       token shape: elze_pat_ + 43 base64url characters, 16-character display prefix
modules/mcp/mcpTokenValidator.ts    name and expiry rules (1-365 whole days, default 90)
modules/mcp/mcpTokenRepository.ts   public.mcp_tokens
modules/mcp/mcpTokenService.ts      create, list, revoke, revoke all; admin rules
modules/mcp/mcpTokenRoutes.ts       /api/mcp/tokens (cookie session + CSRF)
modules/mcp/mcpTokenMiddleware.ts   Bearer auth, mounted only on /api/mcp/data
modules/mcp/mcpDataValidator.ts     paging, cursor, version, type, keyword and name parsing
modules/mcp/mcpDataRepository.ts    published versions and snapshot entries, on the shared access SQL
modules/mcp/mcpDataService.ts       contexts, overview, versions, objects, table
modules/mcp/mcpDataRoutes.ts        /api/mcp/data (Bearer only, GET only)
modules/contextLayer/mcpService.ts  what GET /api/context/connections/:id/mcp tells the frontend
```

## Tokens

- **Created** by a signed-in user with `context.read` (`POST /api/mcp/tokens`). The
  response is the only place the token ever appears, and it is sent with
  `Cache-Control: no-store`.
- **Stored** as `hashToken(token)`, the same HMAC-SHA256 refresh and activation
  tokens use (keyed with `JWT_REFRESH_SECRET`). A database dump alone is useless;
  rotating `JWT_REFRESH_SECRET` invalidates every MCP token as well as every session.
- **At most 10 active** per account. Creation locks the account row, so two
  requests in parallel cannot both take the tenth slot.
- **Revoked** by the owner, or by someone with `user.deactivate` who may manage the
  owner (`userService.requireManageable`: same company, and only the default
  administrator manages other administrators). Someone else's token that you may
  not revoke reads as 404, so token ids cannot be probed.
- An expiry outside 1-365 whole days is refused, not clamped.

## The Bearer path

`/api/mcp/data` runs, in order: RBAC ready → failure limiter → token → token
limiter → `context.read`. The token check:

1. `Authorization: Bearer <token>`, scheme case-insensitive. Missing: 401 with
   `WWW-Authenticate: Bearer realm="elze-mcp"`. Malformed or unknown: 401 with
   `error="invalid_token"`.
2. Revoked, expired or a scope other than `mcp:read`: 401.
3. The owner is loaded by `actorForUser`, the same function the cookie session
   uses (`authMiddleware.ts`), so a deleted, disabled or pending account and an
   inactive company are refused exactly as they are for the web app. A required
   password change is refused too. All of these are 401 here, not 403: the MCP
   client cannot fix them, and 401 tells it the token is no longer good.
4. `last_used_at` is written at most once a minute per token.

Each refusal of a **known** token is audited as `mcp_token_rejected` with the token
id, prefix and reason, at most once per token and reason every 10 minutes (an
in-memory throttle, so a misconfigured client cannot flood the trail). Unknown
tokens are not audited: there is no account to attribute them to.

The cookie path is unchanged. A personal MCP token is not accepted on any other
route, and the session cookie is not accepted on `/api/mcp/data`.

## Rate limits

The global per-address limiter skips `/api/mcp/data`, because every MCP call
reaches this backend from the MCP server's address and would share one bucket.
Instead:

| Setting | Default | Counts |
|---|---|---|
| `MCP_RATE_LIMIT_PER_MINUTE` | 300 | requests per token, after the token is accepted |
| `MCP_AUTH_FAILURES_PER_MINUTE` | 60 | 401 answers per address, before any token is accepted |

One MCP request costs this backend at least two calls (the session check, then the tool's own call; `get_metric`
and resource reads make more), so keep the backend's per-token limit well above elze-context-mcp's own
(60 per minute by default).

## What a token can read

Exactly what its owner sees in the web app. Listing uses `visibleClause` and
`accessColumns` (`contextAccessRepository.ts`); every row is then checked with
`levelOf` (`contextAccessService.ts`). One context is looked up with
`contextScope` and `levelOf`, the pair `requireConnectionId` uses. No access rule
is written twice.

A context is `(connection_id, name)`. Its live version is the highest published,
non-deleted `version`. Any other published version can be pinned with
`?version=3` or `?version=v3`. Asking for a version of a context you cannot read
answers "Context not found.", never "Version not published", so the existence of
a context does not leak.

Facts come from `context_layer_versions.snapshot`, never from the live
`context_objects` table: a token only ever sees what was approved and published.
`/objects` filters and pages inside Postgres (`jsonb_array_elements`). `/table`
reuses `contextService.groupByTable` and `isTableOfDataset`, the same grouping
the Understand and Profile steps use.

Context names may hold any character, so they are URL-encoded in the path. A
qualified table name may hold `/` and `.`, so it travels as `?qualifiedName=`.

## `GET /api/context/connections/:id/mcp`

Tells the frontend how to connect. It returns the context URL
(`CONTEXT_MCP_SERVER_URL/<connectionId>/<encoded name>`), the all-contexts URL
(`CONTEXT_MCP_SERVER_URL`), the tool list, and client settings for Claude Desktop
(through `mcp-remote`, pinned), HTTP clients and Claude Code, with `<token>` where
the token goes. `?name=` picks the context; without it, the most recently
published one at its live version. `CONTEXT_MCP_AUTH_REQUIRED` is gone: a token
is always required.

## Tests

```
npm run test:unit                          token format, validators, MCP limiters
TEST_DB_PASSWORD=root npm run test:mcp     mcp: token service; mcp-e2e: the HTTP path end to end
```

`mcp-e2e` starts the server and covers every access rule, every refusal, the
cursor, URL-encoded names, the audit throttle, and that the cookie routes still
behave as before.
