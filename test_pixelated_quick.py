import requests

# Test the pixelated image endpoint with timeout
url = "https://ethereum-time-capsule-luis-e873bebc232f.herokuapp.com/pixelated/bafkreiafyjyd7euqlo3cfbs6uedqjyx6jelual53lm7srxy4krtmgvfh4u"

try:
    response = requests.get(url, timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Content-Type: {response.headers.get('Content-Type', 'not set')}")
    
    if response.status_code == 200:
        print("✅ SUCCESS! Pixelated image loaded successfully!")
        print(f"Image size: {len(response.content)} bytes")
    else:
        print(f"❌ Failed to load pixelated image")
        print(f"Response: {response.text[:300]}")
        
except requests.exceptions.Timeout:
    print("⏰ Request timed out")
except Exception as e:
    print(f"❌ Error: {e}")
