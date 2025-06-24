/*  time_capsule.js — ESM module  */
/*  Requires:
      - ethers 5.7+
      - axios
      - buffer (polyfill)
      - wallet-connect provider for mobile
      - Shutter web bundle (loads `window.shutter`)
*/

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios      from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;


// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let capsuleOffset = 0;
const batch = 5;

// =============  SYSTEM INFO  =============
async function loadSystemInfo() {
  try {
    const response = await axios.get("http://localhost:5000/system_info");
    const info = response.data;
    
    console.log("System info:", info);
    window.systemInfo = info;
    
    // Update status to show Pinata status
    if (info.pinata_enabled) {
      setStatus("System ready - Pinata IPFS enabled");
    } else {
      setStatus("System ready - Using local storage only");
    }
    
    return info;
  } catch (error) {
    console.warn("Failed to load system info:", error);
    setStatus("System ready - Backend connection issues");
    return { pinata_enabled: false };
  }
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
  const localUrl = `http://localhost:5000/ipfs/${cid}`;
  if (!urls.includes(localUrl)) {
    urls.push(localUrl);
  }
  
  return urls;
}

// =============  HELPERS  =============
const $ = (id)=>document.getElementById(id);
const setStatus = (m)=>{ console.log(m); $("status").textContent = m; };
const fmtTime   = (ts)=>new Date(ts*1000).toLocaleString();
const ipfsURL   = (cid)=>`http://localhost:5000/ipfs/${cid}`; // Use local backend instead of public gateway

// =============  WALLET CONNECT  =============
let walletConnected = false;

async function connectWallet(manual = false){
  try {
    let eth = window.ethereum;
    if(!eth){
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc:{100:"https://rpc.gnosischain.com"},
        chainId:100
      });
      await wc.enable();
      eth = wc;
    } else if (manual) {
      // Prompt MetaMask connect if manual
      await eth.request({ method: "eth_requestAccounts" });
    }
    provider = new ethers.providers.Web3Provider(eth);
    signer   = provider.getSigner();    const net= await provider.getNetwork();
    if(net.chainId!==100) throw new Error("Please switch to Gnosis Chain (100)");
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    console.log("💰 Wallet contract initialized with address:", contractAddr);
    setStatus("Wallet connected");
    walletConnected = true;
  } catch(e) {
    setStatus("Wallet connection failed: " + e.message);
    walletConnected = false;
  }
}

