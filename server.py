import base64
import copy
import html as html_module
import hmac
import json
import os
import re
import smtplib
import socket
import shutil
import ssl
import tempfile
import threading
import time as time_module
import uuid
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from email.message import EmailMessage
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
STATE_VERSION = 5
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
WEEKLY_RUN_LOCK = threading.Lock()
WEEKLY_STOP_EVENT = threading.Event()
WEEKLY_TIMEZONE = timezone(timedelta(hours=8), name='Asia/Shanghai')
WEEKLY_REPORT_LIMIT = 52
WEEKLY_ITEM_LIMIT = 100
WEEKLY_PROJECT_LIMIT = 100
WEEKLY_REPORT_STATUSES = {'pending', 'sent', 'failed'}


def env_flag(name, default=False):
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in {'1', 'true', 'yes', 'on'}


def env_integer(name, default, minimum, maximum):
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


WEEKLY_REPORT_ENABLED = env_flag('IDEA_DESK_WEEKLY_REPORT_ENABLED')
WEEKLY_MAX_ATTEMPTS = env_integer('IDEA_DESK_WEEKLY_MAX_ATTEMPTS', 3, 1, 5)
WEEKLY_RETRY_SECONDS = env_integer('IDEA_DESK_WEEKLY_RETRY_SECONDS', 300, 0, 3600)
SMTP_SECURITY = os.environ.get('IDEA_DESK_SMTP_SECURITY', 'starttls').strip().lower()
SMTP_HOST = os.environ.get('IDEA_DESK_SMTP_HOST', '').strip()
SMTP_PORT = env_integer('IDEA_DESK_SMTP_PORT', 465 if SMTP_SECURITY == 'ssl' else 587, 1, 65535)
SMTP_USERNAME = os.environ.get('IDEA_DESK_SMTP_USERNAME', '')
SMTP_PASSWORD = os.environ.get('IDEA_DESK_SMTP_PASSWORD', '')
SMTP_FROM = os.environ.get('IDEA_DESK_SMTP_FROM', '').strip()
SMTP_RECIPIENTS = tuple(
    address.strip()
    for address in re.split(r'[,;]', os.environ.get('IDEA_DESK_WEEKLY_RECIPIENTS', ''))
    if address.strip()
)
SMTP_TIMEOUT_SECONDS = env_integer('IDEA_DESK_SMTP_TIMEOUT_SECONDS', 20, 3, 120)

if bool(AUTH_USERNAME) != bool(AUTH_PASSWORD):
    raise RuntimeError('IDEA_DESK_USERNAME and IDEA_DESK_PASSWORD must be configured together')
if AUTH_REQUIRED and not AUTH_USERNAME:
    raise RuntimeError('Idea Desk authentication is required but credentials are missing')
if bool(SMTP_USERNAME) != bool(SMTP_PASSWORD):
    raise RuntimeError('SMTP username and password must be configured together')
if WEEKLY_REPORT_ENABLED and SMTP_SECURITY not in {'ssl', 'starttls'}:
    raise RuntimeError('SMTP security must be ssl or starttls')


def read_state():
    with STATE_LOCK:
        with STATE_PATH.open('r', encoding='utf-8') as state_file:
            return json.load(state_file)


def state_revision(payload):
    revision = payload.get('revision', 0) if isinstance(payload, dict) else 0
    return revision if isinstance(revision, int) and revision >= 0 else 0


def upgrade_state_version(payload):
    payload['version'] = STATE_VERSION
    payload['schemaVersion'] = STATE_VERSION
    return payload


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


