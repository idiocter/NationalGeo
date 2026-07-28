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
import math
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

# Codes considered "forest" — true tree cover only: Forest (4) + Open Woodland (9)
_FOREST_CODES: frozenset[int] = frozenset({4, 9})


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

    import matplotlib.patheffects as pe  # noqa: PLC0415

    # Arrow shaft: from (x, y-size) to (x, y), with a white halo so it stays
    # visible over dark forest pixels.
    ann = ax.annotate(
        "", xy=(x, y), xytext=(x, y - size),
        xycoords="axes fraction", textcoords="axes fraction",
        arrowprops=dict(
            arrowstyle="-|>",
            color="#0f172a",
            lw=2,
            mutation_scale=13,
        ),
    )
    ann.arrow_patch.set_path_effects([pe.Stroke(linewidth=4, foreground="white"), pe.Normal()])
    # "N" label slightly above the arrow tip
    ax.text(
        x, y + 0.025, "N",
        transform=ax.transAxes,
        ha="center", va="bottom",
        fontsize=11, fontweight="bold", color="#0f172a",
        path_effects=[pe.Stroke(linewidth=3, foreground="white"), pe.Normal()],
    )


def _nice_round(x: float) -> float:
    """Largest 1/2/5 × 10ⁿ value ≤ x (for a tidy scale-bar length)."""
    if x <= 0:
        return 0.0
    exp  = math.floor(math.log10(x))
    base = 10 ** exp
    for m in (5, 2, 1):
        if base * m <= x:
            return base * m
    return base


def _add_scale_bar(ax, img_w_px: int, img_h_px: int, px_size_m: float | None) -> None:
    """Draw a scale bar (lower-left, in image/pixel data coords) sized to a round distance.

    A white halo (path-effect stroke) is drawn under every mark so the bar and its
    label stay legible over dark (forest) as well as light (grey/background) pixels.
    """
    import matplotlib.patheffects as pe  # noqa: PLC0415

    if not px_size_m or px_size_m <= 0 or img_w_px <= 0:
        return
    # Aim for a bar spanning ~22% of the image width, rounded to a nice value
    target_m = img_w_px * px_size_m * 0.22
    nice_m   = _nice_round(target_m)
    if nice_m <= 0:
        return
    bar_px = nice_m / px_size_m

    # Draw the scale bar just BELOW the map image (left-aligned), so it never
    # overlaps the municipality regardless of the shape's aspect ratio. The bar
    # length stays in image/pixel data units, so it still represents the true
    # map scale; clip_on=False lets it render outside the image extent.
    x0 = 0.0
    y0 = img_h_px + img_h_px * 0.045
    tick = img_h_px * 0.016

    halo  = [pe.Stroke(linewidth=4.5, foreground="white"), pe.Normal()]
    dark  = "#0f172a"

    # Main bar + end ticks (thicker, with white halo for contrast)
    ax.plot([x0, x0 + bar_px], [y0, y0], color=dark, lw=3, solid_capstyle="butt",
            zorder=6, clip_on=False, path_effects=halo)
    ax.plot([x0, x0], [y0 - tick, y0 + tick], color=dark, lw=3, zorder=6,
            clip_on=False, path_effects=halo)
    ax.plot([x0 + bar_px, x0 + bar_px], [y0 - tick, y0 + tick], color=dark, lw=3,
            zorder=6, clip_on=False, path_effects=halo)

    label = f"{nice_m / 1000:g} km" if nice_m >= 1000 else f"{nice_m:g} m"
    # Label sits below the bar
    ax.text(
        x0 + bar_px / 2, y0 + tick * 2.6, label,
        ha="center", va="top", fontsize=10, fontweight="bold", color=dark, zorder=6,
        clip_on=False,
        path_effects=[pe.Stroke(linewidth=3, foreground="white"), pe.Normal()],
    )


def _add_footer(fig, note: str | None) -> None:
    """Draw a small provenance / extent caption along the bottom of the figure."""
    if not note:
        return
    fig.text(0.5, 0.006, note, ha="center", va="bottom", fontsize=6.5, color="#888888")


