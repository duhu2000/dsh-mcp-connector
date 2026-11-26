"""Verify the exact-version npm download against the archive reviewed before publish."""
import base64
import hashlib
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path


PACKAGE = 'dsh-mcp-connector'
REGISTRY = 'https://registry.npmjs.org'


def file_list(data, version):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        paths = []
        for member in archive:
            if not member.isfile() or not member.name.startswith('package/'):
                raise ValueError('Unexpected npm archive member')
            paths.append(member.name)
        if len(paths) != len(set(paths)):
            raise ValueError('Duplicate path in npm archive')
        manifest = json.load(archive.extractfile('package/package.json'))
    if (manifest['name'], manifest['version']) != (PACKAGE, version):
        raise ValueError('Package identity mismatch in archive')
    return sorted(paths)


def sri(data):
    return 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode('ascii')


def verify(version, reviewed_path, reviewed_integrity):
    with urllib.request.urlopen(f'{REGISTRY}/{PACKAGE}/{version}', timeout=30) as response:
        metadata = json.load(response)
    if (metadata['name'], metadata['version']) != (PACKAGE, version):
        raise ValueError('Exact-version npm metadata mismatch')
    url = f'{REGISTRY}/{PACKAGE}/-/{PACKAGE}-{version}.tgz'
    if metadata['dist']['tarball'] != url:
        raise ValueError('Unexpected npm tarball URL')
    reviewed = reviewed_path.read_bytes()
    with urllib.request.urlopen(url, timeout=60) as response:
        online = response.read()
    local_files = file_list(reviewed, version)
    online_files = file_list(online, version)
    report = {
        'package': PACKAGE, 'version': version, 'tarball': url,
        'reviewed_file': reviewed_path.name,
        'reviewed_files': len(local_files), 'online_files': len(online_files),
        'paths_equal': local_files == online_files, 'bytes_equal': reviewed == online,
        'reviewed_bytes': len(reviewed), 'online_bytes': len(online),
        'reviewed_sha256': hashlib.sha256(reviewed).hexdigest(),
        'online_sha256': hashlib.sha256(online).hexdigest(),
        'prepublish_integrity': reviewed_integrity, 'reviewed_sri': sri(reviewed),
        'online_sri': sri(online), 'npm_integrity': metadata['dist']['integrity'],
    }
    print(json.dumps(report, indent=2))
    if not (report['paths_equal'] and report['bytes_equal']
            and reviewed_integrity == report['reviewed_sri'] == report['online_sri'] == report['npm_integrity']):
        raise ValueError('Published package differs from the reviewed tarball or integrity metadata')


if __name__ == '__main__':
    version, filename, integrity = sys.argv[1:]
    verify(version, Path(filename), integrity)
