FROM python:3.12-slim

# System dependencies
# ── Geospatial ──────────────────────────────────────────────────────────────
# libgdal-dev   → headers for geopandas/cartopy C extensions
# libgeos-dev   → headers for shapely C extension
# libproj-dev   → pulled in by libgdal-dev; explicit for cartopy
# gdal-bin      → CLI tools (gdalinfo, gdalwarp) available inside container
# ── Database ────────────────────────────────────────────────────────────────
# libpq-dev     → psycopg2-binary compile headers
# ── WeasyPrint (PDF generation) ─────────────────────────────────────────────
# WeasyPrint renders HTML→PDF via Cairo/Pango; these must be present at
# runtime even though pip install succeeds without them.
# ── Build tools ─────────────────────────────────────────────────────────────
# gcc / g++     → C extensions (psycopg2, shapely, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libpq-dev \
    gcc \
    g++ \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# rasterio ships its own bundled GDAL in the manylinux wheel — no need to
# install the gdal Python package or match the system libgdal version.
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