def parse_timestamp(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def previous_week_window(now=None):
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local_now = current.astimezone(WEEKLY_TIMEZONE)
    current_monday = local_now.date() - timedelta(days=local_now.weekday())
    week_end = datetime.combine(current_monday, datetime_time.min, WEEKLY_TIMEZONE)
    return week_end - timedelta(days=7), week_end


def next_weekly_run(now=None):
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local_now = current.astimezone(WEEKLY_TIMEZONE)
    current_monday = local_now.date() - timedelta(days=local_now.weekday())
    candidate = datetime.combine(current_monday, datetime_time(hour=9), WEEKLY_TIMEZONE)
    if candidate <= local_now:
        candidate += timedelta(days=7)
    return candidate


def timestamp_in_window(value, start, end):
    parsed = parse_timestamp(value)
    return parsed is not None and start.astimezone(timezone.utc) <= parsed < end.astimezone(timezone.utc)


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


def iter_node_paths(nodes, path=()):
    for node in nodes if isinstance(nodes, list) else []:
        current_path = path + (node,)
        yield current_path
        yield from iter_node_paths(node.get('children'), current_path)


def weekly_node_reference(node):
    if not node:
        return None
    return {
        'id': node.get('id'),
        'code': node.get('code', ''),
        'title': node.get('title', ''),
        'status': node.get('status', 'not_started')
    }


def weekly_idea_item(idea, timestamp):
    return {
        'ideaId': idea.get('id'),
        'title': idea.get('title', ''),
        'status': idea.get('status'),
        'timestamp': timestamp
    }


def weekly_completed_node_item(idea, node, timestamp):
    return {
        'ideaId': idea.get('id'),
        'ideaTitle': idea.get('title', ''),
        'nodeId': node.get('id'),
        'code': node.get('code', ''),
        'title': node.get('title', ''),
        'completedAt': timestamp
    }


def bounded_weekly_items(items, limit=WEEKLY_ITEM_LIMIT):
    ordered = sorted(items, key=lambda item: (item.get('timestamp') or item.get('completedAt') or '', item.get('ideaId', '')), reverse=True)
    return ordered[:limit], max(0, len(ordered) - limit)


def project_current_context(idea):
    paths = list(iter_node_paths(idea.get('nodes')))
    current_node_id = idea.get('currentNodeId')
    selected_path = next((path for path in paths if path[-1].get('id') == current_node_id), None)
    source = 'selected'
    if selected_path is None:
        selected_path = next((path for path in paths if path[-1].get('status') == 'in_progress'), None)
        source = 'in_progress' if selected_path else None
    if not selected_path:
        return None, None, None
    return weekly_node_reference(selected_path[0]), weekly_node_reference(selected_path[-1]), source


def project_duration_days(idea, week_end):
    created_at = parse_timestamp(idea.get('createdAt'))
    if created_at is None:
        return 0
    created_date = created_at.astimezone(WEEKLY_TIMEZONE).date()
    return max(0, (week_end.date() - created_date).days)


def build_weekly_report(state, now=None):
    generated_at = now or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    week_start, week_end = previous_week_window(generated_at)
    new_idea_items = []
    updated_idea_items = []
    completed_idea_items = []
    completed_node_items = []
    in_progress_nodes = 0
    active_projects = []

    for idea in state.get('ideas', []):
        if timestamp_in_window(idea.get('createdAt'), week_start, week_end):
            new_idea_items.append(weekly_idea_item(idea, idea.get('createdAt')))
        if timestamp_in_window(idea.get('updatedAt'), week_start, week_end):
            updated_idea_items.append(weekly_idea_item(idea, idea.get('updatedAt')))
        completed_idea_at = idea.get('completedAt') or idea.get('updatedAt')
        if idea.get('status') == 'done' and timestamp_in_window(completed_idea_at, week_start, week_end):
            completed_idea_items.append(weekly_idea_item(idea, completed_idea_at))

        paths = list(iter_node_paths(idea.get('nodes')))
        nodes = [path[-1] for path in paths]
        for node in nodes:
            completed_at = node.get('completedAt') or node.get('updatedAt')
            if node.get('status') == 'completed' and timestamp_in_window(completed_at, week_start, week_end):
                completed_node_items.append(weekly_completed_node_item(idea, node, completed_at))
        in_progress_nodes += sum(node.get('status') == 'in_progress' for node in nodes)
        created_at = parse_timestamp(idea.get('createdAt'))
        existed_by_week_end = created_at is None or created_at < week_end.astimezone(timezone.utc)
        is_active_project = bool(nodes) and existed_by_week_end and (
            idea.get('status') == 'try' or any(node.get('status') == 'in_progress' for node in nodes)
        )
        if not is_active_project:
            continue
        current_phase, current_node, current_node_source = project_current_context(idea)
        active_projects.append({
            'ideaId': idea.get('id'),
            'title': idea.get('title', ''),
            'status': idea.get('status'),
            'durationDays': project_duration_days(idea, week_end),
            'currentPhase': current_phase,
            'currentNode': current_node,
            'currentNodeSource': current_node_source,
            'nodeProgress': node_progress(idea.get('nodes'))
        })

    active_projects.sort(key=lambda project: (project['title'].casefold(), project['ideaId']))
    total_active_projects = len(active_projects)
    active_projects = active_projects[:WEEKLY_PROJECT_LIMIT]
    new_items, truncated_new = bounded_weekly_items(new_idea_items)
    updated_items, truncated_updated = bounded_weekly_items(updated_idea_items)
    completed_idea_details, truncated_completed_ideas = bounded_weekly_items(completed_idea_items)
    completed_node_details, truncated_completed_nodes = bounded_weekly_items(completed_node_items)
    return {
        'id': 'weekly-' + week_start.date().isoformat(),
        'schemaVersion': 1,
        'weekStart': week_start.date().isoformat(),
        'weekEnd': week_end.date().isoformat(),
        'generatedAt': generated_at.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'dataRevision': state_revision(state),
        'summary': {
            'newIdeas': len(new_idea_items),
            'updatedIdeas': len(updated_idea_items),
            'completedIdeas': len(completed_idea_items),
            'inProgressProjects': total_active_projects,
            'completedNodes': len(completed_node_items),
            'inProgressNodes': in_progress_nodes
        },
        'projects': active_projects,
        'items': {
            'limitPerCategory': WEEKLY_ITEM_LIMIT,
            'newIdeas': new_items,
            'updatedIdeas': updated_items,
            'completedIdeas': completed_idea_details,
            'completedNodes': completed_node_details,
            'truncated': {
                'newIdeas': truncated_new,
                'updatedIdeas': truncated_updated,
                'completedIdeas': truncated_completed_ideas,
                'completedNodes': truncated_completed_nodes,
                'inProgressProjects': max(0, total_active_projects - len(active_projects))
            }
        },
        'delivery': {
            'status': 'pending',
            'attempts': 0,
            'lastAttemptAt': None,
            'sentAt': None,
            'errorCode': None
        }
    }


def retained_weekly_reports(reports):
    ordered = sorted(reports, key=lambda report: (report.get('weekStart', ''), report.get('generatedAt', '')))
    return ordered[-WEEKLY_REPORT_LIMIT:]


def weekly_email_configured():
    return (
        SMTP_SECURITY in {'ssl', 'starttls'}
        and bool(SMTP_HOST)
        and 0 < SMTP_PORT <= 65535
        and bool(SMTP_FROM)
        and bool(SMTP_RECIPIENTS)
        and bool(SMTP_USERNAME) == bool(SMTP_PASSWORD)
    )


def weekly_report_subject(report):
    final_day = date.fromisoformat(report['weekEnd']) - timedelta(days=1)
    return 'Ideas 周报 · %s 至 %s' % (report['weekStart'], final_day.isoformat())


def weekly_item_time(value):
    parsed = parse_timestamp(value)
    return parsed.astimezone(WEEKLY_TIMEZONE).strftime('%m-%d %H:%M') if parsed else '-'


def weekly_report_detail_text(report):
    items = report.get('items') or {}
    sections = []
    for heading, field in (
        ('新增想法明细', 'newIdeas'),
        ('更新想法明细', 'updatedIdeas'),
        ('完成想法明细', 'completedIdeas')
    ):
        values = items.get(field, [])
        sections.extend([heading] + [
            '- %s（%s）' % (item['title'], weekly_item_time(item.get('timestamp')))
            for item in values
        ] + (['- 无'] if not values else []) + [''])
    completed_nodes = items.get('completedNodes', [])
    sections.extend(['完成节点明细'] + [
        '- %s / %s %s（%s）' % (
            item['ideaTitle'], item.get('code') or '-', item['title'],
            weekly_item_time(item.get('completedAt'))
        )
        for item in completed_nodes
    ] + (['- 无'] if not completed_nodes else []) + [''])
    return sections


def weekly_report_detail_html(report):
    items = report.get('items') or {}
    sections = []
    for heading, field in (
        ('新增想法', 'newIdeas'),
        ('更新想法', 'updatedIdeas'),
        ('完成想法', 'completedIdeas')
    ):
        values = items.get(field, [])
        rows = ''.join(
            '<li style="margin:5px 0">%s <span style="color:#666">%s</span></li>' % (
                html_module.escape(item['title']),
                html_module.escape(weekly_item_time(item.get('timestamp')))
            )
            for item in values
        ) or '<li style="margin:5px 0;color:#666">无</li>'
        sections.append('<h3 style="font-size:15px;margin:18px 0 6px">%s</h3><ul style="margin:0;padding-left:20px">%s</ul>' % (heading, rows))
    completed_nodes = items.get('completedNodes', [])
    node_rows = ''.join(
        '<li style="margin:5px 0">%s / %s %s <span style="color:#666">%s</span></li>' % (
            html_module.escape(item['ideaTitle']),
            html_module.escape(item.get('code') or '-'),
            html_module.escape(item['title']),
            html_module.escape(weekly_item_time(item.get('completedAt')))
        )
        for item in completed_nodes
    ) or '<li style="margin:5px 0;color:#666">无</li>'
    sections.append('<h3 style="font-size:15px;margin:18px 0 6px">完成节点</h3><ul style="margin:0;padding-left:20px">%s</ul>' % node_rows)
    return ''.join(sections)


def weekly_report_text(report):
    summary = report['summary']
    lines = [
        weekly_report_subject(report),
        '',
        '新增想法：%s' % summary['newIdeas'],
        '更新想法：%s' % summary['updatedIdeas'],
        '完成想法：%s' % summary['completedIdeas'],
        '进行中项目：%s' % summary['inProgressProjects'],
        '完成节点：%s' % summary['completedNodes'],
        '进行中节点：%s' % summary['inProgressNodes'],
        ''
    ]
    lines.extend(weekly_report_detail_text(report))
    lines.append('进行中项目')
    if not report['projects']:
        lines.append('本周没有进行中的项目。')
    for project in report['projects']:
        phase = project.get('currentPhase') or {}
        node = project.get('currentNode') or {}
        lines.extend([
            project['title'],
            '  持续天数：%s' % project['durationDays'],
            '  当前阶段：%s %s' % (phase.get('code', '-'), phase.get('title', '未指定')),
            '  当前节点：%s %s' % (node.get('code', '-'), node.get('title', '未指定')),
            '  节点进度：%s/%s' % (project['nodeProgress']['completed'], project['nodeProgress']['total']),
            ''
        ])
    return '\n'.join(lines).rstrip() + '\n'


def weekly_report_html(report):
    summary = report['summary']
    summary_rows = ''.join(
        '<tr><th style="text-align:left;padding:6px 12px 6px 0">%s</th><td style="padding:6px 0">%s</td></tr>'
        % (html_module.escape(label), value)
        for label, value in (
            ('新增想法', summary['newIdeas']),
            ('更新想法', summary['updatedIdeas']),
            ('完成想法', summary['completedIdeas']),
            ('进行中项目', summary['inProgressProjects']),
            ('完成节点', summary['completedNodes']),
            ('进行中节点', summary['inProgressNodes'])
        )
    )
    project_rows = ''
    for project in report['projects']:
        phase = project.get('currentPhase') or {}
        node = project.get('currentNode') or {}
        project_rows += (
            '<tr><td style="padding:8px;border-top:1px solid #ddd">%s</td>'
            '<td style="padding:8px;border-top:1px solid #ddd">%s</td>'
            '<td style="padding:8px;border-top:1px solid #ddd">%s</td>'
            '<td style="padding:8px;border-top:1px solid #ddd">%s</td></tr>'
        ) % (
            html_module.escape(project['title']),
            project['durationDays'],
            html_module.escape(('%s %s' % (phase.get('code', ''), phase.get('title', '未指定'))).strip()),
            html_module.escape(('%s %s' % (node.get('code', ''), node.get('title', '未指定'))).strip())
        )
    if not project_rows:
        project_rows = '<tr><td colspan="4" style="padding:8px">本周没有进行中的项目。</td></tr>'
    return (
        '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202124">'
        '<h1 style="font-size:22px">%s</h1><table>%s</table>%s'
        '<h2 style="font-size:18px;margin-top:24px">项目进展</h2>'
        '<table style="border-collapse:collapse;width:100%%"><thead><tr>'
        '<th style="text-align:left;padding:8px">项目</th><th style="text-align:left;padding:8px">持续天数</th>'
        '<th style="text-align:left;padding:8px">当前阶段</th><th style="text-align:left;padding:8px">当前节点</th>'
        '</tr></thead><tbody>%s</tbody></table></body></html>'
    ) % (
        html_module.escape(weekly_report_subject(report)), summary_rows,
        weekly_report_detail_html(report), project_rows
    )


def send_weekly_email(report):
    if not weekly_email_configured():
        raise RuntimeError('smtp_not_configured')
    message = EmailMessage()
    message['Subject'] = weekly_report_subject(report)
    message['From'] = SMTP_FROM
    message['To'] = ', '.join(SMTP_RECIPIENTS)
    message.set_content(weekly_report_text(report))
    message.add_alternative(weekly_report_html(report), subtype='html')
    context = ssl.create_default_context()
    if SMTP_SECURITY == 'ssl':
        client = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS, context=context)
    else:
        client = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS)
    with client as smtp_client:
        if SMTP_SECURITY == 'starttls':
            smtp_client.ehlo()
            smtp_client.starttls(context=context)
            smtp_client.ehlo()
        if SMTP_USERNAME:
            smtp_client.login(SMTP_USERNAME, SMTP_PASSWORD)
        smtp_client.send_message(message)


