#!/usr/bin/env python3
# STEP local dev/preview server. Serves this folder; binds to localhost only.
# For public hosting use any static server (e.g. Cloudflare Pages) — the game
# is fully static. POST /save is enabled only when STEP_DEV=1 is set.
import os, functools, http.server

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('STEP_PORT', '8765'))
DEV = os.environ.get('STEP_DEV') == '1'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        path, _, q = self.path.partition('?')
        if not DEV or path != '/save':
            self.send_error(403); return
        qs = dict(p.split('=', 1) for p in q.split('&') if '=' in p)
        name = qs.get('name', '')
        if not name.replace('.', '').replace('_', '').isalnum():
            self.send_error(400); return
        n = int(self.headers.get('Content-Length', 0))
        os.makedirs(os.path.join(ROOT, 'models', 'clips'), exist_ok=True)
        with open(os.path.join(ROOT, 'models', 'clips', name), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers()

    def log_message(self, *a): pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT),
        functools.partial(Handler, directory=ROOT)).serve_forever()
