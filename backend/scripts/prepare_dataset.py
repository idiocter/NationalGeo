"""Preprocessing script: convert raw ICIMOD Nepal land-cover TIFs to pipeline COGs.

Raw dataset (data/dataset/) → pipeline COGs (data/landcover/landcover-v3.1/<year>.tif)

What this does per file:
1. Standardise NoData: codes 0 (years 2000–2015) or 15 (year 2020) → pixel value 0,
   then set nodata=0 in the output raster metadata.
2. Reproject from EPSG:4326 to EPSG:32645 (UTM Zone 45N, equal-area for Nepal).
   Resampling = nearest-neighbour to preserve categorical integer class codes.
3. Write as Cloud-Optimised GeoTIFF (COG) with DEFLATE compression and
   overview levels [2, 4, 8, 16] for fast windowed reads.

Usage:
    python -m backend.scripts.prepare_dataset [--years 2000 2005 2010 2015 2020]

Non-destructive: raw files are never modified.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# ---- dataset layout -------------------------------------------------------

DATASET_ROOT = Path("data/dataset")
OUTPUT_ROOT = Path("data/landcover/landcover-v3.1")

RAW_PATHS: dict[int, Path] = {
    2000: DATASET_ROOT / "Copy of Land cover of Nepal 2000" / "data" / "lc2000.tif",
    2005: DATASET_ROOT / "Land cover of Nepal 2005" / "data" / "lc2005.tif",
    2010: DATASET_ROOT / "Land cover of Nepal 2010" / "data" / "lc2010.tif",
    2015: DATASET_ROOT / "Land cover of Nepal 2015" / "data" / "lc2015.tif",
    2020: DATASET_ROOT / "Land cover of Nepal 2020" / "data" / "lc2020.tif",
}

# Year 2020 uses pixel value 15 as its NoData sentinel; all others use 0.
NODATA_SENTINEL: dict[int, int] = {y: 0 for y in RAW_PATHS}
NODATA_SENTINEL[2020] = 15

TARGET_EPSG = 32645
TARGET_NODATA = 0


# ---- helpers ---------------------------------------------------------------

def _reproject_to_cog(src_path: Path, dst_path: Path, year: int) -> None:
    """Reproject, standardise nodata, and write a COG."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import calculate_default_transform, reproject

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dst_path.with_suffix(".tmp.tif")

    sentinel = NODATA_SENTINEL[year]
    dst_crs = CRS.from_epsg(TARGET_EPSG)

    with rasterio.open(src_path) as src:
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        profile = src.profile.copy()
        profile.update(
            crs=dst_crs,
            transform=transform,
            width=width,
            height=height,
            nodata=TARGET_NODATA,
            dtype="uint8",
            compress="deflate",
            predictor=2,
            driver="GTiff",
        )

        with rasterio.open(tmp_path, "w", **profile) as dst:
            data, _ = reproject(
                source=rasterio.band(src, 1),
                destination=rasterio.band(dst, 1),
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=sentinel,
                dst_transform=transform,
                dst_crs=dst_crs,
                dst_nodata=TARGET_NODATA,
                resampling=Resampling.nearest,
            )

    # Build overviews on the tmp file, then copy to COG layout
    with rasterio.open(tmp_path, "r+") as dst:
        dst.build_overviews([2, 4, 8, 16], Resampling.nearest)
        dst.update_tags(ns="rio_overview", resampling="nearest")

    _copy_to_cog(tmp_path, dst_path)
    tmp_path.unlink()
    logger.info("Wrote COG: %s", dst_path)


def _copy_to_cog(src_path: Path, dst_path: Path) -> None:
    """Re-write the file in Cloud-Optimised GeoTIFF layout using rasterio."""
    import rasterio
    from rasterio.shutil import copy as rio_copy

    with rasterio.open(src_path) as src:
        rio_copy(
            src,
            dst_path,
            driver="GTiff",
            copy_src_overviews=True,
            compress="deflate",
            predictor=2,
            tiled=True,
            blockxsize=512,
            blockysize=512,
        )


# ---- validation after conversion ------------------------------------------

def _validate_cog(path: Path, year: int) -> None:
    """Quick sanity check: CRS, nodata, class codes."""
    import rasterio
    from rasterio.crs import CRS

    with rasterio.open(path) as src:
        epsg = src.crs.to_epsg()
        assert epsg == TARGET_EPSG, f"{path}: expected EPSG:{TARGET_EPSG}, got EPSG:{epsg}"
        assert src.nodata == TARGET_NODATA, f"{path}: nodata={src.nodata}, expected {TARGET_NODATA}"
        assert src.dtypes[0] == "uint8", f"{path}: dtype={src.dtypes[0]}"

        # Sample the first block to check class codes
        for _, window in src.block_windows(1):
            block = src.read(1, window=window)
            codes = set(int(c) for c in np.unique(block))
            unexpected = codes - set(range(12)) - {TARGET_NODATA}
            if unexpected:
                logger.warning("%s year %d: unexpected codes in block: %s", path.name, year, unexpected)
            break  # check first block only

    logger.info("Validated: %s  EPSG:%d  nodata=%d", path.name, TARGET_EPSG, TARGET_NODATA)


# ---- main ------------------------------------------------------------------

def prepare(years: list[int]) -> None:
    for year in years:
        src = RAW_PATHS.get(year)
        if src is None:
            logger.error("No raw path registered for year %d", year)
            continue
        if not src.exists():
            logger.error("Raw file missing: %s", src)
            continue

        dst = OUTPUT_ROOT / f"{year}.tif"
        if dst.exists():
            logger.info("Already exists, skipping: %s", dst)
            continue

        logger.info("Processing year %d: %s → %s", year, src, dst)
        _reproject_to_cog(src, dst, year)
        _validate_cog(dst, year)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(message)s",
        datefmt="%H:%M:%S",
    )
    parser = argparse.ArgumentParser(description="Prepare Nepal LCLU dataset COGs")
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=[2000, 2005, 2010, 2015, 2020],
        metavar="YEAR",
        help="Years to process (default: 2000 2005 2010 2015 2020)",
    )
    args = parser.parse_args(argv)
    prepare(args.years)
    return 0


if __name__ == "__main__":
    sys.exit(main())
