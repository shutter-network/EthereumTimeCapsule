import os, io, time, base64, json
from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_cors import CORS
from PIL import Image
import requests
import secrets
import hashlib

# Import database and blockchain sync
from database import CapsuleDatabase
from blockchain_sync import BlockchainSyncService

# Note: S3 storage removed - using IPFS + Pinata only

# Import private config
try:
    import config
    from config import PINATA_API_KEY, PINATA_SECRET_API_KEY, PINATA_GATEWAY
    # Try to import JWT token for V3 API
    PINATA_JWT = getattr(config, 'PINATA_JWT', None)
    
    # Check if we're in production
    IS_PRODUCTION = getattr(config, 'IS_PRODUCTION', False)
    
    # Check for V3 API (JWT) first, then fall back to V2 API
    if PINATA_JWT and PINATA_JWT != "your_pinata_jwt_token_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v3"
    elif PINATA_API_KEY and PINATA_SECRET_API_KEY and PINATA_API_KEY != "your_pinata_api_key_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v2"
    else:
        PINATA_ENABLED = False
        PINATA_VERSION = None
except ImportError:
    print("Warning: config.py not found, trying environment variables...")
    # Fallback to environment variables for Heroku deployment
    PINATA_JWT = os.environ.get('PINATA_JWT')
    PINATA_API_KEY = os.environ.get('PINATA_API_KEY')
    PINATA_SECRET_API_KEY = os.environ.get('PINATA_SECRET_API_KEY')
    PINATA_GATEWAY = os.environ.get('PINATA_GATEWAY', 'https://gateway.pinata.cloud')
    
    # Check for V3 API (JWT) first, then fall back to V2 API
    if PINATA_JWT and PINATA_JWT != "your_pinata_jwt_token_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v3"
        print("✅ Pinata V3 (JWT) configured from environment")
    elif PINATA_API_KEY and PINATA_SECRET_API_KEY and PINATA_API_KEY != "your_pinata_api_key_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v2"
        print("✅ Pinata V2 (API Keys) configured from environment")
    else:
        PINATA_ENABLED = False
        PINATA_VERSION = None
        print("❌ Pinata not configured - no valid credentials found")
    
    IS_PRODUCTION = os.environ.get('HEROKU') is not None

SHUTTER_API_BASE   = "https://shutter-api.chiado.staging.shutter.network/api"
SHUTTER_REGISTRY   = os.getenv("SHUTTER_REGISTRY_ADDRESS", "0x2693a4Fb363AdD4356e6b80Ac5A27fF05FeA6D9F")
ONE_YEAR_SECONDS   = 365 * 24 * 60 * 60

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app, origins=["http://localhost:8080", "http://localhost:5000", "https://ethereum-time-capsule-luis-e873bebc232f.herokuapp.com"] if not IS_PRODUCTION else ["*"])

# Frontend routes for production deployment
@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/create')
def create_page():
    return app.send_static_file('create.html')

@app.route('/gallery')
def gallery_page():
    return app.send_static_file('gallery.html')

# Legacy .html routes for backward compatibility
@app.route('/index.html')
def index_html():
    return app.send_static_file('index.html')

@app.route('/create.html')
def create_html():
    return app.send_static_file('create.html')

@app.route('/gallery.html')
def gallery_html():
    return app.send_static_file('gallery.html')

# Initialize database
# Use PostgreSQL on Heroku, SQLite locally
if IS_PRODUCTION and 'DATABASE_URL' in os.environ:
    # For Heroku PostgreSQL - would need additional setup for full PostgreSQL support
    # For now, keep SQLite but store in tmp for Heroku compatibility
    db_path = "/tmp/capsules.db" if IS_PRODUCTION else "capsules.db"
else:
    db_path = "capsules.db"

db = CapsuleDatabase(db_path)

