"""HTTP client for the Yojana Darshak agent core (core/src/server.ts)."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

# Core restarts on every file change in `npm run dev`; a turn arriving during that second finds
# nothing listening. Connection errors (the request never reached core) are retried after a pause.
CONNECT_RETRIES = 2
RETRY_DELAY = 0.75


class CoreError(Exception):
    pass


class CoreClient:
    def __init__(self, base_url: str, api_key: str | None = None, timeout: float = 15.0) -> None:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any] | None:
        for attempt in range(CONNECT_RETRIES + 1):
            try:
                res = await self._http.post(path, json=body)
                break
            except httpx.ConnectError as e:
                if attempt == CONNECT_RETRIES:
                    raise CoreError(f"core unreachable at {self._http.base_url} (is core running?): {e!r}") from e
                await asyncio.sleep(RETRY_DELAY)
            except httpx.HTTPError as e:
                raise CoreError(f"core request failed: {e!r}") from e
        if res.status_code == 404:
            return None
        if res.status_code >= 400:
            raise CoreError(f"core {path} returned {res.status_code}: {res.text[:200]}")
        return res.json()

    async def turn(
        self,
        session_id: str,
        text: str,
        *,
        lang: str | None = None,
        caller_number: str | None = None,
        channel: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"sessionId": session_id, "text": text}
        if lang:
            body["lang"] = lang
        if caller_number:
            body["callerNumber"] = caller_number
        if channel:
            body["channel"] = channel
        result = await self._post("/turn", body)
        if result is None:
            raise CoreError("core /turn returned 404")
        return result

    async def set_language(self, session_id: str, lang: str) -> dict[str, Any] | None:
        return await self._post(f"/sessions/{session_id}/language", {"lang": lang})

    async def end(self, session_id: str) -> None:
        await self._post(f"/sessions/{session_id}/end", {})

    async def aclose(self) -> None:
        await self._http.aclose()
