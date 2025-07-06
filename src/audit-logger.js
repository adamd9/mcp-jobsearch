import fs from 'fs/promises';
import path from 'path';

/**
 * Audit logger for capturing data during scraping and deep scanning
 * Used to generate better mock data for testing
 */
export class AuditLogger {
  /**
   * Create a new audit logger
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.enabled = config.auditLogging;
    this.basePath = config.auditLogPath;
    this.captureSearchResults = config.captureSearchResults;
    this.captureJobDetails = config.captureJobDetails;
    this.captureScreenshots = config.captureScreenshots;
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
  }

  /**
   * Initialize audit logging directories
   */
  async init() {
    if (!this.enabled) return;
    
    try {
      // Create base audit log directory
      await fs.mkdir(this.basePath, { recursive: true });
      
      // Create session directory
      this.sessionPath = path.join(this.basePath, this.sessionId);
      await fs.mkdir(this.sessionPath, { recursive: true });
      
      // Create subdirectories
      if (this.captureSearchResults) {
        await fs.mkdir(path.join(this.sessionPath, 'search-results'), { recursive: true });
      }
      
      if (this.captureJobDetails) {
        await fs.mkdir(path.join(this.sessionPath, 'job-details'), { recursive: true });
      }
      
      if (this.captureScreenshots) {
        await fs.mkdir(path.join(this.sessionPath, 'screenshots'), { recursive: true });
      }
      
      console.log(`Audit logging initialized in ${this.sessionPath}`);
    } catch (error) {
      console.error(`Error initializing audit logging: ${error.message}`);
      this.enabled = false;
    }
  }

  /**
   * Log search results
   * @param {string} searchTerm - Search term used
   * @param {Array} jobs - Job listings found
   */
  async logSearchResults(searchTerm, jobs) {
    if (!this.enabled || !this.captureSearchResults) return;
    
    try {
      const filename = `search-${searchTerm.replace(/\s+/g, '-')}.json`;
      const filePath = path.join(this.sessionPath, 'search-results', filename);
      
      const data = {
        searchTerm,
        timestamp: new Date().toISOString(),
        jobCount: jobs.length,
        jobs
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Search results logged to ${filePath}`);
    } catch (error) {
      console.error(`Error logging search results: ${error.message}`);
    }
  }

  /**
   * Log job details
   * @param {string} jobId - Job ID
   * @param {Object} jobDetails - Job details
   */
  async logJobDetails(jobId, jobDetails) {
    if (!this.enabled || !this.captureJobDetails) return;
    
    try {
      const filePath = path.join(this.sessionPath, 'job-details', `${jobId}.json`);
      
      const data = {
        jobId,
        timestamp: new Date().toISOString(),
        ...jobDetails
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Job details logged to ${filePath}`);
    } catch (error) {
      console.error(`Error logging job details: ${error.message}`);
    }
  }

  /**
   * Log screenshot
   * @param {string} name - Screenshot name
   * @param {Buffer} screenshotBuffer - Screenshot data
   */
  async logScreenshot(name, screenshotBuffer) {
    if (!this.enabled || !this.captureScreenshots) return;
    
    try {
      const filePath = path.join(this.sessionPath, 'screenshots', `${name}.png`);
      await fs.writeFile(filePath, screenshotBuffer);
      console.log(`Screenshot logged to ${filePath}`);
    } catch (error) {
      console.error(`Error logging screenshot: ${error.message}`);
    }
  }

  /**
   * Generate mock data files from collected audit logs
   */
  async generateMockData() {
    if (!this.enabled) return;
    
    try {
      // Create mock data directory
      const mockDataPath = path.join(process.cwd(), 'test', 'fixtures');
      await fs.mkdir(mockDataPath, { recursive: true });
      
      // Generate mock search results
      if (this.captureSearchResults) {
        const searchResultsDir = path.join(this.sessionPath, 'search-results');
        const searchFiles = await fs.readdir(searchResultsDir);
        
        if (searchFiles.length > 0) {
          // Combine all search results
          let allJobs = [];
          
          for (const file of searchFiles) {
            const filePath = path.join(searchResultsDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);
            allJobs = [...allJobs, ...data.jobs];
          }
          
          // Remove duplicates by job ID
          const uniqueJobs = [];
          const jobIds = new Set();
          
          for (const job of allJobs) {
            if (job.id && !jobIds.has(job.id)) {
              jobIds.add(job.id);
              uniqueJobs.push(job);
            }
          }
          
          // Write combined search results to mock file
          const mockSearchResultsPath = path.join(mockDataPath, 'linkedin-search-results.json');
          await fs.writeFile(mockSearchResultsPath, JSON.stringify(uniqueJobs, null, 2), 'utf8');
          console.log(`Generated mock search results at ${mockSearchResultsPath}`);
        }
      }
      
      // Generate mock job details
      if (this.captureJobDetails) {
        const jobDetailsDir = path.join(this.sessionPath, 'job-details');
        const jobFiles = await fs.readdir(jobDetailsDir);
        
        if (jobFiles.length > 0) {
          // Combine all job details
          const allJobDetails = [];
          
          for (const file of jobFiles) {
            const filePath = path.join(jobDetailsDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);
            allJobDetails.push(data);
          }
          
          // Write combined job details to mock file
          const mockJobDetailsPath = path.join(mockDataPath, 'linkedin-job-details.json');
          await fs.writeFile(mockJobDetailsPath, JSON.stringify(allJobDetails, null, 2), 'utf8');
          console.log(`Generated mock job details at ${mockJobDetailsPath}`);
        }
      }
      
      return {
        mockDataPath,
        searchResultsCount: this.captureSearchResults ? (await fs.readdir(path.join(this.sessionPath, 'search-results'))).length : 0,
        jobDetailsCount: this.captureJobDetails ? (await fs.readdir(path.join(this.sessionPath, 'job-details'))).length : 0,
        screenshotsCount: this.captureScreenshots ? (await fs.readdir(path.join(this.sessionPath, 'screenshots'))).length : 0
      };
    } catch (error) {
      console.error(`Error generating mock data: ${error.message}`);
      return { error: error.message };
    }
  }
}

/**
 * Create an audit logger instance
 * @param {Object} config - Configuration object
 * @returns {Promise<AuditLogger>} - Initialized audit logger
 */
export async function createAuditLogger(config) {
  const logger = new AuditLogger(config);
  await logger.init();
  return logger;
}
