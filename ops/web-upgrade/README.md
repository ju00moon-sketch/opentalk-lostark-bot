# Existing website upgrade

This tool upgrades the existing `opentalk-web.service` and static website. It does not install a service, change Nginx, open ports, install dependencies, assign account roles, or restart the bot. Server stages require Linux root and the existing dedicated UID 995 / GID 987. The named `opentalk-web` group must resolve to GID 987; the process and state-file owners must match that exact pair.

`upgrade.py` has an explicit 11-file application and 27-file static allowlist. The release manifest binds those archives, the deployment tool, the unchanged service unit, target schema 4 and rollback schema 1. Review the final source and version 1 → 4 → 1 → 4 compatibility evidence before authorizing an application. Passing `check` proves artifact integrity, not release readiness.

## Prepare and inspect

1. Run `python upgrade.py pack --source <repository> --bundle <new-bundle-directory>` locally. Record the returned `manifest_sha256`. The source must contain exactly the reviewed application files and no dependencies.
2. Independently inspect that manifest and the actual source. Transfer the unchanged tool and bundle through the existing authorized deployment channel.
3. Run `python upgrade.py check --bundle <bundle> --manifest-sha256 <digest>` on Linux.
4. Run `python upgrade.py preflight --bundle <bundle> --manifest-sha256 <digest> --release web-guild-YYYYMMDD-HHMM --preflight-file <new-private-file>`. Inspect the resulting file and record its `preflight_sha256`. This requires a healthy schema 1 installation and captures existing code/static targets and hashes, environment hash, service unit and protected bot/Nginx file hashes. It contains no raw environment values or account data.

Apply checks the same state before staging, again after staging while the original service is still running, and once more after the stopped-state backup immediately before changing environment or links. Account/session changes are allowed between preflight and apply; the database is backed up only after the web service has stopped. A changed code/static/environment/unit/protected-file baseline requires a new inspection. State parent directories must be root-owned without symlinks; the state directory itself remains owned by the dedicated service account.

## Optional automatic approval settings

A private root-owned 600 JSON file may provide only `GUILD_AUTO_APPROVAL_ENABLED`, `GUILD_AUTO_DISCORD_GUILD_ID`, `GUILD_AUTO_DISCORD_ROLE_ID` and `LOSTARK_API_KEY`. Its SHA-256 must be supplied explicitly. These values are appended to the existing environment; replacing existing fields is refused. Enabling automatic approval requires every field, a nonempty API key and valid Discord IDs. The implementation must separately validate the actual trusted guild, role and character membership. Keep secrets out of arguments, public artifacts and reports.

## Apply and verify

Run `python upgrade.py apply --bundle <bundle> --manifest-sha256 <digest> --release <release> --preflight-file <file> --preflight-sha256 <digest>`, adding `--settings-file <private-json> --settings-sha256 <digest>` only for reviewed settings.

The tool stages code/static files with root 755/644 permissions, records a private transaction under `/var/backups/opentalk-web-upgrade/<release>`, stops the web service, checkpoints SQLite and copies the complete stopped state directory including the unlink inbox. It then appends the environment settings, atomically replaces the two release symlinks and starts the existing service. Health, anonymous session, loopback listener, schema, source hashes, state permissions and protected files are checked. No service reload or enabling operation is used.

Run `python upgrade.py verify --bundle <bundle> --manifest-sha256 <digest> --release <release>` to repeat those checks. Then independently verify the public HTTPS routes, authenticated guild flows, exact owner assignment if separately authorized, failed authorization, existing bot responses and final deployment boundaries. The tool's anonymous checks do not prove social consent or automatic approval with a real Discord account.

## Recover

An exception after the first live-file transition invokes rollback automatically. If that recovery is incomplete, the command fails and retains all staged releases, the transaction and backups. Inspect `/var/backups/opentalk-web-upgrade/<release>/rollback.json`. Use the same reviewed tool, bundle and release with `python upgrade.py rollback --bundle <bundle> --manifest-sha256 <digest> --release <release>` after resolving the reported conflict. Recovery can be repeated.

Before that first transition, an error writes `aborted.json` and never restores or overwrites live files. If the original baseline still matches, the original service is started if stopped and checked. If files or paths changed externally, the tool leaves them intact and does not restart potentially unreviewed code. A service already stopped remains stopped for inspection. An error detected just after staging occurs before any service stop or transaction backup.

Rollback stops the web service, validates the **current** database, resets only `user_version` to 1, restores the previous code/static links and previous environment, and starts the old application. It retains newer tables, newly created accounts, account deletions, sessions and the current unlink inbox. It never copies a stale database or inbox over current data. A schema other than 1 or the reviewed target is refused and leaves the service stopped. The current application must have demonstrated old-version foreign-key deletion and session compatibility before release.

External changes to release links, the old release files, environment, unit or protected files stop recovery for inspection. Partial staging before a transaction is recorded does not modify the live installation; choose a new release identifier after inspecting the preserved partial directories. Do not remove backups or run the first-install rollback tool for this upgrade.

## Local tests

Run `python ops/web-upgrade/test_upgrade.py`. Tests use real temporary files and SQLite, simulated service commands and HTTP responses. Windows uses marker files for symlink transitions; the same suite uses real symlinks on Linux. Tests do not establish real Linux service identity, ownership or production network behavior. Independent Linux checks are required before applying the upgrade.
