-- ====================================================================
-- PostgreSQL Production Schema for PlanAPI (Easy Recharge Solution)
-- ====================================================================

-- 1. System Settings
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY, -- e.g. USR_1712345678901
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) UNIQUE NOT NULL,
    api_token VARCHAR(100) UNIQUE NOT NULL, -- Legacy primary token (auto-synced to default client)
    total_hits INTEGER DEFAULT 100 CHECK (total_hits >= 0),
    used_hits INTEGER DEFAULT 0 CHECK (used_hits >= 0),
    remaining_hits INTEGER DEFAULT 100 CHECK (remaining_hits >= 0),
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Blocked', 'Suspended')),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 3. Multi-Application API Clients Table (One User -> Multiple Applications/Websites)
CREATE TABLE IF NOT EXISTS api_clients (
    id VARCHAR(50) PRIMARY KEY, -- e.g. CLI_1712345678901
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL, -- e.g. "Main Website", "Android App", "ERP System"
    api_token_hash VARCHAR(128) UNIQUE NOT NULL, -- SHA-256 hash of API token for secure storage
    api_token_preview VARCHAR(20) NOT NULL, -- e.g. "tok_a1b2...9f0"
    allowed_ips TEXT[] DEFAULT '{}', -- e.g. ARRAY['103.21.244.0/24', '1.2.3.4'] (Empty = unrestricted)
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked', 'Suspended')),
    last_used_at TIMESTAMP WITH TIME ZONE,
    last_used_ip VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_clients_user_id ON api_clients(user_id);
CREATE INDEX IF NOT EXISTS idx_api_clients_token_hash ON api_clients(api_token_hash);
CREATE INDEX IF NOT EXISTS idx_api_clients_status ON api_clients(status);

-- 4. Subscription / Recharge Plans
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY, -- e.g. PLAN_100
    name VARCHAR(255) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    hits INTEGER NOT NULL CHECK (hits > 0),
    validity_days INTEGER DEFAULT 30 CHECK (validity_days > 0),
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Payment Requests & Ledger
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(50) PRIMARY KEY, -- e.g. REQ_1712345678901
    user_mobile VARCHAR(20) NOT NULL,
    user_name VARCHAR(255),
    plan_id VARCHAR(50) REFERENCES plans(id) ON DELETE SET NULL,
    plan_name VARCHAR(255) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    hits INTEGER NOT NULL CHECK (hits > 0),
    utr_number VARCHAR(100) UNIQUE NOT NULL, -- Database level unique constraint to prevent replay attacks
    payment_date DATE,
    screenshot TEXT,
    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    approved_by VARCHAR(100),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    reject_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_mobile ON payments(user_mobile);
CREATE INDEX IF NOT EXISTS idx_payments_utr ON payments(utr_number);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 6. OTP Storage (Hashed & Expiry-Managed)
CREATE TABLE IF NOT EXISTS otp_codes (
    mobile VARCHAR(20) PRIMARY KEY,
    otp_hash VARCHAR(128) NOT NULL,
    attempts INTEGER DEFAULT 0 CHECK (attempts >= 0),
    user_name VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    resend_available_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Admin Users Table (Hashed passwords with salt)
CREATE TABLE IF NOT EXISTS admin_users (
    username VARCHAR(100) PRIMARY KEY,
    password_hash VARCHAR(256) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Operator & Series Mapping Cache
CREATE TABLE IF NOT EXISTS operator_cache (
    mobile_prefix VARCHAR(10) PRIMARY KEY,
    operator VARCHAR(100) NOT NULL,
    circle VARCHAR(100) NOT NULL,
    opcode VARCHAR(10),
    circlecode VARCHAR(10),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Mobile Plans Cache
CREATE TABLE IF NOT EXISTS mobile_plans_cache (
    cache_key VARCHAR(100) PRIMARY KEY, -- e.g. "airtel_UP East"
    operator VARCHAR(100) NOT NULL,
    circle VARCHAR(100) NOT NULL,
    plans_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. R-Offer Cache
CREATE TABLE IF NOT EXISTS roffer_cache (
    mobile VARCHAR(20) PRIMARY KEY,
    operator VARCHAR(100),
    offers_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Last Recharge Check Cache
CREATE TABLE IF NOT EXISTS recharge_cache (
    mobile VARCHAR(20) PRIMARY KEY,
    operator VARCHAR(100),
    recharge_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. DTH Info Cache
CREATE TABLE IF NOT EXISTS dth_cache (
    vc_number VARCHAR(50) PRIMARY KEY,
    operator_code VARCHAR(10),
    dth_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. EzyTM / PlanAPI Multi-Account Pool
CREATE TABLE IF NOT EXISTS ezytm_accounts (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(100) NOT NULL,
    label VARCHAR(255) DEFAULT 'EzyTM Account',
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Disabled')),
    total_requests INTEGER DEFAULT 0,
    success_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ezytm_accounts_status ON ezytm_accounts(status);

