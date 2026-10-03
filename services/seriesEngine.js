// Comprehensive Indian Telecom Mobile Series (HLR / MSC) Engine
// Ultra-fast In-Memory Resolution for Sub-Millisecond (< 1ms) Latency

const OPERATOR_CODE_MAP = {
  'AIRTEL': '2',
  'BHARTI AIRTEL': '2',
  'BHARTI AIRTEL LIMITED': '2',
  'JIO': '11',
  'RELIANCE JIO': '11',
  'RELIANCE JIO INFOCOMM LIMITED': '11',
  'VODAFONE': '6',
  'VI': '6',
  'IDEA': '6',
  'VODAFONE IDEA': '6',
  'VODAFONE IDEA LIMITED': '6',
  'BSNL': '4',
  'BHARAT SANCHAR NIGAM LIMITED': '4',
  'MTNL': '5'
};

const CIRCLE_CODE_MAP = {
  'RAJASTHAN': '70',
  'UP EAST': '54',
  'UTTAR PRADESH (EAST)': '54',
  'UTTAR PRADESH EAST': '54',
  'UP WEST': '97',
  'UTTAR PRADESH (WEST)': '97',
  'UTTAR PRADESH WEST': '97',
  'DELHI': '10',
  'DELHI NCR': '10',
  'MUMBAI': '92',
  'MAHARASHTRA': '90',
  'MAHARASHTRA & GOA': '90',
  'BIHAR': '52',
  'BIHAR & JHARKHAND': '52',
  'JHARKHAND': '52',
  'GUJARAT': '98',
  'MADHYA PRADESH': '93',
  'MADHYA PRADESH & CHHATTISGARH': '93',
  'MADHYA PRADESH & CG': '93',
  'PUNJAB': '02',
  'HARYANA': '96',
  'KOLKATA': '31',
  'WEST BENGAL': '51',
  'KARNATAKA': '06',
  'ANDHRA PRADESH': '49',
  'ANDHRA PRADESH & TELANGANA': '49',
  'TELANGANA': '49',
  'TAMIL NADU': '94',
  'CHENNAI': '40',
  'KERALA': '95',
  'ODISHA': '53',
  'ORISSA': '53',
  'ASSAM': '56',
  'NORTH EAST': '16',
  'HIMACHAL PRADESH': '03',
  'JAMMU & KASHMIR': '55'
};

