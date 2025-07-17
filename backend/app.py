import os, io, time, base64, json, re
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_cors import CORS
from PIL import Image, ImageFilter, ImageFile
import requests
import secrets
import hashlib
import bleach
from html import escape

# Import database and blockchain sync
from database import CapsuleDatabase
from blockchain_sync_events import EventBasedBlockchainSyncService
from public_config import public_config as config_data, public_config_path

# Note: S3 storage removed - using IPFS + Pinata only

# Prevent decompression bomb attacks
ImageFile.LOAD_TRUNCATED_IMAGES = False
ImageFile.MAX_IMAGE_PIXELS = 4096 * 4096

PINATA_JWT = os.environ.get('PINATA_JWT')
PINATA_API_KEY = os.environ.get('PINATA_API_KEY')
PINATA_SECRET_API_KEY = os.environ.get('PINATA_SECRET_API_KEY')
PINATA_GATEWAY = os.environ.get('PINATA_GATEWAY', 'https://gateway.pinata.cloud')

# Shutter configuration from environment variables only
SHUTTER_API_BASE = os.environ.get("SHUTTER_API_BASE")
SHUTTER_REGISTRY = os.environ.get("SHUTTER_REGISTRY_ADDRESS")
SHUTTER_BEARER_TOKEN = os.environ.get("SHUTTER_BEARER_TOKEN")

# Image upload configuration from environment variables only
MAX_IMAGE_SIZE_MB = os.environ.get('MAX_IMAGE_SIZE_MB')

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

# Detect production environment (Heroku provides PORT env var)
IS_PRODUCTION = os.environ.get('PORT') is not None or os.environ.get('DYNO') is not None

# Apply defaults for Shutter configuration if not set
SHUTTER_API_BASE = SHUTTER_API_BASE or "https://shutter-api.chiado.staging.shutter.network/api"
SHUTTER_REGISTRY = SHUTTER_REGISTRY or "0x2693a4Fb363AdD4356e6b80Ac5A27fF05FeA6D9F"

# Apply defaults for image upload configuration if not set
MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_MB or int(os.environ.get('MAX_IMAGE_SIZE_MB', 10))  # Default 10MB

# Log Shutter configuration status
if SHUTTER_BEARER_TOKEN:
    print("✅ Shutter API bearer token configured")
else:
    print("ℹ️ Shutter API bearer token not configured - requests will be unauthenticated")
print(f"🔗 Shutter API Base: {SHUTTER_API_BASE}")
print(f"📋 Shutter Registry: {SHUTTER_REGISTRY}")

# Log image upload configuration
print(f"📁 Max image size: {MAX_IMAGE_SIZE_MB}MB")

ONE_YEAR_SECONDS   = 365 * 24 * 60 * 60

# Image upload configuration (converted to bytes)
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024

app = Flask(__name__, static_folder="../frontend", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_SIZE_BYTES  # Set max upload size in bytes
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

@app.route('/default.jpg')
def default_image():
    return app.send_static_file('default.jpg')

@app.route('/public_config.json')
def public_config():
    return config_data

# Initialize database
# Use PostgreSQL on Heroku, SQLite locally
if IS_PRODUCTION and 'DATABASE_URL' in os.environ:
    # For Heroku PostgreSQL - would need additional setup for full PostgreSQL support
    # For now, keep SQLite but store in tmp for Heroku compatibility
    db_path = "/tmp/capsules.db" if IS_PRODUCTION else "capsules.db"
else:
    db_path = "capsules.db"

db = CapsuleDatabase(db_path)

# =============  SECURITY FUNCTIONS  =============
def sanitize_text_input(text):
    """Sanitize text input to prevent XSS attacks"""
    if not isinstance(text, str):
        return text
    
    # First escape HTML entities
    text = escape(text)
    
    # Remove dangerous patterns
    dangerous_patterns = [
        r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>',  # script tags
        r'javascript:',  # javascript: urls
        r'vbscript:',   # vbscript: urls
        r'on\w+\s*=',   # event handlers like onclick=
        r'data:text\/html',  # data URLs
        r'expression\s*\(',  # CSS expressions
    ]
    
    for pattern in dangerous_patterns:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE)
    
    # Use bleach for additional sanitization (allows basic formatting)
    allowed_tags = []  # No HTML tags allowed
    allowed_attributes = {}
    
    try:
        text = bleach.clean(text, tags=allowed_tags, attributes=allowed_attributes, strip=True)
    except:
        # Fallback if bleach fails
        pass
    
    # Final cleanup - remove any remaining < > characters
    text = text.replace('<', '&lt;').replace('>', '&gt;')
    
    return text.strip()

