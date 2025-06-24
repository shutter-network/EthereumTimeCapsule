# blockchain_sync.py - Blockchain synchronization service for Time Capsule
import asyncio
import time
import threading
import logging
from typing import Optional, Dict, Any
from web3 import Web3
from web3.contract import Contract
from database import CapsuleDatabase
import json

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BlockchainSyncService:
    def __init__(self, rpc_url: str, contract_address: str, contract_abi: list, db: CapsuleDatabase):
        """
        Initialize blockchain sync service
        
        Args:
            rpc_url: Ethereum RPC endpoint URL
            contract_address: TimeCapsule contract address  
            contract_abi: Contract ABI definition
            db: Database instance for storing capsule data
        """
        self.rpc_url = rpc_url
        self.contract_address = contract_address
        self.contract_abi = contract_abi
        self.db = db
        
        # Initialize Web3 connection
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not self.w3.is_connected():
            raise Exception(f"Failed to connect to blockchain at {rpc_url}")
        
        # Initialize contract
        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=contract_abi
        )
        
        # Sync control
        self._stop_sync = False
        self._sync_thread = None
        self._sync_interval = 10  # seconds
        
        logger.info(f"Blockchain sync service initialized for contract {contract_address}")
    
    def start_sync(self):
        """Start the periodic synchronization in a background thread"""
        if self._sync_thread is not None and self._sync_thread.is_alive():
            logger.warning("Sync service is already running")
            return
        
        self._stop_sync = False
        self._sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self._sync_thread.start()
        logger.info("Blockchain sync service started")
    
    def stop_sync(self):
        """Stop the periodic synchronization"""
        self._stop_sync = True
        if self._sync_thread is not None:
            self._sync_thread.join(timeout=30)
        logger.info("Blockchain sync service stopped")
    
    def _sync_loop(self):
        """Main synchronization loop"""
        while not self._stop_sync:
            try:
                self.sync_capsules()
                time.sleep(self._sync_interval)
            except Exception as e:
                logger.error(f"Error in sync loop: {e}")
                # Continue running despite errors
                time.sleep(self._sync_interval)
    
    def sync_capsules(self) -> Dict[str, Any]:
        """
        Synchronize capsules from blockchain to database
        
        Returns:
            Dictionary with sync results and statistics
        """
        start_time = time.time()
        sync_result = {
            "success": False,
            "capsules_synced": 0,
            "new_capsules": 0,
            "updated_capsules": 0,
            "errors": [],
            "sync_time": 0,
            "blockchain_total": 0,
            "database_total": 0
        }
        
        try:
            # Get current blockchain state
            current_block = self.w3.eth.block_number
            total_capsules_on_chain = self.contract.functions.capsuleCount().call()
            
            sync_result["blockchain_total"] = total_capsules_on_chain
            logger.info(f"Starting sync: Block #{current_block}, {total_capsules_on_chain} capsules on-chain")
            
            # Get last synced state
            sync_status = self.db.get_sync_status()
            last_synced_count = sync_status.get('total_capsules', 0)
            
            # Sync all capsules (for simplicity, we'll fetch all each time)
            # In production, you might want to optimize this by tracking events
            for capsule_id in range(total_capsules_on_chain):
                try:
                    # Fetch capsule data from blockchain
                    capsule_data = self._fetch_capsule_from_blockchain(capsule_id)
                    
                    if capsule_data:
                        # Check if this is new or updated
                        existing_capsule = self.db.get_capsule(capsule_id)
                        
                        if existing_capsule is None:
                            # New capsule
                            if self.db.insert_capsule(capsule_data):
                                sync_result["new_capsules"] += 1
                                logger.info(f"Added new capsule #{capsule_id}: {capsule_data['title']}")
                        else:
                            # Check if capsule was updated (revealed status changed)
                            if (existing_capsule['is_revealed'] != capsule_data['is_revealed'] or
                                existing_capsule['decrypted_story'] != capsule_data['decrypted_story']):
                                if self.db.insert_capsule(capsule_data):
                                    sync_result["updated_capsules"] += 1
                                    logger.info(f"Updated capsule #{capsule_id} (revealed: {capsule_data['is_revealed']})")
                        
                        sync_result["capsules_synced"] += 1
                        
                except Exception as e:
                    error_msg = f"Error syncing capsule #{capsule_id}: {e}"
                    logger.error(error_msg)
                    sync_result["errors"].append(error_msg)
            
            # Update sync status
            sync_result["database_total"] = self.db.get_capsule_count()
            error_summary = "; ".join(sync_result["errors"][-5:])  # Keep last 5 errors
            
            self.db.update_sync_status(
                last_block=current_block,
                total_capsules=total_capsules_on_chain,
                errors=error_summary
            )
            
            sync_result["success"] = True
            sync_result["sync_time"] = time.time() - start_time
            
            logger.info(f"Sync completed: {sync_result['new_capsules']} new, "
                       f"{sync_result['updated_capsules']} updated, "
                       f"{len(sync_result['errors'])} errors, "
                       f"{sync_result['sync_time']:.2f}s")
            
        except Exception as e:
            sync_result["errors"].append(f"Sync failed: {e}")
            logger.error(f"Sync failed: {e}")
            
            # Still update sync status to track errors
            try:
                sync_status = self.db.get_sync_status()
                self.db.update_sync_status(
                    last_block=sync_status.get('last_synced_block', 0),
                    total_capsules=sync_status.get('total_capsules', 0),
                    errors=str(e)
                )
            except:
                pass
        
        return sync_result
    
    def _fetch_capsule_from_blockchain(self, capsule_id: int) -> Optional[Dict[str, Any]]:
        """
        Fetch a single capsule from the blockchain
        
        Args:
            capsule_id: The capsule ID to fetch
            
        Returns:
            Dictionary with capsule data or None if error
        """
        try:
            # Call contract getCapsule function
            capsule_tuple = self.contract.functions.getCapsule(capsule_id).call()            # Convert tuple to dictionary based on contract struct
            # Handle both old and new contract structures
            # Old struct (9 fields): creator, title, tags, encryptedStory, decryptedStory, isRevealed, revealTime, shutterIdentity, imageCID
            # New struct (10 fields): creator, title, tags, encryptedStory, decryptedStory, isRevealed, revealTime, shutterIdentity, imageCID, pixelatedImageCID
            
            capsule_data = {
                'id': capsule_id,
                'creator': capsule_tuple[0],
                'title': capsule_tuple[1],
                'tags': capsule_tuple[2],
                'encrypted_story': capsule_tuple[3],  # bytes
                'decrypted_story': capsule_tuple[4],
                'is_revealed': capsule_tuple[5],
                'reveal_time': capsule_tuple[6],
                'shutter_identity': capsule_tuple[7],
                'image_cid': capsule_tuple[8],
                'pixelated_image_cid': capsule_tuple[9] if len(capsule_tuple) > 9 else "",  # Handle backward compatibility
                'block_number': self.w3.eth.block_number,  # Current block for tracking
                'transaction_hash': None  # We could fetch this from events if needed
            }
            
            return capsule_data
            
        except Exception as e:
            logger.error(f"Error fetching capsule #{capsule_id} from blockchain: {e}")
            return None
    
    def force_sync(self) -> Dict[str, Any]:
        """
        Force an immediate synchronization (useful for API calls)
        
        Returns:
            Sync results dictionary
        """
        logger.info("Force sync requested")
        return self.sync_capsules()
    
    def get_sync_health(self) -> Dict[str, Any]:
        """
        Get synchronization health status
        
        Returns:
            Health status information
        """
        try:
            sync_status = self.db.get_sync_status()
            current_time = int(time.time())
            last_sync_time = sync_status.get('last_sync_time', 0)
            
            # Check if sync is healthy (synced within last 60 seconds)
            is_healthy = (current_time - last_sync_time) < 60
            
            # Get current blockchain state
            current_block = self.w3.eth.block_number
            blockchain_capsules = self.contract.functions.capsuleCount().call()
            database_capsules = self.db.get_capsule_count()
            
            return {
                "is_healthy": is_healthy,
                "is_running": self._sync_thread is not None and self._sync_thread.is_alive(),
                "last_sync_time": last_sync_time,
                "seconds_since_sync": current_time - last_sync_time,
                "current_block": current_block,
                "last_synced_block": sync_status.get('last_synced_block', 0),
                "blockchain_capsules": blockchain_capsules,
                "database_capsules": database_capsules,
                "sync_drift": blockchain_capsules - database_capsules,
                "recent_errors": sync_status.get('sync_errors', ''),
                "sync_interval": self._sync_interval
            }
            
        except Exception as e:
            logger.error(f"Error getting sync health: {e}")
            return {
                "is_healthy": False,
                "error": str(e)
            }
