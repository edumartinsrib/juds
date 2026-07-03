from __future__ import annotations

import asyncio
import logging
import os
import socket
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import AsyncSessionLocal
from app.importer import SleepFunc, process_next_queued_run
from app.models import WorkerInstance

WORKER_STATUS_STARTING = "starting"
WORKER_STATUS_IDLE = "idle"
WORKER_STATUS_WORKING = "working"
WORKER_STATUS_STOPPED = "stopped"
WORKER_STATUS_FAILED = "failed"
WORKER_HEARTBEAT_STALE_SECONDS = 30

logger = logging.getLogger("juds.worker_control")
_managed_tasks: dict[str, asyncio.Task[None]] = {}


def start_api_worker(
    worker_id: str,
    *,
    max_jobs: int | None = None,
    poll_interval_seconds: int = 5,
) -> None:
    current = _managed_tasks.get(worker_id)
    if current and not current.done():
        return
    task = asyncio.create_task(
        run_worker_loop(
            AsyncSessionLocal,
            worker_id=worker_id,
            kind="api",
            max_jobs=max_jobs,
            poll_interval_seconds=poll_interval_seconds,
        )
    )
    _managed_tasks[worker_id] = task
    task.add_done_callback(lambda _: _managed_tasks.pop(worker_id, None))


async def create_worker_instance(
    session: AsyncSession,
    *,
    name: str | None = None,
    kind: str,
    poll_interval_seconds: int = 5,
) -> WorkerInstance:
    now = _now()
    worker = WorkerInstance(
        name=name or default_worker_name(kind),
        kind=kind,
        status=WORKER_STATUS_STARTING,
        hostname=socket.gethostname(),
        process_id=os.getpid(),
        started_at=now,
        heartbeat_at=now,
        poll_interval_seconds=poll_interval_seconds,
        stop_requested=False,
    )
    session.add(worker)
    await session.commit()
    await session.refresh(worker)
    return worker


async def run_worker_loop(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    worker_id: str,
    kind: str,
    max_jobs: int | None = None,
    poll_interval_seconds: int = 5,
    sleep: SleepFunc = asyncio.sleep,
) -> None:
    jobs_processed = 0
    await _mark_worker(
        session_factory,
        worker_id,
        status=WORKER_STATUS_IDLE,
        kind=kind,
        clear_current=True,
    )
    try:
        while True:
            if await _worker_should_stop(session_factory, worker_id):
                break

            try:
                processed = await process_next_queued_run(
                    session_factory,
                    worker_id=worker_id,
                    sleep=sleep,
                )
            except Exception as exc:
                logger.exception("Worker %s falhou ao processar busca", worker_id)
                await _mark_worker(
                    session_factory,
                    worker_id,
                    status=WORKER_STATUS_FAILED,
                    last_error=_sanitize_error(exc),
                    clear_current=True,
                )
                await sleep(max(poll_interval_seconds, 1))
                continue

            if processed:
                jobs_processed += 1
                if max_jobs is not None and jobs_processed >= max_jobs:
                    break
                continue

            await sleep(max(poll_interval_seconds, 1))
    finally:
        await _mark_worker(
            session_factory,
            worker_id,
            status=WORKER_STATUS_STOPPED,
            stopped=True,
            clear_current=True,
        )


def default_worker_name(kind: str) -> str:
    return f"{kind}-{socket.gethostname()}-{os.getpid()}"


async def _worker_should_stop(
    session_factory: async_sessionmaker[AsyncSession],
    worker_id: str,
) -> bool:
    async with session_factory() as session:
        worker = await session.get(WorkerInstance, worker_id)
        return worker is None or worker.stop_requested


async def _mark_worker(
    session_factory: async_sessionmaker[AsyncSession],
    worker_id: str,
    *,
    status: str,
    kind: str | None = None,
    last_error: str | None = None,
    clear_current: bool = False,
    stopped: bool = False,
) -> None:
    async with session_factory() as session:
        worker = await session.get(WorkerInstance, worker_id)
        if not worker:
            return
        worker.status = status
        worker.heartbeat_at = _now()
        if kind:
            worker.kind = kind
        if last_error is not None:
            worker.last_error = last_error
        elif status in {WORKER_STATUS_IDLE, WORKER_STATUS_WORKING}:
            worker.last_error = None
        if clear_current:
            worker.current_run_id = None
        if stopped:
            worker.stopped_at = _now()
            worker.current_run_id = None
        await session.commit()


def _sanitize_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:512]


def _now() -> datetime:
    return datetime.now(timezone.utc)
