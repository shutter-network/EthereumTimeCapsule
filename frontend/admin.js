/*  admin.js — Admin Panel Logic  */
/*  Handles admin operations: preview, reveal, share, batch operations  */
/*  EXACT PORT OF WORKING GALLERY.JS LOGIC  */

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

// =============  CONFIGURATION  =============
// Chain configuration - change this to switch networks
const CHAIN_CONFIG = {
  chainId: 100,                    // Chain ID as number
  chainIdHex: '0x64',              // Chain ID in hex format
  chainName: 'Gnosis',             // Display name (for error messages)
  rpcUrl: 'https://rpc.gnosischain.com', // RPC endpoint
};

// =============  GLOBALS (EXACT COPY FROM GALLERY.JS)  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let walletConnected = false;

// Configuration loaded from public_config.json
let appConfig = null;

// =============  HELPER FUNCTIONS (EXACT COPY FROM GALLERY.JS)  =============
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

// Helper: ensure Shutter WASM is ready (EXACT COPY FROM GALLERY.JS)
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

// =============  ADMIN OUTPUT LOGGING  =============
function logOutput(message) {
  const outputContent = document.getElementById('output-content');
  if (outputContent) {
    const timestamp = new Date().toLocaleTimeString();
    outputContent.textContent += `[${timestamp}] ${message}\n`;
    outputContent.scrollTop = outputContent.scrollHeight;
  }
  console.log(`[ADMIN] ${message}`);
}

// =============  INITIALIZATION (EXACT COPY FROM GALLERY.JS)  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
    logOutput("🚀 Initializing admin panel...");
    
    // Initialize global storage
    window.ipfsUrls = {};
    
    // Load system information
    try {
      const systemInfo = await axios.get(`${getApiBaseUrl()}/system_info`);
      window.systemInfo = systemInfo.data;
      logOutput("✅ System info loaded");
    } catch (e) {
      console.warn("Could not load system info:", e);
      window.systemInfo = { pinata_enabled: false };
      logOutput("⚠️ System info not available (optional)");
    }
    
    // Load configs & ABI
    const cacheBuster = `?v=${Date.now()}`;
    const cfgAll = await (await fetch(`public_config.json${cacheBuster}`)).json();
    
    // Store the full config globally
    appConfig = cfgAll;
    logOutput('📋 App configuration loaded');
    
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
    
    logOutput("📡 Contract initialized in read-only mode");
    
    // Initialize Shutter WASM
    logOutput("🔧 Initializing Shutter WASM...");
    try {
      await ensureShutterReady();
      logOutput("✅ Shutter WASM ready");
    } catch (e) {
      logOutput("⚠️ Shutter WASM not ready yet, will retry when needed");
    }
    
    logOutput("🎯 Admin panel ready for operations");
    
  } catch (e) {
    console.error("Initialization failed:", e);
    logOutput(`❌ Initialization failed: ${e.message}`);
  }
});

// =============  WALLET CONNECTION (EXACT COPY FROM GALLERY.JS)  =============
async function connectWallet(manual = false) {
  try {
    logOutput('🔄 Connecting wallet for blockchain interaction...');
    
    let eth = window.ethereum;
    if (!eth) {
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc: { [CHAIN_CONFIG.chainId]: CHAIN_CONFIG.rpcUrl },
        chainId: CHAIN_CONFIG.chainId
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
    if (net.chainId !== CHAIN_CONFIG.chainId) {
      // Try to switch to target chain
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CHAIN_CONFIG.chainIdHex }],
        });
        
        // IMPORTANT: Recreate provider after network switch
        provider = new ethers.providers.Web3Provider(eth);
        signer = provider.getSigner();
        
        // Verify the switch worked
        const newNet = await provider.getNetwork();
        if (newNet.chainId !== CHAIN_CONFIG.chainId) {
          throw new Error(`Network switch failed. Expected chain ID ${CHAIN_CONFIG.chainId}, got ${newNet.chainId}`);
        }
        
      } catch (switchError) {
        throw new Error(`Please switch to ${CHAIN_CONFIG.chainName} (network ID ${CHAIN_CONFIG.chainId}) in your wallet. If you don't have this network, please add it manually.`);
      }
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    logOutput("💰 Wallet contract initialized");
    
    walletConnected = true;
    logOutput('✅ Wallet connected successfully');
    
    return true;
  } catch (e) {
    console.error("❌ Wallet connection failed:", e);
    logOutput(`❌ Wallet connection failed: ${e.message}`);
    walletConnected = false;
    return false;
  }
}

