#!/usr/bin/env python3
"""
Write repo.json, the Homebrew Channel catalog of this fork, from the manifest
scripts/build-ipk.py left in dist/. The catalog lists one package, Glasshouse,
whose manifest and .ipk are assets of the release tagged v<version> on
github.com/quzopl/glasshouse. The Homebrew Channel reads it at

    https://raw.githubusercontent.com/quzopl/glasshouse/main/repo.json

and Glasshouse's own catalog list takes https://github.com/quzopl/glasshouse.

The manifest is rewritten with an absolute ipkUrl, and the rewritten one is
what goes up as the release asset, so neither depends on how a reader
resolves a relative address.

    scripts/build-ipk.py && scripts/fork-repo-json.py
"""

import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
OWNER_REPO = 'quzopl/glasshouse'


def main():
    found = glob.glob(os.path.join(DIST, '*.manifest.json'))
    if len(found) != 1:
        sys.exit('expected one manifest in dist/, found %d: run scripts/build-ipk.py first' % len(found))
    path = found[0]
    with open(path, encoding='utf-8') as f:
        manifest = json.load(f)
    base = 'https://github.com/%s/releases/download/v%s/' % (OWNER_REPO, manifest['version'])
    if not manifest['ipkUrl'].startswith('https://'):
        manifest['ipkUrl'] = base + manifest['ipkUrl']
    manifest['ipkSize'] = os.path.getsize(os.path.join(DIST, os.path.basename(manifest['ipkUrl'])))
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')

    package = {
        'id': manifest['id'],
        'title': manifest['title'],
        'iconUri': manifest['iconUri'],
        'manifestUrl': base + os.path.basename(path),
        'manifest': manifest,
        'pool': 'main',
        'requirements': {'webosRelease': '>=4.0'},
        'shortDescription': manifest['appDescription'],
        'fullDescriptionUrl': 'https://github.com/%s#readme' % OWNER_REPO,
    }
    repo = {
        'paging': {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': 1, 'prevUrl': None, 'nextUrl': None},
        'packages': [package],
    }
    with open(os.path.join(ROOT, 'repo.json'), 'w', encoding='utf-8') as f:
        json.dump(repo, f, indent=2)
        f.write('\n')
    print('repo.json: %s %s' % (manifest['id'], manifest['version']))


if __name__ == '__main__':
    main()
