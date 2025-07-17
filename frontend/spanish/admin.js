/*  admin.js — Admin Panel Logic (Spanish) */
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
    throw new Error("No se proporcionaron URLs para fetch de respaldo");
  }
  
  const errors = [];
  
  for (let i = 0; i < urls.length; i++) {
    try {
      console.log(`Intentando obtener desde URL ${i + 1}/${urls.length}: ${urls[i]}`);
      const response = await axios.get(urls[i], {
        timeout: i === 0 ? 5000 : 10000, // First URL gets shorter timeout
        ...options
      });
      console.log(`Obtenido exitosamente desde: ${urls[i]}`);
      return response;
    } catch (error) {
      const errorMsg = error.response ? `${error.response.status} ${error.response.statusText}` : error.message;
      console.warn(`Error al obtener desde ${urls[i]}: ${errorMsg}`);
      errors.push(`URL ${i + 1}: ${errorMsg}`);
      
      if (i === urls.length - 1) {
        throw new Error(`Todas las ${urls.length} URLs fallaron:\n${errors.join('\n')}`);
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
    throw new Error("¡Shutter WASM no cargado!");
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
    logOutput("🚀 Inicializando panel de administración...");
    
    // Initialize global storage
    window.ipfsUrls = {};
    
    // Load system information
    try {
      const systemInfo = await axios.get(`${getApiBaseUrl()}/system_info`);
      window.systemInfo = systemInfo.data;
      logOutput("✅ Información del sistema cargada");
    } catch (e) {
      console.warn("No se pudo cargar información del sistema:", e);
      window.systemInfo = { pinata_enabled: false };
      logOutput("⚠️ Información del sistema no disponible (opcional)");
    }
    
    // Load configs & ABI
    const cfgAll = await loadPublicConfig();
    
    // Store the full config globally
    appConfig = cfgAll;
    logOutput('📋 Configuración de la aplicación cargada');
    
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
    
    logOutput("📡 Contrato inicializado en modo solo lectura");
    
    // Initialize Shutter WASM
    logOutput("🔧 Inicializando Shutter WASM...");
    try {
      await ensureShutterReady();
      logOutput("✅ Shutter WASM listo");
    } catch (e) {
      logOutput("⚠️ Shutter WASM no está listo aún, reintentará cuando sea necesario");
    }
    
    logOutput("🎯 Panel de administración listo para operaciones");
    
  } catch (e) {
    console.error("Error en la inicialización:", e);
    logOutput(`❌ Error en la inicialización: ${e.message}`);
  }
});

// =============  WALLET CONNECTION (EXACT COPY FROM GALLERY.JS)  =============
async function connectWallet(manual = false) {
  try {
    logOutput('🔄 Conectando wallet para interacción blockchain...');
    
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
        throw new Error('No se devolvieron cuentas desde el wallet');
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
          throw new Error(`Cambio de red falló. Se esperaba chain ID ${networkConfig.chainId}, se obtuvo ${newNet.chainId}`);
        }
        
      } catch (switchError) {
        throw new Error(`Por favor cambie a ${networkConfig.chainName} (network ID ${networkConfig.chainId}) en su wallet. Si no tiene esta red, agreguela manualmente.`);
      }
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    logOutput("💰 Contrato de wallet inicializado");
    
    walletConnected = true;
    logOutput('✅ Wallet conectado exitosamente');
    
    return true;
  } catch (e) {
    console.error("❌ Error en la conexión del wallet:", e);
    logOutput(`❌ Error en la conexión del wallet: ${e.message}`);
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
    logOutput('❌ Por favor ingrese un ID de cápsula válido');
    return;
  }
  
  try {
    logOutput(`🔓 Previsualizando historia para cápsula #${capsuleId}...`);
    
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
      throw new Error("¡Clave de descifrado aún no disponible! Por favor espere e intente de nuevo.");
    }
    
    logOutput(`🔑 Clave de descifrado obtenida`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Formato de encryptedStory desconocido desde base de datos");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    logOutput(`✅ ¡Historia descifrada exitosamente!`);
    logOutput(`📖 Contenido de la historia: "${plaintext}"`);
    
  } catch (error) {
    console.error(`Error al previsualizar cápsula #${capsuleId}:`, error);
    logOutput(`❌ Error en la previsualización: ${error.message}`);
  }
}

