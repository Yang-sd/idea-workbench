import base64
import copy
import http.client
import json
import smtplib
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import server


def valid_state():
    return {
        'version': 5,
        'schemaVersion': 5,
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
            'completedAt': None,
            'files': [],
            'nodes': [{
                'id': 'node-test',
                'code': 'P-001',
                'title': 'Security baseline',
                'content': '',
                'status': 'not_started',
                'completedAt': None,
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
        self.weekly_configuration = {
            name: getattr(server, name)
            for name in (
                'WEEKLY_REPORT_ENABLED', 'WEEKLY_MAX_ATTEMPTS', 'WEEKLY_RETRY_SECONDS',
                'SMTP_SECURITY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD',
                'SMTP_FROM', 'SMTP_RECIPIENTS', 'SMTP_TIMEOUT_SECONDS'
            )
        }
        server.WEEKLY_REPORT_ENABLED = False
        server.WEEKLY_MAX_ATTEMPTS = 3
        server.WEEKLY_RETRY_SECONDS = 0
        server.SMTP_SECURITY = 'starttls'
        server.SMTP_HOST = ''
        server.SMTP_PORT = 587
        server.SMTP_USERNAME = ''
        server.SMTP_PASSWORD = ''
        server.SMTP_FROM = ''
        server.SMTP_RECIPIENTS = ()
        server.SMTP_TIMEOUT_SECONDS = 3
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.IdeaDeskHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temporary_data.cleanup()
        for name, value in self.weekly_configuration.items():
            setattr(server, name, value)

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

    def configure_weekly_email(self, security='starttls'):
        server.WEEKLY_REPORT_ENABLED = True
        server.SMTP_SECURITY = security
        server.SMTP_HOST = 'smtp.internal.example'
        server.SMTP_PORT = 465 if security == 'ssl' else 587
        server.SMTP_USERNAME = 'weekly-service'
        server.SMTP_PASSWORD = 'smtp-password-must-not-persist'
        server.SMTP_FROM = 'ideas@example.test'
        server.SMTP_RECIPIENTS = ('owner@example.test',)

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

    def test_weekly_window_next_run_and_report_statistics(self):
        state = valid_state()
        state['ideas'][0].update({
            'createdAt': '2026-08-04T02:00:00Z',
            'updatedAt': '2026-08-09T03:00:00Z'
        })
        root = state['ideas'][0]['nodes'][0]
        root.update({'status': 'in_progress', 'createdAt': '2026-08-04T02:00:00Z'})
        root['children'] = [{
            'id': 'node-child',
            'code': 'P-002',
            'title': 'Finish the baseline',
            'content': '',
            'status': 'completed',
            'completedAt': '2026-08-08T02:00:00Z',
            'attachments': [],
            'children': [],
            'createdAt': '2026-08-05T02:00:00Z',
            'updatedAt': '2026-08-08T02:00:00Z'
        }]
        state['ideas'][0]['currentNodeId'] = 'node-child'
        completed = dict(valid_state()['ideas'][0])
        completed.update({
            'id': 'idea-completed',
            'title': 'Completed project',
            'status': 'done',
            'createdAt': '2026-07-01T00:00:00Z',
            'updatedAt': '2026-08-08T03:00:00Z',
            'completedAt': '2026-08-08T03:00:00Z',
            'currentNodeId': 'node-completed'
        })
        completed['nodes'] = [{
            'id': 'node-completed',
            'code': 'P-001',
            'title': 'Delivered',
            'content': '',
            'status': 'completed',
            'completedAt': '2026-07-31T02:00:00Z',
            'attachments': [],
            'children': []
        }]
        state['ideas'].append(completed)
        now = datetime(2026, 8, 10, 1, 0, tzinfo=timezone.utc)

        week_start, week_end = server.previous_week_window(now)
        self.assertEqual(week_start.isoformat(), '2026-08-03T00:00:00+08:00')
        self.assertEqual(week_end.isoformat(), '2026-08-10T00:00:00+08:00')
        self.assertEqual(server.next_weekly_run(now).isoformat(), '2026-08-17T09:00:00+08:00')
        before_run = datetime(2026, 8, 10, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(server.next_weekly_run(before_run).isoformat(), '2026-08-10T09:00:00+08:00')

        report = server.build_weekly_report(state, now)
        self.assertEqual(report['weekStart'], '2026-08-03')
        self.assertEqual(report['weekEnd'], '2026-08-10')
        self.assertEqual(report['summary'], {
            'newIdeas': 1,
            'updatedIdeas': 2,
            'completedIdeas': 1,
            'inProgressProjects': 1,
            'completedNodes': 1,
            'inProgressNodes': 1
        })
        project = report['projects'][0]
        self.assertEqual(project['durationDays'], 6)
        self.assertEqual(project['currentPhase']['code'], 'P-001')
        self.assertEqual(project['currentNode']['code'], 'P-002')
        self.assertEqual(project['currentNodeSource'], 'selected')
        self.assertEqual(report['items']['limitPerCategory'], 100)
        self.assertEqual([item['ideaId'] for item in report['items']['newIdeas']], ['idea-test'])
        self.assertEqual(
            {item['ideaId'] for item in report['items']['updatedIdeas']},
            {'idea-test', 'idea-completed'}
        )
        self.assertEqual([item['ideaId'] for item in report['items']['completedIdeas']], ['idea-completed'])
        self.assertEqual([item['nodeId'] for item in report['items']['completedNodes']], ['node-child'])
        self.assertEqual(report['items']['truncated'], {
            'newIdeas': 0,
            'updatedIdeas': 0,
            'completedIdeas': 0,
            'completedNodes': 0,
            'inProgressProjects': 0
        })
        self.assertTrue(server.valid_weekly_report(report))

    def test_weekly_reports_survive_legacy_full_state_writes_and_upgrade_to_v5(self):
        initial = valid_state()
        initial['revision'] = 7
        report = server.build_weekly_report(initial, datetime(2026, 8, 10, 1, 0, tzinfo=timezone.utc))
        report['delivery'].update({'status': 'sent', 'attempts': 1, 'sentAt': '2026-08-10T01:00:00Z'})
        initial['weeklyReports'] = [report]
        server.write_state(initial)

        current_revision = 7
        for legacy_version in (3, 4):
            with self.subTest(legacy_version=legacy_version):
                legacy_payload = valid_state()
                legacy_payload['version'] = legacy_version
                legacy_payload['schemaVersion'] = legacy_version
                legacy_payload.pop('weeklyReports', None)
                status, headers, body = self.request(
                    'PUT', '/api/state', legacy_payload,
                    {'If-Match': '"%s"' % current_revision}
                )
                current_revision += 1
                self.assertEqual(status, 200)
                self.assertEqual(headers['ETag'], '"%s"' % current_revision)
                self.assertEqual(json.loads(body)['revision'], current_revision)

                saved = server.read_state()
                self.assertEqual(saved['version'], 5)
                self.assertEqual(saved['schemaVersion'], 5)
                self.assertEqual(saved['weeklyReports'][0]['id'], report['id'])

        invalid = valid_state()
        invalid['weeklyReports'] = [{'id': 'weekly-broken'}]
        status, _, body = self.request(
            'PUT', '/api/state', invalid,
            {'If-Match': '"%s"' % current_revision}
        )
        self.assertEqual(status, 422)
        self.assertEqual(json.loads(body), {'error': 'invalid_state'})

    def test_patch_tracks_completed_at_lifecycle_and_upgrades_state(self):
        state = valid_state()
        state.update({'version': 3, 'schemaVersion': 3, 'revision': 4})
        server.write_state(state)

        status, headers, body = self.request(
            'PATCH',
            '/api/ideas/idea-test/nodes/node-test',
            {'status': 'completed'},
            {'If-Match': '"4"'}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"5"')
        completed_at = json.loads(body)['node']['completedAt']
        self.assertIsNotNone(server.parse_timestamp(completed_at))

        status, headers, body = self.request(
            'PATCH',
            '/api/ideas/idea-test/nodes/node-test',
            {'status': 'completed'},
            {'If-Match': '"5"'}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"6"')
        self.assertEqual(json.loads(body)['node']['completedAt'], completed_at)

        status, headers, body = self.request(
            'PATCH',
            '/api/ideas/idea-test/nodes/node-test',
            {'status': 'in_progress'},
            {'If-Match': '"6"'}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers['ETag'], '"7"')
        self.assertIsNone(json.loads(body)['node']['completedAt'])
        saved = server.read_state()
        self.assertEqual((saved['version'], saved['schemaVersion']), (5, 5))
        self.assertIsNone(saved['ideas'][0]['nodes'][0]['completedAt'])

        saved.update({'version': 3, 'schemaVersion': 3, 'revision': 8})
        legacy_node = saved['ideas'][0]['nodes'][0]
        legacy_node.update({
            'status': 'completed',
            'completedAt': 'invalid-legacy-timestamp',
            'updatedAt': 'also-invalid'
        })
        server.write_state(saved)
        status, _, body = self.request(
            'PATCH',
            '/api/ideas/idea-test/nodes/node-test',
            {'content': 'Backfill completion metadata'},
            {'If-Match': '"8"'}
        )
        self.assertEqual(status, 200)
        self.assertIsNotNone(server.parse_timestamp(json.loads(body)['node']['completedAt']))
        self.assertEqual(server.read_state()['version'], 5)

    def test_weekly_report_caps_details_and_preserves_summary_totals(self):
        state = valid_state()
        state['ideas'] = []
        in_window = '2026-08-08T02:00:00Z'
        before_window = '2026-08-01T02:00:00Z'

        for index in range(105):
            completed_idea = copy.deepcopy(valid_state()['ideas'][0])
            completed_idea.update({
                'id': 'idea-completed-%03d' % index,
                'title': 'Completed project %03d' % index,
                'status': 'done',
                'createdAt': in_window,
                'updatedAt': in_window,
                'completedAt': in_window,
                'currentNodeId': 'node-completed-%03d' % index
            })
            completed_idea['nodes'] = [{
                'id': 'node-completed-%03d' % index,
                'code': 'P-001',
                'title': 'Completed node %03d' % index,
                'content': '',
                'status': 'completed',
                'completedAt': in_window,
                'attachments': [],
                'children': []
            }]
            state['ideas'].append(completed_idea)

            active_idea = copy.deepcopy(valid_state()['ideas'][0])
            active_idea.update({
                'id': 'idea-active-%03d' % index,
                'title': 'Active project %03d' % index,
                'status': 'try',
                'createdAt': before_window,
                'updatedAt': before_window,
                'currentNodeId': 'node-active-%03d' % index
            })
            active_idea['nodes'] = [{
                'id': 'node-active-%03d' % index,
                'code': 'P-001',
                'title': 'Active node %03d' % index,
                'content': '',
                'status': 'in_progress',
                'completedAt': None,
                'attachments': [],
                'children': []
            }]
            state['ideas'].append(active_idea)

        report = server.build_weekly_report(
            state,
            datetime(2026, 8, 10, 1, 0, tzinfo=timezone.utc)
        )
        self.assertEqual(report['summary'], {
            'newIdeas': 105,
            'updatedIdeas': 105,
            'completedIdeas': 105,
            'inProgressProjects': 105,
            'completedNodes': 105,
            'inProgressNodes': 105
        })
        self.assertEqual(len(report['projects']), 100)
        for field in ('newIdeas', 'updatedIdeas', 'completedIdeas', 'completedNodes'):
            self.assertEqual(len(report['items'][field]), 100)
        self.assertEqual(report['items']['truncated'], {
            'newIdeas': 5,
            'updatedIdeas': 5,
            'completedIdeas': 5,
            'completedNodes': 5,
            'inProgressProjects': 5
        })
        self.assertTrue(server.valid_weekly_report(report))

    def test_weekly_automation_retries_records_failure_and_keeps_credentials_out_of_state(self):
        state = valid_state()
        state['ideas'][0].update({
            'createdAt': '2026-08-01T00:00:00Z',
            'updatedAt': '2026-08-09T00:00:00Z'
        })
        server.write_state(state)
        self.configure_weekly_email()
        server.WEEKLY_MAX_ATTEMPTS = 2
        calls = []
        sleeps = []

        def failing_mailer(report):
            calls.append(report['delivery']['attempts'])
            raise smtplib.SMTPException('response may contain provider details')

        report = server.run_weekly_automation(
            datetime(2026, 8, 10, 1, 0, tzinfo=timezone.utc),
            mailer=failing_mailer,
            sleep_fn=sleeps.append
        )
        self.assertEqual(calls, [1, 2])
        self.assertEqual(sleeps, [0])
        self.assertEqual(report['delivery']['status'], 'failed')
        self.assertEqual(report['delivery']['attempts'], 2)
        self.assertEqual(report['delivery']['errorCode'], 'smtp_delivery_failed')

        serialized = server.STATE_PATH.read_text(encoding='utf-8')
        self.assertNotIn(server.SMTP_PASSWORD, serialized)
        self.assertNotIn(server.SMTP_USERNAME, serialized)
        stored = server.read_state()
        self.assertEqual(len(stored['weeklyReports']), 1)
        self.assertEqual(stored['weeklyReports'][0]['delivery']['status'], 'failed')

    def test_weekly_automation_retries_then_sends_once_and_retains_52_reports(self):
        state = valid_state()
        base_now = datetime(2025, 8, 4, 1, 0, tzinfo=timezone.utc)
        state['weeklyReports'] = [
            server.build_weekly_report(state, base_now + timedelta(weeks=index))
            for index in range(52)
        ]
        server.write_state(state)
        self.configure_weekly_email()
        server.WEEKLY_MAX_ATTEMPTS = 3
        calls = []

        def eventual_mailer(report):
            calls.append(report['delivery']['attempts'])
            if len(calls) < 3:
                raise TimeoutError()

        current_now = base_now + timedelta(weeks=52)
        report = server.run_weekly_automation(current_now, mailer=eventual_mailer, sleep_fn=lambda _: None)
        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(report['delivery']['status'], 'sent')
        self.assertEqual(report['delivery']['attempts'], 3)
        self.assertIsNotNone(report['delivery']['sentAt'])
        saved = server.read_state()
        self.assertEqual(len(saved['weeklyReports']), 52)
        self.assertNotEqual(saved['weeklyReports'][0]['id'], 'weekly-2025-07-28')

        repeated = server.run_weekly_automation(current_now, mailer=eventual_mailer, sleep_fn=lambda _: None)
        self.assertEqual(repeated['id'], report['id'])
        self.assertEqual(calls, [1, 2, 3])

    def test_weekly_email_supports_starttls_ssl_and_multipart_content(self):
        state = valid_state()
        state['ideas'][0].update({
            'createdAt': '2026-08-08T02:00:00Z',
            'updatedAt': '2026-08-09T03:00:00Z'
        })
        state['ideas'][0]['nodes'][0].update({
            'status': 'completed',
            'completedAt': '2026-08-09T04:00:00Z',
            'updatedAt': '2026-08-09T04:00:00Z'
        })
        report = server.build_weekly_report(state, datetime(2026, 8, 10, 1, 0, tzinfo=timezone.utc))

        class FakeSMTP:
            instances = []

            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                self.started_tls = False
                self.login_values = None
                self.message = None
                self.__class__.instances.append(self)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def ehlo(self):
                return None

            def starttls(self, context=None):
                self.started_tls = True

            def login(self, username, password):
                self.login_values = (username, password)

            def send_message(self, message):
                self.message = message

        for security in ('starttls', 'ssl'):
            with self.subTest(security=security):
                FakeSMTP.instances.clear()
                self.configure_weekly_email(security)
                with mock.patch.object(server.smtplib, 'SMTP', FakeSMTP), mock.patch.object(server.smtplib, 'SMTP_SSL', FakeSMTP):
                    server.send_weekly_email(report)
                instance = FakeSMTP.instances[0]
                self.assertEqual(instance.started_tls, security == 'starttls')
                self.assertEqual(instance.login_values, (server.SMTP_USERNAME, server.SMTP_PASSWORD))
                self.assertTrue(instance.message.is_multipart())
                plain_body = instance.message.get_body(preferencelist=('plain',)).get_content()
                html_body = instance.message.get_body(preferencelist=('html',)).get_content()
                self.assertIn('新增想法明细', plain_body)
                self.assertIn('Ideas 2.0 test project', plain_body)
                self.assertIn('Security baseline', plain_body)
                self.assertIn('<html>', html_body)
                self.assertIn('Ideas 2.0 test project', html_body)
                self.assertIn('Security baseline', html_body)

    def test_weekly_automation_endpoint_is_safe_and_has_no_send_action(self):
        self.configure_weekly_email()
        status, _, body = self.request('GET', '/api/weekly-automation')
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertTrue(payload['configured'])
        self.assertEqual(payload['timezone'], 'Asia/Shanghai')
        self.assertEqual(payload['schedule'], {'weekday': 'monday', 'time': '09:00'})
        self.assertRegex(payload['nextRunAt'], r'\+08:00$')
        serialized = body.decode('utf-8')
        for secret in (
            server.SMTP_PASSWORD, server.SMTP_USERNAME, server.SMTP_HOST,
            server.SMTP_FROM, server.SMTP_RECIPIENTS[0]
        ):
            self.assertNotIn(secret, serialized)

        server.AUTH_USERNAME = 'owner'
        server.AUTH_PASSWORD = 'weekly-endpoint-password'
        status, _, _ = self.request('GET', '/api/weekly-automation')
        self.assertEqual(status, 401)
        credential = base64.b64encode(b'owner:weekly-endpoint-password').decode('ascii')
        status, _, body = self.request(
            'POST', '/api/weekly-automation', headers={'Authorization': 'Basic ' + credential}
        )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body), {'error': 'not_found'})


if __name__ == '__main__':
    unittest.main()
