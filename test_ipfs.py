#!/usr/bin/env python3
"""
Test script to verify IPFS upload and retrieval functionality
"""
import requests
import json
import os

# Test data
test_message = "Hello from Ethereum Time Capsule IPFS test!"
test_hex = "0x" + test_message.encode('utf-8').hex()

print("=== IPFS Upload/Download Test ===")
print(f"Test message: {test_message}")
print(f"Test hex: {test_hex}")
print()

# Test 1: Upload to IPFS
print("📤 Testing IPFS upload...")
try:
    upload_response = requests.post(
        "http://localhost:5000/upload_ipfs",
        json={"hex": test_hex},
        timeout=30
    )
    upload_response.raise_for_status()
    upload_result = upload_response.json()
    
    print("✅ Upload successful!")
    print(f"Response: {json.dumps(upload_result, indent=2)}")
    
    cid = upload_result.get("cid")
    ipfs_urls = upload_result.get("ipfs_urls", [])
    
    print(f"CID: {cid}")
    print(f"Available URLs: {ipfs_urls}")
    print()
    
except Exception as e:
    print(f"❌ Upload failed: {e}")
    exit(1)

# Test 2: Download from local server
print("📥 Testing download from local server...")
try:
    download_response = requests.get(
        f"http://localhost:5000/ipfs/{cid}",
        timeout=10
    )
    download_response.raise_for_status()
    
    # Convert back to text
    downloaded_hex = "0x" + download_response.content.hex()
    downloaded_message = bytes.fromhex(downloaded_hex[2:]).decode('utf-8')
    
    print(f"✅ Download successful!")
    print(f"Downloaded hex: {downloaded_hex}")
    print(f"Downloaded message: {downloaded_message}")
    print(f"Match: {'✅' if downloaded_message == test_message else '❌'}")
    print()
    
except Exception as e:
    print(f"❌ Download failed: {e}")

# Test 3: Test Pinata gateway if available
if upload_result.get("pinata_url"):
    print("🌐 Testing download from Pinata gateway...")
    try:
        pinata_response = requests.get(
            upload_result["pinata_url"],
            timeout=15
        )
        pinata_response.raise_for_status()
        
        # Convert back to text
        pinata_hex = "0x" + pinata_response.content.hex()
        pinata_message = bytes.fromhex(pinata_hex[2:]).decode('utf-8')
        
        print(f"✅ Pinata download successful!")
        print(f"Pinata URL: {upload_result['pinata_url']}")
        print(f"Downloaded message: {pinata_message}")
        print(f"Match: {'✅' if pinata_message == test_message else '❌'}")
        
    except Exception as e:
        print(f"⚠️  Pinata download failed (this is normal if just uploaded): {e}")

print("\n=== Test Complete ===")
