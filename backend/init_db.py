#!/usr/bin/env python3
"""
Initialize database with proper schema
"""
import asyncio
from db import create_db_and_tables

async def main():
    """Initialize the database"""
    try:
        await create_db_and_tables()
        print("✅ Database initialized successfully")
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
