# database.py - SQLite database management for Ethereum Time Capsule
import sqlite3
import json
import time
import threading
from typing import Dict, List, Optional, Any
from contextlib import contextmanager
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CapsuleDatabase:
    def __init__(self, db_path: str = "capsules.db"):
        self.db_path = db_path
        self.init_database()
        
    def init_database(self):
        """Initialize the database with required tables"""
        with self.get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS capsules (
                    id INTEGER PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    encrypted_story BLOB NOT NULL,
                    decrypted_story TEXT DEFAULT '',
                    is_revealed BOOLEAN DEFAULT 0,
                    reveal_time INTEGER NOT NULL,
                    shutter_identity TEXT NOT NULL,
                    image_cid TEXT NOT NULL,
                    pixelated_image_cid TEXT DEFAULT '',
                    block_number INTEGER,
                    transaction_hash TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_status (
                    id INTEGER PRIMARY KEY CHECK (id = 1),                    last_synced_block INTEGER DEFAULT 0,
                    last_sync_time INTEGER DEFAULT (strftime('%s', 'now')),
                    total_capsules INTEGER DEFAULT 0,
                    sync_errors TEXT DEFAULT ''
                )
            """)
            
            # Insert initial sync status if not exists
            conn.execute("""
                INSERT OR IGNORE INTO sync_status (id, last_synced_block, total_capsules) 
                VALUES (1, 0, 0)
            """)
            
            # Add migration for pixelated_image_cid column if it doesn't exist
            try:
                conn.execute("ALTER TABLE capsules ADD COLUMN pixelated_image_cid TEXT DEFAULT ''")
                print("Added pixelated_image_cid column to existing database")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e).lower():
                    # Column already exists, which is fine
                    pass
                else:
                    print(f"Migration warning: {e}")
            
            conn.commit()
            logger.info("Database initialized successfully")
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def insert_capsule(self, capsule_data: Dict[str, Any]) -> bool:
        """Insert or update a capsule in the database"""
        try:
            with self.get_connection() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO capsules (
                        id, creator, title, tags, encrypted_story, decrypted_story,
                        is_revealed, reveal_time, shutter_identity, image_cid, pixelated_image_cid,
                        block_number, transaction_hash, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
                """, (
                    capsule_data['id'],
                    capsule_data['creator'],
                    capsule_data['title'], 
                    capsule_data['tags'],
                    capsule_data['encrypted_story'],
                    capsule_data['decrypted_story'],
                    capsule_data['is_revealed'],
                    capsule_data['reveal_time'],
                    capsule_data['shutter_identity'],
                    capsule_data['image_cid'],
                    capsule_data.get('pixelated_image_cid', ''),
                    capsule_data.get('block_number'),
                    capsule_data.get('transaction_hash')
                ))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error inserting capsule {capsule_data.get('id')}: {e}")
            return False
    
    def get_capsule(self, capsule_id: int) -> Optional[Dict[str, Any]]:
        """Get a single capsule by ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM capsules WHERE id = ?
                """, (capsule_id,))
                row = cursor.fetchone()
                if row:
                    return dict(row)
                return None
        except Exception as e:
            logger.error(f"Error fetching capsule {capsule_id}: {e}")
            return None
    
    def get_capsules(self, offset: int = 0, limit: int = 10, revealed_only: bool = False) -> List[Dict[str, Any]]:
        """Get multiple capsules with pagination"""
        try:
            with self.get_connection() as conn:
                where_clause = "WHERE is_revealed = 1" if revealed_only else ""
                cursor = conn.execute(f"""
                    SELECT * FROM capsules {where_clause}
                    ORDER BY id DESC LIMIT ? OFFSET ?
                """, (limit, offset))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching capsules: {e}")
            return []
    
    def get_capsule_count(self) -> int:
        """Get total number of capsules"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT COUNT(*) as count FROM capsules")
                return cursor.fetchone()['count']
        except Exception as e:
            logger.error(f"Error getting capsule count: {e}")
            return 0
    
    def update_sync_status(self, last_block: int, total_capsules: int, errors: str = '') -> bool:
        """Update synchronization status"""
        try:
            with self.get_connection() as conn:
                conn.execute("""
                    UPDATE sync_status SET 
                        last_synced_block = ?,
                        last_sync_time = strftime('%s', 'now'),
                        total_capsules = ?,
                        sync_errors = ?
                    WHERE id = 1
                """, (last_block, total_capsules, errors))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating sync status: {e}")
            return False
    
    def get_sync_status(self) -> Dict[str, Any]:
        """Get current synchronization status"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT * FROM sync_status WHERE id = 1")
                row = cursor.fetchone()
                if row:
                    return dict(row)
                return {}
        except Exception as e:
            logger.error(f"Error getting sync status: {e}")
            return {}
    
    def search_capsules(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search capsules by title, tags, or creator"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM capsules 
                    WHERE title LIKE ? OR tags LIKE ? OR creator LIKE ?
                    ORDER BY id DESC LIMIT ?
                """, (f"%{query}%", f"%{query}%", f"%{query}%", limit))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error searching capsules: {e}")
            return []
    
    def get_capsules_by_creator(self, creator_address: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get capsules created by a specific address"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM capsules WHERE creator = ?
                    ORDER BY id DESC LIMIT ?
                """, (creator_address, limit))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching capsules by creator: {e}")
            return []
    
    def get_recent_capsules(self, hours: int = 24, limit: int = 10) -> List[Dict[str, Any]]:
        """Get capsules created in the last N hours"""
        try:
            cutoff_time = int(time.time()) - (hours * 3600)
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM capsules WHERE created_at > ?
                    ORDER BY created_at DESC LIMIT ?
                """, (cutoff_time, limit))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching recent capsules: {e}")
            return []
    
    def close(self):
        """Close database connections (cleanup)"""
        # Connections are automatically closed by context manager
        pass
