from __future__ import annotations

import asyncio
import logging

from app.db import AsyncSessionLocal
from app.importer import process_next_queued_run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("juds.worker")


async def run_forever() -> None:
    while True:
        try:
            processed = await process_next_queued_run(AsyncSessionLocal)
        except Exception:
            logger.exception("Falha ao processar busca pendente")
            processed = True
        if not processed:
            await asyncio.sleep(5)


def main() -> None:
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
