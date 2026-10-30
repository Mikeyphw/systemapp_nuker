#!/usr/bin/env python3
"""Validate an installable System App Nuker module ZIP, not an Actions wrapper ZIP."""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys
import zipfile

REQUIRED = {
    'module.prop',
    'META-INF/com/google/android/update-binary',
    'META-INF/com/google/android/updater-script',
    'config.sh',
    'customize.sh',
    'nuke.sh',
    'post-fs-data.sh',
    'service.sh',
    'uninstall.sh',
    'dummy.zip',
    'webroot/index.html',
    'webroot/uad.json',
    'webroot/adl.json',
}
EXECUTABLE = {
    'META-INF/com/google/android/update-binary',
    'customize.sh',
    'nuke.sh',
    'post-fs-data.sh',
    'service.sh',
    'uninstall.sh',
    'action.sh',
}


class PackageError(ValueError):
    pass


def check(archive: str | pathlib.Path, expected_version: str | None = None) -> dict:
    with zipfile.ZipFile(archive) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        names = [i.filename for i in infos]
        if len(names) != len(set(names)):
            raise PackageError('duplicate archive entries')
        for name in names:
            if (name.startswith('/') or name.startswith('./') or
                '\\' in name or '..' in name.split('/') or
                any(s == '' for s in name.split('/'))):
                raise PackageError(f'unsafe/non-root archive entry: {name}')
            if name == 'dummy_zip' or name.startswith('dummy_zip/'):
                raise PackageError('source-only dummy_zip directory present')
        missing = REQUIRED - set(names)
        if missing:
            raise PackageError(f'missing required module entries: {sorted(missing)}')
        if not any(n.startswith('webroot/assets/') and n.endswith('.js') for n in names):
            raise PackageError('compiled WebUI JavaScript is missing')
        if z.testzip() is not None:
            raise PackageError('corrupt archive entry')
        for name in EXECUTABLE.intersection(names):
            mode = z.getinfo(name).external_attr >> 16
            if mode & 0o111 == 0:
                raise PackageError(f'executable mode lost for {name}')
        module_prop = z.read('module.prop').decode('utf-8')
        properties = dict(line.split('=', 1) for line in module_prop.splitlines()
                          if line and not line.startswith('#') and '=' in line)
        if properties.get('id') != 'system_app_nuker':
            raise PackageError('wrong module ID')
        if expected_version is not None and properties.get('version') != expected_version:
            raise PackageError('module version does not match workflow release version')
        if 'Mikeyphw/systemapp_nuker' not in properties.get('updateJson', ''):
            raise PackageError('module update feed does not point at the fork')
        for name in ('uad.json', 'adl.json'):
            obj = json.loads(z.read('webroot/' + name))
            if name == 'uad.json':
                if not isinstance(obj, dict) or len(obj) < 5000:
                    raise PackageError('UAD snapshot appears missing/truncated')
            elif not isinstance(obj, dict) or len(obj.get('entries', {})) < 4000:
                raise PackageError('ADL snapshot appears missing/truncated')
        try:
            with zipfile.ZipFile(io.BytesIO(z.read('dummy.zip'))) as nested:
                if nested.testzip() is not None:
                    raise PackageError('embedded dummy.zip is corrupt')
        except zipfile.BadZipFile as exc:
            raise PackageError('embedded dummy.zip is invalid') from exc
        return {'ok': True, 'version': properties['version'], 'entries': len(names),
                'size': pathlib.Path(archive).stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--expected-version')
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.archive, args.expected_version), sort_keys=True))
    except (PackageError, zipfile.BadZipFile, OSError, KeyError, ValueError) as exc:
        print(f'INVALID INSTALLABLE ZIP: {exc}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
