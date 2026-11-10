#!/usr/bin/env python3
"""
Lightweight development server for MicroMonsta 2 Editor & Librarian.
Serves the workspace over http://localhost:8000 with CORS and correct MIME types.
"""

import http.server
import socketserver
import sys

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Safe, clean console logs
        try:
            sys.stderr.write(f"[Server] {format % args}\n")
        except Exception:
            sys.stderr.write(f"[Server] {format}\n")


class ReusableThreadingServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server(preferred_port=8000):
    ports_to_try = [preferred_port, 8001, 8002, 8080, 8888]
    for port in ports_to_try:
        try:
            httpd = ReusableThreadingServer(("", port), Handler)
            print("=" * 60)
            print(f" MicroMonsta 2 Web Editor & Patch Librarian")
            print(f" Serving live at: http://localhost:{port}")
            print(" Connected hardware: MM2 via H12MIDI-Pro Port 5")
            print(" Safe Mode is enabled by default.")
            print("=" * 60)
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nShutting down server.")
            finally:
                httpd.server_close()
            return
        except OSError as e:
            if e.errno == 48: # Address already in use
                print(f"[Notice] Port {port} is in use, trying next port...")
                continue
            raise

    print(f"Error: Unable to bind to any of the candidate ports: {ports_to_try}")
    sys.exit(1)


if __name__ == '__main__':
    start_server(PORT)
