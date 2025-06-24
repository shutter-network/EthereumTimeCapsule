/*  gallery.js — Gallery Page Logic  */
/*  Handles loading and displaying capsules from the database API  */

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let walletConnected = false;

// Gallery state
let currentOffset = 0;
let currentFilter = 'all'; // 'all', 'revealed', 'locked'
let currentSearch = '';
const batchSize = 12;
let isLoading = false;
let hasMore = true;

// =============  HELPER FUNCTIONS  =============
// Helper: get API base URL (production vs development)
function getApiBaseUrl() {
  return window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
}

// Helper: get all possible IPFS URLs for a CID
function getIPFSUrls(cid) {
  const urls = [];
  
  // Try stored URLs first (from upload response)
  if (window.ipfsUrls && window.ipfsUrls[cid]) {
    urls.push(...window.ipfsUrls[cid]);
  }
  
  // Add Pinata gateway if enabled
  if (window.systemInfo?.pinata_enabled && window.systemInfo?.pinata_gateway) {
    const pinataUrl = `${window.systemInfo.pinata_gateway}/ipfs/${cid}`;
    if (!urls.includes(pinataUrl)) {
      urls.push(pinataUrl);
    }
  }
    // Add local server as fallback
  const localUrl = `${getApiBaseUrl()}/ipfs/${cid}`;
  if (!urls.includes(localUrl)) {
    urls.push(localUrl);
  }  
  return urls;
}

// Helper: handle image loading errors with fallback
function handleImageError(imgElement, imageCID, capsuleId) {
  console.error(`Failed to load image for capsule #${capsuleId}:`, imgElement.src);
  
  // If we're currently trying the IPFS endpoint, fallback to pixelated endpoint
  if (imgElement.src.includes('/ipfs/')) {
    console.log(`Falling back to pixelated endpoint for capsule #${capsuleId}`);
    const timestamp = Date.now();
    imgElement.src = `${getApiBaseUrl()}/pixelated/${imageCID}?t=${timestamp}`;
    imgElement.onerror = function() {
      console.error(`Pixelated fallback also failed for capsule #${capsuleId}:`, this.src);
      this.style.display = 'none';
    };
  } else {
    // Both endpoints failed, hide the image
    console.error(`All image sources failed for capsule #${capsuleId}`);
    imgElement.style.display = 'none';
  }
}

// Helper: fetch from redundant URLs with fallbacks
async function fetchWithFallback(urls, options = {}) {
  if (!urls || urls.length === 0) {
    throw new Error("No URLs provided for fallback fetch");
  }
  
  const errors = [];
  
  for (let i = 0; i < urls.length; i++) {
    try {
      console.log(`Attempting to fetch from URL ${i + 1}/${urls.length}: ${urls[i]}`);
      const response = await axios.get(urls[i], {
        timeout: i === 0 ? 5000 : 10000, // First URL gets shorter timeout
        ...options
      });
      console.log(`Successfully fetched from: ${urls[i]}`);
      return response;
    } catch (error) {
      const errorMsg = error.response ? `${error.response.status} ${error.response.statusText}` : error.message;
      console.warn(`Failed to fetch from ${urls[i]}: ${errorMsg}`);
      errors.push(`URL ${i + 1}: ${errorMsg}`);
      
      if (i === urls.length - 1) {
        throw new Error(`All ${urls.length} URLs failed:\n${errors.join('\n')}`);
      }
      // Continue to next URL
    }
  }
}

