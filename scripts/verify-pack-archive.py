"""Check the exact npm tarball against the reviewed path-to-SHA256 manifest on stdin."""
import hashlib
import json
import sys
import tarfile


def verify(archive, expected):
    seen = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            prefix = 'package/'
            if not member.name.startswith(prefix) or not member.isfile():
                raise ValueError(f'Unexpected archive member: {member.name}')
            path = member.name[len(prefix):]
            if path in seen or path not in expected:
                raise ValueError(f'Duplicate or unapproved archive path: {path}')
            digest = hashlib.sha256()
            with tar.extractfile(member) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != expected[path]:
                raise ValueError(f'Archive content differs from reviewed file: {path}')
            seen.add(path)
    missing = expected.keys() - seen
    if missing:
        raise ValueError('Missing archive files: ' + ', '.join(sorted(missing)))


if __name__ == '__main__':
    verify(sys.argv[1], json.load(sys.stdin.buffer))
