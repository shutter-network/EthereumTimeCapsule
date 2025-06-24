#!/usr/bin/env python3
"""
Test Pinata V3 Public Access
This test uploads a file to Pinata V3 with public network setting
and then verifies it's accessible via the public gateway
"""

import requests
import time

def test_pinata_public_access():
    print("🌐 Testing Pinata V3 public network access...")
    
    # Test data
    test_message = "This file should be publicly accessible on IPFS"
    test_hex = "0x" + test_message.encode('utf-8').hex()
    
    print(f"📝 Test message: {test_message}")
    
    # 1. Upload to Pinata via our backend
    print("\n📤 Uploading to Pinata V3 (public network)...")
    upload_response = requests.post("http://localhost:5000/upload_ipfs", 
                                  json={"hex": test_hex})
    
    if upload_response.status_code != 200:
        print(f"❌ Upload failed: {upload_response.status_code}")
        print(f"   Response: {upload_response.text}")
        return
    
    upload_data = upload_response.json()
    cid = upload_data['cid']
    pinata_url = upload_data.get('pinata_url')
    
    print("✅ Upload successful!")
    print(f"   CID: {cid}")
    print(f"   Pinata URL: {pinata_url}")
    
    # 2. Test direct access to Pinata gateway (this was failing before)
    print(f"\n🌍 Testing direct Pinata gateway access...")
    print(f"   URL: {pinata_url}")
    
    try:
        # Give Pinata a moment to propagate
        print("   Waiting 2 seconds for IPFS propagation...")
        time.sleep(2)
        
        gateway_response = requests.get(pinata_url, timeout=15)
        
        if gateway_response.status_code == 200:
            downloaded_content = gateway_response.content.decode('utf-8')
            print(f"✅ Gateway access successful!")
            print(f"   Downloaded: {downloaded_content}")
            print(f"   Match: {'✅' if downloaded_content == test_message else '❌'}")
        else:
            print(f"❌ Gateway access failed: {gateway_response.status_code}")
            print(f"   Response: {gateway_response.text}")
            
    except requests.exceptions.Timeout:
        print("❌ Gateway access timed out (file might still be private)")
    except Exception as e:
        print(f"❌ Gateway access error: {e}")
    
    # 3. Test our backend fallback (should always work)
    print(f"\n🏠 Testing backend fallback access...")
    backend_url = f"http://localhost:5000/ipfs/{cid}"
    try:
        backend_response = requests.get(backend_url, timeout=10)
        if backend_response.status_code == 200:
            backend_content = backend_response.content.decode('utf-8')
            print(f"✅ Backend access successful!")
            print(f"   Downloaded: {backend_content}")
        else:
            print(f"❌ Backend access failed: {backend_response.status_code}")
    except Exception as e:
        print(f"❌ Backend access error: {e}")

if __name__ == "__main__":
    test_pinata_public_access()