def smtp_error_code(error):
    if isinstance(error, RuntimeError) and error.args == ('smtp_not_configured',):
        return 'smtp_not_configured'
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return 'smtp_auth_failed'
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return 'smtp_recipients_refused'
    if isinstance(error, (TimeoutError, socket.timeout)):
        return 'smtp_timeout'
    if isinstance(error, ssl.SSLError):
        return 'smtp_tls_failed'
    return 'smtp_delivery_failed'


def update_weekly_report_delivery(report_id, **changes):
    with STATE_LOCK:
        state = read_state()
        report = next((item for item in state.get('weeklyReports', []) if item.get('id') == report_id), None)
        if report is None:
            raise KeyError(report_id)
        report.setdefault('delivery', {}).update(changes)
        state['revision'] = state_revision(state) + 1
        state['weeklyReports'] = retained_weekly_reports(state.get('weeklyReports', []))
        upgrade_state_version(state)
        write_state(state)
        return copy.deepcopy(report)


def get_or_create_weekly_report(now=None):
    week_start, week_end = previous_week_window(now)
    report_id = 'weekly-' + week_start.date().isoformat()
    with STATE_LOCK:
        state = read_state()
        reports = state.get('weeklyReports', [])
        existing = next((report for report in reports if report.get('id') == report_id), None)
        if existing:
            return copy.deepcopy(existing), False
        report = build_weekly_report(state, now)
        reports = retained_weekly_reports(reports + [report])
        state['weeklyReports'] = reports
        state['revision'] = state_revision(state) + 1
        upgrade_state_version(state)
        write_state(state)
        return copy.deepcopy(report), True


