/**
 * Digest email functionality for job matches
 * Reimplementation of src/mailer.js for Cloudflare Workers
 */

import nodemailer from 'nodemailer';

/**
 * Check if SMTP is configured
 * @param {Object} env - Environment variables
 * @returns {Object} - Configuration status and missing variables
 */
export function checkSmtpConfiguration(env) {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missingVars = requiredVars.filter(varName => !env[varName]);
  
  return {
    isConfigured: missingVars.length === 0,
    missingVars
  };
}

/**
 * Get jobs that should be included in digest (completed scans, not previously sent)
 * @param {Object} env - Environment variables (for KV storage access)
 * @returns {Array} - Array of jobs to include in digest
 */
export async function getJobsForDigest(env) {
  try {
    const jobIndex = await env.JOB_STORAGE.get('job_index', 'json');
    if (!jobIndex || !jobIndex.jobs) return [];
    
    return jobIndex.jobs.filter(job => {
      // Only include scanned jobs with completed status
      if (!job.scanned || job.scanStatus !== 'completed') return false;
      
      // Only include jobs not previously sent in digest
      if (job.sentInDigest) return false;
      
      return true;
    });
  } catch (error) {
    console.error('Error getting jobs for digest:', error);
    return [];
  }
}

/**
 * Mark jobs as sent in digest
 * @param {Object} env - Environment variables (for KV storage access)
 * @returns {number} - Number of jobs marked as sent
 */
export async function markJobsAsSent(env) {
  try {
    const jobIndex = await env.JOB_STORAGE.get('job_index', 'json');
    if (!jobIndex || !jobIndex.jobs) return 0;
    
    // Mark all completed, unsent jobs as sent
    let markedCount = 0;
    jobIndex.jobs.forEach(job => {
      if (job.scanned && job.scanStatus === 'completed' && !job.sentInDigest) {
        job.sentInDigest = true;
        job.digestSentDate = new Date().toISOString();
        markedCount++;
      }
    });
    
    if (markedCount > 0) {
      jobIndex.lastUpdate = new Date().toISOString();
      await env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
      console.log(`Marked ${markedCount} jobs as sent in digest`);
    }
    
    return markedCount;
  } catch (error) {
    console.error('Error marking jobs as sent:', error);
    return 0;
  }
}

/**
 * Filter jobs based on digest criteria
 * @param {Array} jobs - Array of jobs to filter
 * @param {Object} criteria - Filter criteria
 * @param {boolean} criteria.onlyNew - Only include jobs not previously sent
 * @param {number} criteria.minMatchScore - Minimum match score threshold
 * @returns {Array} - Filtered jobs
 */
export function filterJobsForDigest(jobs, criteria = {}) {
  const { onlyNew = true, minMatchScore = 0.0 } = criteria;
  
  return jobs.filter(job => {
    // Only include scanned jobs with completed status
    if (!job.scanned || job.scanStatus !== 'completed') return false;
    
    // Apply match score filter
    if (job.matchScore < minMatchScore) return false;
    
    // Apply onlyNew filter
    if (onlyNew && job.sentInDigest) return false;
    
    return true;
  });
}

/**
 * Generate HTML email content for job digest
 * @param {Array} jobs - Array of jobs to include
 * @param {Object} options - Email options
 * @param {string} options.source - Source of the digest (scan, rescan, etc.)
 * @param {boolean} options.onlyNew - Whether only new jobs are included
 * @returns {string} - HTML email content
 */
