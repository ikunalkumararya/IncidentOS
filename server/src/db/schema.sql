-- IncidentOS persistence schema.
--
-- Applied idempotently on every server start, so there is no migration tool
-- and no ordering to get wrong. The demo's schema is small and additive; if it
-- ever stops being either, this is the point to introduce real migrations.
--
-- Scope is deliberately investigation state only. The telemetry under
-- demo-data/ stands in for external systems the agent queries, and is
-- generated, deterministic and self-checking — putting it in here would cost
-- that reproducibility and buy nothing.

-- Accounts. Passwords are stored only as bcrypt hashes; nothing in the
-- codebase ever reads a plaintext password back, including the seed user.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email is compared case-insensitively, so the uniqueness constraint has to
-- be too — otherwise Ada@x.com and ada@x.com are two accounts that both
-- match at sign-in.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  mode          TEXT        NOT NULL CHECK (mode IN ('live', 'demo')),
  status        TEXT        NOT NULL CHECK (status IN ('running', 'resolved', 'failed')),
  incident_id   TEXT,
  demo_reason   TEXT,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER
);

-- The raw timeline. Replaying these through the dashboard reducer reproduces
-- the run exactly, which is what makes a stored run as good as a recording.
CREATE TABLE IF NOT EXISTS run_events (
  run_id   TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  at_ms    INTEGER NOT NULL,
  type     TEXT    NOT NULL,
  payload  JSONB   NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);

-- The findings below are all derivable from run_events. They are stored
-- separately anyway so a question like "which hypotheses has the agent ever
-- proposed, and how often was each one right?" is a query rather than a
-- replay of every stored timeline.

CREATE TABLE IF NOT EXISTS hypotheses (
  run_id        TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT    NOT NULL,
  hypothesis    TEXT    NOT NULL,
  confidence    INTEGER NOT NULL,
  rationale     TEXT    NOT NULL,
  PRIMARY KEY (run_id, hypothesis_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id            BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT    NOT NULL,
  evidence      TEXT    NOT NULL,
  supports      BOOLEAN NOT NULL,
  source        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS evidence_run_idx ON evidence (run_id, hypothesis_id);

CREATE TABLE IF NOT EXISTS root_causes (
  run_id        TEXT    PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT    NOT NULL,
  explanation   TEXT    NOT NULL,
  confidence    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patches (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  diff      TEXT NOT NULL,
  rationale TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS patches_run_idx ON patches (run_id);

CREATE TABLE IF NOT EXISTS test_results (
  run_id   TEXT    PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  passed   INTEGER NOT NULL,
  failed   INTEGER NOT NULL,
  total    INTEGER NOT NULL,
  failures JSONB   NOT NULL
);

-- The before/after numbers behind the fix, measured by the server rather than
-- claimed by the agent.
CREATE TABLE IF NOT EXISTS memory_measurements (
  run_id            TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  before_mb         DOUBLE PRECISION NOT NULL,
  after_mb          DOUBLE PRECISION NOT NULL,
  before_per_txn    DOUBLE PRECISION NOT NULL,
  after_per_txn     DOUBLE PRECISION NOT NULL,
  reduction_percent DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  run_id   TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL
);
