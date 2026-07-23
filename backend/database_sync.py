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

# Convert asyncpg URL → psycopg2 URL for the sync engine
_sync_url = settings.database_url.replace(
    "postgresql+asyncpg://", "postgresql+psycopg2://"
)

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
