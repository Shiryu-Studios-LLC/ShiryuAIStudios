#!/usr/bin/env bash
# Shiryu AI Studio - Rebrand Script
# Run this after cloning to apply all branding changes
# Usage: bash scripts/rebrand.sh

set -e

echo "=== Shiryu AI Studio Rebrand Script ==="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if we're in the right directory
if [ ! -f "product.json" ] || [ ! -f "package.json" ]; then
    echo "Error: Must run from the root of the ShiryuAIStudios repository"
    exit 1
fi

echo -e "${GREEN}[1/5]${NC} Updating product.json..."
# product.json is already rewritten in the repo

echo -e "${GREEN}[2/5]${NC} Updating package.json..."
# package.json is already rewritten in the repo

echo -e "${GREEN}[3/5]${NC} Updating build/lib/electron.ts..."
if [ -f "build/lib/electron.ts" ]; then
    sed -i "s/Microsoft Corporation/Shiryu Studios LLC/g" build/lib/electron.ts
    sed -i "s/Visual Studio Code/Shiryu AI Studio/g" build/lib/electron.ts
    sed -i "s/VS Code HelpBook/Shiryu AI Studio HelpBook/g" build/lib/electron.ts
fi

echo -e "${GREEN}[4/5]${NC} Updating Linux packaging..."
if [ -d "resources/linux" ]; then
    sed -i "s/Visual Studio Code/Shiryu AI Studio/g" resources/linux/code.appdata.xml 2>/dev/null || true
    sed -i "s/code-oss/shiryu-ai-studio/g" resources/linux/debian/postinst.template 2>/dev/null || true
    sed -i "s/Microsoft Corporation/Shiryu Studios LLC/g" resources/linux/debian/control.template 2>/dev/null || true
    sed -i "s/Visual Studio Code/Shiryu AI Studio/g" resources/linux/rpm/code.spec.template 2>/dev/null || true
fi

echo -e "${GREEN}[5/5]${NC} Updating Windows installer..."
if [ -f "build/win32/code.iss" ]; then
    sed -i "s/Microsoft Corporation/Shiryu Studios LLC/g" build/win32/code.iss
    sed -i "s/Visual Studio Code/Shiryu AI Studio/g" build/win32/code.iss
fi

echo ""
echo -e "${GREEN}Rebrand complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Design logo assets (resources/darwin/shiryu-ai-studio.icns, resources/win32/shiryu-ai-studio.ico, resources/linux/shiryu-ai-studio.png)"
echo "  2. Run 'npm install' to install dependencies including node-llama-cpp"
echo "  3. Run 'npm run compile' to build"
echo ""
