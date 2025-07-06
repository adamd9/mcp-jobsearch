import { jest } from '@jest/globals';
import fs from 'fs/promises';
import * as storage from '../src/storage.js';

describe('Job Index Storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getJobIndex should return empty index if file does not exist', async () => {
    // Mock fs.readFile to throw ENOENT error
    jest.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' });
    
    // Call the function
    const result = await storage.getJobIndex();
    
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
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));
    
    // Call the function
    const result = await storage.getJobIndex();
    
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
    jest.spyOn(fs, 'mkdir').mockResolvedValue();
    jest.spyOn(fs, 'writeFile').mockResolvedValue();
    await storage.saveJobIndex(mockJobIndex);
    
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
    
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockExistingIndex));
    jest.spyOn(fs, 'writeFile').mockResolvedValue();
    
    // Call the function
    const result = await storage.updateJobIndex(newJobs);
    
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
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockExistingIndex));
    jest.spyOn(fs, 'writeFile').mockResolvedValue();
    
    // Call the function
    await storage.markJobAsScanned('123456', scanResults);
    
    // Assertions
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'utf8');
    const writtenData = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(writtenData).toEqual(expect.objectContaining({
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
    
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));
    
    // Call the function
    const result = await storage.getJobsToScan(false);
    
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
    
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));
    
    // Call the function with forceRescan = true
    const result = await storage.getJobsToScan(true);
    
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
    
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));
    jest.spyOn(fs, 'writeFile').mockResolvedValue();
    
    // Call the function with a new profile
    const result = await storage.hasProfileChanged('New profile content');
    
    // Assertions
    expect(result).toBe(true);
    expect(fs.writeFile).toHaveBeenCalled();
    const saved = JSON.parse(fs.writeFile.mock.calls[0][1]);
    const expectedHash = storage.generateProfileHash('New profile content');
    expect(saved.profileHash).toBe(expectedHash);
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
    
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));
    
    // Call the function with minScore = 0.7
    const result = await storage.getMatchedJobs(0.7);
    
    // Assertions
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('123456');
    expect(result[1].id).toBe('345678');
  });

  test('getJobIndexStats returns summary information', async () => {
    const mockJobIndex = {
      jobs: [
        { id: '1', scanned: true, matchScore: 0.8 },
        { id: '2', scanned: false },
        { id: '3', scanned: true, matchScore: 0.5 }
      ],
      lastScanDate: '2025-07-05T12:00:00+10:00',
      profileHash: 'abc123'
    };

    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJobIndex));

    const stats = await storage.getJobIndexStats(0.7);

    expect(stats).toEqual({
      totalJobs: 3,
      scannedJobs: 2,
      unscannedJobs: 1,
      matchedJobs: 1,
      lastScanDate: '2025-07-05T12:00:00+10:00'
    });
  });
});
