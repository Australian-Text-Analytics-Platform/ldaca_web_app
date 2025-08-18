#!/usr/bin/env python3
"""
Database migration script to add user_folder_path column
"""
import sqlite3
import sys
from pathlib import Path

def migrate_database():
    """Add user_folder_path column to existing database"""
    db_path = Path("data/users.db")
    
    if not db_path.exists():
        print("❌ Database file not found. Run the app first to create it.")
        return False
    
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # Check if column already exists
        cursor.execute("PRAGMA table_info(user)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'user_folder_path' in columns:
            print("✅ user_folder_path column already exists")
            conn.close()
            return True
        
        # Add the new column
        cursor.execute("ALTER TABLE user ADD COLUMN user_folder_path VARCHAR(512)")
        
        # For existing users, set their folder path based on their ID
        cursor.execute("SELECT id FROM user")
        users = cursor.fetchall()
        
        for (user_id,) in users:
            folder_path = f"data/user_{user_id}"
            cursor.execute("UPDATE user SET user_folder_path = ? WHERE id = ?", (folder_path, user_id))
            print(f"✅ Updated user {user_id} folder path to: {folder_path}")
        
        conn.commit()
        conn.close()
        
        print("✅ Database migration completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False

if __name__ == "__main__":
    success = migrate_database()
    sys.exit(0 if success else 1)
