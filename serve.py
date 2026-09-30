"""Launch the local game and serve fresh files on each start."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
from urllib.parse import urlencode, urlsplit
import re
import time
import webbrowser


HOST = "127.0.0.1"
PORT = 8000
IMPORT_RE = re.compile(r"(\bfrom\s*['\"]|\bimport\s*['\"])(\./[^'\"]+?\.js)(['\"])")


class FreshFilesHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ("/", "/index.html") and (not path.endswith(".js") or path.startswith("/vendor/")):
            return super().do_GET()

        file_path = Path(self.translate_path(self.path))
        if file_path.is_dir():
            file_path /= "index.html"
        if not file_path.is_file():
            return super().do_GET()

        source = file_path.read_text(encoding="utf-8")
        version = self.server.asset_version
        if path in ("/", "/index.html"):
            source = source.replace('href="./style.css"', f'href="./style.css?fresh={version}"')
            source = source.replace('src="./main.js"', f'src="./main.js?fresh={version}"')
            content_type = "text/html; charset=utf-8"
        else:
            source = IMPORT_RE.sub(lambda match: f"{match[1]}{match[2]}?fresh={version}{match[3]}", source)
            content_type = "text/javascript; charset=utf-8"

        payload = source.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_head(self):
        # SimpleHTTPRequestHandler otherwise replies 304 to a cached module.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), FreshFilesHandler)
    except OSError as error:
        print(f"Cannot start cloud&hill on port {PORT}: {error}", flush=True)
        return 1

    server.asset_version = str(time.time_ns())
    url = f"http://{HOST}:{PORT}/?{urlencode({'fresh': server.asset_version})}"
    print(f"cloud&hill is opening at {url}", flush=True)
    print("Keep this window open while playing. Press Ctrl+C to stop the game server.", flush=True)
    Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