// Reveal Capsule Forever (On-chain transaction)
async function revealCapsuleForever() {
  const capsuleIdInput = document.getElementById('reveal-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (isNaN(capsuleId) || capsuleId < 0) {
    logOutput('❌ Por favor ingrese un ID de cápsula válido');
    return;
  }
  
  try {
    // Connect wallet on-demand when user wants to reveal
    if (!walletConnected) {
      logOutput('🔗 Conectando wallet para transacción de revelación...');
      const connected = await connectWallet(true);
      if (!connected) {
        logOutput('❌ Se requiere conexión de wallet para revelar cápsulas permanentemente en la blockchain.');
        return;
      }
    }
    
    logOutput(`🎉 Revelando cápsula #${capsuleId} para siempre en blockchain...`);
    
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
      throw new Error("¡Clave de descifrado aún no disponible!");
    }
    
    logOutput(`🔑 Clave de descifrado obtenida`);

    // Handle encrypted story from database API
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (typeof cap.encryptedStory === "string") {
      encryptedHex = "0x" + cap.encryptedStory;
    } else {
      throw new Error("Formato de encryptedStory desconocido desde base de datos");
    }

    // Ensure Shutter WASM is ready before decryption
    await ensureShutterReady();

    // Decrypt the story
    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");
    
    logOutput(`🔓 Historia descifrada: "${plaintext}"`);

    // Submit reveal transaction
    logOutput(`📝 Enviando transacción de revelación a blockchain...`);
    const tx = await contract.revealCapsule(capsuleId, plaintext);
    logOutput(`🚀 ¡Transacción de revelación enviada! Hash: ${tx.hash}`);
    
    // Wait for confirmation
    logOutput(`⏳ Esperando confirmación de transacción...`);
    await tx.wait();
    logOutput(`✅ ¡Cápsula #${capsuleId} revelada exitosamente en blockchain!`);
    
  } catch (error) {
    console.error(`Error al revelar cápsula #${capsuleId}:`, error);
    logOutput(`❌ Error en la revelación: ${error.message}`);
  }
}

// Share Capsule on X
async function shareCapsule() {
  const capsuleIdInput = document.getElementById('share-capsule-id');
  const capsuleId = parseInt(capsuleIdInput.value);
  
  if (isNaN(capsuleId) || capsuleId < 0) {
    logOutput('❌ Por favor ingrese un ID de cápsula válido');
    return;
  }
  
  try {
    logOutput(`🐦 Compartiendo cápsula #${capsuleId} en X...`);
    
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
      `🗓️ Se desbloquea: ${revealTime.toLocaleDateString('es-ES', { timeZone: 'UTC' })}\n` +
      `🔗 Ver: ${capsuleUrl}\n\n` +
      `#TimeCapsule #Ethereum #Future #Memories`
    );
    
    // Open Twitter share dialog
    const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
    window.open(twitterUrl, '_blank');
    
    logOutput(`✅ Diálogo de compartir abierto para cápsula #${capsuleId}: "${title}"`);
    logOutput(`🔗 Enlace directo: ${capsuleUrl}`);
    
  } catch (error) {
    console.error(`Error al compartir cápsula #${capsuleId}:`, error);
    logOutput(`❌ Error al compartir: ${error.message}`);
  }
}

// Batch Preview Capsules
async function batchPreviewCapsules() {
  const batchInput = document.getElementById('batch-capsule-ids');
  const capsuleIdsText = batchInput.value.trim();
  
  if (!capsuleIdsText) {
    logOutput('❌ Por favor ingrese IDs de cápsula (separados por coma)');
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
          throw new Error("Clave de descifrado aún no disponible");
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
    logOutput(`📝 Total procesadas: ${capsuleIds.length}`);
    
  } catch (error) {
    console.error('Error en previsualización en lote:', error);
    logOutput(`❌ Error en previsualización en lote: ${error.message}`);
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
    logOutput(`❌ Error en inicialización de Shutter: ${error.message}`);
  }
}

// =============  EXPOSE FUNCTIONS GLOBALLY  =============
window.previewCapsuleStory = previewCapsuleStory;
window.revealCapsuleForever = revealCapsuleForever;
window.shareCapsule = shareCapsule;
window.batchPreviewCapsules = batchPreviewCapsules;
window.initializeShutter = initializeShutter;
window.connectWallet = connectWallet;