export function generateDigestHtml(jobs, options = {}) {
  const { source, onlyNew } = options;
  const sourceText = source ? ` from ${source}` : '';
  
  return `
    <h2>Job Matches${sourceText}</h2>
    <p>Found ${jobs.length} potential job matches${onlyNew ? ' (new)' : ''}:</p>
    <table border="1" cellpadding="5" style="border-collapse: collapse; width: 100%;">
      <tr style="background-color: #f2f2f2;">
        <th>Title</th>
        <th>Company</th>
        <th>Match Score</th>
        <th>Location</th>
        <th>Match Reason</th>
      </tr>
      ${jobs.map(job => `
        <tr>
          <td><a href="${job.url}">${job.title}</a></td>
          <td>${job.company || 'N/A'}</td>
          <td>${job.matchScore ? Math.round(job.matchScore * 100) + '%' : 'N/A'}</td>
          <td>${job.location || 'N/A'}</td>
          <td>${job.matchReason || 'No reason provided'}</td>
        </tr>
      `).join('')}
    </table>
    <p><em>Generated on ${new Date().toLocaleString()}</em></p>
  `;
}

/**
 * Send digest email using fetch to external SMTP service or Cloudflare Email API
 * @param {string} toEmail - Recipient email address
 * @param {Array} jobs - Array of jobs to include
 * @param {Object} env - Environment variables
 * @param {Object} options - Email options
 * @param {string} options.subject - Custom email subject
 * @param {string} options.source - Source of the digest
 * @param {boolean} options.onlyNew - Whether only new jobs are included
 * @returns {Object} - Result object with success status and message/error
 */
