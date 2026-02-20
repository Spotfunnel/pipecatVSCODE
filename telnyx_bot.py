import asyncio
import os
import sys
import json
import logging
import aiohttp
import asyncpg

from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel as PydanticBaseModel
from typing import Optional, List, Dict, Any
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
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.runner.utils import parse_telephony_websocket
from serializers.opus_telnyx import OpusTelnyxSerializer, patch_transport_for_opus

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

load_dotenv(override=True)

# ── Database Configuration ────────────────────────────────────────────────────
# Agent configs are stored in Supabase Postgres (voice_agents table).
# This makes configs persistent across deploys and supports multi-agent routing.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.lxsxwrunbmoiayhtexiz:Walkergewert01@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
)

# Connection pool — initialized on startup
db_pool: asyncpg.Pool = None

DEFAULT_AGENT_CONFIG = {
    'name': 'AI Assistant',
    'voice': 'sage',
    'systemPrompt': 'You are a helpful and professional AI assistant talking over the phone. Always respond in English. Be warm and conversational.',
    'description': '',
    'vadThreshold': 0.55,
    'stopSecs': 0.7,
    'webhooks': [],
}


async def get_db_pool():
    """Get or create the database connection pool."""
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        logger.info("Database connection pool created")
    return db_pool


async def load_agent_by_phone(phone_number: str) -> dict:
    """Load agent configuration from the database by phone number.
    
    Falls back to the first active agent if no phone-specific match is found.
    Returns a dict with name, voice, systemPrompt, webhooks, etc.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Try exact phone number match first
        if phone_number:
            row = await conn.fetchrow(
                "SELECT * FROM voice_agents WHERE phone_number = $1 AND active = true LIMIT 1",
                phone_number,
            )
            if row:
                logger.info(f"Found agent '{row['name']}' for phone {phone_number}")
                return _row_to_config(row)
        
        # Fallback: first active agent (or any agent with empty phone_number)
        row = await conn.fetchrow(
            "SELECT * FROM voice_agents WHERE active = true ORDER BY created_at ASC LIMIT 1"
        )
        if row:
            logger.info(f"Using default active agent '{row['name']}' (no phone match for {phone_number})")
            return _row_to_config(row)
    
    logger.warning(f"No agent found in database — using hardcoded defaults")
    return DEFAULT_AGENT_CONFIG.copy()


async def load_all_agents() -> list:
    """Load all agents from the database."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM voice_agents ORDER BY created_at ASC")
        return [_row_to_config(row) for row in rows]


def _row_to_config(row) -> dict:
    """Convert a database row to an agent config dict."""
    webhooks = row['webhooks'] if row['webhooks'] else []
    # webhooks is stored as JSONB, asyncpg returns it as a string
    if isinstance(webhooks, str):
        try:
            webhooks = json.loads(webhooks)
        except json.JSONDecodeError:
            webhooks = []
    return {
        'id': str(row['id']),
        'name': row['name'],
        'description': row['description'] or '',
        'systemPrompt': row['system_prompt'],
        'voice': row['voice'] or 'sage',
        'vadThreshold': row['vad_threshold'] or 0.55,
        'stopSecs': row['stop_secs'] or 0.7,
        'phoneNumber': row['phone_number'] or '',
        'webhooks': webhooks,
        'active': row['active'],
    }


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

# CORS: Allow dashboard (Vercel) to call bot server (Railway)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Lock down to dashboard domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models for config API ───────────────────────────────────────────
class PhoneConfig(PydanticBaseModel):
    phoneNumber: Optional[str] = ''
    voice: Optional[str] = 'sage'
    vadThreshold: Optional[float] = 0.55
    stopSecs: Optional[float] = 0.7

class AgentConfigPayload(PydanticBaseModel):
    name: Optional[str] = 'AI Assistant'
    description: Optional[str] = ''
    systemPrompt: Optional[str] = ''
    phoneConfig: Optional[PhoneConfig] = None
    webhooks: Optional[List[Dict[str, Any]]] = []
    active: Optional[bool] = True

class OutboundCallPayload(PydanticBaseModel):
    to: str  # Destination phone number in E.164 format
    from_number: Optional[str] = None  # Telnyx number to call from (uses first active agent's number if not provided)

