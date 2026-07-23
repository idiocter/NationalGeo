"""COG conversion pipeline for the Ingestion Agent.

Converts raw GeoTIFFs to Cloud Optimized GeoTIFF (COG) format with DEFLATE
compression and pre-built overviews. COG format enables windowed reads in the
Raster Analysis Agent, which makes per-municipality clipping ~10–50x faster
than reading the full national extent.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


OVERVIEW_LEVELS = [2, 4, 8, 16, 32]
COMPRESS = "DEFLATE"
PREDICTOR = "2"  # horizontal differencing — effective for integer classification rasters


def convert_to_cog(src_path: Path, dst_path: Path) -> Path:
    """Convert a GeoTIFF to COG with overviews.

    Uses a two-step process:
    1. gdal_translate to apply DEFLATE compression + internal tiling
    2. gdaladdo to build overviews
    3. gdal_translate with COG driver to produce the final file

    Returns the path to the output COG file.
    """
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp_f:
        tmp_path = Path(tmp_f.name)

    try:
        # Step 1: copy to temp with tiling + compression
        _run([
            "gdal_translate",
            str(src_path), str(tmp_path),
            "-of", "GTiff",
            "-co", f"COMPRESS={COMPRESS}",
            "-co", f"PREDICTOR={PREDICTOR}",
            "-co", "TILED=YES",
            "-co", "BLOCKXSIZE=512",
            "-co", "BLOCKYSIZE=512",
        ])

        # Step 2: build overviews on the temp file (nearest-neighbour for class data)
        _run([
            "gdaladdo",
            "-r", "nearest",
            str(tmp_path),
            *[str(lvl) for lvl in OVERVIEW_LEVELS],
        ])

        # Step 3: produce final COG (overviews are internalised)
        _run([
            "gdal_translate",
            str(tmp_path), str(dst_path),
            "-of", "COG",
            "-co", f"COMPRESS={COMPRESS}",
            "-co", f"PREDICTOR={PREDICTOR}",
            "-co", "RESAMPLING=NEAREST",
            "-co", "OVERVIEWS=IGNORE_EXISTING",
            "--config", "GDAL_TIFF_OVR_BLOCKSIZE", "512",
        ])

    finally:
        tmp_path.unlink(missing_ok=True)

    return dst_path


def validate_cog(path: Path) -> tuple[bool, str]:
    """Return (is_valid, message) for a COG file.

    Tries rio-cogeo first; falls back to checking that the file exists and
    has overviews embedded using rasterio.
    """
    try:
        result = subprocess.run(
            ["rio", "cogeo", "validate", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        is_valid = result.returncode == 0
        msg = result.stdout.strip() or result.stderr.strip()
        return is_valid, msg
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback: check overviews with rasterio
    try:
        import rasterio
        with rasterio.open(path) as src:
            has_overviews = any(src.overviews(b) for b in src.indexes)
            if not has_overviews:
                return False, "No overviews found — file may not be a valid COG"
            return True, "Overviews present (rio-cogeo not available for full validation)"
    except Exception as exc:
        return False, str(exc)


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\n"
            f"stderr: {result.stderr}\n"
            f"stdout: {result.stdout}"
        )
