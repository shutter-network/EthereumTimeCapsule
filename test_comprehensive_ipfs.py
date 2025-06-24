#!/usr/bin/env python3
"""
Comprehensive IPFS Upload/Download Test
Tests both upload to Pinata and retrieval with fallbacks
"""

import requests
import json
import time

def test_ipfs_upload_download():
    print("🧪 Starting comprehensive IPFS test...")
    
    # Test data - a longer message
    test_message = "This is a comprehensive test of the IPFS integration with Pinata V3 API. It includes multiple sentences to test larger file handling."
    test_hex = "0x" + test_message.encode('utf-8').hex()
    
    print(f"📝 Test message: {test_message}")
    print(f"📦 Hex data: {test_hex}")
    print(f"📊 Data size: {len(test_hex[2:])//2} bytes")
    
    # 1. Test upload
    print("\n📤 Testing upload...")
    upload_response = requests.post("http://localhost:5000/upload_ipfs", 
                                  json={"hex": test_hex})
    
    if upload_response.status_code == 200:
        upload_data = upload_response.json()
        print("✅ Upload successful!")
        print(f"   Primary CID: {upload_data['cid']}")
        print(f"   Pinata enabled: {upload_data['pinata_enabled']}")
        if 'pinata_cid' in upload_data:
            print(f"   Pinata CID: {upload_data['pinata_cid']}")
            print(f"   Pinata URL: {upload_data['pinata_url']}")
        print(f"   Available URLs: {len(upload_data['ipfs_urls'])}")
        for i, url in enumerate(upload_data['ipfs_urls'], 1):
            print(f"     {i}. {url}")
    else:
        print(f"❌ Upload failed: {upload_response.status_code}")
        print(f"   Response: {upload_response.text}")
        return
    
    # 2. Test download from our backend (with fallback)
    print("\n📥 Testing download via backend...")
    cid = upload_data['cid']
    download_response = requests.get(f"http://localhost:5000/ipfs/{cid}")
    
    if download_response.status_code == 200:
        downloaded_text = download_response.text
        print("✅ Download successful!")
        print(f"   Downloaded: {downloaded_text}")
        print(f"   Match: {'✅' if downloaded_text == test_message else '❌'}")
    else:
        print(f"❌ Download failed: {download_response.status_code}")
    
    # 3. Test system info
    print("\n📊 System information...")
    system_info = requests.get("http://localhost:5000/system_info").json()
    print(f"   Pinata enabled: {system_info['pinata_enabled']}")
    print(f"   Pinata version: {system_info['pinata_version']}")
    print(f"   Pinata gateway: {system_info['pinata_gateway']}")
    
    print("\n🎉 Test completed!")

if __name__ == "__main__":
    test_ipfs_upload_download()
