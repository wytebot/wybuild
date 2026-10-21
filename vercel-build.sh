#!/usr/bin/env bash
set -euo pipefail

# Vercel deployment entrypoint for WyBuild.
# Keep this script dependency-free so it works with Vercel's build image.
echo "Building WyBuild with Vite..."
npm run build
