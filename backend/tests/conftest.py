"""Shared fixtures for tests that need real PostgreSQL (and, for some, Redis).

Set TEST_DATABASE_URL to a database whose name ends with ``_test``; those tests are
skipped otherwise. Each test module gets a freshly created schema.
"""

import os
from collections.abc import AsyncIterator

# Tests never touch the development Redis data: use a dedicated database number.
# Set before any app module reads settings.
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/15")

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Register every model on Base.metadata so create_all builds the full schema.
from app.auth import models as _auth_models  # noqa: F401
from app.db.base import Base
from app.scheduling import models as _scheduling_models  # noqa: F401
from app.users import models as _user_models  # noqa: F401


@pytest.fixture(scope="module")
def database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    if not (make_url(url).database or "").endswith("_test"):
        pytest.fail("Refusing to modify a database whose name does not end with _test")
    sync_engine = create_engine(make_url(url).set(drivername="postgresql+psycopg"))
    with sync_engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    with sync_engine.begin() as connection:
        connection.execute(
            text("""
            ALTER TABLE appointments ADD CONSTRAINT ex_appointments_instructor_occupied
            EXCLUDE USING gist (
                instructor_id WITH =,
                tstzrange(occupied_from, occupied_until, '[)') WITH &&
            ) WHERE (status = 'confirmed')
        """)
        )
    yield url
    Base.metadata.drop_all(sync_engine)
    sync_engine.dispose()


@pytest.fixture
async def sessions(database_url: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(make_url(database_url).set(drivername="postgresql+asyncpg"))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()
