# Private configuration file for API keys and sensitive data
# Add this file to .gitignore to keep keys secure

# Pinata IPFS Configuration (V3 API)
# To enable Pinata integration:
# 1. Sign up at https://pinata.cloud
# 2. Go to API Keys section and create a new key
# 3. For V3 API, you need a JWT token instead of API key/secret
# 4. Replace PINATA_JWT with your actual JWT token
# 5. Restart the backend server

# V3 API uses JWT authentication
PINATA_JWT = ""  # Replace with your JWT token

# Legacy V2 API keys (kept for backwards compatibility)
PINATA_API_KEY = ""
PINATA_SECRET_API_KEY = ""

# Optional: Custom Pinata gateway (leave empty to use default)
# If you have a dedicated gateway, enter it here
PINATA_GATEWAY = ""  # e.g., "https://your-gateway.mypinata.cloud"

# Note: If you don't want to use Pinata, just leave the keys as they are.
# The system will automatically detect this and use local storage only.
