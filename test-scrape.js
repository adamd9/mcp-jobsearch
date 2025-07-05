import dotenv from 'dotenv';
import { scrapeLinkedIn } from './src/scrape.js';

// Load environment variables
dotenv.config();

async function testScrape() {
  try {
    console.log('Starting LinkedIn scrape with enhanced debugging...');
    
    // Set options for the scrape
    const options = {
      keepOpen: true,  // Keep the browser open until manually closed
      debug: false     // Disable detailed debugging
    };
    
    // Run the scrape with options
    const result = await scrapeLinkedIn(process.env.LINKEDIN_SEARCH_URL, options);
    
    // If keepOpen is true, result will contain jobs, browser, and page objects
    if (result.jobs) {
      console.log('\nScrape completed with browser kept open.');
      console.log('You can now manually inspect the LinkedIn page.');
      console.log('Press Ctrl+C when finished to close the browser and exit.');
    } else {
      // If keepOpen is false, result will just be the jobs array
      console.log(`Found ${result.length} jobs:`);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error during scrape:', error);
  }
}

testScrape();
