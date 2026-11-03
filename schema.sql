-- schema.sql: idempoten, aman dijalankan setiap deploy/start.

CREATE TABLE IF NOT EXISTS transactions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type         TEXT        NOT NULL,
  account      TEXT        NOT NULL,
  to_account   TEXT,
  amount       BIGINT      NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  undone_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,

  CONSTRAINT chk_tx_type       CHECK (type IN ('opening', 'expense', 'income', 'transfer')),
  CONSTRAINT chk_tx_account    CHECK (account IN ('tunai', 'bank')),
  CONSTRAINT chk_tx_to_account CHECK (to_account IS NULL OR to_account IN ('tunai', 'bank')),
  CONSTRAINT chk_tx_amount     CHECK (amount > 0),
  CONSTRAINT chk_tx_transfer   CHECK (
    (type = 'transfer' AND to_account IS NOT NULL AND to_account <> account)
    OR (type <> 'transfer' AND to_account IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at
  ON transactions (occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_transactions_undone
  ON transactions (id)
  WHERE undone_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS budgets (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount         BIGINT      NOT NULL,
  effective_from DATE        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_budget_amount CHECK (amount > 0),
  CONSTRAINT uq_budget_effective_from UNIQUE (effective_from)
);

-- Active transactions expanded into one row per affected account.
-- A transfer yields two rows: leg 1 = money out of the source,
-- leg 2 = money into the destination.
CREATE OR REPLACE VIEW ledger_entries AS
SELECT
  id,
  occurred_at,
  type,
  account,
  description,
  CASE WHEN type IN ('opening', 'income') THEN amount ELSE CAST(0 AS BIGINT) END AS money_in,
  CASE WHEN type IN ('expense', 'transfer') THEN amount ELSE CAST(0 AS BIGINT) END AS money_out,
  1 AS leg
FROM transactions
WHERE undone_at IS NULL AND deleted_at IS NULL
UNION ALL
SELECT
  id,
  occurred_at,
  type,
  to_account AS account,
  description,
  amount AS money_in,
  CAST(0 AS BIGINT) AS money_out,
  2 AS leg
FROM transactions
WHERE type = 'transfer' AND undone_at IS NULL AND deleted_at IS NULL;