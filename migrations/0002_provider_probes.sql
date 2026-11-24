CREATE TABLE provider_probes (
  run_id TEXT NOT NULL, provider TEXT NOT NULL, path TEXT NOT NULL, started_by TEXT NOT NULL REFERENCES users,
  submission_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, provider_id TEXT, supplied_wire_id TEXT,
  PRIMARY KEY(run_id,provider,path)
);