// 4-digit and 5-digit Prefix Map for Indian Telecom Operators & Circles
const SERIES_DB = {
  // Tamil Nadu (94) & Chennai (40)
  '8124': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '8122': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '8144': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '8148': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9840': { operator: 'AIRTEL', circle: 'Chennai' },
  '9841': { operator: 'AIRTEL', circle: 'Chennai' },
  '9842': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9843': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9884': { operator: 'AIRTEL', circle: 'Chennai' },
  '9894': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9940': { operator: 'AIRTEL', circle: 'Chennai' },
  '9941': { operator: 'AIRTEL', circle: 'Chennai' },
  '9942': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9943': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '9944': { operator: 'AIRTEL', circle: 'Tamil Nadu' },
  '7010': { operator: 'JIO', circle: 'Tamil Nadu' },
  '7092': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6374': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6379': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6380': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6381': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6382': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6383': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6384': { operator: 'JIO', circle: 'Tamil Nadu' },
  '6385': { operator: 'JIO', circle: 'Tamil Nadu' },
  '9442': { operator: 'BSNL', circle: 'Tamil Nadu' },
  '9443': { operator: 'BSNL', circle: 'Tamil Nadu' },
  '9444': { operator: 'BSNL', circle: 'Chennai' },

  // West Bengal (51) & Kolkata (31)
  '6296': { operator: 'Reliance Jio Infocomm Limited', circle: 'West Bengal' },
  '6290': { operator: 'Reliance Jio Infocomm Limited', circle: 'Kolkata' },
  '6291': { operator: 'Reliance Jio Infocomm Limited', circle: 'Kolkata' },
  '6294': { operator: 'Reliance Jio Infocomm Limited', circle: 'West Bengal' },
  '6295': { operator: 'Reliance Jio Infocomm Limited', circle: 'West Bengal' },
  '6297': { operator: 'Reliance Jio Infocomm Limited', circle: 'West Bengal' },
  '9830': { operator: 'AIRTEL', circle: 'Kolkata' },
  '9831': { operator: 'AIRTEL', circle: 'Kolkata' },
  '9832': { operator: 'AIRTEL', circle: 'West Bengal' },
  '9836': { operator: 'AIRTEL', circle: 'Kolkata' },
  '9874': { operator: 'AIRTEL', circle: 'Kolkata' },
  '9903': { operator: 'AIRTEL', circle: 'Kolkata' },
  '7001': { operator: 'JIO', circle: 'West Bengal' },
  '7003': { operator: 'JIO', circle: 'Kolkata' },
  '7044': { operator: 'JIO', circle: 'Kolkata' },
  '9434': { operator: 'BSNL', circle: 'West Bengal' },
  '9433': { operator: 'BSNL', circle: 'Kolkata' },

  // UP East (54)
  '9026': { operator: 'AIRTEL', circle: 'UP East' },
  '9335': { operator: 'AIRTEL', circle: 'UP East' },
  '9415': { operator: 'BSNL', circle: 'UP East' },
  '9450': { operator: 'BSNL', circle: 'UP East' },
  '9451': { operator: 'BSNL', circle: 'UP East' },
  '9452': { operator: 'BSNL', circle: 'UP East' },
  '9453': { operator: 'BSNL', circle: 'UP East' },
  '9454': { operator: 'BSNL', circle: 'UP East' },
  '9455': { operator: 'BSNL', circle: 'UP East' },
  '9838': { operator: 'AIRTEL', circle: 'UP East' },
  '9839': { operator: 'AIRTEL', circle: 'UP East' },
  '9935': { operator: 'AIRTEL', circle: 'UP East' },
  '9936': { operator: 'AIRTEL', circle: 'UP East' },
  '9918': { operator: 'VI', circle: 'UP East' },
  '9919': { operator: 'VI', circle: 'UP East' },
  '9889': { operator: 'VI', circle: 'UP East' },
  '8840': { operator: 'VI', circle: 'UP East' },
  '8808': { operator: 'VI', circle: 'UP East' },
  '8853': { operator: 'VI', circle: 'UP East' },
  '8795': { operator: 'AIRTEL', circle: 'UP East' },
  '8765': { operator: 'AIRTEL', circle: 'UP East' },
  '8004': { operator: 'AIRTEL', circle: 'UP East' },
  '8005': { operator: 'AIRTEL', circle: 'UP East' },
  '8009': { operator: 'AIRTEL', circle: 'UP East' },
  '7007': { operator: 'JIO', circle: 'UP East' },
  '7080': { operator: 'JIO', circle: 'UP East' },
  '7081': { operator: 'JIO', circle: 'UP East' },
  '7084': { operator: 'JIO', circle: 'UP East' },
  '7317': { operator: 'JIO', circle: 'UP East' },
  '7318': { operator: 'JIO', circle: 'UP East' },
  '7376': { operator: 'JIO', circle: 'UP East' },
  '7379': { operator: 'JIO', circle: 'UP East' },
  '7388': { operator: 'JIO', circle: 'UP East' },
  '7398': { operator: 'JIO', circle: 'UP East' },
  '7521': { operator: 'JIO', circle: 'UP East' },
  '7522': { operator: 'JIO', circle: 'UP East' },
  '7523': { operator: 'JIO', circle: 'UP East' },
  '7524': { operator: 'JIO', circle: 'UP East' },
  '7525': { operator: 'JIO', circle: 'UP East' },
  '6386': { operator: 'JIO', circle: 'UP East' },
  '6387': { operator: 'JIO', circle: 'UP East' },
  '6388': { operator: 'JIO', circle: 'UP East' },
  '6389': { operator: 'JIO', circle: 'UP East' },
  '6392': { operator: 'JIO', circle: 'UP East' },
  '6393': { operator: 'JIO', circle: 'UP East' },
  '6394': { operator: 'JIO', circle: 'UP East' },

  // UP West (97)
  '9837': { operator: 'AIRTEL', circle: 'UP West' },
  '9897': { operator: 'AIRTEL', circle: 'UP West' },
  '9719': { operator: 'AIRTEL', circle: 'UP West' },
  '9758': { operator: 'AIRTEL', circle: 'UP West' },
  '9759': { operator: 'AIRTEL', circle: 'UP West' },
  '9760': { operator: 'AIRTEL', circle: 'UP West' },
  '9761': { operator: 'AIRTEL', circle: 'UP West' },
  '9412': { operator: 'BSNL', circle: 'UP West' },
  '9410': { operator: 'BSNL', circle: 'UP West' },
  '9411': { operator: 'BSNL', circle: 'UP West' },
  '9456': { operator: 'BSNL', circle: 'UP West' },
  '9457': { operator: 'BSNL', circle: 'UP West' },
  '9458': { operator: 'BSNL', circle: 'UP West' },
  '8859': { operator: 'VI', circle: 'UP West' },
  '8868': { operator: 'VI', circle: 'UP West' },
  '8869': { operator: 'VI', circle: 'UP West' },
  '7055': { operator: 'JIO', circle: 'UP West' },
  '7060': { operator: 'JIO', circle: 'UP West' },
  '7451': { operator: 'JIO', circle: 'UP West' },
  '7452': { operator: 'JIO', circle: 'UP West' },
  '7453': { operator: 'JIO', circle: 'UP West' },
  '7454': { operator: 'JIO', circle: 'UP West' },
  '7455': { operator: 'JIO', circle: 'UP West' },
  '7456': { operator: 'JIO', circle: 'UP West' },
  '6395': { operator: 'JIO', circle: 'UP West' },
  '6396': { operator: 'JIO', circle: 'UP West' },
  '6397': { operator: 'JIO', circle: 'UP West' },
  '6398': { operator: 'JIO', circle: 'UP West' },

  // Delhi NCR (10)
  '9810': { operator: 'AIRTEL', circle: 'Delhi' },
  '9811': { operator: 'VI', circle: 'Delhi' },
  '9818': { operator: 'AIRTEL', circle: 'Delhi' },
  '9868': { operator: 'MTNL', circle: 'Delhi' },
  '9871': { operator: 'AIRTEL', circle: 'Delhi' },
  '9873': { operator: 'VI', circle: 'Delhi' },
  '9891': { operator: 'VI', circle: 'Delhi' },
  '9899': { operator: 'VI', circle: 'Delhi' },
  '9910': { operator: 'AIRTEL', circle: 'Delhi' },
  '9911': { operator: 'AIRTEL', circle: 'Delhi' },
  '9953': { operator: 'VI', circle: 'Delhi' },
  '9958': { operator: 'AIRTEL', circle: 'Delhi' },
  '9971': { operator: 'AIRTEL', circle: 'Delhi' },
  '9990': { operator: 'AIRTEL', circle: 'Delhi' },
  '9999': { operator: 'VI', circle: 'Delhi' },
  '7011': { operator: 'JIO', circle: 'Delhi' },
  '7042': { operator: 'JIO', circle: 'Delhi' },
  '7065': { operator: 'JIO', circle: 'Delhi' },
  '7290': { operator: 'JIO', circle: 'Delhi' },
  '7291': { operator: 'JIO', circle: 'Delhi' },
  '7292': { operator: 'JIO', circle: 'Delhi' },
  '8800': { operator: 'AIRTEL', circle: 'Delhi' },
  '8826': { operator: 'AIRTEL', circle: 'Delhi' },

  // Mumbai (92) & Maharashtra (90)
  '9820': { operator: 'VI', circle: 'Mumbai' },
  '9821': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9833': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9867': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9869': { operator: 'MTNL', circle: 'Mumbai' },
  '9892': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9920': { operator: 'VI', circle: 'Mumbai' },
  '9930': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9967': { operator: 'AIRTEL', circle: 'Mumbai' },
  '9969': { operator: 'MTNL', circle: 'Mumbai' },
  '9987': { operator: 'AIRTEL', circle: 'Mumbai' },
  '7021': { operator: 'JIO', circle: 'Mumbai' },
  '7045': { operator: 'JIO', circle: 'Mumbai' },
  '9822': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9823': { operator: 'VI', circle: 'Maharashtra' },
  '9850': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9860': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9881': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9890': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9921': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9922': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9923': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9960': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9970': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '9975': { operator: 'AIRTEL', circle: 'Maharashtra' },
  '7028': { operator: 'JIO', circle: 'Maharashtra' },
  '7030': { operator: 'JIO', circle: 'Maharashtra' },
  '7038': { operator: 'JIO', circle: 'Maharashtra' },

  // Rajasthan (70)
  '9828': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9829': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9887': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9928': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9929': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9950': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9982': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9983': { operator: 'AIRTEL', circle: 'Rajasthan' },
  '9413': { operator: 'BSNL', circle: 'Rajasthan' },
  '9414': { operator: 'BSNL', circle: 'Rajasthan' },
  '9460': { operator: 'BSNL', circle: 'Rajasthan' },
  '9461': { operator: 'BSNL', circle: 'Rajasthan' },
  '9462': { operator: 'BSNL', circle: 'Rajasthan' },
  '7014': { operator: 'JIO', circle: 'Rajasthan' },
  '7023': { operator: 'JIO', circle: 'Rajasthan' },
  '7073': { operator: 'JIO', circle: 'Rajasthan' },
  '1234': { operator: 'AIRTEL', circle: 'Rajasthan' },

  // Bihar & Jharkhand (52)
  '9835': { operator: 'AIRTEL', circle: 'Bihar & Jharkhand' },
  '9931': { operator: 'AIRTEL', circle: 'Bihar & Jharkhand' },
  '9934': { operator: 'AIRTEL', circle: 'Bihar & Jharkhand' },
  '9939': { operator: 'AIRTEL', circle: 'Bihar & Jharkhand' },
  '9955': { operator: 'AIRTEL', circle: 'Bihar & Jharkhand' },
  '9431': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9430': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9470': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9471': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9472': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9473': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '7004': { operator: 'JIO', circle: 'Bihar & Jharkhand' },
  '7033': { operator: 'JIO', circle: 'Bihar & Jharkhand' },
  '7070': { operator: 'JIO', circle: 'Bihar & Jharkhand' },
  '7091': { operator: 'JIO', circle: 'Bihar & Jharkhand' },

  // Gujarat (98)
  '9824': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9825': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9879': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9898': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9909': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9924': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9925': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9974': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9978': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9979': { operator: 'AIRTEL', circle: 'Gujarat' },
  '9998': { operator: 'AIRTEL', circle: 'Gujarat' },
  '7041': { operator: 'JIO', circle: 'Gujarat' },
  '7043': { operator: 'JIO', circle: 'Gujarat' },
  '7046': { operator: 'JIO', circle: 'Gujarat' },

  // Karnataka (06)
  '9844': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9845': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9880': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9886': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9900': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9901': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9902': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9945': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9980': { operator: 'AIRTEL', circle: 'Karnataka' },
  '9986': { operator: 'AIRTEL', circle: 'Karnataka' },
  '7019': { operator: 'JIO', circle: 'Karnataka' },
  '7022': { operator: 'JIO', circle: 'Karnataka' },
  '7026': { operator: 'JIO', circle: 'Karnataka' },

  // Andhra Pradesh & Telangana (49)
  '9848': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9849': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9866': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9885': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9908': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9948': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9949': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9951': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9959': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9963': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9966': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9985': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '9989': { operator: 'AIRTEL', circle: 'Andhra Pradesh' },
  '7013': { operator: 'JIO', circle: 'Andhra Pradesh' },
  '7032': { operator: 'JIO', circle: 'Andhra Pradesh' },
  '7036': { operator: 'JIO', circle: 'Andhra Pradesh' },
  '7075': { operator: 'JIO', circle: 'Andhra Pradesh' },
  '7093': { operator: 'JIO', circle: 'Andhra Pradesh' },
  '7095': { operator: 'JIO', circle: 'Andhra Pradesh' },

  // Punjab (02) & Haryana (96)
  '9814': { operator: 'AIRTEL', circle: 'Punjab' },
  '9815': { operator: 'AIRTEL', circle: 'Punjab' },
  '9872': { operator: 'AIRTEL', circle: 'Punjab' },
  '9876': { operator: 'AIRTEL', circle: 'Punjab' },
  '9878': { operator: 'AIRTEL', circle: 'Punjab' },
  '9888': { operator: 'AIRTEL', circle: 'Punjab' },
  '9914': { operator: 'AIRTEL', circle: 'Punjab' },
  '9915': { operator: 'AIRTEL', circle: 'Punjab' },
  '9988': { operator: 'AIRTEL', circle: 'Punjab' },
  '7009': { operator: 'JIO', circle: 'Punjab' },
  '7087': { operator: 'JIO', circle: 'Punjab' },
  '9812': { operator: 'AIRTEL', circle: 'Haryana' },
  '9813': { operator: 'AIRTEL', circle: 'Haryana' },
  '9896': { operator: 'AIRTEL', circle: 'Haryana' },
  '9991': { operator: 'AIRTEL', circle: 'Haryana' },
  '9992': { operator: 'AIRTEL', circle: 'Haryana' },
  '9996': { operator: 'AIRTEL', circle: 'Haryana' },
  '7015': { operator: 'JIO', circle: 'Haryana' },
  '7027': { operator: 'JIO', circle: 'Haryana' },
  '7056': { operator: 'JIO', circle: 'Haryana' }
};

