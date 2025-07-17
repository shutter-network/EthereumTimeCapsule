/*  gallery.js — Gallery Page Logic (Spanish) */
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

// Configuration loaded from public_config.json
let appConfig = null;

// Gallery state
let currentOffset = 0;
let currentFilter = 'all'; // 'all' or specific tag name
let currentSearch = '';
const batchSize = 12;
let isLoading = false;
let hasMore = true;
let availableTags = []; // Store available tags for filtering

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
async function handleImageError(imgElement, imageCID, capsuleId) {
  console.error(`Error al cargar imagen para cápsula #${capsuleId}:`, imgElement.src);
  
  // If we're currently trying the IPFS endpoint, try multiple fallback strategies
  if (imgElement.src.includes('/ipfs/')) {
    console.log(`Probando estrategias de respaldo para cápsula #${capsuleId}`);
    
    // Strategy 1: Try pixelated endpoint with same CID
    const timestamp = Date.now();
    const pixelatedUrl = `${getApiBaseUrl()}/pixelated/${imageCID}?t=${timestamp}`;
    
    try {
      // Test if the pixelated endpoint exists before setting it
      const testResponse = await fetch(pixelatedUrl, { method: 'HEAD' });
      if (testResponse.ok) {
        console.log(`Usando endpoint pixelado para cápsula #${capsuleId}`);
        imgElement.src = pixelatedUrl;
        imgElement.onerror = () => tryAlternateCID(imgElement, capsuleId);
        return;
      }
    } catch (e) {
      console.log(`Prueba de endpoint pixelado falló para cápsula #${capsuleId}:`, e.message);
    }
    
    // Strategy 2: Try to get fresh capsule data and use correct CID
    tryAlternateCID(imgElement, capsuleId);
  } else {
    // All strategies failed, hide the image
    console.error(`Todas las fuentes de imagen fallaron para cápsula #${capsuleId}`);
    imgElement.style.display = 'none';
  }
}

// Helper: Try to get correct CID from direct capsule API
async function tryAlternateCID(imgElement, capsuleId) {
  try {
    console.log(`Obteniendo datos frescos de cápsula para #${capsuleId} para obtener CID correcto`);
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    
    if (response.data.success && response.data.capsule) {
      const capsule = response.data.capsule;
      const correctPixelatedCID = (capsule.pixelatedImageCID && capsule.pixelatedImageCID.trim()) || capsule.imageCID;
      
      if (correctPixelatedCID && correctPixelatedCID !== imgElement.getAttribute('data-current-cid')) {
        console.log(`Probando CID correcto para cápsula #${capsuleId}: ${correctPixelatedCID}`);
        imgElement.setAttribute('data-current-cid', correctPixelatedCID);
        
        const timestamp = Date.now();
        const newUrl = `${getApiBaseUrl()}/ipfs/${correctPixelatedCID}?t=${timestamp}`;
        imgElement.src = newUrl;
        
        imgElement.onerror = function() {
          console.log(`Probando endpoint pixelado con CID correcto para cápsula #${capsuleId}`);
          this.src = `${getApiBaseUrl()}/pixelated/${correctPixelatedCID}?t=${timestamp}`;
          this.onerror = function() {
            console.error(`Todos los respaldos fallaron para cápsula #${capsuleId}`);
            this.style.display = 'none';
          };
        };
        return;
      }
    }
  } catch (e) {
    console.error(`Error al obtener datos frescos de cápsula para #${capsuleId}:`, e);
  }
  
  // Final fallback: hide the image
  console.error(`Todas las estrategias de carga de imagen fallaron para cápsula #${capsuleId}`);
  imgElement.style.display = 'none';
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

// =============  INITIALIZATION  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {    // Initialize global storage
    window.ipfsUrls = {};
      // Load system information
    try {
      const systemInfo = await axios.get(`${getApiBaseUrl()}/system_info`);
      window.systemInfo = systemInfo.data;
      console.log("Información del sistema cargada:", window.systemInfo);
    } catch (e) {
      console.warn("No se pudo cargar información del sistema:", e);
      window.systemInfo = { pinata_enabled: false };
    }
    
    // Load configs & ABI
    const cfgAll = await loadPublicConfig();
    
    // Store the full config globally
    appConfig = cfgAll;
    console.log('📋 Configuración de la aplicación cargada:', appConfig);
    
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
      // Gallery is read-only by default, wallet connects on-demand for reveal actions
    console.log("Galería inicializada en modo solo lectura (wallet se conecta bajo demanda)");
    
    // Setup event listeners
    setupEventListeners();
      // Initialize Shutter WASM
    console.log("Inicializando Shutter WASM...");
    try {
      await ensureShutterReady();
      console.log("✅ Shutter WASM listo");
    } catch (e) {
      console.warn("⚠️ Shutter WASM no está listo aún, reintentará cuando sea necesario:", e.message);
    }
    
    // Check if we have a direct capsule link
    const urlParams = new URLSearchParams(window.location.search);
    const capsuleId = urlParams.get('capsule');
    
    if (capsuleId) {
      console.log(`🎯 Enlace directo a cápsula detectado: ${capsuleId}`);
      await loadDirectCapsule(capsuleId);    } else {
      console.log('📚 Cargando todas las cápsulas');
      // Load initial capsules
      loadCapsules();
    }
    
    // Load tags from config for filtering
    await loadTagsFromConfig();
    
  } catch (e) {
    console.error("Error en la inicialización:", e);
    document.getElementById('load-status').textContent = 'Error al inicializar la galería';
  }
});

