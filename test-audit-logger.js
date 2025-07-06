import { createAuditLogger } from './src/audit-logger.js';
import { loadConfig } from './src/config.js';

async function testAuditLogger() {
  console.log('Testing audit logger...');
  
  // Load configuration
  const config = await loadConfig();
  console.log('Configuration loaded:', {
    auditLogging: config.auditLogging,
    auditLogPath: config.auditLogPath,
    captureSearchResults: config.captureSearchResults,
    captureJobDetails: config.captureJobDetails,
    captureScreenshots: config.captureScreenshots
  });
  
  // Initialize audit logger
  const auditLogger = await createAuditLogger(config);
  console.log('Audit logger initialized');
  
  // Test logging search results
  await auditLogger.logSearchResults('test-search', [
    { id: 'test-job-1', title: 'Test Job 1', company: 'Test Company', link: 'https://example.com/job/1' },
    { id: 'test-job-2', title: 'Test Job 2', company: 'Test Company', link: 'https://example.com/job/2' }
  ]);
  console.log('Logged search results');
  
  // Test logging job details
  await auditLogger.logJobDetails('test-job-1', {
    title: 'Test Job 1',
    company: 'Test Company',
    description: 'This is a test job description',
    requirements: 'Test requirements',
    location: 'Test Location',
    salary: '$100k - $150k'
  });
  console.log('Logged job details');
  
  // Test logging screenshot
  const screenshotData = Buffer.from('Test screenshot data');
  await auditLogger.logScreenshot('test-screenshot', screenshotData);
  console.log('Logged screenshot');
  
  // Generate mock data
  const mockDataResult = await auditLogger.generateMockData();
  console.log('Mock data generation result:', mockDataResult);
  
  console.log('Audit logger test completed');
}

testAuditLogger().catch(error => {
  console.error('Error testing audit logger:', error);
});
