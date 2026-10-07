const https = require('https');
const http = require('http');
const logger = require('./logger');

let keepAliveTimer = null;

/**
 * Initializes automatic background keep-alive self-pinger.
 * Render Web Services provide RENDER_EXTERNAL_URL automatically.
 * When pinged via public HTTPS, Render registers incoming edge traffic
 * and resets its 15-minute inactivity idle timer.
 */
function startKeepAlive() {
  const targetUrl = process.env.KEEP_ALIVE_URL || 
                    process.env.RENDER_EXTERNAL_URL || 
                    process.env.APP_URL || 
                    process.env.PING_URL;

  if (!targetUrl) {
    logger.info('Keep-alive background service idle (no RENDER_EXTERNAL_URL or PING_URL detected). Relying on external cron-job.');
    return;
  }

  // Ensure clean target endpoint
  const base = targetUrl.replace(/\/+$/, '');
  const pingUrl = `${base}/ping?format=json`;

  // Default interval 10 minutes (Render sleeps after 15 minutes of inactivity)
  const intervalMinutes = Math.max(1, parseInt(process.env.KEEP_ALIVE_INTERVAL_MINUTES, 10) || 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(`🚀 Render Keep-Alive background worker enabled: Pinging ${pingUrl} every ${intervalMinutes} minutes.`);

  // Stop any existing timer
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  const doPing = () => {
    try {
      const client = pingUrl.startsWith('https://') ? https : http;
      const startTime = Date.now();
      
      const req = client.get(pingUrl, { timeout: 15000 }, (res) => {
        const elapsed = Date.now() - startTime;
        logger.info(`Keep-alive self-ping success: HTTP ${res.statusCode} (${elapsed}ms)`);
        res.resume(); // Free memory
      });

      req.on('timeout', () => {
        logger.warn('Keep-alive self-ping timed out after 15s');
        req.destroy();
      });

      req.on('error', (err) => {
        logger.warn(`Keep-alive self-ping warning: ${err.message}`);
      });
    } catch (err) {
      logger.warn(`Keep-alive self-ping execution error: ${err.message}`);
    }
  };

  // Schedule recurring interval
  keepAliveTimer = setInterval(doPing, intervalMs);

  // Unref so timer doesn't prevent Node.js from exiting cleanly if needed
  if (keepAliveTimer.unref) {
    keepAliveTimer.unref();
  }
}

/**
 * Clears the background keep-alive timer on shutdown.
 */
function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    logger.info('Keep-alive background worker stopped.');
  }
}

module.exports = {
  startKeepAlive,
  stopKeepAlive
};
