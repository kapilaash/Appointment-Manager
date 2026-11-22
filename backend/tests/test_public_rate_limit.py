from types import SimpleNamespace

import pytest

from app.scheduling import routes


class FakeRedis:
    def __init__(self) -> None:
        self.keys: list[str] = []

    async def eval(self, _script: str, _count: int, key: str, _window: int) -> int:
        self.keys.append(key)
        return len([k for k in self.keys if k == key])


@pytest.mark.parametrize("spoofed", ["203.0.113.7", "198.51.100.9"])
async def test_public_rate_limit_ignores_client_supplied_ip_headers(monkeypatch, spoofed: str) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(routes, "get_redis_client", lambda: redis)
    honest = SimpleNamespace(headers={}, client=SimpleNamespace(host="192.0.2.10"))
    spoofing = SimpleNamespace(headers={"x-client-ip": spoofed, "x-forwarded-for": spoofed}, client=SimpleNamespace(host="192.0.2.10"))

    await routes._enforce_public_rate_limit(honest, scope="create", limit=5, window_seconds=60)
    await routes._enforce_public_rate_limit(spoofing, scope="create", limit=5, window_seconds=60)

    # Both requests come from the same verified address, so they share one counter.
    assert len(set(redis.keys)) == 1