def sanitize_capsule_data(data):
    """Sanitize all text fields in capsule data"""
    sanitized = {}
    
    text_fields = ['title', 'tags', 'story', 'userName']
    
    for key, value in data.items():
        if key in text_fields and isinstance(value, str):
            sanitized[key] = sanitize_text_input(value)
        else:
            sanitized[key] = value
    
    return sanitized

# Initialize blockchain sync service
# Load contract configuration
try:    # Handle different working directories (local vs Heroku)
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frontend_dir = os.path.join(base_dir, "frontend")
    abi_path = os.path.join(frontend_dir, "contract_abi.json")
    
    with open(abi_path, "r") as f:
        contract_abi = json.load(f)      # Store image processing config globally
    IMAGE_PROCESSING_CONFIG = config_data.get("image_processing", {
        "target_vertical_resolution": 120,
        "smoothing_factor": 12,
        "enable_floyd_steinberg_dithering": True,
        "enable_black_white_dithering": False,
        "enable_advanced_dithering": True,
        "max_processing_dimension": 800,
        "disable_dithering_on_large_images": True
    })
    
    print(f"📊 Image processing config loaded: {IMAGE_PROCESSING_CONFIG}")
    
    
    # Get start block configuration (optional)
    network_config = config_data["network"]
    start_block = network_config.get("start_block", 0)
    
    # Initialize event-based blockchain sync service  
    sync_service = EventBasedBlockchainSyncService(
        rpc_url=network_config["rpc_url"],
        contract_address=network_config["contract_address"],
        contract_abi=contract_abi,
        db=db,
        start_block=start_block
    )
    
    print(f"📊 Database initialized, ultra-optimized event-based sync ready for {network_config['contract_address']}")
    print(f"🔄 Sync configured to start from block {start_block} (0 = genesis)")
    
    # Start sync service automatically
    print("🔄 Starting ultra-optimized blockchain sync service...")
    sync_service.start_sync()
    print("✅ Ultra-optimized blockchain sync service started (zero RPC calls!)")
    
except Exception as e:
    print(f"⚠️  Warning: Could not initialize blockchain sync: {e}")
    sync_service = None

# Fallback image processing config in case loading fails
if 'IMAGE_PROCESSING_CONFIG' not in globals():
    IMAGE_PROCESSING_CONFIG = {
        "target_vertical_resolution": 120,
        "smoothing_factor": 12,
        "enable_floyd_steinberg_dithering": True,
        "enable_black_white_dithering": False,
        "enable_advanced_dithering": True,
        "max_processing_dimension": 800,
        "disable_dithering_on_large_images": True
    }

def get_shutter_headers():
    """Get headers for Shutter API requests including bearer token if configured"""
    headers = {'Content-Type': 'application/json'}
    if SHUTTER_BEARER_TOKEN:
        headers['Authorization'] = f'Bearer {SHUTTER_BEARER_TOKEN}'
    return headers
    print("⚠️  Using fallback image processing config")

# ---------- helpers ----------
def standardize_resolution(img, target_height=None):
    """Step 1: Standardize image to a fixed vertical resolution (pixelization effect)"""
    if target_height is None:
        target_height = IMAGE_PROCESSING_CONFIG.get("target_vertical_resolution", 120)
    
    w, h = img.size
    
    # Calculate new width maintaining aspect ratio
    aspect_ratio = w / h
    new_w = int(target_height * aspect_ratio)
    new_h = target_height
    
    print(f"🎨 Standardizing resolution: {w}x{h} -> {new_w}x{new_h} (target height: {target_height})")
    
    # Downscale to target resolution for pixelation effect
    img_standardized = img.resize((new_w, new_h), Image.BILINEAR)
    return img_standardized

