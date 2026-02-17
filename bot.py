import asyncio
import os
import sys

from dotenv import load_dotenv
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.processors.aggregators.llm_context import LLMContext

load_dotenv(override=True)

async def main():
    # 1. Initialize Transport
    # Using LocalAudioTransport with proper Params
    transport = LocalAudioTransport(
        params=LocalAudioTransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        )
    )

    # 2. Initialize OpenAI Realtime Service
    llm = OpenAIRealtimeLLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o-realtime-preview",
        instructions="You are a helpful and friendly AI assistant. Talk to the user in a natural, conversational way.",
    )

    # 3. Setup Context and Aggregators
    context = LLMContext([
        {"role": "system", "content": "You are a helpful and friendly AI assistant. Talk to the user in a natural, conversational way."}
    ])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    # 4. Create Pipeline
    pipeline = Pipeline([
        transport.input(),
        user_aggregator,
        llm,
        transport.output(),
        assistant_aggregator,
    ])

    # 5. Create and Run Task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(enable_metrics=True),
    )

    @transport.event_handler("on_transport_ready")
    async def on_transport_ready(transport):
        print("Transport ready! You can start talking now.")
        await task.queue_frames([LLMRunFrame()])

    runner = PipelineRunner()
    await runner.run(task)

if __name__ == "__main__":
    asyncio.run(main())
