#!/usr/bin/env python3
"""Upgrade the existing website while retaining its live database and service boundary."""
from contextlib import closing
import argparse
import hashlib
import http.client
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
import time


SERVICE = 'opentalk-web.service'
USER = 'opentalk-web'
CODE = {'web/package.json'} | {'web/src/' + name + '.js' for name in [
    'config', 'inbox', 'providers', 'server', 'start', 'store',
    'guild-store', 'guild-api', 'guild-owner', 'guild-automatic']}
PUBLIC = {'docs/' + name for name in [
    'index.html', 'account.html', 'privacy.html', 'auth.js', 'auth.css', 'homepage.css', 'site.css',
    'guild.html', 'guild.js', 'guild.css', 'updates.html', 'updates.css', 'updates/v1.2.html',
    'updates/v1.1.html', 'updates/v0.1.html', 'updates/2026-08-31.html', 'assets/kakao-login.png',
    'assets/lounge-hero.webp', 'assets/lounge-hero-768.webp', 'assets/daylight-lounge.webp',
    'assets/daylight-lounge-768.webp', 'assets/fonts/OFL.txt', 'assets/fonts/brand-400.woff2',
    'assets/fonts/body-400.woff2', 'assets/fonts/body-500.woff2', 'assets/fonts/body-600.woff2',
    'assets/fonts/body-700.woff2']}
FIXED = {'WEB_ORIGIN': 'https://pogeunhaeyong.duckdns.org', 'WEB_HOST': '127.0.0.1',
         'WEB_PORT': '8090', 'WEB_DB_PATH': '/var/lib/opentalk-web/auth.sqlite'}
ORIGINAL_ENV = set(FIXED) | {'DISCORD_OAUTH_CLIENT_ID', 'DISCORD_OAUTH_CLIENT_SECRET',
    'KAKAO_OAUTH_CLIENT_ID', 'KAKAO_OAUTH_CLIENT_SECRET', 'KAKAO_ADMIN_KEY', 'KAKAO_APP_ID'}
EXTRA_ENV = {'GUILD_AUTO_APPROVAL_ENABLED', 'GUILD_AUTO_DISCORD_GUILD_ID',
             'GUILD_AUTO_DISCORD_ROLE_ID', 'LOSTARK_API_KEY'}
LIMIT = 32 * 1024 * 1024


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def regular(path):
    require(path.is_file() and not path.is_symlink(), 'Expected regular file: ' + path.name)
    require(path.stat().st_size <= LIMIT, 'File exceeds size limit: ' + path.name)
    return path.read_bytes()


def safe_parents(path):
    for parent in [path, *path.parents]:
        if parent.exists() or parent.is_symlink():
            require(not parent.is_symlink(), 'Symlink in deployment path')
            if os.name == 'posix':
                require(parent.stat().st_uid == 0 and not parent.stat().st_mode & 0o022,
                        'Deployment path must be root-owned and not group/world writable')


def write(path, data, mode=0o600):
    require(not path.is_symlink(), 'Refusing to replace a symlink with a file')
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
        if os.name == 'posix':
            descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def tree(path, public=False):
    require(path.is_dir() and not path.is_symlink(), 'Expected real directory')
    result = {}
    for entry in [path, *sorted(path.rglob('*'))]:
        require(not entry.is_symlink(), 'Tree contains a symlink')
        require(entry.is_dir() or entry.is_file(), 'Tree contains a special file')
        if public and os.name == 'posix':
            require(entry.stat().st_uid == entry.stat().st_gid == 0 and
                    stat.S_IMODE(entry.stat().st_mode) == (0o755 if entry.is_dir() else 0o644),
                    'Unsafe public tree permissions')
        if entry.is_file():
            result[entry.relative_to(path).as_posix()] = digest(regular(entry))
    return result