// =============  WALLET CONNECTION  =============
async function connectWallet(manual = false) {
  const config = await loadPublicConfig();
  try {
    console.log('🔄 Conectando wallet para interacción blockchain...');
    
    let eth = window.ethereum;
    if (!eth) {
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc: { [config.network.chainId]: config.network.rpcUrl },
        chainId: config.network.chainId
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
    if (net.chainId !== config.network.chainId) {
      // Try to switch to target chain
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: config.network.chainIdHex }],
        });
        
        // IMPORTANT: Recreate provider after network switch
        provider = new ethers.providers.Web3Provider(eth);
        signer = provider.getSigner();
        
        // Verify the switch worked
        const newNet = await provider.getNetwork();
        if (newNet.chainId !== config.network.chainId) {
          throw new Error(`Cambio de red falló. Se esperaba chain ID ${config.network.chainId}, se obtuvo ${newNet.chainId}`);
        }
        
      } catch (switchError) {
        throw new Error(`Por favor cambie a ${config.network.chainName} (network ID ${config.network.chainId}) en su wallet. Si no tiene esta red, agreguela manualmente.`);
      }
    }
    
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    console.log("💰 Contrato de wallet inicializado con dirección:", contractAddr);
    
    walletConnected = true;
    console.log('✅ Wallet conectado exitosamente');
    
    return true;
  } catch (e) {
    console.error("❌ Error en la conexión del wallet:", e);
    walletConnected = false;
    return false;
  }
}

