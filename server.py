import base64
import hmac
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
STATE_PATH = DATA_DIR / 'state.json'
UPLOAD_DIR = DATA_DIR / 'uploads'
BACKUP_DIR = DATA_DIR / 'backups'
BACKUP_LIMIT = 25
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
UPLOAD_TYPES = {
    'png': ('image/png', {'image/png'}),
    'jpg': ('image/jpeg', {'image/jpeg'}),
    'gif': ('image/gif', {'image/gif'}),
    'webp': ('image/webp', {'image/webp'}),
    'pdf': ('application/pdf', {'application/pdf'}),
    'txt': ('text/plain; charset=utf-8', {'text/plain'}),
    'md': ('text/markdown; charset=utf-8', {'text/markdown', 'text/plain'}),
    'csv': ('text/csv; charset=utf-8', {'text/csv', 'text/plain', 'application/vnd.ms-excel'}),
    'json': ('application/json; charset=utf-8', {'application/json', 'text/plain'}),
    'doc': ('application/msword', {'application/msword'}),
    'docx': ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }),
    'xls': ('application/vnd.ms-excel', {'application/vnd.ms-excel'}),
    'xlsx': ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    'ppt': ('application/vnd.ms-powerpoint', {'application/vnd.ms-powerpoint'}),
    'pptx': ('application/vnd.openxmlformats-officedocument.presentationml.presentation', {
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }),
    'zip': ('application/zip', {'application/zip', 'application/x-zip-compressed'})
}
UPLOAD_NAME_PATTERN = re.compile(r'^[0-9a-f]{32}\.(' + '|'.join(UPLOAD_TYPES) + r')$')
NODE_STATUSES = {'not_started', 'in_progress', 'completed'}
IDEA_STATUSES = {'inbox', 'try', 'later', 'done'}
EXPERIMENT_STATUSES = {'not_started', 'in_progress', 'completed'}
MAX_IDEAS = 5000
MAX_NODES = 50000
MAX_NODE_DEPTH = 12
STATIC_FILES = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8')
}
AUTH_USERNAME = os.environ.get('IDEA_DESK_USERNAME', '')
AUTH_PASSWORD = os.environ.get('IDEA_DESK_PASSWORD', '')
AUTH_REQUIRED = os.environ.get('IDEA_DESK_REQUIRE_AUTH', '').lower() in {'1', 'true', 'yes'}
STATE_LOCK = threading.RLock()

if bool(AUTH_USERNAME) != bool(AUTH_PASSWORD):
    raise RuntimeError('IDEA_DESK_USERNAME and IDEA_DESK_PASSWORD must be configured together')
if AUTH_REQUIRED and not AUTH_USERNAME:
    raise RuntimeError('Idea Desk authentication is required but credentials are missing')


def read_state():
    with STATE_LOCK:
        with STATE_PATH.open('r', encoding='utf-8') as state_file:
            return json.load(state_file)


def state_revision(payload):
    revision = payload.get('revision', 0) if isinstance(payload, dict) else 0
    return revision if isinstance(revision, int) and revision >= 0 else 0


def etag_for_revision(revision):
    return '"%s"' % revision


def parse_revision_etag(value):
    normalized = (value or '').strip()
    if normalized.startswith('W/'):
        normalized = normalized[2:].strip()
    if normalized.startswith('"') and normalized.endswith('"'):
        normalized = normalized[1:-1]
    return int(normalized) if normalized.isdigit() else None


