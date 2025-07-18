/*  admin.js — Admin Panel Logic (Chinese) */
/*  Handles admin operations: preview, reveal, share, batch operations  */
/*  EXACT PORT OF WORKING GALLERY.JS LOGIC  */

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

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
    throw new Error("未提供备用fetch的URL");
  }
  
  const errors = [];
  
  for (let i = 0; i < urls.length; i++) {
    try {
      console.log(`尝试从URL ${i + 1}/${urls.length}获取: ${urls[i]}`);
      const response = await axios.get(urls[i], {
        timeout: i === 0 ? 5000 : 10000, // First URL gets shorter timeout
        ...options
      });
      console.log(`成功从以下地址获取: ${urls[i]}`);
      return response;
    } catch (error) {
      const errorMsg = error.response ? `${error.response.status} ${error.response.statusText}` : error.message;
      console.warn(`从 ${urls[i]} 获取时出错: ${errorMsg}`);
      errors.push(`URL ${i + 1}: ${errorMsg}`);
      
      if (i === urls.length - 1) {
        throw new Error(`所有 ${urls.length} 个URL都失败了:\n${errors.join('\n')}`);
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
    throw new Error("Shutter WASM未加载!");
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
    logOutput("🚀 初始化管理面板...");
    
    // Initialize global storage
    window.ipfsUrls = {};
    
    // Load system information
    try {
      const systemInfo = await axios.get(`${getApiBaseUrl()}/system_info`);
      window.systemInfo = systemInfo.data;
      logOutput("✅ 系统信息已加载");
    } catch (e) {
      console.warn("无法加载系统信息:", e);
      window.systemInfo = { pinata_enabled: false };
      logOutput("⚠️ 系统信息不可用 (可选)");
    }
    
    // Load configs & ABI
    const cfgAll = await loadPublicConfig();
    
    // Store the full config globally
    appConfig = cfgAll;
    logOutput('📋 应用配置已加载');
    
    const fixedCfg = cfgAll["network"];
    contractAddr = fixedCfg.contract_address;
    const cacheBuster = `?v=${Date.now()}`;
    contractAbi = await (await fetch(`../contract_abi.json${cacheBuster}`)).json();
    shutterApi = fixedCfg.shutter_api_base;
    registryAddr = fixedCfg.registry_address;
    
    // read-only provider
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );
    
    logOutput("📡 合约已在只读模式下初始化");
    
    // Initialize Shutter WASM
    logOutput("🔧 初始化Shutter WASM...");
    try {
      await ensureShutterReady();
      logOutput("✅ Shutter WASM就绪");
    } catch (e) {
      logOutput("⚠️ Shutter WASM尚未就绪，必要时将重试");
    }
    
    logOutput("🎯 管理面板已准备好进行操作");
    
  } catch (e) {
    console.error("初始化错误:", e);
    logOutput(`❌ 初始化错误: ${e.message}`);
  }
});

// =============  WALLET CONNECTION (EXACT COPY FROM GALLERY.JS)  =============
async function connectWallet(manual = false) {
  try {
    logOutput('🔄 连接钱包进行区块链交互...');
    
    // Load network config from public config
    const config = await loadPublicConfig();
    const networkConfig = config.network;
    
    let eth = window.ethereum;
    if (!eth) {
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc: { [networkConfig.chainId]: networkConfig.rpcUrl },
        chainId: networkConfig.chainId
      });
      await wc.enable();
      eth = wc;
    } else {
      // Request account access (this will prompt the user)
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error('钱包未返回账户');
      }
    }
    
    provider = new ethers.providers.Web3Provider(eth);
    signer = provider.getSigner();
    
    const net = await provider.getNetwork();
    if (net.chainId !== networkConfig.chainId) {
      // Try to switch to target chain
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: networkConfig.chainIdHex }],
        });
        
        // IMPORTANT: Recreate provider after network switch
        provider = new ethers.providers.Web3Provider(eth);
        signer = provider.getSigner();
        
        // Verify the switch worked
        const newNet = await provider.getNetwork();
        if (newNet.chainId !== networkConfig.chainId) {
          throw new Error(`网络切换失败。期望链ID ${networkConfig.chainId}，实际获得 ${newNet.chainId}`);    
        }
        
      } catch (switchError) {
        throw new Error(`请在您的钱包中切换到${networkConfig.chainName}（网络ID ${networkConfig.chainId}）。如果您没有此网络，请手动添加。`);
      }
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    logOutput("💰 钱包合约已初始化");
    
    walletConnected = true;
    logOutput('✅ 钱包连接成功');
    
    return true;
  } catch (e) {
    console.error("❌ 钱包连接错误:", e);
    logOutput(`❌ 钱包连接错误: ${e.message}`);
    walletConnected = false;
    return false;
  }
}

