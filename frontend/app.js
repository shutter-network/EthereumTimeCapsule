/*  app.js — Main Application Router  */
/*  Handles navigation between different steps of capsule creation  */

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

// =============  CONFIGURATION  =============
// Reveal time configuration - change this for testing vs production
const REVEAL_TIME_CONFIG = {
  // For testing: 2 minutes from now
  testing: 2 * 60, // 2 minutes in seconds
  
  // For production: 1 year from now
  production: 365 * 24 * 60 * 60, // 1 year in seconds
  
  // Current mode - change this to switch between testing and production
  current: 'testing' // Change to 'production' for live deployment
};

// =============  HELPER FUNCTIONS  =============
// Helper: get API base URL (production vs development)
function getApiBaseUrl() {
  return window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
}

// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let walletConnected = false;

// EIP-6963 wallet providers storage
let availableWallets = new Map();
let selectedWallet = null;

// Application state for capsule creation flow
let capsuleData = {
  title: '',
  tags: '',
  story: '',
  image: null,
  userName: '',
  encryptionData: null,
  txHash: null,
  capsuleId: null
};

// Current step in the flow
let currentStep = 1;
let encryptionInProgress = false;
let encryptionComplete = false;

// =============  NAVIGATION  =============
function showStep(step) {
  // Hide all step containers
  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.remove('active');
  });
  
  // Show current step
  const stepElement = document.getElementById(`step-${step}`);
  if (stepElement) {
    stepElement.classList.add('active');
    currentStep = step;
    
    // Update progress indicator
    updateProgressIndicator(step);
    
    // Update step title for steps 2-4
    updateStepTitle(step);
    
    // Handle step 3 special logic
    if (step === 3) {
      handleStep3();
    }
  }
}

function updateProgressIndicator(step) {
  document.querySelectorAll('.progress-step').forEach((el, index) => {
    const stepNumber = index + 1;
    if (stepNumber < step) {
      el.classList.add('completed');
      el.classList.remove('active');
    } else if (stepNumber === step) {
      el.classList.add('active');
      el.classList.remove('completed');
    } else {
      el.classList.remove('active', 'completed');
    }
  });
}

function updateStepTitle(step) {
  // Update the main progress section title for steps 2-4
  const progressSection = document.querySelector('.progress-section .step-title');
  if (progressSection && step > 1) {
    const stepTexts = {
      2: { number: 'Step 2', description: 'Preview Your Entry' },
      3: { number: 'Step 3', description: 'Submit to Blockchain' },
      4: { number: 'Step 4', description: 'Complete!' }
    };
    
    if (stepTexts[step]) {
      const numberText = progressSection.querySelector('.step-number-text');
      const descText = progressSection.querySelector('.step-description');
      if (numberText) numberText.textContent = stepTexts[step].number;
      if (descText) descText.textContent = stepTexts[step].description;
    }
  }
}

function nextStep() {
  if (currentStep < 4) {
    showStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 1) {
    showStep(currentStep - 1);
  }
}

function goToStep(step) {
  showStep(step);
}

// =============  WALLET CONNECTION  =============
// EIP-6963 Multi-Wallet Discovery
function initWalletDiscovery() {
  // Listen for wallet announcements
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = event.detail;
    console.log('� Discovered wallet:', info.name, info.rdns);
    
    availableWallets.set(info.rdns, {
      info,
      provider
    });
  });

  // Request wallets to announce themselves
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function showWalletSelection() {
  // Clear previous wallet list
  const walletList = document.getElementById('walletList');
  if (!walletList) return;
  
  walletList.innerHTML = '';
  
  // Add discovered EIP-6963 wallets
  for (const [rdns, wallet] of availableWallets) {
    const walletButton = createWalletButton(wallet.info, wallet.provider);
    walletList.appendChild(walletButton);
  }
  
  // Add legacy window.ethereum support (fallback)
  if (window.ethereum && availableWallets.size === 0) {
    const legacyButton = createLegacyWalletButton();
    walletList.appendChild(legacyButton);
  }
  
  // Show wallet selection modal
  document.getElementById('walletModal').style.display = 'flex';
}

function createWalletButton(info, provider) {
  const button = document.createElement('div');
  button.className = 'wallet-option';
  button.onclick = () => connectToWallet(provider, info);
  
  button.innerHTML = `
    <img src="${info.icon}" alt="${info.name}" class="wallet-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
    <div class="wallet-icon-fallback" style="display:none;">🔗</div>
    <span class="wallet-name">${info.name}</span>
  `;
  
  return button;
}

function createLegacyWalletButton() {
  const button = document.createElement('div');
  button.className = 'wallet-option';
  button.onclick = () => connectLegacyWallet();
  
  button.innerHTML = `
    <div class="wallet-icon">🦊</div>
    <span class="wallet-name">Browser Wallet</span>
  `;
  
  return button;
}

async function connectToWallet(walletProvider, walletInfo) {
  try {
    console.log('🔄 Connecting to wallet:', walletInfo.name);
    
    // Hide wallet selection modal
    const modal = document.getElementById('walletModal');
    if (modal) modal.style.display = 'none';
    
    // Request account access
    const accounts = await walletProvider.request({ 
      method: 'eth_requestAccounts' 
    });
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from wallet');
    }
    
    // Set up ethers provider
    provider = new ethers.providers.Web3Provider(walletProvider);
    signer = provider.getSigner();
    
    // Verify network
    const network = await provider.getNetwork();
    if (network.chainId !== 100) {
      await switchToGnosisChain(walletProvider);
    }
    
    // Store selected wallet
    selectedWallet = { info: walletInfo, provider: walletProvider };
    
    // Initialize contracts
    await initializeContracts();
      console.log('✅ Wallet connected:', walletInfo.name);
    walletConnected = true;
    updateWalletStatus(true, accounts[0]);
    
    // Setup event listeners for account/chain changes
    if (walletProvider.on) {
      walletProvider.on('accountsChanged', handleAccountsChanged);
      walletProvider.on('chainChanged', handleChainChanged);
    }
    
    // Resolve the wallet connection promise if it exists
    if (window.walletConnectionResolve) {
      window.walletConnectionResolve(true);
      window.walletConnectionResolve = null;
    }
    
    return true;  } catch (error) {
    console.error('❌ Failed to connect to wallet:', error);
    showError(`Failed to connect to ${walletInfo.name}: ${error.message}`);
    
    // Resolve the wallet connection promise with false if it exists
    if (window.walletConnectionResolve) {
      window.walletConnectionResolve(false);
      window.walletConnectionResolve = null;
    }
    
    return false;
  }
}

