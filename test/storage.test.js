import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import {
  getJobIndex,
  saveJobIndex,
  updateJobIndex,
  markJobAsScanned,
  getJobsToScan,
  hasProfileChanged,
  generateJobId,
  generateProfileHash,
  getMatchedJobs
} from '../src/storage.js';

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

describe('Job Index Storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getJobIndex should return empty index if file does not exist', async () => {
    // Mock fs.readFile to throw ENOENT error
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    
    // Call the function
    const result = await getJobIndex();
    
    // Assertions
    expect(result).toBeDefined();
    expect(result.jobs).toEqual([]);
    expect(result.lastScanDate).toBeNull();
    expect(result.profileHash).toBeNull();
  });

  test('getJobIndex should return parsed index if file exists', async () => {
    // Mock job index data
    const mockJobIndex = {
      jobs: [
        { id: '123456', title: 'Test Job 1' },
        { id: '789012', title: 'Test Job 2' }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock fs.readFile to return mock data
    fs.readFile.mockResolvedValue(JSON.stringify(mockJobIndex));
    
    // Call the function
    const result = await getJobIndex();
    
    // Assertions
    expect(result).toEqual(mockJobIndex);
    expect(result.jobs.length).toBe(2);
  });

  test('saveJobIndex should write index to file', async () => {
    // Mock job index data
    const mockJobIndex = {
      jobs: [{ id: '123456', title: 'Test Job' }],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Call the function
    await saveJobIndex(mockJobIndex);
    
    // Assertions
    expect(fs.mkdir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(mockJobIndex, null, 2),
      'utf8'
    );
  });

  test('updateJobIndex should add new jobs to index', async () => {
    // Mock existing job index
    const mockExistingIndex = {
      jobs: [{ id: '123456', title: 'Existing Job', scanned: true }],
      lastScanDate: '2025-07-04T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock new jobs
    const newJobs = [
      { id: '789012', title: 'New Job 1', link: 'https://linkedin.com/jobs/view/789012' },
      { id: '345678', title: 'New Job 2', link: 'https://linkedin.com/jobs/view/345678' }
    ];
    
    // Mock getJobIndex to return existing index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockExistingIndex);
    
    // Mock saveJobIndex
    jest.spyOn(global, 'saveJobIndex').mockResolvedValue();
    
    // Call the function
    const result = await updateJobIndex(newJobs);
    
    // Assertions
    expect(result.jobs.length).toBe(3); // 1 existing + 2 new
    expect(result.jobs.find(job => job.id === '123456')).toBeDefined();
    expect(result.jobs.find(job => job.id === '789012')).toBeDefined();
    expect(result.jobs.find(job => job.id === '345678')).toBeDefined();
  });

  test('markJobAsScanned should update job scan status', async () => {
    // Mock existing job index
    const mockExistingIndex = {
      jobs: [
        { id: '123456', title: 'Test Job', scanned: false },
        { id: '789012', title: 'Another Job', scanned: false }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock scan results
    const scanResults = {
      matchScore: 0.85,
      matchReason: 'Good match',
      description: 'Job description'
    };
    
    // Mock getJobIndex to return existing index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockExistingIndex);
    
    // Mock saveJobIndex
    jest.spyOn(global, 'saveJobIndex').mockResolvedValue();
    
    // Call the function
    await markJobAsScanned('123456', scanResults);
    
    // Assertions
    expect(global.saveJobIndex).toHaveBeenCalledWith(expect.objectContaining({
      jobs: expect.arrayContaining([
        expect.objectContaining({
          id: '123456',
          scanned: true,
          matchScore: 0.85,
          matchReason: 'Good match',
          description: 'Job description'
        })
      ])
    }));
  });

  test('getJobsToScan should return unscanned jobs', async () => {
    // Mock job index
    const mockJobIndex = {
      jobs: [
        { id: '123456', title: 'Job 1', scanned: true },
        { id: '789012', title: 'Job 2', scanned: false },
        { id: '345678', title: 'Job 3', scanned: false }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock getJobIndex to return mock index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockJobIndex);
    
    // Call the function
    const result = await getJobsToScan(false);
    
    // Assertions
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('789012');
    expect(result[1].id).toBe('345678');
  });

  test('getJobsToScan should return all jobs when force rescan is true', async () => {
    // Mock job index
    const mockJobIndex = {
      jobs: [
        { id: '123456', title: 'Job 1', scanned: true },
        { id: '789012', title: 'Job 2', scanned: false }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock getJobIndex to return mock index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockJobIndex);
    
    // Call the function with forceRescan = true
    const result = await getJobsToScan(true);
    
    // Assertions
    expect(result.length).toBe(2);
  });

  test('hasProfileChanged should detect profile changes', async () => {
    // Mock job index with existing profile hash
    const mockJobIndex = {
      jobs: [],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock getJobIndex to return mock index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockJobIndex);
    
    // Mock saveJobIndex
    jest.spyOn(global, 'saveJobIndex').mockResolvedValue();
    
    // Mock generateProfileHash to return a different hash
    jest.spyOn(global, 'generateProfileHash').mockReturnValue('def456');
    
    // Call the function with a new profile
    const result = await hasProfileChanged('New profile content');
    
    // Assertions
    expect(result).toBe(true);
    expect(global.saveJobIndex).toHaveBeenCalledWith(expect.objectContaining({
      profileHash: 'def456'
    }));
  });

  test('getMatchedJobs should return jobs with minimum match score', async () => {
    // Mock job index
    const mockJobIndex = {
      jobs: [
        { id: '123456', title: 'Job 1', scanned: true, matchScore: 0.9 },
        { id: '789012', title: 'Job 2', scanned: true, matchScore: 0.6 },
        { id: '345678', title: 'Job 3', scanned: true, matchScore: 0.8 }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };
    
    // Mock getJobIndex to return mock index
    jest.spyOn(global, 'getJobIndex').mockResolvedValue(mockJobIndex);
    
    // Call the function with minScore = 0.7
    const result = await getMatchedJobs(0.7);
    
    // Assertions
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('123456');
    expect(result[1].id).toBe('345678');
  });
});
