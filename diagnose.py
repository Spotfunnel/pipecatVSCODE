"""Reorder TeXML app codecs: G711U first to match serializer capability."""
import urllib.request
import json
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("TELNYX_API_KEY")

TEXML_APP_ID = "2896638176531580022"

# Put G711U first since the serializer only supports PCMU/PCMA
update_data = json.dumps({
    "inbound": {
        "codecs": ["G711U", "G711A", "G722", "OPUS"]
    }
}).encode()

req = urllib.request.Request(
    f"https://api.telnyx.com/v2/texml_applications/{TEXML_APP_ID}",
    data=update_data,
    method="PATCH"
)
req.add_header("Authorization", f"Bearer {api_key}")
req.add_header("Content-Type", "application/json")

with urllib.request.urlopen(req, timeout=10) as resp:
    result = json.loads(resp.read().decode())

codecs = result.get("data", {}).get("inbound", {}).get("codecs", [])
print(f"Codec priority updated: {codecs}")