// =============  BACKEND CALL  =============
async function requestCapsuleEncryption(title, tags, story, file) {
  // Always set reveal timestamp 60 seconds in the future
  const revealTimestamp = Math.floor(Date.now() / 1000) + 60;

  const fd = new FormData();
  fd.append("title", title);
  fd.append("tags", tags);
  fd.append("story", story);
  fd.append("image", file);
  fd.append("revealTimestamp", revealTimestamp); // Pass to backend

  const r = await axios.post("http://localhost:5000/submit_capsule", fd, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return r.data; // {encryptedStory, shutterIdentity, revealTimestamp, imageCID, pixelatedImage}
}

// Helper: convert file to hex string
async function fileToHex(file) {
  const arrayBuffer = await file.arrayBuffer();
  return "0x" + Array.from(new Uint8Array(arrayBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: upload to IPFS via backend with Pinata integration
async function uploadToIPFS(hexData) {
  const res = await axios.post("http://localhost:5000/upload_ipfs", { hex: hexData });
  const result = res.data; // Returns {cid, local_url, pinata_url?, ipfs_urls, pinata_enabled}
  
  // Store IPFS URLs globally for redundant access
  window.ipfsUrls = window.ipfsUrls || {};
  if (result.cid && result.ipfs_urls) {
    window.ipfsUrls[result.cid] = result.ipfs_urls;
    console.log(`Stored ${result.ipfs_urls.length} URLs for CID ${result.cid}`);
  }
  
  return result;
}

// Helper: initialize system info and load IPFS URLs
async function initializeSystem() {
  try {
    const systemInfo = await axios.get("http://localhost:5000/system_info");
    window.systemInfo = systemInfo.data;
    console.log("System info loaded:", window.systemInfo);
    
    // Initialize IPFS URLs storage
    window.ipfsUrls = window.ipfsUrls || {};
    
    return window.systemInfo;
  } catch (e) {
    console.warn("Could not load system info:", e);
    window.systemInfo = { pinata_enabled: false };
    return window.systemInfo;
  }
}

// Wait for Shutter WASM to be ready
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

// =============  CREATE  =============
async function createCapsule() {
  try {
    const title = $("capTitle").value.trim();
    const tags  = $("capTags").value.trim();
    const story = $("capStory").value.trim();
    const file  = $("capImage").files[0];
    if (!title || !tags || !story || !file) return setStatus("Fill in every field & choose an image");

    setStatus("Preparing Shutter encryption…");
    // 1. Get Shutter identity, encMeta, and pixelated preview from backend
    const enc = await requestCapsuleEncryption(title, tags, story, file);

    // 2. Wait for Shutter WASM to be ready
    await ensureShutterReady();

    // 3. Encrypt story using Shutter WASM/SDK (MATCH WORKING APP)
    // Use Buffer.from(story, "utf8").toString("hex") for hex encoding
    const storyHex = "0x" + Buffer.from(story, "utf8").toString("hex");
    // Generate random sigma (32 bytes) for encryption - this is required for Shutter encryption
    const sigmaBytes = new Uint8Array(32);
    crypto.getRandomValues(sigmaBytes);
    const sigmaHex = "0x" + Array.from(sigmaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    // Use enc.shutterIdentity and enc.encMeta.eon_key for encryption (identity must match decryption fetch)
    console.log("Encrypting with:", {
      storyHex,
      identity: enc.shutterIdentity,
      eon_key: enc.encMeta.eon_key,
      sigmaHex
    });
    const encryptedStory = await window.shutter.encryptData(
      storyHex,
      enc.shutterIdentity, // use the same identity as stored in contract and used for decryption
      enc.encMeta.eon_key,
      sigmaHex
    );    // 4. Encrypt image file as hex string (consistent with story encryption)
    const imgHex = await fileToHex(file);
    const encryptedImg = await window.shutter.encryptData(
      imgHex,
      enc.shutterIdentity, // use the same identity for consistency
      enc.encMeta.eon_key,
      sigmaHex
    );    // 5. Upload encrypted image to IPFS with redundancy
    setStatus("Uploading encrypted image to IPFS…");
    const uploadResult = await uploadToIPFS(encryptedImg);
    const imageCID = uploadResult.cid;
    
    console.log("Upload result:", uploadResult);
    if (uploadResult.pinata_enabled && uploadResult.pinata_url) {
      console.log("Image uploaded to Pinata:", uploadResult.pinata_url);
    }// Save pixelated image CID mapping on backend
    console.log("Saving pixelated mapping:", { cid: imageCID, preview_id: enc.pixelatedId });
    const saveResp = await axios.post("http://localhost:5000/save_pixelated", {
      cid: imageCID,
      preview_id: enc.pixelatedId
    });
    console.log("Save pixelated response:", saveResp.data);

    setStatus("Sending tx…");
    // STORE ENCRYPTED STORY AS BYTES (arrayify hex string)
    const tx = await contract.commitCapsule(
      title,
      tags,
      ethers.utils.arrayify(encryptedStory), // convert hex string to bytes for contract
      enc.revealTimestamp,
      enc.shutterIdentity,
      imageCID
    );
    await tx.wait();
    setStatus("Capsule committed! Tx hash: " + tx.hash);

    // quick UI preview
    $("previewList").insertAdjacentHTML("afterbegin", `
      <div class="capsule-card unrevealed">
        <h3>${title}</h3>
        <img src="${enc.pixelatedImage}" alt="pixelated preview">
        <p><em>Will unlock on ${fmtTime(enc.revealTimestamp)}</em></p>
      </div>`);

    $("capForm").reset();
  } catch (e) {
    console.error(e);
    setStatus(e.message);
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

// =============  DECRYPT IMAGE  =============
async function decryptAndDisplayImage(capsuleId, imageCID, shutterIdentity) {
  try {
    console.log(`Decrypting image for capsule ${capsuleId}, CID: ${imageCID}`);
    
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
    });
    
    const encryptedImageHex = "0x" + Array.from(new Uint8Array(encryptedImageResp.data))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    // Decrypt image
    const decryptedImageHex = await window.shutter.decrypt(encryptedImageHex, key);
    
    // Convert hex to blob and create object URL
    const decryptedImageBytes = new Uint8Array(
      decryptedImageHex.slice(2).match(/.{2}/g).map(byte => parseInt(byte, 16))
    );
    const imageBlob = new Blob([decryptedImageBytes]);
    const imageUrl = URL.createObjectURL(imageBlob);

    // Find the capsule card and update the image
    const allCapsules = document.querySelectorAll('.capsule-card');
    for (const capsule of allCapsules) {
      const summary = capsule.querySelector('summary');
      if (summary && summary.textContent.includes(`ID #${capsuleId}`)) {
        const img = capsule.querySelector('img');
        if (img) {
          img.src = imageUrl;
          img.alt = "Decrypted image";
          console.log(`Successfully decrypted and displayed image for capsule #${capsuleId}`);
        }
        break;
      }
    }
  } catch (e) {
    console.error(`Failed to decrypt image for capsule ${capsuleId}:`, e);
  }
}

// =============  DECRYPT ONLY (NO TX)  =============
async function decryptCapsule(id, shutterIdentity) {
  try {
    setStatus("Fetching decryption key from Shutter…");
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      setStatus("Decryption key not available yet! Please wait a bit and try again.");
      return;
    }    setStatus("Fetching capsule data…");
    // Use database API instead of direct blockchain call
    console.log(`📦 Fetching capsule #${id} from DATABASE API (not blockchain)...`);
    const response = await axios.get(`http://localhost:5000/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;
    console.log(`✅ Fetched capsule #${id} from DATABASE:`, cap);setStatus("Decrypting story…");
    // --- Handle encrypted story from database API (hex string) ---
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      // Database returns hex string without 0x prefix
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Unknown encryptedStory format from database");
    }
    console.log("Decrypting with:", { encryptedHex, key });
    // --- Try decryption, fallback to direct string if error ---
    let plaintext;
    try {
      const plaintextHex = await window.shutter.decrypt(
        encryptedHex,
        key
      );
      plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");
    } catch (err) {
      // If padding error, try to decode as utf8 directly (for debugging)
      console.error("Decryption error, trying fallback:", err);
      try {
        plaintext = Buffer.from(encryptedHex.slice(2), "hex").toString("utf8");
      } catch (fallbackErr) {
        plaintext = "[Decryption failed: " + err.message + "]";
      }
    }    // Find the correct capsule card by searching for the ID in the summary text
    const allCapsules = document.querySelectorAll('.capsule-card');
    let targetCapsule = null;
    
    for (const capsule of allCapsules) {
      const summary = capsule.querySelector('summary');
      if (summary && summary.textContent.includes(`ID #${id}`)) {
        targetCapsule = capsule;
        break;
      }
    }
    
    if (targetCapsule) {
      let out = targetCapsule.querySelector('.decrypted-story');
      if (!out) {
        out = document.createElement('div');
        out.className = 'decrypted-story';
        targetCapsule.querySelector('div').appendChild(out);
      }
      out.innerHTML = `<pre>${plaintext}</pre>`;
      console.log(`Successfully displayed decrypted text for capsule #${id}`);
    } else {
      console.error(`Could not find capsule card for ID #${id}`);
    }
    setStatus("Decryption complete!");
  } catch (e) {
    if (e.response && (e.response.status === 400 || e.response.status === 404)) {
      setStatus("Decryption key not available yet! Please wait a bit and try again.");
    } else {
      console.error(e);
      setStatus("Decryption failed: " + e.message);
    }
  }
}

// =============  LOAD CAPSULES  =============
async function loadCapsules(){  try{
    // Use database API instead of direct blockchain calls
    console.log("📦 Loading capsules from DATABASE API (not blockchain)...");
    const response = await axios.get("http://localhost:5000/api/capsules", {
      params: {
        offset: capsuleOffset,
        limit: batch
      }
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to load capsules");
    }
    
    const capsules = response.data.capsules;
    const total = response.data.total_count;
    console.log(`✅ Loaded ${capsules.length} capsules from DATABASE (total: ${total})`);
    setStatus(`Loaded ${capsules.length} capsules from database cache`);
    
    if(capsuleOffset>=total) return setStatus("No more capsules");
    const container = $("capsuleList");

    for(let i = 0; i < capsules.length; i++){
      const c = capsules[i];
      const id = c.id;const revealed = c.isRevealed;
      // For unrevealed: show pixelated preview, for revealed: show placeholder initially, then decrypt
      const imgSrc = revealed ? "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkRlY3J5cHRpbmcuLi48L3RleHQ+PC9zdmc+" : `http://localhost:5000/pixelated/${c.imageCID}`;
      container.insertAdjacentHTML("beforeend",`
        <details class="capsule-card ${revealed?'revealed':'unrevealed'}">
          <summary>
            <strong>${c.title}</strong> — ID #${id}
            ${revealed ? "(revealed)" : "(locked)"}
          </summary>
          <div>
            <img src="${imgSrc}" alt="preview">
            <p><strong>Tags:</strong> ${c.tags}</p>
            <p><strong>Creator:</strong> ${c.creator}</p>
            <p><strong>Unlocks at:</strong> ${fmtTime(c.revealTime)}</p>
            ${revealed
              ? `<pre>${c.decryptedStory}</pre>`
              : `<button onclick="revealCapsule(${id},'${c.shutterIdentity}')">Attempt manual reveal</button>
                 <button onclick="decryptCapsule(${id},'${c.shutterIdentity}')">Decrypt (view only)</button>
                 <div class="decrypted-story"></div>`
            }          </div>
        </details>
      `);
      
      // If revealed, decrypt the image asynchronously
      if (revealed) {
        decryptAndDisplayImage(id, c.imageCID, c.shutterIdentity);
      }
    }
    capsuleOffset += batch;
  }catch(e){ console.error(e); setStatus("Load error: "+e.message); }
}

// =============  REVEAL  =============
async function revealCapsule(id,shutterIdentity){
  try{
    setStatus("Checking key…");
    const resp = await axios.get(`${shutterApi}/get_decryption_key`,{
      params:{ identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if(!key) return setStatus("Key not out yet!");    // Use database API instead of direct blockchain call
    console.log(`📦 Fetching capsule #${id} from DATABASE API for reveal (not blockchain)...`);
    const response = await axios.get(`http://localhost:5000/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to fetch capsule");
    }
    const cap = response.data.capsule;
    console.log(`✅ Fetched capsule #${id} from DATABASE for reveal:`, cap);
    
    // Handle encrypted story from database API (hex string)
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      // Database returns hex string without 0x prefix
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Unknown encryptedStory format from database");
    }
    
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2),"hex").toString("utf8");

    setStatus("Sending reveal tx…");
    const tx = await contract.revealCapsule(id, plaintext);
    await tx.wait();
    setStatus("Revealed! Tx: "+tx.hash);
  }catch(e){ console.error(e); setStatus(e.message); }
}

// =============  NETWORK SWITCH FLAG  =============
// Set this flag to "testnet" or "mainnet" to switch Shutter network
const NETWORK = "testnet"; // or "mainnet"

// =============  INIT  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Initialize global storage
    window.ipfsUrls = {};
    
    // Load system information (Pinata status, etc.)
    await loadSystemInfo();
      // load configs & ABI with cache busting
    const cacheBuster = `?v=${Date.now()}`;
    const cfgAll = await (await fetch(`public_config.json${cacheBuster}`)).json();

    // Always use the default_network for contract address and provider
    const fixedNetwork = cfgAll.default_network;
    const fixedCfg = cfgAll[fixedNetwork];

    // Use the flag only for Shutter API and registry address
    const shutterCfg = cfgAll[NETWORK];

    contractAddr = fixedCfg.contract_address;
    contractAbi  = await (await fetch(`contract_abi.json${cacheBuster}`)).json();
    shutterApi   = shutterCfg.shutter_api_base;
    registryAddr = shutterCfg.registry_address;    // read-only provider (fixed)
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );

    // wallet (transactions)
    await connectWallet();

    // button wire-up
    $("createCapsule-btn").onclick = createCapsule;
    $("loadMore-btn").onclick      = loadCapsules;
    $("connectWallet-btn").onclick = async () => {
      await connectWallet(true);
    };

    try { await connectWallet(); } catch {}

    loadCapsules();
  } catch (e) { console.error(e); setStatus(e.message); }
});

// ===== expose to window for inline buttons =====
window.revealCapsule = revealCapsule;
window.decryptCapsule = decryptCapsule;
window.decryptAndDisplayImage = decryptAndDisplayImage;

/*  <script type="module" src="main.js"></script>
<script type="module" src="time_capsule.js"></script>  */
