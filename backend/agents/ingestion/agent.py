"""Ingestion Agent — orchestrates the full data intake pipeline.

Owns everything that happens before a raster or vector touches any
other agent. Bad data here corrupts every downstream result permanently,
which is why this agent validates exhaustively before registering anything.

Design rule: datasets are immutable once registered. Corrections create
a new version — never an overwrite. Old reports stay reproducible.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.agents.ingestion.cog import convert_to_cog, validate_cog
from backend.agents.ingestion.validation import (
    IngestReport,
    RasterMetadata,
    check_class_codes,
    compute_class_histogram,
    read_metadata,
    validate_grid_alignment,
)
from backend.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class IngestionResult:
    dataset_version: str
    dataset_type: str
    years_ingested: list[int]
    cog_paths: dict[int, str]            # year → COG path in object store
    class_histograms: dict[int, dict]    # year → {code: pixel_count}
    report: IngestReport
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return self.report.ok and len(self.errors) == 0


class IngestionAgent:
    """Ingests a set of land-cover rasters for a single dataset version.

    Usage:
        agent = IngestionAgent(db_session)
        result = agent.ingest_landcover(
            raster_paths={2000: Path("lc_2000.tif"), 2001: Path("lc_2001.tif"), ...},
            version="landcover-v3.1",
            source_url="https://...",
            license="CC-BY-4.0",
            operator_note="Initial ingest from ICIMOD dataset",
        )
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ingest_landcover(
        self,
        raster_paths: dict[int, Path],
        version: str,
        source_url: str = "",
        license: str = "",
        operator_note: str = "",
    ) -> IngestionResult:
        """Full landcover raster ingestion pipeline for a dataset version.

        Steps:
        1. Read metadata for all years
        2. Validate grid alignment (all years must share CRS, resolution, origin)
        3. Check for unexpected class codes
        4. Convert to COG and write to object store
        5. Register in the datasets table with checksum
        6. Store per-year class histograms
        """
        report = IngestReport()
        years = sorted(raster_paths.keys())

        # --- Guard: version must not already be registered ---
        if self._version_exists(version):
            report.errors.append(
                f"Dataset version '{version}' is already registered. "
                "Create a new version — never overwrite an existing one."
            )
            return IngestionResult(
                dataset_version=version,
                dataset_type="landcover",
                years_ingested=[],
                cog_paths={},
                class_histograms={},
                report=report,
            )

        # --- Step 1: Read metadata ---
        logger.info("Reading metadata for %d rasters…", len(raster_paths))
        metadatas: list[RasterMetadata] = []
        for year in years:
            path = raster_paths[year]
            if not path.exists():
                report.errors.append(f"File not found: {path}")
                continue
            try:
                meta = read_metadata(path, year)
                metadatas.append(meta)
                report.passed.append(meta)
            except Exception as exc:
                report.errors.append(f"Failed to read {path.name}: {exc}")

        if report.errors:
            return IngestionResult(
                dataset_version=version,
                dataset_type="landcover",
                years_ingested=[],
                cog_paths={},
                class_histograms={},
                report=report,
            )

        # --- Step 2: Grid alignment ---
        logger.info("Validating grid alignment across %d years…", len(metadatas))
        alignment_errors = validate_grid_alignment(metadatas)
        if alignment_errors:
            report.errors.extend(alignment_errors)
            return IngestionResult(
                dataset_version=version,
                dataset_type="landcover",
                years_ingested=[],
                cog_paths={},
                class_histograms={},
                report=report,
            )

        # --- Step 3: Class code check + histogram computation ---
        logger.info("Computing class histograms…")
        class_histograms: dict[int, dict] = {}
        for meta in metadatas:
            logger.debug("  histogram: %s (year %d)", meta.path.name, meta.year)
            hist = compute_class_histogram(meta.path)
            code_errors = check_class_codes(hist)
            if code_errors:
                report.errors.extend([f"Year {meta.year}: {e}" for e in code_errors])
            else:
                class_histograms[meta.year] = hist

        if report.errors:
            return IngestionResult(
                dataset_version=version,
                dataset_type="landcover",
                years_ingested=[],
                cog_paths={},
                class_histograms={},
                report=report,
            )

        # --- Step 4: COG conversion ---
        logger.info("Converting %d rasters to COG…", len(metadatas))
        cog_paths: dict[int, str] = {}
        object_store = Path(settings.object_store_path)

        for meta in metadatas:
            dst = object_store / "landcover" / version / f"{meta.year}.tif"
            logger.debug("  COG: %s → %s", meta.path.name, dst)
            try:
                convert_to_cog(meta.path, dst)
                is_valid, msg = validate_cog(dst)
                if not is_valid:
                    report.errors.append(f"Year {meta.year}: COG validation failed — {msg}")
                else:
                    cog_paths[meta.year] = str(dst)
            except Exception as exc:
                report.errors.append(f"Year {meta.year}: COG conversion failed — {exc}")

        if report.errors:
            return IngestionResult(
                dataset_version=version,
                dataset_type="landcover",
                years_ingested=[],
                cog_paths={},
                class_histograms={},
                report=report,
            )

        # --- Step 5: Register dataset version ---
        logger.info("Registering dataset version '%s' in database…", version)
        ref_meta = metadatas[0]
        self._register_dataset(
            version=version,
            dataset_type="landcover",
            source_url=source_url,
            license=license,
            operator_note=operator_note,
            checksum=ref_meta.checksum,
            year_min=min(years),
            year_max=max(years),
        )

        # --- Step 6: Store class histograms ---
        logger.info("Storing class histograms…")
        for year, hist in class_histograms.items():
            total = sum(hist.values())
            self._store_histogram(version, year, hist, total)

        self._db.commit()

        return IngestionResult(
            dataset_version=version,
            dataset_type="landcover",
            years_ingested=years,
            cog_paths=cog_paths,
            class_histograms=class_histograms,
            report=report,
        )

    def ingest_supporting_dataset(
        self,
        path: Path,
        version: str,
        dataset_type: str,
        source_url: str = "",
        license: str = "",
        operator_note: str = "",
    ) -> dict:
        """Ingest a supporting vector/raster dataset (roads, DEM, rivers, population, etc.)."""
        from backend.agents.ingestion.validation import _file_checksum

        if self._version_exists(version):
            return {"error": f"Version '{version}' already registered."}

        if not path.exists():
            return {"error": f"File not found: {path}"}

        checksum = _file_checksum(path)
        self._register_dataset(
            version=version,
            dataset_type=dataset_type,
            source_url=source_url,
            license=license,
            operator_note=operator_note,
            checksum=checksum,
        )
        self._db.commit()
        return {"version": version, "checksum": checksum}

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _version_exists(self, version: str) -> bool:
        row = self._db.execute(
            text("SELECT 1 FROM datasets WHERE version = :v"), {"v": version}
        ).first()
        return row is not None

    def _register_dataset(
        self,
        version: str,
        dataset_type: str,
        source_url: str,
        license: str,
        operator_note: str,
        checksum: str,
        year_min: int | None = None,
        year_max: int | None = None,
    ) -> None:
        year_range = (
            f"[{year_min},{year_max}]" if year_min is not None else None
        )
        self._db.execute(
            text(
                """
                INSERT INTO datasets
                    (version, dataset_type, source_url, license, year_range,
                     checksum, operator_note)
                VALUES
                    (:version, :dataset_type, :source_url, :license,
                     :year_range, :checksum, :operator_note)
                """
            ),
            {
                "version": version,
                "dataset_type": dataset_type,
                "source_url": source_url,
                "license": license,
                "year_range": year_range,
                "checksum": checksum,
                "operator_note": operator_note,
            },
        )

    def _store_histogram(
        self, version: str, year: int, histogram: dict[int, int], total_pixels: int
    ) -> None:
        self._db.execute(
            text(
                """
                INSERT INTO class_histograms
                    (dataset_version, year, histogram, total_pixels)
                VALUES
                    (:version, :year, :histogram, :total)
                ON CONFLICT (dataset_version, year) DO NOTHING
                """
            ),
            {
                "version": version,
                "year": year,
                "histogram": json.dumps({str(k): v for k, v in histogram.items()}),
                "total": total_pixels,
            },
        )
