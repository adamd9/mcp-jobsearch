import { test, expect } from '@jest/globals';
import fs from 'fs/promises';
import { saveMatches } from '../src/save.js';

// use UTC to avoid timezone differences
process.env.TIMEZONE = 'UTC';

const sample = [{ title: 'Dev', link: 'http://ex', posted: '2025-07-05' }];

async function cleanup(path) {
  try { await fs.unlink(path); } catch {}
}

test('saveMatches writes JSON file and returns path', async () => {
  const path = await saveMatches(sample);
  const data = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(data).toEqual(sample);
  await cleanup(path);
});