def read_archive(path, manifest, allowed):
    raw = regular(path)
    require(digest(raw) == manifest['archive_sha256'], 'Archive digest mismatch')
    rows = manifest['files']
    require(len(rows) == len(allowed) and {row['path'] for row in rows} == allowed, 'File allowlist mismatch')
    expected, payload = {row['path']: row for row in rows}, {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for item in archive:
            require(item.isfile() and item.name in allowed and item.name not in payload,
                    'Unapproved, duplicate, or non-regular archive entry')
            parts = PurePosixPath(item.name).parts
            require(not item.name.startswith('/') and '..' not in parts and '\\' not in item.name,
                    'Unsafe archive path')
            row = expected[item.name]
            require(0 <= item.size <= LIMIT and item.size == row['size'], 'Archive size mismatch')
            require(sum(len(value) for value in payload.values()) + item.size <= LIMIT, 'Expanded archive too large')
            value = archive.extractfile(item).read()
            require(digest(value) == row['sha256'], 'File digest mismatch')
            payload[item.name] = value
    require(set(payload) == allowed, 'Missing archive files')
    return payload


def pack(source, bundle):
    require(not bundle.exists(), 'Bundle output must be new')
    require(source.is_dir() and not source.is_symlink(), 'Source must be a real directory')
    actual = {p.relative_to(source).as_posix() for p in (source / 'web/src').rglob('*') if not p.is_dir()}
    require(actual == CODE - {'web/package.json'}, 'Review and update the explicit source allowlist')
    bundle.mkdir(parents=True, mode=0o700)
    index = {'version': 1, 'target_schema': 4, 'rollback_schema': 1,
             'tool_sha256': digest(regular(Path(__file__))),
             'unit_sha256': digest(regular(source / 'ops/web' / SERVICE))}
    for name, allowed in [('code', CODE), ('static', PUBLIC)]:
        payload = {}
        for relative in sorted(allowed):
            path = source / relative
            require(all(not parent.is_symlink() for parent in [path, *path.parents]), 'Source symlink is not allowed')
            payload[relative] = regular(path)
        archive = bundle / (name + '.tar.gz')
        with tarfile.open(archive, 'w:gz', format=tarfile.USTAR_FORMAT) as stream:
            for relative, value in payload.items():
                item = tarfile.TarInfo(relative)
                item.size, item.mode = len(value), 0o644
                stream.addfile(item, io.BytesIO(value))
        manifest = {'archive_sha256': digest(regular(archive)), 'files': [
            {'path': key, 'size': len(value), 'sha256': digest(value)} for key, value in payload.items()]}
        raw = encoded(manifest)
        write(bundle / (name + '.json'), raw)
        index[name + '_sha256'] = digest(raw)
    raw = encoded(index)
    write(bundle / 'release.json', raw)
    return digest(raw)


def load_bundle(bundle, expected):
    raw = regular(bundle / 'release.json')
    require(digest(raw) == expected, 'Reviewed release digest mismatch')
    index = json.loads(raw)
    require(index['version'] == 1 and index['target_schema'] == 4 and index['rollback_schema'] == 1 and
            index['tool_sha256'] == digest(regular(Path(__file__))), 'Tool or schema contract changed')
    payload = {}
    for name, allowed in [('code', CODE), ('static', PUBLIC)]:
        raw = regular(bundle / (name + '.json'))
        require(digest(raw) == index[name + '_sha256'], 'Reviewed file manifest digest mismatch')
        payload[name] = read_archive(bundle / (name + '.tar.gz'), json.loads(raw), allowed)
    package = json.loads(payload['code']['web/package.json'])
    require(package.get('type') == 'module' and not package.get('dependencies') and not package.get('devDependencies'),
            'Package must remain dependency-free ESM')
    return payload, index


def environment_values(raw):
    require(len(raw) <= 32768, 'Environment exceeds size limit')
    values = {}
    for line in raw.decode('utf-8').splitlines():
        if not line:
            continue
        match = re.fullmatch(r'([A-Z_]+)=([A-Za-z0-9_./:=+@,-]*)', line)
        require(match is not None, 'Expected unquoted environment assignments')
        key, value = match.groups()
        require(key not in values and key in ORIGINAL_ENV | EXTRA_ENV, 'Unknown or duplicate environment field')
        values[key] = value
    require(ORIGINAL_ENV <= set(values) and all(values.get(key) == value for key, value in FIXED.items()),
            'Fixed service environment changed')
    return values


def extend_environment(original, additions):
    values = environment_values(original)
    require(type(additions) is dict and set(additions) <= EXTRA_ENV, 'Unapproved environment addition')
    for key, value in additions.items():
        require(type(value) is str and len(value) <= 4096 and re.fullmatch(r'[A-Za-z0-9_./:=+@,-]*', value),
                'Invalid environment value')
        require(key not in values, 'Existing environment field cannot be replaced')
    merged = {**values, **additions}
    if 'GUILD_AUTO_APPROVAL_ENABLED' in merged:
        require(merged['GUILD_AUTO_APPROVAL_ENABLED'] in {'true', 'false'}, 'Invalid enable flag')
    if merged.get('GUILD_AUTO_APPROVAL_ENABLED') == 'true':
        require(EXTRA_ENV <= set(merged) and bool(merged['LOSTARK_API_KEY']), 'Automatic approval settings are incomplete')
        for key in ['GUILD_AUTO_DISCORD_GUILD_ID', 'GUILD_AUTO_DISCORD_ROLE_ID']:
            require(re.fullmatch(r'[1-9][0-9]{16,19}', merged[key]) and int(merged[key]) < 2 ** 64,
                    'Invalid Discord identifier')
    if not additions:
        return original
    suffix = ''.join(key + '=' + value + '\n' for key, value in sorted(additions.items())).encode()
    return original + (b'' if original.endswith(b'\n') else b'\n') + suffix


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45)
    require(result.returncode == 0, 'Command failed: ' + ' '.join(args[:3]))
    return result.stdout.strip()


