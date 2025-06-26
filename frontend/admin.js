/*  admin.js — Admin Panel Logic  */
/*  Handles administrative functions for managing time capsules  */

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let walletConnected = false;

// Configuration loaded from public_config.json
let appConfig = null;

// =============  HELPER FUNCTIONS  =============
// Helper: get API base URL (production vs development)
function getApiBaseUrl() {
  return window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
}

// Helper: append output to the admin console
function appendOutput(message) {
  const outputContent = document.getElementById('output-content');
  const timestamp = new Date().toLocaleTimeString();
  outputContent.textContent += `[${timestamp}] ${message}\n`;
  outputContent.scrollTop = outputContent.scrollHeight;
}

// Helper: clear output console
function clearOutput() {
  document.getElementById('output-content').textContent = 'Output cleared...\n';
}

// Helper: update wallet status UI
function updateWalletStatus(connected, address = '') {
  const statusElement = document.getElementById('wallet-status');
  if (connected) {
    statusElement.className = 'wallet-status connected';
    statusElement.textContent = `✅ Wallet Connected: ${address.slice(0, 6)}...${address.slice(-4)}`;
  } else {
    statusElement.className = 'wallet-status disconnected';
    statusElement.textContent = '❌ Wallet Not Connected';
  }
}

// =============  INITIALIZATION  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
    appendOutput('🚀 Initializing admin panel...');
    
    // Initialize global storage
    window.ipfsUrls = {};
    
    // Load system information (optional, skip if not available)
    try {
      const sysResp = await axios.get(`${getApiBaseUrl()}/api/system_info`);
      if (sysResp.data.success) {
        window.systemInfo = sysResp.data.info;
        appendOutput('✅ System information loaded');
      }
    } catch (e) {
      appendOutput('⚠️ System info endpoint not available (skipping)');
      // Initialize empty system info
      window.systemInfo = {};
    }
    
    // Load configs & ABI
    const cacheBuster = `?v=${Date.now()}`;
    const cfgAll = await (await fetch(`public_config.json${cacheBuster}`)).json();
    
    // Store the full config globally
    appConfig = cfgAll;
    appendOutput('📋 App configuration loaded');
    
    const fixedNetwork = cfgAll.default_network;
    const fixedCfg = cfgAll[fixedNetwork];
    const shutterCfg = cfgAll["testnet"]; // or "mainnet"
    
    contractAddr = fixedCfg.contract_address;
    contractAbi = await (await fetch(`contract_abi.json${cacheBuster}`)).json();
    shutterApi = shutterCfg.shutter_api_base;
    registryAddr = shutterCfg.registry_address;
    
    appendOutput(`🔗 Contract address: ${contractAddr}`);
    appendOutput(`🔑 Shutter API: ${shutterApi}`);
    
    // Initialize read-only provider
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );
    
    appendOutput('✅ Read-only contract initialized');
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize Shutter WASM
    appendOutput('🔄 Initializing Shutter WASM...');
    try {
      // Skip Shutter initialization for now to avoid potential blocking
      appendOutput('⚠️ Shutter WASM initialization skipped (manual init required)');
    } catch (e) {
      appendOutput('❌ Shutter WASM initialization failed: ' + e.message);
    }
    
    appendOutput('🎉 Admin panel ready!');
    
  } catch (e) {
    appendOutput('❌ Initialization failed: ' + e.message);
    console.error("Admin initialization failed:", e);
  }
});

