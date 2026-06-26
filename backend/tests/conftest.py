from collections.abc import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.db import create_all, drop_all


@pytest_asyncio.fixture(autouse=True)
async def database() -> AsyncIterator[None]:
    db.configure_database("sqlite+aiosqlite:///:memory:")
    await create_all()
    yield
    await drop_all()
    await db.engine.dispose()


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with db.AsyncSessionLocal() as test_session:
        yield test_session
