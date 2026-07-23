from celery import Celery

from backend.config import get_settings

settings = get_settings()

celery = Celery(
    "nglip",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "backend.orchestrator.tasks",
        "backend.agents.ingestion.tasks",
        "backend.agents.raster.tasks",
        "backend.agents.change.tasks",
        "backend.agents.evidence.tasks",
        "backend.agents.cartography.tasks",
        "backend.agents.narrative.tasks",
        "backend.agents.report.tasks",
        "backend.agents.provenance.tasks",
        "backend.agents.validation.tasks",
    ],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "backend.orchestrator.tasks.*": {"queue": "orchestrator"},
        "backend.agents.raster.tasks.*": {"queue": "gis"},
        "backend.agents.change.tasks.*": {"queue": "gis"},
        "backend.agents.evidence.tasks.*": {"queue": "gis"},
        "backend.agents.cartography.tasks.*": {"queue": "gis"},
        "backend.agents.narrative.tasks.*": {"queue": "narrative"},
        "backend.agents.report.tasks.*": {"queue": "report"},
    },
    task_soft_time_limit=90,
    task_time_limit=120,
)
