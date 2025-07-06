import { jest, describe, beforeEach, test, expect } from '@jest/globals';

// mock browser behaviour
const mockPage = {
  goto: jest.fn().mockResolvedValue(),
  waitForSelector: jest.fn().mockResolvedValue(),
  type: jest.fn().mockResolvedValue(),
  $: jest.fn(),
  $$: jest.fn(),
  $$eval: jest.fn(),
  screenshot: jest.fn(),
  route: jest.fn(),
  on: jest.fn(),
  click: jest.fn().mockResolvedValue(),
  waitForNavigation: jest.fn().mockResolvedValue(),
  url: jest.fn().mockReturnValue('https://linkedin.com/feed'),
  waitForTimeout: jest.fn()
};
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn()
};

jest.unstable_mockModule('playwright', () => ({
  chromium: { launch: jest.fn().mockResolvedValue(mockBrowser) }
}));

const storage = {
  updateJobIndex: jest.fn(),
  getJobIndex: jest.fn(),
  generateJobId: jest.fn(url => url.match(/\/view\/([^/]+)/)?.[1] || 'mock-id'),
  getJobsToScan: jest.fn(),
  hasProfileChanged: jest.fn()
};

jest.unstable_mockModule('../src/storage.js', () => storage);

jest.unstable_mockModule('../src/deep-scan.js', () => ({ deepScanJobs: jest.fn() }));

const fsMocks = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
};
jest.unstable_mockModule('fs/promises', () => ({ default: fsMocks, ...fsMocks }));

const { scrapeLinkedIn } = await import('../src/scrape.js');
const fs = await import('fs/promises');
const { deepScanJobs } = await import('../src/deep-scan.js');
const { updateJobIndex, getJobsToScan, hasProfileChanged } = storage;

describe('LinkedIn Job Scraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('scrapeLinkedIn should process job listings', async () => {
    const searchResults = [{ title: 'Job', link: 'https://linkedin.com/jobs/view/1' }];
    mockPage.$$eval.mockResolvedValue(searchResults);
    mockPage.$$.mockResolvedValue([{}, {}, {}]);
    updateJobIndex.mockResolvedValue({ jobs: searchResults });

    const result = await scrapeLinkedIn('https://linkedin.com/jobs/search', { deepScan: false });

    expect(result.jobs.length).toBeGreaterThan(0);
    expect(updateJobIndex).toHaveBeenCalled();
  });

  test('scrapeLinkedIn should perform deep scanning when enabled', async () => {
    const searchResults = [{ title: 'Job', link: 'https://linkedin.com/jobs/view/1' }];
    mockPage.$$eval.mockResolvedValue(searchResults);
    mockPage.$$.mockResolvedValue([{}, {}, {}]);
    updateJobIndex.mockResolvedValue({ jobs: searchResults });
    getJobsToScan.mockResolvedValue(searchResults);
    hasProfileChanged.mockResolvedValue(false);
    fs.readFile.mockResolvedValue('profile text');
    deepScanJobs.mockResolvedValue([{ id: '1' }]);

    const result = await scrapeLinkedIn('https://linkedin.com/jobs/search', { deepScan: true });

    expect(result.jobs.length).toBeGreaterThan(0);
    expect(updateJobIndex).toHaveBeenCalled();
    expect(getJobsToScan).toHaveBeenCalled();
    expect(deepScanJobs).toHaveBeenCalled();
  });

  test('scrapeLinkedIn should handle errors gracefully', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation failed'));
    await expect(scrapeLinkedIn('https://linkedin.com/jobs/search')).rejects.toThrow('Navigation failed');
  });
});
