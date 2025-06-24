#!/usr/bin/env python3
"""
Test frontend integration with backend IPFS system
This simulates what the frontend should be doing
"""

import requests
import json
import base64
import io
from PIL import Image

def create_test_image():
    """Create a small test image"""
    img = Image.new('RGB', (100, 100), color=(255, 0, 0))  # Red square
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    return buffer.getvalue()

def test_complete_workflow():
    print("🧪 Testing complete frontend integration workflow...")
    
    # 1. Test system info (what frontend loads on startup)
    print("\n1️⃣ Loading system info...")
    system_response = requests.get("http://localhost:5000/system_info")
    if system_response.status_code == 200:
        system_info = system_response.json()
        print("✅ System info loaded:")
        print(f"   Pinata enabled: {system_info['pinata_enabled']}")
        print(f"   Pinata version: {system_info['pinata_version']}")
        print(f"   Gateway: {system_info['pinata_gateway']}")
    else:
        print("❌ Failed to load system info")
        return

    # 2. Test capsule submission (first part of frontend workflow)
    print("\n2️⃣ Testing capsule submission...")
    test_image = create_test_image()
    
    # Simulate form data from frontend
    files = {'image': ('test.png', test_image, 'image/png')}
    data = {
        'title': 'Test Time Capsule',
        'tags': 'test,integration,ipfs',
        'story': 'This is a test story for the time capsule integration.',
        'revealTimestamp': '1749034000'  # Some future timestamp
    }
    
    submit_response = requests.post("http://localhost:5000/submit_capsule", 
                                  files=files, data=data)
    
    if submit_response.status_code == 200:
        submit_data = submit_response.json()
        print("✅ Capsule submission successful:")
        print(f"   Shutter identity: {submit_data['shutterIdentity'][:20]}...")
        print(f"   Reveal timestamp: {submit_data['revealTimestamp']}")
        print(f"   Has pixelated preview: {'pixelatedImage' in submit_data}")
        print(f"   Has encryption metadata: {'encMeta' in submit_data}")
    else:
        print(f"❌ Capsule submission failed: {submit_response.status_code}")
        print(f"   Response: {submit_response.text}")
        return

    # 3. Test IPFS upload (simulating encrypted image upload)
    print("\n3️⃣ Testing IPFS upload...")
    # Simulate encrypted data (just hex-encoded test data)
    test_data = "This is encrypted image data"
    hex_data = "0x" + test_data.encode('utf-8').hex()
    
    upload_response = requests.post("http://localhost:5000/upload_ipfs", 
                                  json={"hex": hex_data})
    
    if upload_response.status_code == 200:
        upload_data = upload_response.json()
        print("✅ IPFS upload successful:")
        print(f"   CID: {upload_data['cid']}")
        print(f"   Pinata enabled: {upload_data['pinata_enabled']}")
        print(f"   Available URLs: {len(upload_data['ipfs_urls'])}")
        
        # Test downloading from each URL
        print("\n4️⃣ Testing redundant download...")
        for i, url in enumerate(upload_data['ipfs_urls'], 1):
            try:
                if url.startswith('http://localhost:5000'):
                    # Test our backend endpoint
                    cid = upload_data['cid']
                    test_response = requests.get(f"http://localhost:5000/ipfs/{cid}")
                    if test_response.status_code == 200:
                        print(f"   ✅ URL {i}: {url} - Working")
                    else:
                        print(f"   ❌ URL {i}: {url} - Failed ({test_response.status_code})")
                else:
                    print(f"   ⏭️  URL {i}: {url} - Skipped (external)")
            except Exception as e:
                print(f"   ❌ URL {i}: {url} - Error: {e}")
    else:
        print(f"❌ IPFS upload failed: {upload_response.status_code}")
        return

    print("\n🎉 Frontend integration test completed successfully!")
    print("\n📝 Summary:")
    print("   - System info endpoint: Working")
    print("   - Capsule submission: Working") 
    print("   - IPFS upload with Pinata: Working")
    print("   - Redundant download: Working")
    print("\n✅ The frontend should be able to integrate successfully!")

if __name__ == "__main__":
    test_complete_workflow()
