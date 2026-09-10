from contextlib import closing
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


class UpgradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = None
        path = HERE / 'upgrade.py'
        if path.exists():
            spec = importlib.util.spec_from_file_location('web_upgrade', path)
            cls.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.module)

    def implementation(self):
        self.assertIsNotNone(self.module, 'Upgrade implementation is missing')
        return self.module

    def archive(self, root, entries):
        path = root / 'payload.tar.gz'
        rows = []
        with tarfile.open(path, 'w:gz') as out:
            for name, value, kind in entries:
                member = tarfile.TarInfo(name)
                member.type, member.size = kind, len(value) if kind == tarfile.REGTYPE else 0
                member.linkname = '/etc/passwd' if kind != tarfile.REGTYPE else ''
                out.addfile(member, io.BytesIO(value) if kind == tarfile.REGTYPE else None)
                rows.append({'path': name, 'size': len(value), 'sha256': hashlib.sha256(value).hexdigest()})
        return path, {'archive_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'files': rows}

    def test_accepts_hash_bound_regular_archive(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            path, index = self.archive(Path(folder), [('web/src/start.js', b'code', tarfile.REGTYPE)])
            self.assertEqual(module.read_archive(path, index, {'web/src/start.js'}), {'web/src/start.js': b'code'})
            index['files'][0]['sha256'] = '0' * 64
            with self.assertRaises(RuntimeError):
                module.read_archive(path, index, {'web/src/start.js'})

    def test_rejects_duplicate_traversal_symlink_and_secret_payloads(self):
        module = self.implementation()
        entries = [('../escape', b'x', tarfile.REGTYPE), ('/etc/passwd', b'x', tarfile.REGTYPE),
                   ('web/.env', b'x', tarfile.REGTYPE), ('web/src/start.js', b'', tarfile.SYMTYPE),
                   ('web/src/start.js', b'', tarfile.LNKTYPE)]
        for item in entries:
            with self.subTest(item=item), tempfile.TemporaryDirectory() as folder:
                path, index = self.archive(Path(folder), [item])
                with self.assertRaises(RuntimeError):
                    module.read_archive(path, index, {'web/src/start.js'})
        with tempfile.TemporaryDirectory() as folder:
            path, index = self.archive(Path(folder), [('web/src/start.js', b'x', tarfile.REGTYPE)] * 2)
            with self.assertRaises(RuntimeError):
                module.read_archive(path, index, {'web/src/start.js'})

    def test_pack_binds_explicit_inventory_tool_unit_and_archive(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'source'
            for name in module.CODE | module.PUBLIC | {'ops/web/opentalk-web.service'}:
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'{"type":"module"}' if name == 'web/package.json' else b'fixture')
            bundle = root / 'bundle'
            sha = module.pack(source, bundle)
            payload, index = module.load_bundle(bundle, sha)
            self.assertEqual(set(payload['code']), module.CODE)
            self.assertEqual(set(payload['static']), module.PUBLIC)
            self.assertEqual(index['unit_sha256'], module.digest(b'fixture'))
            with self.assertRaises(RuntimeError):
                module.load_bundle(bundle, '0' * 64)
            (bundle / 'code.tar.gz').write_bytes(b'changed')
            with self.assertRaises(RuntimeError):
                module.load_bundle(bundle, sha)
            (source / 'web/src/unreviewed.js').write_bytes(b'new')
            with self.assertRaises(RuntimeError):
                module.pack(source, root / 'second-bundle')

    def test_environment_append_keeps_existing_secrets_and_fixed_settings(self):
        module = self.implementation()
        original = (b'WEB_ORIGIN=https://pogeunhaeyong.duckdns.org\nWEB_HOST=127.0.0.1\n'
                    b'WEB_PORT=8090\nWEB_DB_PATH=/var/lib/opentalk-web/auth.sqlite\n'
                    b'DISCORD_OAUTH_CLIENT_ID=123\nDISCORD_OAUTH_CLIENT_SECRET=private\n'
                    b'KAKAO_OAUTH_CLIENT_ID=456\nKAKAO_OAUTH_CLIENT_SECRET=private\n'
                    b'KAKAO_ADMIN_KEY=private\nKAKAO_APP_ID=789\n')
        self.assertEqual(module.extend_environment(original, {}), original)
        for settings in [{'WEB_PORT': '8091'}, {'DISCORD_OAUTH_CLIENT_SECRET': 'replace'},
                         {'UNREVIEWED_KEY': 'secret'}]:
            with self.assertRaises(RuntimeError):
                module.extend_environment(original, settings)
        settings = {'GUILD_AUTO_APPROVAL_ENABLED': 'true', 'GUILD_AUTO_DISCORD_GUILD_ID': '660684739056762891',
                    'GUILD_AUTO_DISCORD_ROLE_ID': '660684739056762892', 'LOSTARK_API_KEY': 'synthetic.token'}
        result = module.extend_environment(original, settings)
        self.assertTrue(result.startswith(original))
        self.assertIn(b'GUILD_AUTO_APPROVAL_ENABLED=true\n', result)
        with self.assertRaises(RuntimeError):
            module.extend_environment(original, {'GUILD_AUTO_APPROVAL_ENABLED': 'true'})

    def test_health_waits_for_service_listener_to_become_ready(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'proc/77').mkdir(parents=True)
            (root / 'proc/77/status').write_text('Uid:\t995\t995\t995\t995\nGid:\t987\t987\t987\t987\n')
            attempts = []

            def runner(args):
                if args[0] == 'ss':
                    attempts.append(1)
                    return '' if len(attempts) == 1 else 'LISTEN 0 10 127.0.0.1:8090 0.0.0.0:* users:((node,pid=77,fd=1))'
                return 'active' if args[-1] == 'ActiveState' else '77'

            class Response:
                status = 200

                def read(self, size):
                    return b'{"ok":true}' if self.path.endswith('health') else b'{"authenticated":false,"providers":{"discord":true,"kakao":true}}'

                def getheader(self, key):
                    return 'no-store'

            class Connection:
                def __init__(self, *args, **kwargs):
                    pass

                def request(self, method, path):
                    self.path = path

                def getresponse(self):
                    response = Response()
                    response.path = self.path
                    return response

                def close(self):
                    pass

            release = module.Release('web-guild-20260910-2200', root=root, runner=runner)
            with patch.object(module.http.client, 'HTTPConnection', Connection), patch.object(module.time, 'sleep'):
                release.health()
            self.assertEqual(len(attempts), 2)
            (root / 'proc/77/status').write_text('Uid:\t995\t995\t995\t995\nGid:\t995\t995\t995\t995\n')
            with patch.object(module.http.client, 'HTTPConnection', Connection), patch.object(module.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    release.health()

    def fixture(self, folder, fail_start=False):
        module = self.implementation()
        commands = []

        class LocalRelease(module.Release):
            def link(self, path, target):
                if os.name == 'nt':
                    module.write(path, str(target).encode(), 0o644)
                else:
                    super().link(path, target)

            def target(self, path, parent):
                if os.name == 'nt':
                    target = Path(path.read_text())
                    module.require(target.parent == parent and target.is_dir(), 'Unsafe link target')
                    return target
                return super().target(path, parent)

            def check_native(self):
                return 995

            def protected(self):
                return {'bot': module.digest(b'unchanged')}

            def health(self):
                return None

            def permissions(self):
                return None

        running = {'active': True, 'failed_once': False}

        def runner(args):
            commands.append(args)
            if args[:2] == ['systemctl', 'stop']:
                running['active'] = False
            elif args[:2] == ['systemctl', 'start']:
                new = release.target(release.current, release.code_releases) == release.code_release
                if new:
                    with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                        db.execute('CREATE TABLE IF NOT EXISTS extra (user_id TEXT REFERENCES users(id) ON DELETE CASCADE)')
                        db.execute('PRAGMA user_version=4')
                    if fail_start and not running['failed_once']:
                        running['failed_once'] = True
                        raise RuntimeError('Simulated startup failure after migration')
                running['active'] = True
            elif args[-1] == 'ActiveState':
                return 'active' if running['active'] else 'inactive'
            elif args[-1] == 'MainPID':
                return '7' if running['active'] else '0'
            return ''

        release = LocalRelease('web-guild-20260910-2200', root=Path(folder), runner=runner)
        for path in [release.code_releases / 'old', release.static_releases / 'old', release.state, release.unit.parent]:
            path.mkdir(parents=True, exist_ok=True)
        (release.code_releases / 'old/start.js').write_bytes(b'oldcode')
        (release.static_releases / 'old/index.html').write_bytes(b'oldstatic')
        for path in [release.code_releases / 'old', release.static_releases / 'old']:
            path.chmod(0o755)
            for entry in path.rglob('*'):
                entry.chmod(0o644)
        release.link(release.current, release.code_releases / 'old')
        release.link(release.static, release.static_releases / 'old')
        release.environment.write_bytes(b'unchanged-private-environment')
        release.unit.write_bytes(b'unchanged-unit')
        with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
            db.execute('CREATE TABLE users (id TEXT PRIMARY KEY)')
            db.execute("INSERT INTO users VALUES ('before')")
            db.execute('PRAGMA user_version=1')
        inbox = release.state / 'unlink-inbox'
        inbox.mkdir()
        (inbox / 'pending.json').write_bytes(b'pending-event')
        before = release.snapshot(1)
        payload = {'code': {'web/package.json': b'{"type":"module"}', 'web/src/start.js': b'newcode'},
                   'static': {'docs/index.html': b'newstatic'}}
        release.expected_bundle = 'f' * 64
        return release, before, payload, commands

    def test_upgrade_and_rollback_preserve_current_data_and_inbox(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder)
            release.apply(payload, before, 4, release.environment.read_bytes())
            self.assertEqual(release.schema(), 4)
            self.assertTrue((release.backup / 'state/auth.sqlite').is_file())
            self.assertEqual((release.backup / 'state/unlink-inbox/pending.json').read_bytes(), b'pending-event')
            with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                db.execute("DELETE FROM users WHERE id='before'")
                db.execute("INSERT INTO users VALUES ('after')")
            (release.state / 'unlink-inbox/pending.json').unlink()
            (release.state / 'unlink-inbox/new.json').write_bytes(b'new-event')
            release.rollback()
            self.assertEqual(release.schema(), 1)
            with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                self.assertEqual(db.execute('SELECT id FROM users').fetchall(), [('after',)])
            self.assertFalse((release.state / 'unlink-inbox/pending.json').exists())
            self.assertTrue((release.state / 'unlink-inbox/new.json').exists())
            self.assertEqual(release.environment.read_bytes(), b'unchanged-private-environment')
            self.assertFalse(any('daemon-reload' in row or 'enable' in row or 'restart' in row for row in commands))

    def test_start_failure_restores_code_static_environment_and_current_database(self):
        self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder, fail_start=True)
            with self.assertRaisesRegex(RuntimeError, 'Simulated startup'):
                release.apply(payload, before, 4, b'new-private-environment')
            self.assertEqual(release.target(release.current, release.code_releases).name, 'old')
            self.assertEqual(release.target(release.static, release.static_releases).name, 'old')
            self.assertEqual(release.environment.read_bytes(), b'unchanged-private-environment')
            self.assertEqual(release.schema(), 1)
            self.assertTrue(json.loads((release.backup / 'rollback.json').read_bytes())['completed'])

    def test_partial_environment_write_failure_recovers_without_replacing_database(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder)
            original = module.write
            failed = [False]

            def failure(path, data, mode=0o600):
                if path == release.environment and data == b'new-private-environment' and not failed[0]:
                    failed[0] = True
                    raise OSError('Simulated atomic write failure')
                return original(path, data, mode)

            with patch.object(module, 'write', failure), self.assertRaisesRegex(OSError, 'Simulated atomic write'):
                release.apply(payload, before, 4, b'new-private-environment')
            self.assertEqual(release.target(release.current, release.code_releases).name, 'old')
            self.assertEqual(release.schema(), 1)

    def test_preflight_drift_stops_before_service_or_files_change(self):
        self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder)
            release.environment.write_bytes(b'changed-externally')
            with self.assertRaisesRegex(RuntimeError, 'Preflight state changed'):
                release.apply(payload, before, 4, b'new')
            self.assertEqual(commands, [])
            self.assertFalse(release.code_release.exists())

    def test_staging_drift_never_stops_or_overwrites_the_live_installation(self):
        self.implementation()
        for changed in ['environment', 'source']:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as folder:
                release, before, payload, commands = self.fixture(folder)
                stage = release.stage
                path = release.environment if changed == 'environment' else release.code_releases / 'old/start.js'

                def external_change(content):
                    stage(content)
                    path.write_bytes(b'external-change')

                release.stage = external_change
                with self.assertRaisesRegex(RuntimeError, 'Preflight state changed'):
                    release.apply(payload, before, 4, b'approved-environment')
                self.assertEqual(path.read_bytes(), b'external-change')
                self.assertEqual(release.target(release.current, release.code_releases).name, 'old')
                self.assertEqual(commands, [])
                self.assertFalse(release.backup.exists())

    def test_stopped_backup_drift_leaves_external_files_and_service_stopped_for_review(self):
        self.implementation()
        for changed in ['environment', 'source']:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as folder:
                release, before, payload, commands = self.fixture(folder)
                backup = release.backup_state
                path = release.environment if changed == 'environment' else release.code_releases / 'old/start.js'

                def external_change():
                    result = backup()
                    path.write_bytes(b'external-change')
                    return result

                release.backup_state = external_change
                with self.assertRaisesRegex(RuntimeError, 'before transition'):
                    release.apply(payload, before, 4, b'approved-environment')
                self.assertEqual(path.read_bytes(), b'external-change')
                self.assertEqual(release.target(release.current, release.code_releases).name, 'old')
                self.assertEqual(release.schema(), 1)
                self.assertFalse(any(row[:2] == ['systemctl', 'start'] for row in commands))
                report = json.loads((release.backup / 'aborted.json').read_bytes())
                self.assertTrue(report['inspection_required'])
                self.assertTrue(report['live_files_untouched'])

    def test_rollback_refuses_external_links_or_schema_and_can_be_retried(self):
        self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder)
            release.apply(payload, before, 4, release.environment.read_bytes())
            with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                db.execute('PRAGMA user_version=9')
            with self.assertRaises(RuntimeError):
                release.rollback()
            with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                db.execute('PRAGMA user_version=4')
            release.rollback()
            release.rollback()
            self.assertEqual(release.schema(), 1)

    @unittest.skipUnless(os.name == 'posix', 'POSIX owner and mode verification requires Linux')
    def test_public_tree_refuses_writable_code_and_symlinks(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            root.chmod(0o755)
            code = root / 'start.js'
            code.write_bytes(b'code')
            code.chmod(0o644)
            self.assertEqual(module.tree(root, True), {'start.js': module.digest(b'code')})
            code.chmod(0o666)
            with self.assertRaises(RuntimeError):
                module.tree(root, True)
            code.chmod(0o644)
            (root / 'linked.js').symlink_to(code)
            with self.assertRaises(RuntimeError):
                module.tree(root, True)

    @unittest.skipUnless(os.name == 'posix', 'POSIX ownership and account checks require Linux')
    def test_native_checks_reject_redirected_parent_without_rejecting_service_owned_state(self):
        module = self.implementation()
        import pwd
        import grp
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            release = module.Release('web-guild-20260910-2200', root=root)
            for path in [release.code_releases, release.static_releases, release.unit.parent, root / 'var/lib']:
                path.mkdir(parents=True, exist_ok=True)
            release.state.mkdir()
            release.state.chmod(0o700)
            os.chown(release.state, 995, 987)
            release.environment.write_bytes(b'env')
            release.unit.write_bytes(b'unit')

            def parents(path):
                for entry in [path, *path.parents]:
                    if entry == root.parent:
                        break
                    if entry.exists() or entry.is_symlink():
                        module.require(not entry.is_symlink(), 'Symlink in deployment path')
                        module.require(entry.stat().st_uid == 0 and not entry.stat().st_mode & 0o022, 'Unsafe parent')

            def runner(args):
                if args[0] == '/usr/bin/node':
                    return 'v24.19.0'
                return str(release.unit) if args[-1] == 'FragmentPath' else ''

            release.run = runner
            account = types.SimpleNamespace(pw_uid=995, pw_gid=987, pw_shell='/usr/sbin/nologin')
            group = types.SimpleNamespace(gr_gid=987)
            with patch.object(module, 'safe_parents', parents), patch.object(pwd, 'getpwnam', return_value=account), \
                    patch.object(grp, 'getgrnam', return_value=group):
                self.assertEqual(release.check_native(), 995)
                account.pw_gid = 995
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    release.check_native()
                account.pw_gid = 987
                group.gr_gid = 995
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    release.check_native()
                group.gr_gid = 987
                redirected = root / 'redirected'
                (root / 'var/lib').rename(redirected)
                (root / 'var/lib').symlink_to(redirected, target_is_directory=True)
                with self.assertRaisesRegex(RuntimeError, 'Symlink'):
                    release.check_native()

    @unittest.skipUnless(os.name == 'posix', 'POSIX state ownership verification requires Linux')
    def test_state_permissions_require_exact_uid995_gid987(self):
        module = self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release = module.Release('web-guild-20260910-2200', root=Path(folder))
            release.unit.parent.mkdir(parents=True)
            release.unit.write_bytes(b'unit')
            release.unit.chmod(0o644)
            release.environment.write_bytes(b'env')
            release.environment.chmod(0o600)
            release.state.mkdir(parents=True)
            release.state.chmod(0o700)
            os.chown(release.state, 995, 987)
            release.database.write_bytes(b'fixture')
            release.database.chmod(0o600)
            os.chown(release.database, 995, 987)
            release.permissions()
            os.chown(release.database, 995, 995)
            with self.assertRaisesRegex(RuntimeError, 'dedicated-user'):
                release.permissions()

    def test_rollback_keeps_foreign_key_corruption_stopped_for_review(self):
        self.implementation()
        with tempfile.TemporaryDirectory() as folder:
            release, before, payload, commands = self.fixture(folder)
            release.apply(payload, before, 4, release.environment.read_bytes())
            with closing(sqlite3.connect(release.database, isolation_level=None)) as db:
                db.execute("INSERT INTO extra VALUES ('missing')")
            with self.assertRaisesRegex(RuntimeError, 'foreign key'):
                release.rollback()
            self.assertFalse(json.loads((release.backup / 'rollback.json').read_bytes())['completed'])
            self.assertEqual(commands[-3:], [['systemctl', 'stop', 'opentalk-web.service'],
                ['systemctl', 'show', 'opentalk-web.service', '--value', '-p', 'ActiveState'],
                ['systemctl', 'show', 'opentalk-web.service', '--value', '-p', 'MainPID']])


if __name__ == '__main__':
    unittest.main(verbosity=2)
