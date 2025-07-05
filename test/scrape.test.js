import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { scrapeLinkedIn } from '../src/scrape.js';
import { updateJobIndex, getJobIndex } from '../src/storage.js';
import { deepScanJobs } from '../src/deep-scan.js';

// Mock Playwright
jest.mock('playwright', () => {
  return {
    chromium: {
      launch: jest.fn().mockImplementation(() => {
        return {
          newPage: jest.fn().mockImplementation(() => {
            return {
              goto: jest.fn(),
              waitForSelector: jest.fn(),
              $: jest.fn(),
              $$: jest.fn(),
              $$eval: jest.fn(),
              screenshot: jest.fn(),
              route: jest.fn(),
              on: jest.fn(),
              waitForTimeout: jest.fn()
            };
          }),
          close: jest.fn()
        };
      })
    }
  };
});

// Mock fs
jest.mock('fs/promises', () => {
  const originalModule = jest.requireActual('fs/promises');
  return {
    ...originalModule,
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn()
  };
});

// Mock storage
jest.mock('../src/storage.js', () => {
  return {
    updateJobIndex: jest.fn(),
    getJobIndex: jest.fn(),
    generateJobId: jest.fn().mockImplementation((url) => {
      const match = url.match(/\/view\/([^/]+)/);
      return match ? match[1] : 'mock-id';
    }),
    getJobsToScan: jest.fn(),
    hasProfileChanged: jest.fn()
  };
});

// Mock deep-scan
jest.mock('../src/deep-scan.js', () => {
  return {
    deepScanJobs: jest.fn()
  };
});

describe('LinkedIn Job Scraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('scrapeLinkedIn should process job listings', async () => {
    // Load test fixtures
    const searchResults = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'test/fixtures/linkedin-search-results.json'), 'utf8')
    );
    
    // Mock Playwright's $$eval to return our test data
    const mockPage = require('playwright').chromium.launch().then(browser => browser.newPage());
    mockPage.then(page => {
      page.$$eval = jest.fn().mockResolvedValue(searchResults);
      page.$$ = jest.fn().mockResolvedValue([{}, {}, {}]); // Mock finding elements
    });
    
    // Mock storage functions
    updateJobIndex.mockResolvedValue({ jobs: searchResults });
    
    // Call the function
    const result = await scrapeLinkedIn('https://linkedin.com/jobs/search', { deepScan: false });
    
    // Assertions
    expect(result.jobs).toBeDefined();
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(updateJobIndex).toHaveBeenCalled();
  });

  test('scrapeLinkedIn should perform deep scanning when enabled', async () => {
    // Load test fixtures
    const searchResults = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'test/fixtures/linkedin-search-results.json'), 'utf8')
    );
    
    const jobDetails = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'test/fixtures/linkedin-job-details.json'), 'utf8')
    );
    
    // Mock Playwright's $$eval to return our test data
    const mockPage = require('playwright').chromium.launch().then(browser => browser.newPage());
    mockPage.then(page => {
      page.$$eval = jest.fn().mockResolvedValue(searchResults);
      page.$$ = jest.fn().mockResolvedValue([{}, {}, {}]); // Mock finding elements
    });
    
    // Mock storage functions
    updateJobIndex.mockResolvedValue({ jobs: searchResults });
    getJobsToScan.mockResolvedValue(searchResults);
    hasProfileChanged.mockResolvedValue(false);
    
    // Mock fs.readFile for profile.txt
    fs.readFile.mockImplementation((filePath, encoding) => {
      if (filePath.includes('profile.txt')) {
        return Promise.resolve('I am a full stack developer with 2 years of experience in JavaScript, React, and Node.js.');
      }
      return Promise.resolve('');
    });
    
    // Mock deepScanJobs
    deepScanJobs.mockResolvedValue(jobDetails);
    
    // Call the function
    const result = await scrapeLinkedIn('https://linkedin.com/jobs/search', { deepScan: true });
    
    // Assertions
    expect(result.jobs).toBeDefined();
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(updateJobIndex).toHaveBeenCalled();
    expect(getJobsToScan).toHaveBeenCalled();
    expect(deepScanJobs).toHaveBeenCalled();
  });

  test('scrapeLinkedIn should handle errors gracefully', async () => {
    // Mock Playwright to throw an error
    const mockPage = require('playwright').chromium.launch().then(browser => browser.newPage());
    mockPage.then(page => {
      page.goto = jest.fn().mockRejectedValue(new Error('Navigation failed'));
    });
    
    // Call the function and expect it not to throw
    await expect(scrapeLinkedIn('https://linkedin.com/jobs/search')).resolves.not.toThrow();
  });
});
