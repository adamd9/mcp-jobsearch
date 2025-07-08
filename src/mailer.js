import nodemailer from "nodemailer";
import { markJobsAsSent } from "./storage.js";

/**
 * Check if SMTP is configured
 * @returns {boolean} - True if SMTP is configured, false otherwise
 */
export function isSmtpConfigured() {
  return (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.DIGEST_TO
  );
}

/**
 * Send a digest email with job matches
 * @param {string} to - Email address to send digest to
 * @param {Array} matches - Array of job matches
 * @param {Object} options - Optional parameters
 * @param {string} options.subject - Custom subject line
 * @param {string} options.source - Source of the digest (scan, rescan, etc.)
 * @param {boolean} options.onlyNew - Whether to only include new jobs (default: true)
 * @returns {Promise<boolean>} - True if email was sent, false otherwise
 */
export async function sendDigest(to, matches, options = {}) {
  // Default to only sending new jobs unless explicitly set to false
  const onlyNew = options.onlyNew !== false;
  if (!isSmtpConfigured()) {
    console.log('SMTP not configured, skipping digest email');
    return false;
  }
  
  if (!to) {
    to = process.env.DIGEST_TO;
  }
  
  // Filter to only include new jobs if onlyNew is true
  const jobsToSend = onlyNew 
    ? matches.filter(job => job.isNew !== false)
    : matches;
    
  if (!jobsToSend || jobsToSend.length === 0) {
    console.log('No new matches to send in digest email');
    return false;
  }
  
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    
    const source = options.source ? ` from ${options.source}` : '';
    const subject = options.subject || `Job matches${source} - ${new Date().toLocaleDateString()}`;
    
    // Create a more detailed HTML email
    const html = `
      <h2>Job Matches${source}</h2>
      <p>Found ${jobsToSend.length} potential job matches${onlyNew ? ' (new)' : ''}:</p>
      <table border="1" cellpadding="5" style="border-collapse: collapse;">
        <tr>
          <th>Title</th>
          <th>Company</th>
          <th>Match Score</th>
          <th>Posted</th>
          <th>Match Reason</th>
        </tr>
        ${jobsToSend.map(m => `
          <tr>
            <td><a href="${m.link}">${m.title}</a></td>
            <td>${m.company || 'N/A'}</td>
            <td>${m.matchScore ? Math.round(m.matchScore * 100) + '%' : 'N/A'}</td>
            <td>${m.posted || 'N/A'}</td>
            <td>${m.matchReason || 'No reason provided'}</td>
          </tr>
        `).join('')}
      </table>
      <p>Generated on ${new Date().toLocaleString()}</p>
    `;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html
    });
    
    // Mark jobs as sent in digest
    if (onlyNew && jobsToSend.length > 0) {
      await markJobsAsSent(jobsToSend.map(job => job.id));
    }
    
    console.log(`Sent digest email to ${to} with ${jobsToSend.length} job matches${onlyNew ? ' (new)' : ''}`);
    return true;
  } catch (error) {
    console.error(`Error sending digest email: ${error.message}`);
    return false;
  }
}