// =============  EVENT LISTENERS  =============
function setupEventListeners() {
  // Filter buttons
  document.getElementById('filter-all').onclick = () => setFilter('all');
  
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
async function loadTagsFromConfig() {
  try {
    console.log('🏷️ Cargando etiquetas desde configuración...');
    
    if (!appConfig || !appConfig.tag_sections) {
      console.warn('No hay tag_sections en la configuración');
      return;
    }
    
    // Extract all tags from all sections (flatten the sections)
    const allTags = [];
    appConfig.tag_sections.forEach(section => {
      section.tags.forEach(tagObj => {
        allTags.push(tagObj.name);
      });
    });
    
    // Use tags from config instead of extracting from capsules
    availableTags = allTags.map(tag => ({ 
      name: tag, 
      count: 0 // We'll show count as 0 or remove it since we're not extracting
    }));
    
    console.log('✅ Etiquetas cargadas desde configuración:', availableTags);
    
    // Render tag filter buttons
    renderTagFilters();
    
  } catch (error) {
    console.error('Error al cargar etiquetas desde configuración:', error);
  }
}

function renderTagFilters() {
  const tagFiltersContainer = document.getElementById('tag-filters');
  if (!tagFiltersContainer) return;
  
  tagFiltersContainer.innerHTML = '';
  
  // Create emoji mapping for tags from config
  const tagEmojiMap = {};
  if (appConfig && appConfig.tag_sections) {
    appConfig.tag_sections.forEach(section => {
      section.tags.forEach(tagObj => {
        tagEmojiMap[tagObj.name] = tagObj.emoji;
      });
    });
  }
  
  availableTags.forEach(({ name }) => {
    const tagButton = document.createElement('button');
    tagButton.className = 'btn-tag-filter';
    
    const emoji = tagEmojiMap[name];
    if (emoji) {
      tagButton.innerHTML = `${emoji} #${name}`;
    } else {
      tagButton.innerHTML = `#${name}`;
    }
    tagButton.onclick = () => setFilter(name);
    tagFiltersContainer.appendChild(tagButton);
  });
}

function setFilter(filter) {
  currentFilter = filter;
  currentOffset = 0;
  hasMore = true;
  
  // Update button states
  document.querySelectorAll('.filter-controls button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.btn-tag-filter').forEach(btn => {
    btn.classList.remove('active');
  });
  
  if (filter === 'all') {
    document.getElementById('filter-all').classList.add('active');
  } else {
    // Find and activate the corresponding tag button
    const tagButtons = document.querySelectorAll('.btn-tag-filter');
    tagButtons.forEach(btn => {
      if (btn.textContent.toLowerCase().includes(`#${filter.toLowerCase()}`)) {
        btn.classList.add('active');
      }
    });
  }
  
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
    loadStatus.textContent = 'Cargando cápsulas desde base de datos...';
    
    let url, params;
      if (currentSearch) {
      // Search mode
      url = `${getApiBaseUrl()}/api/capsules/search`;
      params = {
        q: currentSearch,
        limit: batchSize
      };    } else {
      // Normal load mode
      url = `${getApiBaseUrl()}/api/capsules`;
      params = {
        offset: currentOffset,
        limit: batchSize
      };
      
      // Add tag filtering if not 'all'
      if (currentFilter !== 'all') {
        params.tag = currentFilter;
      }
    }
    
    console.log(`📦 Cargando cápsulas: ${JSON.stringify(params)}`);
    const response = await axios.get(url, { params });
    
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al cargar cápsulas");
    }
    
    const capsules = response.data.capsules;
    const totalCount = response.data.total_count || capsules.length;
      console.log(`✅ Cargadas ${capsules.length} cápsulas`);
    
    // Filter capsules based on current filter (for search results)
    let filteredCapsules = capsules;
    if (currentSearch && currentFilter !== 'all') {
      filteredCapsules = capsules.filter(capsule => {
        if (!capsule.tags) return false;
        const tags = capsule.tags.split(',').map(tag => tag.trim().toLowerCase());
        return tags.includes(currentFilter.toLowerCase());
      });
    }
    
    // Render capsules
    await renderCapsules(filteredCapsules);
    
    // Update pagination
    if (!currentSearch) {
      currentOffset += batchSize;
      hasMore = currentOffset < totalCount;
    } else {
      hasMore = false; // Search shows all results at once
    }
    
    // Update load status - count what we actually loaded, not DOM children
    const grid = document.getElementById('capsules-grid');
    const previousCount = grid.children.length - filteredCapsules.length;
    const totalDisplayed = previousCount + filteredCapsules.length;

    loadStatus.textContent = `Mostrando ${totalDisplayed} de ${totalCount} cápsulas`;

    // Update load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (hasMore) {
      loadMoreBtn.textContent = 'Cargar Más Cápsulas';
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn.textContent = 'No Hay Más Cápsulas';
      loadMoreBtn.disabled = true;
    }
    
  } catch (error) {
    console.error('Error al cargar cápsulas:', error);
    loadStatus.textContent = 'Error al cargar cápsulas: ' + error.message;
  } finally {
    isLoading = false;
    loadingIndicator.style.display = 'none';
  }
}

function loadMoreCapsules() {
  loadCapsules();
}

// =============  RENDER CAPSULES  =============
async function renderCapsules(capsules) {
  const grid = document.getElementById('capsules-grid');

  // Create all cards in parallel but maintain order when appending
  const cardPromises = capsules.map(capsule => createCapsuleCard(capsule));
  const cards = await Promise.all(cardPromises);

  // Append cards in the correct order
  cards.forEach(card => {
    grid.appendChild(card);
  });
}