async function connectWallet(manual = false) {
  try {
    console.log('🔄 Initiating wallet connection...');
    
    // Initialize wallet discovery if not done yet
    if (availableWallets.size === 0) {
      initWalletDiscovery();
      // Give some time for wallets to announce themselves
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // If only one wallet available, connect directly (unless manual selection requested)
    if (availableWallets.size === 1 && !manual) {
      const [wallet] = availableWallets.values();
      return await connectToWallet(wallet.provider, wallet.info);
    }
    
    // Show wallet selection if multiple wallets or manual connection
    if (availableWallets.size > 1 || manual) {
      showWalletSelection();
      
      // Return a promise that resolves when wallet connects
      return new Promise((resolve) => {
        // Store the resolve function globally so connectToWallet can call it
        window.walletConnectionResolve = resolve;
      });
    }
    
    // Fallback to legacy connection
    return await connectLegacyWallet();
    
  } catch (error) {
    console.error("❌ Wallet connection failed:", error);
    walletConnected = false;
    updateWalletStatus(false);
    return false;
  }
}

async function connectLegacyWallet() {
  try {
    if (!window.ethereum) {
      throw new Error('No Ethereum wallet found. Please install MetaMask, Rabby, or another Ethereum wallet.');
    }
    
    console.log('🔧 Using legacy wallet connection');
    
    // Request account access
    const accounts = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from wallet');
    }
    
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();
    
    // Verify network
    const network = await provider.getNetwork();
    if (network.chainId !== 100) {
      await switchToGnosisChain(window.ethereum);
    }
    
    await initializeContracts();
      console.log('✅ Legacy wallet connected');
    walletConnected = true;
    updateWalletStatus(true, accounts[0]);
    
    // Setup event listeners for account/chain changes
    if (window.ethereum.on) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    }
    
    // Resolve the wallet connection promise if it exists
    if (window.walletConnectionResolve) {
      window.walletConnectionResolve(true);
      window.walletConnectionResolve = null;
    }
    
    return true;  } catch (error) {
    console.error('❌ Legacy wallet connection failed:', error);
    
    // Resolve the wallet connection promise with false if it exists
    if (window.walletConnectionResolve) {
      window.walletConnectionResolve(false);
      window.walletConnectionResolve = null;
    }
    
    throw error;
  }
}

async function initializeContracts() {
  // Initialize contract with signer for transactions
  contract = new ethers.Contract(contractAddr, contractAbi, signer);
  console.log("💰 Contract initialized with address:", contractAddr);
  
  // Verify signer is working by getting address
  const signerAddress = await signer.getAddress();
  console.log("✅ Signer address:", signerAddress);
}

async function switchToGnosisChain(walletProvider) {
  try {
    await walletProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x64' }], // 100 in hex
    });
    
    // IMPORTANT: Recreate provider after network switch
    provider = new ethers.providers.Web3Provider(walletProvider);
    signer = provider.getSigner();
    
    // Verify the switch worked
    const newNet = await provider.getNetwork();
    if (newNet.chainId !== 100) {
      throw new Error(`Network switch failed. Expected chain ID 100, got ${newNet.chainId}`);
    }
    
  } catch (switchError) {
    if (switchError.code === 4902) {
      await walletProvider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x64',
          chainName: 'Gnosis',
          nativeCurrency: {
            name: 'xDAI',
            symbol: 'XDAI',
            decimals: 18,
          },          rpcUrls: ['https://rpc.gnosischain.com/'],
          blockExplorerUrls: ['https://gnosisscan.io/'],
        }],
      });
      
      // Recreate provider after adding network
      provider = new ethers.providers.Web3Provider(walletProvider);
      signer = provider.getSigner();
      
    } else {
      throw switchError;
    }
  }
}

function handleAccountsChanged(accounts) {
  console.log('👤 Accounts changed:', accounts);
  if (accounts.length === 0) {
    console.log('Wallet disconnected');
    walletConnected = false;
    updateWalletStatus(false);
    provider = null;
    signer = null;
    contract = null;
  } else {
    console.log('Wallet account changed, reconnecting...');
    connectWallet();
  }
}

function handleChainChanged(chainId) {
  console.log('🔗 Chain changed to:', chainId);
  // Reload the page to reset the dapp state
  window.location.reload();
}

function updateWalletStatus(connected) {
  const walletStatus = document.getElementById('wallet-status');
  
  if (connected) {
    if (walletStatus) {
      walletStatus.textContent = '✅ Wallet Connected';
      walletStatus.className = 'wallet-status connected';
      walletStatus.style.cursor = 'default';
    }
  } else {
    if (walletStatus) {
      walletStatus.textContent = '❌ Click to Connect';
      walletStatus.className = 'wallet-status disconnected';
      walletStatus.style.cursor = 'pointer';
    }  }
}

