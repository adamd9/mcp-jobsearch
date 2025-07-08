import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync } from 'fs';

// Default path for job index
const DEFAULT_JOB_INDEX_PATH = path.join(process.cwd(), 'data', 'job-index.json');

// Lock file path
const LOCK_FILE_PATH = path.join(process.env.DATA_DIR || './data', '.index.lock');

// Track active operations in memory
let activeOperation = false;

/**
 * Ensure the data directory exists
 */
export async function ensureDataDir() {
  const dataDir = path.dirname(process.env.JOB_INDEX_PATH || DEFAULT_JOB_INDEX_PATH);
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * Check if an operation is in progress
 * @returns {boolean} - Whether an operation is in progress
 */
export function isOperationInProgress() {
  // Check in-memory flag
  if (activeOperation) {
    return true;
  }
  
  // Also check for lock file (in case of multiple processes)
  return existsSync(LOCK_FILE_PATH);
}

/**
 * Try to acquire lock for file operations
 * @returns {Promise<boolean>} - Whether the lock was acquired
 */
async function tryAcquireLock() {
  // If operation is already in progress in this process, fail immediately
  if (activeOperation) {
    return false;
  }
  
  try {
    // Try to create the lock file - non-blocking, fails immediately if file exists
    await fs.writeFile(LOCK_FILE_PATH, String(process.pid), { flag: 'wx' });
    activeOperation = true;
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') {
      // Lock already exists, operation in progress
      return false;
    }
    throw error; // Unexpected error
  }
}

/**
 * Release the lock
 * @returns {Promise<void>}
 */
async function releaseLock() {
  activeOperation = false;
  try {
    await fs.unlink(LOCK_FILE_PATH);
  } catch (error) {
    // Ignore errors from unlink
  }
}

/**
 * Generate a unique ID for a job based on its URL
 * @param {string} url - The job URL
 * @returns {string} - A unique ID
 */