export async function sendDigestEmail(toEmail, jobs, env, options = {}) {
  try {
    const { subject, source, onlyNew } = options;
    const sourceText = source ? ` from ${source}` : '';
    const emailSubject = subject || `Job matches${sourceText} - ${new Date().toLocaleDateString()}`;
    
    // Generate HTML content
    const html = generateDigestHtml(jobs, { source, onlyNew });
    
    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT),
      secure: env.SMTP_SECURE === 'true',
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
    
    // Send email using nodemailer
    console.log(`Sending digest email to ${toEmail} with ${jobs.length} jobs`);
    console.log(`Subject: ${emailSubject}`);
    console.log(`Jobs: ${jobs.map(j => `${j.title} at ${j.company} (${Math.round(j.matchScore * 100)}%)`).join(', ')}`);
    
    await transporter.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: toEmail,
      subject: emailSubject,
      html: html
    });
    
    console.log(`Successfully sent digest email to ${toEmail}`);
    return {
      success: true,
      message: `Email sent to ${toEmail}`
    };
    
  } catch (error) {
    console.error('Error sending digest email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Auto-send digest after scan completion
 * @param {Object} env - Environment variables
 * @param {Object} options - Digest options
 * @param {string} options.source - Source of the digest (scan, rescan, etc.)
 * @returns {Object} - Result object with success status and details
 */
export async function autoSendDigest(env, options = {}) {
  try {
    const { source = 'scan' } = options;
    
    // Check if DIGEST_TO is configured
    if (!env.DIGEST_TO) {
      console.log('DIGEST_TO not configured, skipping auto-digest');
      return { success: false, error: 'DIGEST_TO not configured' };
    }
    
    // Check SMTP configuration
    const smtpCheck = checkSmtpConfiguration(env);
    if (!smtpCheck.isConfigured) {
      console.log(`SMTP not configured, skipping auto-digest. Missing: ${smtpCheck.missingVars.join(', ')}`);
      return { success: false, error: 'SMTP not configured', missingVars: smtpCheck.missingVars };
    }
    
    // Get jobs for digest
    const jobs = await getJobsForDigest(env);
    
    // Check if we should send digest even with zero jobs
    const sendOnZeroJobs = env.SEND_DIGEST_ON_ZERO_JOBS === 'true';
    
    if (jobs.length === 0 && !sendOnZeroJobs) {
      console.log('No new jobs to send in auto-digest and SEND_DIGEST_ON_ZERO_JOBS is disabled');
      return { success: false, error: 'No new jobs to send' };
    }
    
    if (jobs.length === 0 && sendOnZeroJobs) {
      console.log('No new jobs found, but SEND_DIGEST_ON_ZERO_JOBS is enabled - sending empty digest');
    }
    
    // Send digest email
    console.log(`Auto-sending digest email with ${jobs.length} jobs...`);
    const emailResult = await sendDigestEmail(env.DIGEST_TO, jobs, env, {
      source,
      onlyNew: true
    });
    
    if (emailResult.success) {
      // Mark jobs as sent
      const markedCount = await markJobsAsSent(env);
      console.log(`Digest email sent successfully, marked ${markedCount} jobs as sent`);
      return { 
        success: true, 
        jobsSent: jobs.length, 
        markedAsSent: markedCount 
      };
    } else {
      console.log(`Failed to send auto-digest: ${emailResult.error}`);
      return { success: false, error: emailResult.error };
    }
    
  } catch (error) {
    console.error('Error in auto-send digest:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification email when a scheduled trigger occurs
 * @param {Object} env - Environment variables
 * @param {Object} triggerInfo - Information about the trigger
 * @param {string} triggerInfo.scheduledTime - When the trigger was scheduled
 * @param {string} triggerInfo.cron - The cron pattern
 * @returns {Object} - Result object with success status and message/error
 */
export async function sendScheduledTriggerNotification(env, triggerInfo = {}) {
  try {
    // Check if scheduled trigger emails are enabled
    if (env.SCHEDULED_TRIGGER_EMAIL !== 'true') {
      console.log('Scheduled trigger email notifications are disabled');
      return { success: false, error: 'Scheduled trigger email notifications disabled' };
    }
    
    // Check if DIGEST_TO is configured
    if (!env.DIGEST_TO) {
      console.log('DIGEST_TO not configured, cannot send scheduled trigger notification');
      return { success: false, error: 'DIGEST_TO not configured' };
    }
    
    // Check SMTP configuration
    const smtpCheck = checkSmtpConfiguration(env);
    if (!smtpCheck.isConfigured) {
      console.log(`SMTP not configured, cannot send scheduled trigger notification. Missing: ${smtpCheck.missingVars.join(', ')}`);
      return { success: false, error: 'SMTP not configured', missingVars: smtpCheck.missingVars };
    }
    
    const { scheduledTime, cron } = triggerInfo;
    const triggerDate = scheduledTime ? new Date(scheduledTime).toLocaleString() : 'Unknown';
    
    // Create email content
    const subject = '🤖 Job Search Scan Started - Scheduled Trigger';
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb; margin-bottom: 20px;">📅 Scheduled Job Search Scan Started</h2>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0; color: #475569;"><strong>Trigger Time:</strong> ${triggerDate}</p>
          <p style="margin: 5px 0 0 0; color: #475569;"><strong>Cron Pattern:</strong> <code style="background-color: #e2e8f0; padding: 2px 4px; border-radius: 3px;">${cron || 'Unknown'}</code></p>
        </div>
        
        <p style="color: #475569; line-height: 1.6;">Your automated job search scan has been triggered and is now running. You'll receive a digest email with the results once the scan completes.</p>
        
        <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #065f46; font-weight: 500;">💡 Tip: You can disable these trigger notifications by setting <code>SCHEDULED_TRIGGER_EMAIL=false</code> in your environment variables.</p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #94a3b8; font-size: 14px; margin: 0;">This is an automated message from your MCP Job Search system.</p>
      </div>
    `;
    
    // Send email using nodemailer
    const transporter = nodemailer.createTransporter({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT),
      secure: parseInt(env.SMTP_PORT) === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
    
    const mailOptions = {
      from: env.SMTP_USER,
      to: env.DIGEST_TO,
      subject: subject,
      html: htmlContent
    };
    
    console.log('Sending scheduled trigger notification email...');
    await transporter.sendMail(mailOptions);
    
    console.log('Scheduled trigger notification email sent successfully');
    return { success: true, message: 'Scheduled trigger notification sent' };
    
  } catch (error) {
    console.error('Error sending scheduled trigger notification:', error);
    return { success: false, error: error.message };
  }
}