def run_weekly_automation(now=None, mailer=None, sleep_fn=None):
    mailer = mailer or send_weekly_email
    sleep_fn = sleep_fn or time_module.sleep
    with WEEKLY_RUN_LOCK:
        report, _ = get_or_create_weekly_report(now)
        delivery = report.get('delivery', {})
        attempts = int(delivery.get('attempts', 0))
        if delivery.get('status') == 'sent' or attempts >= WEEKLY_MAX_ATTEMPTS:
            return report
        if not weekly_email_configured():
            return update_weekly_report_delivery(
                report['id'], status='failed', errorCode='smtp_not_configured', sentAt=None
            )
        while attempts < WEEKLY_MAX_ATTEMPTS:
            attempts += 1
            report = update_weekly_report_delivery(
                report['id'],
                status='pending',
                attempts=attempts,
                lastAttemptAt=utc_now(),
                errorCode=None
            )
            try:
                mailer(report)
            except Exception as error:
                report = update_weekly_report_delivery(
                    report['id'], status='failed', errorCode=smtp_error_code(error), sentAt=None
                )
                if attempts < WEEKLY_MAX_ATTEMPTS:
                    sleep_fn(WEEKLY_RETRY_SECONDS)
                continue
            return update_weekly_report_delivery(
                report['id'], status='sent', errorCode=None, sentAt=utc_now()
            )
        return report


