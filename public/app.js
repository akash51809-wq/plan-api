// State management
let currentUser = null;
let otpCountdownTimer = null;
let currentPendingMobile = '';
let currentPendingName = '';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  checkUserSession();
  checkAdminSession();

  // Listen for hash changes
  if (window.location.hash === '#admin') {
    switchView('admin');
  }
});

// View Switcher
function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const targetNav = document.getElementById(`nav-${viewName}`);
  if (targetNav) targetNav.classList.add('active');

  // Specific view loaders
  if (viewName === 'admin') {
    checkAdminSession();
  } else if (viewName === 'dashboard') {
    if (!currentUser) {
      showToast('Please sign up or log in first.', 'warning');
      switchView('signup');
    }
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.style.display = 'block';
  toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#1e293b';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}

// ---------------- USER SIGNUP & WHATSAPP OTP ---------------- //

async function requestSignupOTP() {
  const nameInput = document.getElementById('signup-name');
  const mobileInput = document.getElementById('signup-mobile');
  const btn = document.getElementById('btn-send-otp');

  const name = nameInput.value.trim();
  const mobile = mobileInput.value.trim().replace(/\D/g, '');

  if (!name) {
    showToast('Please enter your full name.', 'error');
    nameInput.focus();
    return;
  }

  if (mobile.length !== 10) {
    showToast('Please enter a valid 10-digit mobile number.', 'error');
    mobileInput.focus();
    return;
  }

  currentPendingName = name;
  currentPendingMobile = mobile;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending WhatsApp OTP...';

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mobile })
    });

    const data = await res.json();
    if (data.success) {
      showToast('OTP sent to your WhatsApp number!', 'success');
      document.getElementById('signup-step-1').style.display = 'none';
      document.getElementById('signup-step-2').style.display = 'block';
      document.getElementById('display-otp-mobile').innerText = `+91 ${mobile}`;
      startOTPTimer();
    } else {
      showToast(data.message || 'Failed to send OTP.', 'error');
    }
  } catch (err) {
    showToast('Network error while requesting OTP.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Send WhatsApp OTP';
  }
}

function startOTPTimer() {
  let timeLeft = 30;
  const timerText = document.getElementById('otp-timer-text');
  const countdown = document.getElementById('otp-countdown');
  const resendBtn = document.getElementById('btn-resend-otp');

  timerText.style.display = 'inline';
  resendBtn.style.display = 'none';

  if (otpCountdownTimer) clearInterval(otpCountdownTimer);

  otpCountdownTimer = setInterval(() => {
    timeLeft--;
    countdown.innerText = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(otpCountdownTimer);
      timerText.style.display = 'none';
      resendBtn.style.display = 'inline';
    }
  }, 1000);
}

async function verifySignupOTP() {
  const otpInput = document.getElementById('signup-otp');
  const otp = otpInput.value.trim();
  const btn = document.getElementById('btn-verify-otp');

  if (otp.length !== 6) {
    showToast('Please enter the 6-digit OTP received on WhatsApp.', 'error');
    otpInput.focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentPendingName,
        mobile: currentPendingMobile,
        otp
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Verification successful!', 'success');
      setUserSession(data.user);
      switchView('dashboard');
    } else {
      showToast(data.message || 'Invalid OTP. Please try again.', 'error');
    }
  } catch (err) {
    showToast('Error verifying OTP.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Verify & Open Dashboard';
  }
}

// ---------------- USER LOGIN ---------------- //

async function requestLoginOTP() {
  const mobileInput = document.getElementById('login-mobile');
  const mobile = mobileInput.value.trim().replace(/\D/g, '');
  const btn = document.getElementById('btn-login-otp');

  if (mobile.length !== 10) {
    showToast('Please enter a valid 10-digit mobile number.', 'error');
    return;
  }

  currentPendingMobile = mobile;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...';

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile })
    });

    const data = await res.json();
    if (data.success) {
      showToast('OTP sent to your WhatsApp number!', 'success');
      document.getElementById('login-step-1').style.display = 'none';
      document.getElementById('login-step-2').style.display = 'block';
      document.getElementById('login-display-mobile').innerText = `+91 ${mobile}`;
    } else {
      showToast(data.message || 'Failed to send OTP.', 'error');
    }
  } catch (e) {
    showToast('Network error while requesting login OTP.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Send Login OTP';
  }
}

