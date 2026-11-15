import os
import sys
import threading
import time
import webbrowser
import uvicorn
from script import app  # Imports your FastAPI instance from script.py

def run_server():
    # Run FastAPI locally on loopback port 8000
    uvicorn_config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="error")
    server = uvicorn.Server(uvicorn_config)
    server.run()

if __name__ == '__main__':
    # 1. Start FastAPI server in a background daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 2. Give the server a brief moment to spin up
    time.sleep(1.0)

    # 3. Open your fully GPU-accelerated default browser to the local app
    url = "http://127.0.0.1:8000/"
    print(f"--- Planetary Analog Explorer Running ---")
    print(f"Opening local app at: {url}")
    webbrowser.open(url)

    # Keep the script running while the server and app are active
    try:
        while server_thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down application...")
