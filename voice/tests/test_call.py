"""Offline tests for Call: fake LiveKit session/room, core mocked with httpx.MockTransport."""

from __future__ import annotations

import asyncio
import json
import os

import httpx

os.environ.setdefault("GNANI_API_KEY", "test")  # YojanaAgent builds Gnani STT/TTS clients
os.environ.setdefault("CORE_URL", "http://core")

import agent  # noqa: E402
from core_client import CoreClient  # noqa: E402


class FakeHandle:
    def __init__(self, log: list) -> None:
        self.log = log

    async def wait_for_playout(self) -> None:
        self.log.append(("playout_done",))


class FakeSession:
    def __init__(self) -> None:
        self.log: list = []

    def say(self, text: str, **kwargs) -> FakeHandle:
        self.log.append(("say", text))
        return FakeHandle(self.log)

    def update_agent(self, agent_obj) -> None:
        self.log.append(("update_agent", agent_obj))


class FakeParticipant:
    def __init__(self) -> None:
        self.texts: list[tuple[str, str]] = []

    async def send_text(self, text: str, topic: str) -> None:
        self.texts.append((topic, text))


class FakeRoom:
    def __init__(self) -> None:
        self.local_participant = FakeParticipant()


class FakeCtx:
    def __init__(self) -> None:
        self.room = FakeRoom()
        self.deleted = False

    async def delete_room(self) -> None:
        self.deleted = True

    def shutdown(self, reason: str = "") -> None:
        pass


def result(reply: str, *, actions=None, done=False, lang="hi") -> dict:
    return {"replyText": reply, "actions": actions or [], "done": done, "trace": {"lang": lang, "state": "collecting"}}


def make_call(handler, *, lang="hi"):
    requests: list[tuple[str, dict]] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        requests.append((request.url.path, body))
        return await handler(request.url.path, body)

    core = CoreClient("http://core", "secret")
    core._http = httpx.AsyncClient(base_url="http://core", transport=httpx.MockTransport(transport))
    session, ctx = FakeSession(), FakeCtx()
    call = agent.Call(ctx, session, core, session_id="room-job", lang=lang, caller_number="+911", channel="phone")
    return call, session, ctx, requests


def says(session: FakeSession) -> list[str]:
    return [e[1] for e in session.log if e[0] == "say"]


def test_greeting_sends_caller_details_and_publishes_trace():
    async def handler(path, body):
        return httpx.Response(200, json=result("नमस्ते!"))

    async def run():
        call, session, ctx, requests = make_call(handler)
        await call.start()
        assert requests == [("/turn", {"sessionId": "room-job", "text": "", "lang": "hi", "callerNumber": "+911", "channel": "phone"})]
        assert says(session) == ["नमस्ते!"]
        topic, payload = ctx.room.local_participant.texts[0]
        assert topic == agent.TRACE_TOPIC and json.loads(payload)["state"] == "collecting"

    asyncio.run(run())


def test_slow_core_gets_a_filler_first():
    async def handler(path, body):
        await asyncio.sleep(0.3)
        return httpx.Response(200, json=result("आप किस राज्य में रहते हैं?"))

    async def run():
        agent.FILLER_AFTER = 0.05
        call, session, _, _ = make_call(handler)
        await call.on_user_text("मेरे पास ज़मीन है")
        filler, reply = says(session)
        assert filler in agent.FILLERS["hi"]
        assert reply == "आप किस राज्य में रहते हैं?"

    asyncio.run(run())


def test_fillers_vary_and_never_repeat_back_to_back():
    picks, last = [], None
    for _ in range(200):
        last = agent.pick_filler("mr", last)
        picks.append(last)
    assert all(a != b for a, b in zip(picks, picks[1:]))
    assert set(picks) == set(agent.FILLERS["mr"])
    for lang in ("hi", "mr", "en"):
        assert len(agent.FILLERS[lang]) >= 4


def test_fast_core_has_no_filler():
    async def handler(path, body):
        return httpx.Response(200, json=result("ठीक है"))

    async def run():
        agent.FILLER_AFTER = 1.0
        call, session, _, _ = make_call(handler)
        await call.on_user_text("हाँ")
        assert says(session) == ["ठीक है"]

    asyncio.run(run())


def test_language_switch_happens_before_the_reply_is_spoken():
    async def handler(path, body):
        return httpx.Response(200, json=result("ठीक आहे, आता मराठीत बोलूया.", actions=[{"type": "SET_LANGUAGE", "lang": "mr"}]))

    async def run():
        call, session, _, _ = make_call(handler)
        await call.on_user_text("माझ्याकडे शेती आहे")
        kinds = [e[0] for e in session.log]
        assert kinds == ["update_agent", "say"]
        assert call.lang == "mr"
        assert isinstance(session.log[0][1], agent.YojanaAgent)

    asyncio.run(run())


def test_keypad_language_choice_calls_core_and_ignores_unknown():
    async def handler(path, body):
        assert path == "/sessions/room-job/language" and body == {"lang": "mr"}
        return httpx.Response(200, json=result("ठीक आहे", actions=[{"type": "SET_LANGUAGE", "lang": "mr"}]))

    async def run():
        call, session, _, requests = make_call(handler)
        await call.set_language("ta")
        assert requests == []
        await call.set_language("mr")
        assert call.lang == "mr" and says(session) == ["ठीक आहे"]

    asyncio.run(run())


def test_done_waits_for_playout_then_ends_and_hangs_up():
    async def handler(path, body):
        if path == "/turn":
            return httpx.Response(200, json=result("धन्यवाद!", done=True))
        return httpx.Response(200, json={"ended": True})

    async def run():
        call, session, ctx, requests = make_call(handler)
        await call.on_user_text("हाँ")
        assert session.log[-2:] == [("say", "धन्यवाद!"), ("playout_done",)]
        assert ("/sessions/room-job/end", {}) in requests
        assert ctx.deleted
        await call.end(hang_up=True)  # idempotent
        assert sum(1 for p, _ in requests if p.endswith("/end")) == 1

    asyncio.run(run())


def test_core_down_speaks_an_apology_instead_of_silence():
    async def handler(path, body):
        return httpx.Response(500, text="boom")

    async def run():
        call, session, ctx, _ = make_call(handler)
        await call.on_user_text("हैलो")
        assert says(session) == [agent.CORE_DOWN["hi"]]
        assert not ctx.deleted

    asyncio.run(run())