# Initialize blockchain sync service
# Load contract configuration
try:
    # Handle different working directories (local vs Heroku)
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frontend_dir = os.path.join(base_dir, "frontend")
    
    config_path = os.path.join(frontend_dir, "public_config.json")
    abi_path = os.path.join(frontend_dir, "contract_abi.json")
    
    with open(config_path, "r") as f:
        config_data = json.load(f)
    
    with open(abi_path, "r") as f:
        contract_abi = json.load(f)
    
    # Use default network configuration
    default_network = config_data.get("default_network", "testnet")
    network_config = config_data[default_network]
      # Initialize blockchain sync service
    sync_service = BlockchainSyncService(
        rpc_url=network_config["rpc_url"],
        contract_address=network_config["contract_address"],
        contract_abi=contract_abi,
        db=db
    )
    
    print(f"📊 Database initialized, blockchain sync ready for {network_config['contract_address']}")
    
    # Start sync service automatically in production
    if IS_PRODUCTION:
        print("🔄 Starting blockchain sync service in production...")
        sync_service.start_sync()
        print("✅ Blockchain sync service started")
    
except Exception as e:
    print(f"⚠️  Warning: Could not initialize blockchain sync: {e}")
    sync_service = None

# ---------- helpers ----------
def pixelate(img, factor=12):
    w, h = img.size
    img_small = img.resize((max(1, w // factor), max(1, h // factor)), Image.BILINEAR)
    return img_small.resize((w, h), Image.NEAREST)

def shutter_encrypt(hex_msg, enc_meta):
    """Call the Shutter WebAssembly bundle via CLI bridge (simplest)"""
    # For demo we POST to a helper endpoint Shutter exposes (works for small payloads)
    r = requests.post(f"{SHUTTER_API_BASE}/encrypt_hex", json={
        "data": hex_msg,
        "identity":   enc_meta["identity"],
        "eon_key":    enc_meta["eon_key"]
    })
    r.raise_for_status()
    return r.json()["ciphertext"]

def upload_to_pinata(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V3 or V2 API"""
    if not PINATA_ENABLED:
        raise Exception("Pinata not configured")
    
    if PINATA_VERSION == "v3":
        return upload_to_pinata_v3(file_bytes, filename)
    else:
        return upload_to_pinata_v2(file_bytes, filename)

def upload_to_pinata_v3(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V3 API"""
    url = "https://uploads.pinata.cloud/v3/files"
    
    headers = {
        'Authorization': f'Bearer {PINATA_JWT}'
    }
    
    # Prepare the file data
    files = {
        'file': (filename or 'encrypted_data', file_bytes, 'application/octet-stream')
    }
    
    # Add form data to make the file publicly accessible on IPFS
    data = {
        'network': 'public',  # This is the key - makes files publicly accessible
        'name': filename or 'encrypted_data',
        'keyvalues': json.dumps({
            'type': 'time_capsule_encrypted_image',
            'uploaded_at': str(int(time.time()))
        })
    }    
    try:
        print(f"Uploading {len(file_bytes)} bytes to Pinata V3 API (public network)...")
        response = requests.post(url, files=files, data=data, headers=headers)
        print(f"Pinata V3 response status: {response.status_code}")
        print(f"Pinata V3 response: {response.text}")
        response.raise_for_status()
        result = response.json()
        cid = result['data']['cid']
        
        # Verify the file is publicly accessible
        print(f"File uploaded to public IPFS with CID: {cid}")
        print(f"Public URL: https://gateway.pinata.cloud/ipfs/{cid}")
        
        return cid
    except requests.exceptions.RequestException as e:
        print(f"Pinata V3 upload failed: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response status: {e.response.status_code}")
            print(f"Response text: {e.response.text}")
        raise Exception(f"Pinata V3 upload failed: {str(e)}")

def upload_to_pinata_v2(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V2 API (legacy)"""
    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"
    
    headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY
    }
    
    # Prepare the file data
    files = {
        'file': (filename or 'encrypted_data', file_bytes, 'application/octet-stream')
    }
    
    # Optional metadata
    pinata_options = {
        'cidVersion': 1,
    }
    
    data = {
        'pinataOptions': json.dumps(pinata_options)
    }
    
    try:
        print(f"Uploading {len(file_bytes)} bytes to Pinata V2 API...")
        response = requests.post(url, files=files, data=data, headers=headers)
        
        # Debug response
        print(f"Pinata V2 response status: {response.status_code}")
        print(f"Pinata V2 response headers: {dict(response.headers)}")
        
        if response.status_code != 200:
            print(f"Pinata V2 response text: {response.text}")
        
        response.raise_for_status()
        result = response.json()
        print(f"Successfully uploaded to Pinata V2: {result['IpfsHash']}")
        return result['IpfsHash']
    except requests.exceptions.RequestException as e:
        print(f"Pinata V2 upload failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response content: {e.response.text}")
        raise Exception(f"Pinata V2 upload failed: {str(e)}")

def get_pinata_gateway_url(cid):
    """Get the gateway URL for a Pinata IPFS file"""
    if PINATA_GATEWAY:
        return f"{PINATA_GATEWAY}/ipfs/{cid}"
    else:
        return f"https://gateway.pinata.cloud/ipfs/{cid}"

# ---------- routes ----------
@app.route("/health")
def health():
    return {"ok": True, "ts": int(time.time())}

@app.route("/system_info")
def system_info():
    """Return system configuration information"""
    return jsonify({
        "pinata_enabled": PINATA_ENABLED,
        "pinata_version": PINATA_VERSION,
        "pinata_gateway": PINATA_GATEWAY or "https://gateway.pinata.cloud",
        "local_server": "http://localhost:5000",
        "timestamp": int(time.time())
    })

@app.route("/submit_capsule", methods=["POST"])
def submit_capsule():
    try:
        title = request.form.get("title", "").strip()
        tags  = request.form.get("tags", "").strip()
        story = request.form.get("story", "").strip()
        img   = request.files.get("image")
        if not all([title, tags, story, img]):
            return {"error": "Missing field"}, 400        # 1) pixelated preview
        pil = Image.open(img.stream)
        pixelated = pixelate(pil)
        buf = io.BytesIO()
        pixelated.save(buf, format="PNG")
        pixelated_data = buf.getvalue()
        preview_b64 = base64.b64encode(pixelated_data).decode()

        # Use a random hex string as the preview filename
        preview_id = secrets.token_hex(16)
          # Save pixelated image locally (for backwards compatibility)
        pixelated_dir = "pixelated"
        os.makedirs(pixelated_dir, exist_ok=True)
        pixelated_path = os.path.join(pixelated_dir, f"{preview_id}.png")
        pixelated.save(pixelated_path, format="PNG")

        # 2) Register Shutter identity
        reveal_ts = int(request.form.get("revealTimestamp") or time.time() + 30)
        identity_prefix = os.urandom(32).hex()
        reg_resp = requests.post(f"{SHUTTER_API_BASE}/register_identity", json={
            "decryptionTimestamp": reveal_ts,
            "identityPrefix": identity_prefix,
            "registry": SHUTTER_REGISTRY
        })
        reg_json = reg_resp.json()
        if "message" not in reg_json:
            print("Unexpected Shutter API response:", reg_json)
            return {"error": "Shutter API did not return expected data"}, 502
        reg = reg_json["message"]

        # 3) Fetch encryption data
        enc_meta_resp = requests.get(
            f"{SHUTTER_API_BASE}/get_data_for_encryption",
            params={"address": SHUTTER_REGISTRY, "identityPrefix": reg["identity_prefix"]}
        )
        enc_meta_json = enc_meta_resp.json()
        if "message" not in enc_meta_json:
            print("Unexpected get_data_for_encryption response:", enc_meta_json)
            return {"error": "Shutter API did not return encryption data"}, 502
        enc_meta = enc_meta_json["message"]        # 4) Upload pixelated image to IPFS
        pixelated_cid = None
        pixelated_urls = []
        try:
            print("Uploading pixelated image to IPFS...")
            
            # Store pixelated image locally in IPFS storage
            ipfs_dir = "ipfs_storage"
            os.makedirs(ipfs_dir, exist_ok=True)
            
            # Generate a local CID for the pixelated image
            pixelated_hash = hashlib.sha256(pixelated_data).hexdigest()
            local_pixelated_cid = f"Qm{pixelated_hash[:44]}"
            
            # Save locally first
            local_pixelated_path = os.path.join(ipfs_dir, local_pixelated_cid)
            with open(local_pixelated_path, "wb") as f:
                f.write(pixelated_data)
            
            pixelated_cid = local_pixelated_cid
            pixelated_urls = [f"http://localhost:5000/ipfs/{local_pixelated_cid}"]
            
            # Try to upload to Pinata IPFS if configured
            if PINATA_ENABLED:
                try:
                    print("Uploading pixelated image to Pinata IPFS...")
                    pinata_pixelated_cid = upload_to_pinata(pixelated_data, f"pixelated_{preview_id}.png")
                    pinata_pixelated_url = get_pinata_gateway_url(pinata_pixelated_cid)
                    
                    # Also store with Pinata CID locally for faster access
                    pinata_pixelated_path = os.path.join(ipfs_dir, pinata_pixelated_cid)
                    with open(pinata_pixelated_path, "wb") as f:
                        f.write(pixelated_data)
                    
                    # Use Pinata CID as primary
                    pixelated_cid = pinata_pixelated_cid
                    pixelated_urls = [pinata_pixelated_url, f"http://localhost:5000/ipfs/{pinata_pixelated_cid}"]
                    
                    print(f"Successfully uploaded pixelated image to Pinata: {pinata_pixelated_cid}")
                    
                except Exception as e:
                    print(f"Pinata upload failed for pixelated image, using local storage only: {e}")
            
        except Exception as e:
            print(f"Error uploading pixelated image to IPFS: {e}")
            # Fallback to returning base64 data if IPFS upload fails
            pixelated_urls = [f"data:image/png;base64,{preview_b64}"]

        # 5) Return all info to frontend for client-side encryption
        response_data = {
            "shutterIdentity":  reg["identity"],
            "identityPrefix":   reg["identity_prefix"],
            "eonKey":           reg["eon_key"],
            "revealTimestamp":  reveal_ts,
            "encMeta":          enc_meta,
            "pixelatedId": preview_id  # Keep for backward compatibility
        }
        
        # Add pixelated image info
        if pixelated_cid:
            response_data["pixelatedCid"] = pixelated_cid
            response_data["pixelatedUrls"] = pixelated_urls
            response_data["pixelatedImage"] = pixelated_urls[0]  # Primary URL
        else:
            response_data["pixelatedImage"] = f"data:image/png;base64,{preview_b64}"
            
        return jsonify(response_data)
    except Exception as e:
        print("Error in /submit_capsule:", e)
        return {"error": str(e)}, 500

@app.route("/upload_ipfs", methods=["POST"])
def upload_ipfs():
    try:
        data = request.json
        hex_data = data.get("hex")
        if not hex_data or not hex_data.startswith("0x"):
            return {"error": "Missing or invalid hex data"}, 400
        
        # Convert hex string to bytes
        file_bytes = bytes.fromhex(hex_data[2:])
        
        # Generate a deterministic CID-like hash for the content (for local storage)
        content_hash = hashlib.sha256(file_bytes).hexdigest()
        local_cid = f"Qm{content_hash[:44]}"  # Simulate IPFS CID format
        
        # Store the file locally with the CID as filename (fallback)
        ipfs_dir = "ipfs_storage"
        os.makedirs(ipfs_dir, exist_ok=True)
        file_path = os.path.join(ipfs_dir, local_cid)
        
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        
        result = {
            "cid": local_cid,
            "local_url": f"http://localhost:5000/ipfs/{local_cid}",
            "pinata_enabled": PINATA_ENABLED
        }
          # Try to upload to Pinata IPFS if configured
        if PINATA_ENABLED:
            try:
                print("Uploading to Pinata IPFS...")
                pinata_cid = upload_to_pinata(file_bytes)
                pinata_url = get_pinata_gateway_url(pinata_cid)
                
                # Also store the file locally with the Pinata CID for faster access
                pinata_file_path = os.path.join(ipfs_dir, pinata_cid)
                with open(pinata_file_path, "wb") as f:
                    f.write(file_bytes)
                
                result.update({
                    "pinata_cid": pinata_cid,
                    "pinata_url": pinata_url,
                    "ipfs_urls": [pinata_url, f"http://localhost:5000/ipfs/{pinata_cid}"]
                })
                print(f"Successfully uploaded to Pinata: {pinata_cid}")
                
                # Use Pinata CID as primary CID if upload successful
                result["cid"] = pinata_cid
                
            except Exception as e:
                print(f"Pinata upload failed, using local storage only: {e}")
                result.update({
                    "pinata_error": str(e),
                    "ipfs_urls": [f"http://localhost:5000/ipfs/{local_cid}"]
                })
        else:
            result["ipfs_urls"] = [f"http://localhost:5000/ipfs/{local_cid}"]
            
        return jsonify(result)
        
    except Exception as e:
        print("Error in /upload_ipfs:", e)
        return {"error": str(e)}, 500

@app.route("/pixelated/<cid>")
def pixelated(cid):
    """
    Serve pixelated images from IPFS storage or local storage
    Priority: Local > IPFS > Generate on-the-fly
    """
    print(f"Pixelated request for CID: {cid}")
    
    # First, try local storage
    local_path = os.path.join("pixelated", f"{cid}.png")
    print(f"Checking local pixelated file: {local_path}")
    
    if os.path.exists(local_path):
        print(f"Serving local pixelated file: {local_path}")
        try:
            with open(local_path, 'rb') as f:
                file_data = f.read()
            return file_data, 200, {'Content-Type': 'image/png'}
        except Exception as e:
            print(f"Error reading local pixelated file: {e}")
    
    # Try to generate on-the-fly from IPFS storage
    print(f"Pixelated file not found locally, attempting to generate from IPFS: {cid}")
    try:
        # Try to get the original image from IPFS storage
        ipfs_path = os.path.join("ipfs_storage", cid)
        if os.path.exists(ipfs_path):
            print(f"Found IPFS file: {ipfs_path}")
            # Read the encrypted/original image
            with open(ipfs_path, 'rb') as f:
                image_data = f.read()
            
            # Try to decode as image and pixelate it
            try:
                pil_image = Image.open(io.BytesIO(image_data))
                pixelated_image = pixelate(pil_image)
                
                # Convert to bytes
                buf = io.BytesIO()
                pixelated_image.save(buf, format="PNG")
                pixelated_data = buf.getvalue()
                
                # Save locally for future requests
                try:
                    os.makedirs("pixelated", exist_ok=True)
                    with open(local_path, 'wb') as f:
                        f.write(pixelated_data)
                    print(f"Saved generated pixelated image locally: {local_path}")
                except Exception as save_error:
                    print(f"Could not save pixelated image locally: {save_error}")
                
                return pixelated_data, 200, {'Content-Type': 'image/png'}
                
            except Exception as image_error:
                print(f"Could not process image for pixelation: {image_error}")
        else:
            print(f"IPFS file not found: {ipfs_path}")
    except Exception as e:
        print(f"Error generating pixelated image: {e}")
    
    # If all else fails, return a placeholder image
    print(f"Returning 404 for pixelated image: {cid}")
    return "Pixelated image not found", 404

@app.route("/ipfs/<cid>")
def serve_ipfs(cid):
    # Serve files from local IPFS storage
    path = os.path.join("ipfs_storage", cid)
    print(f"IPFS request for CID: {cid}, looking for file: {path}")
    if not os.path.exists(path):
        print(f"IPFS file not found locally: {path}")
        
        # If Pinata is enabled, try to fetch from Pinata gateway
        if PINATA_ENABLED:
            try:
                print(f"Attempting to fetch from Pinata gateway: {cid}")
                pinata_url = get_pinata_gateway_url(cid)
                response = requests.get(pinata_url, timeout=10)
                response.raise_for_status()
                
                # Cache the file locally for future requests
                os.makedirs("ipfs_storage", exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(response.content)
                print(f"Successfully fetched and cached from Pinata: {cid}")
                
                return response.content, 200, {'Content-Type': 'application/octet-stream'}
            except Exception as e:
                print(f"Failed to fetch from Pinata: {e}")
        
        return "Not found", 404
    
    print(f"Serving IPFS file: {path}")
    try:
        # Read file and return with proper headers
        with open(path, 'rb') as f:
            file_data = f.read()
        return file_data, 200, {'Content-Type': 'application/octet-stream'}
    except Exception as e:
        print(f"Error serving IPFS file: {e}")
        return "Error reading file", 500

@app.route("/save_pixelated", methods=["POST"])
def save_pixelated():
    try:
        data = request.json
        cid = data.get("cid")
        preview_id = data.get("preview_id")
        print(f"save_pixelated called with cid={cid}, preview_id={preview_id}")
        if not cid or not preview_id:
            return {"error": "Missing cid or preview_id"}, 400
            
        src = os.path.join("pixelated", f"{preview_id}.png")
        dst = os.path.join("pixelated", f"{cid}.png")
        print(f"Renaming {src} to {dst}")
        
        if not os.path.exists(src):
            print(f"Source file {src} does not exist")
            return {"error": "Preview not found"}, 404
            
        # Read the pixelated image data
        with open(src, 'rb') as f:
            pixelated_data = f.read()
              # Rename locally
        os.rename(src, dst)
        print(f"Successfully renamed {src} to {dst}")
        
        return {"ok": True}
    except Exception as e:
        print("Error in /save_pixelated:", e)
        return {"error": str(e)}, 500

# ---------- DATABASE API ENDPOINTS ----------
@app.route("/api/capsules", methods=["GET"])
def get_capsules():
    """Get capsules from database with pagination"""
    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 10))
        revealed_only = request.args.get("revealed_only", "false").lower() == "true"
        
        capsules = db.get_capsules(offset=offset, limit=limit, revealed_only=revealed_only)
        total_count = db.get_capsule_count()        # Format capsules for frontend compatibility
        formatted_capsules = []
        for capsule in capsules:
            formatted_capsule = {
                "id": capsule["id"],
                "creator": capsule["creator"],
                "title": capsule["title"],
                "tags": capsule["tags"],
                "encryptedStory": capsule["encrypted_story"].hex() if isinstance(capsule["encrypted_story"], bytes) else capsule["encrypted_story"],
                "decryptedStory": capsule["decrypted_story"],
                "isRevealed": bool(capsule["is_revealed"]),
                "revealTime": capsule["reveal_time"],
                "shutterIdentity": capsule["shutter_identity"],
                "imageCID": capsule["image_cid"],
                "pixelatedImageCID": capsule.get("pixelated_image_cid", "")
            }
            formatted_capsules.append(formatted_capsule)
        
        return jsonify({
            "success": True,
            "capsules": formatted_capsules,
            "total_count": total_count,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total_count
        })
        
    except Exception as e:
        print("Error in /api/capsules:", e)
        return {"error": str(e)}, 500

@app.route("/api/capsules/<int:capsule_id>", methods=["GET"])
def get_capsule(capsule_id):
    """Get a single capsule by ID"""
    try:
        capsule = db.get_capsule(capsule_id)
        
        if not capsule:
            return {"error": "Capsule not found"}, 404        # Format for frontend compatibility
        formatted_capsule = {
            "id": capsule["id"],
            "creator": capsule["creator"],
            "title": capsule["title"],
            "tags": capsule["tags"],
            "encryptedStory": capsule["encrypted_story"].hex() if isinstance(capsule["encrypted_story"], bytes) else capsule["encrypted_story"],
            "decryptedStory": capsule["decrypted_story"],
            "isRevealed": bool(capsule["is_revealed"]),
            "revealTime": capsule["reveal_time"],
            "shutterIdentity": capsule["shutter_identity"],
            "imageCID": capsule["image_cid"],
            "pixelatedImageCID": capsule.get("pixelated_image_cid", "")
        }
        
        return jsonify({
            "success": True,
            "capsule": formatted_capsule
        })
        
    except Exception as e:
        print(f"Error in /api/capsules/{capsule_id}:", e)
        return {"error": str(e)}, 500

@app.route("/api/capsules/search", methods=["GET"])
def search_capsules():
    """Search capsules by title, tags, or creator"""
    try:
        query = request.args.get("q", "").strip()
        limit = int(request.args.get("limit", 10))
        
        if not query:
            return {"error": "Search query is required"}, 400
        
        capsules = db.search_capsules(query, limit=limit)
        
        # Format capsules for frontend
        formatted_capsules = []
        for capsule in capsules:
            formatted_capsule = {
                "id": capsule["id"],
                "creator": capsule["creator"],
                "title": capsule["title"],
                "tags": capsule["tags"],
                "encryptedStory": capsule["encrypted_story"].hex() if isinstance(capsule["encrypted_story"], bytes) else capsule["encrypted_story"],
                "decryptedStory": capsule["decrypted_story"],
                "isRevealed": bool(capsule["is_revealed"]),
                "revealTime": capsule["reveal_time"],
                "shutterIdentity": capsule["shutter_identity"],
                "imageCID": capsule["image_cid"]
            }
            formatted_capsules.append(formatted_capsule)
        
        return jsonify({
            "success": True,
            "capsules": formatted_capsules,
            "query": query,
            "count": len(formatted_capsules)
        })
        
    except Exception as e:
        print("Error in /api/capsules/search:", e)
        return {"error": str(e)}, 500

@app.route("/api/capsules/creator/<creator_address>", methods=["GET"])
def get_capsules_by_creator(creator_address):
    """Get capsules created by a specific address"""
    try:
        limit = int(request.args.get("limit", 10))
        
        capsules = db.get_capsules_by_creator(creator_address, limit=limit)
        
        # Format capsules for frontend
        formatted_capsules = []
        for capsule in capsules:
            formatted_capsule = {
                "id": capsule["id"],
                "creator": capsule["creator"],
                "title": capsule["title"],
                "tags": capsule["tags"],
                "encryptedStory": capsule["encrypted_story"],
                "decryptedStory": capsule["decrypted_story"],
                "isRevealed": bool(capsule["is_revealed"]),
                "revealTime": capsule["reveal_time"],
                "shutterIdentity": capsule["shutter_identity"],
                "imageCID": capsule["image_cid"]
            }
            formatted_capsules.append(formatted_capsule)
        
        return jsonify({
            "success": True,
            "capsules": formatted_capsules,
            "creator": creator_address,
            "count": len(formatted_capsules)
        })
        
    except Exception as e:
        print(f"Error in /api/capsules/creator/{creator_address}:", e)
        return {"error": str(e)}, 500

@app.route("/api/sync/status", methods=["GET"])
def get_sync_status():
    """Get blockchain synchronization status"""
    try:
        if not sync_service:
            return {"error": "Sync service not available"}, 503
        
        health = sync_service.get_sync_health()
        db_status = db.get_sync_status()
        
        return jsonify({
            "success": True,
            "sync_health": health,
            "database_status": db_status
        })
        
    except Exception as e:
        print("Error in /api/sync/status:", e)
        return {"error": str(e)}, 500

@app.route("/api/sync/force", methods=["POST"])
def force_sync():
    """Force immediate blockchain synchronization"""
    try:
        if not sync_service:
            return {"error": "Sync service not available"}, 503
        
        result = sync_service.force_sync()
        
        return jsonify({
            "success": True,
            "sync_result": result
        })
        
    except Exception as e:
        print("Error in /api/sync/force:", e)
        return {"error": str(e)}, 500

@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Get general statistics"""
    try:
        total_capsules = db.get_capsule_count()
        recent_capsules = len(db.get_recent_capsules(hours=24, limit=100))
        revealed_capsules = len(db.get_capsules(limit=1000, revealed_only=True))
        
        # Get sync health if available
        sync_health = None
        if sync_service:
            try:
                sync_health = sync_service.get_sync_health()
            except:
                pass
        
        return jsonify({
            "success": True,
            "statistics": {
                "total_capsules": total_capsules,
                "revealed_capsules": revealed_capsules,
                "unrevealed_capsules": total_capsules - revealed_capsules,
                "recent_capsules_24h": recent_capsules,
                "database_healthy": sync_health is not None and sync_health.get("is_healthy", False),
                "last_sync": sync_health.get("last_sync_time") if sync_health else None
            }
        })
        
    except Exception as e:
        print("Error in /api/stats:", e)
        return {"error": str(e)}, 500

@app.route("/api/test/speed-comparison", methods=["GET"])
def test_speed_comparison():
    """Compare database vs blockchain response times"""
    try:
        import time
        
        # Test database speed
        db_start = time.time()
        db_capsules = db.get_capsules(limit=5)
        db_time = time.time() - db_start
        
        # Test blockchain speed (if available)
        blockchain_time = None
        blockchain_capsules = []
        
        if sync_service and sync_service.contract:
            try:
                blockchain_start = time.time()
                total_on_chain = sync_service.contract.functions.capsuleCount().call()
                # Fetch first 5 capsules from blockchain
                for i in range(min(5, total_on_chain)):
                    sync_service.contract.functions.getCapsule(i).call()
                blockchain_time = time.time() - blockchain_start
                blockchain_capsules = list(range(min(5, total_on_chain)))
            except Exception as e:
                blockchain_time = f"Error: {e}"
        
        return jsonify({
            "success": True,
            "database": {
                "time_seconds": round(db_time, 4),
                "capsules_fetched": len(db_capsules),
                "source": "SQLite Database"
            },
            "blockchain": {
                "time_seconds": blockchain_time,
                "capsules_fetched": len(blockchain_capsules) if isinstance(blockchain_capsules, list) else 0,
                "source": "Gnosis Chain RPC"
            },
            "speedup_factor": round(blockchain_time / db_time, 2) if isinstance(blockchain_time, (int, float)) and db_time > 0 else "N/A"        })
    except Exception as e:
        print("Error in /api/test/speed-comparison:", e)
        return {"error": str(e)}, 500

@app.route("/debug/contract")
def debug_contract():
    """Debug endpoint to show current contract configuration"""
    try:
        # Load the same config that the frontend uses
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        frontend_dir = os.path.join(base_dir, "frontend")
        config_path = os.path.join(frontend_dir, "public_config.json")
        
        with open(config_path, "r") as f:
            config_data = json.load(f)
        
        # Get current network config
        default_network = config_data.get("default_network", "testnet")
        network_config = config_data[default_network]
        
        return jsonify({
            "success": True,
            "config_source": config_path,
            "default_network": default_network,
            "current_config": network_config,
            "backend_contract_address": sync_service.contract_address if sync_service else "Not initialized",
            "backend_rpc_url": sync_service.rpc_url if sync_service else "Not initialized",
            "expected_contract": "0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF",
            "config_match": network_config.get("contract_address") == "0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF",
            "timestamp": int(time.time())
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "timestamp": int(time.time())
        }), 500

if __name__ == "__main__":
    # Start blockchain sync service
    if sync_service:
        print("🔄 Starting blockchain sync service...")
        sync_service.start_sync()
        print("✅ Blockchain sync service started")
    else:
        print("⚠️  Running without blockchain sync")
    
    print("🚀  backend on http://127.0.0.1:5000")
    app.run(debug=True)
