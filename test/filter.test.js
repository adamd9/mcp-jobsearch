import { test, expect } from '@jest/globals';
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
  expect(result).toEqual([{ title: 'Hit' }]);
});