def write_state(payload):
    with STATE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        file_descriptor, temporary_path = tempfile.mkstemp(prefix='state.', suffix='.tmp', dir=DATA_DIR)
        try:
            with os.fdopen(file_descriptor, 'w', encoding='utf-8') as state_file:
                json.dump(payload, state_file, ensure_ascii=False, indent=2)
                state_file.write('\n')
                state_file.flush()
                os.fsync(state_file.fileno())
            if STATE_PATH.exists():
                BACKUP_DIR.mkdir(parents=True, exist_ok=True)
                backup_name = 'state.r%s.%s.json' % (
                    state_revision(read_state()),
                    datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
                )
                backup_path = BACKUP_DIR / backup_name
                shutil.copy2(STATE_PATH, backup_path)
                backup_path.chmod(0o600)
            os.replace(temporary_path, STATE_PATH)
            STATE_PATH.chmod(0o600)
            backups = sorted(BACKUP_DIR.glob('state.*.json'), key=lambda path: path.stat().st_mtime, reverse=True) if BACKUP_DIR.exists() else []
            for old_backup in backups[BACKUP_LIMIT:]:
                old_backup.unlink(missing_ok=True)
        finally:
            if os.path.exists(temporary_path):
                os.unlink(temporary_path)


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def find_node(nodes, node_id):
    for node in nodes if isinstance(nodes, list) else []:
        if node.get('id') == node_id:
            return node
        match = find_node(node.get('children'), node_id)
        if match:
            return match
    return None


def node_progress(nodes):
    progress = {'total': 0, 'completed': 0, 'inProgress': 0}
    for node in nodes if isinstance(nodes, list) else []:
        progress['total'] += 1
        if node.get('status') == 'completed':
            progress['completed'] += 1
        if node.get('status') == 'in_progress':
            progress['inProgress'] += 1
        child_progress = node_progress(node.get('children'))
        for key in progress:
            progress[key] += child_progress[key]
    progress['percent'] = round(progress['completed'] / progress['total'] * 100) if progress['total'] else 0
    return progress


def bounded_string(value, maximum, allow_empty=True):
    return isinstance(value, str) and len(value) <= maximum and (allow_empty or bool(value.strip()))


def safe_identifier(value):
    return bounded_string(value, 200, allow_empty=False) and re.fullmatch(r'[A-Za-z0-9._:-]+', value) is not None


def valid_upload_metadata(item, maximum_size):
    if not isinstance(item, dict) or not safe_identifier(item.get('id')):
        return False
    if not bounded_string(item.get('name'), 160, allow_empty=False):
        return False
    url = item.get('url')
    if not isinstance(url, str) or (url and (not url.startswith('/uploads/') or not UPLOAD_NAME_PATTERN.fullmatch(url.removeprefix('/uploads/')))):
        return False
    size = item.get('size', 0)
    if isinstance(size, bool) or not isinstance(size, (int, float)) or size < 0 or size > maximum_size:
        return False
    return bounded_string(item.get('type', ''), 160) and bounded_string(item.get('uploadedAt', ''), 64)


def validate_node_tree(nodes, seen_node_ids, counter, depth=0):
    if not isinstance(nodes, list) or depth > MAX_NODE_DEPTH:
        return False
    for node in nodes:
        if not isinstance(node, dict) or not safe_identifier(node.get('id')) or node['id'] in seen_node_ids:
            return False
        seen_node_ids.add(node['id'])
        counter[0] += 1
        if counter[0] > MAX_NODES:
            return False
        if not bounded_string(node.get('code', ''), 32) or not bounded_string(node.get('title'), 160, allow_empty=False):
            return False
        if not bounded_string(node.get('content', ''), 20000) or node.get('status') not in NODE_STATUSES:
            return False
        attachments = node.get('attachments', [])
        if not isinstance(attachments, list) or len(attachments) > 50:
            return False
        if not all(valid_upload_metadata(item, 12 * 1024 * 1024) for item in attachments):
            return False
        if not validate_node_tree(node.get('children', []), seen_node_ids, counter, depth + 1):
            return False
    return True


