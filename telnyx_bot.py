import asyncio
import os
import sys
import json
import logging
import aiohttp
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from uvicorn import Config, Server
from dotenv import load_dotenv
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame, EndFrame
from pipecat.services.llm_service import FunctionCallParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.services.openai.realtime.events import SessionProperties
from pipecat.transports.network.fastapi_websocket import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.runner.utils import parse_telephony_websocket

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

load_dotenv(override=True)

# ── Configuration Files ──────────────────────────────────────────────────────
# Load webhook config from webhooks.json and agent config from agent_config.json
# Both are exported from the dashboard and COPY'd into the Docker image
APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEBHOOKS_FILE = os.path.join(APP_DIR, 'webhooks.json')
AGENT_CONFIG_FILE = os.path.join(APP_DIR, 'agent_config.json')


def load_webhooks():
    """Load webhook configuration from webhooks.json."""
    try:
        with open(WEBHOOKS_FILE, 'r') as f:
            webhooks = json.load(f)
            logger.info(f"Loaded {len(webhooks)} webhooks from {WEBHOOKS_FILE}")
            return webhooks
    except FileNotFoundError:
        logger.info(f"No webhooks.json found at {WEBHOOKS_FILE} — no webhooks configured")
        return []
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {WEBHOOKS_FILE}: {e}")
        return []


def load_agent_config():
    """Load agent configuration (prompt, voice, etc.) from agent_config.json."""
    default_config = {
        'name': 'AI Assistant',
        'voice': 'coral',
        'systemPrompt': 'You are a helpful and professional AI assistant talking over the phone. Always respond in English. Be warm and conversational.',
        'description': '',
    }
    try:
        with open(AGENT_CONFIG_FILE, 'r') as f:
            config = json.load(f)
            logger.info(f"Loaded agent config from {AGENT_CONFIG_FILE}: name={config.get('name')}, voice={config.get('voice')}")
            return {**default_config, **config}
    except FileNotFoundError:
        logger.warning(f"No agent_config.json found at {AGENT_CONFIG_FILE} — using defaults")
        return default_config
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {AGENT_CONFIG_FILE}: {e}")
        return default_config