def weekly_automation_status(now=None):
    last_report = None
    try:
        if STATE_PATH.exists():
            reports = read_state().get('weeklyReports', [])
            if reports:
                report = retained_weekly_reports(reports)[-1]
                delivery = report.get('delivery', {})
                last_report = {
                    'weekStart': report.get('weekStart'),
                    'weekEnd': report.get('weekEnd'),
                    'generatedAt': report.get('generatedAt'),
                    'deliveryStatus': delivery.get('status'),
                    'attempts': delivery.get('attempts', 0),
                    'errorCode': delivery.get('errorCode')
                }
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        last_report = None
    return {
        'enabled': WEEKLY_REPORT_ENABLED,
        'configured': weekly_email_configured(),
        'timezone': 'Asia/Shanghai',
        'schedule': {'weekday': 'monday', 'time': '09:00'},
        'nextRunAt': next_weekly_run(now).isoformat(),
        'smtp': {
            'security': SMTP_SECURITY if SMTP_SECURITY in {'ssl', 'starttls'} else 'invalid',
            'port': SMTP_PORT,
            'hostConfigured': bool(SMTP_HOST),
            'senderConfigured': bool(SMTP_FROM),
            'authenticationConfigured': bool(SMTP_USERNAME and SMTP_PASSWORD),
            'recipientCount': len(SMTP_RECIPIENTS)
        },
        'retry': {'maxAttempts': WEEKLY_MAX_ATTEMPTS},
        'lastReport': last_report
    }


