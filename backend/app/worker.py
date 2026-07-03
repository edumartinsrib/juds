from __future__ import annotations

import asyncio
import logging

from app.db import AsyncSessionLocal
from app.worker_control import create_worker_instance, run_worker_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("juds.worker")


async def run_forever() -> None:
    async with AsyncSessionLocal() as session:
        worker = await create_worker_instance(session, kind="service")
    logger.info("Worker registrado id=%s name=%s", worker.id, worker.name)
    await run_worker_loop(
        AsyncSessionLocal,
        worker_id=worker.id,
        kind="service",
        poll_interval_seconds=worker.poll_interval_seconds,
        sleep=asyncio.sleep,
    )


def main() -> None:
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