def build_tools_from_webhooks(webhooks):
    """Build OpenAI function-calling tools from webhook config.
    
    Returns (tools_list, tool_url_map) where tool_url_map maps tool names to webhook URLs.
    """
    tools = []
    tool_url_map = {}

    for wh in webhooks:
        if wh.get('trigger') != 'on_tool_call' or not wh.get('name') or not wh.get('url'):
            continue

        # Sanitize name for function calling (alphanumeric + underscores only)
        import re
        tool_name = re.sub(r'[^a-z0-9_]', '_', wh['name'].lower())
        tool_name = re.sub(r'_+', '_', tool_name).strip('_') or 'webhook_action'

        # Build parameters schema from payload fields
        properties = {}
        field_descriptions = {
            'caller_number': 'The caller phone number',
            'transcript': 'Full conversation transcript',
            'call_duration': 'Duration of the call in seconds',
            'summary': 'Brief summary of the conversation and outcome',
            'address': 'Customer address (street, suburb, state, postcode)',
            'installer_message': 'Detailed message for the installer with special instructions, access notes, and job specifics',
            'custom_data': 'Any additional custom data',
            'extracted_fields': 'Extracted information like name, email, service type',
            'agent_name': 'Name of the AI agent',
            'timestamp': 'ISO timestamp of when this was triggered',
        }

        for field in wh.get('payloadFields', []):
            if field == 'address':
                properties[field] = {
                    'type': 'object',
                    'description': field_descriptions.get(field, field),
                    'properties': {
                        'street': {'type': 'string'},
                        'suburb': {'type': 'string'},
                        'state': {'type': 'string'},
                        'postcode': {'type': 'string'},
                    },
                }
            elif field == 'extracted_fields':
                properties[field] = {
                    'type': 'object',
                    'description': 'All information collected from the caller during the conversation. ALWAYS include every piece of information the caller provided.',
                    'properties': {
                        'name': {'type': 'string', 'description': "Caller's full name"},
                        'email': {'type': 'string', 'description': "Caller's email address"},
                        'phone': {'type': 'string', 'description': "Caller's phone number"},
                        'company': {'type': 'string', 'description': "Caller's company or business name"},
                        'service_type': {'type': 'string', 'description': 'Type of service requested'},
                        'preferred_date': {'type': 'string', 'description': 'Preferred date/time for appointment'},
                        'notes': {'type': 'string', 'description': 'Any other relevant details mentioned by the caller'},
                    },
                }
            elif field == 'custom_data':
                properties[field] = {
                    'type': 'object',
                    'description': 'Additional context from the conversation',
                    'properties': {
                        'reason': {'type': 'string', 'description': 'Why the caller is reaching out'},
                        'urgency': {'type': 'string', 'description': 'How urgent the request is (low, medium, high, emergency)'},
                        'callback_number': {'type': 'string', 'description': 'Number to call back on (if different from caller)'},
                        'message': {'type': 'string', 'description': 'Message or notes from the caller'},
                    },
                }
            elif field == 'call_duration':
                properties[field] = {
                    'type': 'number',
                    'description': field_descriptions.get(field, field),
                }
            else:
                properties[field] = {
                    'type': 'string',
                    'description': field_descriptions.get(field, field),
                }

        # Build context-aware tool description
        name_lower = wh['name'].lower()
        if any(kw in name_lower for kw in ('human', 'callback', 'message')):
            tool_desc = f'Trigger the "{wh["name"]}" webhook. Use this when the caller asks to speak to a real person, leave a message, or requests a callback. Collect their name, phone number, and reason before triggering.'
        elif any(kw in name_lower for kw in ('booking', 'appointment')):
            tool_desc = f'Trigger the "{wh["name"]}" webhook. Use this when the caller wants to book an appointment or service. Collect their details before triggering.'
        else:
            tool_desc = f'Trigger the "{wh["name"]}" webhook. Use this when the caller\'s request matches this action. Collect all relevant information before triggering.'

        tool = {
            'type': 'function',
            'name': tool_name,
            'description': tool_desc,
            'parameters': {
                'type': 'object',
                'properties': properties,
            },
        }

        tools.append(tool)
        tool_url_map[tool_name] = wh['url']
        logger.info(f"  Registered tool: {tool_name} → {wh['url']}")

    # Always add built-in transfer_call tool
    tools.append({
        'type': 'function',
        'name': 'transfer_call',
        'description': (
            'Transfer/forward the current phone call to an external phone number. '
            'Use this when the caller needs to speak to a real person, or when the prompt '
            'instructs you to forward calls to a specific number. '
            'IMPORTANT: Before calling this tool, tell the caller you are transferring them '
            'and to whom. Example: "Let me transfer you to the team now. One moment please." '
            'The call will be connected to the destination number.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'destination_number': {
                    'type': 'string',
                    'description': 'The phone number to transfer the call to, in E.164 format (e.g. "+61412345678")',
                },
                'reason': {
                    'type': 'string',
                    'description': 'Brief reason for the transfer (e.g. "caller requested human agent", "scheduling inquiry")',
                },
            },
            'required': ['destination_number'],
        },
    })
    logger.info(f"  Registered built-in tool: transfer_call")

    logger.info(f"  Built {len(tools)} total tools")

    return tools, tool_url_map