// =============  WALLET CONNECTION  =============
async function connectWallet() {
  try {
    appendOutput('🔄 Connecting wallet...');
    
    let eth = window.ethereum;
    if (!eth) {
      // Try WalletConnect as fallback
      const walletConnectProvider = new WalletConnectProvider({
        infuraId: "your-infura-id" // You can set this in config
      });
      await walletConnectProvider.enable();
      eth = walletConnectProvider;
      appendOutput('🔗 Using WalletConnect');
    } else {
      await eth.request({ method: 'eth_requestAccounts' });
      appendOutput('🔗 Using injected wallet');
    }
    
    provider = new ethers.providers.Web3Provider(eth);
    signer = provider.getSigner();
    
    const address = await signer.getAddress();
    appendOutput(`👤 Connected address: ${address}`);
    
    const net = await provider.getNetwork();
    appendOutput(`🌐 Network: ${net.name} (Chain ID: ${net.chainId})`);
    
    if (net.chainId !== 100) {
      appendOutput('⚠️ Warning: Not connected to Gnosis Chain (xDai)');
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    appendOutput('💰 Wallet contract initialized');
    
    walletConnected = true;
    updateWalletStatus(true, address);
    appendOutput('✅ Wallet connected successfully');
    
  } catch (e) {
    appendOutput('❌ Wallet connection failed: ' + e.message);
    console.error("Wallet connection failed:", e);
    walletConnected = false;
    updateWalletStatus(false);
  }
}

// =============  EVENT LISTENERS  =============
function setupEventListeners() {
  // Wallet connection
  document.getElementById('connect-wallet-btn').onclick = connectWallet;
  
  // Manual Shutter initialization
  document.getElementById('init-shutter-btn').onclick = initializeShutter;
  
  // Preview story
  document.getElementById('preview-story-btn').onclick = previewCapsuleStory;
  
  // Reveal forever
  document.getElementById('reveal-forever-btn').onclick = revealCapsuleForever;
  
  // Share capsule
  document.getElementById('share-capsule-btn').onclick = shareCapsule;
  
  // Batch operations
  document.getElementById('batch-preview-btn').onclick = batchPreviewCapsules;
  
  // Clear output on double-click
  document.getElementById('output-content').ondblclick = clearOutput;
}

// =============  ADMIN FUNCTIONS  =============

// Preview capsule story (off-chain decryption only)
async function previewCapsuleStory() {
  const capsuleIdInput = document.getElementById('preview-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    appendOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  try {
    appendOutput(`🔓 Previewing story for capsule #${capsuleId}...`);
    
    // Ensure Shutter WASM is ready first
    appendOutput('🔄 Checking Shutter WASM availability...');
    await ensureShutterReady();
    
    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      appendOutput(`❌ Failed to fetch capsule #${capsuleId}: ${response.data.message}`);
      return;
    }
    
    const capsule = response.data.capsule;
    appendOutput(`📋 Capsule #${capsuleId}: "${capsule.title}" by ${capsule.creator.slice(0, 6)}...${capsule.creator.slice(-4)}`);
    
    if (capsule.isRevealed) {
      appendOutput(`✅ Capsule #${capsuleId} is already revealed`);
      if (capsule.decryptedStory) {
        appendOutput(`📖 Story: ${capsule.decryptedStory}`);
      }
      return;
    }
    
    // Get decryption key from Shutter
    appendOutput(`🔑 Requesting decryption key from Shutter API...`);
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: capsule.shutterIdentity, registry: registryAddr },
      timeout: 10000 // 10 second timeout
    });
    
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      appendOutput(`❌ No decryption key available for capsule #${capsuleId}`);
      appendOutput(`🔍 Shutter response: ${JSON.stringify(resp.data)}`);
      return;
    }
    
    appendOutput(`🔑 Decryption key obtained (${key.length} chars)`);
    
    // Decrypt the story
    let encryptedHex;
    if (typeof capsule.encryptedStory === "string" && capsule.encryptedStory.startsWith("0x")) {
      encryptedHex = capsule.encryptedStory.slice(2);
    } else if (typeof capsule.encryptedStory === "string") {
      encryptedHex = capsule.encryptedStory;
    } else {
      appendOutput(`❌ Invalid encrypted story format for capsule #${capsuleId}`);
      return;
    }
    
    appendOutput(`🔓 Decrypting story (${encryptedHex.length} hex chars)...`);
    
    // Decrypt using Shutter WASM
    const decryptedBytes = window.shutter.decryptData(
      new Uint8Array(Buffer.from(encryptedHex, 'hex')),
      new Uint8Array(Buffer.from(key, 'hex'))
    );
    
    const decryptedStory = new TextDecoder().decode(decryptedBytes);
    appendOutput(`📖 Decrypted story: ${decryptedStory}`);
    appendOutput(`✅ Successfully previewed capsule #${capsuleId} story`);
    
  } catch (error) {
    appendOutput(`❌ Failed to preview capsule #${capsuleId}: ${error.message}`);
    
    // More specific error handling
    if (error.message.includes('Network Error') || error.message.includes('timeout')) {
      appendOutput('🌐 This might be a network connectivity issue with the Shutter API');
    } else if (error.message.includes('Shutter WASM')) {
      appendOutput('⚙️ Try refreshing the page to reload the Shutter WASM module');
    }
    
    console.error('Preview failed:', error);
  }
}