async function verifyLoginOTP() {
  const otp = document.getElementById('login-otp').value.trim();
  if (otp.length !== 6) {
    showToast('Please enter the 6-digit OTP.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: currentPendingMobile, otp })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Login successful!', 'success');
      setUserSession(data.user);
      switchView('dashboard');
    } else {
      showToast(data.message || 'Invalid OTP.', 'error');
    }
  } catch (err) {
    showToast('Verification failed.', 'error');
  }
}

// ---------------- USER SESSION ---------------- //

function setUserSession(user) {
  currentUser = user;
  localStorage.setItem('planapi_user', JSON.stringify(user));
  updateUIForUser();
}

function checkUserSession() {
  const stored = localStorage.getItem('planapi_user');
  if (stored) {
    try {
      currentUser = JSON.parse(stored);
      updateUIForUser();
    } catch (e) {
      currentUser = null;
    }
  }
}

function updateUIForUser() {
  const navAuth = document.getElementById('nav-auth-buttons');
  const navUser = document.getElementById('nav-user-profile');
  const navDashboard = document.getElementById('nav-dashboard');

  if (currentUser) {
    navAuth.style.display = 'none';
    navUser.style.display = 'flex';
    navDashboard.style.display = 'inline-flex';

    document.getElementById('nav-user-name').innerText = currentUser.name || 'User';
    document.getElementById('dash-user-name').innerText = currentUser.name || 'User';
    document.getElementById('dash-user-mobile').innerText = `+91 ${currentUser.mobile}`;

    document.getElementById('profile-name').innerText = currentUser.name || '-';
    document.getElementById('profile-mobile').innerText = `+91 ${currentUser.mobile}`;
    document.getElementById('profile-session').innerText = new Date().toLocaleTimeString();
  } else {
    navAuth.style.display = 'flex';
    navUser.style.display = 'none';
    navDashboard.style.display = 'none';
  }
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('planapi_user');
  updateUIForUser();
  showToast('Logged out successfully.');
  switchView('home');
}

// ---------------- LIVE PLANAPI LOOKUP ---------------- //

