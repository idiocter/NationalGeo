"""Cartography Agent — static map generation for reports.

Generates:
  1. Per-year land cover comparison panels (from_year vs to_year)
  2. Change magnitude map (highlighting gain/loss areas)

Maps are saved to {OBJECT_STORE_PATH}/reports/{job_id}/ as PNG files.
Each map is self-describing at A3 print (legend, north arrow, CRS, source, provenance ID).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

from backend.config import get_settings
from backend.contracts.models import CLASS_NAMES, CLASS_COLOURS

logger = logging.getLogger(__name__)
settings = get_settings()

VERSION = "cartography:v0.1.0"

# RGBA palette matching landcover_map.py (used for PIL rendering)
_RGBA: dict[int, tuple[int, int, int]] = {
    0:  (240, 240, 240),  # NoData — light grey
    1:  ( 74, 144, 217),  # Water Body
    2:  (176, 214, 235),  # Snow/Glacier
    3:  (196, 178, 138),  # Barren Land
    4:  ( 26, 122,  74),  # Forest
    5:  (144, 212,  75),  # Grassland
    6:  (168, 201, 127),  # Shrubland
    7:  (245, 212,  78),  # Cultivated
    8:  (214,  59,  47),  # Settlement
    9:  ( 93, 160, 111),  # Open Woodland
    10: (139, 115,  85),  # Rocky/Bare
    11: (176, 176, 176),  # Others
}

# Change map colours: unchanged grey, gain green, loss red
_CHANGE_UNCHANGED = (180, 180, 180)
_CHANGE_GAIN      = ( 46, 139,  87)  # sea green (positive)
_CHANGE_LOSS      = (204,  51,  17)  # red-orange (negative)

# 4-class forest change map colours
_FC_STABLE_NONFOREST = (168, 200, 232)   # light blue
_FC_STABLE_FOREST    = ( 45, 106,  79)   # dark green
_FC_FOREST_LOSS      = (220,  38,  38)   # red
_FC_FOREST_GAIN      = ( 29,  78, 216)   # dark blue

# Codes considered "forest" for the 4-class change map
_FOREST_CODES: frozenset[int] = frozenset({4, 5, 6, 9})


def _band_to_rgb(band: np.ndarray) -> np.ndarray:
    h, w = band.shape
    rgb = np.full((h, w, 3), _RGBA.get(0, (240, 240, 240)), dtype=np.uint8)
    for code, colour in _RGBA.items():
        rgb[band == code] = colour
    return rgb


def _add_north_arrow(ax, x: float = 0.95, y: float = 0.95, size: float = 0.06) -> None:
    """Draw a north arrow in axes-fraction coordinates (top-right by default)."""
    import matplotlib.patches as mpatches  # noqa: PLC0415
    from matplotlib.patches import FancyArrowPatch  # noqa: PLC0415

    # Arrow shaft: from (x, y-size) to (x, y)
    ax.annotate(
        "", xy=(x, y), xytext=(x, y - size),
        xycoords="axes fraction", textcoords="axes fraction",
        arrowprops=dict(
            arrowstyle="-|>",
            color="#1e293b",
            lw=1.5,
            mutation_scale=10,
        ),
    )
    # "N" label slightly above the arrow tip
    ax.text(
        x, y + 0.025, "N",
        transform=ax.transAxes,
        ha="center", va="bottom",
        fontsize=9, fontweight="bold", color="#1e293b",
    )


def _render_comparison(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, dataset_version: str, job_id: str,
    out_path: Path,
) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    rgb0 = _band_to_rgb(band0)
    rgb1 = _band_to_rgb(band1)

    fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor="white")
    fig.suptitle(
        f"{municipality_name} — Land Cover Comparison\n"
        f"Source: {dataset_version} · CRS: EPSG:4326 · NGLIP job {job_id[:8]}",
        fontsize=9, color="#444",
    )

    for ax, rgb, yr in zip(axes, [rgb0, rgb1], [y0, y1]):
        ax.imshow(rgb)
        ax.set_title(str(yr), fontsize=11, fontweight="bold")
        ax.axis("off")
        _add_north_arrow(ax, x=0.96, y=0.94, size=0.07)

    # Shared legend — only classes present in either band — centered between panels
    present_codes = sorted(set(np.unique(band0)) | set(np.unique(band1)))
    patches = [
        mpatches.Patch(
            color=tuple(v / 255 for v in _RGBA.get(c, (128, 128, 128))),
            label=CLASS_NAMES.get(c, f"Code {c}"),
        )
        for c in present_codes if c != 0
    ]
    fig.legend(handles=patches, loc="lower center", ncol=4, fontsize=7.5,
               framealpha=0.95, edgecolor="#d1d5db",
               bbox_to_anchor=(0.5, 0.0), title="Land Cover Class",
               title_fontsize=7.5)

    plt.tight_layout(rect=[0, 0.08, 1, 0.96])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Comparison map saved: %s", out_path)


def _render_forest_change_4class(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, job_id: str, out_path: Path,
) -> None:
    """4-class forest change map: Stable Non-Forest, Stable Forest, Loss, Gain."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    h, w = band0.shape
    rgb = np.zeros((h, w, 3), dtype=np.uint8)

    valid = (band0 != 0) & (band1 != 0)
    is_forest0 = np.isin(band0, list(_FOREST_CODES))
    is_forest1 = np.isin(band1, list(_FOREST_CODES))

    stable_nf = valid & ~is_forest0 & ~is_forest1
    stable_f  = valid & is_forest0  & is_forest1
    loss      = valid & is_forest0  & ~is_forest1
    gain      = valid & ~is_forest0 & is_forest1

    rgb[stable_nf] = _FC_STABLE_NONFOREST
    rgb[stable_f]  = _FC_STABLE_FOREST
    rgb[loss]      = _FC_FOREST_LOSS
    rgb[gain]      = _FC_FOREST_GAIN
    # nodata pixels remain black → replace with neutral white
    rgb[~valid] = (240, 240, 240)

    total_px = int(valid.sum()) or 1
    pct = {
        "stable_nf": 100.0 * int(stable_nf.sum()) / total_px,
        "stable_f":  100.0 * int(stable_f.sum())  / total_px,
        "loss":      100.0 * int(loss.sum())       / total_px,
        "gain":      100.0 * int(gain.sum())        / total_px,
    }

    fig, ax = plt.subplots(figsize=(8, 8), facecolor="white")
    ax.imshow(rgb)
    ax.set_title(
        f"{municipality_name} — Forest Change Map {y0}→{y1}\n"
        f"NGLIP job {job_id[:8]}",
        fontsize=10, fontweight="bold",
    )
    ax.axis("off")
    _add_north_arrow(ax, x=0.96, y=0.94, size=0.07)

    patches = [
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_STABLE_NONFOREST),
            label=f"Stable Non-Forest ({pct['stable_nf']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_STABLE_FOREST),
            label=f"Stable Forest ({pct['stable_f']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_FOREST_LOSS),
            label=f"Forest Area Loss ({pct['loss']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_FOREST_GAIN),
            label=f"Forest Area Gain ({pct['gain']:.1f}%)",
        ),
    ]
    ax.legend(handles=patches, loc="lower right", fontsize=9,
              framealpha=0.95, edgecolor="#d1d5db", title="Forest Change",
              title_fontsize=8.5)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Forest 4-class change map saved: %s", out_path)