@app.on_event("startup")
async def startup():
    """Initialize database connection pool on server start."""
    try:
        await get_db_pool()
        logger.info("✓ Database pool ready")
    except Exception as e:
        logger.error(f"✗ Failed to connect to database: {e}")
        # Don't crash — the bot can still work with DEFAULT_AGENT_CONFIG

@app.on_event("shutdown")
async def shutdown():
    """Close database connection pool on server shutdown."""
    global db_pool
    if db_pool:
        await db_pool.close()
        logger.info("Database pool closed")

@app.get("/health")
async def health():
    db_ok = False
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            db_ok = True
    except Exception:
        pass
    return {"status": "ok", "database": "connected" if db_ok else "disconnected"}


@app.post("/api/outbound-call")
async def outbound_call(payload: OutboundCallPayload):
    """Initiate an outbound call via Telnyx TeXML.

    When the callee picks up, Telnyx fetches our TeXML webhook (/) which
    connects the call to our WebSocket pipeline with Opus HD audio.
    """
    try:
        api_key = os.getenv("TELNYX_API_KEY")
        if not api_key:
            return JSONResponse({'success': False, 'error': 'TELNYX_API_KEY not set'}, status_code=500)

        # Determine the "from" number
        from_number = payload.from_number
        if not from_number:
            # Use the first active agent's phone number from the database
            try:
                agents = await load_all_agents()
                active = next((a for a in agents if a.get('active') and a.get('phoneNumber')), None)
                if active:
                    from_number = active['phoneNumber']
            except Exception:
                pass

        if not from_number:
            return JSONResponse(
                {'success': False, 'error': 'No from_number provided and no agent has a phone number configured'},
                status_code=400,
            )

        public_url = os.getenv("BOT_PUBLIC_URL") or os.getenv("RAILWAY_PUBLIC_DOMAIN", "localhost")
        webhook_url = f"https://{public_url}/"

        # Telnyx TeXML outbound call — when callee answers, Telnyx fetches
        # TeXML from our / endpoint which returns <Stream> with Opus
        call_payload = {
            "to": payload.to,
            "from": from_number,
            "connection_id": os.getenv("TELNYX_TEXML_APP_ID", "2896638176531580022"),
            "url": webhook_url,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.telnyx.com/v2/texml/calls",
                json=call_payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                status = resp.status
                body = await resp.json()
                logger.info(f"Outbound call API → HTTP {status}: {json.dumps(body)[:500]}")

                if 200 <= status < 300:
                    call_sid = body.get("data", {}).get("sid", "unknown")
                    return JSONResponse({
                        'success': True,
                        'message': f'Outbound call initiated to {payload.to}',
                        'call_sid': call_sid,
                        'from': from_number,
                        'codec': 'OPUS',
                    })
                else:
                    error_msg = body.get("errors", [{}])[0].get("detail", str(body))
                    return JSONResponse({'success': False, 'error': error_msg}, status_code=status)

    except Exception as e:
        logger.error(f"Outbound call failed: {e}", exc_info=True)
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@app.post("/api/agent-config")
async def update_agent_config(payload: AgentConfigPayload):
    """Receive agent config from dashboard and upsert into the voice_agents database table."""
    try:
        # Extract voice from phoneConfig
        voice = 'sage'
        vad_threshold = 0.55
        stop_secs = 0.7
        phone_number = ''
        if payload.phoneConfig:
            voice = payload.phoneConfig.voice or 'sage'
            vad_threshold = payload.phoneConfig.vadThreshold or 0.55
            stop_secs = payload.phoneConfig.stopSecs or 0.7
            phone_number = payload.phoneConfig.phoneNumber or ''

        webhooks = json.dumps(payload.webhooks or [])
        name = payload.name or 'AI Assistant'
        system_prompt = payload.systemPrompt or ''
        description = payload.description or ''
        active = payload.active if payload.active is not None else True

        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Upsert: match by phone_number if provided, otherwise by name
            if phone_number:
                existing = await conn.fetchrow(
                    "SELECT id FROM voice_agents WHERE phone_number = $1 LIMIT 1",
                    phone_number,
                )
            else:
                existing = await conn.fetchrow(
                    "SELECT id FROM voice_agents WHERE name = $1 LIMIT 1",
                    name,
                )

            if existing:
                await conn.execute("""
                    UPDATE voice_agents
                    SET name=$1, description=$2, system_prompt=$3, voice=$4,
                        vad_threshold=$5, stop_secs=$6, phone_number=$7,
                        webhooks=$8::jsonb, active=$9, updated_at=now()
                    WHERE id=$10
                """, name, description, system_prompt, voice, vad_threshold,
                    stop_secs, phone_number, webhooks, active, existing['id'])
                logger.info(f"Updated agent '{name}' in database (id={existing['id']})")
            else:
                await conn.execute("""
                    INSERT INTO voice_agents (name, description, system_prompt, voice,
                        vad_threshold, stop_secs, phone_number, webhooks, active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                """, name, description, system_prompt, voice, vad_threshold,
                    stop_secs, phone_number, webhooks, active)
                logger.info(f"Created new agent '{name}' in database")

        return JSONResponse({
            'success': True,
            'agent': name,
            'voice': voice,
            'webhooks': len(payload.webhooks or []),
        })
    except Exception as e:
        logger.error(f"Failed to update agent config: {e}", exc_info=True)
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@app.get("/api/agent-config")
async def get_agent_config():
    """Return all agent configs from the database."""
    try:
        agents = await load_all_agents()
        # For backwards compatibility, also return the first active agent as 'config'
        active = next((a for a in agents if a.get('active')), agents[0] if agents else DEFAULT_AGENT_CONFIG)
        return JSONResponse({
            'success': True,
            'config': active,
            'agents': agents,
            'webhooks': active.get('webhooks', []),
        })
    except Exception as e:
        logger.error(f"Failed to read agent config: {e}", exc_info=True)
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


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
    
    # TeXML response: Connect to our WebSocket with bidirectional Opus HD audio
    texml = f'<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Connect>\n    <Stream url="{ws_url}" bidirectionalMode="rtp" bidirectionalCodec="OPUS" bidirectionalSamplingRate="16000"></Stream>\n  </Connect>\n  <Pause length="40"/>\n</Response>'
    
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
        
        # Use Opus HD audio (16kHz) — falls back to PCMU if Telnyx negotiates differently
        codec = outbound_encoding if outbound_encoding in ("OPUS", "L16", "PCMU", "PCMA") else "OPUS"
        telnyx_rate = 16000 if codec in ("OPUS", "L16") else 8000
        logger.info(f"Using codec: {codec} at {telnyx_rate}Hz")

        serializer = OpusTelnyxSerializer(
            stream_id=stream_id,
            call_control_id=call_control_id,
            outbound_encoding=codec,
            inbound_encoding=codec,
            api_key=os.getenv("TELNYX_API_KEY"),
            params=OpusTelnyxSerializer.InputParams(
                telnyx_sample_rate=telnyx_rate,
                inbound_encoding=codec,
                outbound_encoding=codec,
            ),
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
                        threshold=0.55,      # Speech detection sensitivity — proven optimal
                        min_volume=0.6,      # Minimum volume for speech detection
                        stop_secs=0.7,       # 700ms max latency as requested
                    )
                ),
                serializer=serializer,
            )
        )

        # Patch transport to handle Opus multi-message serialization
        patch_transport_for_opus(transport)

        # ── Load agent config from database by phone number ─────
        agent_config = await load_agent_by_phone(caller_to)
        webhooks = agent_config.get('webhooks', [])
        tools, tool_url_map = build_tools_from_webhooks(webhooks)

        system_prompt = agent_config['systemPrompt']
        voice = agent_config.get('voice', 'sage')
        logger.info(f"Using agent '{agent_config.get('name')}' for phone={caller_to}, voice='{voice}', prompt length={len(system_prompt)}")

        # ── Configure OpenAI Realtime LLM ───────────────────────
        # CRITICAL: Do NOT use AudioConfiguration here!
        # The walkthrough (conv c9e1da17) explicitly states:
        #   "Setting any AudioConfiguration appears to change how OpenAI encodes
        #   its audio output, causing sample rate or format mismatches with
        #   Pipecat's internal resampling chain. The result is crackling,
        #   off-pitch voice, and lost word endings."
        #
        # Pass instructions + tools via SessionProperties (no audio config).
        # Pass voice directly to OpenAIRealtimeLLMService.
        session_properties = SessionProperties(
            instructions=system_prompt,
            tools=tools,
        )
        logger.info(f"SessionProperties: instructions length={len(system_prompt)}, tools={len(tools)}, voice='{voice}' (direct kwarg)")

        llm = OpenAIRealtimeLLMService(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-realtime",
            voice=voice,
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