// =============  INITIALIZATION  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {    // Initialize global storage
    window.ipfsUrls = {};
      // Load system information
    try {
      const systemInfo = await axios.get(`${getApiBaseUrl()}/system_info`);
      window.systemInfo = systemInfo.data;
      console.log("System info loaded:", window.systemInfo);
    } catch (e) {
      console.warn("Could not load system info:", e);
      window.systemInfo = { pinata_enabled: false };
    }
    
    // Load configs & ABI
    const cacheBuster = `?v=${Date.now()}`;
    const cfgAll = await (await fetch(`public_config.json${cacheBuster}`)).json();
    
    const fixedNetwork = cfgAll.default_network;
    const fixedCfg = cfgAll[fixedNetwork];
    const shutterCfg = cfgAll["testnet"]; // or "mainnet"
    
    contractAddr = fixedCfg.contract_address;
    contractAbi = await (await fetch(`contract_abi.json${cacheBuster}`)).json();
    shutterApi = shutterCfg.shutter_api_base;
    registryAddr = shutterCfg.registry_address;    
    // read-only provider
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );
      // Gallery is read-only by default, wallet connects on-demand for reveal actions
    console.log("Gallery initialized in read-only mode (wallet connects on-demand)");
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize Shutter WASM
    console.log("Initializing Shutter WASM...");
    try {
      await ensureShutterReady();
      console.log("✅ Shutter WASM ready");
    } catch (e) {
      console.warn("⚠️ Shutter WASM not ready yet, will retry when needed:", e.message);
    }
    
    // Load initial capsules
    loadCapsules();
    
  } catch (e) {
    console.error("Initialization failed:", e);
    document.getElementById('load-status').textContent = 'Failed to initialize gallery';
  }
});

// =============  WALLET CONNECTION  =============
async function connectWallet(manual = false) {
  try {
    console.log('🔄 Connecting wallet for blockchain interaction...');
    
    let eth = window.ethereum;
    if (!eth) {
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc: { 100: "https://rpc.gnosischain.com" },
        chainId: 100
      });
      await wc.enable();
      eth = wc;
    } else {
      // Request account access (this will prompt the user)
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from wallet');
      }
    }
      provider = new ethers.providers.Web3Provider(eth);
    signer = provider.getSigner();
    
    const net = await provider.getNetwork();
    if (net.chainId !== 100) {
      // Try to switch to Gnosis Chain
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x64' }], // 100 in hex
        });
        
        // IMPORTANT: Recreate provider after network switch
        provider = new ethers.providers.Web3Provider(eth);
        signer = provider.getSigner();
        
        // Verify the switch worked
        const newNet = await provider.getNetwork();
        if (newNet.chainId !== 100) {
          throw new Error(`Network switch failed. Expected chain ID 100, got ${newNet.chainId}`);
        }
        
      } catch (switchError) {
        if (switchError.code === 4902) {
          // Chain not added, try to add it
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x64',
              chainName: 'Gnosis',
              nativeCurrency: {
                name: 'xDAI',
                symbol: 'XDAI',
                decimals: 18,
              },
              rpcUrls: ['https://rpc.gnosischain.com/'],
              blockExplorerUrls: ['https://gnosisscan.io/'],
            }],
          });
          
          // Recreate provider after adding network
          provider = new ethers.providers.Web3Provider(eth);
          signer = provider.getSigner();
          
        } else {
          throw new Error("Please switch to Gnosis Chain (network ID 100) in your wallet");
        }
      }
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    console.log("💰 Wallet contract initialized with address:", contractAddr);
    
    walletConnected = true;
    console.log('✅ Wallet connected successfully');
    
    return true;
  } catch (e) {
    console.error("❌ Wallet connection failed:", e);
    walletConnected = false;
    return false;
  }
}

// =============  EVENT LISTENERS  =============
function setupEventListeners() {
  // Filter buttons
  document.getElementById('filter-all').onclick = () => setFilter('all');
  document.getElementById('filter-revealed').onclick = () => setFilter('revealed');
  document.getElementById('filter-locked').onclick = () => setFilter('locked');
  
  // Search
  document.getElementById('search-btn').onclick = performSearch;
  document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  // Load more
  document.getElementById('load-more-btn').onclick = loadMoreCapsules;
}

// =============  FILTER AND SEARCH  =============
function setFilter(filter) {
  currentFilter = filter;
  currentOffset = 0;
  hasMore = true;
  
  // Update button states
  document.querySelectorAll('.filter-controls button').forEach(btn => {
    btn.classList.remove('active');
  });
  
  document.getElementById(`filter-${filter}`).classList.add('active');
  
  // Clear grid and reload
  document.getElementById('capsules-grid').innerHTML = '';
  loadCapsules();
}

function performSearch() {
  const searchInput = document.getElementById('search-input');
  currentSearch = searchInput.value.trim();
  currentOffset = 0;
  hasMore = true;
  
  // Clear grid and reload
  document.getElementById('capsules-grid').innerHTML = '';
  loadCapsules();
}

