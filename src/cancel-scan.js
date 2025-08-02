import { z } from "zod";

import { TOOL_DESCRIPTIONS, TOOL_SUCCESS } from './tool-descriptions.js';

export function getCancelScanTool(agent) {
  return {
    name: "cancel_scan",
    description: TOOL_DESCRIPTIONS.CANCEL_SCAN,
    args: {},
    handler: async () => {
      const { backgroundJobs } = agent;
      
      if (!backgroundJobs.scan.inProgress) {
        return {
          content: [{ type: "text", text: "No scan is currently in progress." }],
          structuredContent: { 
            success: false, 
            message: "No scan is currently in progress.",
            currentStatus: backgroundJobs.scan.status
          }
        };
      }
      
      // Set cancellation flag
      backgroundJobs.scan.cancelled = true;
      backgroundJobs.scan.status = 'cancelling';
      backgroundJobs.scan.endTime = new Date().toISOString();
      
      console.log('Scan cancellation requested by user');
      
      return {
        content: [{ type: "text", text: "Scan cancellation requested. The scan will stop after the current job completes." }],
        structuredContent: { 
          success: true, 
          message: "Scan cancellation requested. The scan will stop after the current job completes.",
          previousStatus: backgroundJobs.scan.status,
          newStatus: 'cancelling'
        }
      };
    },
    options: {
      title: "Cancel Current Scan",
      readOnlyHint: false,
      openWorldHint: false
    }
  };
}
