#!/usr/bin/env python3
"""
Test script to verify dithering configuration is working properly
"""

import json
import requests
import time

def test_config_loading():
    """Test that the config file is properly formatted and contains required fields"""
    print("🧪 Testing configuration file...")
    
    try:
        with open("frontend/public_config.json", "r") as f:
            config = json.load(f)
        
        # Check if image_processing section exists
        if "image_processing" not in config:
            print("❌ image_processing section missing from config")
            return False
        
        img_config = config["image_processing"]
        required_fields = [
            "pixelation_factor",
            "smoothing_factor", 
            "enable_floyd_steinberg_dithering",
            "enable_advanced_dithering"
        ]
        
        for field in required_fields:
            if field not in img_config:
                print(f"❌ Required field '{field}' missing from image_processing config")
                return False
            print(f"✅ {field}: {img_config[field]}")
        
        print("✅ Configuration file is valid")
        return True
        
    except Exception as e:
        print(f"❌ Error loading config: {e}")
        return False

def test_backend_config_endpoint():
    """Test that the backend can read and serve the configuration"""
    print("\n🧪 Testing backend configuration endpoint...")
    
    try:
        # Test local backend
        response = requests.get("http://localhost:5000/api/image-processing-config", timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Backend config endpoint working")
            print(f"✅ Source: {data.get('source', 'unknown')}")
            print(f"✅ Config: {data.get('config', {})}")
            return True
        else:
            print(f"❌ Backend returned status {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Backend not running (expected if not started): {e}")
        return False

def test_config_variations():
    """Test different configuration values"""
    print("\n🧪 Testing configuration variations...")
    
    # Test cases with different parameter values
    test_cases = [
        {
            "name": "High quality (low factors)",
            "pixelation_factor": 8,
            "smoothing_factor": 6,
            "enable_floyd_steinberg_dithering": True,
            "enable_advanced_dithering": True
        },
        {
            "name": "Low quality (high factors)", 
            "pixelation_factor": 20,
            "smoothing_factor": 18,
            "enable_floyd_steinberg_dithering": True,
            "enable_advanced_dithering": True
        },
        {
            "name": "Pixelation only",
            "pixelation_factor": 14,
            "smoothing_factor": 12,
            "enable_floyd_steinberg_dithering": False,
            "enable_advanced_dithering": True
        },
        {
            "name": "Simple pixelation (legacy)",
            "pixelation_factor": 14,
            "smoothing_factor": 12,
            "enable_floyd_steinberg_dithering": False,
            "enable_advanced_dithering": False
        }
    ]
    
    original_config_path = "frontend/public_config.json"
    backup_config_path = "frontend/public_config.json.backup"
    
    try:
        # Backup original config
        with open(original_config_path, "r") as f:
            original_config = json.load(f)
        
        with open(backup_config_path, "w") as f:
            json.dump(original_config, f, indent=2)
        
        print(f"✅ Created backup at {backup_config_path}")
        
        # Test each configuration
        for test_case in test_cases:
            print(f"\n🔧 Testing: {test_case['name']}")
            
            # Update config
            test_config = original_config.copy()
            test_config["image_processing"] = {
                "pixelation_factor": test_case["pixelation_factor"],
                "smoothing_factor": test_case["smoothing_factor"],
                "enable_floyd_steinberg_dithering": test_case["enable_floyd_steinberg_dithering"],
                "enable_advanced_dithering": test_case["enable_advanced_dithering"]
            }
            
            # Write test config
            with open(original_config_path, "w") as f:
                json.dump(test_config, f, indent=2)
            
            print(f"   📝 Updated config with: pixelation_factor={test_case['pixelation_factor']}, smoothing_factor={test_case['smoothing_factor']}")
            print(f"   📝 Floyd-Steinberg: {test_case['enable_floyd_steinberg_dithering']}, Advanced: {test_case['enable_advanced_dithering']}")
            
            # Note: In a real test, you would restart the backend here to test the new config
            print(f"   ✅ Config written successfully")
        
    except Exception as e:
        print(f"❌ Error during configuration testing: {e}")
        return False
    
    finally:
        # Restore original config
        try:
            with open(backup_config_path, "r") as f:
                original_config = json.load(f)
            
            with open(original_config_path, "w") as f:
                json.dump(original_config, f, indent=2)
            
            print(f"\n✅ Restored original configuration")
            
            # Clean up backup
            import os
            os.remove(backup_config_path)
            print(f"✅ Removed backup file")
            
        except Exception as e:
            print(f"❌ Error restoring config: {e}")
    
    return True

def main():
    """Run all tests"""
    print("🚀 Starting dithering configuration tests...\n")
    
    tests = [
        test_config_loading,
        test_backend_config_endpoint,
        test_config_variations
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"❌ Test {test.__name__} failed with exception: {e}")
            results.append(False)
    
    print(f"\n📊 Test Results:")
    print(f"   Passed: {sum(results)}/{len(results)}")
    print(f"   Success Rate: {(sum(results)/len(results))*100:.1f}%")
    
    if all(results):
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed")
        return 1

if __name__ == "__main__":
    exit(main())