// =============  ADMIN FUNCTIONS (EXACT LOGIC FROM GALLERY.JS)  =============

// Preview Capsule Story (Off-chain decryption only)
async function previewCapsuleStory() {
  const capsuleIdInput = document.getElementById('preview-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (isNaN(capsuleId) || capsuleId < 0) {
    logOutput('❌ 请输入有效的胶囊ID');
    return;
  }
  
  try {
    logOutput(`🔓 预览胶囊 #${capsuleId} 的故事...`);
    
    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al obtener cápsula");
    }
    const cap = response.data.capsule;
    
    logOutput(`📦 Cápsula #${capsuleId} encontrada: "${cap.title}"`);
    logOutput(`🔗 Shutter Identity: ${cap.shutterIdentity}`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: cap.shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      throw new Error("解密密钥尚未可用！请等待后重试。");
    }
    
    logOutput(`🔑 已获得解密密钥`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("数据库中的encryptedStory格式未知");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    logOutput(`✅ 故事解密成功！`);
    logOutput(`📖 故事内容: "${plaintext}"`);
    
  } catch (error) {
    console.error(`Error al previsualizar cápsula #${capsuleId}:`, error);
    logOutput(`❌ 预览错误: ${error.message}`);
  }
}

// Reveal Capsule Forever (On-chain transaction)
async function revealCapsuleForever() {
  const capsuleIdInput = document.getElementById('reveal-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (isNaN(capsuleId) || capsuleId < 0) {
    logOutput('❌ 请输入有效的胶囊ID');
    return;
  }
  
  try {
    // Connect wallet on-demand when user wants to reveal
    if (!walletConnected) {
      logOutput('🔗 连接钱包以进行揭示交易...');
      const connected = await connectWallet(true);
      if (!connected) {
        logOutput('❌ 需要连接钱包才能在区块链上永久揭示胶囊。');
        return;
      }
    }
    
    logOutput(`🎉 在区块链上永久揭示胶囊 #${capsuleId}...`);
    
    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al obtener cápsula");
    }
    const cap = response.data.capsule;
    
    logOutput(`📦 Cápsula #${capsuleId} encontrada: "${cap.title}"`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: cap.shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      throw new Error("解密密钥尚未可用！");
    }
    
    logOutput(`🔑 已获得解密密钥`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("数据库中的encryptedStory格式未知");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");
    
    logOutput(`🔓 故事已解密: "${plaintext}"`);

    // Submit reveal transaction
    logOutput(`📝 发送揭示交易到区块链...`);
    const tx = await contract.revealCapsule(capsuleId, plaintext);
    logOutput(`🚀 揭示交易已发送！哈希: ${tx.hash}`);
    
    // Wait for confirmation
    logOutput(`⏳ 等待交易确认...`);
    await tx.wait();
    logOutput(`✅ 胶囊 #${capsuleId} 在区块链上成功揭示！`);
    
  } catch (error) {
    console.error(`Error al revelar cápsula #${capsuleId}:`, error);
    logOutput(`❌ 揭示错误: ${error.message}`);
  }
}

