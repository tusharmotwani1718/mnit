import asyncio

import httpx
import pytest

import core_client
from core_client import CoreClient, CoreError


def _client(handler) -> CoreClient:
    client = CoreClient("http://core.test")
    client._http = httpx.AsyncClient(base_url="http://core.test", transport=httpx.MockTransport(handler))
    return client


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(core_client, "RETRY_DELAY", 0)


def test_retries_while_core_restarts():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json={"replyText": "नमस्ते", "actions": [], "done": False, "trace": {}})

    result = asyncio.run(_client(handler).turn("s1", "हेलो"))
    assert result["replyText"] == "नमस्ते"
    assert calls["n"] == 2


def test_gives_up_when_core_stays_down():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(CoreError, match="is core running"):
        asyncio.run(_client(handler).turn("s1", "हेलो"))


def test_does_not_retry_after_core_answered():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(500, text="boom")

    with pytest.raises(CoreError):
        asyncio.run(_client(handler).turn("s1", "हेलो"))
    assert calls["n"] == 1