// =============  LOAD CAPSULES  =============
async function loadCapsules() {
  if (isLoading || !hasMore) return;
  
  isLoading = true;
  const loadingIndicator = document.getElementById('loading-indicator');
  const loadStatus = document.getElementById('load-status');
  
  try {
    loadingIndicator.style.display = 'block';
    loadStatus.textContent = 'Loading capsules from database...';
    
    let url, params;
      if (currentSearch) {
      // Search mode
      url = `${getApiBaseUrl()}/api/capsules/search`;
      params = {
        q: currentSearch,
        limit: batchSize
      };
    } else {
      // Normal load mode
      url = `${getApiBaseUrl()}/api/capsules`;
      params = {
        offset: currentOffset,
        limit: batchSize,
        revealed_only: currentFilter === 'revealed'
      };
    }
    
    console.log(`📦 Loading capsules: ${JSON.stringify(params)}`);
    const response = await axios.get(url, { params });
    
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to load capsules");
    }
    
    const capsules = response.data.capsules;
    const totalCount = response.data.total_count || capsules.length;
    
    console.log(`✅ Loaded ${capsules.length} capsules`);
    
    // Filter capsules based on current filter (for search results)
    let filteredCapsules = capsules;
    if (currentSearch && currentFilter !== 'all') {
      filteredCapsules = capsules.filter(capsule => {
        if (currentFilter === 'revealed') return capsule.isRevealed;
        if (currentFilter === 'locked') return !capsule.isRevealed;
        return true;
      });
    }
    
    // Render capsules
    renderCapsules(filteredCapsules);
    
    // Update pagination
    if (!currentSearch) {
      currentOffset += batchSize;
      hasMore = currentOffset < totalCount;
    } else {
      hasMore = false; // Search shows all results at once
    }
    
    // Update load status
    const grid = document.getElementById('capsules-grid');
    const totalDisplayed = grid.children.length;
    loadStatus.textContent = `Showing ${totalDisplayed} of ${totalCount} capsules`;
    
    // Update load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (hasMore) {
      loadMoreBtn.textContent = 'Load More Capsules';
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn.textContent = 'No More Capsules';
      loadMoreBtn.disabled = true;
    }
    
  } catch (error) {
    console.error('Failed to load capsules:', error);
    loadStatus.textContent = 'Failed to load capsules: ' + error.message;
  } finally {
    isLoading = false;
    loadingIndicator.style.display = 'none';
  }
}

function loadMoreCapsules() {
  loadCapsules();
}

// =============  RENDER CAPSULES  =============
function renderCapsules(capsules) {
  const grid = document.getElementById('capsules-grid');
  
  capsules.forEach(capsule => {
    const capsuleCard = createCapsuleCard(capsule);
    grid.appendChild(capsuleCard);
  });
}

