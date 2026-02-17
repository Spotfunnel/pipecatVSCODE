import httpx
import os
from dotenv import load_dotenv

load_dotenv()

url = f"https://{os.getenv('BOT_PUBLIC_URL')}/"
print(f"Testing URL: {url}")

try:
    with httpx.Client() as client:
        response = client.get(url)
        print(f"Status: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        print("-" * 20)
        print(f"Body: {response.text[:500]}")
        print("-" * 20)
        
        if "ngrok" in response.text and "browser-warning" in response.text:
            print("!!! DETECTED NGROK BROWSER WARNING !!!")
            print("This is likely blocking Telnyx from seeing the XML.")
        elif "<?xml" in response.text:
            print("XML response looks good.")
        else:
            print("Response is neither XML nor ngrok warning. Check output above.")
except Exception as e:
    print(f"Error: {e}")
