const { redactSecrets } = require('./security');

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const CURRENT_LEVEL = process.env.LOG_LEVEL ? (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] ?? LOG_LEVELS.INFO) : LOG_LEVELS.INFO;

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] > CURRENT_LEVEL) return;

  const timestamp = new Date().toISOString();
  const sanitizedMeta = redactSecrets(meta);

  const logEntry = {
    timestamp,
    level,
    message,
    ...(Object.keys(sanitizedMeta).length > 0 && { meta: sanitizedMeta })
  };

  const formattedMeta = Object.keys(sanitizedMeta).length > 0 ? ` | ${JSON.stringify(sanitizedMeta)}` : '';
  const prefix = {
    ERROR: '❌',
    WARN: '⚠️',
    INFO: '📡',
    DEBUG: '🔍'
  }[level] || 'ℹ️';

  console.log(`${prefix} [${timestamp}] [${level}] ${message}${formattedMeta}`);
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  debug: (msg, meta) => log('DEBUG', msg, meta),
  redactSecrets
};