async function createCapsuleCard(capsule) {
  const card = document.createElement('div');
  card.className = 'capsule-card-gallery';
  card.setAttribute('data-capsule-id', capsule.id); // Add unique identifier
  
  // Debug logging for CID inconsistencies
  console.log(`Creando tarjeta para cápsula #${capsule.id}:`);
  console.log(`- imageCID: ${capsule.imageCID}`);
  console.log(`- pixelatedImageCID: ${capsule.pixelatedImageCID}`);
  console.log(`- pixelatedImageCID (recortado): ${capsule.pixelatedImageCID && capsule.pixelatedImageCID.trim()}`);

  const config = await loadPublicConfig();
  const ensProvider = new ethers.providers.JsonRpcProvider(config.network.rpcUrl);
  
  const isRevealed = capsule.isRevealed;
  const revealTime = new Date(capsule.revealTime * 1000);
  let creator;
  try {
    const ensName = await ensProvider.lookupAddress(capsule.creator);
    if (ensName !== null) {
      creator = ensName;
    }
  } catch (e) {
    console.error("error al buscar nombre ENS", e);
  }
  if (!creator) {
    creator = `${capsule.creator.slice(0, 6)}...${capsule.creator.slice(-4)}`;
  }
  
  // Process tags into clickable chips using the exact same format as preview card
  // Only include tags that are defined in public_config.json
  const allTags = capsule.tags ? capsule.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
  const validTagNames = availableTags.map(tag => tag.name.toLowerCase());
  const tags = allTags.filter(tag => validTagNames.includes(tag.toLowerCase()));
  
  // Determine the image source and CID to use
  let imageSrc;
  let pixelatedCID; // Declare this outside the if/else block
  
  if (isRevealed) {
    imageSrc = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkRlc2NpZnJhbmRvLi4uPC90ZXh0Pjwvc3ZnPg=="; // Placeholder for decrypted image
    pixelatedCID = capsule.imageCID; // Use encrypted image CID for error fallback
  } else {
    // Add timestamp to prevent caching issues
    const timestamp = Date.now();
    // Use pixelated image CID if available, otherwise fall back to encrypted image CID
    // Handle empty strings properly (not just null/undefined)
    pixelatedCID = (capsule.pixelatedImageCID && capsule.pixelatedImageCID.trim()) || capsule.imageCID;
    
    // Try IPFS endpoint first (for new pixelated images uploaded to IPFS)
    // If that fails, fall back to legacy pixelated endpoint
    imageSrc = `${getApiBaseUrl()}/ipfs/${pixelatedCID}?t=${timestamp}`;
    console.log(`Estableciendo src de imagen pixelada para cápsula #${capsule.id}: ${imageSrc} (IPFS, CID: ${pixelatedCID})`);
  }

  // Format unlock date exactly like in preview
  const unlockDate = revealTime;
  const formatOptions = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'UTC',
    locale: 'es-ES'
  };
  const formattedDate = unlockDate.toLocaleString('es-ES', formatOptions);

  // Use exact same structure as preview card
  card.innerHTML = `
    <div class="preview-image-container">
      <img src="${imageSrc}" alt="Imagen de cápsula" class="preview-image${isRevealed ? '' : ' pixelated'}" loading="lazy" 
           data-current-cid="${pixelatedCID}" data-capsule-id="${capsule.id}"
           onerror="handleImageError(this, '${pixelatedCID}', ${capsule.id})">
      <div class="issuer-tag">emitido por <span>${creator}</span></div>
    </div>
    
    <div class="preview-content">
      <h2 class="preview-title">${capsule.title || 'Cápsula Sin Título'}</h2>
      
      <div class="preview-meta">
        <div class="meta-item">
          <div class="meta-icon">${isRevealed ? '🔓' : '🔒'}</div>
          <div class="meta-text">
            <div class="meta-label">${isRevealed ? 'desbloqueado el' : 'cifrado hasta'}</div>
            <div class="meta-value">${formattedDate}</div>
          </div>
        </div>
        <div class="meta-item">
          <div class="meta-icon">📄</div>
          <div class="meta-text">
            <div class="meta-label">${isRevealed ? 'historia' : 'bloqueado'}</div>
            <div class="meta-value" style="cursor: pointer; color: #4F46E5;" onclick="toggleStory(${capsule.id})">${isRevealed ? 'leer historia' : 'cifrado'}</div>
          </div>
        </div>
      </div>
      
      <div class="preview-tags">
        ${tags.map(tag => `<span class="tag" onclick="filterByTag('${tag.toLowerCase()}')">#${tag}</span>`).join('')}
      </div>
      
      ${isRevealed && capsule.decryptedStory ? 
        `<div id="story-${capsule.id}" style="margin-top: 16px; font-size: 14px; line-height: 1.4; color: #333; display: none;">
          ${capsule.decryptedStory}
        </div>` : 
        `<div id="story-${capsule.id}" style="margin-top: 16px; font-size: 14px; line-height: 1.4; color: #999; font-style: italic; display: none;">
          🔒 La historia se revelará el ${formattedDate}
        </div>`
      }
    </div>
  `;
  
  // If revealed, start image decryption
  if (isRevealed) {
    setTimeout(() => {
      decryptAndDisplayImage(capsule.id, capsule.imageCID, capsule.shutterIdentity);
    }, 100);
  }
  
  // Add click handler to make entire card clickable (but prevent clicks on interactive elements)
  card.addEventListener('click', (e) => {
    // Don't navigate if clicking on interactive elements
    if (e.target.closest('.meta-value[onclick]') || e.target.closest('.tag[onclick]')) {
      return;
    }
    
    // Navigate to individual capsule view
    window.location.href = `/spanish/gallery.html?capsule=${capsule.id}`;
  });
  
  // Add cursor pointer to indicate clickability
  card.style.cursor = 'pointer';
  
  return card;
}

// =============  CAPSULE INTERACTIONS  =============
async function decryptCapsule(id, shutterIdentity) {
  try {
    console.log(`🔓 Descifrando cápsula #${id}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      alert("¡Clave de descifrado aún no disponible! Por favor espere e intente de nuevo.");
      return;
    }

    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al obtener cápsula");
    }
    const cap = response.data.capsule;

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

    // Update the story display
    const storyElement = document.getElementById(`story-${id}`);
    if (storyElement) {
      storyElement.innerHTML = `<div>${plaintext}</div>`;
      storyElement.classList.add('expanded');
    }
    
    console.log(`✅ Cápsula #${id} descifrada exitosamente`);
    
  } catch (error) {
    console.error(`Error al descifrar cápsula #${id}:`, error);
    alert("Error en el descifrado: " + error.message);
  }
}

