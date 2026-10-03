-- PostgreSQL Schema for PlanAPI Platform
-- Easy Recharge Solution Database

-- 1. Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) UNIQUE NOT NULL,
    api_token VARCHAR(100) UNIQUE NOT NULL,
    total_hits INTEGER DEFAULT 100,
    used_hits INTEGER DEFAULT 0,
    remaining_hits INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast user lookup by mobile & API token
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);

-- 3. API Recharge / Subscription Plans
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    hits INTEGER NOT NULL,
    validity_days INTEGER NOT NULL,
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Payment Requests & Approvals
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_mobile VARCHAR(20) NOT NULL,
    user_name VARCHAR(255),
    plan_id INTEGER,
    plan_name VARCHAR(255),
    amount NUMERIC(10, 2) NOT NULL,
    utr_number VARCHAR(100) NOT NULL,
    screenshot TEXT,
    status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_mobile ON payments(user_mobile);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 5. Operator & Circle Series Cache
CREATE TABLE IF NOT EXISTS operator_cache (
    mobile_prefix VARCHAR(10) PRIMARY KEY,
    operator VARCHAR(100) NOT NULL,
    circle VARCHAR(100) NOT NULL,
    opcode VARCHAR(10),
    circlecode VARCHAR(10),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Mobile Plans Cache
CREATE TABLE IF NOT EXISTS mobile_plans_cache (
    cache_key VARCHAR(100) PRIMARY KEY, -- e.g. "airtel_UP East" or "1_51"
    operator VARCHAR(100) NOT NULL,
    circle VARCHAR(100) NOT NULL,
    plans_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. R-Offer Cache
CREATE TABLE IF NOT EXISTS roffer_cache (
    mobile VARCHAR(20) PRIMARY KEY,
    operator VARCHAR(100),
    offers_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Last Recharge Check Cache
CREATE TABLE IF NOT EXISTS recharge_cache (
    mobile VARCHAR(20) PRIMARY KEY,
    operator VARCHAR(100),
    recharge_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. DTH Info Cache
CREATE TABLE IF NOT EXISTS dth_cache (
    vc_number VARCHAR(50) PRIMARY KEY,
    operator_code VARCHAR(10),
    dth_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