function createCapsuleCard(capsule) {
  const card = document.createElement('div');
  card.className = 'capsule-card-gallery';
  card.setAttribute('data-capsule-id', capsule.id); // Add unique identifier
    const isRevealed = capsule.isRevealed;
  const revealTime = new Date(capsule.revealTime * 1000);
  const creator = `${capsule.creator.slice(0, 6)}...${capsule.creator.slice(-4)}`;
  
  // Determine the image source and CID to use
  let imageSrc;
  let pixelatedCID; // Declare this outside the if/else block
  
  if (isRevealed) {
    imageSrc = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkRlY3J5cHRpbmcuLi48L3RleHQ+PC9zdmc+"; // Placeholder for decrypted image
    pixelatedCID = capsule.imageCID; // Use encrypted image CID for error fallback
  } else {
    // Add timestamp to prevent caching issues
    const timestamp = Date.now();    // Use pixelated image CID if available, otherwise fall back to encrypted image CID
    // Handle empty strings properly (not just null/undefined)
    console.log(`Capsule #${capsule.id} CID info:`, {
      pixelatedImageCID: capsule.pixelatedImageCID,
      imageCID: capsule.imageCID,
      pixelatedTrimmed: capsule.pixelatedImageCID && capsule.pixelatedImageCID.trim()
    });
    pixelatedCID = (capsule.pixelatedImageCID && capsule.pixelatedImageCID.trim()) || capsule.imageCID;
    
    // Try IPFS endpoint first (for new pixelated images uploaded to IPFS)
    // If that fails, fall back to legacy pixelated endpoint
    imageSrc = `${getApiBaseUrl()}/ipfs/${pixelatedCID}?t=${timestamp}`;
    console.log(`Setting pixelated image src for capsule #${capsule.id}: ${imageSrc} (IPFS, CID: ${pixelatedCID})`);
  }
    card.innerHTML = `
    <div class="capsule-header">
      <div class="capsule-id">ID #${capsule.id}</div>
      <div class="capsule-status ${isRevealed ? 'status-revealed' : 'status-locked'}">
        ${isRevealed ? 'Revealed' : 'Locked'}
      </div>
    </div>      <img src="${imageSrc}" alt="Capsule image" class="capsule-image" loading="lazy" 
         onerror="handleImageError(this, '${pixelatedCID}', ${capsule.id})">>
      <div class="capsule-title">${capsule.title || 'Untitled Capsule'}</div>
    
    <div class="capsule-meta">
      <div><strong>Tags:</strong> ${capsule.tags || 'No tags'}</div>
      <div><strong>Creator:</strong> ${creator}</div>
      <div><strong>Unlocks:</strong> ${revealTime.toLocaleDateString()}</div>
    </div>
    
    <div class="capsule-story" id="story-${capsule.id}">
      ${isRevealed && capsule.decryptedStory ? 
        `<div>${capsule.decryptedStory}</div>` : 
        `<div style="color: #999; font-style: italic;">🔒 Story will be revealed on ${revealTime.toLocaleDateString()}</div>`
      }
      ${!isRevealed ? '<div class="story-fade"></div>' : ''}
    </div>
      <div class="capsule-actions">
      ${!isRevealed ? `
        <button class="btn-small btn-decrypt" onclick="decryptCapsule(${capsule.id}, '${capsule.shutterIdentity}')">
          🔓 Preview Story
        </button>
        <button class="btn-small btn-reveal" onclick="revealCapsule(${capsule.id}, '${capsule.shutterIdentity}')">
          🎉 Reveal Forever (Blockchain)
        </button>
      ` : ''}
      <button class="btn-small btn-expand" onclick="toggleStory(${capsule.id})">
        📖 Read More
      </button>
    </div>
  `;
  
  // If revealed, start image decryption
  if (isRevealed) {
    setTimeout(() => {
      decryptAndDisplayImage(capsule.id, capsule.imageCID, capsule.shutterIdentity);
    }, 100);
  }
  
  return card;
}

