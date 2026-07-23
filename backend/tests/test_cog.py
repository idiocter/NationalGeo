"""Tests for COG conversion utilities.

Only tests the pure-logic parts (validate_cog fallback, _run error handling)
since convert_to_cog requires a live GDAL installation with COG driver support.
The integration test is marked slow and skipped in CI unless GDAL is available.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestValidateCog:
    def test_returns_false_for_nonexistent_file(self, tmp_path):
        from backend.agents.ingestion.cog import validate_cog

        ok, msg = validate_cog(tmp_path / "missing.tif")
        assert not ok

    def test_returns_true_with_overviews(self, tmp_path):
        """Validate the rasterio fallback path when rio cogeo is not installed."""
        import numpy as np
        import rasterio
        from rasterio.crs import CRS
        from rasterio.transform import from_origin
        from backend.agents.ingestion.cog import validate_cog

        p = tmp_path / "with_overviews.tif"
        transform = from_origin(500000, 3100000, 30, 30)
        data = np.ones((1, 128, 128), dtype=np.uint8)

        with rasterio.open(
            p, "w", driver="GTiff", width=128, height=128, count=1,
            dtype="uint8", crs=CRS.from_epsg(32645), transform=transform,
        ) as dst:
            dst.write(data)

        # Mock overviews so we don't need to actually build them
        mock_src = MagicMock()
        mock_src.__enter__ = MagicMock(return_value=mock_src)
        mock_src.__exit__ = MagicMock(return_value=False)
        mock_src.indexes = [1]
        mock_src.overviews = MagicMock(return_value=[2, 4, 8])

        with patch("rasterio.open", return_value=mock_src):
            with patch("subprocess.run") as mock_run:
                # Make rio cogeo unavailable
                mock_run.side_effect = FileNotFoundError
                ok, msg = validate_cog(p)

        assert ok
        assert "overviews" in msg.lower()


class TestRunHelper:
    def test_raises_on_nonzero_exit(self):
        from backend.agents.ingestion.cog import _run

        with pytest.raises(RuntimeError, match="Command failed"):
            _run(["false"])  # 'false' always exits with code 1

    def test_passes_on_zero_exit(self):
        from backend.agents.ingestion.cog import _run

        _run(["true"])  # 'true' always exits with code 0


@pytest.mark.slow
@pytest.mark.skipif(
    not bool(subprocess.run(["which", "gdal_translate"], capture_output=True).returncode == 0),
    reason="GDAL not installed",
)
class TestConvertToCogIntegration:
    def test_converts_tif_to_cog(self, tmp_path):
        import numpy as np
        import rasterio
        from rasterio.crs import CRS
        from rasterio.transform import from_origin
        from backend.agents.ingestion.cog import convert_to_cog, validate_cog

        src = tmp_path / "src.tif"
        dst = tmp_path / "dst_cog.tif"

        transform = from_origin(500000, 3100000, 30, 30)
        data = np.random.choice([1, 2, 3], size=(1, 256, 256)).astype(np.uint8)
        with rasterio.open(
            src, "w", driver="GTiff", width=256, height=256, count=1,
            dtype="uint8", crs=CRS.from_epsg(32645), transform=transform,
        ) as f:
            f.write(data)

        convert_to_cog(src, dst)
        assert dst.exists()
        ok, msg = validate_cog(dst)
        assert ok, msg
