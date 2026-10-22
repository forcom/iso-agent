"""Private Container API. The Worker supplies and validates the current snapshot."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

from wirelog import authorize, health, query_graph

MAX_BODY_BYTES = 32 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != '/health':
            return self.respond(404, {'error': {'code': 'NOT_FOUND'}})
        try:
            return self.respond(200, health())
        except Exception:
            return self.respond(503, {'error': {'code': 'ENGINE_UNAVAILABLE'}})

    def do_POST(self):
        if self.path not in {'/query', '/authorize'}:
            return self.respond(404, {'error': {'code': 'NOT_FOUND'}})
        if self.headers.get_content_type() != 'application/json':
            return self.respond(415, {'error': {'code': 'JSON_REQUIRED'}})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY_BYTES:
                return self.respond(413, {'error': {'code': 'INVALID_BODY_SIZE'}})
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('INVALID_REQUEST')
            result = query_graph(request) if self.path == '/query' else authorize(request)
            return self.respond(200, result)
        except ValueError as error:
            code = str(error)
            status = 409 if 'CURSOR' in code or 'CONTEXT_MISMATCH' in code else 422
            if code == 'RULES_MISMATCH':
                status = 503
            return self.respond(status, {'error': {'code': code if code.isupper() else 'INVALID_REQUEST'}})
        except (KeyError, TypeError, AttributeError):
            return self.respond(422, {'error': {'code': 'INVALID_REQUEST'}})
        except Exception:
            return self.respond(503, {'error': {'code': 'ENGINE_UNAVAILABLE'}})

    def log_message(self, format, *args):
        # Request snapshots and source text must never enter Container access logs.
        pass


if __name__ == '__main__':
    HTTPServer((os.environ.get('HOST', '0.0.0.0'), int(os.environ.get('PORT', '8080'))), Handler).serve_forever()