def _render_comparison(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, dataset_version: str, job_id: str,
    out_path: Path, px_size_m: float | None = None, footer: str | None = None,
) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    rgb0 = _band_to_rgb(band0)
    rgb1 = _band_to_rgb(band1)
    h, w = band0.shape

    fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor="white")
    fig.suptitle(
        f"{municipality_name} — Land Cover Comparison\n"
        f"Source: {dataset_version} · NGLIP job {job_id[:8]}",
        fontsize=9, color="#444",
    )

    for ax, rgb, yr in zip(axes, [rgb0, rgb1], [y0, y1]):
        ax.imshow(rgb)
        ax.set_title(str(yr), fontsize=11, fontweight="bold")
        ax.axis("off")
        _add_north_arrow(ax, x=0.96, y=0.94, size=0.07)
        _add_scale_bar(ax, w, h, px_size_m)

    # Shared legend — only classes present in either band — centered between panels
    present_codes = sorted(set(np.unique(band0)) | set(np.unique(band1)))
    patches = [
        mpatches.Patch(
            color=tuple(v / 255 for v in _RGBA.get(c, (128, 128, 128))),
            label=CLASS_NAMES.get(c, f"Code {c}"),
        )
        for c in present_codes if c != 0
    ]
    # Reserve a bottom band for the legend (above the footer) so the two never
    # overlap. tight_layout keeps the panels above the reserved band.
    plt.tight_layout(rect=[0, 0.14, 1, 0.95])
    fig.legend(handles=patches, loc="lower center", ncol=4, fontsize=8,
               framealpha=1.0, facecolor="white", edgecolor="#d1d5db",
               bbox_to_anchor=(0.5, 0.045), title="Land Cover Class",
               title_fontsize=8)
    _add_footer(fig, footer)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Comparison map saved: %s", out_path)


def _render_forest_change_4class(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, job_id: str, out_path: Path,
    px_size_m: float | None = None, footer: str | None = None,
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
    # Municipality boundary outline (traced from the in-boundary valid mask),
    # kept consistent with the change map.
    ax.contour(
        valid.astype(float), levels=[0.5],
        colors="#111827", linewidths=1.2, antialiased=True,
    )
    ax.set_title(
        f"{municipality_name} — Forest Change Map {y0}→{y1}\n"
        f"NGLIP job {job_id[:8]}",
        fontsize=10, fontweight="bold",
    )
    ax.axis("off")
    _add_north_arrow(ax, x=0.96, y=0.94, size=0.07)
    _add_scale_bar(ax, w, h, px_size_m)

    patches = [
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_STABLE_FOREST),
            label=f"Forest → Forest — no change ({pct['stable_f']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_FOREST_LOSS),
            label=f"Forest → Non-forest — loss ({pct['loss']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_FOREST_GAIN),
            label=f"Non-forest → Forest — gain ({pct['gain']:.1f}%)",
        ),
        mpatches.Patch(
            color=tuple(v / 255 for v in _FC_STABLE_NONFOREST),
            label=f"Non-forest → Non-forest — no change ({pct['stable_nf']:.1f}%)",
        ),
    ]
    # Reserve a band at the bottom for the legend so it sits in the lower-right
    # of the image and never covers any part of the map. Footer goes below it.
    fig.subplots_adjust(left=0.03, right=0.97, top=0.92, bottom=0.17)
    fig.legend(
        handles=patches, loc="lower right", bbox_to_anchor=(0.985, 0.025),
        fontsize=9.5, framealpha=1.0, facecolor="white", edgecolor="#334155",
        title="Forest Change", title_fontsize=10.5,
        borderpad=0.8, labelspacing=0.6, handlelength=1.8, handleheight=1.4,
    )

    _add_footer(fig, footer)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Forest 4-class change map saved: %s", out_path)


