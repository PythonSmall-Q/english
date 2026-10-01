-- v2 command idempotency receipts and audit correlation
CREATE TABLE IF NOT EXISTS v2_command_receipts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_mutation_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_command_receipts_tenant_created
    ON v2_command_receipts (tenant_id, created_at);