def _render_change_map(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, job_id: str, out_path: Path,
) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    h, w = band0.shape
    rgb = np.full((h, w, 3), _CHANGE_UNCHANGED, dtype=np.uint8)

    # Mark changed pixels (exclude nodata → nodata)
    changed = (band0 != band1) & (band0 != 0) & (band1 != 0)

    # Forest/Grassland loss → red; gain of Cultivated/Settlement → orange
    loss_codes = {4, 5, 9}   # Forest, Grassland, Open Woodland
    gain_codes = {7, 8}       # Cultivated, Settlement

    loss_mask = changed & np.isin(band0, list(loss_codes)) & ~np.isin(band1, list(loss_codes))
    gain_mask = changed & np.isin(band1, list(gain_codes)) & ~np.isin(band0, list(gain_codes))

    rgb[changed] = _CHANGE_UNCHANGED  # any change = grey base
    rgb[loss_mask] = _CHANGE_LOSS
    rgb[gain_mask] = _CHANGE_GAIN

    fig, ax = plt.subplots(figsize=(8, 8), facecolor="white")
    ax.imshow(rgb)
    ax.set_title(
        f"{municipality_name} — Change Map {y0}→{y1}\n"
        f"NGLIP job {job_id[:8]}",
        fontsize=10,
    )
    ax.axis("off")

    patches = [
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_GAIN),      label="Vegetation/agricultural gain"),
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_LOSS),      label="Vegetation/forest loss"),
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_UNCHANGED), label="Unchanged"),
    ]
    ax.legend(handles=patches, loc="lower right", fontsize=8, framealpha=0.9)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Change map saved: %s", out_path)


