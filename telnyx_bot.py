import asyncio
import os
import sys
import logging
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from uvicorn import Config, Server
from dotenv import load_dotenv
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame, EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.transports.network.fastapi_websocket import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.runner.utils import parse_telephony_websocket

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    filename='bot_run.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv(override=True)

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.api_route("/", methods=["GET", "POST"])
async def handle_inbound_call(request: Request):
    """Handle inbound call webhook from Telnyx TeXML Application.
    
    Telnyx sends a POST with form data containing call details (From, To, CallSid, etc.).
    We respond with TeXML instructions telling Telnyx to open a bidirectional WebSocket stream.
    """
    logger.info(f"Incoming {request.method} request to / from {request.client.host}")
    logger.debug(f"Headers: {dict(request.headers)}")
    
    # Log POST body if present (Telnyx TeXML sends call metadata as form data)
    if request.method == "POST":
        try:
            body = await request.body()
            logger.info(f"POST body: {body.decode('utf-8', errors='replace')}")
        except Exception as e:
            logger.warning(f"Could not read POST body: {e}")
    
    public_url = os.getenv("BOT_PUBLIC_URL", "localhost")
    ws_url = f"wss://{public_url}/ws"
    
    # TeXML response: Connect to our WebSocket with bidirectional RTP audio
    texml = f'<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Connect>\n    <Stream url="{ws_url}" bidirectionalMode="rtp"></Stream>\n  </Connect>\n  <Pause length="40"/>\n</Response>'
    
    logger.info(f"Responding with TeXML: {texml}")
    return HTMLResponse(content=texml, media_type="application/xml")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handle the bidirectional WebSocket stream from Telnyx.
    
    Telnyx connects here after parsing our TeXML <Stream> instruction.
    The handshake includes stream_id, call_control_id, and encoding info.
    """
    logger.info("WebSocket connection attempt...")
    await websocket.accept()
    logger.info("WebSocket accepted.")

    try:
        # Parse Telnyx handshake messages to extract stream metadata
        logger.info("Starting handshake parse...")
        transport_type, call_data = await parse_telephony_websocket(websocket)
        
        stream_id = call_data.get("stream_id")
        call_control_id = call_data.get("call_control_id")
        outbound_encoding = call_data.get("outbound_encoding") or "PCMU"
        caller_from = call_data.get("from", "unknown")
        caller_to = call_data.get("to", "unknown")
        
        logger.info(f"Handshake complete!")
        logger.info(f"  Transport: {transport_type}")
        logger.info(f"  Stream ID: {stream_id}")
        logger.info(f"  Call Control ID: {call_control_id}")
        logger.info(f"  Encoding: {outbound_encoding}")
        logger.info(f"  From: {caller_from} -> To: {caller_to}")
        
        # TelnyxFrameSerializer only supports PCMU/PCMA decoding.
        if outbound_encoding not in ("PCMU", "PCMA"):
            logger.warning(f"Telnyx negotiated {outbound_encoding} but serializer only supports PCMU/PCMA. Forcing PCMU.")
            outbound_encoding = "PCMU"
        
        serializer = TelnyxFrameSerializer(
            stream_id=stream_id,
            call_control_id=call_control_id,
            outbound_encoding=outbound_encoding,
            inbound_encoding=outbound_encoding,
            api_key=os.getenv("TELNYX_API_KEY"),
        )
        
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(
                        threshold=0.55,      # Slightly above default (0.5) to reduce false triggers
                        min_volume=0.6,      # Ignore quiet sounds / audio bleed
                        stop_secs=0.7,       # 700ms max latency as requested
                    )
                ),
                serializer=serializer,
            )
        )

        # OpenAI Realtime LLM — bare config that was working
        llm = OpenAIRealtimeLLMService(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-realtime",
            instructions="You are a helpful and friendly AI assistant talking over the phone. Always respond in English.",
        )

        context = LLMContext([
            {"role": "system", "content": "You are a helpful and friendly AI assistant talking over the phone. Always respond in English."}
        ])
        user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

        # Build pipeline: input -> user context -> LLM -> output -> assistant context
        pipeline = Pipeline([
            transport.input(),
            user_aggregator,
            llm,
            transport.output(),
            assistant_aggregator,
        ])

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                enable_metrics=True,
                audio_in_sample_rate=16000,
                audio_out_sample_rate=24000,
                allow_interruptions=True,
            )
        )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Telnyx client connected — starting LLM conversation!")
            await task.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Telnyx client disconnected — ending pipeline.")
            await task.queue_frames([EndFrame()])

        runner = PipelineRunner()
        await runner.run(task)
        
    except Exception as e:
        logger.error(f"CRITICAL WS ERROR: {e}", exc_info=True)


if __name__ == "__main__":
    logger.info("Starting server on port 8000...")
    config = Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = Server(config)
    asyncio.run(server.serve())
