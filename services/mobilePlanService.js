/**
 * Telecom Mobile Plans Database & Service
 * High-speed cached operator and circle plan engine
 */

const fs = require('fs');
const path = require('path');

const PLANS_DB_PATH = path.join(__dirname, '../data/mobile_plans.json');

// Standardized Operator Mapping
const OPERATOR_MAP = {
  '02': 'Airtel',
  '2': 'Airtel',
  'AIRTEL': 'Airtel',
  'BHARTI AIRTEL': 'Airtel',
  '01': 'Jio',
  '1': 'Jio',
  '11': 'Jio',
  '18': 'Jio',
  'JIO': 'Jio',
  'RELIANCE JIO': 'Jio',
  'RELIANCE JIO INFOCOMM LIMITED': 'Jio',
  '06': 'VI',
  '6': 'VI',
  '03': 'VI',
  '3': 'VI',
  'IDEA': 'VI',
  'VODAFONE': 'VI',
  'VI': 'VI',
  'VODAFONE IDEA': 'VI',
  '04': 'BSNL',
  '4': 'BSNL',
  '05': 'BSNL',
  '5': 'BSNL',
  'BSNL': 'BSNL',
  'BSNL TOPUP': 'BSNL',
  'BSNL SPECIAL': 'BSNL'
};

// Standardized Circle Mapping
const CIRCLE_MAP = {
  '10': 'DELHI',
  'DELHI': 'DELHI',
  '97': 'UP(West)',
  'UP WEST': 'UP(West)',
  '02': 'PUNJAB',
  'PUNJAB': 'PUNJAB',
  '03': 'HP',
  'HIMACHAL PRADESH': 'HP',
  '96': 'HARYANA',
  'HARYANA': 'HARYANA',
  '55': 'J&K',
  'JAMMU & KASHMIR': 'J&K',
  '54': 'UP(East)',
  'UP EAST': 'UP(East)',
  '92': 'MUMBAI',
  'MUMBAI': 'MUMBAI',
  '90': 'MAHARASHTRA',
  'MAHARASHTRA': 'MAHARASHTRA',
  '98': 'GUJARAT',
  'GUJARAT': 'GUJARAT',
  '93': 'MP',
  'MADHYA PRADESH': 'MP',
  '70': 'RAJASTHAN',
  'RAJASTHAN': 'RAJASTHAN',
  '31': 'KOLKATTA',
  'KOLKATA': 'KOLKATTA',
  '51': 'West Bengal',
  'WEST BENGAL': 'West Bengal',
  '53': 'ORISSA',
  'ODISHA': 'ORISSA',
  '56': 'ASSAM',
  'ASSAM': 'ASSAM',
  '16': 'NESA',
  'NORTH EAST': 'NESA',
  '52': 'BIHAR',
  'BIHAR': 'BIHAR',
  'BIHAR & JHARKHAND': 'BIHAR',
  '06': 'KARNATAKA',
  'KARNATAKA': 'KARNATAKA',
  '40': 'CHENNAI',
  'CHENNAI': 'CHENNAI',
  '94': 'TAMIL NADU',
  'TAMIL NADU': 'TAMIL NADU',
  '95': 'KERALA',
  'KERALA': 'KERALA',
  '49': 'AP',
  'ANDHRA PRADESH': 'AP',
  '99': 'SIKKIM',
  'SIKKIM': 'SIKKIM'
};

const OPERATORS_LIST = [
  { opCode: '2', name: 'Airtel', slug: 'airtel' },
  { opCode: '11', name: 'Reliance Jio', slug: 'jio' },
  { opCode: '6', name: 'Vodafone Idea (VI)', slug: 'vi' },
  { opCode: '4', name: 'BSNL', slug: 'bsnl' }
];

const CIRCLES_LIST = [
  { circleCode: '70', name: 'Rajasthan' },
  { circleCode: '54', name: 'UP (East)' },
  { circleCode: '97', name: 'UP (West)' },
  { circleCode: '10', name: 'Delhi NCR' },
  { circleCode: '92', name: 'Mumbai' },
  { circleCode: '90', name: 'Maharashtra & Goa' },
  { circleCode: '52', name: 'Bihar & Jharkhand' },
  { circleCode: '98', name: 'Gujarat' },
  { circleCode: '93', name: 'Madhya Pradesh & CG' },
  { circleCode: '02', name: 'Punjab' },
  { circleCode: '96', name: 'Haryana' },
  { circleCode: '31', name: 'Kolkata' },
  { circleCode: '51', name: 'West Bengal' },
  { circleCode: '06', name: 'Karnataka' },
  { circleCode: '49', name: 'Andhra Pradesh & Telangana' },
  { circleCode: '94', name: 'Tamil Nadu' },
  { circleCode: '40', name: 'Chennai' },
  { circleCode: '95', name: 'Kerala' },
  { circleCode: '53', name: 'Odisha' },
  { circleCode: '56', name: 'Assam' },
  { circleCode: '16', name: 'North East' },
  { circleCode: '03', name: 'Himachal Pradesh' },
  { circleCode: '55', name: 'Jammu & Kashmir' }
];

