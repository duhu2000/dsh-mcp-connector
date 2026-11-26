"""Exercise the release readback with in-memory npm responses; never publish."""
import contextlib
import hashlib
import io
import json
import runpy
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


release = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/verify-published.py'))
name, version = release['PACKAGE'], '1.2.3'
spec = f'https://registry.npmjs.org/{name}/{version}'
url = f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'


def package(readme=b'one', path='README.md'):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w:gz') as archive:
        for filename, content in [('package.json', json.dumps({'name': name, 'version': version}).encode()),
                                  (path, readme)]:
            item = tarfile.TarInfo('package/' + filename)
            item.size = len(content)
            archive.addfile(item, io.BytesIO(content))
    return raw.getvalue()


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.local = package()
        self.path = Path(tmp.name) / f'{name}-{version}.tgz'
        self.path.write_bytes(self.local)
        self.log = io.StringIO()

    def verify(self, online, npm_sri=None, prior_sri=None):
        meta = {'name': name, 'version': version, 'dist': {
            'tarball': url, 'integrity': npm_sri or release['sri'](online)}}
        responses = {spec: json.dumps(meta).encode(), url: online}
        with patch('urllib.request.urlopen', side_effect=lambda address, timeout: io.BytesIO(responses[address])), \
                contextlib.redirect_stdout(self.log):
            release['verify'](version, self.path, prior_sri or release['sri'](self.local))

    def test_exact_archive(self):
        self.verify(self.local)
        report = json.loads(self.log.getvalue())
        self.assertEqual(report['online_sha256'], hashlib.sha256(self.local).hexdigest())
        self.assertEqual(report['online_files'], 2)
        self.assertTrue(report['bytes_equal'])

    def test_same_paths_different_bytes(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.verify(package(readme=b'two'))
        self.assertTrue(json.loads(self.log.getvalue())['paths_equal'])

    def test_different_paths(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.verify(package(path='other.md'))
        self.assertFalse(json.loads(self.log.getvalue())['paths_equal'])

    def test_wrong_npm_integrity(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.verify(self.local, npm_sri='sha512-invalid')

    def test_changed_since_review(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.verify(self.local, prior_sri='sha512-invalid')


if __name__ == '__main__':
    unittest.main()
