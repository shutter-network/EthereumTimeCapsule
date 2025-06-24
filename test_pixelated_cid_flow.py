#!/usr/bin/env python3
"""
Test script to verify the pixelated image CID flow works end-to-end
"""
import os
import sys
import time
import requests
import json
from PIL import Image
import io
import base64

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

def test_submit_capsule_with_pixelated_cid():
    """Test that submit_capsule creates and returns a pixelated image CID"""
    
    # Create a simple test image
    img = Image.new('RGB', (100, 100), color='red')
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    # Prepare form data
    files = {
        'image': ('test.png', img_bytes, 'image/png')
    }
    
    data = {
        'title': 'Test Capsule with Pixelated CID',
        'tags': 'test,pixelated,ipfs',
        'story': 'This is a test story to verify pixelated image CID functionality.',
        'revealTimestamp': str(int(time.time()) + 3600)  # 1 hour from now
    }
    
    print("🧪 Testing /submit_capsule endpoint...")
    
    try:
        response = requests.post('http://localhost:5000/submit_capsule', files=files, data=data)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ /submit_capsule response received")
            print(f"   Shutter Identity: {result.get('shutterIdentity', 'N/A')}")
            print(f"   Pixelated CID: {result.get('pixelatedCid', 'N/A')}")
            print(f"   Pixelated URLs: {result.get('pixelatedUrls', 'N/A')}")
            print(f"   Pixelated Image: {result.get('pixelatedImage', 'N/A')[:50]}...")
            
            # Verify that pixelated data is present
            if result.get('pixelatedCid'):
                print("✅ Pixelated image CID was generated successfully")
                
                # Test accessing the IPFS endpoint
                pixelated_cid = result['pixelatedCid']
                ipfs_url = f"http://localhost:5000/ipfs/{pixelated_cid}"
                print(f"🔗 Testing IPFS endpoint: {ipfs_url}")
                
                ipfs_response = requests.get(ipfs_url)
                if ipfs_response.status_code == 200:
                    print("✅ Pixelated image accessible via IPFS endpoint")
                    print(f"   Response size: {len(ipfs_response.content)} bytes")
                else:
                    print(f"❌ IPFS endpoint failed: {ipfs_response.status_code}")
                    
                return result
            else:
                print("❌ No pixelated CID in response")
                return None
        else:
            print(f"❌ /submit_capsule failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Error testing /submit_capsule: {e}")
        return None

def test_database_pixelated_cid():
    """Test that the database stores pixelated CID correctly"""
    from backend.database import CapsuleDatabase
    
    print("\n🧪 Testing database pixelated CID storage...")
    
    try:
        db = CapsuleDatabase()
        
        # Insert a test capsule with pixelated CID
        test_capsule = {
            'id': 999,
            'creator': '0x1234567890123456789012345678901234567890',
            'title': 'Test Capsule',
            'tags': 'test',
            'encrypted_story': b'encrypted_data',
            'decrypted_story': '',
            'is_revealed': False,
            'reveal_time': int(time.time()) + 3600,
            'shutter_identity': 'test_identity',
            'image_cid': 'QmTestImageCID123',
            'pixelated_image_cid': 'QmTestPixelatedCID456',
            'block_number': None,
            'transaction_hash': None
        }
        
        if db.insert_capsule(test_capsule):
            print("✅ Test capsule inserted successfully")
            
            # Retrieve the capsule
            retrieved = db.get_capsule(999)
            if retrieved:
                print("✅ Test capsule retrieved successfully")
                print(f"   Image CID: {retrieved.get('image_cid')}")
                print(f"   Pixelated Image CID: {retrieved.get('pixelated_image_cid')}")
                
                if retrieved.get('pixelated_image_cid') == 'QmTestPixelatedCID456':
                    print("✅ Pixelated image CID stored and retrieved correctly")
                else:
                    print("❌ Pixelated image CID mismatch")
                
                # Clean up
                with db.get_connection() as conn:
                    conn.execute("DELETE FROM capsules WHERE id = 999")
                    conn.commit()
                print("🧹 Test capsule cleaned up")
                
                return True
            else:
                print("❌ Could not retrieve test capsule")
                return False
        else:
            print("❌ Failed to insert test capsule")
            return False
            
    except Exception as e:
        print(f"❌ Database test error: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Testing Pixelated Image CID Flow")
    print("=" * 50)
    
    # Test backend endpoint
    backend_result = test_submit_capsule_with_pixelated_cid()
    
    # Test database operations
    database_result = test_database_pixelated_cid()
    
    print("\n" + "=" * 50)
    if backend_result and database_result:
        print("🎉 All tests passed! Pixelated CID flow is working correctly.")
    else:
        print("❌ Some tests failed. Please check the output above.")
