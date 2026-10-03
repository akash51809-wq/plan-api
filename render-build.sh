#!/usr/bin/env bash
# Render Build Script for PlanAPI & Playwright Automation
set -o errexit

echo "📦 Installing project dependencies..."
npm install

echo "🌐 Installing Playwright Chromium browser binaries..."
npx playwright install chromium --with-deps || npx playwright install chromium

echo "✅ Build completed successfully!"
