import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Default path for job index
const DEFAULT_JOB_INDEX_PATH = path.join(process.cwd(), 'data', 'job-index.json');

/**
 * Ensure the data directory exists
 */
async function ensureDataDir() {
  const dataDir = path.dirname(process.env.JOB_INDEX_PATH || DEFAULT_JOB_INDEX_PATH);
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
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
  await fs.writeFile(indexPath, JSON.stringify(jobIndex, null, 2), 'utf8');
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
        requirements: []
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
    
    // Update with scan results
    if (scanResults) {
      Object.keys(scanResults).forEach(key => {
        job[key] = scanResults[key];
      });
    }
  }
  
  await saveJobIndex(jobIndex);
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
export async function getMatchedJobs(minScore = 0.7) {
  const jobIndex = await getJobIndex();
  return jobIndex.jobs.filter(job =>
    job.scanned &&
    job.matchScore !== null &&
    job.matchScore >= minScore
  );
}

/**
 * Get summary statistics about the job index
 * @param {number} minScore - Minimum score used to count matched jobs
 * @returns {Promise<Object>} - Stats object
 */
export async function getJobIndexStats(minScore = 0.7) {
  const jobIndex = await getJobIndex();
  const totalJobs = jobIndex.jobs.length;
  const scannedJobs = jobIndex.jobs.filter(j => j.scanned).length;
  const unscannedJobs = totalJobs - scannedJobs;
  const matchedJobs = jobIndex.jobs.filter(j =>
    j.scanned &&
    j.matchScore !== null &&
    j.matchScore >= minScore
  ).length;

  return {
    totalJobs,
    scannedJobs,
    unscannedJobs,
    matchedJobs,
    lastScanDate: jobIndex.lastScanDate
  };
}
