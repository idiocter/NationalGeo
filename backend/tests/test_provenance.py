"""Tests for the Provenance Agent.

Uses a SQLite in-memory database to avoid requiring a live PostGIS instance.
The tests verify the append-only invariant and the record structure.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, call

import pytest

from backend.agents.provenance.agent import (
    ProvenanceAgent,
    _capture_library_versions,
    _dict_checksum,
)


# ------------------------------------------------------------------
# _dict_checksum
# ------------------------------------------------------------------

class TestDictChecksum:
    def test_same_dict_same_checksum(self):
        d = {"a": 1, "b": [2, 3]}
        assert _dict_checksum(d) == _dict_checksum(d)

    def test_key_order_invariant(self):
        d1 = {"a": 1, "b": 2}
        d2 = {"b": 2, "a": 1}
        assert _dict_checksum(d1) == _dict_checksum(d2)

    def test_different_dicts_different_checksum(self):
        assert _dict_checksum({"a": 1}) != _dict_checksum({"a": 2})

    def test_starts_with_sha256_prefix(self):
        result = _dict_checksum({"x": 1})
        assert result.startswith("sha256:")


# ------------------------------------------------------------------
# _capture_library_versions
# ------------------------------------------------------------------

class TestCaptureLibraryVersions:
    def test_returns_dict(self):
        versions = _capture_library_versions()
        assert isinstance(versions, dict)

    def test_sqlalchemy_present(self):
        versions = _capture_library_versions()
        assert "sqlalchemy" in versions

    def test_values_are_strings(self):
        for v in _capture_library_versions().values():
            assert isinstance(v, str)


# ------------------------------------------------------------------
# ProvenanceAgent
# ------------------------------------------------------------------

class TestProvenanceAgent:
    """Tests that the agent sends correct SQL without a real DB."""

    def _make_db(self):
        """Return a mock Session that records execute() calls."""
        db = MagicMock()
        db.execute = MagicMock(return_value=MagicMock())
        db.commit = MagicMock()
        return db

    def test_open_record_calls_update_and_insert(self):
        db = self._make_db()
        agent = ProvenanceAgent(db)
        envelope = {
            "municipality_id": "np-bag-ktm-01",
            "years": [2000, 2022],
            "dataset_version": "landcover-v3.1",
            "boundary_version": "mof-2021",
        }

        provenance_id = agent.open_record(job_id="job-1", envelope=envelope)

        assert isinstance(provenance_id, str)
        assert len(provenance_id) == 36  # UUID format
        # Should have called execute at least twice (UPDATE jobs + INSERT provenance)
        assert db.execute.call_count >= 2
        db.commit.assert_called_once()

    def test_log_stage_calls_insert(self):
        db = self._make_db()
        agent = ProvenanceAgent(db)

        agent.log_stage(
            job_id="job-1",
            stage="raster_analysis",
            agent_version="raster_analysis:v0.1.0",
            input_checksums={"raster": "sha256:abc"},
            parameters={"crs": "EPSG:32645"},
            output_checksum="sha256:def",
            crs_used="EPSG:32645",
            runtime_ms=4230,
        )

        assert db.execute.call_count >= 1
        db.commit.assert_called_once()

    def test_close_record_calls_update_and_insert(self):
        db = self._make_db()
        agent = ProvenanceAgent(db)
        agent.close_record(job_id="job-1", status="complete")

        # Must update jobs table AND append a job_close record
        assert db.execute.call_count >= 2
        db.commit.assert_called_once()

    def test_no_delete_or_update_on_provenance_records(self):
        """Ensure no SQL contains DELETE or UPDATE targeting provenance_records."""
        db = self._make_db()
        agent = ProvenanceAgent(db)
        envelope = {"municipality_id": "x", "years": [2000], "dataset_version": "v1", "boundary_version": "v1"}

        agent.open_record("job-1", envelope)
        agent.log_stage("job-1", "raster_analysis", "v0.1", {}, {}, "sha256:x")
        agent.close_record("job-1", "complete")

        for call_args in db.execute.call_args_list:
            sql_str = str(call_args.args[0]).upper()
            if "PROVENANCE_RECORDS" in sql_str:
                assert "DELETE" not in sql_str, "DELETE on provenance_records is forbidden"
                assert sql_str.strip().startswith("INSERT"), (
                    "Only INSERT is allowed on provenance_records"
                )
