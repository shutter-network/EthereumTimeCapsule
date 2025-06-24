## Ethereum Time Capsule

*Shutter-encrypted commit-and-reveal DApp with Mobile-First Design*

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
  * Encrypted image → IPFS with local storage and optional Pinata pinning.
  * Pixelated preview generated server-side for immediate viewing.
* **Reveal:** When Shutter's keyper network publishes the decryption key (July 30, 2025), anyone can reveal capsules; the story becomes permanent public data on the contract.
* **User Experience:** Modern mobile-first interface with 4-step submission flow and comprehensive gallery.

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
| **Backend**              | Python 3.11+ • Flask 2.x • SQLite Database • Pillow • ipfshttpclient • Pinata SDK                               |
| **Storage**              | Local IPFS daemon + Pinata cloud pinning • Local file system caching                                             |
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
│  └─ pixelated/               # Pixelated image previews
│
├─ frontend/
│  ├─ index.html               # Homepage with content sections
│  ├─ create.html              # 4-step submission flow
│  ├─ gallery.html             # Mobile gallery with search/filter
│  ├─ app.js                   # Main application logic
│  ├─ gallery.js               # Gallery-specific functionality
│  ├─ main.js                  # Shutter WASM integration
│  ├─ encryptDataBlst.js       # Encryption utilities
│  ├─ blst.js + blst.wasm      # Shutter BLST implementation
│  ├─ public_config.json       # Network configuration
│  ├─ contract_abi.json        # Smart contract ABI
│  └─ styles.css               # Legacy styles (unused)
│
├─ contracts/
│  └─ TimeCapsule.sol          # Main smart contract
│
├─ scripts/
│  └─ deploy.js                # Hardhat deployment script
│
├─ tests/
│  ├─ test_ipfs.py             # IPFS functionality tests
│  ├─ test_pinata_public.py    # Pinata integration tests
│  └─ test_frontend_integration.py # End-to-end tests
│
├─ requirements.txt            # Python dependencies
├─ README.md                   # This file
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
| **IPFS daemon**                                | 0.21+           | Local storage: `ipfs daemon --init`     |
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

# Start IPFS daemon (separate terminal)
ipfs daemon --init

# Run Flask backend
python backend/app.py
```

**Key Features:**
- **SQLite Database:** Persistent storage for capsule metadata
- **IPFS Integration:** Local daemon + optional Pinata cloud pinning
- **Image Processing:** Automatic pixelation for previews
- **Shutter Encryption:** Server-side encryption before storage
- **Blockchain Sync:** Automatic event synchronization

**Main Endpoints:**

| Route                | Method | Purpose                                                               |
| -------------------- | ------ | --------------------------------------------------------------------- |
| `/submit_capsule`    | POST   | Complete capsule submission with encryption & storage                 |
| `/api/capsules`      | GET    | Retrieve capsules with pagination and filtering                       |
| `/ipfs/<cid>`        | GET    | Serve IPFS content with fallback handling                            |
| `/pixelated/<cid>`   | GET    | Serve pixelated image previews                                        |
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
   - Browse all submitted capsules
   - Search and filter functionality
   - Decrypt previews and reveal capsules

---

<a name="config"></a>

### 9. Environment & Config Files

**Frontend Configuration (`frontend/public_config.json`):**
```json
{
  "default_network": "gnosis",
  "gnosis": {
    "contract_address": "0x...",
    "rpc_url": "https://rpc.gnosischain.com",
    "chain_id": 100
  },
  "testnet": {
    "shutter_api_base": "https://api.shutter.network",
    "registry_address": "0x...",
    "reveal_delay_seconds": 31536000
  }
}
```

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
| | Background processing | Server pixelates image, registers Shutter identity |
| | Encryption | Story and image encrypted with Shutter threshold encryption |
| | Storage | Encrypted data stored on IPFS, metadata in database |
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

**User Experience:**
- **Immediate Feedback:** Real-time validation and status updates
- **Pixelated Previews:** See content before reveal without spoiling
- **Search & Filter:** Find capsules by various criteria
- **Social Sharing:** Built-in Twitter integration and gallery links

---

<a name="test-mode"></a>

### 12. Testing with Short Reveal Windows

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
- [ ] Deploy backend to cloud service (AWS, DigitalOcean, etc.)
- [ ] Set up persistent IPFS node or use dedicated pinning service
- [ ] Configure SSL/HTTPS for all endpoints
- [ ] Set up domain name and DNS

**Security:**
- [ ] Rate limiting on `/submit_capsule` endpoint
- [ ] Image size limits (recommended: 10MB max)
- [ ] CORS configuration for cross-origin requests
- [ ] Environment variable protection for sensitive keys

**Monitoring:**
- [ ] Set up automated capsule revelation system for July 30, 2025
- [ ] Monitor IPFS pinning status and storage costs
- [ ] Track gas costs and blockchain transaction success rates
- [ ] Set up error logging and monitoring

**Performance:**
- [ ] CDN for static assets
- [ ] Database indexing for search queries
- [ ] Image compression and optimization
- [ ] IPFS gateway redundancy

---

<a name="troubleshooting"></a>

### 14. Troubleshooting

| Issue | Solution |
| ----- | -------- |
| **IPFS connection failed** | Ensure `ipfs daemon` is running on port 5001 |
| **Wallet won't connect** | Check network is set to Gnosis Chain (ID 100) |
| **Image upload fails** | Verify file size under 10MB and valid image format |
| **Encryption errors** | Ensure Shutter WASM is loaded properly |
| **Database locked** | Check file permissions and close other connections |
| **Pixelated images not showing** | Verify PIL/Pillow installation and image processing |
| **Transaction fails** | Check wallet has sufficient xDAI for gas fees |
| **Gallery not loading** | Verify backend API is running and accessible |

**Debug Mode:**
- Check browser console for JavaScript errors
- Monitor Flask logs for backend issues
- Use browser dev tools to inspect network requests
- Test IPFS connectivity: `ipfs id` in terminal

---

<a name="security"></a>

### 15. Security & Privacy Notes

**Data Privacy:**
- **Temporary Plaintext:** Backend temporarily sees plaintext before encryption
- **IPFS Visibility:** Encrypted data is publicly accessible on IPFS network
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