class Release:
    def __init__(self, release, root=Path('/'), runner=run):
        require(re.fullmatch(r'web-guild-[0-9]{8}-[0-9]{4}', release), 'Release must be web-guild-YYYYMMDD-HHMM')
        self.release, self.root, self.run = release, root, runner
        self.code_releases = root / 'opt/opentalk-web/releases'
        self.current = self.code_releases.parent / 'current'
        self.code_release = self.code_releases / release
        self.static_releases = root / 'var/www/opentalk/releases'
        self.static = self.static_releases.parent / 'current'
        self.static_release = self.static_releases / release
        self.state = root / 'var/lib/opentalk-web'
        self.database = self.state / 'auth.sqlite'
        self.environment = root / 'etc/opentalk-web.env'
        self.unit = root / 'etc/systemd/system' / SERVICE
        self.backup = root / 'var/backups/opentalk-web-upgrade' / release
        self.expected_bundle = None

    def target(self, path, parent):
        require(path.is_symlink(), 'Expected managed release symlink')
        target = path.resolve(strict=True)
        require(target.parent == parent and target.is_dir() and not target.is_symlink(), 'Unsafe release link target')
        return target

    def link(self, path, target):
        temporary = path.with_name('.' + path.name + '-' + self.release)
        require(not temporary.exists() and not temporary.is_symlink(), 'Staging link already exists')
        try:
            temporary.symlink_to(target, target_is_directory=True)
            os.replace(temporary, path)
        finally:
            if temporary.is_symlink():
                temporary.unlink()

    def protected(self):
        bot = self.root / 'home/ubuntu/opentalk-bot'
        paths = [bot / name for name in ['.env', 'package.json', 'package-lock.json']]
        paths += list((bot / 'src').rglob('*.js'))
        paths += [self.root / 'home/ubuntu/.pm2/pids/opentalk-bot-0.pid']
        paths += [p for p in (self.root / 'etc/nginx').rglob('*') if p.is_file()]
        values = {}
        for path in sorted(paths):
            actual = path.resolve(strict=True) if path.is_symlink() else path
            values[path.relative_to(self.root).as_posix()] = digest(regular(actual))
        return values

    def check_native(self):
        require(os.name == 'posix' and os.geteuid() == 0, 'Server stages require Linux root')
        import pwd
        import grp
        account = pwd.getpwnam(USER)
        require(account.pw_uid == 995 and account.pw_gid == 987 and grp.getgrnam(USER).gr_gid == 987 and
                account.pw_shell == '/usr/sbin/nologin', 'Service identity changed')
        require(self.run(['/usr/bin/node', '--version']).startswith('v24.'), 'Node24 is required')
        for path in [self.code_releases, self.static_releases, self.state.parent, self.environment, self.unit, self.backup]:
            safe_parents(path)
        require(self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'DropInPaths']) == '', 'Unexpected unit override')
        require(self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'FragmentPath']) == str(self.unit), 'Service unit path changed')
        return account.pw_uid

    def schema(self):
        require(self.database.is_file() and not self.database.is_symlink(), 'Database is missing or unsafe')
        with closing(sqlite3.connect(self.database.as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
            require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'Database integrity check failed')
            require(db.execute('PRAGMA foreign_key_check').fetchall() == [], 'Database foreign key check failed')
            return db.execute('PRAGMA user_version').fetchone()[0]

    def permissions(self):
        if os.name != 'posix':
            return
        require(self.environment.stat().st_uid == self.environment.stat().st_gid == 0 and
                stat.S_IMODE(self.environment.stat().st_mode) == 0o600, 'Environment must remain root600')
        require(self.unit.stat().st_uid == self.unit.stat().st_gid == 0 and
                stat.S_IMODE(self.unit.stat().st_mode) == 0o644, 'Unit permissions changed')
        for path in [self.state, *self.state.rglob('*')]:
            require(not path.is_symlink() and (path.is_dir() or path.is_file()), 'Unsafe state entry')
            require(path.stat().st_uid == 995 and path.stat().st_gid == 987 and
                    stat.S_IMODE(path.stat().st_mode) == (0o700 if path.is_dir() else 0o600),
                    'State must remain dedicated-user700/600')

    def health(self):
        for attempt in range(40):
            try:
                require(self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'ActiveState']) == 'active', 'Web service inactive')
                pid = int(self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'MainPID']))
                status = (self.root / 'proc' / str(pid) / 'status').read_text()
                require(re.search(r'^Uid:\s+995\s+995\s+995\s+995$', status, re.MULTILINE) and
                        re.search(r'^Gid:\s+987\s+987\s+987\s+987$', status, re.MULTILINE), 'Web process identity changed')
                listeners = self.run(['ss', '-H', '-ltnp', 'sport = :8090']).splitlines()
                require(len(listeners) == 1 and listeners[0].split()[3] == '127.0.0.1:8090' and
                        ('pid=' + str(pid) + ',') in listeners[0], 'Web listener boundary changed')
                for path in ['/api/auth/health', '/api/auth/session']:
                    connection = http.client.HTTPConnection('127.0.0.1', 8090, timeout=2)
                    try:
                        connection.request('GET', path)
                        response = connection.getresponse()
                        raw = response.read(4097)
                        require(response.status == 200 and len(raw) <= 4096, 'Web health response failed')
                        value = json.loads(raw)
                        if path.endswith('health'):
                            require(value == {'ok': True}, 'Web health contract failed')
                        else:
                            require(value.get('authenticated') is False and
                                    value.get('providers') == {'discord': True, 'kakao': True} and
                                    response.getheader('Cache-Control') == 'no-store', 'Anonymous session contract failed')
                    finally:
                        connection.close()
                return
            except (OSError, RuntimeError, ValueError):
                if attempt == 39:
                    raise RuntimeError('Web service did not become ready') from None
                time.sleep(.25)

    def snapshot(self, expected_schema, check_health=True):
        uid = self.check_native()
        code = self.target(self.current, self.code_releases)
        static = self.target(self.static, self.static_releases)
        self.permissions()
        require(self.schema() == expected_schema, 'Unexpected existing schema')
        if check_health:
            self.health()
        return {'release': self.release, 'uid': uid, 'code_target': str(code), 'static_target': str(static),
                'code_files': tree(code, True), 'static_files': tree(static, True), 'schema': expected_schema,
                'environment_sha256': digest(regular(self.environment)), 'unit_sha256': digest(regular(self.unit)),
                'protected': self.protected()}

    def stop(self):
        self.run(['systemctl', 'stop', SERVICE])
        self.confirm_stopped()

    def confirm_stopped(self):
        require(self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'ActiveState']) in {'inactive', 'failed'} and
                self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'MainPID']) == '0', 'Web stop is unconfirmed')

    def abort_before_transition(self, before):
        report = {'release': self.release, 'live_files_untouched': True,
                  'inspection_required': True, 'original_service_ready': False}
        try:
            require(before == self.snapshot(1, check_health=False), 'Baseline changed while preparing the upgrade')
            state = self.run(['systemctl', 'show', SERVICE, '--value', '-p', 'ActiveState'])
            if state != 'active':
                self.confirm_stopped()
                self.run(['systemctl', 'start', SERVICE])
            self.health()
            report.update(inspection_required=False, original_service_ready=True)
        finally:
            write(self.backup / 'aborted.json', encoded(report))

    def backup_state(self):
        with closing(sqlite3.connect(self.database, timeout=5)) as db:
            require(db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] == 0, 'Database checkpoint is busy')
            require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Stopped database integrity failed')
        target = self.backup / 'state'
        target.mkdir(mode=0o700)
        for path in sorted(self.state.rglob('*')):
            require(not path.is_symlink() and (path.is_dir() or path.is_file()), 'Unsafe state entry')
            destination = target / path.relative_to(self.state)
            if path.is_dir():
                destination.mkdir(mode=0o700)
            else:
                write(destination, regular(path))
        require(tree(target) == tree(self.state), 'Consistent stopped state backup mismatch')
        return tree(target)

    def stage(self, payload):
        for name, target in [('code', self.code_release), ('static', self.static_release)]:
            require(not target.exists() and not target.is_symlink(), 'Release directory already exists')
            target.mkdir(mode=0o755)
            for relative, raw in payload[name].items():
                path = target.joinpath(*PurePosixPath(relative).parts[1:])
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                write(path, raw, 0o644)
            for path in [target, *target.rglob('*')]:
                if path.is_dir():
                    path.chmod(0o755)
            tree(target, True)

    def verify(self, payload, before, target_schema, environment_sha256):
        require(self.target(self.current, self.code_releases) == self.code_release and
                self.target(self.static, self.static_releases) == self.static_release, 'Release link changed')
        for name, target in [('code', self.code_release), ('static', self.static_release)]:
            expected = {'/'.join(PurePosixPath(key).parts[1:]): digest(value) for key, value in payload[name].items()}
            require(tree(target, True) == expected, 'Installed source manifest mismatch')
        require(digest(regular(self.environment)) == environment_sha256 and
                digest(regular(self.unit)) == before['unit_sha256'] and
                self.protected() == before['protected'], 'Protected deployment state changed')
        self.health()
        require(self.schema() == target_schema, 'Target migration did not complete')
        self.permissions()

    def apply(self, payload, before, target_schema, environment):
        require(before == self.snapshot(1), 'Preflight state changed; inspect again')
        require(target_schema == 4 and self.expected_bundle, 'Reviewed version4 bundle required')
        require(not self.backup.exists() and not self.backup.is_symlink(), 'Backup path already exists; use recovery')
        self.stage(payload)
        require(before == self.snapshot(1), 'Preflight state changed after staging; inspect again')
        self.backup.mkdir(parents=True, mode=0o700)
        self.backup.chmod(0o700)
        self.backup.parent.chmod(0o700)
        write(self.backup / 'environment.before', regular(self.environment))
        record = {'before': before, 'target_schema': target_schema, 'bundle_sha256': self.expected_bundle,
                  'environment_after_sha256': digest(environment), 'phase': 'prepared'}
        write(self.backup / 'transaction.json', encoded(record))
        transition_started = False
        try:
            self.stop()
            require(self.schema() == 1, 'Stopped schema changed')
            record['state_backup'] = self.backup_state()
            record['phase'] = 'backed-up'
            write(self.backup / 'transaction.json', encoded(record))
            require(before == self.snapshot(1, check_health=False), 'Preflight state changed before transition')
            self.confirm_stopped()
            transition_started = True
            write(self.environment, environment)
            self.link(self.current, self.code_release)
            self.link(self.static, self.static_release)
            self.run(['systemctl', 'start', SERVICE])
            self.verify(payload, before, target_schema, digest(environment))
            record['phase'] = 'verified'
            write(self.backup / 'transaction.json', encoded(record))
            write(self.backup / 'applied.json', encoded({'release': self.release, 'completed': True, 'schema': self.schema()}))
        except BaseException as failure:
            if not transition_started:
                try:
                    self.abort_before_transition(before)
                except BaseException as recovery:
                    raise RuntimeError('Upgrade aborted before transition; live files retained; inspect service and baseline: ' +
                                       str(recovery)) from failure
                raise
            try:
                self.rollback()
            except BaseException as recovery:
                raise RuntimeError('Upgrade failed; recovery incomplete: ' + str(recovery)) from failure
            raise

    def rollback(self):
        self.check_native()
        record = json.loads(regular(self.backup / 'transaction.json'))
        before = record['before']
        require(before['release'] == self.release and record['bundle_sha256'] == self.expected_bundle,
                'Recovery record does not match reviewed release')
        old_code, old_static = Path(before['code_target']), Path(before['static_target'])
        require(old_code.parent == self.code_releases and old_static.parent == self.static_releases,
                'Unsafe recovery target')
        require(tree(old_code, True) == before['code_files'] and tree(old_static, True) == before['static_files'],
                'Previous release files changed')
        require(self.target(self.current, self.code_releases) in {old_code, self.code_release} and
                self.target(self.static, self.static_releases) in {old_static, self.static_release},
                'Release link changed outside this transaction')
        require(digest(regular(self.unit)) == before['unit_sha256'] and self.protected() == before['protected'],
                'Protected service state changed')
        require(digest(regular(self.environment)) in {before['environment_sha256'], record['environment_after_sha256']},
                'Environment changed outside this transaction')
        original_env = regular(self.backup / 'environment.before')
        require(digest(original_env) == before['environment_sha256'], 'Original environment backup changed')
        report = {'release': self.release, 'current_database_preserved': True, 'completed': False}
        try:
            self.stop()
            require(self.schema() in {1, record['target_schema']}, 'Unexpected rollback schema; leave service stopped')
            with closing(sqlite3.connect(self.database, timeout=5)) as db:
                require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)] and
                        db.execute('PRAGMA foreign_key_check').fetchall() == [], 'Rollback database checks failed')
                db.execute('PRAGMA user_version=1')
            # Restore executable configuration only. New tables, accounts and inbox events stay current.
            write(self.environment, original_env)
            self.link(self.current, old_code)
            self.link(self.static, old_static)
            self.run(['systemctl', 'start', SERVICE])
            self.health()
            self.permissions()
            require(self.schema() == 1 and self.protected() == before['protected'], 'Recovery verification failed')
            report['completed'] = True
        finally:
            write(self.backup / 'rollback.json', encoded(report))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['pack', 'check', 'preflight', 'apply', 'verify', 'rollback'])
    parser.add_argument('--source', type=Path)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--release')
    parser.add_argument('--preflight-file', type=Path)
    parser.add_argument('--preflight-sha256')
    parser.add_argument('--settings-file', type=Path)
    parser.add_argument('--settings-sha256')
    args = parser.parse_args()
    if args.stage == 'pack':
        require(args.source is not None, '--source is required')
        print(json.dumps({'manifest_sha256': pack(args.source, args.bundle)}))
        return
    require(args.manifest_sha256, 'Reviewed manifest digest is required')
    payload, index = load_bundle(args.bundle, args.manifest_sha256)
    if args.stage == 'check':
        print(json.dumps({'validated': True, 'code_files': len(payload['code']), 'static_files': len(payload['static'])}))
        return
    require(os.name == 'posix' and os.geteuid() == 0, 'Server stages require Linux root')
    os.umask(0o077)
    release = Release(args.release or '')
    release.expected_bundle = args.manifest_sha256
    if args.stage == 'preflight':
        require(args.preflight_file is not None and not args.preflight_file.exists(), 'Use a new preflight output file')
        safe_parents(args.preflight_file)
        before = release.snapshot(1)
        require(before['unit_sha256'] == index['unit_sha256'], 'Existing unit differs from reviewed unit')
        environment_values(regular(release.environment))
        raw = encoded(before)
        write(args.preflight_file, raw)
        print(json.dumps({'preflight_sha256': digest(raw), 'schema': before['schema']}))
        return
    if args.stage == 'apply':
        require(args.preflight_file is not None and args.preflight_sha256, 'Reviewed preflight file and digest required')
        raw = regular(args.preflight_file)
        require(digest(raw) == args.preflight_sha256, 'Reviewed preflight digest mismatch')
        before = json.loads(raw)
        require(before['unit_sha256'] == index['unit_sha256'], 'Reviewed unit differs')
        additions = {}
        if args.settings_file is not None:
            safe_parents(args.settings_file)
            require(stat.S_IMODE(args.settings_file.stat().st_mode) == 0o600, 'Settings source must be root600')
            raw = regular(args.settings_file)
            require(args.settings_sha256 and digest(raw) == args.settings_sha256, 'Reviewed settings digest mismatch')
            additions = json.loads(raw)
        environment = extend_environment(regular(release.environment), additions)
        release.apply(payload, before, index['target_schema'], environment)
    elif args.stage == 'rollback':
        release.rollback()
    else:
        release.check_native()
        record = json.loads(regular(release.backup / 'transaction.json'))
        require(record['bundle_sha256'] == args.manifest_sha256, 'Transaction bundle differs')
        release.verify(payload, record['before'], index['target_schema'], record['environment_after_sha256'])
    print(json.dumps({'stage': args.stage, 'release': args.release, 'completed': True}))


if __name__ == '__main__':
    main()
