const fs = require('fs');
const path = require('path');
const db = require('./db');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Default WhatsApp Settings
const defaultSettings = {
  baseUrl: 'https://local-whatsapp.onrender.com/send-text',
  token: 'wa_bf0383b7377b59bfde846ab9',
  otpTemplate: 'Hello {NAME}, your verification OTP for PlanAPI is *{OTP}*. This OTP is valid for 10 minutes. Do not share it with anyone.',
  adminUsername: 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

function getSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const dataDir = path.dirname(SETTINGS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }
    const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...defaultSettings, ...JSON.parse(content) };
  } catch (err) {
    console.error('Error reading settings:', err);
    return defaultSettings;
  }
}

function saveSettings(newSettings) {
  try {
    const current = getSettings();
    const merged = { ...current, ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));

    // Async sync to PostgreSQL if connected
    if (db.isConnected) {
      db.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        ['app_settings', JSON.stringify(merged)]
      ).catch(e => console.warn('[PostgreSQL settings sync notice]:', e.message));
    }

    return merged;
  } catch (err) {
    console.error('Error saving settings:', err);
    throw err;
  }
}

async function sendWhatsAppMessage(mobile, messageText) {
  const settings = getSettings();
  let cleanMobile = String(mobile).trim().replace(/\D/g, '');
  if (cleanMobile.length === 10) {
    cleanMobile = '91' + cleanMobile; // Ensure India country code
  }

  const queryParams = new URLSearchParams({
    token: settings.token,
    to: cleanMobile,
    message: messageText
  });

  const url = `${settings.baseUrl}?${queryParams.toString()}`;
  console.log(`📡 Sending WhatsApp message to ${cleanMobile}...`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const data = await response.json().catch(async () => {
      const text = await response.text();
      return { raw: text };
    });

    console.log('✅ WhatsApp API response:', data);
    return { success: response.ok, data };
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getSettings,
  saveSettings,
  sendWhatsAppMessage
};