async function revealCapsule(id, shutterIdentity) {
  try {
    // Connect wallet on-demand when user wants to reveal
    if (!walletConnected) {
      console.log('🔗 Conectando wallet para acción de revelación...');
      const connected = await connectWallet(true);
      if (!connected) {
        alert('Se requiere conexión de wallet para revelar cápsulas permanentemente en la blockchain.');
        return;
      }
    }
    
    console.log(`🎉 Revelando cápsula #${id}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      alert("¡Clave de descifrado aún no disponible!");
      return;
    }

    // Fetch capsule data from database API
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Error al obtener cápsula");
    }
    const cap = response.data.capsule;

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

    const plaintextHex = await window.shutter.decrypt(encryptedHex, key);
    const plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");

    // Submit reveal transaction
    const tx = await contract.revealCapsule(id, plaintext);
    alert(`¡Transacción de revelación enviada! Hash: ${tx.hash}`);
    
    // Wait for confirmation and refresh
    await tx.wait();
    alert('¡Cápsula revelada exitosamente!');
    
    // Refresh the page to show updated state
    window.location.reload();
    
  } catch (error) {
    console.error(`Error al revelar cápsula #${id}:`, error);
    alert("Error en la revelación: " + error.message);
  }
}

function toggleStory(id) {
  const storyElement = document.getElementById(`story-${id}`);
  if (storyElement) {
    if (storyElement.style.display === 'none') {
      storyElement.style.display = 'block';
    } else {
      storyElement.style.display = 'none';
    }
  }
}

async function decryptAndDisplayImage(capsuleId, imageCID, shutterIdentity) {
  try {
    console.log(`🖼️ Descifrando imagen para cápsula ${capsuleId}...`);
    
    // Get decryption key
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      console.log("Clave de descifrado no disponible para imagen");
      return;
    }

    // Fetch encrypted image from IPFS with redundancy
    const ipfsUrls = getIPFSUrls(imageCID);
    
    console.log(`Obteniendo imagen cifrada desde IPFS, probando ${ipfsUrls.length} URLs...`);
    const encryptedImageResp = await fetchWithFallback(ipfsUrls, {
      responseType: 'arraybuffer'
    });

    const encryptedImageHex = "0x" + Array.from(new Uint8Array(encryptedImageResp.data))
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
    const imageUrl = URL.createObjectURL(imageBlob);

    // Find and update the image using data attribute for precise matching
    console.log(`Buscando tarjeta de cápsula con ID #${capsuleId}...`);
    const targetCard = document.querySelector(`[data-capsule-id="${capsuleId}"]`);
    
    if (targetCard) {
      console.log(`¡Encontrada tarjeta exacta para cápsula #${capsuleId}!`);
      const img = targetCard.querySelector('.preview-image');
      if (img) {
        // Clean up previous object URL to prevent memory leaks
        if (img.src.startsWith('blob:')) {
          URL.revokeObjectURL(img.src);
        }
        img.src = imageUrl;
        img.alt = "Imagen descifrada";
        // Remove pixelated class from decrypted images
        img.classList.remove('pixelated');
        console.log(`✅ Imagen descifrada y mostrada exitosamente para cápsula #${capsuleId}`);
      } else {
        console.warn(`Elemento de imagen no encontrado en tarjeta para cápsula #${capsuleId}`);
      }
    } else {
      console.warn(`No se encontró tarjeta para cápsula ID #${capsuleId}`);
      // Fallback to the old method if data attribute fails
      const capsuleCards = document.querySelectorAll('.capsule-card-gallery');
      for (const card of capsuleCards) {
        const titleElement = card.querySelector('.preview-title');
        if (titleElement && card.getAttribute('data-capsule-id') === capsuleId.toString()) {
          const img = card.querySelector('.preview-image');
          if (img) {
            if (img.src.startsWith('blob:')) {
              URL.revokeObjectURL(img.src);
            }
            img.src = imageUrl;
            img.alt = "Imagen descifrada";
            // Remove pixelated class from decrypted images
            img.classList.remove('pixelated');
            console.log(`✅ Imagen descifrada y mostrada exitosamente para cápsula #${capsuleId} (método de respaldo)`);
          }
          break;
        }
      }
    }
  } catch (e) {
    console.error(`Error al descifrar imagen para cápsula ${capsuleId}:`, e);
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
    throw new Error("¡Shutter WASM no cargado!");
  }
}

