# PlanAPI Live Automation & Web Portal

A complete Node.js application featuring **User Panel**, **Admin Panel**, **WhatsApp OTP Signup/Verification**, and **Live PlanAPI Operator & Recharge Intelligence**.

---

## 🌟 Key Features

1. **User Panel & Dashboard**:
   - **Signup with WhatsApp OTP**: Enter Full Name & Mobile Number $\rightarrow$ Real-time 6-digit OTP sent via WhatsApp $\rightarrow$ Instant verification $\rightarrow$ Opens Dashboard.
   - **Live Mobile Operator & Circle Lookup**: Fetches live network operator and telecom circle.
   - **Live Last Recharge & Plan Expiry Check**: Fetches last recharge amount (₹), last recharge date, and validity/expiry date.

2. **Admin Panel**:
   - **WhatsApp API Configuration**:
     - Base Endpoint: `https://local-whatsapp.onrender.com/send-text`
     - Auth Token: `wa_bf0383b7377b59bfde846ab9`
     - Dynamic Message Template editor with `{NAME}` and `{OTP}` placeholders.
   - **Live WhatsApp Message Tester**: Test sending messages to any mobile number with live status response.
   - **Registered Users List**: View all verified users registered via WhatsApp OTP.

3. **Backend Automation Engine**:
   - Playwright headless Chromium automation for PlanAPI ASP.NET portal.

---

## 🚀 How to Run

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment (`.env`)
```env
PLANAPI_BASE_URL=https://planapi.in
PLANAPI_LOGIN_URL=https://planapi.in/Login.aspx
PLANAPI_OPERATOR_LOOK_URL=https://planapi.in/OperatorLook.aspx
PLANAPI_RECHARGE_CHECK_URL=https://planapi.in/RechargeCheck.aspx
PLANAPI_USERNAME=8840457632
PLANAPI_PASSWORD=123456
PLANAPI_MOBILE=9335819686
PLAYWRIGHT_HEADLESS=true
PORT=3000
```

### 3. Start the Web Server
```bash
npm start
```

- **User Portal**: [http://localhost:3000](http://localhost:3000)
- **Admin Portal**: [http://localhost:3000#admin](http://localhost:3000#admin)
  - Default Admin Username: `admin`
  - Default Admin Password: `admin123`

### 4. Run CLI Automation Directly (Optional)
```bash
npm run cli 9335819686
```
