from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.scheduling.models import Appointment, Student
from app.search.meili import delete_appointment_document, index_appointment_documents
from app.users.models import Instructor


def appointment_document(
    appointment: Appointment,
    student: Student | None,
    instructor: Instructor,
) -> dict[str, Any]:
    return {
        "id": str(appointment.id),
        "booking_reference": str(appointment.id),
        "instructor_id": str(appointment.instructor_id),
        "instructor_name": instructor.display_name,
        "student_name": student.name if student else "",
        "parent_name": (student.parent_name or "") if student else "",
        "student_email": student.email if student else "",
        "status": appointment.status,
    }


async def sync_appointment(db: AsyncSession, appointment_id: UUID) -> None:
    row = (
        await db.execute(
            select(Appointment, Student, Instructor)
            .outerjoin(Student, Student.id == Appointment.student_id)
            .join(Instructor, Instructor.id == Appointment.instructor_id)
            .where(Appointment.id == appointment_id)
        )
    ).one_or_none()
    if row is None:
        await delete_appointment_document(str(appointment_id))
        return
    appointment, student, instructor = row
    await index_appointment_documents([appointment_document(appointment, student, instructor)])


async def rebuild_appointment_index(db: AsyncSession, batch_size: int = 500) -> int:
    rows = (
        await db.execute(
            select(Appointment, Student, Instructor)
            .outerjoin(Student, Student.id == Appointment.student_id)
            .join(Instructor, Instructor.id == Appointment.instructor_id)
            .order_by(Appointment.id)
        )
    ).all()
    documents = [appointment_document(*row) for row in rows]
    for start in range(0, len(documents), batch_size):
        await index_appointment_documents(documents[start : start + batch_size])
    return len(documents)