// Share Capsule on X
async function shareCapsule() {
  const capsuleIdInput = document.getElementById('share-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (isNaN(capsuleId) || capsuleId < 0) {
    logOutput('❌ 请输入有效的胶囊ID');
    return;
  }
  
  try {
    logOutput(`🐦 在X上分享胶囊 #${capsuleId}...`);
    
    // Fetch capsule data to get title and details
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al obtener cápsula");
    }
    const cap = response.data.capsule;
    
    const title = cap.title || 'Cápsula Sin Título';
    const revealTime = new Date(cap.revealTime * 1000);
    
    // Construct share URL
    const currentUrl = window.location.origin + window.location.pathname;
    const capsuleUrl = `${currentUrl.replace('/admin.html', '/gallery.html')}?capsule=${capsuleId}`;
    
    // Construct tweet text
    const tweetText = encodeURIComponent(
      `🎁 Mira mi Time Capsule: "${title}" 🎁\n\n` +
      `🗓️ 解锁时间: ${revealTime.toLocaleDateString('zh-CN', { timeZone: 'UTC' })}\n` +
      `🔗 Ver: ${capsuleUrl}\n\n` +
      `#TimeCapsule #Ethereum #Future #Memories`
    );
    
    // Open Twitter share dialog
    const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
    window.open(twitterUrl, '_blank');
    
    logOutput(`✅ 为胶囊 #${capsuleId} 打开分享对话框: "${title}"`);
    logOutput(`🔗 Enlace directo: ${capsuleUrl}`);
    
  } catch (error) {
    console.error(`分享胶囊 #${capsuleId} 时出错:`, error);
    logOutput(`❌ 分享错误: ${error.message}`);
  }
}

// Batch Preview Capsules
async function batchPreviewCapsules() {
  const batchInput = document.getElementById('batch-capsule-ids');
  const capsuleIdsText = batchInput.value.trim();
  
  if (!capsuleIdsText) {
    logOutput('❌ 请输入胶囊ID（用逗号分隔）');
    return;
  }
  
  try {
    // Parse comma-separated IDs
    const capsuleIds = capsuleIdsText.split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id) && id > 0);
    
    if (capsuleIds.length === 0) {
      logOutput('❌ No se encontraron IDs de cápsula válidos');
      return;
    }
    
    logOutput(`📦 Iniciando previsualización en lote para ${capsuleIds.length} cápsulas: ${capsuleIds.join(', ')}`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const capsuleId of capsuleIds) {
      try {
        logOutput(`\n🔄 Procesando cápsula #${capsuleId}...`);
        
        // Fetch capsule data
        const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
        if (!response.data.success) {
          throw new Error(response.data.error || "Error al obtener cápsula");
        }
        const cap = response.data.capsule;
        
        logOutput(`📦 Encontrada: "${cap.title}" (Revelación: ${new Date(cap.revealTime * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })})`);
        
        // Get decryption key
        const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
          params: { identity: cap.shutterIdentity, registry: registryAddr }
        });
        const key = resp.data?.message?.decryption_key;
        if (!key) {
          throw new Error("解密密钥尚未可用");
        }

        // Handle encrypted story
        let encryptedHex;
        if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
          encryptedHex = cap.encryptedStory;
        } else if (typeof cap.encryptedStory === "string") {
          encryptedHex = "0x" + cap.encryptedStory;
        } else {
          throw new Error("Formato de encryptedStory desconocido");
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
    
    logOutput(`\n📊 ¡Previsualización en lote completada!`);
    logOutput(`✅ Exitosas: ${successCount}`);
    logOutput(`❌ Fallidas: ${failCount}`);
    logOutput(`📝 已处理总数: ${capsuleIds.length}`);
    
  } catch (error) {
    console.error('批量预览错误:', error);
    logOutput(`❌ 批量预览错误: ${error.message}`);
  }
}

// Manual Shutter initialization (for debugging)
async function initializeShutter() {
  try {
    logOutput('🔧 Inicializando Shutter WASM manualmente...');
    await ensureShutterReady();
    logOutput('✅ ¡Shutter WASM inicializado exitosamente!');
    logOutput(`🛠️ Funciones disponibles: ${Object.keys(window.shutter || {}).join(', ')}`);
  } catch (error) {
    logOutput(`❌ Shutter初始化错误: ${error.message}`);
  }
}

// =============  EXPOSE FUNCTIONS GLOBALLY  =============
window.previewCapsuleStory = previewCapsuleStory;
window.revealCapsuleForever = revealCapsuleForever;
window.shareCapsule = shareCapsule;
window.batchPreviewCapsules = batchPreviewCapsules;
window.initializeShutter = initializeShutter;
window.connectWallet = connectWallet;
