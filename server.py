import json
import os
import re
import tempfile
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
STATE_PATH = DATA_DIR / 'state.json'
UPLOAD_DIR = DATA_DIR / 'uploads'
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
IMAGE_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
}
UPLOAD_NAME_PATTERN = re.compile(r'^[0-9a-f]{32}\.(png|jpg|gif|webp)$')


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

    def send_binary(self, status_code, body, content_type):
        self.send_response(status_code)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        if path.startswith('/uploads/'):
            filename = path.removeprefix('/uploads/')
            if not UPLOAD_NAME_PATTERN.fullmatch(filename):
                self.send_json(404, {'error': 'upload_not_found'})
                return
            upload_path = UPLOAD_DIR / filename
            if not upload_path.exists():
                self.send_json(404, {'error': 'upload_not_found'})
                return
            extension = filename.rsplit('.', 1)[-1]
            content_type = {'png': 'image/png', 'jpg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'}[extension]
            try:
                self.send_binary(200, upload_path.read_bytes(), content_type)
            except OSError:
                self.send_json(500, {'error': 'upload_unreadable'})
            return
        super().do_GET()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        if parsed_url.path != '/api/uploads':
            self.send_json(404, {'error': 'not_found'})
            return

        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        extension = IMAGE_TYPES.get(content_type)
        if not extension:
            self.send_json(415, {'error': 'unsupported_image_type'})
            return
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_json(400, {'error': 'invalid_content_length'})
            return
        if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
            self.send_json(413, {'error': 'upload_too_large'})
            return

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        filename = '%s.%s' % (uuid.uuid4().hex, extension)
        upload_path = UPLOAD_DIR / filename
        try:
            upload_path.write_bytes(self.rfile.read(content_length))
            upload_path.chmod(0o600)
        except OSError:
            self.send_json(500, {'error': 'upload_unwritable'})
            return
        original_name = parse_qs(parsed_url.query).get('name', ['截图'])[-1][:160]
        self.send_json(201, {'url': '/uploads/' + filename, 'name': original_name, 'type': content_type})

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

    def do_DELETE(self):
        path = self.request_path()
        if not path.startswith('/api/uploads/'):
            self.send_json(404, {'error': 'not_found'})
            return
        filename = path.removeprefix('/api/uploads/')
        if not UPLOAD_NAME_PATTERN.fullmatch(filename):
            self.send_json(404, {'error': 'upload_not_found'})
            return
        try:
            (UPLOAD_DIR / filename).unlink(missing_ok=True)
        except OSError:
            self.send_json(500, {'error': 'upload_unwritable'})
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
