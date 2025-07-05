import { test } from 'node:test';
import assert from 'node:assert';
import { filterJobs } from '../src/filter.js';

const mockAI = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: JSON.stringify([{ title: 'Hit' }]) } }]
      })
    }
  }
};

test('filterJobs returns parsed matches from AI response', async () => {
  const result = await filterJobs([], 'profile text', mockAI);
  assert.deepStrictEqual(result, [{ title: 'Hit' }]);
});
