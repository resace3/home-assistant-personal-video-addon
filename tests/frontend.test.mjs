import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('personal_video_studio/app/static/app.js', 'utf8');
const styles = await readFile('personal_video_studio/app/static/styles.css', 'utf8');

test('frontend includes required playback and responsive safeguards', () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /playsinline/);
  assert.match(source, /promise\.catch/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /personal-video-studio:v1/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
});

test('sharing and credentials are absent from the browser bundle', () => {
  assert.doesNotMatch(source, /SUPERVISOR_TOKEN|OPENAI_API_KEY|Share video/);
});
