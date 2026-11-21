import asyncio
from typing import Any

import httpx

from app.core.config import settings

INDEX_UID = "appointments"
SEARCH_EVENT_TYPE = "appointment.search.sync"


class SearchUnavailable(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


async def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {settings.MEILISEARCH_API_KEY}"}
    try:
        async with httpx.AsyncClient(
            base_url=settings.MEILISEARCH_URL.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(10.0),
        ) as client:
            response = await client.request(method, path, **kwargs)
    except httpx.HTTPError as exc:
        raise SearchUnavailable("Meilisearch could not be reached") from exc
    if response.is_error:
        raise SearchUnavailable(f"Meilisearch returned HTTP {response.status_code}", status_code=response.status_code)
    if response.status_code == 204 or not response.content:
        return {}
    return response.json()


async def _wait_for_task(task_uid: int) -> None:
    for _ in range(100):
        task = await _request("GET", f"/tasks/{task_uid}")
        if task.get("status") == "succeeded":
            return
        if task.get("status") in {"failed", "canceled"}:
            raise SearchUnavailable("Meilisearch rejected an indexing task")
        await asyncio.sleep(0.1)
    raise SearchUnavailable("Meilisearch indexing task timed out")


async def ensure_appointment_index() -> None:
    try:
        await _request("GET", f"/indexes/{INDEX_UID}")
    except SearchUnavailable as exc:
        if exc.status_code != 404:
            raise
        task = await _request("POST", "/indexes", json={"uid": INDEX_UID, "primaryKey": "id"})
        await _wait_for_task(task["taskUid"])

    task = await _request(
        "PATCH",
        f"/indexes/{INDEX_UID}/settings",
        json={
            "searchableAttributes": [
                "student_name",
                "parent_name",
                "student_email",
                "instructor_name",
                "booking_reference",
            ],
            "filterableAttributes": ["instructor_id", "status"],
            "typoTolerance": {
                "enabled": True,
                "minWordSizeForTypos": {"oneTypo": 3, "twoTypos": 4},
                "disableOnWords": [],
                "disableOnAttributes": ["booking_reference"],
                "disableOnNumbers": True,
            },
        },
    )
    if task.get("taskUid") is not None:
        await _wait_for_task(task["taskUid"])


async def index_appointment_documents(documents: list[dict[str, Any]]) -> None:
    if not documents:
        return
    task = await _request("PUT", f"/indexes/{INDEX_UID}/documents", json=documents)
    await _wait_for_task(task["taskUid"])


async def delete_appointment_document(appointment_id: str) -> None:
    task = await _request("DELETE", f"/indexes/{INDEX_UID}/documents/{appointment_id}")
    if task.get("taskUid") is not None:
        await _wait_for_task(task["taskUid"])


async def search_appointments(
    query: str,
    *,
    limit: int = 100,
    instructor_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    filters = []
    if instructor_id:
        filters.append(f'instructor_id = "{instructor_id}"')
    if status:
        filters.append(f'status = "{status}"')
    body: dict[str, Any] = {"q": query, "limit": limit}
    if filters:
        body["filter"] = filters
    return await _request("POST", f"/indexes/{INDEX_UID}/search", json=body)
