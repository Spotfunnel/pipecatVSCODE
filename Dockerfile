FROM python:3.11-slim

WORKDIR /app

# Install system deps for audio processing, asyncpg compilation, and Opus codec
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libsndfile1 \
    libopus-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY telnyx_bot.py .
COPY webhooks.json .
COPY agent_config.json .
COPY serializers/ ./serializers/

# Railway injects PORT env var; uvicorn in telnyx_bot.py uses 8000 by default
# We override via CMD to respect Railway's PORT
EXPOSE 8000

CMD ["python", "telnyx_bot.py"]
