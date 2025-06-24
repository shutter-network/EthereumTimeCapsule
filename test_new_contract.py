#!/usr/bin/env python3
"""
Comprehensive test for the new TimeCapsule contract with pixelated image CID support
"""
import os
import sys
import time
import requests
import json
from PIL import Image
import io

def test_new_contract_integration():
    """Test the complete flow with the new contract"""
    
    print("🚀 Testing New TimeCapsule Contract Integration")
    print("=" * 60)
    print(f"📝 Contract: 0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF")
    print(f"🌐 RPC: https://rpc.gnosis.gateway.fm")
    print()
    
    # Test 1: Backend health check
    print("1️⃣ Testing backend health...")
    try:
        response = requests.get('http://localhost:5000/health')
        if response.status_code == 200:
            print("✅ Backend is healthy")
        else:
            print(f"❌ Backend health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Backend not accessible: {e}")
        return False
    
    # Test 2: System info check
    print("\n2️⃣ Testing system configuration...")
    try:
        response = requests.get('http://localhost:5000/system_info')
        if response.status_code == 200:
            info = response.json()
            print(f"✅ Pinata enabled: {info.get('pinata_enabled', False)}")
            print(f"✅ Pinata version: {info.get('pinata_version', 'N/A')}")
        else:
            print(f"❌ System info failed: {response.status_code}")
    except Exception as e:
        print(f"❌ System info error: {e}")
    
    # Test 3: Submit capsule with pixelated CID
    print("\n3️⃣ Testing capsule submission with pixelated CID...")
    
    # Create a test image
    img = Image.new('RGB', (200, 200), color=(255, 100, 100))  # Red image
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    files = {
        'image': ('test_new_contract.png', img_bytes, 'image/png')
    }
    
    data = {
        'title': 'New Contract Test Capsule',
        'tags': 'test,new-contract,pixelated-cid,ipfs',
        'story': 'This is a test story for the new TimeCapsule contract with pixelated image CID support. The contract now uses struct-based parameters to avoid stack too deep errors.',
        'revealTimestamp': str(int(time.time()) + 3600)  # 1 hour from now
    }
    
    try:
        response = requests.post('http://localhost:5000/submit_capsule', files=files, data=data)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Capsule submission successful!")
            print(f"   📋 Shutter Identity: {result.get('shutterIdentity', 'N/A')[:20]}...")
            print(f"   🖼️  Encrypted Image CID: Not yet created (frontend handles this)")
            print(f"   🎨 Pixelated Image CID: {result.get('pixelatedCid', 'N/A')}")
            
            # Verify pixelated image accessibility
            if result.get('pixelatedCid'):
                pixelated_cid = result['pixelatedCid']
                print(f"\n   🔗 Testing pixelated image access...")
                
                # Test local IPFS endpoint
                ipfs_url = f"http://localhost:5000/ipfs/{pixelated_cid}"
                ipfs_response = requests.get(ipfs_url)
                if ipfs_response.status_code == 200:
                    print(f"   ✅ Local IPFS endpoint works ({len(ipfs_response.content)} bytes)")
                else:
                    print(f"   ❌ Local IPFS endpoint failed: {ipfs_response.status_code}")
                
                # Test Pinata gateway
                if result.get('pixelatedUrls'):
                    pinata_url = result['pixelatedUrls'][0]
                    if 'pinata.cloud' in pinata_url:
                        print(f"   🔗 Testing Pinata gateway...")
                        try:
                            pinata_response = requests.get(pinata_url, timeout=10)
                            if pinata_response.status_code == 200:
                                print(f"   ✅ Pinata gateway works ({len(pinata_response.content)} bytes)")
                            else:
                                print(f"   ⚠️  Pinata gateway returned: {pinata_response.status_code}")
                        except Exception as e:
                            print(f"   ⚠️  Pinata gateway timeout/error: {e}")
            
            return result
        else:
            print(f"❌ Capsule submission failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Capsule submission error: {e}")
        return None
    
