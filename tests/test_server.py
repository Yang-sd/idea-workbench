import base64
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import server


def valid_state():
    return {
        'version': 4,
        'schemaVersion': 4,
        'revision': 0,
        'ideas': [{
            'id': 'idea-test',
            'title': 'Ideas 2.0 test project',
            'problem': 'Keep project delivery context in one place.',
            'audience': 'Product builders',
            'mvp': 'A project cockpit',
            'nextAction': 'Execute P-001',
            'finishLine': 'Complete the first delivery loop',
            'status': 'try',
            'tags': ['test'],
            'interest': 4,
            'value': 5,
            'ease': 3,
            'experimentStatus': 'in_progress',
            'experimentGoal': 'Verify the workflow',
            'experimentResult': '',
            'files': [],
            'nodes': [{
                'id': 'node-test',
                'code': 'P-001',
                'title': 'Security baseline',
                'content': '',
                'status': 'not_started',
                'attachments': [],
                'children': []
            }],
            'currentNodeId': 'node-test'
        }],
        'focusId': 'idea-test',
        'review': {'wins': '', 'learnings': '', 'next': ''}
    }


class IdeaDeskServerTest(unittest.TestCase):
    def setUp(self):
        self.temporary_data = tempfile.TemporaryDirectory()
        data_dir = Path(self.temporary_data.name)
        server.DATA_DIR = data_dir
        server.STATE_PATH = data_dir / 'state.json'
        server.UPLOAD_DIR = data_dir / 'uploads'
        server.BACKUP_DIR = data_dir / 'backups'
        server.AUTH_USERNAME = ''
        server.AUTH_PASSWORD = ''
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.IdeaDeskHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temporary_data.cleanup()

    def request(self, method, path, payload=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        body = None if payload is None else json.dumps(payload).encode('utf-8')
        request_headers = dict(headers or {})
        if body is not None:
            request_headers.setdefault('Content-Type', 'application/json')
            request_headers.setdefault('Content-Length', str(len(body)))
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        response_body = response.read()
        result = response.status, dict(response.getheaders()), response_body
        connection.close()
        return result

    def test_static_server_only_exposes_allowlisted_assets(self):
        for method in ('GET', 'HEAD'):
            for path in ('/', '/index.html', '/styles.css', '/app.js'):
                status, _, _ = self.request(method, path)
                self.assertEqual(status, 200, '%s %s' % (method, path))
            for path in ('/server.py', '/README.md', '/data/', '/data/state.json', '/data/uploads/'):
                status, _, _ = self.request(method, path)
                self.assertEqual(status, 404, '%s %s' % (method, path))
        _, headers, _ = self.request('GET', '/')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(headers['X-Frame-Options'], 'DENY')
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])

    def test_basic_auth_protects_app_and_api_but_not_health(self):
        server.AUTH_USERNAME = 'owner'
        server.AUTH_PASSWORD = 'correct horse battery staple'
        status, headers, _ = self.request('GET', '/')
        self.assertEqual(status, 401)
        self.assertIn('Basic realm="Idea Desk"', headers['WWW-Authenticate'])
        status, _, _ = self.request('HEAD', '/')
        self.assertEqual(status, 401)
        status, _, body = self.request('GET', '/healthz')
        self.assertEqual((status, body), (200, b'ok'))
        credential = base64.b64encode(b'owner:correct horse battery staple').decode('ascii')
        status, _, _ = self.request('GET', '/', headers={'Authorization': 'Basic ' + credential})
        self.assertEqual(status, 200)

    def test_health_check_detects_corrupt_state(self):
        server.STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        server.STATE_PATH.write_text('{broken', encoding='utf-8')
        status, _, body = self.request('GET', '/healthz')
        self.assertEqual((status, body), (503, b'unhealthy'))

    def test_revision_conflict_prevents_stale_full_state_overwrite(self):
        payload = valid_state()
        status, _, body = self.request('PUT', '/api/state', payload)
        self.assertEqual(status, 428)
        self.assertEqual(json.loads(body), {'error': 'revision_required'})

        status, headers, body = self.request('PUT', '/api/state', payload, {'If-Match': '"0"'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"1"')
        self.assertEqual(json.loads(body)['revision'], 1)

        status, headers, body = self.request(
            'PATCH',
            '/api/ideas/idea-test/nodes/node-test',
            {'status': 'in_progress'},
            {'If-Match': '"1"'}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"2"')
        self.assertEqual(json.loads(body)['revision'], 2)

        status, _, body = self.request('PUT', '/api/state', payload, {'If-Match': '"1"'})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)['currentRevision'], 2)

        status, headers, body = self.request('GET', '/api/state')
        current = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"2"')
        self.assertEqual(current['ideas'][0]['nodes'][0]['status'], 'in_progress')
        self.assertGreaterEqual(len(list(server.BACKUP_DIR.glob('state.*.json'))), 1)

    def test_cross_origin_writes_are_rejected(self):
        status, _, body = self.request(
            'PUT',
            '/api/state',
            valid_state(),
            {'If-Match': '"0"', 'Origin': 'https://attacker.example'}
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body), {'error': 'origin_not_allowed'})
        self.assertFalse(server.STATE_PATH.exists())

    def test_state_validation_rejects_unsafe_upload_urls_and_duplicate_ids(self):
        unsafe = valid_state()
        unsafe['ideas'][0]['files'] = [{
            'id': 'file-test',
            'name': 'unsafe.html',
            'url': 'javascript:alert(1)',
            'type': 'text/html',
            'size': 10,
            'uploadedAt': '2026-08-15T00:00:00Z'
        }]
        status, _, _ = self.request('PUT', '/api/state', unsafe, {'If-Match': '"0"'})
        self.assertEqual(status, 422)

        duplicate = valid_state()
        duplicate['ideas'][0]['nodes'].append(dict(duplicate['ideas'][0]['nodes'][0]))
        status, _, _ = self.request('PUT', '/api/state', duplicate, {'If-Match': '"0"'})
        self.assertEqual(status, 422)


if __name__ == '__main__':
    unittest.main()