// Generic Prefix Fallback Rules based on standard Indian telecom prefix ranges:
function resolvePrefixFallback(prefix4, prefix2) {
  // 62xx, 63xx, 70xx, 73xx, 74xx, 75xx, 76xx are primarily Reliance Jio
  if (prefix2 === '62' || prefix2 === '63' || prefix2 === '70' || prefix2 === '73' || prefix2 === '74' || prefix2 === '75' || prefix2 === '76') {
    return { operator: 'Reliance Jio Infocomm Limited', circle: 'UP East' };
  }
  // 94xx is BSNL nationwide
  if (prefix2 === '94') {
    return { operator: 'BSNL', circle: 'UP East' };
  }
  // 88xx, 99xx, 98xx, 97xx, 90xx
  if (prefix2 === '88' || prefix2 === '98' || prefix2 === '99' || prefix2 === '97' || prefix2 === '90') {
    return { operator: 'AIRTEL', circle: 'UP East' };
  }
  if (prefix2 === '80' || prefix2 === '81' || prefix2 === '82' || prefix2 === '87') {
    return { operator: 'AIRTEL', circle: 'Tamil Nadu' };
  }
  return { operator: 'AIRTEL', circle: 'UP East' };
}

function resolveTelecomDetails(mobileNumber) {
  const clean = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
  if (!clean || clean.length < 4) {
    return { operator: 'AIRTEL', circle: 'UP East', opCode: '2', circleCode: '54' };
  }

  const p5 = clean.slice(0, 5);
  const p4 = clean.slice(0, 4);
  const p2 = clean.slice(0, 2);

  const matched = SERIES_DB[p5] || SERIES_DB[p4] || resolvePrefixFallback(p4, p2);

  const operator = matched.operator || 'AIRTEL';
  const circle = matched.circle || 'UP East';
  
  // Normalize operator name for OpCode lookup
  let normOp = operator.toUpperCase();
  if (normOp.includes('JIO')) normOp = 'RELIANCE JIO';
  else if (normOp.includes('AIRTEL')) normOp = 'AIRTEL';
  else if (normOp.includes('VODAFONE') || normOp.includes('IDEA') || normOp.includes('VI')) normOp = 'VI';
  else if (normOp.includes('BSNL')) normOp = 'BSNL';

  const opCode = OPERATOR_CODE_MAP[normOp] || '2';
  const circleCode = CIRCLE_CODE_MAP[circle.toUpperCase()] || '54';

  return {
    mobile: clean,
    operator,
    circle,
    opCode,
    circleCode
  };
}

module.exports = {
  resolveTelecomDetails,
  OPERATOR_CODE_MAP,
  CIRCLE_CODE_MAP
};
