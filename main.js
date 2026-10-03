const browserManager = require('./browserManager');
const config = require('./config');

async function performFullCheck(mobileNumber) {
  const targetNumber = mobileNumber || config.mobileNumber;
  return await browserManager.performLookup(targetNumber);
}

if (require.main === module) {
  const targetNumber = process.argv[2] || config.mobileNumber;
  console.log(`🚀 Querying PlanAPI for ${targetNumber}...`);
  browserManager.performLookup(targetNumber)
    .then((result) => {
      console.log('\n================== 📊 FINAL LIVE RESULT ==================');
      console.log(`📱 Mobile Number       : ${result.mobile}`);
      console.log(`📡 Operator Name        : ${result.operator}`);
      console.log(`📍 Circle Name          : ${result.circle}`);
      console.log(`💰 Last Recharge Amount : ${result.lastRechargeAmount || 'N/A'}`);
      console.log(`📅 Last Recharge Date   : ${result.lastRechargeDate || 'N/A'}`);
      console.log(`⏳ Plan Expiry Date     : ${result.expiryDate || 'N/A'}`);
      if (result.note) {
        console.log(`ℹ️ Note                 : ${result.note}`);
      }
      console.log('==========================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Lookup failed:', err);
      process.exit(1);
    });
}

module.exports = { performFullCheck };
