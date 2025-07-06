import { jest, describe, beforeEach, test, expect } from '@jest/globals';

// Prepare mocks for external modules before importing the code under test
const mockPage = {
  goto: jest.fn().mockResolvedValue(),
  waitForSelector: jest.fn().mockResolvedValue(),
  $: jest.fn().mockResolvedValue({ innerText: jest.fn().mockResolvedValue('Mock text content') }),
  $$: jest.fn(),
  type: jest.fn(),
  screenshot: jest.fn(),
  route: jest.fn(),
  on: jest.fn(),
  waitForTimeout: jest.fn()
};
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn()
};

jest.unstable_mockModule('playwright', () => ({
  chromium: { launch: jest.fn().mockResolvedValue(mockBrowser) }
}));


const markJobAsScanned = jest.fn();
jest.unstable_mockModule('../src/storage.js', () => ({ markJobAsScanned }));

const fsMocks = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
};
jest.unstable_mockModule('fs/promises', () => ({ default: fsMocks, ...fsMocks }));

// Dynamically import the module under test after mocks are set up
const { deepScanJob, deepScanJobs } = await import('../src/deep-scan.js');
const fs = await import('fs/promises');

describe('Deep Scan Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deepScanJob should extract job details and match against profile', async () => {
    const jobUrl = 'https://linkedin.com/jobs/view/123456';
    const jobId = '123456';
    const profile = 'profile text';

  const result = await deepScanJob(jobUrl, jobId, profile);

  expect(result).toBeDefined();
  expect(typeof result.matchScore).toBe('number');
  expect(result.matchScore).toBeGreaterThanOrEqual(0);
  expect(result.matchScore).toBeLessThanOrEqual(1);
  expect(markJobAsScanned).toHaveBeenCalledWith(jobId, expect.anything());
  });

  test('deepScanJobs should process multiple jobs concurrently', async () => {
    const jobs = [
      { id: '123456', link: 'https://linkedin.com/jobs/view/123456' },
      { id: '789012', link: 'https://linkedin.com/jobs/view/789012' }
    ];
    const profile = 'profile text';

    const results = await deepScanJobs(jobs, profile, 2);

    expect(results.length).toBe(2);
    expect(markJobAsScanned).toHaveBeenCalledTimes(2);
  });

  test('deepScanJob should handle errors gracefully', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation failed'));

    const jobUrl = 'https://linkedin.com/jobs/view/123456';
    const jobId = '123456';

    const result = await deepScanJob(jobUrl, jobId, 'profile text');

    expect(result.error).toBeDefined();
    expect(markJobAsScanned).toHaveBeenCalledWith(jobId, expect.objectContaining({
      scanned: true,
      error: expect.any(String)
    }));
  });
});
