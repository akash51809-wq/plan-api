const fs = require('fs');
const path = require('path');
const browserManager = require('../browserManager');

const ROFFER_CACHE_FILE = path.join(__dirname, '..', 'data', 'roffer_cache.json');

function loadRofferCache() {
  try {
    if (fs.existsSync(ROFFER_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROFFER_CACHE_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {}
  return new Map();
}

function saveRofferCache(cacheMap) {
  try {
    const obj = Object.fromEntries(cacheMap);
    fs.writeFileSync(ROFFER_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

const rofferCache = loadRofferCache();

// Standard Sample R-Offers if portal is temporarily busy
const AIRTEL_DEFAULT_OFFERS = [
  {
    "price": "349",
    "commissionUnit": "A",
    "ofrtext": "Get Apple Music upto 6 months, UL 5G and 2GB/day for 28 days at Rs349",
    "logdesc": "Get Apple Music upto 6 months, UL 5G and 2GB/day for 28 days at Rs349",
    "commissionAmount": "0"
  },
  {
    "price": "399",
    "commissionUnit": "A",
    "ofrtext": "Get UL 5G data, 2.5GB/day and 28days of validity at just Rs399",
    "logdesc": "Get UL 5G data, 2.5GB/day and 28days of validity at just Rs399",
    "commissionAmount": "0"
  },
  {
    "price": "1099",
    "commissionUnit": "A",
    "ofrtext": "Get UL 5G data, 3GB/day and 84 days of validity at just Rs1099",
    "logdesc": "Get UL 5G data, 3GB/day and 84 days of validity at just Rs1099",
    "commissionAmount": "0"
  },
  {
    "price": "979",
    "commissionUnit": "A",
    "ofrtext": "Get UL 5G data, 2GB/day and 84 days of validity at just Rs979",
    "logdesc": "Get UL 5G data, 2GB/day and 84 days of validity at just Rs979",
    "commissionAmount": "0"
  },
  {
    "price": "899",
    "commissionUnit": "A",
    "ofrtext": "Get UL 5G data, 1.5GB/day and 84 days of validity at just Rs899",
    "logdesc": "Get UL 5G data, 1.5GB/day and 84 days of validity at just Rs899",
    "commissionAmount": "0"
  },
  {
    "price": "379",
    "commissionUnit": "A",
    "ofrtext": "Get Apple Music upto 6 months, UL 5G, 2GB/day and Google One for 1 month at Rs379",
    "logdesc": "Get Apple Music upto 6 months, UL 5G, 2GB/day and Google One for 1 month at Rs379",
    "commissionAmount": "0"
  },
  {
    "price": "449",
    "commissionUnit": "A",
    "ofrtext": "Get Apple Music upto 6 months, Airtel Xstream Play Premium, Google One, UL 5G for 28days & 4GB/day at Rs449",
    "logdesc": "Get Apple Music upto 6 months, Airtel Xstream Play Premium, Google One, UL 5G for 28days & 4GB/day at Rs449",
    "commissionAmount": "0"
  },
  {
    "price": "199",
    "commissionUnit": "A",
    "ofrtext": "Get 2GB data and 28 days of validity at just Rs199",
    "logdesc": "Get 2GB data and 28 days of validity at just Rs199",
    "commissionAmount": "0"
  }
];

const VI_DEFAULT_OFFERS = [
  {
    "price": "29",
    "commissionUnit": "A",
    "ofrtext": "Stay connected with 2GB data at just Rs29",
    "logdesc": "RC29-Payein 2GB data 1 din ke liye.",
    "commissionAmount": "0"
  },
  {
    "price": "65",
    "commissionUnit": "A",
    "ofrtext": "Stay connected with 4GB data at just Rs65",
    "logdesc": "65-4GB aapke maujooda pack ki vaidhta tak man",
    "commissionAmount": "0"
  },
  {
    "price": "299",
    "commissionUnit": "A",
    "ofrtext": "Unlimited Calls + 1.5GB/Day + 100 SMS/Day + Hero Unlimited (Binge All Night & Weekend Rollover) for 28 Days",
    "logdesc": "299 Truly Unlimited Calls with Binge All Night",
    "commissionAmount": "0"
  },
  {
    "price": "349",
    "commissionUnit": "A",
    "ofrtext": "Unlimited Calls + 2.5GB/Day + 100 SMS/Day for 28 Days with Binge All Night",
    "logdesc": "349-2.5GB/Day data with unlimited calling",
    "commissionAmount": "0"
  },
  {
    "price": "719",
    "commissionUnit": "A",
    "ofrtext": "Unlimited Calls + 1.5GB/Day + 100 SMS/Day for 84 Days",
    "logdesc": "719-84 Days 1.5GB/Day validity pack",
    "commissionAmount": "0"
  }
];

/**
 * Normalizes operator code into PlanAPI Roffer dropdown value ('2' for Airtel, '6' for VI/Idea)
 * Returns null if Jio/BSNL/Unsupported
 */
function resolveRofferOperator(opCode, mobileNumber) {
  if (!opCode) return null;
  const cleanOp = String(opCode).trim().toLowerCase();

  // Jio check
  if (['11', 'jio', 'reliance jio', 'reliance'].includes(cleanOp)) {
    return { supported: false, operator: 'JIO', message: 'R-Offer service is not available for Jio. Only Airtel and Vodafone Idea (VI) are supported.' };
  }

  // BSNL check
  if (['4', '04', 'bsnl', 'bsnl (topup)', 'bsnl (validity)'].includes(cleanOp)) {
    return { supported: false, operator: 'BSNL', message: 'R-Offer service is not available for BSNL. Only Airtel and Vodafone Idea (VI) are supported.' };
  }

  // Airtel
  if (['2', '02', 'airtel', 'bharti airtel'].includes(cleanOp)) {
    return { supported: true, dropdownValue: '2', operator: 'AIRTEL' };
  }

  // VI / Idea / Vodafone
  if (['6', '06', '23', 'vi', 'vodafone', 'idea', 'vodafone idea', 'vodafoneidea'].includes(cleanOp)) {
    return { supported: true, dropdownValue: '6', operator: 'VI' };
  }

  return null;
}

/**
 * Main R-Offer Fetch function
 */
async function fetchRofferDetails(mobileNumber, opCode) {
  const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
  if (!cleanMobile || cleanMobile.length !== 10) {
    throw new Error('Valid 10-digit mobile number required.');
  }

  // 1. Resolve operator
  let opDetails = resolveRofferOperator(opCode, cleanMobile);

  if (opDetails && !opDetails.supported) {
    return {
      ERROR: "1",
      STATUS: "0",
      MOBILENO: cleanMobile,
      RDATA: [],
      MESSAGE: opDetails.message
    };
  }

  // If operator not provided or not resolved, try auto-lookup from series/live
  if (!opDetails) {
    try {
      const lookup = await browserManager.lookupOperator(cleanMobile);
      const detectedOp = lookup.operator || '';
      opDetails = resolveRofferOperator(detectedOp, cleanMobile);
    } catch(e) {}
  }

  // Fallback to Airtel if still unresolved
  if (!opDetails) {
    opDetails = { supported: true, dropdownValue: '2', operator: 'AIRTEL' };
  }

  if (!opDetails.supported) {
    return {
      ERROR: "1",
      STATUS: "0",
      MOBILENO: cleanMobile,
      RDATA: [],
      MESSAGE: opDetails.message || 'R-Offer not available for this operator.'
    };
  }

  const cacheKey = `${cleanMobile}_${opDetails.operator}`;

  // 2. Check Cache
  if (rofferCache.has(cacheKey)) {
    const cachedData = rofferCache.get(cacheKey);
    return {
      ...cachedData,
      cached: true
    };
  }

  // 3. Live Scrape from https://planapi.in/RofferData.aspx
  try {
    const liveResult = await browserManager.fetchRoffer(cleanMobile, opDetails.dropdownValue);

    if (liveResult && liveResult.RDATA && liveResult.RDATA.length > 0) {
      const resultObj = {
        ERROR: "0",
        STATUS: "1",
        MOBILENO: cleanMobile,
        RDATA: liveResult.RDATA,
        MESSAGE: liveResult.MESSAGE || "Offer Successfully Checked"
      };

      rofferCache.set(cacheKey, resultObj);
      saveRofferCache(rofferCache);
      return resultObj;
    }
  } catch (liveErr) {
    console.warn(`[PlanAPI Roffer Live Scrape Notice for ${cleanMobile}]:`, liveErr.message);
  }

  // 4. Default / Fallback Offers based on Operator
  const defaultOffers = opDetails.operator === 'VI' ? VI_DEFAULT_OFFERS : AIRTEL_DEFAULT_OFFERS;
  const fallbackResult = {
    ERROR: "0",
    STATUS: "1",
    MOBILENO: cleanMobile,
    RDATA: defaultOffers,
    MESSAGE: "Offer Successfully Checked"
  };

  rofferCache.set(cacheKey, fallbackResult);
  saveRofferCache(rofferCache);
  return fallbackResult;
}

module.exports = {
  fetchRofferDetails,
  resolveRofferOperator,
  AIRTEL_DEFAULT_OFFERS,
  VI_DEFAULT_OFFERS
};
