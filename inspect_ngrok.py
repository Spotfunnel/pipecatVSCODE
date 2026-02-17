import urllib.request
import json
import datetime

try:
    with urllib.request.urlopen("http://localhost:4040/api/requests") as response:
        data = json.loads(response.read().decode())
        requests = data.get('requests', [])
        print(f"Total requests in log: {len(requests)}")
        for r in requests[:10]:
            start = r.get('start', 'N/A')
            method = r.get('request', {}).get('method', 'N/A')
            uri = r.get('request', {}).get('uri', 'N/A')
            status = r.get('response', {}).get('status_code', 'N/A')
            print(f"[{start}] {method} {uri} -> {status}")
except Exception as e:
    print(f"Error fetching ngrok requests: {e}")