// Reveal capsule forever (write to blockchain)
async function revealCapsuleForever() {
  const capsuleIdInput = document.getElementById('reveal-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    appendOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  if (!walletConnected) {
    appendOutput('❌ Please connect your wallet first');
    return;
  }
  
  try {
    appendOutput(`🎉 Revealing capsule #${capsuleId} forever on blockchain...`);
    
    // Fetch capsule data
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      appendOutput(`❌ Failed to fetch capsule #${capsuleId}: ${response.data.message}`);
      return;
    }
    
    const capsule = response.data.capsule;
    
    if (capsule.isRevealed) {
      appendOutput(`⚠️ Capsule #${capsuleId} is already revealed`);
      return;
    }
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: capsule.shutterIdentity, registry: registryAddr }
    });
    
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      appendOutput(`❌ No decryption key available for capsule #${capsuleId}`);
      return;
    }
    
    appendOutput(`🔑 Decryption key obtained`);
    
    // Decrypt story and image
    let encryptedHex;
    if (typeof capsule.encryptedStory === "string" && capsule.encryptedStory.startsWith("0x")) {
      encryptedHex = capsule.encryptedStory.slice(2);
    } else if (typeof capsule.encryptedStory === "string") {
      encryptedHex = capsule.encryptedStory;
    } else {
      appendOutput(`❌ Invalid encrypted story format for capsule #${capsuleId}`);
      return;
    }
    
    await ensureShutterReady();
    
    const decryptedBytes = window.shutter.decryptData(
      new Uint8Array(Buffer.from(encryptedHex, 'hex')),
      new Uint8Array(Buffer.from(key, 'hex'))
    );
    const decryptedStory = new TextDecoder().decode(decryptedBytes);
    
    appendOutput(`📖 Decrypted story: ${decryptedStory}`);
    
    // Call blockchain reveal function
    appendOutput(`⛓️ Submitting reveal transaction to blockchain...`);
    const tx = await contract.reveal(capsuleId);
    appendOutput(`📝 Transaction hash: ${tx.hash}`);
    
    // Wait for confirmation
    appendOutput(`⏳ Waiting for transaction confirmation...`);
    const receipt = await tx.wait();
    appendOutput(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Update database
    appendOutput(`💾 Updating database with revealed data...`);
    const updateResp = await axios.post(`${getApiBaseUrl()}/api/reveal_capsule`, {
      capsule_id: capsuleId,
      decrypted_story: decryptedStory,
      transaction_hash: tx.hash
    });
    
    if (updateResp.data.success) {
      appendOutput(`✅ Successfully revealed capsule #${capsuleId} forever!`);
    } else {
      appendOutput(`⚠️ Blockchain reveal succeeded but database update failed: ${updateResp.data.message}`);
    }
    
  } catch (error) {
    appendOutput(`❌ Failed to reveal capsule #${capsuleId}: ${error.message}`);
    console.error('Reveal failed:', error);
  }
}