def weekly_scheduler_loop(stop_event=None):
    stop_event = stop_event or WEEKLY_STOP_EVENT
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        _, week_end = previous_week_window(now)
        scheduled_at = datetime.combine(week_end.date(), datetime_time(hour=9), WEEKLY_TIMEZONE)
        if now.astimezone(WEEKLY_TIMEZONE) >= scheduled_at:
            try:
                run_weekly_automation(now)
            except Exception:
                print('Weekly report automation failed', flush=True)
        wait_seconds = max(1, (next_weekly_run(now).astimezone(timezone.utc) - now).total_seconds())
        stop_event.wait(wait_seconds)


def start_weekly_scheduler():
    if not WEEKLY_REPORT_ENABLED:
        return None
    scheduler = threading.Thread(target=weekly_scheduler_loop, name='weekly-report-scheduler', daemon=True)
    scheduler.start()
    return scheduler


def bounded_string(value, maximum, allow_empty=True):
    return isinstance(value, str) and len(value) <= maximum and (allow_empty or bool(value.strip()))


def safe_identifier(value):
    return bounded_string(value, 200, allow_empty=False) and re.fullmatch(r'[A-Za-z0-9._:-]+', value) is not None


def nonnegative_integer(value, maximum=10 ** 9):
    return not isinstance(value, bool) and isinstance(value, int) and 0 <= value <= maximum