// =============  CAPSULE INTERACTIONS  =============
async function decryptCapsule(id, shutterIdentity) {
  try {
    console.log(`🔓 Decrypting capsule #${id}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {    alert("Decryption key not available yet! Please wait and try again.");
      return;
    }

    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Unknown encryptedStory format from database");    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    // Update the story display
    const storyElement = document.getElementById(`story-${id}`);
    if (storyElement) {
      storyElement.innerHTML = `<div>${plaintext}</div>`;
      storyElement.classList.add('expanded');
    }
    
    console.log(`✅ Successfully decrypted capsule #${id}`);
    
  } catch (error) {
    console.error(`Failed to decrypt capsule #${id}:`, error);
    alert("Decryption failed: " + error.message);
  }
}

async function revealCapsule(id, shutterIdentity) {
  try {
    // Connect wallet on-demand when user wants to reveal
    if (!walletConnected) {
      console.log('🔗 Connecting wallet for reveal action...');
      const connected = await connectWallet(true);
      if (!connected) {
        alert('Wallet connection is required to reveal capsules permanently on the blockchain.');
        return;
      }
    }
    
    console.log(`🎉 Revealing capsule #${id}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {      alert("Decryption key not available yet!");
      return;
    }

    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;    } else {
      throw new Error("Unknown encryptedStory format from database");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    // Submit reveal transaction
    const tx = await contract.revealCapsule(id, plaintext);
    alert(`Reveal transaction submitted! Hash: ${tx.hash}`);
    
    // Wait for confirmation and refresh
    await tx.wait();
    alert('Capsule revealed successfully!');
    
    // Refresh the page to show updated state
    window.location.reload();
    
  } catch (error) {
    console.error(`Failed to reveal capsule #${id}:`, error);
    alert("Reveal failed: " + error.message);
  }
}

function toggleStory(id) {
  const storyElement = document.getElementById(`story-${id}`);
  if (storyElement) {
    storyElement.classList.toggle('expanded');
    
    const button = storyElement.parentElement.querySelector('.btn-expand');
    if (storyElement.classList.contains('expanded')) {
      button.textContent = '📖 Read Less';
    } else {
      button.textContent = '📖 Read More';
    }
  }
}

async function decryptAndDisplayImage(capsuleId, imageCID, shutterIdentity) {
  try {
    console.log(`🖼️ Decrypting image for capsule ${capsuleId}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      console.log("Decryption key not available for image");
      return;
    }    // Fetch encrypted image from IPFS with redundancy
    const ipfsUrls = getIPFSUrls(imageCID);
    
    console.log(`Fetching encrypted image from IPFS, trying ${ipfsUrls.length} URLs...`);
    const encryptedImageResp = await fetchWithFallback(ipfsUrls, {
      responseType: 'arraybuffer'
    });const encryptedImageHex = "0x" + Array.from(new Uint8Array(encryptedImageResp.data))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();
    
    // Decrypt image
    const decryptedImageHex = await window.shutter.decrypt(encryptedImageHex, key);
    
    // Convert hex to blob and create object URL
    const decryptedImageBytes = new Uint8Array(
      decryptedImageHex.slice(2).match(/.{2}/g).map(byte => parseInt(byte, 16))
    );
    const imageBlob = new Blob([decryptedImageBytes]);
    const imageUrl = URL.createObjectURL(imageBlob);    // Find and update the image using data attribute for precise matching
    console.log(`Looking for capsule card with ID #${capsuleId}...`);
    const targetCard = document.querySelector(`[data-capsule-id="${capsuleId}"]`);
    
    if (targetCard) {
      console.log(`Found exact matching card for capsule #${capsuleId}!`);
      const img = targetCard.querySelector('.capsule-image');
      if (img) {
        // Clean up previous object URL to prevent memory leaks
        if (img.src.startsWith('blob:')) {
          URL.revokeObjectURL(img.src);
        }
        img.src = imageUrl;
        img.alt = "Decrypted image";
        console.log(`✅ Successfully decrypted and displayed image for capsule #${capsuleId}`);
      } else {
        console.warn(`Image element not found in card for capsule #${capsuleId}`);
      }
    } else {
      console.warn(`No card found for capsule ID #${capsuleId}`);
      // Fallback to the old method if data attribute fails
      const capsuleCards = document.querySelectorAll('.capsule-card-gallery');
      for (const card of capsuleCards) {
        const capsuleIdElement = card.querySelector('.capsule-id');
        if (capsuleIdElement && capsuleIdElement.textContent.trim() === `ID #${capsuleId}`) {
          const img = card.querySelector('.capsule-image');
          if (img) {
            if (img.src.startsWith('blob:')) {
              URL.revokeObjectURL(img.src);
            }
            img.src = imageUrl;
            img.alt = "Decrypted image";
            console.log(`✅ Successfully decrypted and displayed image for capsule #${capsuleId} (fallback method)`);
          }
          break;
        }
      }
    }
  } catch (e) {
    console.error(`Failed to decrypt image for capsule ${capsuleId}:`, e);
  }
}

// =============  HELPER FUNCTIONS  =============
async function ensureShutterReady() {
  let tries = 0;
  while (
    (!window.shutter || typeof window.shutter.encryptData !== "function") &&
    tries < 100
  ) {
    await new Promise(res => setTimeout(res, 50));
    tries++;
  }
  if (!window.shutter || typeof window.shutter.encryptData !== "function") {
    throw new Error("Shutter WASM not loaded!");
  }
}

// Expose functions globally for HTML onclick handlers
window.connectWallet = connectWallet;
window.decryptCapsule = decryptCapsule;
window.revealCapsule = revealCapsule;
window.toggleStory = toggleStory;
window.decryptAndDisplayImage = decryptAndDisplayImage;
window.handleImageError = handleImageError;