def validate_state_payload(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('ideas'), list) or len(payload['ideas']) > MAX_IDEAS:
        return False
    seen_idea_ids = set()
    seen_node_ids = set()
    node_counter = [0]
    for idea in payload['ideas']:
        if not isinstance(idea, dict) or not safe_identifier(idea.get('id')) or idea['id'] in seen_idea_ids:
            return False
        seen_idea_ids.add(idea['id'])
        if not bounded_string(idea.get('title'), 160, allow_empty=False) or idea.get('status') not in IDEA_STATUSES:
            return False
        for field, maximum in {
            'problem': 20000,
            'audience': 10000,
            'mvp': 20000,
            'nextAction': 20000,
            'finishLine': 20000,
            'experimentGoal': 20000,
            'experimentResult': 30000
        }.items():
            if not bounded_string(idea.get(field, ''), maximum):
                return False
        if idea.get('experimentStatus', 'not_started') not in EXPERIMENT_STATUSES:
            return False
        for field in ('interest', 'value', 'ease'):
            score = idea.get(field, 3)
            if isinstance(score, bool) or not isinstance(score, (int, float)) or score < 1 or score > 5:
                return False
        tags = idea.get('tags', [])
        if not isinstance(tags, list) or len(tags) > 8 or not all(bounded_string(tag, 80, allow_empty=False) for tag in tags):
            return False
        files = idea.get('files', [])
        if not isinstance(files, list) or len(files) > 200 or not all(valid_upload_metadata(item, MAX_UPLOAD_BYTES) for item in files):
            return False
        idea_node_ids = set()
        before_nodes = set(seen_node_ids)
        if not validate_node_tree(idea.get('nodes', []), seen_node_ids, node_counter):
            return False
        idea_node_ids.update(seen_node_ids - before_nodes)
        current_node_id = idea.get('currentNodeId')
        if current_node_id is not None and current_node_id not in idea_node_ids:
            return False
    focus_id = payload.get('focusId')
    if focus_id is not None and focus_id not in seen_idea_ids:
        return False
    review = payload.get('review', {})
    if not isinstance(review, dict) or not all(bounded_string(review.get(field, ''), 30000) for field in ('wins', 'learnings', 'next')):
        return False
    return True


def storage_healthy():
    try:
        if not DATA_DIR.is_dir() or not os.access(DATA_DIR, os.R_OK | os.W_OK):
            return False
        if STATE_PATH.exists():
            state = read_state()
            if not isinstance(state, dict) or not isinstance(state.get('ideas'), list):
                return False
        for directory in (UPLOAD_DIR, BACKUP_DIR):
            if directory.exists() and (not directory.is_dir() or not os.access(directory, os.R_OK | os.W_OK)):
                return False
        return True
    except (OSError, json.JSONDecodeError):
        return False


class IdeaDeskHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status_code, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_text(self, status_code, body):
        encoded_body = body.encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded_body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(encoded_body)

    def send_binary(self, status_code, body, content_type, filename=None):
        self.send_response(status_code)
        self.send_header('Content-Type', content_type)
        if filename:
            self.send_header('Content-Disposition', 'inline; filename="%s"' % filename)
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def request_path(self):
        return urlparse(self.path).path

    def is_authorized(self):
        if not AUTH_USERNAME or not AUTH_PASSWORD:
            return True
        authorization = self.headers.get('Authorization', '')
        if not authorization.startswith('Basic '):
            return False
        try:
            decoded = base64.b64decode(authorization[6:], validate=True).decode('utf-8')
        except (ValueError, UnicodeDecodeError):
            return False
        username, separator, password = decoded.partition(':')
        return bool(separator) and hmac.compare_digest(username, AUTH_USERNAME) and hmac.compare_digest(password, AUTH_PASSWORD)

    def require_authorization(self):
        if self.request_path() == '/healthz' or self.is_authorized():
            return True
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="Idea Desk", charset="UTF-8"')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()
        return False

    def require_same_origin(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True
        expected_origin = self.absolute_url('').rstrip('/')
        if hmac.compare_digest(origin.rstrip('/'), expected_origin):
            return True
        self.send_json(403, {'error': 'origin_not_allowed'})
        return False

    def send_static(self, path):
        static_file = STATIC_FILES.get(path)
        if not static_file:
            self.send_json(404, {'error': 'not_found'})
            return
        filename, content_type = static_file
        try:
            body = (ROOT / filename).read_bytes()
        except OSError:
            self.send_json(500, {'error': 'static_unreadable'})
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def absolute_url(self, path):
        protocol = self.headers.get('X-Forwarded-Proto', 'http').split(',', 1)[0].strip()
        host = self.headers.get('Host', 'localhost')
        return '%s://%s%s' % (protocol, host, path)

    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        if self.headers.get('X-Forwarded-Proto', '').split(',', 1)[0].strip() == 'https':
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
        super().end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.require_authorization():
            return
        path = self.request_path()
        if path == '/healthz':
            self.send_text(200, 'ok') if storage_healthy() else self.send_text(503, 'unhealthy')
            return
        if path == '/api/state':
            if not STATE_PATH.exists():
                self.send_json(404, {'error': 'state_not_found', 'revision': 0}, {'ETag': etag_for_revision(0)})
                return
            try:
                state = read_state()
                revision = state_revision(state)
                state['revision'] = revision
                self.send_json(200, state, {'ETag': etag_for_revision(revision)})
            except (OSError, json.JSONDecodeError):
                self.send_json(500, {'error': 'state_unreadable'})
            return
        context_match = re.fullmatch(r'/api/ideas/([^/]+)/context', path)
        if context_match:
            try:
                state = read_state()
            except (OSError, json.JSONDecodeError):
                self.send_json(500, {'error': 'state_unreadable'})
                return
            idea_id = unquote(context_match.group(1))
            idea = next((item for item in state.get('ideas', []) if item.get('id') == idea_id), None)
            if not idea:
                self.send_json(404, {'error': 'idea_not_found'})
                return
            project_files = []
            for item in idea.get('files', []) if isinstance(idea.get('files'), list) else []:
                project_files.append({**item, 'downloadUrl': self.absolute_url(item.get('url', ''))})
            node_files = []

            def collect_node_files(nodes):
                for node in nodes if isinstance(nodes, list) else []:
                    for item in node.get('attachments', []) if isinstance(node.get('attachments'), list) else []:
                        node_files.append({
                            **item,
                            'nodeId': node.get('id'),
                            'nodeCode': node.get('code'),
                            'nodeTitle': node.get('title'),
                            'downloadUrl': self.absolute_url(item.get('url', ''))
                        })
                    collect_node_files(node.get('children'))

            collect_node_files(idea.get('nodes'))
            encoded_idea_id = quote(idea_id, safe='')
            self.send_json(200, {
                'version': 1,
                'stateRevision': state_revision(state),
                'generatedAt': utc_now(),
                'projectPageUrl': self.absolute_url('/#/idea/' + encoded_idea_id),
                'idea': idea,
                'progress': node_progress(idea.get('nodes')),
                'projectFiles': project_files,
                'nodeFiles': node_files,
                'progressUpdate': {
                    'method': 'PATCH',
                    'endpointTemplate': self.absolute_url('/api/ideas/' + encoded_idea_id + '/nodes/{nodeId}'),
                    'fields': ['status', 'content'],
                    'statuses': sorted(NODE_STATUSES)
                }
            })
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
            content_type = UPLOAD_TYPES[extension][0]
            try:
                self.send_binary(200, upload_path.read_bytes(), content_type, filename)
            except OSError:
                self.send_json(500, {'error': 'upload_unreadable'})
            return
        self.send_static(path)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if not self.require_authorization() or not self.require_same_origin():
            return
        parsed_url = urlparse(self.path)
        if parsed_url.path != '/api/uploads':
            self.send_json(404, {'error': 'not_found'})
            return

        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        original_name = Path(parse_qs(parsed_url.query).get('name', ['file'])[-1]).name[:160]
        extension = Path(original_name).suffix.lower().removeprefix('.')
        if extension == 'jpeg':
            extension = 'jpg'
        upload_type = UPLOAD_TYPES.get(extension)
        if not upload_type or (content_type not in upload_type[1] and content_type != 'application/octet-stream'):
            self.send_json(415, {'error': 'unsupported_file_type'})
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
        self.send_json(201, {
            'url': '/uploads/' + filename,
            'name': original_name,
            'type': upload_type[0].split(';', 1)[0],
            'size': content_length,
            'uploadedAt': utc_now()
        })

    def do_PUT(self):
        if not self.require_authorization() or not self.require_same_origin():
            return
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
        if not validate_state_payload(payload):
            self.send_json(422, {'error': 'invalid_state'})
            return
        expected_revision = parse_revision_etag(self.headers.get('If-Match'))
        if expected_revision is None:
            self.send_json(428, {'error': 'revision_required'})
            return
        try:
            with STATE_LOCK:
                current_state = read_state() if STATE_PATH.exists() else {}
                current_revision = state_revision(current_state)
                if expected_revision != current_revision:
                    self.send_json(409, {
                        'error': 'revision_conflict',
                        'currentRevision': current_revision
                    }, {'ETag': etag_for_revision(current_revision)})
                    return
                next_revision = current_revision + 1
                state = {
                    'version': payload.get('version', 2),
                    'schemaVersion': payload.get('schemaVersion', payload.get('version', 2)),
                    'revision': next_revision,
                    'ideas': payload['ideas'],
                    'focusId': payload.get('focusId'),
                    'review': payload.get('review') if isinstance(payload.get('review'), dict) else {}
                }
                write_state(state)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {'error': 'state_unwritable'})
            return
        self.send_json(200, {'ok': True, 'revision': next_revision}, {'ETag': etag_for_revision(next_revision)})

    def do_PATCH(self):
        if not self.require_authorization() or not self.require_same_origin():
            return
        match = re.fullmatch(r'/api/ideas/([^/]+)/nodes/([^/]+)', self.request_path())
        if not match:
            self.send_json(404, {'error': 'not_found'})
            return
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_json(400, {'error': 'invalid_content_length'})
            return
        if content_length <= 0 or content_length > 64 * 1024:
            self.send_json(413, {'error': 'payload_too_large'})
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {'error': 'invalid_json'})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {'error': 'invalid_json'})
            return
        try:
            with STATE_LOCK:
                state = read_state()
                current_revision = state_revision(state)
                expected_revision = parse_revision_etag(self.headers.get('If-Match'))
                if self.headers.get('If-Match') and expected_revision != current_revision:
                    self.send_json(409, {
                        'error': 'revision_conflict',
                        'currentRevision': current_revision
                    }, {'ETag': etag_for_revision(current_revision)})
                    return
                idea_id = unquote(match.group(1))
                node_id = unquote(match.group(2))
                idea = next((item for item in state.get('ideas', []) if item.get('id') == idea_id), None)
                node = find_node(idea.get('nodes'), node_id) if idea else None
                if not idea or not node:
                    self.send_json(404, {'error': 'node_not_found'})
                    return
                changed = False
                if 'status' in payload:
                    if payload['status'] not in NODE_STATUSES:
                        self.send_json(400, {'error': 'invalid_node_status'})
                        return
                    node['status'] = payload['status']
                    changed = True
                if 'content' in payload:
                    if not isinstance(payload['content'], str) or len(payload['content']) > 20000:
                        self.send_json(400, {'error': 'invalid_node_content'})
                        return
                    node['content'] = payload['content'].strip()
                    changed = True
                if not changed:
                    self.send_json(400, {'error': 'no_supported_fields'})
                    return
                now = utc_now()
                node['updatedAt'] = now
                idea['updatedAt'] = now
                next_revision = current_revision + 1
                state['revision'] = next_revision
                write_state(state)
                progress = node_progress(idea.get('nodes'))
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {'error': 'state_unreadable'})
            return
        self.send_json(200, {
            'ok': True,
            'revision': next_revision,
            'node': node,
            'progress': progress
        }, {'ETag': etag_for_revision(next_revision)})

    def do_DELETE(self):
        if not self.require_authorization() or not self.require_same_origin():
            return
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
        if not self.require_authorization():
            return
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
