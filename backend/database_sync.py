"""Synchronous SQLAlchemy engine for Celery workers.

Celery tasks are synchronous by default. Using the async engine from
database.py inside a Celery task would require a nested event loop,
which is fragile. This module provides a plain synchronous engine
that Celery agent code can import without any asyncio ceremony.
"""

from contextlib import contextmanager
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.config import get_settings

settings = get_settings()

# Convert any postgresql:// or postgresql+asyncpg:// URL to psycopg2 for the sync engine
_raw_url = settings.database_url
_suffix = _raw_url.split("://", 1)[1]
_sync_url = f"postgresql+psycopg2://{_suffix}"

sync_engine = create_engine(
    _sync_url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    echo=False,
)

SyncSessionLocal = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)


@contextmanager
def get_sync_db() -> Generator[Session, None, None]:
    """Context manager that yields a synchronous SQLAlchemy session."""
    session = SyncSessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
