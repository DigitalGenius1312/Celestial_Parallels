import os
import socket
import sys
import threading
import time
import webbrowser
import uvicorn
from script import app

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

PORT = get_free_port()

def run_server():
    uvicorn_config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=PORT,
        log_config=None
    )
    server = uvicorn.Server(uvicorn_config)
    server.run()

if __name__ == '__main__':
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    time.sleep(1.5)

    url = f"http://127.0.0.1:{PORT}/"
    webbrowser.open(url)

    try:
        while server_thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        pass
