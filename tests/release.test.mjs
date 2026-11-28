import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesOf, messageOf, TRAILER, versionOf, withVersion } from '../scripts/release.mjs';

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

test('one notes file: its # subject line is not in the release body; the commit message is built from it', () => {
  const draft = '# Shades blend from the line\n\n## Changed\n\n- **Colours**: blend from the line.\n- Smaller buttons.\n\n## Changelog\n\n### 0.9.49\n- Shades blend.\n'
  assert.equal(notesOf(draft, '0.9.49'), '## Changed\n\n- **Colours**: blend from the line.\n- Smaller buttons.\n\n## Changelog\n\n### 0.9.49\n- Shades blend.\n')
  assert.equal(messageOf(draft, '0.9.49'), 'Shades blend from the line; pacing 0.9.49\n\n- Colours: blend from the line.\n- Smaller buttons.\n\n' + TRAILER + '\n')
  assert.equal(messageOf(draft.replace(/\n/g, '\r\n'), '0.9.49'), messageOf(draft, '0.9.49'))
  assert.throws(() => messageOf('## Changed\n\n- x\n\n### 0.9.49\n- y\n', '0.9.49'), /no "# <subject>" first line/)
  assert.match(TRAILER, /^Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>$/)
})