def _render_change_map(
    band0: np.ndarray, band1: np.ndarray, y0: int, y1: int,
    municipality_name: str, job_id: str, out_path: Path,
    px_size_m: float | None = None, footer: str | None = None,
) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    h, w = band0.shape
    # White background so the municipality silhouette (boundary) is visible;
    # only in-boundary pixels are coloured.
    rgb = np.full((h, w, 3), (255, 255, 255), dtype=np.uint8)

    valid = (band0 != 0) & (band1 != 0)            # inside the municipality boundary

    # Forest change based on the forest binary definition (_FOREST_CODES = {4, 9}):
    #   Forest loss  = forest → non-forest  (red)
    #   Forest gain  = non-forest → forest  (green)
    #   everything else inside the boundary = stable / unchanged (grey)
    is_forest0 = np.isin(band0, list(_FOREST_CODES))
    is_forest1 = np.isin(band1, list(_FOREST_CODES))

    loss_mask = valid &  is_forest0 & ~is_forest1   # forest → non-forest
    gain_mask = valid & ~is_forest0 &  is_forest1   # non-forest → forest

    rgb[valid]     = _CHANGE_UNCHANGED   # stable base (forest-stable or non-forest-stable)
    rgb[loss_mask] = _CHANGE_LOSS
    rgb[gain_mask] = _CHANGE_GAIN

    total_px = int(valid.sum()) or 1
    pct_loss = 100.0 * int(loss_mask.sum()) / total_px
    pct_gain = 100.0 * int(gain_mask.sum()) / total_px
    pct_net  = pct_gain - pct_loss

    fig, ax = plt.subplots(figsize=(8, 8), facecolor="white")
    ax.imshow(rgb)
    # Draw the municipality boundary so the silhouette is clear even when most
    # of the interior is a uniform "unchanged" grey. The valid mask (in-boundary
    # pixels) traced at 0.5 is exactly the municipality outline in pixel space.
    ax.contour(
        valid.astype(float), levels=[0.5],
        colors="#111827", linewidths=1.2, antialiased=True,
    )
    ax.set_title(
        f"{municipality_name} — Forest Change {y0}→{y1}  (net {pct_net:+.1f}%)\n"
        f"NGLIP job {job_id[:8]}",
        fontsize=10, fontweight="bold",
    )
    ax.axis("off")
    _add_north_arrow(ax, x=0.96, y=0.94, size=0.07)
    _add_scale_bar(ax, w, h, px_size_m)

    patches = [
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_GAIN),      label=f"Forest gain — non-forest → forest ({pct_gain:.1f}%)"),
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_LOSS),      label=f"Forest loss — forest → non-forest ({pct_loss:.1f}%)"),
        mpatches.Patch(color=tuple(v/255 for v in _CHANGE_UNCHANGED), label="Stable / unchanged"),
    ]
    # Reserve a band at the bottom for the legend so it sits in the lower-right
    # of the image and never covers any part of the map. Footer goes below it.
    fig.subplots_adjust(left=0.03, right=0.97, top=0.92, bottom=0.17)
    fig.legend(
        handles=patches, loc="lower right", bbox_to_anchor=(0.985, 0.025),
        fontsize=9.5, framealpha=1.0, facecolor="white", edgecolor="#334155",
        title="Change class", title_fontsize=10.5,
        borderpad=0.8, labelspacing=0.6, handlelength=1.8, handleheight=1.4,
    )

    _add_footer(fig, footer)
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
        # Ground resolution (metres/pixel) captured from the raster transform,
        # used to draw a scale bar on the maps.
        px_size_m: float | None = None

        def _read_band(year: int) -> np.ndarray | None:
            nonlocal px_size_m
            cog = Path(settings.object_store_path) / "landcover" / dataset_ver / f"{year}.tif"
            if not cog.exists():
                return None
            with rasterio.open(cog) as src:
                epsg = src.crs.to_epsg()
                geom_r = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=epsg)
                masked, out_transform = rasterio_mask(
                    src, [geom_r.__geo_interface__],
                    crop=True, all_touched=False, filled=True,
                    nodata=int(src.nodata) if src.nodata is not None else 0,
                )
                if px_size_m is None:
                    px = abs(out_transform.a)
                    if src.crs.is_geographic:
                        # degrees → metres at the geometry centroid latitude
                        lat = geom_4326.centroid.y
                        px_size_m = px * 111_320.0 * math.cos(math.radians(lat))
                    else:
                        px_size_m = px  # projected CRS is already in metres
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

            # Provenance / extent caption shown along the bottom of every map
            from datetime import date as _date  # noqa: PLC0415
            minx, miny, maxx, maxy = geom_4326.bounds
            # Total municipality area from the latest-year statistics, if present
            latest_stats = max(
                (s for s in result.get("statistics", [])),
                key=lambda s: s.get("year", 0), default=None,
            )
            area_note = ""
            if latest_stats:
                total_km2 = sum(
                    c.get("area_km2", 0) for c in latest_stats.get("classes", [])
                    if c.get("code", 0) != 0
                )
                area_note = f"Area: {total_km2:,.0f} km²  ·  "
            footer = (
                f"{area_note}Extent: {minx:.3f}–{maxx:.3f}°E, {miny:.3f}–{maxy:.3f}°N  ·  "
                f"Source: ICIMOD Nepal Land Cover  ·  Analysis CRS EPSG:32645  ·  "
                f"Generated {_date.today().isoformat()}  ·  NGLIP job {job_id[:8]}"
            )

            _render_comparison(
                band0, band1, from_year, to_year,
                municipality_name, dataset_ver, job_id, comp_path, px_size_m, footer,
            )
            _render_change_map(
                band0, band1, from_year, to_year,
                municipality_name, job_id, change_path, px_size_m, footer,
            )
            _render_forest_change_4class(
                band0, band1, from_year, to_year,
                municipality_name, job_id, forest_4cls_path, px_size_m, footer,
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