async function performLookup(inputId, resultContainerId) {
  const input = document.getElementById(inputId);
  const resultBox = document.getElementById(resultContainerId);
  const mobile = input.value.trim().replace(/\D/g, '');

  if (mobile.length !== 10) {
    showToast('Please enter a valid 10-digit mobile number.', 'error');
    input.focus();
    return;
  }

  resultBox.style.display = 'block';
  resultBox.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.8rem; color: var(--primary);"></i>
      <p style="margin-top: 10px; font-weight: 600;">Fetching live details from PlanAPI portal...</p>
      <small class="text-muted">Logging in & querying OperatorLook & RechargeCheck...</small>
    </div>
  `;

  try {
    const res = await fetch('/api/lookup/full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile })
    });

    const data = await res.json();

    if (data.success && data.data) {
      const d = data.data;
      resultBox.innerHTML = `
        <div class="result-header">
          <div>
            <strong>Target:</strong> +91 ${d.mobile}
          </div>
          <span class="result-badge"><i class="fa-solid fa-bolt"></i> ${d.cached ? '⚡ Memory Cache' : '🌐 Live PlanAPI'} (${d.responseTime || '<1s'})</span>
        </div>
        <div class="result-items-grid" style="grid-template-columns: 1fr 1fr;">
          <div class="result-item">
            <div class="result-item-label">Operator Name</div>
            <div class="result-item-val text-primary" style="font-size: 1.3rem;">${d.operator || 'Unknown'}</div>
          </div>
          <div class="result-item">
            <div class="result-item-label">Circle / State</div>
            <div class="result-item-val text-emerald" style="font-size: 1.3rem;">${d.circle || 'Unknown'}</div>
          </div>
        </div>
      `;
    } else {
      resultBox.innerHTML = `
        <div class="alert alert-danger" style="margin: 0; background: var(--danger-light); color: var(--danger); border: 1px solid #fca5a5;">
          <i class="fa-solid fa-triangle-exclamation"></i> ${data.message || 'Lookup failed.'}
        </div>
      `;
    }
  } catch (err) {
    resultBox.innerHTML = `
      <div class="alert alert-danger" style="margin: 0; background: var(--danger-light); color: var(--danger); border: 1px solid #fca5a5;">
        <i class="fa-solid fa-triangle-exclamation"></i> Network error during live fetch.
      </div>
    `;
  }
}

// ---------------- ADMIN PANEL ---------------- //

function checkAdminSession() {
  const adminToken = localStorage.getItem('planapi_admin_token');
  if (adminToken) {
    document.getElementById('admin-login-box').style.display = 'none';
    document.getElementById('admin-content-box').style.display = 'block';
    loadAdminSettings();
    loadAdminUsers();
  } else {
    document.getElementById('admin-login-box').style.display = 'block';
    document.getElementById('admin-content-box').style.display = 'none';
  }
}

async function adminLogin() {
  const username = document.getElementById('admin-user').value.trim();
  const password = document.getElementById('admin-pass').value.trim();

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem('planapi_admin_token', data.token);
      showToast('Admin login successful!', 'success');
      checkAdminSession();
    } else {
      showToast(data.message || 'Invalid admin credentials.', 'error');
    }
  } catch (err) {
    showToast('Admin login error.', 'error');
  }
}

function adminLogout() {
  localStorage.removeItem('planapi_admin_token');
  showToast('Admin logged out.');
  checkAdminSession();
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));

  const btn = document.getElementById(`tab-btn-${tabName}`);
  const content = document.getElementById(`admin-tab-${tabName}`);

  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');

  if (tabName === 'users') {
    loadAdminUsers();
  }
}

async function loadAdminSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      document.getElementById('wa-base-url').value = s.baseUrl || '';
      document.getElementById('wa-token').value = s.token || '';
      document.getElementById('wa-template').value = s.otpTemplate || '';
      document.getElementById('admin-user-count').innerText = data.totalUsers || 0;
      updatePreviewUrl();
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

function updatePreviewUrl() {
  const base = document.getElementById('wa-base-url').value;
  const token = document.getElementById('wa-token').value;
  document.getElementById('wa-preview-url').innerText = `${base}?token=${token}&to=[MOBILE]&message=[CONTENT]`;
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'wa-base-url' || e.target.id === 'wa-token') {
    updatePreviewUrl();
  }
});

async function saveAdminSettings() {
  const baseUrl = document.getElementById('wa-base-url').value.trim();
  const token = document.getElementById('wa-token').value.trim();
  const otpTemplate = document.getElementById('wa-template').value.trim();

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, token, otpTemplate })
    });

    const data = await res.json();
    if (data.success) {
      showToast('WhatsApp Settings updated successfully!', 'success');
      updatePreviewUrl();
    } else {
      showToast(data.message || 'Failed to update settings.', 'error');
    }
  } catch (err) {
    showToast('Error saving settings.', 'error');
  }
}

async function sendTestWhatsApp() {
  const mobile = document.getElementById('test-mobile').value.trim();
  const message = document.getElementById('test-message').value.trim();
  const btn = document.getElementById('btn-send-test');
  const respBox = document.getElementById('test-wa-response');

  if (!mobile || !message) {
    showToast('Please enter both mobile number and message.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching...';
  respBox.style.display = 'block';
  respBox.innerText = 'Dispatching test message to Render WhatsApp Gateway...';

  try {
    const res = await fetch('/api/admin/send-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, message })
    });

    const data = await res.json();
    respBox.innerText = JSON.stringify(data, null, 2);
    if (data.success) {
      showToast('Test WhatsApp dispatched successfully!', 'success');
    } else {
      showToast('WhatsApp dispatch completed with notice.', 'warning');
    }
  } catch (err) {
    respBox.innerText = 'Network error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test WhatsApp';
  }
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading users...</td></tr>';

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();

    if (data.success && data.users && data.users.length > 0) {
      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td><code>${u.id || '-'}</code></td>
          <td><strong>${u.name || 'User'}</strong></td>
          <td><i class="fa-brands fa-whatsapp text-emerald"></i> +91 ${u.mobile}</td>
          <td>${u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}</td>
          <td><span class="badge badge-success">${u.status || 'Active'}</span></td>
        </tr>
      `).join('');
      document.getElementById('admin-user-count').innerText = data.users.length;
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No users registered yet. Sign up on the user panel to create one!</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading user list.</td></tr>';
  }
}