// =============  ADMIN FUNCTIONS (EXACT LOGIC FROM GALLERY.JS)  =============

// Preview Capsule Story (Off-chain decryption only)
async function previewCapsuleStory() {
  const capsuleIdInput = document.getElementById('preview-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    logOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  try {
    logOutput(`🔓 Previewing story for capsule #${capsuleId}...`);
    
    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;
    
    logOutput(`📦 Capsule #${capsuleId} found: "${cap.title}"`);
    logOutput(`🔗 Shutter Identity: ${cap.shutterIdentity}`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: cap.shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      throw new Error("Decryption key not available yet! Please wait and try again.");
    }
    
    logOutput(`🔑 Decryption key obtained`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Unknown encryptedStory format from database");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    logOutput(`✅ Story decrypted successfully!`);
    logOutput(`📖 Story content: "${plaintext}"`);
    
  } catch (error) {
    console.error(`Failed to preview capsule #${capsuleId}:`, error);
    logOutput(`❌ Preview failed: ${error.message}`);
  }
}

// Reveal Capsule Forever (On-chain transaction)
async function revealCapsuleForever() {
  const capsuleIdInput = document.getElementById('reveal-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    logOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  try {
    // Connect wallet on-demand when user wants to reveal
    if (!walletConnected) {
      logOutput('🔗 Connecting wallet for reveal transaction...');
      const connected = await connectWallet(true);
      if (!connected) {
        logOutput('❌ Wallet connection is required to reveal capsules permanently on the blockchain.');
        return;
      }
    }
    
    logOutput(`🎉 Revealing capsule #${capsuleId} forever on blockchain...`);
    
    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;
    
    logOutput(`📦 Capsule #${capsuleId} found: "${cap.title}"`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: cap.shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      throw new Error("Decryption key not available yet!");
    }
    
    logOutput(`🔑 Decryption key obtained`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Unknown encryptedStory format from database");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");
    
    logOutput(`🔓 Story decrypted: "${plaintext}"`);

    // Submit reveal transaction
    logOutput(`📝 Submitting reveal transaction to blockchain...`);
    const tx = await contract.revealCapsule(capsuleId, plaintext);
    logOutput(`🚀 Reveal transaction submitted! Hash: ${tx.hash}`);
    
    // Wait for confirmation
    logOutput(`⏳ Waiting for transaction confirmation...`);
    await tx.wait();
    logOutput(`✅ Capsule #${capsuleId} revealed successfully on blockchain!`);
    
  } catch (error) {
    console.error(`Failed to reveal capsule #${capsuleId}:`, error);
    logOutput(`❌ Reveal failed: ${error.message}`);
  }
}

// Share Capsule on X
async function shareCapsule() {
  const capsuleIdInput = document.getElementById('share-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (!capsuleId || capsuleId < 1) {
    logOutput('❌ Please enter a valid capsule ID');
    return;
  }
  
  try {
    logOutput(`🐦 Sharing capsule #${capsuleId} on X...`);
    
    // Fetch capsule data to get title and details
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;
    
    const title = cap.title || 'Untitled Capsule';
    const revealTime = new Date(cap.revealTime * 1000);
    
    // Construct share URL
    const currentUrl = window.location.origin + window.location.pathname;
    const capsuleUrl = `${currentUrl.replace('/admin.html', '/gallery.html')}?capsule=${capsuleId}`;
    
    // Construct tweet text
    const tweetText = encodeURIComponent(
      `🎁 Check out my Time Capsule: "${title}" 🎁\n\n` +
      `🗓️ Unlocks: ${revealTime.toLocaleDateString()}\n` +
      `🔗 View: ${capsuleUrl}\n\n` +
      `#TimeCapsule #Ethereum #Future #Memories`
    );
    
    // Open Twitter share dialog
    const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
    window.open(twitterUrl, '_blank');
    
    logOutput(`✅ Share dialog opened for capsule #${capsuleId}: "${title}"`);
    logOutput(`🔗 Direct link: ${capsuleUrl}`);
    
  } catch (error) {
    console.error(`Failed to share capsule #${capsuleId}:`, error);
    logOutput(`❌ Share failed: ${error.message}`);
  }
}

// Batch Preview Capsules
async function batchPreviewCapsules() {
  const batchInput = document.getElementById('batch-capsule-ids');
  const capsuleIdsText = batchInput.value.trim();
  
  if (!capsuleIdsText) {
    logOutput('❌ Please enter capsule IDs (comma-separated)');
    return;
  }
  
  try {
    // Parse comma-separated IDs
    const capsuleIds = capsuleIdsText.split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id) && id > 0);
    
    if (capsuleIds.length === 0) {
      logOutput('❌ No valid capsule IDs found');
      return;
    }
    
    logOutput(`📦 Starting batch preview for ${capsuleIds.length} capsules: ${capsuleIds.join(', ')}`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const capsuleId of capsuleIds) {
      try {
        logOutput(`\n🔄 Processing capsule #${capsuleId}...`);
        
        // Fetch capsule data
        const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
        if (!response.data.success) {
          throw new Error(response.data.error || "Failed to fetch capsule");
        }
        const cap = response.data.capsule;
        
        logOutput(`📦 Found: "${cap.title}" (Reveal: ${new Date(cap.revealTime * 1000).toLocaleDateString()})`);
        
        // Get decryption key
        const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
          params: { identity: cap.shutterIdentity, registry: registryAddr }
        });
        const key = resp.data?.message?.decryption_key;
        if (!key) {
          throw new Error("Decryption key not available yet");
        }

        // Handle encrypted story
        let encryptedHex;
        if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
          encryptedHex = cap.encryptedStory;
        } else if (typeof cap.encryptedStory === "string") {
          encryptedHex = "0x" + cap.encryptedStory;
        } else {
          throw new Error("Unknown encryptedStory format");
        }

        // Ensure Shutter WASM is ready
        await ensureShutterReady();

        // Decrypt the story
        const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
        const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

        logOutput(`✅ #${capsuleId}: "${plaintext.substring(0, 100)}${plaintext.length > 100 ? '...' : ''}"`);
        successCount++;
        
      } catch (error) {
        logOutput(`❌ #${capsuleId}: ${error.message}`);
        failCount++;
      }
      
      // Small delay between capsules to prevent overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    logOutput(`\n📊 Batch preview complete!`);
    logOutput(`✅ Successful: ${successCount}`);
    logOutput(`❌ Failed: ${failCount}`);
    logOutput(`📝 Total processed: ${capsuleIds.length}`);
    
  } catch (error) {
    console.error('Batch preview failed:', error);
    logOutput(`❌ Batch preview failed: ${error.message}`);
  }
}

// Manual Shutter initialization (for debugging)
async function initializeShutter() {
  try {
    logOutput('🔧 Manually initializing Shutter WASM...');
    await ensureShutterReady();
    logOutput('✅ Shutter WASM initialized successfully!');
    logOutput(`🛠️ Available functions: ${Object.keys(window.shutter || {}).join(', ')}`);
  } catch (error) {
    logOutput(`❌ Shutter initialization failed: ${error.message}`);
  }
}

// =============  EXPOSE FUNCTIONS GLOBALLY  =============
window.previewCapsuleStory = previewCapsuleStory;
window.revealCapsuleForever = revealCapsuleForever;
window.shareCapsule = shareCapsule;
window.batchPreviewCapsules = batchPreviewCapsules;
window.initializeShutter = initializeShutter;
window.connectWallet = connectWallet;