def pixelate(img, factor=None):
    """Legacy function - now uses standardize_resolution for better control"""
    # Convert old factor to approximate target height for backward compatibility
    if factor is None:
        return standardize_resolution(img)
    
    w, h = img.size
    # Approximate the old behavior: if factor was 14, that meant divide by 14
    # So for a 480px high image, that would be ~34px high
    # We'll use the factor as a divisor of the original height
    target_height = max(10, h // factor)  # Minimum 10px height
    return standardize_resolution(img, target_height)

def smoothen(img, factor=None):
    """Step 2: Apply smoothing filter to small pixelated image"""
    if factor is None:
        factor = IMAGE_PROCESSING_CONFIG.get("smoothing_factor", 12)
    
    w, h = img.size
    print(f"🎨 Smoothing: {w}x{h} (factor: {factor})")
    
    # For small pixelated images, apply gentle smoothing
    # Only smooth if the image is large enough to benefit from it
    if w > factor and h > factor:
        # Create a slightly smaller intermediate size for smoothing
        smooth_w = max(1, w // factor)
        smooth_h = max(1, h // factor)
        
        # Resize down with LANCZOS for better quality smoothing
        img_smooth = img.resize((smooth_w, smooth_h), Image.LANCZOS)
        # Resize back up with BILINEAR for smooth interpolation
        return img_smooth.resize((w, h), Image.BILINEAR)
    else:
        # Image is already very small, apply gentle blur instead
        return img.filter(ImageFilter.SMOOTH)

def floyd_steinberg_dither(img, black_white=None):
    """Step 3: Apply Floyd-Steinberg dithering (optimized for performance)"""
    import numpy as np
    
    # Convert to RGB if not already
    if img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Check if we should use black & white dithering
    if black_white is None:
        black_white = IMAGE_PROCESSING_CONFIG.get("enable_black_white_dithering", False)
    
    # Get max dimension from config
    max_dimension = IMAGE_PROCESSING_CONFIG.get("max_processing_dimension", 800)
    disable_on_large = IMAGE_PROCESSING_CONFIG.get("disable_dithering_on_large_images", True)
    
    original_size = img.size
    
    # Check if image is too large and we should skip dithering
    if disable_on_large and max(original_size) > max_dimension:
        print(f"🎨 Image {original_size} is too large, skipping Floyd-Steinberg dithering for performance")
        return img
    
    # Limit image size for performance - resize if too large
    if max(original_size) > max_dimension:
        # Calculate new size maintaining aspect ratio
        ratio = max_dimension / max(original_size)
        new_size = (int(original_size[0] * ratio), int(original_size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        print(f"🎨 Resized image from {original_size} to {new_size} for dithering performance")
    
    # Convert to numpy array for easier manipulation
    pixels = np.array(img, dtype=np.float32)
    height, width, channels = pixels.shape
    
    dither_type = "black & white" if black_white else "color"
    print(f"🎨 Processing {width}x{height} image for {dither_type} Floyd-Steinberg dithering...")
    
    if black_white:
        # Convert to grayscale first
        grayscale = np.dot(pixels, [0.299, 0.587, 0.114])  # Standard RGB to grayscale conversion
        
        # Apply Floyd-Steinberg dithering to grayscale channel
        for y in range(height):
            for x in range(width):
                old_pixel = grayscale[y, x]
                new_pixel = 255.0 if old_pixel > 127.5 else 0.0  # Threshold at middle gray
                grayscale[y, x] = new_pixel
                
                quant_error = old_pixel - new_pixel
                
                # Distribute error to neighboring pixels
                if x + 1 < width:
                    grayscale[y, x + 1] = np.clip(grayscale[y, x + 1] + quant_error * 7/16, 0, 255)
                if y + 1 < height:
                    if x - 1 >= 0:
                        grayscale[y + 1, x - 1] = np.clip(grayscale[y + 1, x - 1] + quant_error * 3/16, 0, 255)
                    grayscale[y + 1, x] = np.clip(grayscale[y + 1, x] + quant_error * 5/16, 0, 255)
                    if x + 1 < width:
                        grayscale[y + 1, x + 1] = np.clip(grayscale[y + 1, x + 1] + quant_error * 1/16, 0, 255)
        
        # Convert back to RGB (all channels the same for grayscale)
        pixels = np.stack([grayscale, grayscale, grayscale], axis=2)
    else:
        # Apply Floyd-Steinberg dithering to each RGB channel separately
        for c in range(channels):
            for y in range(height):
                for x in range(width):
                    old_pixel = pixels[y, x, c]
                    new_pixel = np.round(old_pixel / 255.0) * 255.0
                    pixels[y, x, c] = new_pixel
                    
                    quant_error = old_pixel - new_pixel
                    
                    # Distribute error to neighboring pixels
                    # Error distribution pattern:
                    #     * 7
                    #   3 5 1
                    if x + 1 < width:
                        pixels[y, x + 1, c] = np.clip(pixels[y, x + 1, c] + quant_error * 7/16, 0, 255)
                    if y + 1 < height:
                        if x - 1 >= 0:
                            pixels[y + 1, x - 1, c] = np.clip(pixels[y + 1, x - 1, c] + quant_error * 3/16, 0, 255)
                        pixels[y + 1, x, c] = np.clip(pixels[y + 1, x, c] + quant_error * 5/16, 0, 255)
                        if x + 1 < width:
                            pixels[y + 1, x + 1, c] = np.clip(pixels[y + 1, x + 1, c] + quant_error * 1/16, 0, 255)
    
    # Convert back to PIL Image
    pixels = np.clip(pixels, 0, 255).astype(np.uint8)
    result_img = Image.fromarray(pixels)
    
    # Resize back to original size if we resized for processing
    if max(original_size) > max_dimension and not disable_on_large:
        result_img = result_img.resize(original_size, Image.NEAREST)
        print(f"🎨 Resized result back to original size {original_size}")
    
    return result_img

def advanced_dither(img):
    """Apply the complete 3-step dithering process: standardize resolution -> smoothen -> floyd-steinberg"""
    
    # Check if advanced dithering is enabled
    if not IMAGE_PROCESSING_CONFIG.get("enable_advanced_dithering", True):
        print("🎨 Advanced dithering disabled in config, using simple resolution standardization")
        return standardize_resolution(img)
    
    # Step 1: Standardize resolution (replaces pixelation_factor)
    target_height = IMAGE_PROCESSING_CONFIG.get("target_vertical_resolution", 120)
    img = standardize_resolution(img, target_height)
    print(f"🎨 Step 1: Standardized resolution (target height: {target_height})")
    
    # Step 2: Smoothen (use config parameter) 
    smoothing_factor = IMAGE_PROCESSING_CONFIG.get("smoothing_factor", 12)
    img = smoothen(img, factor=smoothing_factor)
    print(f"🎨 Step 2: Smoothened image (factor: {smoothing_factor})")
    
    # Step 3: Floyd-Steinberg dithering (if enabled)
    if IMAGE_PROCESSING_CONFIG.get("enable_floyd_steinberg_dithering", True):
        black_white = IMAGE_PROCESSING_CONFIG.get("enable_black_white_dithering", False)
        img = floyd_steinberg_dither(img, black_white=black_white)
        dither_type = "black & white" if black_white else "color"
        print(f"🎨 Step 3: Applied {dither_type} Floyd-Steinberg dithering")
    else:
        print("🎨 Step 3: Floyd-Steinberg dithering disabled in config")
    
    return img

def shutter_encrypt(hex_msg, enc_meta):
    """Call the Shutter WebAssembly bundle via CLI bridge (simplest)"""
    # For demo we POST to a helper endpoint Shutter exposes (works for small payloads)
    r = requests.post(f"{SHUTTER_API_BASE}/encrypt_hex", 
        json={
            "data": hex_msg,
            "identity":   enc_meta["identity"],
            "eon_key":    enc_meta["eon_key"]
        },
        headers=get_shutter_headers()
    )
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
        
        # Sanitize text inputs to prevent XSS
        title = sanitize_text_input(title)
        tags = sanitize_text_input(tags)
        story = sanitize_text_input(story)
        
        if not all([title, story]):
            return {"error": "Missing required field (title or story)"}, 400

        # Additional validation after sanitization
        if len(story) > 280:
            return {"error": "Story must be 280 characters or less"}, 400        # Handle image - use default if none provided
        if img:
            # 1) pixelated preview from uploaded image
            pil = Image.open(img.stream)
        else:
            # Use default image
            default_path = os.path.join(app.static_folder, "default.jpg")
            if not os.path.exists(default_path):
                return {"error": "Default image not found"}, 500
            pil = Image.open(default_path)
            
        pixelated = advanced_dither(pil)
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
        reg_resp = requests.post(f"{SHUTTER_API_BASE}/register_identity", 
                                json={
                                    "decryptionTimestamp": reveal_ts,
                                    "identityPrefix": identity_prefix,
                                    "registry": SHUTTER_REGISTRY
                                },
                                headers=get_shutter_headers())
        reg_json = reg_resp.json()
        if "message" not in reg_json:
            print("Unexpected Shutter API response:", reg_json)
            return {"error": "Shutter API did not return expected data"}, 502
        reg = reg_json["message"]

        # 3) Fetch encryption data
        enc_meta_resp = requests.get(
            f"{SHUTTER_API_BASE}/get_data_for_encryption",
            params={"address": SHUTTER_REGISTRY, "identityPrefix": reg["identity_prefix"]},
            headers=get_shutter_headers()
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

@app.route("/api/image-processing-config", methods=["GET"])
def get_image_processing_config():
    """Get current image processing configuration"""
    try:
        return jsonify({
            "config": IMAGE_PROCESSING_CONFIG,
            "source": "config file" if 'IMAGE_PROCESSING_CONFIG' in globals() else "fallback",
            "timestamp": int(time.time())
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---------- DATABASE API ENDPOINTS ----------
@app.route("/api/capsules", methods=["GET"])
def get_capsules():
    """Get capsules from database with pagination and optional tag filtering"""
    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 10))
        revealed_only = request.args.get("revealed_only", "false").lower() == "true"
        tag = request.args.get("tag", "").strip()
        
        # Pass tag filter to database if provided
        tag_filter = tag if tag else None
        capsules = db.get_capsules(offset=offset, limit=limit, revealed_only=revealed_only, tag=tag_filter)
        total_count = db.get_capsule_count()# Format capsules for frontend compatibility
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
        # Get current network config
        network_config = config_data["network"]
        
        return jsonify({
            "success": True,
            "config_source": public_config_path,
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
