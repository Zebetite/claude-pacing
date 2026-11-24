import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesOf, versionOf, withVersion } from '../scripts/release.mjs';

const previous = '## Changed\n\n- old\n\n## Changelog\n\n### 0.9.22\n- a\n\n### 0.9.21\n- b\n';

test('the release body: this version\'s Changed section, then its entry before the earlier ones', () => {
  const draft = '## Changed\n\n- **New.** It does this.\n\n### 0.9.23\n- It does this.\n';
  assert.equal(notesOf(draft, '0.9.23', previous),
    '## Changed\n\n- **New.** It does this.\n\n## Changelog\n\n### 0.9.23\n- It does this.\n\n### 0.9.22\n- a\n\n### 0.9.21\n- b\n');
  // a draft that has its own Changelog heading, and CRLF
  assert.equal(notesOf(draft.replace('### 0.9.23', '## Changelog\n\n### 0.9.23').replace(/\n/g, '\r\n'), '0.9.23', previous),
    notesOf(draft, '0.9.23', previous));
});

test('a release made again replaces its old entry; a draft without its parts is refused', () => {
  const again = notesOf('## Changed\n\n- x\n\n### 0.9.22\n- new a\n', '0.9.22', previous);
  assert.equal(again, '## Changed\n\n- x\n\n## Changelog\n\n### 0.9.22\n- new a\n\n### 0.9.21\n- b\n');
  assert.throws(() => notesOf('## Changed\n\n- x\n', '0.9.23', previous), /no "### 0.9.23" entry/);
  assert.throws(() => notesOf('- x\n\n### 0.9.23\n- y\n', '0.9.23', previous), /no "## Changed" section/);
  assert.equal(notesOf('## Changed\n\n- x\n\n### 1.0.0\n- y\n', '1.0.0'), '## Changed\n\n- x\n\n## Changelog\n\n### 1.0.0\n- y\n');
});

test('the manifest version is read and set without touching the rest', () => {
  const m = '{\n  "name": "pacing",\n  "version": "0.9.22",\n  "description": "x"\n}\n';
  assert.equal(versionOf(m), '0.9.22');
  assert.equal(withVersion(m, '0.9.23'), m.replace('0.9.22', '0.9.23'));
});