def valid_optional_timestamp(value):
    return value is None or (bounded_string(value, 64, allow_empty=False) and parse_timestamp(value) is not None)


def valid_weekly_node_reference(value):
    if value is None:
        return True
    return (
        isinstance(value, dict)
        and safe_identifier(value.get('id'))
        and bounded_string(value.get('code', ''), 32)
        and bounded_string(value.get('title', ''), 160)
        and value.get('status') in NODE_STATUSES
    )


def valid_weekly_idea_item(item):
    return (
        isinstance(item, dict)
        and safe_identifier(item.get('ideaId'))
        and bounded_string(item.get('title'), 160, allow_empty=False)
        and item.get('status') in IDEA_STATUSES
        and parse_timestamp(item.get('timestamp')) is not None
    )


def valid_weekly_completed_node_item(item):
    return (
        isinstance(item, dict)
        and safe_identifier(item.get('ideaId'))
        and bounded_string(item.get('ideaTitle'), 160, allow_empty=False)
        and safe_identifier(item.get('nodeId'))
        and bounded_string(item.get('code', ''), 32)
        and bounded_string(item.get('title'), 160, allow_empty=False)
        and parse_timestamp(item.get('completedAt')) is not None
    )


def valid_weekly_items(items):
    if items is None:
        return True
    if not isinstance(items, dict) or not nonnegative_integer(items.get('limitPerCategory'), 500):
        return False
    limit = items['limitPerCategory']
    if limit < 1:
        return False
    for field in ('newIdeas', 'updatedIdeas', 'completedIdeas'):
        values = items.get(field)
        if not isinstance(values, list) or len(values) > limit:
            return False
        if not all(valid_weekly_idea_item(item) for item in values):
            return False
    completed_nodes = items.get('completedNodes')
    if not isinstance(completed_nodes, list) or len(completed_nodes) > limit:
        return False
    if not all(valid_weekly_completed_node_item(item) for item in completed_nodes):
        return False
    truncated = items.get('truncated')
    truncated_fields = ('newIdeas', 'updatedIdeas', 'completedIdeas', 'completedNodes', 'inProgressProjects')
    return isinstance(truncated, dict) and all(nonnegative_integer(truncated.get(field)) for field in truncated_fields)


