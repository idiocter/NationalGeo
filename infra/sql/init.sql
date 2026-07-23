-- NGLIP PostGIS schema initialisation
-- Run once on a blank database. Further changes go through Alembic migrations.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Municipalities (753 Nepal local units)
-- ---------------------------------------------------------------------------
CREATE TABLE municipalities (
    id TEXT PRIMARY KEY,                    -- e.g. "np-bag-ktm-01"
    name TEXT NOT NULL,
    name_np TEXT,                           -- Nepali name
    province TEXT NOT NULL,
    district TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('metropolitan', 'sub_metropolitan', 'municipality', 'rural_municipality')),
    total_area_km2 FLOAT,
    population INTEGER,
    geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_municipalities_geom ON municipalities USING GIST (geom);
CREATE INDEX idx_municipalities_province ON municipalities (province);

-- ---------------------------------------------------------------------------
-- Dataset versions (immutable once registered)
-- ---------------------------------------------------------------------------
CREATE TABLE datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version TEXT NOT NULL UNIQUE,           -- e.g. "landcover-v3.1"
    dataset_type TEXT NOT NULL CHECK (dataset_type IN ('landcover', 'boundary', 'roads', 'dem', 'rivers', 'protected_areas', 'population')),
    source_url TEXT,
    license TEXT,
    year_range INT4RANGE,                   -- e.g. [2000, 2022]
    checksum TEXT NOT NULL,                 -- SHA-256 of the dataset package
    operator_note TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_by TEXT
);

-- ---------------------------------------------------------------------------
-- Class histograms baseline (per year, per dataset version)
-- ---------------------------------------------------------------------------
CREATE TABLE class_histograms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_version TEXT NOT NULL REFERENCES datasets(version),
    year INTEGER NOT NULL,
    histogram JSONB NOT NULL,               -- {"1": 4120394, "2": 890231, ...}
    total_pixels BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dataset_version, year)
);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    municipality_id TEXT NOT NULL REFERENCES municipalities(id),
    years INT[] NOT NULL,
    requested_outputs TEXT[] NOT NULL,
    dataset_version TEXT NOT NULL REFERENCES datasets(version),
    boundary_version TEXT NOT NULL REFERENCES datasets(version),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'complete', 'failed', 'partial')),
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_jobs_municipality ON jobs (municipality_id);
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_cache ON jobs (municipality_id, dataset_version, boundary_version);

-- ---------------------------------------------------------------------------
-- Provenance records (append-only — no UPDATE or DELETE in application code)
-- ---------------------------------------------------------------------------
CREATE TABLE provenance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    stage TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    input_checksums JSONB NOT NULL,
    parameters JSONB NOT NULL,
    library_versions JSONB NOT NULL,
    crs_used TEXT,
    runtime_ms INTEGER,
    output_checksum TEXT NOT NULL,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provenance_job ON provenance_records (job_id);

-- Prevent application-level UPDATE/DELETE on provenance records via a rule
CREATE RULE no_update_provenance AS ON UPDATE TO provenance_records DO INSTEAD NOTHING;
CREATE RULE no_delete_provenance AS ON DELETE TO provenance_records DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Figure → provenance linkage
-- ---------------------------------------------------------------------------
CREATE TABLE figure_provenance (
    figure_id TEXT NOT NULL,
    provenance_record_id UUID NOT NULL REFERENCES provenance_records(id),
    PRIMARY KEY (figure_id, provenance_record_id)
);

-- ---------------------------------------------------------------------------
-- Result cache (keyed on municipality + year range + dataset + boundary versions)
-- ---------------------------------------------------------------------------
CREATE TABLE result_cache (
    cache_key TEXT PRIMARY KEY,             -- SHA-256 of (municipality_id + sorted(years) + dataset_version + boundary_version)
    job_id UUID NOT NULL REFERENCES jobs(id),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Validation verdicts
-- ---------------------------------------------------------------------------
CREATE TABLE validation_verdicts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'warn', 'block')),
    checks JSONB NOT NULL,
    blocked_artefacts TEXT[],
    warnings TEXT[],
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
