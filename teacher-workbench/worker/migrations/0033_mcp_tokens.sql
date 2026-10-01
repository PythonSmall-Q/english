-- Personal MCP tokens are stored as hashes and scoped to one tenant/user.
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '个人 MCP 连接',
    scopes TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_tenant_user
    ON mcp_tokens (tenant_id, user_id, revoked_at);