class CartographyAgent:
    def __init__(self, db) -> None:
        self.db = db

    def render(self, job_id: str, envelope: dict) -> dict[str, str]:
        from sqlalchemy import text  # noqa: PLC0415
        import rasterio  # noqa: PLC0415
        from rasterio.mask import mask as rasterio_mask  # noqa: PLC0415
        from shapely.geometry import shape  # noqa: PLC0415
        import json as _json  # noqa: PLC0415

        from backend.contracts.geo_utils import reproject_geometry  # noqa: PLC0415

        row = self.db.execute(
            text(
                "SELECT m.name, j.result, ST_AsGeoJSON(m.geom) AS geom_json "
                "FROM jobs j JOIN municipalities m ON m.id = j.municipality_id "
                "WHERE j.id = :id"
            ),
            {"id": job_id},
        ).first()
        if not row or not row.result:
            return {}

        municipality_name = row.name
        result        = row.result
        matrices      = result.get("change_matrix", [])
        dataset_ver   = envelope.get("dataset_version", "landcover-v3.1")

        if not matrices:
            return {}

        matrix    = matrices[0]
        from_year = matrix["from_year"]
        to_year   = matrix["to_year"]
        geom_4326 = shape(_json.loads(row.geom_json))

        out_dir   = Path(settings.object_store_path) / "reports" / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        artefact_urls: dict[str, str] = {}

        def _read_band(year: int) -> np.ndarray | None:
            cog = Path(settings.object_store_path) / "landcover" / dataset_ver / f"{year}.tif"
            if not cog.exists():
                return None
            with rasterio.open(cog) as src:
                epsg = src.crs.to_epsg()
                geom_r = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=epsg)
                masked, _ = rasterio_mask(
                    src, [geom_r.__geo_interface__],
                    crop=True, all_touched=False, filled=True,
                    nodata=int(src.nodata) if src.nodata is not None else 0,
                )
            return masked[0]

        band0 = _read_band(from_year)
        band1 = _read_band(to_year)

        if band0 is not None and band1 is not None:
            # Align shapes (crop to smallest common extent)
            h = min(band0.shape[0], band1.shape[0])
            w = min(band0.shape[1], band1.shape[1])
            band0, band1 = band0[:h, :w], band1[:h, :w]

            comp_path        = out_dir / "comparison_map.png"
            change_path      = out_dir / "change_map.png"
            forest_4cls_path = out_dir / "forest_change_4class.png"

            _render_comparison(
                band0, band1, from_year, to_year,
                municipality_name, dataset_ver, job_id, comp_path,
            )
            _render_change_map(
                band0, band1, from_year, to_year,
                municipality_name, job_id, change_path,
            )
            _render_forest_change_4class(
                band0, band1, from_year, to_year,
                municipality_name, job_id, forest_4cls_path,
            )

            artefact_urls["comparison_map"]       = {"url": f"/jobs/{job_id}/maps/comparison_map.png"}
            artefact_urls["change_map"]            = {"url": f"/jobs/{job_id}/maps/change_map.png"}
            artefact_urls["forest_change_4class"]  = {"url": f"/jobs/{job_id}/maps/forest_change_4class.png"}

        # Chart PNGs (trend + Sankey) — same figures used in the PDF, saved as
        # standalone files so the website can display them. These only need the
        # statistics / change matrices, so they render even when COG bands are
        # unavailable.
        stats_list = result.get("statistics", [])
        try:
            from backend.agents.report.agent import (  # noqa: PLC0415
                _generate_sankey_png,
                _generate_trend_chart_png,
            )

            trend_png = _generate_trend_chart_png(stats_list)
            if trend_png:
                (out_dir / "trend_chart.png").write_bytes(trend_png)
                artefact_urls["trend_chart"] = {"url": f"/jobs/{job_id}/maps/trend_chart.png"}

            sankey_png = _generate_sankey_png(matrices)
            if sankey_png:
                (out_dir / "sankey.png").write_bytes(sankey_png)
                artefact_urls["sankey"] = {"url": f"/jobs/{job_id}/maps/sankey.png"}
        except Exception as exc:
            logger.warning("Chart PNG generation failed (job %s): %s", job_id, exc)

        # Persist artefact URLs into jobs.result
        if artefact_urls:
            existing = result.get("artefacts", {})
            existing.update(artefact_urls)
            self.db.execute(
                text(
                    "UPDATE jobs "
                    "SET result = COALESCE(result, '{}'::jsonb) || CAST(:patch AS jsonb) "
                    "WHERE id = :id"
                ),
                {
                    "patch": json.dumps({"artefacts": existing}),
                    "id": job_id,
                },
            )
            self.db.commit()

        return artefact_urls