export function generateJobId(url) {
  // Extract the job ID from LinkedIn URL or hash the URL if not possible
  const match = url.match(/\/view\/([^/]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Generate a hash of the profile text
 * @param {string} profileText - The profile text
 * @returns {string} - A hash of the profile
 */
export function generateProfileHash(profileText) {
  return crypto.createHash('md5').update(profileText).digest('hex');
}

/**
 * Get the current job index
 * @returns {Promise<Object>} - The job index
 */
export async function getJobIndex() {
  await ensureDataDir();
  const indexPath = process.env.JOB_INDEX_PATH || DEFAULT_JOB_INDEX_PATH;
  
  try {
    const data = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Return empty index if file doesn't exist
      return { 
        jobs: [],
        lastScanDate: null,
        profileHash: null
      };
    }
    throw error;
  }
}

/**
 * Save the job index
 * @param {Object} jobIndex - The job index to save
 * @returns {Promise<void>}
 */
export async function saveJobIndex(jobIndex) {
  await ensureDataDir();
  const indexPath = process.env.JOB_INDEX_PATH || DEFAULT_JOB_INDEX_PATH;
  const tempPath = `${indexPath}.tmp`;
  
  // Try to acquire lock - non-blocking
  const lockAcquired = await tryAcquireLock();
  if (!lockAcquired) {
    throw new Error('Operation in progress: Another process is currently writing to the job index. Please try again later.');
  }
  
  try {
    // Write to temporary file first
    await fs.writeFile(tempPath, JSON.stringify(jobIndex, null, 2), 'utf8');
    
    // Atomically rename the temporary file to the target file
    await fs.rename(tempPath, indexPath);
  } catch (error) {
    // Clean up temporary file if there was an error
    try {
      if (existsSync(tempPath)) {
        await fs.unlink(tempPath);
      }
    } catch (unlinkError) {
      // Ignore errors from unlink
    }
    throw error;
  } finally {
    // Always release the lock
    await releaseLock();
  }
}

/**
 * Add or update jobs in the index
 * @param {Array} newJobs - Array of new jobs to add/update
 * @param {boolean} forceRescan - Whether to force rescan of existing jobs
 * @returns {Promise<Object>} - Updated job index
 */
export async function updateJobIndex(newJobs, forceRescan = false) {
  const jobIndex = await getJobIndex();
  const jobsMap = new Map();
  
  // Create a map of existing jobs by ID
  jobIndex.jobs.forEach(job => {
    jobsMap.set(job.id, job);
  });
  
  // Update or add new jobs
  newJobs.forEach(newJob => {
    const jobId = generateJobId(newJob.link);
    
    if (jobsMap.has(jobId)) {
      // Update existing job
      const existingJob = jobsMap.get(jobId);
      
      // Only update fields that are present in newJob
      Object.keys(newJob).forEach(key => {
        existingJob[key] = newJob[key];
      });
      
      // Reset scanned status if force rescan is enabled
      if (forceRescan) {
        existingJob.scanned = false;
        existingJob.scanDate = null;
      }
    } else {
      // Add new job
      jobsMap.set(jobId, {
        id: jobId,
        ...newJob,
        scanned: false,
        scanDate: null,
        matchScore: null,
        matchReason: null,
        description: null,
        requirements: [],
        isNew: true // Mark as new for digest emails
      });
    }
  });
  
  // Update the job index
  jobIndex.jobs = Array.from(jobsMap.values());
  jobIndex.lastScanDate = new Date().toISOString();
  
  // Save the updated index
  await saveJobIndex(jobIndex);
  
  return jobIndex;
}

/**
 * Mark a job as scanned
 * @param {string} jobId - The job ID
 * @param {Object} scanResults - The scan results
 * @returns {Promise<Object>} - Updated job index
 */
export async function markJobAsScanned(jobId, scanResults) {
  const jobIndex = await getJobIndex();
  
  const job = jobIndex.jobs.find(job => job.id === jobId);
  if (job) {
    job.scanned = true;
    job.scanDate = new Date().toISOString();
    
    // Update job with scan results
    Object.keys(scanResults).forEach(key => {
      job[key] = scanResults[key];
    });
    
    // If job wasn't previously scanned, mark it as new for digest emails
    if (!job.isNew && job.isNew !== false) {
      job.isNew = true;
    }
    
    // Save the updated index
    await saveJobIndex(jobIndex);
  }
  
  return jobIndex;
}

/**
 * Get jobs that need to be scanned
 * @param {boolean} forceRescan - Whether to force rescan of all jobs
 * @returns {Promise<Array>} - Array of jobs that need scanning
 */
export async function getJobsToScan(forceRescan = false) {
  const jobIndex = await getJobIndex();
  
  if (forceRescan) {
    return jobIndex.jobs;
  }
  
  return jobIndex.jobs.filter(job => !job.scanned);
}

/**
 * Check if profile has changed
 * @param {string} profileText - The current profile text
 * @returns {Promise<boolean>} - Whether the profile has changed
 */
export async function hasProfileChanged(profileText) {
  const jobIndex = await getJobIndex();
  const currentHash = generateProfileHash(profileText);
  
  if (!jobIndex.profileHash) {
    // First time running with a profile
    jobIndex.profileHash = currentHash;
    await saveJobIndex(jobIndex);
    return false;
  }
  
  if (jobIndex.profileHash !== currentHash) {
    // Profile has changed, update the hash
    jobIndex.profileHash = currentHash;
    await saveJobIndex(jobIndex);
    return true;
  }
  
  return false;
}

/**
 * Get matched jobs from the index
 * @param {number} minScore - Minimum match score (0-1)
 * @returns {Promise<Array>} - Array of matched jobs
 */
/**
 * Get matched jobs based on match score
 * @param {number} minScore - Minimum match score (0-1)
 * @param {boolean} onlyNew - Whether to only return jobs marked as new
 * @returns {Promise<Array>} - Array of matched jobs
 */
export async function getMatchedJobs(minScore = 0.7, onlyNew = false) {
  const jobIndex = await getJobIndex();
  return jobIndex.jobs.filter(job => 
    job.scanned && 
    job.matchScore !== null && 
    job.matchScore >= minScore &&
    (!onlyNew || job.isNew !== false) // Include if onlyNew is false OR job.isNew is not false
  );
}

/**
 * Mark jobs as no longer new after sending in digest
 * @param {Array} jobIds - Array of job IDs to mark as not new
 * @returns {Promise<Object>} - Updated job index
 */
export async function markJobsAsSent(jobIds) {
  const jobIndex = await getJobIndex();
  
  // Mark each job as not new
  jobIds.forEach(jobId => {
    const job = jobIndex.jobs.find(job => job.id === jobId);
    if (job) {
      job.isNew = false;
      job.sentInDigest = new Date().toISOString();
    }
  });
  
  // Save the updated index
  await saveJobIndex(jobIndex);
  
  return jobIndex;
}