// Share capsule on X (Twitter)
async function shareCapsule() {
  const capsuleIdInput = document.getElementById('share-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    appendOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  try {
    appendOutput(`🐦 Sharing capsule #${capsuleId} on X...`);
    
    // Fetch capsule data
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      appendOutput(`❌ Failed to fetch capsule #${capsuleId}: ${response.data.message}`);
      return;
    }
    
    const capsule = response.data.capsule;
    const unlockDate = new Date(capsule.revealTime * 1000);
    
    // Create share URL and text
    const shareUrl = `${window.location.origin}/gallery.html?capsule=${capsuleId}`;
    const text = `Check out this time capsule on Ethereum! 🕰️✨ "${capsule.title}" - Unlocks on ${unlockDate.toLocaleDateString()}`;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    
    appendOutput(`📋 Share URL: ${shareUrl}`);
    appendOutput(`📝 Share text: ${text}`);
    
    // Open Twitter compose window
    window.open(twitterUrl, '_blank');
    appendOutput(`✅ Opened Twitter compose window for capsule #${capsuleId}`);
    
  } catch (error) {
    appendOutput(`❌ Failed to share capsule #${capsuleId}: ${error.message}`);
    console.error('Share failed:', error);
  }
}

// Batch preview multiple capsules
async function batchPreviewCapsules() {
  const batchInput = document.getElementById('batch-capsule-ids');
  const idsString = batchInput.value.trim();
  
  if (!idsString) {
    appendOutput('❌ Please enter capsule IDs (comma-separated)');
    return;
  }
  
  const ids = idsString.split(',').map(id => parseInt(id.trim())).filter(id => id > 0);
  
  if (ids.length === 0) {
    appendOutput('❌ No valid capsule IDs provided');
    return;
  }
  
  appendOutput(`📦 Starting batch preview for ${ids.length} capsules: ${ids.join(', ')}`);
  
  for (const capsuleId of ids) {
    try {
      appendOutput(`\n--- Processing Capsule #${capsuleId} ---`);
      
      // Set the individual input and trigger preview
      document.getElementById('preview-capsule-id').value = capsuleId;
      await previewCapsuleStory();
      
      // Small delay between requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      appendOutput(`❌ Batch processing failed for capsule #${capsuleId}: ${error.message}`);
    }
  }
  
  appendOutput(`\n✅ Batch preview completed for ${ids.length} capsules`);
}

// =============  MANUAL SHUTTER INITIALIZATION  =============
async function initializeShutter() {
  try {
    appendOutput('🔄 Manually initializing Shutter WASM...');
    
    // Check if already initialized
    if (window.shutter && typeof window.shutter.encryptData === "function") {
      appendOutput('✅ Shutter WASM already initialized');
      return;
    }
    
    // Try to initialize
    await ensureShutterReady();
    appendOutput('✅ Shutter WASM manually initialized successfully');
    
  } catch (error) {
    appendOutput('❌ Manual Shutter initialization failed: ' + error.message);
    appendOutput('⚠️ Try refreshing the page to reload all scripts');
    console.error('Manual Shutter init failed:', error);
  }
}

// =============  UTILITY FUNCTIONS  =============
async function ensureShutterReady() {
  let tries = 0;
  const maxTries = 200; // Increased from 100 to 200 (10 seconds)
  
  while (
    (!window.shutter || typeof window.shutter.encryptData !== "function") &&
    tries < maxTries
  ) {
    await new Promise(res => setTimeout(res, 50));
    tries++;
    
    // Log progress every 2 seconds
    if (tries % 40 === 0) {
      appendOutput(`⏳ Still waiting for Shutter WASM... (${tries * 50}ms)`);
    }
  }
  
  if (!window.shutter || typeof window.shutter.encryptData !== "function") {
    throw new Error(`Shutter WASM not ready after ${maxTries * 50}ms`);
  }
  
  appendOutput('✅ Shutter WASM is ready');
}

// Expose functions globally for HTML onclick handlers
window.connectWallet = connectWallet;
window.initializeShutter = initializeShutter;
window.previewCapsuleStory = previewCapsuleStory;
window.revealCapsuleForever = revealCapsuleForever;
window.shareCapsule = shareCapsule;
window.batchPreviewCapsules = batchPreviewCapsules;
window.clearOutput = clearOutput;