// In-memory cache
let plansCache = null;

function getSeedPlans() {
  return {
    Airtel: {
      FULLTT: [
        { rs: 155, validity: "24 Days", desc: "Calls : Truly Unlimited | Data : 1GB Total | SMS : 300 | Free Hellotunes + Wynk Music", Type: "unlimited" },
        { rs: 179, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 2GB Total | SMS : 300 | Free Hellotunes", Type: "unlimited" },
        { rs: 199, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 3GB Total | SMS : 300 | Wynk Music Free", Type: "unlimited" },
        { rs: 239, validity: "24 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day | SMS : 100/Day | Unlimited 5G Data", Type: "unlimited" },
        { rs: 265, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day | SMS : 100/Day | Unlimited 5G Data eligible", Type: "unlimited" },
        { rs: 299, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Unlimited 5G Data + Apollo 24|7", Type: "unlimited" },
        { rs: 349, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Unlimited 5G + Disney+ Hotstar Mobile 3 Months", Type: "ott" },
        { rs: 359, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Unlimited 5G + Wynk Music", Type: "unlimited" },
        { rs: 399, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 3GB/Day | SMS : 100/Day | Unlimited 5G Data + Wynk", Type: "unlimited" },
        { rs: 479, validity: "56 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Unlimited 5G Data", Type: "unlimited" },
        { rs: 549, validity: "56 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Unlimited 5G Data + Apollo 24|7", Type: "unlimited" },
        { rs: 719, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Unlimited 5G Data eligible", Type: "unlimited" },
        { rs: 839, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Unlimited 5G + Airtel Xstream Play", Type: "unlimited" },
        { rs: 999, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 2.5GB/Day | SMS : 100/Day | Unlimited 5G + Amazon Prime Membership 84 Days", Type: "ott" },
        { rs: 1499, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 24GB Total | SMS : 3600 | Annual Validity Pack", Type: "annual" },
        { rs: 2999, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Unlimited 5G + Wynk + Apollo 24|7", Type: "annual" },
        { rs: 3599, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 2.5GB/Day | SMS : 100/Day | Unlimited 5G + Disney+ Hotstar 1 Year", Type: "annual_ott" }
      ],
      TOPUP: [
        { rs: 10, validity: "NA", desc: "Talktime : ₹7.47 to main account balance", Type: "talktime" },
        { rs: 20, validity: "NA", desc: "Talktime : ₹14.95 to main account balance", Type: "talktime" },
        { rs: 50, validity: "NA", desc: "Talktime : ₹39.37 to main account balance", Type: "talktime" },
        { rs: 100, validity: "NA", desc: "Talktime : ₹81.75 to main account balance", Type: "talktime" },
        { rs: 500, validity: "NA", desc: "Talktime : ₹423.73 to main account balance", Type: "talktime" },
        { rs: 1000, validity: "NA", desc: "Talktime : ₹847.46 to main account balance", Type: "talktime" },
        { rs: 5000, validity: "NA", desc: "Talktime : ₹4237.29 to main account balance", Type: "talktime" }
      ],
      DATA: [
        { rs: 19, validity: "1 Day", desc: "Data : 1GB High Speed 4G/5G Data Add-on", Type: "data" },
        { rs: 29, validity: "1 Day", desc: "Data : 2GB High Speed Data Add-on", Type: "data" },
        { rs: 49, validity: "1 Day", desc: "Data : Unlimited Data from 12 AM to 6 AM (Night Unlimited)", Type: "data" },
        { rs: 65, validity: "Existing Pack", desc: "Data : 4GB Data Add-on with existing validity", Type: "data" },
        { rs: 148, validity: "Existing Pack", desc: "Data : 15GB Data Add-on + Airtel Xstream Play 28 Days", Type: "data" },
        { rs: 181, validity: "30 Days", desc: "Data : 1GB/Day Data Pack for 30 Days (30GB Total)", Type: "data" },
        { rs: 301, validity: "Existing Pack", desc: "Data : 50GB Bulk Data Add-on with Wynk Music", Type: "data" }
      ],
      SMS: [
        { rs: 10, validity: "Existing Pack", desc: "100 National SMS pack", Type: "sms" }
      ],
      Romaing: [
        { rs: 649, validity: "1 Day", desc: "500 MB Data, 100 Mins (Incoming + Outgoing), 10 SMS (US, Europe, Gulf, etc.)", Type: "international roaming" },
        { rs: 2999, validity: "10 Days", desc: "5GB Data, 200 Mins (Incoming + Outgoing), 20 SMS (Global Coverage)", Type: "international roaming" },
        { rs: 3999, validity: "30 Days", desc: "12GB Data, 500 Mins (Incoming + Outgoing), 100 SMS (180+ Countries)", Type: "international roaming" }
      ],
      FRC: [
        { rs: 299, validity: "28 Days", desc: "First Recharge Coupon: Truly Unlimited Calls + 1.5GB/Day + 100 SMS/Day", Type: "smart" }
      ],
      STV: [
        { rs: 18, validity: "28 Days", desc: "Discounted ISD calling rates to USA, UK, UAE, Canada", Type: "smart" }
      ]
    },

    Jio: {
      FULLTT: [
        { rs: 149, validity: "20 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day (20GB Total) | SMS : 100/Day | JioTV, JioCinema", Type: "unlimited" },
        { rs: 179, validity: "24 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day (24GB Total) | SMS : 100/Day | Jio Suite", Type: "unlimited" },
        { rs: 199, validity: "23 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day (34.5GB Total) | SMS : 100/Day | Unlimited 5G", Type: "unlimited" },
        { rs: 209, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day (28GB Total) | SMS : 100/Day", Type: "unlimited" },
        { rs: 239, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day (42GB Total) | SMS : 100/Day | Unlimited True 5G", Type: "unlimited" },
        { rs: 299, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day (56GB Total) | SMS : 100/Day | Unlimited True 5G", Type: "unlimited" },
        { rs: 349, validity: "30 Days", desc: "Calls : Truly Unlimited | Data : 2.5GB/Day | SMS : 100/Day | Unlimited True 5G Data", Type: "unlimited" },
        { rs: 399, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 3GB/Day (84GB Total) | SMS : 100/Day | Unlimited 5G Data + JioTV", Type: "unlimited" },
        { rs: 479, validity: "56 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day (84GB Total) | SMS : 100/Day | Unlimited True 5G", Type: "unlimited" },
        { rs: 533, validity: "56 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day (112GB Total) | SMS : 100/Day | Unlimited True 5G", Type: "unlimited" },
        { rs: 666, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day (126GB Total) | SMS : 100/Day | Unlimited True 5G", Type: "unlimited" },
        { rs: 719, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day (168GB Total) | SMS : 100/Day | Unlimited True 5G Data", Type: "unlimited" },
        { rs: 999, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 3GB/Day (252GB Total) | SMS : 100/Day | Hero 5G Pack", Type: "unlimited" },
        { rs: 1499, validity: "336 Days", desc: "Calls : Truly Unlimited | Data : 24GB Total | SMS : 3600 | Jio Security & Cloud", Type: "annual" },
        { rs: 2999, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 2.5GB/Day (912.5GB Total) | SMS : 100/Day | Unlimited True 5G Annual", Type: "annual" }
      ],
      TOPUP: [
        { rs: 10, validity: "NA", desc: "Talktime : ₹7.47 main balance", Type: "talktime" },
        { rs: 20, validity: "NA", desc: "Talktime : ₹14.95 main balance", Type: "talktime" },
        { rs: 50, validity: "NA", desc: "Talktime : ₹39.37 main balance", Type: "talktime" },
        { rs: 100, validity: "NA", desc: "Talktime : ₹81.75 main balance", Type: "talktime" },
        { rs: 500, validity: "NA", desc: "Talktime : ₹423.73 main balance", Type: "talktime" },
        { rs: 1000, validity: "NA", desc: "Talktime : ₹847.46 main balance", Type: "talktime" }
      ],
      DATA: [
        { rs: 15, validity: "Base Pack", desc: "Data : 1GB High Speed 4G/5G Data Add-on", Type: "data" },
        { rs: 25, validity: "Base Pack", desc: "Data : 2GB High Speed Data Add-on", Type: "data" },
        { rs: 61, validity: "Base Pack", desc: "Data : 6GB 5G Upgrade Pack for unlimited 5G", Type: "data" },
        { rs: 121, validity: "Base Pack", desc: "Data : 12GB High Speed Data Voucher", Type: "data" },
        { rs: 222, validity: "Base Pack", desc: "Data : 50GB Football / Cricket Special Data Booster", Type: "data" }
      ],
      SMS: null,
      Romaing: [
        { rs: 1101, validity: "28 Days", desc: "International Roaming Standard Pay-As-You-Go IR Pack with ₹933.05 Talktime", Type: "international roaming" },
        { rs: 2875, validity: "7 Days", desc: "Unlimited Incoming + 100 Mins Outgoing + 250MB/Day Data for 7 Days (Global)", Type: "international roaming" }
      ],
      FRC: [],
      STV: [
        { rs: 501, validity: "28 Days", desc: "ISD calling pack with ₹424.58 talktime and 50MB data", Type: "smart" }
      ]
    },

    VI: {
      FULLTT: [
        { rs: 155, validity: "24 Days", desc: "Calls : Truly Unlimited | Data : 1GB Total | SMS : 300 | VI Movies & TV", Type: "unlimited" },
        { rs: 179, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 2GB Total | SMS : 300 | VI Movies & TV Basic", Type: "unlimited" },
        { rs: 199, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 3GB Total | SMS : 300", Type: "unlimited" },
        { rs: 239, validity: "24 Days", desc: "Calls : Truly Unlimited | Data : 1GB/Day | SMS : 100/Day | VI Hero Binge All Night (12AM-6AM Free Data)", Type: "unlimited" },
        { rs: 299, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Binge All Night + Weekend Data Rollover", Type: "unlimited" },
        { rs: 359, validity: "28 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Binge All Night + Weekend Rollover + Data Delight 2GB", Type: "unlimited" },
        { rs: 479, validity: "56 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Binge All Night (12 AM - 6 AM Unlimited)", Type: "unlimited" },
        { rs: 719, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Binge All Night + Weekend Rollover", Type: "unlimited" },
        { rs: 839, validity: "84 Days", desc: "Calls : Truly Unlimited | Data : 2GB/Day | SMS : 100/Day | Disney+ Hotstar 3 Months + Binge All Night", Type: "ott" },
        { rs: 1799, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 24GB Total | SMS : 3600 | Annual Validity Saver", Type: "annual" },
        { rs: 2899, validity: "365 Days", desc: "Calls : Truly Unlimited | Data : 1.5GB/Day | SMS : 100/Day | Binge All Night + Weekend Data Rollover 365 Days", Type: "annual" }
      ],
      TOPUP: [
        { rs: 10, validity: "NA", desc: "Talktime : ₹7.47", Type: "talktime" },
        { rs: 20, validity: "NA", desc: "Talktime : ₹14.95", Type: "talktime" },
        { rs: 50, validity: "NA", desc: "Talktime : ₹39.37", Type: "talktime" },
        { rs: 100, validity: "NA", desc: "Talktime : ₹81.75", Type: "talktime" },
        { rs: 500, validity: "NA", desc: "Talktime : ₹423.73", Type: "talktime" },
        { rs: 1000, validity: "NA", desc: "Talktime : ₹847.46", Type: "talktime" }
      ],
      DATA: [
        { rs: 19, validity: "1 Day", desc: "Data : 1GB Data for 24 Hours", Type: "data" },
        { rs: 24, validity: "1 Hour", desc: "Data : Unlimited Data for 1 Hour SuperHour", Type: "data" },
        { rs: 39, validity: "3 Days", desc: "Data : 3GB High Speed Data Pack", Type: "data" },
        { rs: 75, validity: "7 Days", desc: "Data : 6GB Data Pack", Type: "data" },
        { rs: 118, validity: "28 Days", desc: "Data : 12GB Data Add-on", Type: "data" }
      ],
      SMS: null,
      Romaing: [
        { rs: 599, validity: "1 Day", desc: "International Roaming 500MB Data + 100 Mins (Incoming/Outgoing) + 10 SMS", Type: "international roaming" }
      ],
      FRC: [],
      STV: []
    },

    BSNL: {
      FULLTT: [
        { rs: 107, validity: "35 Days", desc: "Calls : 200 Mins Free Calls | Data : 3GB Total | BSNL Default Tunes", Type: "validity" },
        { rs: 153, validity: "26 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 1GB/Day | SMS : 100/Day", Type: "unlimited" },
        { rs: 197, validity: "70 Days", desc: "Calls : Truly Unlimited (First 18 Days) | Data : 2GB/Day (First 18 Days) | 70 Days Validity", Type: "validity" },
        { rs: 199, validity: "30 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 2GB/Day | SMS : 100/Day", Type: "unlimited" },
        { rs: 249, validity: "45 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 2GB/Day | SMS : 100/Day", Type: "unlimited" },
        { rs: 397, validity: "150 Days", desc: "Calls : Truly Unlimited (First 30 Days) | Data : 2GB/Day (First 30 Days) | 150 Days Long Validity", Type: "validity" },
        { rs: 485, validity: "82 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 1.5GB/Day | SMS : 100/Day", Type: "unlimited" },
        { rs: 599, validity: "84 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 3GB/Day | SMS : 100/Day | Free Night Data (12 AM - 5 AM)", Type: "unlimited" },
        { rs: 797, validity: "300 Days", desc: "Calls : Truly Unlimited (First 60 Days) | Data : 2GB/Day (First 60 Days) | 300 Days Plan Extension", Type: "annual" },
        { rs: 1999, validity: "365 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 600GB High Speed Data | SMS : 100/Day | 365 Days Annual", Type: "annual" },
        { rs: 2399, validity: "395 Days", desc: "Calls : Truly Unlimited Local/STD | Data : 2GB/Day | SMS : 100/Day | 395 Days Super Annual Pack", Type: "annual" }
      ],
      TOPUP: [
        { rs: 10, validity: "NA", desc: "Talktime : ₹7.47 main account balance", Type: "talktime" },
        { rs: 20, validity: "NA", desc: "Talktime : ₹14.95 main account balance", Type: "talktime" },
        { rs: 50, validity: "NA", desc: "Talktime : ₹39.37 main account balance", Type: "talktime" },
        { rs: 100, validity: "NA", desc: "Talktime : ₹81.75 main account balance", Type: "talktime" },
        { rs: 220, validity: "NA", desc: "Full Talktime ₹220 offer", Type: "talktime" },
        { rs: 500, validity: "NA", desc: "Talktime : ₹423.73 main account balance", Type: "talktime" },
        { rs: 1100, validity: "NA", desc: "Full Talktime ₹1100 offer", Type: "talktime" }
      ],
      DATA: [
        { rs: 16, validity: "1 Day", desc: "Data : 2GB High Speed Data Mini Pack", Type: "data" },
        { rs: 94, validity: "30 Days", desc: "Data : 3GB Data + 200 Mins Calling Pack", Type: "data" },
        { rs: 98, validity: "22 Days", desc: "Data : 2GB/Day High Speed Data Pack (44GB Total)", Type: "data" },
        { rs: 151, validity: "28 Days", desc: "Data : 40GB Zing Work-From-Home Special Data Pack", Type: "data" }
      ],
      SMS: null,
      Romaing: [],
      FRC: [],
      STV: [
        { rs: 18, validity: "2 Days", desc: "Special Tariff Voucher: Unlimited On-Net calling for 2 days", Type: "smart" }
      ]
    }
  };
}

function loadPlansDb() {
  if (plansCache) return plansCache;
  try {
    if (fs.existsSync(PLANS_DB_PATH)) {
      const data = fs.readFileSync(PLANS_DB_PATH, 'utf8');
      plansCache = JSON.parse(data);
      return plansCache;
    }
  } catch (e) {
    console.error('Error reading mobile_plans.json:', e);
  }

  // Seed default database
  plansCache = getSeedPlans();
  try {
    const dir = path.dirname(PLANS_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PLANS_DB_PATH, JSON.stringify(plansCache, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving seeded mobile_plans.json:', err);
  }
  return plansCache;
}

/**
 * Fetch plans by Operator Code and Circle Code
 * Supports exact PlanAPI param codes or names
 */
function fetchOperatorPlans(opKey, circleKey) {
  const db = loadPlansDb();

  const normalizedOp = OPERATOR_MAP[String(opKey).toUpperCase()] || OPERATOR_MAP[String(opKey)] || 'Airtel';
  const normalizedCircle = CIRCLE_MAP[String(circleKey).toUpperCase()] || CIRCLE_MAP[String(circleKey)] || 'RAJASTHAN';

  const operatorPlans = db[normalizedOp] || db['Airtel'];

  return {
    operator: normalizedOp,
    circle: normalizedCircle,
    plans: operatorPlans
  };
}

module.exports = {
  fetchOperatorPlans,
  OPERATORS_LIST,
  CIRCLES_LIST,
  OPERATOR_MAP,
  CIRCLE_MAP
};