function closeWalletModal() {
  const modal = document.getElementById('walletModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Resolve the wallet connection promise with false if user closed modal
  if (window.walletConnectionResolve) {
    window.walletConnectionResolve(false);
    window.walletConnectionResolve = null;
  }
}

function showError(message) {
  console.error('Error:', message);
  // You could enhance this with a proper error modal instead of alert
  alert(message);
}

// =============  STEP 1: FILL ENTRY  =============
function validateStep1() {
  const userName = document.getElementById('entry-title').value.trim(); // Your name
  const entryTitle = document.getElementById('entry-tags').value.trim(); // Title of your entry  
  const story = document.getElementById('entry-story').value.trim();
  const tags = document.getElementById('entry-actual-tags').value.trim(); // Actual tags
  const image = document.getElementById('entry-image').files[0];
  
  if (!userName || !entryTitle || !story) {
    alert('Please fill in all required fields (name, title, and story). Image is optional.');
    return false;
  }
  
  // Check character limit for story
  if (story.length > 280) {
    alert('Your message is too long! Please keep it under 280 characters.');
    return false;
  }
  
  // Save data (note: we're using entry-tags for the actual title, and entry-title for the user name)
  capsuleData.title = entryTitle;     // Title of the entry
  capsuleData.tags = tags || entryTitle;  // Use actual tags if provided, otherwise use title
  capsuleData.story = story;
  capsuleData.image = image; // Can be null if no image is uploaded
  capsuleData.userName = userName;    // Store the user name separately
  
  return true;
}

function proceedFromStep1() {
  if (validateStep1()) {
    populatePreview();
    nextStep();
  }
}

// =============  STEP 2: PREVIEW  =============
function populatePreview() {
  // Update the title (this is the actual entry title)
  document.getElementById('preview-title').textContent = capsuleData.title;
  
  // Update the issuer (this is the user's name)
  document.getElementById('preview-issuer').textContent = capsuleData.userName;
  // Update unlock date (configurable reveal time)
  const revealTimeSeconds = REVEAL_TIME_CONFIG[REVEAL_TIME_CONFIG.current];
  const unlockDate = new Date();
  unlockDate.setSeconds(unlockDate.getSeconds() + revealTimeSeconds);
  
  const formatOptions = revealTimeSeconds < 86400 ? // Less than 1 day
    { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    } : 
    { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    };
  
  document.getElementById('preview-unlock-date').textContent = 
    unlockDate.toLocaleString('en-US', formatOptions);
  
  // Update tags
  const tagsContainer = document.querySelector('.preview-tags');
  tagsContainer.innerHTML = '';
  const tags = capsuleData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  tags.forEach(tag => {
    const tagElement = document.createElement('span');
    tagElement.className = 'tag';
    tagElement.textContent = `#${tag}`;
    tagsContainer.appendChild(tagElement);
  });
  // Create pixelated image preview
  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = function() {
    // Set canvas size to match the container
    const containerWidth = 350;
    const containerHeight = 200;
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    
    // Clear canvas with light gray background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, containerWidth, containerHeight);
    
    // Calculate aspect ratio preserving dimensions
    const imgAspectRatio = img.width / img.height;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let drawWidth, drawHeight, offsetX, offsetY;
    
    // Always fit the image within the container, never stretch
    if (imgAspectRatio > containerAspectRatio) {
      // Image is wider - fit to width
      drawWidth = containerWidth;
      drawHeight = containerWidth / imgAspectRatio;
      offsetX = 0;
      offsetY = (containerHeight - drawHeight) / 2;
    } else {
      // Image is taller - fit to height
      drawHeight = containerHeight;
      drawWidth = containerHeight * imgAspectRatio;
      offsetX = (containerWidth - drawWidth) / 2;
      offsetY = 0;
    }
    
    // Create pixelated effect
    const pixelSize = 4;
    const pixelWidth = Math.ceil(drawWidth / pixelSize);
    const pixelHeight = Math.ceil(drawHeight / pixelSize);
    
    // Create temporary canvas for pixelation
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = pixelWidth;
    tempCanvas.height = pixelHeight;
    
    // Disable image smoothing for crisp pixels
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
    
    // Disable smoothing on main canvas
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
    
    // After the canvas is ready, automatically generate the gallery-style image
    setTimeout(() => {
      generateCapsuleImage().then((blob) => {
        if (blob) {
          console.log('✅ Gallery-style image generated automatically');
          // Update the download button to show it's ready
          const downloadBtn = document.getElementById('download-image-btn');
          if (downloadBtn) {
            downloadBtn.textContent = '📷 Download Ready!';
            downloadBtn.style.background = '#10b981';
          }
        }
      }).catch(error => {
        console.error('Failed to auto-generate image:', error);
      });
    }, 100);
  };
  
  // Load the uploaded image or default image
  if (capsuleData.image) {
    // Load the uploaded image
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    reader.readAsDataURL(capsuleData.image);
  } else {
    // Load default image
    img.src = 'default.jpg';
  }

  // Start encryption in the background
  startEncryptionInBackground();
}

async function startEncryptionInBackground() {
  if (encryptionInProgress || encryptionComplete) {
    console.log('Encryption already in progress or complete, skipping...');
    return;
  }
  
  console.log('Starting background encryption...');
  encryptionInProgress = true;
  
  // Show encryption status section
  const statusSection = document.getElementById('encryption-status-section');
  if (statusSection) {
    statusSection.style.display = 'block';
  }
  
  // Disable ciphertext copy initially
  const copyBtn = document.getElementById('copy-ciphertext-btn');
  if (copyBtn) {
    copyBtn.style.color = '#999';
    copyBtn.style.cursor = 'default';
    copyBtn.onclick = null;
  }
  
  try {
    document.getElementById('preview-encryption-status').textContent = 'Preparing encryption...';
    document.getElementById('preview-encryption-progress').style.width = '10%';    // 1. Get Shutter identity and encryption metadata from backend
    document.getElementById('preview-encryption-status').textContent = 'Getting encryption parameters...';
    const revealTimestamp = Math.floor(Date.now() / 1000) + REVEAL_TIME_CONFIG[REVEAL_TIME_CONFIG.current];
      // Prepare image for encryption - use uploaded image or default
    let imageToEncrypt = capsuleData.image;
    
    if (!imageToEncrypt) {
      // Fetch default image and convert to File object
      document.getElementById('preview-encryption-status').textContent = 'Loading default image...';
      try {
        const defaultImageResponse = await fetch('default.jpg');
        const defaultImageBlob = await defaultImageResponse.blob();
        imageToEncrypt = new File([defaultImageBlob], 'default.jpg', { type: defaultImageBlob.type });
      } catch (error) {
        console.error('Failed to load default image:', error);
        throw new Error('Failed to load default image. Please upload your own image or ensure default.jpg is available.');
      }
    }
    
    const fd = new FormData();
    fd.append("title", capsuleData.title);
    fd.append("tags", capsuleData.tags);
    fd.append("story", capsuleData.story);
    fd.append("image", imageToEncrypt);
    fd.append("revealTimestamp", revealTimestamp);
      const encResponse = await window.axios.post(`${getApiBaseUrl()}/submit_capsule`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    
    document.getElementById('preview-encryption-progress').style.width = '30%';
    
    // 2. Wait for Shutter WASM to be ready
    document.getElementById('preview-encryption-status').textContent = 'Initializing encryption engine...';
    await ensureShutterReady();
    
    document.getElementById('preview-encryption-progress').style.width = '50%';
      // 3. Encrypt story
    document.getElementById('preview-encryption-status').textContent = 'Encrypting story...';
    const storyHex = "0x" + Array.from(new TextEncoder().encode(capsuleData.story))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const sigmaBytes = new Uint8Array(32);
    crypto.getRandomValues(sigmaBytes);
    const sigmaHex = "0x" + Array.from(sigmaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const encryptedStory = await window.shutter.encryptData(
      storyHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('preview-encryption-progress').style.width = '70%';
      // 4. Encrypt image
    document.getElementById('preview-encryption-status').textContent = 'Encrypting image...';
    const imgHex = await fileToHex(imageToEncrypt);
    const encryptedImg = await window.shutter.encryptData(
      imgHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('preview-encryption-progress').style.width = '85%';
    
    // 5. Upload to IPFS
    document.getElementById('preview-encryption-status').textContent = 'Uploading to IPFS...';
    const uploadResult = await uploadToIPFS(encryptedImg);
    
    document.getElementById('preview-encryption-progress').style.width = '95%';
      // Save encryption data
    capsuleData.encryptionData = {
      encryptedStory,
      shutterIdentity: encResponse.data.shutterIdentity,
      revealTimestamp: encResponse.data.revealTimestamp,
      imageCID: uploadResult.cid,
      pixelatedImage: encResponse.data.pixelatedImage,
      pixelatedCid: encResponse.data.pixelatedCid,
      pixelatedUrls: encResponse.data.pixelatedUrls,
      pixelatedId: encResponse.data.pixelatedId
    };
    
    // Save pixelated mapping (backward compatibility with old endpoint)
    if (encResponse.data.pixelatedId) {
      try {
        await window.axios.post(`${getApiBaseUrl()}/save_pixelated`, {
          cid: uploadResult.cid,
          preview_id: encResponse.data.pixelatedId
        });
      } catch (error) {
        console.warn('Failed to save pixelated mapping (not critical):', error);
      }
    }
      
    document.getElementById('preview-encryption-status').textContent = 'Encryption complete! Ciphertext ready to copy.';
    document.getElementById('preview-encryption-progress').style.width = '100%';
    
    // Enable ciphertext copy functionality
    const copyBtn = document.getElementById('copy-ciphertext-btn');
    copyBtn.style.color = '#4F46E5';
    copyBtn.style.cursor = 'pointer';
    copyBtn.onclick = copyCiphertext;
    
    encryptionComplete = true;
    encryptionInProgress = false;
    
  } catch (error) {
    console.error('Background encryption failed:', error);
    document.getElementById('preview-encryption-status').textContent = 'Encryption failed: ' + error.message;
    document.getElementById('preview-encryption-status').style.color = 'red';
    encryptionInProgress = false;
  }
}

function copyCiphertext() {
  if (!encryptionComplete || !capsuleData.encryptionData) {
    alert('Encryption is still in progress. Please wait...');
    return;
  }
  
  const ciphertext = capsuleData.encryptionData.encryptedStory;
  navigator.clipboard.writeText(ciphertext).then(() => {
    const copyBtn = document.getElementById('copy-ciphertext-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'copied!';
    copyBtn.style.color = '#10B981';
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.style.color = '#4F46E5';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy ciphertext:', err);
    alert('Failed to copy ciphertext to clipboard');
  });
}

function confirmPreview() {
  if (!encryptionComplete) {
    alert('Please wait for encryption to complete before proceeding.');
    return;
  }
  nextStep(); // Go to blockchain submission step
}

// =============  STEP 3: BLOCKCHAIN SUBMISSION  =============
async function handleStep3() {
  // Check if wallet is connected
  if (!walletConnected) {
    // Show wallet connection section
    document.getElementById('wallet-connection-section').style.display = 'block';
    document.getElementById('blockchain-submission-section').style.display = 'none';
      // Set up wallet connection button
    document.getElementById('connect-wallet-for-submission').onclick = async () => {
      console.log('🔄 User clicked connect wallet for submission');
      const connected = await connectWallet(true);
      console.log('✅ Wallet connection result:', connected);
      if (connected) {
        // Hide wallet connection, show blockchain submission
        document.getElementById('wallet-connection-section').style.display = 'none';
        document.getElementById('blockchain-submission-section').style.display = 'block';
        
        // Add a small delay to ensure UI updates, then start blockchain submission
        console.log('🚀 Starting blockchain submission...');
        setTimeout(() => {
          submitToChain();
        }, 500);
      } else {
        console.error('❌ Wallet connection failed, not proceeding with submission');
      }
    };
  } else {
    // Wallet already connected, proceed with submission
    document.getElementById('wallet-connection-section').style.display = 'none';
    document.getElementById('blockchain-submission-section').style.display = 'block';
    submitToChain();
  }
}

async function submitToChain() {
  console.log('🔄 submitToChain called');
  console.log('Wallet connected:', walletConnected);
  console.log('Encryption complete:', encryptionComplete);
  console.log('Contract instance:', !!contract);
  console.log('Signer instance:', !!signer);
  console.log('Capsule data:', capsuleData);
  
  try {
    if (!walletConnected) {
      console.error('❌ Wallet not connected');
      alert('Please connect your wallet first');
      return;
    }
    
    if (!encryptionComplete) {
      console.error('❌ Encryption not complete');
      alert('Please wait for encryption to complete first');
      return;
    }
    
    // Ensure contract is properly initialized with signer
    if (!contract || !signer) {
      console.error('❌ Contract or signer not initialized');
      console.error('Contract:', contract);
      console.error('Signer:', signer);
      alert('Wallet connection issue. Please refresh and try again.');
      return;
    }
    
    // Update submission status
    const submissionStatus = document.getElementById('submission-status');
    const submissionProgress = document.getElementById('submission-progress');
    const submissionMessage = document.getElementById('submission-message');
    
    if (submissionStatus) submissionStatus.textContent = 'Preparing transaction...';
    if (submissionProgress) submissionProgress.style.width = '25%';
    if (submissionMessage) submissionMessage.textContent = 'Please confirm the transaction in your wallet...';
      // Verify we can get the signer address before proceeding
    try {
      const signerAddress = await signer.getAddress();
      console.log('Signer address:', signerAddress);
    } catch (addressError) {
      console.error('Failed to get signer address:', addressError);
      alert('Wallet connection issue. Please disconnect and reconnect your wallet.');
      return;
    }    
    // Execute the transaction
    console.log('🔄 Calling contract.commitCapsule with params:', {
      title: capsuleData.title,
      tags: capsuleData.tags,
      encryptedStoryLength: capsuleData.encryptionData.encryptedStory?.length,
      revealTime: capsuleData.encryptionData.revealTimestamp,
      shutterIdentity: capsuleData.encryptionData.shutterIdentity?.slice(0, 20) + '...',
      imageCID: capsuleData.encryptionData.imageCID,
      pixelatedImageCID: capsuleData.encryptionData.pixelatedCid || ""
    });
    
    const tx = await contract.commitCapsule({
      title: capsuleData.title,
      tags: capsuleData.tags,
      encryptedStory: ethers.utils.arrayify(capsuleData.encryptionData.encryptedStory),
      revealTime: capsuleData.encryptionData.revealTimestamp,
      shutterIdentity: capsuleData.encryptionData.shutterIdentity,
      imageCID: capsuleData.encryptionData.imageCID,
      pixelatedImageCID: capsuleData.encryptionData.pixelatedCid || "" // Pixelated image CID
    });
    
    console.log('✅ Transaction created:', tx);
    
    if (submissionStatus) submissionStatus.textContent = 'Transaction submitted! Waiting for confirmation...';
    if (submissionProgress) submissionProgress.style.width = '50%';
    if (submissionMessage) submissionMessage.textContent = 'Transaction submitted! Waiting for blockchain confirmation...';
    
    console.log("📜 Transaction hash:", tx.hash);
    capsuleData.txHash = tx.hash;
    
    console.log('⏳ Waiting for transaction confirmation...');
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed:", receipt);
    
    if (submissionStatus) submissionStatus.textContent = 'Getting capsule ID...';
    if (submissionProgress) submissionProgress.style.width = '75%';
    if (submissionMessage) submissionMessage.textContent = 'Transaction confirmed! Finalizing your capsule...';
    
    // Get capsule ID from transaction logs or contract call
    const capsuleCount = await contractRead.capsuleCount();
    capsuleData.capsuleId = capsuleCount.toNumber() - 1;
    
    if (submissionStatus) submissionStatus.textContent = 'Success! Preparing completion screen...';
    if (submissionProgress) submissionProgress.style.width = '100%';
    if (submissionMessage) submissionMessage.textContent = 'Success! Your time capsule has been created!';
    
    // Move to final step with a short delay
    setTimeout(() => {
      populateCompletion();
      nextStep(); // Move to step 4
      console.log("Moved to completion step 4");
    }, 1500);
    
  } catch (error) {
    console.error('Blockchain submission failed:', error);
    const submissionStatus = document.getElementById('submission-status');
    const submissionMessage = document.getElementById('submission-message');
    
    if (submissionStatus) {
      submissionStatus.textContent = 'Submission failed: ' + error.message;
      submissionStatus.style.color = 'red';
    }
    if (submissionMessage) {
      submissionMessage.textContent = 'Transaction failed. Please try again.';
      submissionMessage.style.color = 'red';
    }
      // Show retry option
    setTimeout(async () => {
      if (confirm('Transaction failed. Would you like to try again?')) {
        // Reset submission UI and retry
        document.getElementById('submission-status').style.color = '';
        document.getElementById('submission-message').style.color = '';
        await submitToChain();
      } else {
        // Go back to step 2
        prevStep();
      }
    }, 2000);
  }
}

// =============  STEP 4: COMPLETION  =============
function populateCompletion() {
  // Update the preview card with final data
  document.getElementById('final-preview-title').textContent = capsuleData.title;
  document.getElementById('final-preview-issuer').textContent = capsuleData.userName;
  // Update unlock date
  const unlockDate = new Date(capsuleData.encryptionData.revealTimestamp * 1000);
  const revealTimeSeconds = REVEAL_TIME_CONFIG[REVEAL_TIME_CONFIG.current];
  
  const formatOptions = revealTimeSeconds < 86400 ? // Less than 1 day
    { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    } : 
    { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    };
  
  document.getElementById('final-unlock-date').textContent = 
    unlockDate.toLocaleString('en-US', formatOptions);
    // Update tags
  const finalTagsContainer = document.getElementById('final-preview-tags');
  finalTagsContainer.innerHTML = '';
  const tags = capsuleData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  tags.forEach(tag => {
    const tagElement = document.createElement('span');
    tagElement.className = 'tag';
    tagElement.textContent = `#${tag}`;
    finalTagsContainer.appendChild(tagElement);
  });
  // Generate and populate shareable link
  generateShareableLink();
  
  // Setup download image functionality
  setupDownloadImage();
  // Recreate pixelated image in final preview
  const canvas = document.getElementById('final-preview-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = function() {
    // Set canvas size to match the container
    const containerWidth = 350;
    const containerHeight = 200;
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    
    // Clear canvas with light gray background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, containerWidth, containerHeight);
    
    // Calculate aspect ratio preserving dimensions
    const imgAspectRatio = img.width / img.height;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let drawWidth, drawHeight, offsetX, offsetY;
    
    if (imgAspectRatio > containerAspectRatio) {
      drawWidth = containerWidth;
      drawHeight = containerWidth / imgAspectRatio;
      offsetX = 0;
      offsetY = (containerHeight - drawHeight) / 2;
    } else {
      drawHeight = containerHeight;
      drawWidth = containerHeight * imgAspectRatio;
      offsetX = (containerWidth - drawWidth) / 2;
      offsetY = 0;
    }
    
    // Create pixelated effect
    const pixelSize = 4;
    const pixelWidth = Math.ceil(drawWidth / pixelSize);
    const pixelHeight = Math.ceil(drawHeight / pixelSize);
    
    // Create temporary canvas for pixelation
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = pixelWidth;
    tempCanvas.height = pixelHeight;
    
    // Disable image smoothing for crisp pixels
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
    
    // Disable smoothing on main canvas
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
  };
  
  // Load the uploaded image or default image
  if (capsuleData.image) {
    // Load the uploaded image
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    reader.readAsDataURL(capsuleData.image);
  } else {
    // Load default image
    img.src = 'default.jpg';
  }

  // Enable final ciphertext copy functionality
  const finalCopyBtn = document.getElementById('final-copy-ciphertext-btn');
  if (finalCopyBtn && capsuleData.encryptionData) {
    finalCopyBtn.onclick = () => {
      const ciphertext = capsuleData.encryptionData.encryptedStory;
      navigator.clipboard.writeText(ciphertext).then(() => {
        const originalText = finalCopyBtn.textContent;
        finalCopyBtn.textContent = 'copied!';
        finalCopyBtn.style.color = '#10B981';
        setTimeout(() => {
          finalCopyBtn.textContent = originalText;
          finalCopyBtn.style.color = '#4F46E5';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy ciphertext:', err);
        alert('Failed to copy ciphertext to clipboard');
      });
    };
  }
}

function generateShareableLink() {
  if (!capsuleData.capsuleId && capsuleData.capsuleId !== 0) {
    console.warn('No capsule ID available for shareable link');
    return;
  }

  // Generate the shareable link
  const baseUrl = window.location.origin;
  const shareableUrl = `${baseUrl}/gallery.html?capsule=${capsuleData.capsuleId}`;
  
  // Populate the input field
  const linkInput = document.getElementById('shareable-link-input');
  if (linkInput) {
    linkInput.value = shareableUrl;
  }

  // Add copy functionality
  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(shareableUrl).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy link:', err);
        alert('Failed to copy link to clipboard');
      });
    };
  }
}

function setupDownloadImage() {
  const downloadBtn = document.getElementById('download-image-btn');
  if (downloadBtn) {
    downloadBtn.onclick = downloadCapsuleImage;
  }
}

// Polyfill for roundRect (not available in all browsers)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radius) {
    this.beginPath();
    this.moveTo(x + radius, y);
    this.lineTo(x + width - radius, y);
    this.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.lineTo(x + width, y + height - radius);
    this.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.lineTo(x + radius, y + height);
    this.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.lineTo(x, y + radius);
    this.quadraticCurveTo(x, y, x + radius, y);
    this.closePath();
  };
}

// Store the generated image blob globally for easy access
let generatedImageBlob = null;

function generateCapsuleImage() {
  // Get the canvas element from the final preview
  const canvas = document.getElementById('final-preview-canvas');
  if (!canvas) {
    console.error('Preview canvas not found');
    return null;
  }

  try {
    // Create a canvas that matches the gallery card layout
    const downloadCanvas = document.createElement('canvas');
    const downloadCtx = downloadCanvas.getContext('2d');
    
    // Set canvas size to match gallery card proportions
    // Gallery cards are typically 360px wide with 16px padding
    const cardWidth = 360;
    const cardPadding = 16;
    const contentWidth = cardWidth - (cardPadding * 2);
    
    // Calculate height based on gallery card structure
    const headerHeight = 32; // ID and status badges
    const imageHeight = 160; // Gallery image height
    const titleHeight = 24; // Title line height
    const metaHeight = 60; // 3 lines of metadata
    const storyHeight = 80; // Story section
    const actionsHeight = 40; // Action buttons
    const spacing = 12 * 6; // 6 gaps of 12px each
    
    const cardHeight = headerHeight + imageHeight + titleHeight + metaHeight + storyHeight + actionsHeight + spacing + (cardPadding * 2);
    
    downloadCanvas.width = cardWidth;
    downloadCanvas.height = cardHeight;
    
    // Fill background (gallery card background color)
    downloadCtx.fillStyle = '#ececec'; // var(--eth2)
    downloadCtx.fillRect(0, 0, cardWidth, cardHeight);
    
    let yPos = cardPadding;
    
    // 1. Header with ID and Status
    // ID Badge
    downloadCtx.fillStyle = '#242ae0'; // var(--eth5)
    downloadCtx.fillRect(cardPadding, yPos, 60, 24);
    downloadCtx.fillStyle = 'white';
    downloadCtx.font = 'bold 12px Inter, sans-serif';
    downloadCtx.textAlign = 'center';
    downloadCtx.fillText(`ID #${capsuleData.capsuleId || '0'}`, cardPadding + 30, yPos + 16);
    
    // Status Badge
    downloadCtx.fillStyle = '#FF9800'; // Orange for locked
    downloadCtx.fillRect(cardWidth - cardPadding - 60, yPos, 60, 24);
    downloadCtx.fillStyle = 'white';
    downloadCtx.fillText('Locked', cardWidth - cardPadding - 30, yPos + 16);
    
    yPos += headerHeight + 12;
    
    // 2. Image (scaled to match gallery dimensions)
    const imageAspectRatio = canvas.width / canvas.height;
    let drawWidth = contentWidth;
    let drawHeight = imageHeight;
    
    // Scale image to cover the gallery image area (like object-fit: cover)
    if (imageAspectRatio > contentWidth / imageHeight) {
      // Image is wider, scale by height
      drawWidth = imageHeight * imageAspectRatio;
    } else {
      // Image is taller, scale by width
      drawHeight = contentWidth / imageAspectRatio;
    }
    
    // Center the image in the available space
    const imageX = cardPadding + (contentWidth - drawWidth) / 2;
    const imageY = yPos + (imageHeight - drawHeight) / 2;
    
    // Clip to the gallery image area
    downloadCtx.save();
    downloadCtx.beginPath();
    downloadCtx.roundRect(cardPadding, yPos, contentWidth, imageHeight, 12);
    downloadCtx.clip();
    
    // Draw the pixelated image
    downloadCtx.imageSmoothingEnabled = false;
    downloadCtx.drawImage(canvas, imageX, imageY, drawWidth, drawHeight);
    downloadCtx.restore();
    
    yPos += imageHeight + 12;
    
    // 3. Title
    downloadCtx.fillStyle = '#232323'; // var(--eth3)
    downloadCtx.font = 'bold 18px Inter, sans-serif';
    downloadCtx.textAlign = 'left';
    downloadCtx.fillText(capsuleData.title || 'Untitled Capsule', cardPadding, yPos + 18);
    
    yPos += titleHeight + 8;
    
    // 4. Metadata
    downloadCtx.fillStyle = 'rgba(35, 35, 35, 0.7)'; // Semi-transparent eth3
    downloadCtx.font = '12px Inter, sans-serif';
    
    // Tags
    downloadCtx.fillText(`Tags: ${capsuleData.tags || 'No tags'}`, cardPadding, yPos + 12);
    yPos += 16;
    
    // Creator (use first part of wallet address if available)
    const creator = window.ethereum?.selectedAddress 
      ? `${window.ethereum.selectedAddress.slice(0, 6)}...${window.ethereum.selectedAddress.slice(-4)}`
      : 'Anonymous';
    downloadCtx.fillText(`Creator: ${creator}`, cardPadding, yPos + 12);
    yPos += 16;
    
    // Unlock date
    const unlockDate = new Date(capsuleData.encryptionData.revealTimestamp * 1000);
    downloadCtx.fillText(`Unlocks: ${unlockDate.toLocaleDateString()}`, cardPadding, yPos + 12);
    
    yPos += 16 + 12;
    
    // 5. Story preview (locked state)
    downloadCtx.fillStyle = 'rgba(153, 153, 153, 1)'; // #999
    downloadCtx.font = 'italic 14px Inter, sans-serif';
    const storyText = `🔒 Story will be revealed on ${unlockDate.toLocaleDateString()}`;
    
    // Wrap text to fit in story area
    const words = storyText.split(' ');
    let line = '';
    const lineHeight = 18;
    let storyY = yPos;
    
    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = downloadCtx.measureText(testLine);
      if (metrics.width > contentWidth && i > 0) {
        downloadCtx.fillText(line, cardPadding, storyY + lineHeight);
        line = words[i] + ' ';
        storyY += lineHeight;
        if (storyY > yPos + storyHeight - lineHeight) break; // Don't exceed story area
      } else {
        line = testLine;
      }
    }
    downloadCtx.fillText(line, cardPadding, storyY + lineHeight);
    
    // Add gradient fade at bottom of story (like gallery)
    const fadeGradient = downloadCtx.createLinearGradient(0, yPos + storyHeight - 20, 0, yPos + storyHeight);
    fadeGradient.addColorStop(0, 'rgba(236, 236, 236, 0)');
    fadeGradient.addColorStop(1, 'rgba(236, 236, 236, 1)');
    downloadCtx.fillStyle = fadeGradient;
    downloadCtx.fillRect(cardPadding, yPos + storyHeight - 20, contentWidth, 20);
    
    yPos += storyHeight + 12;
    
    // 6. Action buttons
    downloadCtx.fillStyle = '#f5f5f5';
    downloadCtx.fillRect(cardPadding, yPos, (contentWidth - 8) / 2, 32);
    downloadCtx.fillRect(cardPadding + (contentWidth + 8) / 2, yPos, (contentWidth - 8) / 2, 32);
    
    downloadCtx.fillStyle = '#666';
    downloadCtx.font = '12px Inter, sans-serif';
    downloadCtx.textAlign = 'center';
    downloadCtx.fillText('🔓 Preview Story', cardPadding + (contentWidth - 8) / 4, yPos + 20);
    downloadCtx.fillText('📖 Read More', cardPadding + 3 * (contentWidth + 8) / 4, yPos + 20);
    
    return new Promise((resolve) => {
      downloadCanvas.toBlob((blob) => {
        generatedImageBlob = blob;
        resolve(blob);
      }, 'image/png');
    });
    
  } catch (error) {
    console.error('Failed to generate image:', error);
    return null;
  }
}

function downloadCapsuleImage() {
  if (!generatedImageBlob) {
    console.error('No image generated yet');
    alert('Image not ready. Please wait a moment and try again.');
    return;
  }

  try {
    const url = URL.createObjectURL(generatedImageBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `time-capsule-${capsuleData.capsuleId || 'preview'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Update button to show success
    const downloadBtn = document.getElementById('download-image-btn');
    if (downloadBtn) {
      const originalText = downloadBtn.textContent;
      downloadBtn.textContent = '✅ Downloaded!';
      downloadBtn.classList.add('downloaded');
      setTimeout(() => {
        downloadBtn.textContent = originalText;
        downloadBtn.classList.remove('downloaded');
      }, 3000);
    }
    
  } catch (error) {
    console.error('Failed to download image:', error);
    alert('Failed to download image. Please try again.');
  }
}

function followOnX() {
  window.open('https://twitter.com/ethereum', '_blank');
}

function shareOnX() {
  const unlockDate = new Date(capsuleData.encryptionData.revealTimestamp * 1000);
  const text = `I just created a time capsule on Ethereum! 🕰️✨ It will unlock on ${unlockDate.toLocaleString()}`;
  const shareUrl = `${window.location.origin}/gallery.html?capsule=${capsuleData.capsuleId}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
  
  // Check if we have a generated image ready
  if (generatedImageBlob) {
    // Automatically download the image and open Twitter
    const url = URL.createObjectURL(generatedImageBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `time-capsule-${capsuleData.capsuleId || 'preview'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Show download success on button
    const downloadBtn = document.getElementById('download-image-btn');
    if (downloadBtn) {
      downloadBtn.textContent = '✅ Downloaded!';
      downloadBtn.classList.add('downloaded');
    }
    
    // Wait a moment then open Twitter with instructions
    setTimeout(() => {
      window.open(twitterUrl, '_blank');
      alert('📷 Perfect! Your capsule image has been downloaded.\n\nNow attach it to your tweet to show off your time capsule! 🚀');
    }, 500);
  } else {
    // Fallback: prompt user to download manually
    alert('🖼️ Generating your capsule image... Please try again in a moment!');
    
    // Try to generate the image now
    generateCapsuleImage().then((blob) => {
      if (blob) {
        // Retry sharing once image is ready
        setTimeout(() => shareOnX(), 100);
      } else {
        // If generation fails, open Twitter without image
        window.open(twitterUrl, '_blank');
      }
    });
  }
}

function viewInGallery() {
  // Navigate to gallery view
  window.location.href = 'gallery.html';
}

function encryptAnotherEntry() {
  // Reset data and start over
  capsuleData = {
    title: '',
    tags: '',
    story: '',
    image: null,
    userName: '',
    encryptionData: null,
    txHash: null,
    capsuleId: null
  };
  
  // Reset encryption state
  encryptionInProgress = false;
  encryptionComplete = false;
  
  // Reset form
  document.getElementById('capsule-form').reset();
  
  // Hide encryption status section
  const statusSection = document.getElementById('encryption-status-section');
  if (statusSection) {
    statusSection.style.display = 'none';
  }
  
  // Go back to step 1
  showStep(1);
}

function viewAllCapsules() {
  // Navigate to gallery view
  window.location.href = 'gallery.html';
}

// =============  TAGS DROPDOWN FUNCTIONALITY  =============
let selectedTags = [];
const MAX_TAGS = 2;

function initTagsDropdown() {
  console.log('🏷️ Initializing tags dropdown...');
  const dropdown = document.getElementById('tags-dropdown');
  const dropdownMenu = document.getElementById('dropdown-menu');
  const selectedTagsContainer = document.getElementById('selected-tags');
  const hiddenInput = document.getElementById('entry-actual-tags');
  
  console.log('Elements found:', {
    dropdown: !!dropdown,
    dropdownMenu: !!dropdownMenu,
    selectedTagsContainer: !!selectedTagsContainer,
    hiddenInput: !!hiddenInput
  });
  
  if (!dropdown || !dropdownMenu || !selectedTagsContainer || !hiddenInput) {
    console.error('❌ Tags dropdown elements not found, skipping initialization');
    return; // Elements not found, skip initialization
  }
  
  console.log('✅ All elements found, setting up event listeners...');
    // Toggle dropdown
  dropdown.addEventListener('click', function(e) {
    console.log('🖱️ Dropdown clicked');
    e.stopPropagation();
    const isOpen = dropdownMenu.classList.contains('show');
    
    if (isOpen) {
      console.log('Closing dropdown');
      closeDropdown();
    } else {
      console.log('Opening dropdown');
      openDropdown();
    }
  });
  
  // Handle tag selection
  dropdownMenu.addEventListener('click', function(e) {
    console.log('🏷️ Tag clicked:', e.target);
    if (e.target.classList.contains('dropdown-item') && !e.target.classList.contains('disabled')) {
      const tag = e.target.getAttribute('data-tag');
      console.log('Selected tag:', tag);
      toggleTag(tag);
      e.stopPropagation();
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    if (!dropdown.contains(e.target)) {
      closeDropdown();
    }
  });
  
  // Initialize display
  updateTagsDisplay();
  updateDropdownItems();
}

function openDropdown() {
  const dropdown = document.getElementById('tags-dropdown');
  const dropdownMenu = document.getElementById('dropdown-menu');
  
  dropdown.classList.add('active');
  dropdownMenu.classList.add('show');
  updateDropdownItems();
}

function closeDropdown() {
  const dropdown = document.getElementById('tags-dropdown');
  const dropdownMenu = document.getElementById('dropdown-menu');
  
  dropdown.classList.remove('active');
  dropdownMenu.classList.remove('show');
}

function toggleTag(tag) {
  const index = selectedTags.indexOf(tag);
  
  if (index === -1) {
    // Add tag if not selected and under limit
    if (selectedTags.length < MAX_TAGS) {
      selectedTags.push(tag);
    }
  } else {
    // Remove tag if already selected
    selectedTags.splice(index, 1);
  }
  
  updateTagsDisplay();
  updateDropdownItems();
  updateHiddenInput();
}

function removeTag(tag) {
  const index = selectedTags.indexOf(tag);
  if (index !== -1) {
    selectedTags.splice(index, 1);
    updateTagsDisplay();
    updateDropdownItems();
    updateHiddenInput();
  }
}

function updateTagsDisplay() {
  const selectedTagsContainer = document.getElementById('selected-tags');
  if (!selectedTagsContainer) return;
  
  selectedTagsContainer.innerHTML = '';
  
  if (selectedTags.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'tags-placeholder';
    placeholder.textContent = 'Select tags...';
    selectedTagsContainer.appendChild(placeholder);
  } else {
    selectedTags.forEach(tag => {
      const tagBubble = document.createElement('div');
      tagBubble.className = 'tag-bubble';
      
      const tagText = document.createElement('span');
      tagText.textContent = tag;
      
      const removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.textContent = '×';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeTag(tag);
      };
      
      tagBubble.appendChild(tagText);
      tagBubble.appendChild(removeBtn);
      selectedTagsContainer.appendChild(tagBubble);
    });
  }
}

function updateDropdownItems() {
  const dropdownItems = document.querySelectorAll('.dropdown-item');
  
  dropdownItems.forEach(item => {
    const tag = item.getAttribute('data-tag');
    const isSelected = selectedTags.includes(tag);
    const canSelect = selectedTags.length < MAX_TAGS || isSelected;
    
    if (!canSelect && !isSelected) {
      item.classList.add('disabled');
    } else {
      item.classList.remove('disabled');
    }
  });
}

function updateHiddenInput() {
  const hiddenInput = document.getElementById('entry-actual-tags');
  if (hiddenInput) {
    hiddenInput.value = selectedTags.join(', ');
  }
}

// =============  HELPER FUNCTIONS  =============
// Wait for Shutter WASM to be ready
async function ensureShutterReady() {
  let tries = 0;
  const maxTries = 200; // Increased from 100
  
  while (
    (!window.shutter || typeof window.shutter.encryptData !== "function") &&
    tries < maxTries
  ) {
    await new Promise(res => setTimeout(res, 100)); // Increased delay from 50ms to 100ms
    tries++;
    
    // Log progress every 50 tries
    if (tries % 50 === 0) {
      console.log(`Waiting for Shutter WASM... attempt ${tries}/${maxTries}`);
    }
  }
  
  if (!window.shutter || typeof window.shutter.encryptData !== "function") {
    console.error("Shutter WASM loading failed. Available:", {
      hasShutter: !!window.shutter,
      shutterKeys: window.shutter ? Object.keys(window.shutter) : 'N/A',
      hasBlst: !!window.blst,
      blstKeys: window.blst ? Object.keys(window.blst) : 'N/A'
    });
    throw new Error("Shutter WASM not loaded after extended wait!");
  }
  
  console.log("✅ Shutter WASM ready for encryption");
}

// Helper: convert file to hex string
async function fileToHex(file) {
  const arrayBuffer = await file.arrayBuffer();
  return "0x" + Array.from(new Uint8Array(arrayBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: upload to IPFS via backend
async function uploadToIPFS(hexData) {
  const res = await window.axios.post(`${getApiBaseUrl()}/upload_ipfs`, { hex: hexData });
  return res.data;
}

// =============  INITIALIZATION  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
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
    
    // Initialize wallet discovery but don't auto-connect
    // Users will connect manually when they reach step 3
    console.log("Initializing wallet discovery...");
    initWalletDiscovery();    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize Shutter WASM with retry mechanism
    console.log("Initializing Shutter WASM...");
    let shutterInitTries = 0;
    const maxShutterTries = 10;
    
    while (shutterInitTries < maxShutterTries) {
      try {
        await ensureShutterReady();
        console.log("✅ Shutter WASM ready");
        break;
      } catch (e) {
        shutterInitTries++;
        console.warn(`⚠️ Shutter WASM init attempt ${shutterInitTries}/${maxShutterTries} failed:`, e.message);
        
        if (shutterInitTries >= maxShutterTries) {
          console.error("❌ Shutter WASM failed to initialize after multiple attempts");
          console.log("The app will continue but encryption may fail until WASM loads");
        } else {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Start on step 1
    showStep(1);
    
  } catch (e) {
    console.error("Initialization failed:", e);
  }
});

function setupEventListeners() {
  // Initialize tags dropdown
  initTagsDropdown();
  
  // Navigation buttons
  document.getElementById('step1-next-btn').onclick = proceedFromStep1;
  document.getElementById('step2-confirm-btn').onclick = confirmPreview;
  
  // Character counter for story text
  const storyTextarea = document.getElementById('entry-story');
  const charCountElement = document.getElementById('story-char-count');
  const charCountContainer = document.querySelector('.character-counter');
  
  if (storyTextarea && charCountElement) {
    // Update character count on input
    storyTextarea.addEventListener('input', function() {
      const currentLength = this.value.length;
      const maxLength = 280;
      
      charCountElement.textContent = currentLength;
      
      // Update styling based on character count
      if (currentLength > maxLength * 0.9) { // 90% of limit (252 chars)
        charCountContainer.classList.add('warning');
        charCountContainer.classList.remove('error');
      } else {
        charCountContainer.classList.remove('warning', 'error');
      }
      
      if (currentLength >= maxLength) {
        charCountContainer.classList.add('error');
        charCountContainer.classList.remove('warning');
      }
    });
    
    // Initialize character count on page load
    const initialLength = storyTextarea.value.length;
    charCountElement.textContent = initialLength;
  }
  
  // Completion step buttons
  const followXBtn = document.getElementById('follow-x-btn');
  const shareXBtn = document.getElementById('share-x-btn');
  const galleryBtn = document.getElementById('gallery-btn');
  const encryptAnotherBtn = document.getElementById('encrypt-another-btn');
  
  if (followXBtn) followXBtn.onclick = followOnX;
  if (shareXBtn) shareXBtn.onclick = shareOnX;
  if (galleryBtn) galleryBtn.onclick = viewInGallery;
  if (encryptAnotherBtn) encryptAnotherBtn.onclick = encryptAnotherEntry;
  
  // Wallet status click to connect
  const walletStatus = document.getElementById('wallet-status');
  if (walletStatus) {
    walletStatus.onclick = async () => {
      if (!walletConnected) {
        await connectWallet(true);
      }
    };
    walletStatus.style.cursor = 'pointer';
  }
    // Progress step navigation
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    step.onclick = () => goToStep(index + 1);
  });
}

// Expose functions globally for HTML onclick handlers
window.connectWallet = connectWallet;
window.closeWalletModal = closeWalletModal;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.goToStep = goToStep;
