import os
import socket
import sys
import threading
import time
import webbrowser
import uvicorn
from script import app  # Imports your FastAPI instance from script.py

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

PORT = get_free_port()

def run_server():
    uvicorn_config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="error")
    server = uvicorn.Server(uvicorn_config)
    server.run()

if __name__ == '__main__':
    # 1. Start FastAPI server in a background daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 2. Give the server a brief moment to spin up
    time.sleep(1.5)

    # 3. Open your default browser to the dynamically chosen free port
    url = f"http://127.0.0.1:{PORT}/"
    print(f"--- Planetary Analog Explorer Running ---")
    print(f"Opening local app at: {url}")
    webbrowser.open(url)

    # Keep the script running while the server and app are active
    try:
        while server_thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down application...")
