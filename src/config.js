import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Default configuration
const defaultConfig = {
  mockMode: false,
  openaiModel: 'gpt-4o',
  deepScanConcurrency: 2,
  timezone: 'Australia/Sydney',
  jobIndexPath: path.join(process.cwd(), 'data', 'job-index.json'),
  // Audit logging configuration
  auditLogging: true,
  auditLogPath: path.join(process.cwd(), 'data', 'audit-logs'),
  captureSearchResults: true,
  captureJobDetails: true,
  captureScreenshots: true,
};

/**
 * Load configuration from config file and environment variables
 * Environment variables take precedence over config file
 * @returns {Promise<Object>} - Configuration object
 */
export async function loadConfig() {
  let fileConfig = {};
  
  // Try to load config from file
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const fileExists = await fs.access(configPath).then(() => true).catch(() => false);
    
    if (fileExists) {
      const configContent = await fs.readFile(configPath, 'utf8');
      fileConfig = JSON.parse(configContent);
      console.log('Loaded configuration from config.json');
    }
  } catch (error) {
    console.warn(`Warning: Could not load config file: ${error.message}`);
  }
  
  // Merge default config with file config and environment variables
  const config = {
    ...defaultConfig,
    ...fileConfig,
    
    // Environment variables take precedence
    mockMode: process.env.MOCK_DATA === 'true' ? true : 
              process.env.MOCK_DATA === 'false' ? false : 
              fileConfig.mockMode !== undefined ? fileConfig.mockMode : 
              defaultConfig.mockMode,
    
    openaiModel: process.env.OPENAI_MODEL || fileConfig.openaiModel || defaultConfig.openaiModel,
    deepScanConcurrency: parseInt(process.env.DEEP_SCAN_CONCURRENCY) || fileConfig.deepScanConcurrency || defaultConfig.deepScanConcurrency,
    timezone: process.env.TIMEZONE || fileConfig.timezone || defaultConfig.timezone,
    jobIndexPath: process.env.JOB_INDEX_PATH || fileConfig.jobIndexPath || defaultConfig.jobIndexPath,
    
    // Audit logging configuration
    auditLogging: process.env.AUDIT_LOGGING === 'true' ? true :
                 process.env.AUDIT_LOGGING === 'false' ? false :
                 fileConfig.auditLogging !== undefined ? fileConfig.auditLogging :
                 defaultConfig.auditLogging,
    auditLogPath: process.env.AUDIT_LOG_PATH || fileConfig.auditLogPath || defaultConfig.auditLogPath,
    captureSearchResults: process.env.CAPTURE_SEARCH_RESULTS === 'true' ? true :
                         process.env.CAPTURE_SEARCH_RESULTS === 'false' ? false :
                         fileConfig.captureSearchResults !== undefined ? fileConfig.captureSearchResults :
                         defaultConfig.captureSearchResults,
    captureJobDetails: process.env.CAPTURE_JOB_DETAILS === 'true' ? true :
                      process.env.CAPTURE_JOB_DETAILS === 'false' ? false :
                      fileConfig.captureJobDetails !== undefined ? fileConfig.captureJobDetails :
                      defaultConfig.captureJobDetails,
    captureScreenshots: process.env.CAPTURE_SCREENSHOTS === 'true' ? true :
                       process.env.CAPTURE_SCREENSHOTS === 'false' ? false :
                       fileConfig.captureScreenshots !== undefined ? fileConfig.captureScreenshots :
                       defaultConfig.captureScreenshots,

    // Required environment variables (no defaults)
    digestTo: process.env.DIGEST_TO,
  };
  
  return config;
}

/**
 * Save configuration to config file
 * @param {Object} config - Configuration object to save
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved to config.json');
  } catch (error) {
    console.error(`Error saving config file: ${error.message}`);
    throw error;
  }
}
