"""Telnyx WebSocket frame serializer with Opus and L16 HD audio support.

Vendored extension of Pipecat's TelnyxFrameSerializer (v0.0.102) that adds
OPUS and L16 codec support for HD audio at 16kHz+.

Based on pipecat-ai/pipecat PR #3602 by Syazvinski.
"""

import base64
import binascii
import json
import sys
from typing import List, Optional, Union

import aiohttp
from loguru import logger
from pydantic import BaseModel

from pipecat.audio.dtmf.types import KeypadEntry
from pipecat.audio.utils import (
    alaw_to_pcm,
    create_stream_resampler,
    pcm_to_alaw,
    pcm_to_ulaw,
    ulaw_to_pcm,
)
from pipecat.frames.frames import (
    AudioRawFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InputDTMFFrame,
    InterruptionFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer

# Optional Opus support — only needed if OPUS encoding is used
try:
    import opuslib

    OPUS_AVAILABLE = True
except (ImportError, OSError):
    OPUS_AVAILABLE = False


class OpusTelnyxSerializer(FrameSerializer):
    """Telnyx WebSocket serializer with OPUS, L16, PCMU, and PCMA support.

    Extends the standard TelnyxFrameSerializer with HD audio codecs:
    - OPUS: Compressed HD audio at 16kHz (recommended for voice AI)
    - L16: Uncompressed linear PCM at 16kHz
    - PCMU/PCMA: Legacy G.711 at 8kHz (backwards compatible)

    For OPUS, serialize() returns a list of JSON messages (one per 20ms frame)
    because Opus requires fixed frame boundaries. The transport must handle
    list payloads — see patch_transport_for_opus().
    """

    SUPPORTED_ENCODINGS = ("PCMU", "PCMA", "OPUS", "L16")

    class InputParams(BaseModel):
        telnyx_sample_rate: int = 16000
        sample_rate: Optional[int] = None
        inbound_encoding: str = "OPUS"
        outbound_encoding: str = "OPUS"
        auto_hang_up: bool = True

    def __init__(
        self,
        stream_id: str,
        outbound_encoding: str,
        inbound_encoding: str,
        call_control_id: Optional[str] = None,
        api_key: Optional[str] = None,
        params: Optional[InputParams] = None,
    ):
        self._stream_id = stream_id
        self._call_control_id = call_control_id
        self._api_key = api_key
        self._params = params or OpusTelnyxSerializer.InputParams()
        self._params.outbound_encoding = outbound_encoding
        self._params.inbound_encoding = inbound_encoding

        # Validate encodings
        if inbound_encoding not in self.SUPPORTED_ENCODINGS:
            raise ValueError(
                f"Unsupported inbound_encoding: {inbound_encoding}. "
                f"Supported: {self.SUPPORTED_ENCODINGS}"
            )
        if outbound_encoding not in self.SUPPORTED_ENCODINGS:
            raise ValueError(
                f"Unsupported outbound_encoding: {outbound_encoding}. "
                f"Supported: {self.SUPPORTED_ENCODINGS}"
            )

        # Validate Opus availability
        if "OPUS" in (inbound_encoding, outbound_encoding) and not OPUS_AVAILABLE:
            raise ImportError(
                "OPUS encoding requires opuslib: pip install opuslib. "
                "Also ensure libopus is installed (apt-get install libopus-dev)."
            )

        self._telnyx_sample_rate = self._params.telnyx_sample_rate
        self._sample_rate = 0  # Set during setup() from pipeline StartFrame

        self._input_resampler = create_stream_resampler()
        self._output_resampler = create_stream_resampler()
        self._hangup_attempted = False

        # Opus encoder/decoder (lazy-initialized on first use)
        self._opus_encoder = None
        self._opus_decoder = None

        # Opus frame buffering — must encode in exact 20ms chunks.
        # At 16kHz: 20ms = 320 samples = 640 bytes (16-bit PCM)
        self._opus_frame_samples = self._telnyx_sample_rate // 50  # 20ms
        self._opus_frame_bytes = self._opus_frame_samples * 2  # 16-bit = 2 bytes/sample
        self._opus_encode_buffer = bytearray()

        logger.info(
            f"OpusTelnyxSerializer initialized: "
            f"in={inbound_encoding}, out={outbound_encoding}, "
            f"rate={self._telnyx_sample_rate}Hz, "
            f"opus_frame={self._opus_frame_bytes}B ({self._opus_frame_samples} samples)"
        )

    def _get_opus_encoder(self):
        if self._opus_encoder is None and OPUS_AVAILABLE:
            self._opus_encoder = opuslib.Encoder(
                self._telnyx_sample_rate, 1, opuslib.APPLICATION_VOIP
            )
            logger.debug(f"Opus encoder created: {self._telnyx_sample_rate}Hz mono VOIP")
        return self._opus_encoder

    def _get_opus_decoder(self):
        if self._opus_decoder is None and OPUS_AVAILABLE:
            self._opus_decoder = opuslib.Decoder(self._telnyx_sample_rate, 1)
            logger.debug(f"Opus decoder created: {self._telnyx_sample_rate}Hz mono")
        return self._opus_decoder

    async def setup(self, frame: StartFrame):
        self._sample_rate = self._params.sample_rate or frame.audio_in_sample_rate
        logger.info(
            f"OpusTelnyxSerializer setup: pipeline_rate={self._sample_rate}Hz, "
            f"telnyx_rate={self._telnyx_sample_rate}Hz"
        )

    async def serialize(
        self, frame: Frame
    ) -> Union[str, bytes, List[str], None]:
        """Serialize a Pipecat frame to Telnyx WebSocket format.

        For OPUS encoding, returns a list of JSON strings (one per 20ms Opus frame).
        For all other encodings, returns a single JSON string.
        """
        # End/Cancel → hang up
        if (
            self._params.auto_hang_up
            and not self._hangup_attempted
            and isinstance(frame, (EndFrame, CancelFrame))
        ):
            self._hangup_attempted = True
            await self._hang_up_call()
            return None

        # Interruption → clear buffer
        if isinstance(frame, InterruptionFrame):
            self._opus_encode_buffer.clear()
            return json.dumps({"event": "clear"})

        if not isinstance(frame, AudioRawFrame):
            return None

        data = frame.audio

        # ── OPUS encode ──────────────────────────────────────────
        if self._params.inbound_encoding == "OPUS":
            resampled_data = await self._output_resampler.resample(
                data, frame.sample_rate, self._telnyx_sample_rate
            )
            if resampled_data is None or len(resampled_data) == 0:
                return None

            self._opus_encode_buffer.extend(resampled_data)

            # Not enough data for a full 20ms frame yet
            if len(self._opus_encode_buffer) < self._opus_frame_bytes:
                return None

            encoder = self._get_opus_encoder()
            messages = []
            offset = 0

            while offset + self._opus_frame_bytes <= len(self._opus_encode_buffer):
                frame_data = bytes(
                    self._opus_encode_buffer[offset : offset + self._opus_frame_bytes]
                )
                offset += self._opus_frame_bytes

                opus_packet = encoder.encode(frame_data, self._opus_frame_samples)
                payload = base64.b64encode(opus_packet).decode("utf-8")
                messages.append(
                    f'{{"event":"media","media":{{"payload":"{payload}"}}}}'
                )

            # Keep leftover bytes for the next call
            if offset > 0:
                self._opus_encode_buffer = self._opus_encode_buffer[offset:]

            return messages if messages else None

        # ── L16 encode (raw PCM, network byte order) ─────────────
        if self._params.inbound_encoding == "L16":
            resampled_data = await self._output_resampler.resample(
                data, frame.sample_rate, self._telnyx_sample_rate
            )
            if resampled_data is None or len(resampled_data) == 0:
                return None

            # Ensure even byte count (16-bit samples)
            if len(resampled_data) % 2 != 0:
                resampled_data = resampled_data[: len(resampled_data) - 1]

            # L16 wire format is big-endian (network byte order)
            if sys.byteorder == "little":
                import numpy as np

                audio_array = np.frombuffer(resampled_data, dtype=np.int16)
                serialized_data = audio_array.byteswap().tobytes()
            else:
                serialized_data = resampled_data

            payload = base64.b64encode(serialized_data).decode("utf-8")
            return json.dumps({"event": "media", "media": {"payload": payload}})

        # ── PCMU encode ──────────────────────────────────────────
        if self._params.inbound_encoding == "PCMU":
            serialized_data = await pcm_to_ulaw(
                data, frame.sample_rate, self._telnyx_sample_rate, self._output_resampler
            )
        elif self._params.inbound_encoding == "PCMA":
            serialized_data = await pcm_to_alaw(
                data, frame.sample_rate, self._telnyx_sample_rate, self._output_resampler
            )
        else:
            raise ValueError(f"Unsupported encoding: {self._params.inbound_encoding}")

        if serialized_data is None or len(serialized_data) == 0:
            return None

        payload = base64.b64encode(serialized_data).decode("utf-8")
        return json.dumps({"event": "media", "media": {"payload": payload}})

    async def deserialize(self, data: str | bytes) -> Frame | None:
        """Deserialize Telnyx WebSocket data to a Pipecat frame."""
        try:
            message = json.loads(data)
        except json.JSONDecodeError:
            logger.warning("Failed to parse JSON message from Telnyx")
            return None

        if not isinstance(message, dict) or "event" not in message:
            return None

        if message["event"] == "media":
            payload_base64 = message.get("media", {}).get("payload")
            if not payload_base64:
                return None

            try:
                payload = base64.b64decode(payload_base64)
            except binascii.Error:
                logger.warning("Failed to decode base64 audio payload")
                return None

            # ── OPUS decode ──────────────────────────────────
            if self._params.outbound_encoding == "OPUS":
                decoder = self._get_opus_decoder()
                frame_size = self._telnyx_sample_rate // 50  # 20ms
                pcm_data = decoder.decode(payload, frame_size)

                deserialized_data = await self._input_resampler.resample(
                    pcm_data,
                    self._telnyx_sample_rate,
                    self._sample_rate,
                )

            # ── L16 decode (network byte order → host) ───────
            elif self._params.outbound_encoding == "L16":
                if len(payload) % 2 != 0:
                    payload = payload[: len(payload) - 1]
                if len(payload) == 0:
                    return None

                # L16 wire format is big-endian; convert to host byte order
                if sys.byteorder == "little":
                    import numpy as np

                    audio_array = np.frombuffer(payload, dtype=">i2")
                    host_audio = audio_array.byteswap().tobytes()
                else:
                    host_audio = payload

                deserialized_data = await self._input_resampler.resample(
                    host_audio,
                    self._telnyx_sample_rate,
                    self._sample_rate,
                )

            # ── PCMU/PCMA decode ─────────────────────────────
            elif self._params.outbound_encoding == "PCMU":
                deserialized_data = await ulaw_to_pcm(
                    payload,
                    self._telnyx_sample_rate,
                    self._sample_rate,
                    self._input_resampler,
                )
            elif self._params.outbound_encoding == "PCMA":
                deserialized_data = await alaw_to_pcm(
                    payload,
                    self._telnyx_sample_rate,
                    self._sample_rate,
                    self._input_resampler,
                )
            else:
                raise ValueError(
                    f"Unsupported encoding: {self._params.outbound_encoding}"
                )

            if deserialized_data is None or len(deserialized_data) == 0:
                return None

            return InputAudioRawFrame(
                audio=deserialized_data,
                num_channels=1,
                sample_rate=self._sample_rate,
            )

        elif message["event"] == "dtmf":
            digit = message.get("dtmf", {}).get("digit")
            try:
                return InputDTMFFrame(KeypadEntry(digit))
            except ValueError:
                return None

        return None

    async def _hang_up_call(self):
        """Hang up the Telnyx call using Telnyx's REST API."""
        try:
            call_control_id = self._call_control_id
            api_key = self._api_key

            if not call_control_id or not api_key:
                logger.warning(
                    "Cannot hang up Telnyx call: call_control_id and api_key must be provided"
                )
                return

            endpoint = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(endpoint, headers=headers) as response:
                    if response.status == 200:
                        logger.info(
                            f"Successfully terminated Telnyx call {call_control_id}"
                        )
                    elif response.status == 422:
                        try:
                            error_data = await response.json()
                            if any(
                                error.get("code") == "90018"
                                for error in error_data.get("errors", [])
                            ):
                                logger.debug(
                                    f"Telnyx call {call_control_id} was already terminated"
                                )
                                return
                        except Exception:
                            pass
                        error_text = await response.text()
                        logger.error(
                            f"Failed to terminate Telnyx call {call_control_id}: "
                            f"Status {response.status}, Response: {error_text}"
                        )
                    else:
                        error_text = await response.text()
                        logger.error(
                            f"Failed to terminate Telnyx call {call_control_id}: "
                            f"Status {response.status}, Response: {error_text}"
                        )
        except Exception as e:
            logger.error(f"Failed to hang up Telnyx call: {e}")


def patch_transport_for_opus(transport):
    """Monkey-patch the transport to handle list payloads from Opus serializer.

    The installed Pipecat transport (v0.0.102) only sends single str/bytes from
    serialize(). Opus serialize() returns a list of JSON messages (one per 20ms
    frame). This patch makes transport._client.send() iterate over lists.

    Call this AFTER creating the FastAPIWebsocketTransport, BEFORE running the pipeline.
    """
    original_send = transport._client.send

    async def _list_aware_send(data):
        if isinstance(data, list):
            for item in data:
                if item:
                    await original_send(item)
        else:
            await original_send(data)

    transport._client.send = _list_aware_send
    logger.info("Transport patched for Opus multi-message support")
