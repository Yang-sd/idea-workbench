import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
STATE_PATH = DATA_DIR / 'state.json'
MAX_BODY_BYTES = 4 * 1024 * 1024


def read_state():
    with STATE_PATH.open('r', encoding='utf-8') as state_file:
        return json.load(state_file)


def write_state(payload):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_path = tempfile.mkstemp(prefix='state.', suffix='.tmp', dir=DATA_DIR)
    try:
        with os.fdopen(file_descriptor, 'w', encoding='utf-8') as state_file:
            json.dump(payload, state_file, ensure_ascii=False, indent=2)
            state_file.write('\n')
            state_file.flush()
            os.fsync(state_file.fileno())
        os.replace(temporary_path, STATE_PATH)
        STATE_PATH.chmod(0o600)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


class IdeaDeskHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status_code, body):
        encoded_body = body.encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded_body)))
        self.end_headers()
        self.wfile.write(encoded_body)

    def request_path(self):
        return urlparse(self.path).path

    def end_headers(self):
        path = self.request_path()
        if path.endswith(('.html', '.css', '.js')):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.request_path()
        if path == '/healthz':
            self.send_text(200, 'ok')
            return
        if path == '/api/state':
            if not STATE_PATH.exists():
                self.send_json(404, {'error': 'state_not_found'})
                return
            try:
                self.send_json(200, read_state())
            except (OSError, json.JSONDecodeError):
                self.send_json(500, {'error': 'state_unreadable'})
            return
        super().do_GET()

    def do_PUT(self):
        if self.request_path() != '/api/state':
            self.send_json(404, {'error': 'not_found'})
            return

        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_json(400, {'error': 'invalid_content_length'})
            return
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self.send_json(413, {'error': 'payload_too_large'})
            return

        try:
            payload = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {'error': 'invalid_json'})
            return
        if not isinstance(payload, dict) or not isinstance(payload.get('ideas'), list):
            self.send_json(400, {'error': 'invalid_state'})
            return

        state = {
            'version': payload.get('version', 2),
            'ideas': payload['ideas'],
            'focusId': payload.get('focusId'),
            'review': payload.get('review') if isinstance(payload.get('review'), dict) else {}
        }
        try:
            write_state(state)
        except OSError:
            self.send_json(500, {'error': 'state_unwritable'})
            return
        self.send_json(200, {'ok': True})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    def log_message(self, format_string, *args):
        print('%s - - [%s] %s' % (self.address_string(), self.log_date_time_string(), format_string % args))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8124'))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('0.0.0.0', port), IdeaDeskHandler)
    print('Idea Desk listening on port %s' % port, flush=True)
    server.serve_forever()