async def fire_webhook(url, payload):
    """Fire a webhook by POSTing payload to the URL."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                status = resp.status
                body = await resp.text()
                logger.info(f"Webhook fired to {url} → HTTP {status}")
                return {
                    'success': 200 <= status < 300,
                    'status': status,
                    'response': body[:500],
                }
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {'success': False, 'error': str(e)}


async def transfer_call_via_telnyx(call_control_id, destination_number, from_number):
    """Transfer the active call to an external number using Telnyx Call Control API."""
    api_key = os.getenv("TELNYX_API_KEY")
    url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer"
    payload = {
        "to": destination_number,
    }
    # Set caller ID to the Telnyx number so the recipient sees it
    if from_number:
        payload["from"] = from_number

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                status = resp.status
                body = await resp.text()
                logger.info(f"Telnyx transfer → HTTP {status}: {body[:200]}")
                return {
                    'success': 200 <= status < 300,
                    'status': status,
                    'response': body[:500],
                }
    except Exception as e:
        logger.error(f"Transfer error: {e}")
        return {'success': False, 'error': str(e)}


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
    
    public_url = os.getenv("BOT_PUBLIC_URL") or os.getenv("RAILWAY_PUBLIC_DOMAIN", "localhost")
    ws_url = f"wss://{public_url}/ws"
    
    # TeXML response: Connect to our WebSocket with bidirectional PCMU audio
    texml = f'<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Connect>\n    <Stream url="{ws_url}" bidirectionalMode="rtp" bidirectionalCodec="PCMU" bidirectionalSamplingRate="8000"></Stream>\n  </Connect>\n  <Pause length="40"/>\n</Response>'
    
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
        
        # PCMU encoding — the only encoding TelnyxFrameSerializer reliably supports
        serializer = TelnyxFrameSerializer(
            stream_id=stream_id,
            call_control_id=call_control_id,
            outbound_encoding="PCMU",
            inbound_encoding="PCMU",
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
                        threshold=0.55,      # Sweet spot for speech detection
                        min_volume=0.6,      # Prevents quiet bleed-through from triggering interruptions
                        stop_secs=0.7,       # 700ms max latency as requested
                    )
                ),
                serializer=serializer,
            )
        )

        # ── Load webhook config & build tools ───────────────────
        webhooks = load_webhooks()
        tools, tool_url_map = build_tools_from_webhooks(webhooks)

        # Build LLM config from agent_config.json
        agent_config = load_agent_config()
        system_prompt = agent_config['systemPrompt']
        voice = agent_config.get('voice', 'coral')
        logger.info(f"Using agent '{agent_config.get('name')}' with voice='{voice}', prompt length={len(system_prompt)}")

        # ── Configure OpenAI Realtime Session ─────────────────────
        # IMPORTANT: instructions and voice MUST go in SessionProperties.
        # They are NOT direct constructor kwargs on OpenAIRealtimeLLMService.
        # Passing them as kwargs silently fails (swallowed by **kwargs).
        #
        # DO NOT add AudioConfiguration here — it changes OpenAI's audio
        # encoding and causes crackling/pitch issues with Telnyx PCMU pipeline.
        # DO NOT add SemanticTurnDetection — it conflicts with Silero VAD.
        session_properties = SessionProperties(
            instructions=system_prompt,
            voice=voice,
            tools=tools,
        )
        logger.info(f"SessionProperties configured with voice='{voice}', instructions length={len(system_prompt)}, tools={len(tools)}")

        llm = OpenAIRealtimeLLMService(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-realtime",
            session_properties=session_properties,
        )

        # ── Handle function calls from the AI ────────────────────
        # Use register_function(None, handler) as a catch-all for all tool calls.
        # The handler receives FunctionCallParams and must call result_callback().
        async def handle_function_call(params: FunctionCallParams):
            """Catch-all function call handler for all tools."""
            function_name = params.function_name
            arguments = params.arguments
            logger.info(f"Function call: {function_name}({json.dumps(dict(arguments))})")

            # ── Built-in: transfer_call ──────────────────
            if function_name == 'transfer_call':
                dest = arguments.get('destination_number', '')
                reason = arguments.get('reason', 'transfer requested')
                logger.info(f"Transfer call requested: {dest} (reason: {reason})")

                if not dest:
                    await params.result_callback({'success': False, 'error': 'No destination number provided'})
                    return

                # Give the AI's transfer announcement time to play (3s)
                await asyncio.sleep(3.0)

                result = await transfer_call_via_telnyx(call_control_id, dest, caller_to)
                if result['success']:
                    logger.info(f"Call transferred to {dest}")
                    await params.result_callback({'success': True, 'message': f'Call is being transferred to {dest}'})
                else:
                    logger.warning(f"Transfer failed: {result}")
                    await params.result_callback({'success': False, 'error': result.get('error', f"HTTP {result.get('status')}")})
                return

            # ── Webhook tools ──────────────────────
            webhook_url = tool_url_map.get(function_name)
            if webhook_url:
                result = await fire_webhook(webhook_url, arguments)
                if result['success']:
                    logger.info(f"Webhook {function_name} succeeded: HTTP {result['status']}")
                    await params.result_callback({"success": True, "message": "Webhook delivered successfully"})
                else:
                    logger.warning(f"Webhook {function_name} failed: {result.get('error', result.get('status'))}")
                    await params.result_callback({"success": False, "error": result.get('error', f"HTTP {result.get('status')}")})
            else:
                logger.warning(f"No webhook URL for function: {function_name}")
                await params.result_callback({"success": False, "error": f"No webhook configured for {function_name}"})

        # Register catch-all function handler (None = handles all function names)
        llm.register_function(None, handle_function_call)
        logger.info(f"Registered catch-all function handler for {len(tools)} tools")
        # LLMContext: Use a "user" message to trigger the initial greeting.
        # The system instructions are already set via SessionProperties above.
        # NOTE: Do NOT pass tools here — LLMContext requires ToolsSchema objects,
        # not raw lists. Tools are provided via SessionProperties or register_function.
        context = LLMContext(
            [{"role": "user", "content": "Please greet the caller now."}],
        )
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
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting server on port {port}...")
    config = Config(app, host="0.0.0.0", port=port, log_level="info")
    server = Server(config)
    asyncio.run(server.serve())