// Expose functions globally for HTML onclick handlers
window.connectWallet = connectWallet;
window.decryptCapsule = decryptCapsule;
window.revealCapsule = revealCapsule;
window.toggleStory = toggleStory;
window.decryptAndDisplayImage = decryptAndDisplayImage;
window.handleImageError = handleImageError;
window.tryAlternateCID = tryAlternateCID;
window.filterByTag = function(tagName) {
  console.log(`🏷️ Filtrando por etiqueta: ${tagName}`);
  setFilter(tagName);
};

// Function to load a specific capsule directly
async function loadDirectCapsule(capsuleId) {
  try {
    console.log(`🔍 Cargando cápsula ${capsuleId} directamente...`);
    
    // Fetch the specific capsule from the backend
    const response = await axios.get(`${getApiBaseUrl()}/api/capsules/${capsuleId}`);
    
    if (!response.data.success || !response.data.capsule) {
      console.error('❌ Cápsula no encontrada');
      // Fall back to loading all capsules
      await loadCapsules();
      return;
    }
    
    const capsule = response.data.capsule;
    console.log('✅ Cápsula directa cargada:', capsule);
    
    // Clear the gallery and display only this capsule
    const gallery = document.getElementById('capsules-grid');
    if (gallery) {
      gallery.innerHTML = '';
      await displayCapsule(capsule);
      
      // Update page title to reflect the specific capsule
      document.title = `Time Capsule: ${capsule.title} - Ethereum Time Capsule`;
      
      // Update load status
      const loadStatus = document.getElementById('load-status');
      if (loadStatus) {
        loadStatus.textContent = `Mostrando cápsula específica #${capsule.id}`;
      }
      
      // Hide load more button since we're only showing one capsule
      const loadMoreBtn = document.getElementById('load-more-btn');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
      }
    }
    
  } catch (error) {
    console.error('❌ Error al cargar cápsula directa:', error);
    // Fall back to loading all capsules
    await loadCapsules();
  }
}

// Helper function to display a single capsule (extracted from existing code)
async function displayCapsule(capsule) {
  const gallery = document.getElementById('capsules-grid');
  if (!gallery) return;
  
  // Create capsule card using the existing capsule rendering logic
  const capsuleCard = await createCapsuleCard(capsule);
  gallery.appendChild(capsuleCard);
}
