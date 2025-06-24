import requests

# Test the pixelated image endpoint
url = "https://ethereum-time-capsule-luis-e873bebc232f.herokuapp.com/pixelated/bafkreiafyjyd7euqlo3cfbs6uedqjyx6jelual53lm7srxy4krtmgvfh4u"
response = requests.get(url)

print(f"Status: {response.status_code}")
print(f"Content-Type: {response.headers.get('Content-Type', 'not set')}")
print(f"Content-Length: {response.headers.get('Content-Length', 'not set')}")

if response.status_code == 200:
    print("✅ Pixelated image loaded successfully!")
    print(f"Image size: {len(response.content)} bytes")
else:
    print(f"❌ Failed to load pixelated image: {response.text[:200]}")
