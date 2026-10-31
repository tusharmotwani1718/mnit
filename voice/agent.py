"""Yojana Darshak voice worker: LiveKit Agents + Gnani speech, replies from the TypeScript core.

The worker never decides what to say. Each caller turn goes to core `POST /turn`; the reply text
is spoken with Gnani TTS, and the turn's trace is sent to the browser panel.

Run:  uv run agent.py console    (laptop mic + speaker, quickest test; still needs core running)
      uv run agent.py dev        (connects to LiveKit Cloud using LIVEKIT_* from .env)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from typing import Any

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, StopResponse, cli, room_io
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.plugins import gnani, noise_cancellation, silero

from core_client import CoreClient, CoreError

load_dotenv()
logger = logging.getLogger("yojana-voice")

LANG_CODES = {"hi": "hi-IN", "mr": "mr-IN", "en": "en-IN"}
VOICES = {
    "hi": os.getenv("GNANI_VOICE_HI", "Nalini"),
    "mr": os.getenv("GNANI_VOICE_MR", "Zahira"),
    "en": os.getenv("GNANI_VOICE_EN", "Kaveri"),
}
# Spoken while the core is still working (latency masking), picked at random without repeating
# the previous one. Female voice, so feminine verb forms.
FILLERS = {
    "hi": [
        "एक सेकंड, मैं देख रही हूँ।",
        "कृपया लाइन पर बने रहिए।",
        "बस एक पल, जानकारी निकाल रही हूँ।",
        "ठीक है, मैं जाँच कर रही हूँ।",
        "थोड़ा रुकिए, अभी बताती हूँ।",
    ],
    "mr": [
        "एक सेकंद, मी बघते.",
        "कृपया लाईनवर राहा.",
        "जरा थांबा, माहिती काढते.",
        "ठीक आहे, मी तपासते.",
        "एक क्षण, लगेच सांगते.",
    ],
    "en": [
        "One moment, let me check.",
        "Please stay on the line.",
        "Just a second, I'm looking that up.",
        "Okay, checking that for you.",
        "Bear with me a moment.",
    ],
}
# Spoken if the core can't be reached, so the line never goes silent.
CORE_DOWN = {
    "hi": "माफ़ कीजिए, अभी थोड़ी दिक्कत है। कृपया फिर से बताइए।",
    "mr": "माफ करा, सध्या थोडी अडचण आहे. कृपया पुन्हा सांगा.",
    "en": "Sorry, something went wrong on our side. Please say that again.",
}
DTMF_LANG = {"1": "hi", "2": "mr"}
TRACE_TOPIC = "yojana.trace"  # worker → browser: engine trace after every turn
LANG_TOPIC = "yojana.lang"  # browser → worker: language button pressed ("hi" | "mr" | "en")

FILLER_AFTER = float(os.getenv("FILLER_AFTER_SECONDS", "1.5"))
DEFAULT_LANG = os.getenv("DEFAULT_LANG", "hi")

# Background-noise tolerance (LiveKit defaults in brackets). Raise these if the agent still stops
# for noise; lower them if it ignores real speech.
VAD_ACTIVATION = float(os.getenv("VAD_ACTIVATION_THRESHOLD", "0.65"))  # speech probability [0.5]
VAD_MIN_SPEECH = float(os.getenv("VAD_MIN_SPEECH_SECONDS", "0.2"))  # ignore shorter blips [0.05]
MIN_INTERRUPTION = float(os.getenv("MIN_INTERRUPTION_SECONDS", "0.8"))  # speech needed to cut the agent off [0.5]
NOISE_CANCELLATION = os.getenv("NOISE_CANCELLATION", "on") == "on"


def pick_filler(lang: str, last: str | None) -> str:
    options = [f for f in FILLERS[lang] if f != last] or FILLERS[lang]
    return random.choice(options)


def make_stt(lang: str) -> gnani.STT:
    # Gnani streaming STT needs the language up front and can't change it mid-stream,
    # so a language switch swaps in a new agent with a new STT (see Call.switch_agent).
    return gnani.STT(language=LANG_CODES[lang])


def make_tts(lang: str) -> gnani.TTS:
    # timbre-v2.5 is required for Marathi; used for every language for one consistent voice family.
    return gnani.TTS(model="timbre-v2.5", voice=VOICES[lang], language=LANG_CODES[lang], synthesize_method="sse")


class Call:
    """One phone or browser call: owns the core session and speaks its replies."""

    def __init__(
        self,
        ctx: JobContext,
        session: AgentSession,
        core: CoreClient,
        *,
        session_id: str,
        lang: str,
        caller_number: str | None,
        channel: str,
    ) -> None:
        self.ctx = ctx
        self.session = session
        self.core = core
        self.session_id = session_id
        self.lang = lang
        self.caller_number = caller_number
        self.channel = channel
        self._lock = asyncio.Lock()  # one core request at a time, in order
        self._ended = False
        self._last_filler: str | None = None

    async def start(self) -> None:
        async with self._lock:
            try:
                result = await self.core.turn(
                    self.session_id, "", lang=self.lang, caller_number=self.caller_number, channel=self.channel
                )
            except CoreError:
                logger.exception("core unavailable at call start")
                self.session.say(CORE_DOWN[self.lang])
                return
            await self._apply(result)

    async def on_user_text(self, text: str) -> None:
        async with self._lock:
            request = asyncio.create_task(self.core.turn(self.session_id, text))
            done, _ = await asyncio.wait({request}, timeout=FILLER_AFTER)
            if not done:
                self._last_filler = pick_filler(self.lang, self._last_filler)
                self.session.say(self._last_filler, add_to_chat_ctx=False)
            try:
                result = await request
            except CoreError:
                logger.exception("core turn failed")
                self.session.say(CORE_DOWN[self.lang])
                return
            await self._apply(result)

    async def set_language(self, lang: str) -> None:
        if lang not in LANG_CODES or self._ended:
            return
        async with self._lock:
            try:
                result = await self.core.set_language(self.session_id, lang)
            except CoreError:
                logger.exception("core language switch failed")
                return
            if result:
                await self._apply(result)

    async def _apply(self, result: dict[str, Any]) -> None:
        # Switch voice/STT first so the reply is already spoken in the new language.
        for action in result.get("actions", []):
            if action.get("type") == "SET_LANGUAGE":
                self.switch_agent(action["lang"])
        await self._publish_trace(result.get("trace"))
        handle = self.session.say(result["replyText"]) if result.get("replyText") else None
        if result.get("done"):
            if handle:
                await handle.wait_for_playout()
            await self.end(hang_up=True)

    def switch_agent(self, lang: str) -> None:
        if lang == self.lang or lang not in LANG_CODES:
            return
        logger.info("switching language %s -> %s", self.lang, lang)
        self.lang = lang
        self.session.update_agent(YojanaAgent(self, lang))

    async def _publish_trace(self, trace: Any) -> None:
        if trace is None:
            return
        try:
            await self.ctx.room.local_participant.send_text(json.dumps(trace, ensure_ascii=False), topic=TRACE_TOPIC)
        except Exception:
            logger.warning("could not publish trace", exc_info=True)

    async def end(self, *, hang_up: bool) -> None:
        if self._ended:
            return
        self._ended = True
        try:
            await self.core.end(self.session_id)
        except CoreError:
            logger.warning("core session end failed", exc_info=True)
        if hang_up:
            try:
                await self.ctx.delete_room()  # disconnects the phone line / browser
            except Exception:
                logger.warning("delete_room failed; shutting down job", exc_info=True)
                self.ctx.shutdown("call finished")


class YojanaAgent(Agent):
    def __init__(self, call: Call, lang: str) -> None:
        super().__init__(
            instructions="Replies come from the Yojana Darshak core; this agent only listens and speaks.",
            stt=make_stt(lang),
            tts=make_tts(lang),
        )
        self.call = call

    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage) -> None:
        text = (new_message.text_content or "").strip()
        if text:
            await self.call.on_user_text(text)
        # The session has no LLM; the reply was already spoken from the core's text.
        raise StopResponse()


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(activation_threshold=VAD_ACTIVATION, min_speech_duration=VAD_MIN_SPEECH)


server.setup_fnc = prewarm


@server.rtc_session(agent_name=os.getenv("AGENT_NAME", ""))
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    # Console mode (`agent.py console`: laptop mic/speaker) has no remote participant to wait for.
    try:
        participant = None if ctx.is_fake_job() else await ctx.wait_for_participant()
    except RuntimeError as e:
        # The caller hung up (or the browser page closed) before the agent joined: nothing to do.
        logger.info("caller left before the call started (%s); ending job", e)
        return
    attributes = participant.attributes if participant else {}

    is_phone = participant is not None and participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
    lang = attributes.get("yojana.lang", DEFAULT_LANG)  # browser page may preset the language
    if lang not in LANG_CODES:
        lang = "hi"

    core = CoreClient(os.environ["CORE_URL"], os.getenv("CORE_API_KEY") or None)
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        # A short noise must last MIN_INTERRUPTION to cut the agent off; if no words follow,
        # the agent resumes what it was saying.
        turn_handling={"interruption": {"min_duration": MIN_INTERRUPTION, "resume_false_interruption": True}},
    )
    call = Call(
        ctx,
        session,
        core,
        session_id=f"{ctx.room.name}-{ctx.job.id}",
        lang=lang,
        caller_number=attributes.get("sip.phoneNumber") if is_phone else None,
        channel="phone" if is_phone else ("browser" if participant else "console"),
    )

    @ctx.room.on("sip_dtmf_received")
    def _on_dtmf(dtmf: rtc.SipDTMF) -> None:
        if dtmf.digit in DTMF_LANG:
            asyncio.create_task(call.set_language(DTMF_LANG[dtmf.digit]))

    def _on_lang_stream(reader: rtc.TextStreamReader, _identity: str) -> None:
        async def read() -> None:
            await call.set_language((await reader.read_all()).strip())

        asyncio.create_task(read())

    ctx.room.register_text_stream_handler(LANG_TOPIC, _on_lang_stream)

    async def _on_shutdown() -> None:
        await call.end(hang_up=False)
        await core.aclose()

    ctx.add_shutdown_callback(_on_shutdown)

    # LiveKit Cloud noise cancellation on the caller's audio, before VAD and STT. The telephony
    # model is tuned for 8 kHz phone audio. Not available in console mode (no Cloud room).
    room_options = room_io.RoomOptions()
    if NOISE_CANCELLATION and not ctx.is_fake_job():
        nc = noise_cancellation.BVCTelephony() if is_phone else noise_cancellation.BVC()
        room_options = room_io.RoomOptions(audio_input=room_io.AudioInputOptions(noise_cancellation=nc))

    # record=False: these are real callers' voices; nothing is uploaded for session recording.
    await session.start(agent=YojanaAgent(call, lang), room=ctx.room, room_options=room_options, record=False)
    await call.start()


if __name__ == "__main__":
    cli.run_app(server)
