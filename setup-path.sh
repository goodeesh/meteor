#!/bin/bash

# Quick setup script to add Meteor to PATH and create convenient aliases

METEOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_RC=""

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
else
    echo "⚠️  Unknown shell, please add manually to your PATH"
    exit 1
fi

echo "🌟 Meteor 2.12 ARM64 - PATH Setup"
echo "=================================="
echo ""
echo "This will add Meteor to your PATH in: $SHELL_RC"
echo "Meteor directory: $METEOR_DIR"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled"
    exit 0
fi

# Backup shell rc
cp "$SHELL_RC" "${SHELL_RC}.backup.$(date +%Y%m%d_%H%M%S)"

# Add to PATH
echo "" >> "$SHELL_RC"
echo "# Meteor 2.12 ARM64" >> "$SHELL_RC"
echo "export PATH=\"${METEOR_DIR}:\$PATH\"" >> "$SHELL_RC"

echo "✅ Added Meteor to PATH in $SHELL_RC"
echo ""
echo "To apply changes, run:"
echo "  source $SHELL_RC"
echo ""
echo "Or simply open a new terminal window"
echo ""
echo "Test with:"
echo "  meteor --version"
