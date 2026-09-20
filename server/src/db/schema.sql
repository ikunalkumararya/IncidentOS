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

-- Added when attack investigations shipped. Applied idempotently alongside
-- the rest of this file on every boot, same as everything else here.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'incident';

-- Real intake is separate from the deterministic demo fixtures.
CREATE TABLE IF NOT EXISTS incoming_incidents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('website', 'monitoring', 'manual')),
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  service TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'investigating', 'review', 'failed')),
  report TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, event_id)
);
CREATE INDEX IF NOT EXISTS incoming_incidents_queue_idx ON incoming_incidents(status, created_at);

-- One row per step of an intake investigation, written as the worker goes.
--
-- The dashboard shows an investigation progressing phase by phase, and these
-- are where those phases and their timings come from. They are recorded by the
-- worker around the call it actually makes, so a duration on screen is a
-- measured elapsed time rather than an animation. Cleared and rewritten when
-- an investigation is retried.
CREATE TABLE IF NOT EXISTS incident_phases (
  incident_id TEXT        NOT NULL REFERENCES incoming_incidents(id) ON DELETE CASCADE,
  seq         INTEGER     NOT NULL,
  phase       TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  output      TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  PRIMARY KEY (incident_id, seq)
);