def valid_weekly_report(report):
    if not isinstance(report, dict) or not safe_identifier(report.get('id')) or report.get('schemaVersion') != 1:
        return False
    try:
        week_start = date.fromisoformat(report.get('weekStart', ''))
        week_end = date.fromisoformat(report.get('weekEnd', ''))
    except (TypeError, ValueError):
        return False
    if report['id'] != 'weekly-' + week_start.isoformat() or week_end - week_start != timedelta(days=7):
        return False
    if parse_timestamp(report.get('generatedAt')) is None or not nonnegative_integer(report.get('dataRevision', 0)):
        return False
    summary = report.get('summary')
    summary_fields = (
        'newIdeas', 'updatedIdeas', 'completedIdeas', 'inProgressProjects', 'completedNodes', 'inProgressNodes'
    )
    if not isinstance(summary, dict) or not all(nonnegative_integer(summary.get(field)) for field in summary_fields):
        return False
    projects = report.get('projects')
    if not isinstance(projects, list) or len(projects) > WEEKLY_PROJECT_LIMIT:
        return False
    if summary['inProgressProjects'] < len(projects):
        return False
    for project in projects:
        if not isinstance(project, dict) or not safe_identifier(project.get('ideaId')):
            return False
        if not bounded_string(project.get('title'), 160, allow_empty=False) or project.get('status') not in IDEA_STATUSES:
            return False
        if not nonnegative_integer(project.get('durationDays'), 100000):
            return False
        if project.get('currentNodeSource') not in {None, 'selected', 'in_progress'}:
            return False
        if not valid_weekly_node_reference(project.get('currentPhase')) or not valid_weekly_node_reference(project.get('currentNode')):
            return False
        progress = project.get('nodeProgress')
        if not isinstance(progress, dict):
            return False
        if not all(nonnegative_integer(progress.get(field), MAX_NODES) for field in ('total', 'completed', 'inProgress')):
            return False
        if not nonnegative_integer(progress.get('percent'), 100):
            return False
        if progress['completed'] + progress['inProgress'] > progress['total']:
            return False
    if not valid_weekly_items(report.get('items')):
        return False
    delivery = report.get('delivery')
    if not isinstance(delivery, dict) or delivery.get('status') not in WEEKLY_REPORT_STATUSES:
        return False
    if not nonnegative_integer(delivery.get('attempts', 0), 10):
        return False
    if not valid_optional_timestamp(delivery.get('lastAttemptAt')) or not valid_optional_timestamp(delivery.get('sentAt')):
        return False
    error_code = delivery.get('errorCode')
    return error_code is None or safe_identifier(error_code)


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
        if 'completedAt' in node and not valid_optional_timestamp(node.get('completedAt')):
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
    version = payload.get('version')
    schema_version = payload.get('schemaVersion', version)
    if type(version) is not int or type(schema_version) is not int:
        return False
    if version not in {3, 4, 5} or schema_version not in {3, 4, 5}:
        return False
    if 'revision' in payload and not nonnegative_integer(payload['revision']):
        return False
    reports = payload.get('weeklyReports', [])
    if not isinstance(reports, list) or len(reports) > WEEKLY_REPORT_LIMIT:
        return False
    if len({report.get('id') for report in reports if isinstance(report, dict)}) != len(reports):
        return False
    if not all(valid_weekly_report(report) for report in reports):
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
        if 'completedAt' in idea and not valid_optional_timestamp(idea.get('completedAt')):
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
        if path == '/api/weekly-automation':
            self.send_json(200, weekly_automation_status())
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
                    'version': STATE_VERSION,
                    'schemaVersion': STATE_VERSION,
                    'revision': next_revision,
                    'ideas': payload['ideas'],
                    'focusId': payload.get('focusId'),
                    'review': payload.get('review') if isinstance(payload.get('review'), dict) else {},
                    'weeklyReports': retained_weekly_reports(
                        current_state.get('weeklyReports', [])
                        if current_state else payload.get('weeklyReports', [])
                    )
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
                now = utc_now()
                if 'status' in payload:
                    if payload['status'] not in NODE_STATUSES:
                        self.send_json(400, {'error': 'invalid_node_status'})
                        return
                    previous_status = node.get('status')
                    node['status'] = payload['status']
                    if node['status'] == 'completed':
                        node['completedAt'] = (
                            node.get('completedAt')
                            or (node.get('updatedAt') if previous_status == 'completed' else None)
                            or now
                        )
                    else:
                        node['completedAt'] = None
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
                if node.get('status') == 'completed' and not parse_timestamp(node.get('completedAt')):
                    legacy_updated_at = node.get('updatedAt')
                    node['completedAt'] = legacy_updated_at if parse_timestamp(legacy_updated_at) else now
                node['updatedAt'] = now
                idea['updatedAt'] = now
                next_revision = current_revision + 1
                state['revision'] = next_revision
                upgrade_state_version(state)
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
    scheduler = start_weekly_scheduler()
    print('Idea Desk listening on port %s' % port, flush=True)
    try:
        server.serve_forever()
    finally:
        WEEKLY_STOP_EVENT.set()
        if scheduler:
            scheduler.join(timeout=2)
