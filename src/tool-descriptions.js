// Tool descriptions and configurations for the MCP Job Search system
// Centralized location for easy review and editing of all tool descriptions

export const TOOL_DESCRIPTIONS = {
  // Status and monitoring tools
  STATUS: "Check the status of a background job, such as a scan.",
  
  // Job scanning tools
  SCAN: "Scans LinkedIn job pages for job opportunities. If a URL is provided, scans that specific page; otherwise scans all URLs from the current plan. The scan includes both initial job discovery and deep scanning phases for detailed job analysis.",
  
  RESCAN: "Rescans LinkedIn job pages using the URLs stored in the last scan job (if any) or current plan.",
  
  CANCEL_SCAN: "Cancel the currently running scan job if one is in progress.",
  
  DEEP_SCAN_JOB: "Manually deep scan a specific LinkedIn job URL for testing and debugging",
  
  // Plan management tools
  GET_PLAN: "Get the current job search plan",
  
  UPDATE_PLAN: "Create a new job search plan or update an existing one based on a description.",
  
  // Job management tools
  GET_JOBS: "Get all jobs found in previous scans, with optional filtering by match score",
  
  SEND_DIGEST: "Send a digest email with job matches to the configured email address",
  
  // Testing and debugging tools
  TEST_EMAIL: "Test email configuration by sending a test email",
  
  CLEAR_JOBS: "Clear all stored jobs from the database"
};

// Tool argument descriptions
export const TOOL_ARGS = {
  // Scan tool arguments
  SCAN_URL: "An optional LinkedIn job search results page URL to scan.",
  SCAN_SKIP_DIGEST: "Skip sending digest email after scan completion",
  
  // Deep scan arguments
  DEEP_SCAN_URL: "LinkedIn job URL to deep scan",
  
  // Plan arguments
  PLAN_DESCRIPTION: "Description of the job search plan or changes to make to an existing plan.",
  
  // Job filtering arguments
  JOBS_MIN_SCORE: "Minimum match score (0.0 to 1.0) to filter jobs by",
  JOBS_LIMIT: "Maximum number of jobs to return",
  
  // Digest arguments
  DIGEST_TEST_MODE: "Send in test mode with mock data instead of real jobs",
  
  // Email test arguments
  EMAIL_TEST_RECIPIENT: "Email address to send test email to (optional, defaults to DIGEST_TO)"
};

// Tool categories for organization
export const TOOL_CATEGORIES = {
  MONITORING: ['status'],
  SCANNING: ['scan', 'rescan', 'cancel_scan', 'deep_scan_job'],
  PLANNING: ['get_plan', 'update_plan'],
  JOBS: ['get_jobs', 'clear_jobs'],
  COMMUNICATION: ['send_digest', 'test_email']
};

// Tool help text for complex operations
export const TOOL_HELP = {
  SCAN: {
    usage: "Use 'scan' without arguments to scan all URLs from your current plan, or provide a specific LinkedIn search URL to scan just that page.",
    examples: [
      "scan - Scans all URLs from current plan",
      "scan with url='https://linkedin.com/jobs/search?keywords=engineer' - Scans specific URL"
    ]
  },
  
  UPDATE_PLAN: {
    usage: "Describe what kind of job you're looking for and the system will create or update your search plan.",
    examples: [
      "I'm looking for senior software engineer roles in San Francisco",
      "Add remote work options to my current search",
      "Focus on AI and machine learning positions"
    ]
  },
  
  GET_JOBS: {
    usage: "Retrieve jobs from previous scans with optional filtering by match score.",
    examples: [
      "get_jobs - Gets all jobs",
      "get_jobs with minScore=0.7 - Gets jobs with 70%+ match",
      "get_jobs with limit=10 - Gets top 10 jobs"
    ]
  }
};

// Error messages for tools
export const TOOL_ERRORS = {
  SCAN_IN_PROGRESS: "A scan is already in progress. Please wait for it to complete before starting a new one.",
  NO_PLAN_FOUND: "No job search plan found. Please create a plan first using the 'update_plan' tool.",
  NO_JOBS_FOUND: "No jobs found in previous scans. Run a scan first to find jobs.",
  INVALID_URL: "Invalid LinkedIn job URL provided. Please provide a valid LinkedIn job URL.",
  EMAIL_CONFIG_MISSING: "Email configuration is missing. Please check SMTP settings.",
  DEEP_SCAN_NO_PLAN: "No plan found for deep scanning. Please create a plan with profile information first."
};

// Success messages for tools
export const TOOL_SUCCESS = {
  SCAN_STARTED: "Scan job started in background.",
  SCAN_CANCELLED: "Scan job has been cancelled successfully.",
  PLAN_UPDATED: "Job search plan has been updated successfully.",
  DIGEST_SENT: "Digest email sent successfully.",
  EMAIL_TEST_SENT: "Test email sent successfully.",
  JOBS_CLEARED: "All stored jobs have been cleared from the database."
};
