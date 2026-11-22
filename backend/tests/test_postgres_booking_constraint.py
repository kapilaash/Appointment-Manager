import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import Base
from app.scheduling.models import Appointment, Student
from app.users.models import Instructor, User, UserRole


@pytest.fixture(scope="module")
def postgres_engine():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    engine = create_engine(url, pool_size=5, max_overflow=5)
    database = engine.url.database or ""
    if not database.endswith("_test"):
        pytest.fail("Refusing to modify a database whose name does not end with _test")
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text("""
            ALTER TABLE appointments ADD CONSTRAINT ex_appointments_instructor_occupied
            EXCLUDE USING gist (
                instructor_id WITH =,
                tstzrange(occupied_from, occupied_until, '[)') WITH &&
            ) WHERE (status = 'confirmed')
        """)
        )
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_concurrent_overlapping_bookings_allow_exactly_one(postgres_engine) -> None:
    user_id, instructor_id, student_id = uuid4(), uuid4(), uuid4()
    with Session(postgres_engine) as session:
        session.add(
            User(
                id=user_id,
                email=f"admin-{user_id}@example.test",
                password_hash="hash",
                role=UserRole.ADMIN,
                full_name="Admin",
            )
        )
        session.add(
            Instructor(id=instructor_id, user_id=user_id, display_name="Coach", timezone="UTC")
        )
        session.add(
            Student(
                id=student_id,
                name="Student",
                email=f"student-{student_id}@example.test",
                timezone="UTC",
            )
        )
        session.commit()

    start_barrier = threading.Barrier(2)
    starts = datetime(2026, 9, 1, 15, tzinfo=UTC)

    def attempt() -> str:
        appointment_id = uuid4()
        start_barrier.wait(timeout=10)
        try:
            with Session(postgres_engine) as session:
                session.add(
                    Appointment(
                        id=appointment_id,
                        instructor_id=instructor_id,
                        student_id=student_id,
                        created_by=user_id,
                        starts_at=starts,
                        ends_at=starts + timedelta(hours=1),
                        occupied_from=starts,
                        occupied_until=starts + timedelta(hours=1),
                        status="confirmed",
                        idempotency_key=str(appointment_id),
                    )
                )
                session.commit()
            return "created"
        except IntegrityError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _index: attempt(), range(2)))
    assert outcomes.count("created") == 1
    assert outcomes.count("conflict") == 1
