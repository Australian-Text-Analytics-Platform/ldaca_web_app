#!/usr/bin/env python3
"""
Test script to debug task creation and SSE events.
"""

import sys
import asyncio
import time
import requests

# Add src to path
sys.path.insert(0, 'src')

from ldaca_web_app_backend.core.workspace import workspace_manager

async def test_task_creation():
    """Test if task creation works and emits events."""
    user_id = "root"  # Use real user
    workspace_id = "aaac1dcf-1d8d-40be-8bde-d1556cbdc4ef"  # Try different workspace
    
    # Get task manager
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    
    print(f"Task manager created for {user_id}/{workspace_id}")
    
    # Subscribe to events
    queue = await tm.subscribe(user_id, workspace_id)
    print("Subscribed to events")
    
    # Create a simple task
    try:
        print("Submitting topic modeling task...")
        task_info = await tm.submit_topic_modeling(
            user_id=user_id,
            workspace_id=workspace_id,
            node_ids=["node1"],
            node_columns={"node1": "text"},
            min_topic_size=5,
            use_ctfidf=False
        )
        print(f"Task submitted: {task_info.id}")
        
        # Wait for initial event
        print("Waiting for events...")
        try:
            event = await asyncio.wait_for(queue.get(), timeout=2.0)
            print(f"Received event: {event}")
        except asyncio.TimeoutError:
            print("No event received within 2 seconds")
        
        # Check if there are more events
        for i in range(3):
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
                print(f"Progress event {i+1}: {event}")
            except asyncio.TimeoutError:
                print(f"No more events after {i+1} seconds")
                break
    
    except Exception as e:
        print(f"Error submitting task: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_task_creation())
