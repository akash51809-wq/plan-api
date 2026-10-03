require('dotenv').config();

const config = {
  baseUrl: process.env.PLANAPI_BASE_URL || 'https://planapi.in',
  loginUrl: process.env.PLANAPI_LOGIN_URL || 'https://planapi.in/Login.aspx',
  operatorLookUrl: process.env.PLANAPI_OPERATOR_LOOK_URL || 'https://planapi.in/OperatorLook.aspx',
  rechargeCheckUrl: process.env.PLANAPI_RECHARGE_CHECK_URL || 'https://planapi.in/RechargeCheck.aspx',
  username: process.env.PLANAPI_USERNAME || '',
  password: process.env.PLANAPI_PASSWORD || '',
  mobileNumber: process.env.PLANAPI_MOBILE || '9876543210',
  headless: (process.env.PLAYWRIGHT_HEADLESS || 'false').toLowerCase() === 'true',
};

module.exports = config;
