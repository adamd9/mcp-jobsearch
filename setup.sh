#!/bin/bash
set -e

# install npm dependencies
npm install

# install browsers and chrome dependencies for playwright
npx playwright install --with-deps chromium
