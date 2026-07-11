import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('personal_video_studio/app/static/app.js', 'utf8');
const styles = await readFile('personal_video_studio/app/static/styles.css', 'utf8');

test('frontend includes required playback and responsive safeguards', () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /playsinline/);
  assert.match(source, /await video\.play\(\)/);
  assert.match(source, /playbackObserver\?\.disconnect/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /personal-video-studio:v1/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /aria-live="polite"/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
  assert.match(styles, /forced-colors: active/);
});

test('Ingress URLs remain relative to the randomized application base', () => {
  assert.match(source, /new URL\(relativePath, document\.baseURI\)/);
  assert.doesNotMatch(source, /fetch\(['"]\/api/);
  const ingressBase = 'https://home.example/api/hassio_ingress/random-token/';
  assert.equal(new URL('api/videos', ingressBase).pathname, '/api/hassio_ingress/random-token/api/videos');
});

test('empty states distinguish canonical share mapping and catalog failures', () => {
  assert.match(source, /\/share\/personal_video_studio/);
  assert.match(source, /\/shared is different/);
  assert.match(source, /media_root_missing/);
  assert.match(source, /index_missing/);
  assert.match(source, /no_usable_entries/);
  assert.match(source, /Refresh library/);
});

test('sharing and credentials are absent from the browser bundle', () => {
  assert.doesNotMatch(source, /SUPERVISOR_TOKEN|OPENAI_API_KEY|Share video/);
});
