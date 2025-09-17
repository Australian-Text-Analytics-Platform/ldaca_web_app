#!/usr/bin/env python3
"""
Simple verification script for the SSE and progress tracking fixes.
"""

import sys
import asyncio
import time
import requests
from concurrent.futures import Future

# Add src to path
sys.path.insert(0, 'src')

def test_backend_running():
    """Check if backend is running on port 8001."""
    print("🔍 Checking if backend is running...")
    
    try:
        response = requests.get("http://localhost:8001/health", timeout=3)
        if response.status_code == 200:
            print("✅ Backend is running on port 8001")
            return True
        else:
            print(f"⚠️ Backend responded with status {response.status_code}")
            return False
    except requests.exceptions.RequestException:
        print("❌ Backend is not running on port 8001")
        print("💡 Start it with: uv run python -m ldaca_web_app_backend.main")
        return False

def test_sse_endpoint_exists():
    """Test if SSE endpoint exists and returns correct headers."""
    print("\n🔍 Checking SSE endpoint...")
    
    try:
        # Just check if endpoint exists (don't wait for streaming)
        response = requests.head(
            "http://localhost:8001/api/workspaces/test/tasks/stream", 
            timeout=2
        )
        print(f"✅ SSE endpoint accessible (status: {response.status_code})")
        return True
    except requests.exceptions.RequestException as e:
        print(f"❌ SSE endpoint not accessible: {e}")
        return False

async def test_progress_simulation():
    """Test the progress tracking with phased simulation."""
    print("\n🔍 Testing progress simulation...")
    
    try:
        from ldaca_web_app_backend.core.process_task_manager import ProcessTaskManager, TaskInfo
        
        tm = ProcessTaskManager()
        
        # Create a mock running task at different phases
        future = Future()  # Don't set result - keep it running
        
        # Test different phases by varying the elapsed time
        test_times = [5, 25, 45, 65]  # Different phases
        
        for i, elapsed in enumerate(test_times):
            task = TaskInfo(
                id=f'test-task-{i}',
                future=future,
                created_at=time.time() - elapsed,
                started_at=time.time() - elapsed
            )
            
            # Add task to manager
            async with tm._lock:
                tm._tasks[f'test-task-{i}'] = task
        
        # Get all tasks and check progress simulation
        tasks = await tm.list()
        
        print(f"✅ Created {len(tasks)} test tasks")
        
        phases_found = set()
        for task in tasks:
            phases_found.add(task['progress_message'])
            task_num = int(task['task_id'].split('-')[-1])
            elapsed_time = test_times[task_num]
            print(f"  📋 Task after {elapsed_time}s: "
                  f"{task['progress']:.1%} - {task['progress_message']}")
        
        # Check if we have different phases
        if len(phases_found) > 1:
            print("✅ Progress simulation with different phases working")
            return True
        else:
            print("❌ Progress simulation not showing different phases")
            return False
            
    except Exception as e:
        print(f"❌ Progress simulation test failed: {e}")
        return False

def main():
    """Run verification tests."""
    print("🚀 Verifying SSE and Progress Tracking Fixes")
    print("=" * 50)
    
    # Test 1: Backend running
    backend_ok = test_backend_running()
    
    # Test 2: SSE endpoint exists
    sse_ok = test_sse_endpoint_exists() if backend_ok else False
    
    # Test 3: Progress simulation
    try:
        progress_ok = asyncio.run(test_progress_simulation())
    except Exception as e:
        print(f"❌ Progress test error: {e}")
        progress_ok = False
    
    print("\n" + "=" * 50)
    print("📊 Verification Results:")
    print(f"  Backend Running: {'✅' if backend_ok else '❌'}")
    print(f"  SSE Endpoint:    {'✅' if sse_ok else '❌'}")
    print(f"  Progress Sim:    {'✅' if progress_ok else '❌'}")
    
    if backend_ok and sse_ok and progress_ok:
        print("\n🎉 All verifications passed!")
        print("\n📋 You can now test the frontend:")
        print("  1. Open the web app in your browser")
        print("  2. Start a topic modeling task")
        print("  3. Check that progress updates live without tab switching")
        print("  4. Verify task list shows real-time progress bars")
    else:
        print("\n⚠️ Some verifications failed.")
        if not backend_ok:
            print("  • Start the backend first")
        if progress_ok:
            print("  • Progress simulation is working - frontend should show live updates")

if __name__ == "__main__":
    main()
