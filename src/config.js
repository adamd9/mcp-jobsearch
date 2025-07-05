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
    
    // Required environment variables (no defaults)
    linkedinSearchUrl: process.env.LINKEDIN_SEARCH_URL,
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
