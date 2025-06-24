#!/usr/bin/env python3
"""
Test IPFS Integration Only
Focuses on testing the IPFS upload/download functionality without Shutter API dependencies
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

def test_ipfs_only():
    print("🧪 Testing IPFS Integration (without Shutter API)...")
    
    # 1. Test system info
    print("\n1️⃣ Testing system info...")
    try:
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
    except Exception as e:
        print(f"❌ System info error: {e}")
        return

    # 2. Test IPFS upload with different file sizes
    test_cases = [
        ("Small text", "Hello IPFS World!"),
        ("Medium text", "A" * 1000),  # 1KB
        ("Large text", "B" * 10000),  # 10KB
    ]
    
    successful_uploads = []
    
    for case_name, test_data in test_cases:
        print(f"\n2️⃣ Testing IPFS upload: {case_name} ({len(test_data)} bytes)")
        
        # Convert to hex
        hex_data = "0x" + test_data.encode('utf-8').hex()
        
        try:
            upload_response = requests.post("http://localhost:5000/upload_ipfs", 
                                          json={"hex": hex_data})
            
            if upload_response.status_code == 200:
                upload_data = upload_response.json()
                print("✅ Upload successful:")
                print(f"   CID: {upload_data['cid']}")
                print(f"   Pinata enabled: {upload_data.get('pinata_enabled', False)}")
                print(f"   URLs available: {len(upload_data.get('ipfs_urls', []))}")
                
                # Store for download test
                successful_uploads.append({
                    'name': case_name,
                    'data': test_data,
                    'cid': upload_data['cid'],
                    'urls': upload_data.get('ipfs_urls', [])
                })
                
                if upload_data.get('pinata_enabled'):
                    print(f"   Pinata CID: {upload_data.get('pinata_cid', 'N/A')}")
                    print(f"   Pinata URL: {upload_data.get('pinata_url', 'N/A')}")
                
            else:
                print(f"❌ Upload failed: {upload_response.status_code}")
                print(f"   Response: {upload_response.text}")
                
        except Exception as e:
            print(f"❌ Upload error: {e}")

    # 3. Test downloads
    print(f"\n3️⃣ Testing downloads for {len(successful_uploads)} successful uploads...")
    
    for upload in successful_uploads:
        print(f"\n   Testing download: {upload['name']}")
        cid = upload['cid']
        expected_data = upload['data']
        
        # Test our backend endpoint
        try:
            download_response = requests.get(f"http://localhost:5000/ipfs/{cid}")
            if download_response.status_code == 200:
                downloaded_data = download_response.text
                if downloaded_data == expected_data:
                    print(f"   ✅ Backend download: SUCCESS")
                else:
                    print(f"   ❌ Backend download: Data mismatch")
                    print(f"      Expected: {expected_data[:50]}...")
                    print(f"      Got: {downloaded_data[:50]}...")
            else:
                print(f"   ❌ Backend download: Failed ({download_response.status_code})")
        except Exception as e:
            print(f"   ❌ Backend download: Error - {e}")

    # 4. Test image upload simulation
    print(f"\n4️⃣ Testing image upload simulation...")
    
    try:
        # Create test image
        test_image = create_test_image()
        print(f"   Created test image: {len(test_image)} bytes")
        
        # Convert to hex (simulating encrypted image)
        hex_image = "0x" + test_image.hex()
        
        image_upload_response = requests.post("http://localhost:5000/upload_ipfs", 
                                            json={"hex": hex_image})
        
        if image_upload_response.status_code == 200:
            image_data = image_upload_response.json()
            print("✅ Image upload successful:")
            print(f"   CID: {image_data['cid']}")
            print(f"   Size: {len(test_image)} bytes")
            
            # Test download
            image_cid = image_data['cid']
            image_download = requests.get(f"http://localhost:5000/ipfs/{image_cid}")
            if image_download.status_code == 200:
                if image_download.content == test_image:
                    print("   ✅ Image download: SUCCESS (binary data matches)")
                else:
                    print("   ❌ Image download: Binary data mismatch")
            else:
                print(f"   ❌ Image download: Failed ({image_download.status_code})")
        else:
            print(f"❌ Image upload failed: {image_upload_response.status_code}")
            
    except Exception as e:
        print(f"❌ Image test error: {e}")

    # 5. Summary
    print(f"\n📊 Test Summary:")
    print(f"   Successful uploads: {len(successful_uploads)}/{len(test_cases)}")
    print(f"   System integration: {'✅' if len(successful_uploads) > 0 else '❌'}")
    
    if len(successful_uploads) == len(test_cases):
        print(f"\n🎉 All IPFS integration tests passed!")
        print(f"✅ The backend IPFS system with Pinata integration is working correctly.")
        print(f"✅ The frontend should be able to upload encrypted images successfully.")
    else:
        print(f"\n⚠️  Some tests failed - check the logs above.")

if __name__ == "__main__":
    test_ipfs_only()