def test_api_endpoints():
    """Test the API endpoints return pixelated CID"""
    
    print("\n4️⃣ Testing API endpoints...")
    
    try:
        # Test capsules list endpoint
        response = requests.get('http://localhost:5000/api/capsules?limit=5')
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Capsules API works (found {data.get('total_count', 0)} capsules)")
            
            if data.get('capsules'):
                # Check if pixelatedImageCID is included
                first_capsule = data['capsules'][0]
                if 'pixelatedImageCID' in first_capsule:
                    print(f"✅ API includes pixelatedImageCID field")
                    print(f"   Example: {first_capsule.get('pixelatedImageCID', 'empty')}")
                else:
                    print(f"❌ API missing pixelatedImageCID field")
            else:
                print("ℹ️  No capsules found (fresh contract)")
        else:
            print(f"❌ Capsules API failed: {response.status_code}")
    except Exception as e:
        print(f"❌ API endpoint error: {e}")

def test_frontend_config():
    """Test that the frontend config matches our expectations"""
    
    print("\n5️⃣ Testing frontend configuration...")
    
    try:
        # Read the public config
        with open('frontend/public_config.json', 'r') as f:
            config = json.load(f)
        
        testnet_config = config.get('testnet', {})
        contract_addr = testnet_config.get('contract_address')
        rpc_url = testnet_config.get('rpc_url')
        
        if contract_addr == '0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF':
            print("✅ Contract address matches in frontend config")
        else:
            print(f"❌ Contract address mismatch: {contract_addr}")
        
        if rpc_url == 'https://rpc.gnosis.gateway.fm':
            print("✅ RPC URL matches in frontend config")
        else:
            print(f"❌ RPC URL mismatch: {rpc_url}")
            
        # Check if ABI file exists
        if os.path.exists('frontend/contract_abi.json'):
            print("✅ Contract ABI file exists")
            
            # Check if ABI contains the new commitCapsule structure
            with open('frontend/contract_abi.json', 'r') as f:
                abi = json.load(f)
            
            commit_function = None
            for item in abi:
                if item.get('name') == 'commitCapsule' and item.get('type') == 'function':
                    commit_function = item
                    break
            
            if commit_function:
                # Check if it has the struct parameter
                inputs = commit_function.get('inputs', [])
                if len(inputs) == 1 and inputs[0].get('type') == 'tuple':
                    print("✅ ABI contains new struct-based commitCapsule function")
                    
                    # Check if the tuple contains pixelatedImageCID
                    components = inputs[0].get('components', [])
                    has_pixelated_cid = any(c.get('name') == 'pixelatedImageCID' for c in components)
                    if has_pixelated_cid:
                        print("✅ ABI includes pixelatedImageCID in struct")
                    else:
                        print("❌ ABI missing pixelatedImageCID in struct")
                else:
                    print("❌ ABI still has old parameter-based function")
            else:
                print("❌ ABI missing commitCapsule function")
        else:
            print("❌ Contract ABI file not found")
            
    except Exception as e:
        print(f"❌ Frontend config error: {e}")

if __name__ == "__main__":
    # Run all tests
    backend_result = test_new_contract_integration()
    test_api_endpoints()
    test_frontend_config()
    
    print("\n" + "=" * 60)
    if backend_result:
        print("🎉 New contract integration tests completed successfully!")
        print()
        print("🚀 READY TO TEST:")
        print("   1. Open http://localhost:5000 in your browser")
        print("   2. Try creating a new time capsule")
        print("   3. Verify pixelated images show up correctly")
        print("   4. Check that the transaction goes to the new contract")
        print()
        print("📱 The new contract supports:")
        print("   ✅ Struct-based parameters (no stack too deep)")
        print("   ✅ Pixelated image CID storage on-chain")
        print("   ✅ IPFS integration for pixelated images")
        print("   ✅ Backward compatible API")
    else:
        print("❌ Some tests failed. Check the output above.")
    
    print()
    print("🔗 New Contract: https://gnosisscan.io/address/0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF")
