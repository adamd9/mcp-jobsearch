import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { deepScanJob, deepScanJobs } from '../src/deep-scan.js';
import { markJobAsScanned } from '../src/storage.js';

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
              $: jest.fn().mockImplementation(() => {
                return {
                  innerText: jest.fn().mockResolvedValue('Mock text content')
                };
              }),
              $$: jest.fn(),
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

// Mock OpenAI
jest.mock('openai', () => {
  return {
    Configuration: jest.fn(),
    OpenAIApi: jest.fn().mockImplementation(() => {
      return {
        createChatCompletion: jest.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: {
                  content: '{"matchScore": 0.85, "matchReason": "This job is a good match for the candidate\'s profile."}'
                }
              }
            ]
          }
        })
      };
    })
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
    markJobAsScanned: jest.fn()
  };
});

describe('Deep Scan Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deepScanJob should extract job details and match against profile', async () => {
    // Mock job URL and ID
    const jobUrl = 'https://linkedin.com/jobs/view/123456';
    const jobId = '123456';
    const profile = 'I am a full stack developer with 2 years of experience in JavaScript, React, and Node.js.';
    
    // Call the function
    const result = await deepScanJob(jobUrl, jobId, profile);
    
    // Assertions
    expect(result).toBeDefined();
    expect(result.matchScore).toBeCloseTo(0.85);
    expect(result.matchReason).toBeDefined();
    expect(markJobAsScanned).toHaveBeenCalledWith(jobId, expect.anything());
  });

  test('deepScanJobs should process multiple jobs concurrently', async () => {
    // Mock jobs array
    const jobs = [
      { id: '123456', link: 'https://linkedin.com/jobs/view/123456' },
      { id: '789012', link: 'https://linkedin.com/jobs/view/789012' }
    ];
    
    const profile = 'I am a full stack developer with 2 years of experience in JavaScript, React, and Node.js.';
    
    // Call the function
    const results = await deepScanJobs(jobs, profile, 2);
    
    // Assertions
    expect(results).toBeDefined();
    expect(results.length).toBe(2);
    expect(markJobAsScanned).toHaveBeenCalledTimes(2);
  });

  test('deepScanJob should handle errors gracefully', async () => {
    // Mock Playwright to throw an error
    const mockBrowser = require('playwright').chromium.launch();
    mockBrowser.then(browser => {
      const mockPage = browser.newPage();
      mockPage.then(page => {
        page.goto = jest.fn().mockRejectedValue(new Error('Navigation failed'));
      });
    });
    
    // Mock job URL and ID
    const jobUrl = 'https://linkedin.com/jobs/view/123456';
    const jobId = '123456';
    const profile = 'I am a full stack developer with 2 years of experience in JavaScript, React, and Node.js.';
    
    // Call the function
    const result = await deepScanJob(jobUrl, jobId, profile);
    
    // Assertions
    expect(result).toBeDefined();
    expect(result.error).toBeDefined();
    expect(markJobAsScanned).toHaveBeenCalledWith(jobId, expect.objectContaining({
      scanned: true,
      error: expect.any(String)
    }));
  });
});
