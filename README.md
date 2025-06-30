## Ethereum Time Capsule

*Shutter-encrypted commit-and-reveal DApp with Mobile-First Design*

---

## 🚀 Deployment Status

**LIVE ON MAINNET**: https://ethtimecapsule.com

### ✅ Fully Operational Features:
- **Automatic blockchain sync** - runs every seconds, no manual intervention needed
- **Complete DApp functionality** - create, view, and decrypt time capsules
- **Advanced image processing** - pixelated previews with Floyd-Steinberg dithering for authentic retro aesthetics
- **Multiple dithering modes** - black/white, advanced color dithering, and nearest-neighbor scaling
- **IPFS+Pinata integration** - images stored and cached via IPFS with cloud redundancy
- **Enhanced mobile gallery** - search, filter by tags, and browse all capsules with responsive design
- **Smart Twitter sharing** - automatic image-to-clipboard functionality for social media posts
- **Individual capsule links** - direct URLs to specific capsules for easy sharing
- **Interactive test pages** - dedicated dithering test interface for image processing experiments
- **Admin interface** - separate admin.html for capsule management and decryption operations
- **Clean production deployment** - no AWS/S3 dependencies, fully Heroku-optimized

---

### Table of Contents

1. [Overview](#overview)
2. [High-level Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Smart-contract Deployment](#smart-contract-deployment)
7. [Backend (Flask API)](#backend)
8. [Frontend (Mobile DApp)](#frontend)
9. [Environment & Config Files](#config)
10. [Typical Workflow](#workflow)
11. [User Interface Features](#ui-features)
12. [Testing with Short Reveal Windows](#test-mode)
13. [Production Checklist](#production)
14. [Troubleshooting](#troubleshooting)
15. [Security & Privacy Notes](#security)
16. [License](#license)

---

<a name="overview"></a>

### 1. Overview

Ethereum Time Capsule is a mobile-first DApp that lets anyone lock an image and story on-chain for exactly one year, creating a digital time capsule for Ethereum's 10th anniversary celebration.

* **Public fields:** title & tags (immediately visible).
* **Private fields:** story text + image; both threshold-encrypted via **Shutter Network**.
* **Storage:**
  * Encrypted story → on-chain (bytes) in the `TimeCapsule` contract.
  * Encrypted image → IPFS with local storage and Pinata cloud pinning.
  * Pixelated preview → IPFS with local storage and Pinata cloud pinning (using Floyd-Steinberg dithering for authentic retro aesthetics).
* **Reveal:** When Shutter's keyper network publishes the decryption key (July 30, 2025), anyone can reveal capsules; the story becomes permanent public data on the contract.
* **User Experience:** Modern mobile-first interface with 4-step submission flow, comprehensive gallery with search/filter, intelligent Twitter sharing with automatic image copying to clipboard.
* **Admin Tools:** Separate admin interface (`admin.html`) for capsule management, bulk operations, and decryption testing.
* **Test Interface:** Dedicated test page (`test_config.html`) for experimenting with dithering algorithms and image processing parameters.

The result is a censorship-resistant, provably time-locked "digital bottle in the blockchain sea" with beautiful, intuitive design.

---

<a name="architecture"></a>

### 2. High-level Architecture

```
┌─────────────────┐   Step 1-4 Flow    ┌─────────────────────┐
│  Mobile DApp    │ ─────────────────▶│   Flask Backend     │
│  (Figma Design) │ (multipart + JSON) │  + SQLite Database  │
└─────────────────┘                    └─────────────────────┘
        │                                       │
        │ MetaMask/WalletConnect                │ • Pillow pixelation
        │ ethers.js transactions                │ • Shutter encryption  
        ▼                                       │ • IPFS + Pinata storage
┌─────────────────────┐       events           │ • Database persistence
│  TimeCapsule.sol    │◀────────────────┐      │
│   (Gnosis Chain)    │                 │      ▼
└─────────────────────┘                 │ ┌────────────────┐
        ▲                               └─│ IPFS + Pinata  │
        │   revealCapsule()               └────────────────┘
        │   (July 30, 2025)                      │
        ▼                                       │
┌─────────────────┐                            │
│ Public Gallery  │◀───────────────────────────┘
│  (Searchable)   │
└─────────────────┘
```

---

<a name="tech-stack"></a>

### 3. Tech Stack

| Layer                    | Technology                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Smart Contract**       | Solidity ^0.8.0 • Gnosis Chain (Mainnet ID 100)                                                                  |
| **Threshold Encryption** | Shutter Network BLST implementation • Custom WASM integration                                                     |
| **Backend**              | Python 3.11+ • Flask 2.x • SQLite Database • Pillow • requests • Pinata integration                            |
| **Storage**              | IPFS (local daemon) + Pinata cloud pinning • Local file system caching                                          |
| **Frontend**             | **Mobile-First Design** • Vanilla HTML/CSS/JS • Figma-inspired UI<br>Ethers.js 5 • BLST WASM • WalletConnect    |
| **Design System**        | Inter & Space Grotesk fonts • Consistent CSS variables • 400px mobile container                                   |
| **Development**          | Static file server • Live reload capabilities                                                                      |

---

<a name="project-structure"></a>

### 4. Project Structure

```
EthereumTimeCapsule/
├─ backend/
│  ├─ app.py                    # Main Flask application
│  ├─ database.py               # SQLite database operations
│  ├─ blockchain_sync.py        # Blockchain event synchronization
│  ├─ config.py                 # Configuration management
│  ├─ capsules.db              # SQLite database file
│  ├─ ipfs_storage/            # Local IPFS file cache
│  └─ pixelated/               # Pixelated image previews (local cache)
│
├─ frontend/
│  ├─ index.html               # Homepage with content sections
│  ├─ create.html              # 4-step submission flow
│  ├─ gallery.html             # Mobile gallery with search/filter
│  ├─ admin.html               # Admin interface for capsule management
│  ├─ test_config.html         # Image dithering test interface
│  ├─ faq.html                 # Frequently asked questions
│  ├─ imprint.html             # Legal information
│  ├─ app.js                   # Main application logic
│  ├─ gallery.js               # Gallery-specific functionality
│  ├─ admin.js                 # Admin interface functionality
│  ├─ main.js                  # Shutter WASM integration
│  ├─ encryptDataBlst.js       # Encryption utilities
│  ├─ blst.js + blst.wasm      # Shutter BLST implementation
│  ├─ public_config.json       # Network and feature configuration
│  ├─ contract_abi.json        # Smart contract ABI
│  └─ styles.css               # Legacy styles (unused)
│
├─ contracts/
│  └─ TimeCapsule.sol          # Main smart contract
│
├─ Procfile                    # Heroku deployment configuration
├─ heroku_app.py              # Heroku entry point
├─ runtime.txt                # Python version for Heroku
├─ requirements.txt           # Python dependencies
├─ README.md                  # This file
└─ PINATA_INTEGRATION_SUMMARY.md # Pinata setup guide
```

---

<a name="prerequisites"></a>

### 5. Prerequisites

| Tool                                           | Minimum Version | Notes                                    |
| ---------------------------------------------- | --------------- | ---------------------------------------- |
| **Node.js**                                    | 18.x            | For Hardhat & frontend development      |
| **Python**                                     | 3.11            | Backend with modern async support       |
| **pip**                                        | 23+             | Modern dependency resolution             |
| **MetaMask / WalletConnect-compatible wallet** | Latest          | On Gnosis Chain network                  |

---

<a name="smart-contract-deployment"></a>

### 6. Smart-contract Deployment

1. **Setup Hardhat environment:**
   ```powershell
   cd contracts
   npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers
   ```

2. **Configure Gnosis Chain network in `hardhat.config.js`:**
   ```js
   networks: {
     gnosis: {
       url: "https://rpc.gnosischain.com",
       accounts: [process.env.DEPLOYER_PRIVATE_KEY],
       chainId: 100
     }
   }
   ```

3. **Deploy to Gnosis Chain:**
   ```powershell
   npx hardhat compile
   npx hardhat run scripts/deploy.js --network gnosis
   ```

4. **Update configuration:**
   Copy the deployed contract address into `frontend/public_config.json → contract_address`.

---

<a name="backend"></a>

### 7. Backend (Flask API)

**Setup and Run:**
```powershell
# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run Flask backend
python backend/app.py
```

**Key Features:**
- **SQLite Database:** Persistent storage for capsule metadata
- **IPFS Integration:** Local storage + Pinata cloud pinning for both encrypted and pixelated images
- **Image Processing:** Automatic pixelation for previews
- **Shutter Encryption:** Server-side encryption before storage
- **Blockchain Sync:** Automatic event synchronization

**Main Endpoints:**

| Route                | Method | Purpose                                                               |
| -------------------- | ------ | --------------------------------------------------------------------- |
| `/submit_capsule`    | POST   | Complete capsule submission with encryption & storage                 |
| `/api/capsules`      | GET    | Retrieve capsules with pagination and filtering                       |
| `/ipfs/<cid>`        | GET    | Serve IPFS content with Pinata fallback                              |
| `/pixelated/<cid>`   | GET    | Serve pixelated image previews from IPFS or local cache             |
| `/system_info`       | GET    | System configuration and capabilities                                 |

---

<a name="frontend"></a>

### 8. Frontend (Mobile DApp)

**Serve the application:**
```powershell
cd frontend
python -m http.server 8080
```

**Open:** [http://localhost:8080](http://localhost:8080)

**Three Main Pages:**

1. **Homepage (`index.html`):**
   - Hero section with live capsule previews
   - Information sections about the project
   - Call-to-action to create entries

2. **Creation Flow (`create.html`):**
   - **Step 1:** Fill story details (title, tags, story, image)
   - **Step 2:** Preview with background encryption
   - **Step 3:** Blockchain submission via wallet
   - **Step 4:** Completion with sharing options

3. **Gallery (`gallery.html`):**
   - Browse all submitted capsules with responsive card layout
   - Search and filter functionality by tags, creator, or content
   - Click any capsule to view individual capsule page
   - Decrypt previews and reveal capsules (admin functions moved to separate page)

4. **Admin Interface (`admin.html`):**
   - Secure admin-only functions separated from public gallery
   - Capsule decryption and reveal capabilities
   - Bulk operations and management tools
   - Enhanced Shutter WASM integration for decryption testing

5. **Test Interface (`test_config.html`):**
   - Interactive dithering algorithm testing
   - Real-time image processing parameter adjustment
   - Side-by-side comparison of different dithering methods
   - Export capabilities for processed images

---

<a name="config"></a>

### 9. Environment & Config Files

**Frontend Configuration (`frontend/public_config.json`):**
```json
{
  "testnet": {
    "contract_address": "0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF",
    "registry_address": "0x2693a4Fb363AdD4356e6b80Ac5A27fF05FeA6D9F",
    "shutter_api_base": "https://shutter-api.chiado.staging.shutter.network/api",
    "rpc_url": "https://rpc.gnosis.gateway.fm"
  },
  "mainnet": {
    "contract_address": "0xdb2F5E3DfD295df167AEfed2336D92364A7a7eCF",
    "registry_address": "0x694e5de9345d39C148DA90e6939A3fd2142267D9",
    "shutter_api_base": "https://shutter-api.shutter.network/api",
    "rpc_url": "https://rpc.gnosis.gateway.fm"
  },
  "default_network": "testnet",
  "homepage_carousel_capsules": [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "available_tags": [
    "memories", "dreams", "goals", "love", "family", "travel",
    "art", "music", "thoughts", "wishes", "secrets", "future",
    "present", "past", "hope", "gratitude"
  ],
  "image_processing": {
    "target_vertical_resolution": 100,
    "smoothing_factor": 19,
    "enable_floyd_steinberg_dithering": true,
    "enable_black_white_dithering": true,
    "enable_advanced_dithering": true,
    "max_processing_dimension": 800,
    "disable_dithering_on_large_images": true
  }
}
```

**Configuration Options:**

| Section | Key | Description |
| ------- | --- | ----------- |
| **Network** | `default_network` | Choose "testnet" or "mainnet" |
| | `contract_address` | Smart contract deployment address |
| | `registry_address` | Shutter registry contract address |
| | `shutter_api_base` | Shutter Network API endpoint |
| | `rpc_url` | Gnosis Chain RPC endpoint |
| **UI** | `homepage_carousel_capsules` | Array of capsule IDs to show on homepage |
| | `available_tags` | Predefined tags for capsule categorization |
| **Image Processing** | `target_vertical_resolution` | Target height for pixelated images |
| | `smoothing_factor` | Blur factor before dithering (higher = smoother) |
| | `enable_floyd_steinberg_dithering` | Enable Floyd-Steinberg error diffusion |
| | `enable_black_white_dithering` | Enable black/white only dithering mode |
| | `enable_advanced_dithering` | Enable color dithering algorithms |
| | `max_processing_dimension` | Maximum image dimension before processing |
| | `disable_dithering_on_large_images` | Skip dithering for very large images |

**Backend Configuration (optional `.env`):**
```bash
# Pinata configuration for cloud IPFS pinning
PINATA_JWT=your_pinata_jwt_token_here
PINATA_API_KEY=your_pinata_api_key_here
PINATA_SECRET_API_KEY=your_pinata_secret_api_key_here
PINATA_GATEWAY=https://gateway.pinata.cloud

# Flask configuration
FLASK_ENV=development
FLASK_DEBUG=true
```

---

<a name="workflow"></a>

### 10. Typical Workflow

| Phase | Step | What Happens |
| ----- | ---- | ------------ |
| **Submission** | User fills form | Title, tags, story text, and image upload |
| | Background processing | Server pixelates image, stores to IPFS, registers Shutter identity |
| | Encryption | Story and image encrypted with Shutter threshold encryption |
| | Storage | Encrypted data stored on IPFS with Pinata pinning, metadata in database |
| | Blockchain | User signs transaction to commit capsule hash on-chain |
| **Gallery** | Browse | Users can view pixelated previews and metadata |
| | Search | Filter by tags, creator, or reveal status |
| | Decrypt Preview | Temporary decryption for preview (if key available) |
| **Reveal** | Auto-reveal | System automatically reveals capsules after July 30, 2025 |
| | Manual reveal | Users can manually trigger reveal if decryption key is available |
| | Permanent | Revealed stories become permanently visible on-chain |

---

<a name="ui-features"></a>

### 11. User Interface Features

**Design System:**
- **Mobile-First:** 400px container optimized for smartphones
- **Typography:** Inter (UI) + Space Grotesk (headings)
- **Color Palette:** Consistent CSS variables throughout
- **Responsive:** Scales beautifully from mobile to desktop

**Interactive Elements:**
- **4-Step Progress Indicator:** Clear visual progress through submission
- **Background Encryption:** Non-blocking encryption during preview
- **Wallet Integration:** Click-to-connect with status indicators
- **Full-Screen Menu:** Unified navigation across all pages
- **Live Loading States:** Spinners and progress bars for all async operations
- **Dithering Preview:** Real-time image processing with multiple algorithm options
- **Tag Filtering:** Interactive tag-based search in gallery
- **Clickable Cards:** Full capsule card click targets for navigation

**User Experience:**
- **Immediate Feedback:** Real-time validation and status updates
- **Pixelated Previews:** Floyd-Steinberg dithered images with authentic retro aesthetics
- **Search & Filter:** Find capsules by tags, creator, title, or reveal status
- **Social Sharing:** Twitter integration with automatic image copying to clipboard
- **Individual Links:** Direct URLs to specific capsules for easy sharing
- **Admin Separation:** Public gallery separated from admin functions for security

---

<a name="image-processing"></a>

### 12. Advanced Image Processing & Dithering

**Image Processing Pipeline:**
1. **Upload Processing:** Images are resized and optimized during upload
2. **Blur Application:** Configurable smoothing factor applied before dithering
3. **Dithering Algorithm:** Floyd-Steinberg error diffusion for retro aesthetics
4. **Format Output:** Processed images saved as pixelated previews
5. **IPFS Storage:** Both original encrypted and pixelated versions stored

**Dithering Modes Available:**

| Mode | Description | Use Case |
| ---- | ----------- | -------- |
| **Floyd-Steinberg** | Error diffusion algorithm for smooth gradients | Best for photographs and complex images |
| **Black & White** | High contrast monochrome dithering | Artistic effect, minimal file sizes |
| **Advanced Color** | Multi-color dithering with palette reduction | Retro game aesthetic, controlled color palettes |
| **Nearest-Neighbor** | Pixel-perfect scaling without interpolation | Preserving sharp edges and pixel art |

**Configuration Parameters:**
- `target_vertical_resolution`: Target height in pixels (default: 100px)
- `smoothing_factor`: Blur intensity before dithering (default: 19)
- `max_processing_dimension`: Maximum image size to process (default: 800px)
- `disable_dithering_on_large_images`: Skip processing for very large images

**Test Interface Features:**
- Real-time parameter adjustment with live preview
- Side-by-side comparison of different algorithms
- Export functionality for testing different settings
- Performance metrics and processing time display

**Twitter Image Sharing:**
- Automatic copying of processed images to clipboard
- Enhanced "Share to X" button with user instructions
- Perfect integration with social media workflow
- Maintains image quality during clipboard operations

---

<a name="test-mode"></a>

### 13. Testing with Short Reveal Windows

For development and testing, you can create capsules with short reveal times:

1. **Modify reveal time** in `backend/app.py`:
   ```python
   # Change from 1 year to 5 minutes for testing
   reveal_timestamp = int(time.time()) + 300  # 5 minutes
   ```

2. **Test the full lifecycle** within minutes instead of waiting a year

3. **Verify decryption** works properly once the time passes

**Important:** Reset to production timing (1 year) before deployment!

---

<a name="production"></a>

### 13. Production Checklist

**Infrastructure:**
- [ ] Deploy to Heroku using included `Procfile`, `heroku_app.py`, and `runtime.txt`
- [ ] Set up Pinata account for persistent IPFS pinning
- [ ] Configure SSL/HTTPS for all endpoints
- [ ] Set up domain name and DNS

**Heroku Deployment:**
- [ ] Install Heroku CLI and login: `heroku login`
- [ ] Create new app: `heroku create your-app-name`
- [ ] Set environment variables: `heroku config:set PINATA_JWT=your_jwt_token`
- [ ] Deploy: `git push heroku main`
- [ ] Check logs: `heroku logs --tail`

**Security:**
- [ ] Rate limiting on `/submit_capsule` endpoint
- [ ] Image size limits (recommended: 10MB max)
- [ ] CORS configuration for cross-origin requests
- [ ] Environment variable protection for sensitive keys

**Monitoring:**
- [ ] Set up automated capsule revelation system for July 30, 2025
- [ ] Monitor Pinata pinning status and IPFS availability
- [ ] Track gas costs and blockchain transaction success rates
- [ ] Set up error logging and monitoring

**Performance:**
- [ ] CDN for static assets
- [ ] Database indexing for search queries
- [ ] Image compression and optimization
- [ ] Pinata gateway redundancy for IPFS access

---

<a name="troubleshooting"></a>

### 14. Troubleshooting

| Issue | Solution |
| ----- | -------- |
| **IPFS connection failed** | Ensure Pinata is configured properly or check local IPFS storage |
| **Wallet won't connect** | Check network is set to Gnosis Chain (ID 100) |
| **Image upload fails** | Verify file size under 10MB and valid image format |
| **Encryption errors** | Ensure Shutter WASM is loaded properly |
| **Database locked** | Check file permissions and close other connections |
| **Pixelated images not showing** | Verify PIL/Pillow installation and IPFS/Pinata connectivity |
| **Dithering not working** | Check `image_processing` config in `public_config.json` |
| **Gallery cards not clickable** | Verify JavaScript is enabled and gallery.js is loaded |
| **Twitter sharing fails** | Check clipboard permissions and browser compatibility |
| **Admin page access denied** | Ensure you're accessing `/admin.html` directly |
| **Transaction fails** | Check wallet has sufficient xDAI for gas fees |
| **Gallery search not working** | Verify backend API is running and search endpoints accessible |
| **Test page not loading** | Check that `test_config.html` exists and is properly served |

**Debug Mode:**
- Check browser console for JavaScript errors
- Monitor Flask logs for backend issues
- Use browser dev tools to inspect network requests
- Test Pinata connectivity: check `/system_info` endpoint for Pinata status

---

<a name="security"></a>

### 15. Security & Privacy Notes

**Data Privacy:**
- **Temporary Plaintext:** Backend temporarily sees plaintext before encryption
- **IPFS Visibility:** Encrypted data is publicly accessible on IPFS network via Pinata
- **Blockchain Permanence:** Once revealed, stories are permanently on-chain
- **Image Metadata:** EXIF data is preserved through encryption

**Security Considerations:**
- **File Size Limits:** Prevent DoS attacks through large uploads
- **Rate Limiting:** Protect against spam submissions
- **Input Validation:** Sanitize all user inputs
- **Key Management:** Shutter handles threshold encryption keys

**User Guidelines:**
- Advise users not to include sensitive personal information
- Explain that revealed content is permanent and public
- Recommend appropriate content for time capsule context
- Clarify that current reveal date is July 30, 2025

---

<a name="license"></a>

### 16. License

**MIT License** - This project is open source and available under the MIT License.

- **Smart Contract:** TimeCapsule.sol (MIT)
- **Backend:** Flask application and utilities (MIT)  
- **Frontend:** Mobile DApp and UI components (MIT)
- **Shutter Integration:** Uses Shutter Network's open-source libraries

**Third-Party:**
- Shutter Network BLST library (Permissive license)
- IPFS and related tools (MIT/Apache)
- Flask and Python libraries (Various open source)

---

### 🎈 Enjoy your voyage through time!

**Contributing:** PRs and issues welcome! Help us build the future of digital time capsules.

**Community:** Join the conversation about preserving digital memories for the future.

**Ethereum 10th Anniversary:** This project celebrates a decade of decentralized innovation.

---

*Built with ❤️ for the Ethereum community • Shutter Network integration • Mobile-first design*
