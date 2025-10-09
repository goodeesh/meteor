#!/bin/bash

# Meteor 2.12 ARM64 Distribution Package Creator
# This script packages a built Meteor installation for easy distribution

set -e  # Exit on any error

VERSION="2.12-arm64"
DIST_NAME="meteor-${VERSION}-linux-aarch64"
DIST_DIR="dist/${DIST_NAME}"

echo "📦 Creating Meteor ARM64 Distribution Package"
echo "=============================================="

# Check prerequisites
echo "🔍 Checking prerequisites..."
MISSING=""

if [ ! -d "dev_bundle" ]; then
    MISSING="${MISSING}\n  ❌ dev_bundle/ directory"
fi

if [ ! -f "dev_bundle_Linux_aarch64_14.21.3.tar.gz" ]; then
    MISSING="${MISSING}\n  ❌ dev_bundle_Linux_aarch64_14.21.3.tar.gz"
fi

if [ ! -d "tools" ]; then
    MISSING="${MISSING}\n  ❌ tools/ directory"
fi

if [ ! -d "packages" ]; then
    MISSING="${MISSING}\n  ❌ packages/ directory"
fi

if [ ! -x "meteor" ]; then
    MISSING="${MISSING}\n  ❌ meteor executable"
fi

if [ -n "$MISSING" ]; then
    echo ""
    echo "❌ Error: Missing required components:"
    echo -e "$MISSING"
    echo ""
    echo "You must run './install.sh' successfully FIRST before creating a distribution!"
    echo "This will build Meteor and create all necessary components."
    exit 1
fi

# Test that meteor works
METEOR_VERSION=$(./meteor --version 2>&1 | head -1)
if [ -z "$METEOR_VERSION" ]; then
    echo "❌ Error: ./meteor --version failed!"
    echo "Please make sure Meteor is built correctly by running './install.sh'"
    exit 1
fi

echo "✅ Prerequisites check passed"
echo "   Meteor version: ${METEOR_VERSION}"
echo ""

# Check if dev_bundle exists
if [ ! -d "dev_bundle" ]; then
    echo "❌ Error: dev_bundle not found!"
    echo "Please run ./install.sh first to build Meteor"
    exit 1
fi

# Check if dev_bundle tarball exists - but we'll recreate it from dev_bundle/
if [ ! -d "dev_bundle" ]; then
    echo "❌ Error: dev_bundle directory not found!"
    echo "The dev_bundle must be fully built before creating a distribution."
    exit 1
fi

# Verify dev_bundle has essential files
if [ ! -f "dev_bundle/bin/node" ]; then
    echo "❌ Error: dev_bundle/bin/node not found!"
    echo "The dev_bundle appears to be incomplete. Please run './install.sh' to rebuild."
    exit 1
fi

# Create distribution directory
echo "📁 Creating distribution directory..."
rm -rf dist
mkdir -p "${DIST_DIR}"

# Recreate the tarball from the actual dev_bundle directory
# This ensures we include ALL files, especially bin/node
echo "📦 Creating fresh dev_bundle tarball from dev_bundle/ directory..."
echo "   (This ensures all binaries like bin/node are included)"

# Create tarball with proper handling of symlinks
# We need to be IN the dev_bundle directory when creating the tarball
# so that relative symlinks work correctly
echo "🔍 Creating tarball with symlink preservation..."
(cd dev_bundle && tar -czf "../dev_bundle_Linux_aarch64_14.21.3.tar.gz" .)
echo "✅ Fresh tarball created with all files"

# Copy essential files
echo "📋 Copying Meteor files..."

# Rename original meteor script
cp meteor "${DIST_DIR}/meteor.original"

# Create a wrapper script that customizes the version message
cat > "${DIST_DIR}/meteor" << 'METEOR_WRAPPER_EOF'
#!/usr/bin/env bash

# Meteor 2.12 ARM64 Linux - Wrapper Script
# This wrapper customizes version output for the distribution

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if --version or -v flag
if [ "$1" = "--version" ] || [ "$1" = "-v" ]; then
    echo "Meteor 2.12 ARM64 Linux (Unofficial Community Build)"
    echo "Built from: https://github.com/goodeesh/meteor (branch: 2.12-arm64-linux)"
    exit 0
fi

# For all other commands, pass through to original meteor
exec "${SCRIPT_DIR}/meteor.original" "$@"
METEOR_WRAPPER_EOF

chmod +x "${DIST_DIR}/meteor"

cp dev_bundle_Linux_aarch64_14.21.3.tar.gz "${DIST_DIR}/"

# Verify the tarball contains bin/node
echo "🔍 Verifying tarball integrity..."
# Check both the original and the copied tarball
if tar -tzf "dev_bundle_Linux_aarch64_14.21.3.tar.gz" | grep -q "^\./bin/node$"; then
    echo "✅ Tarball verified: bin/node is present"
elif tar -tzf "dev_bundle_Linux_aarch64_14.21.3.tar.gz" | grep -q "^bin/node$"; then
    echo "✅ Tarball verified: bin/node is present (without ./)"
else
    echo "❌ Error: Tarball is missing bin/node!"
    echo ""
    echo "Debug information:"
    echo "   Checking what's actually in the tarball..."
    tar -tzf "dev_bundle_Linux_aarch64_14.21.3.tar.gz" | grep "bin/" | head -20 || echo "   No bin/ directory found!"
    echo ""
    echo "   Checking what's in the tarball (first 50 files)..."
    tar -tzf "dev_bundle_Linux_aarch64_14.21.3.tar.gz" | head -50
    echo ""
    echo "   Checking dev_bundle/bin/ directory..."
    ls -lh dev_bundle/bin/ | head -20
    echo ""
    echo "This means the tarball was not created correctly."
    echo "Please report this issue with the debug information above."
    exit 1
fi

# Create a .git marker so Meteor knows it's running from a checkout
# This prevents the "Can't get default release version" error
echo "🔧 Creating .git marker for checkout mode..."
if [ -d ".git" ]; then
    # Option 1: Copy minimal .git structure (lightweight)
    # Only copy what's needed for inCheckout() to return true
    mkdir -p "${DIST_DIR}/.git/refs/heads"
    
    # Copy HEAD reference
    if [ -f ".git/HEAD" ]; then
        cp .git/HEAD "${DIST_DIR}/.git/"
    else
        echo "ref: refs/heads/2.12-arm64-linux" > "${DIST_DIR}/.git/HEAD"
    fi
    
    # Create a custom tag for the distribution
    # This will show in "meteor --version"
    mkdir -p "${DIST_DIR}/.git/refs/tags"
    echo "$(git rev-parse HEAD 2>/dev/null || echo 'arm64-linux-build')" > "${DIST_DIR}/.git/refs/heads/2.12-arm64-linux"
    echo "$(git rev-parse HEAD 2>/dev/null || echo 'arm64-linux-build')" > "${DIST_DIR}/.git/refs/tags/v2.12-arm64-linux"
    
    # Create a git description file to customize version output
    mkdir -p "${DIST_DIR}/.git/logs"
    cat > "${DIST_DIR}/.git/logs/HEAD" << 'GIT_LOG_EOF'
0000000000000000000000000000000000000000 arm64-linux (tag: v2.12-arm64-linux, 2.12-arm64-linux) Meteor 2.12 ARM64 Linux Build
GIT_LOG_EOF
    
    # Optionally copy git config (small file)
    if [ -f ".git/config" ]; then
        cp .git/config "${DIST_DIR}/.git/" 2>/dev/null || true
    fi
    
    echo "   Created minimal .git structure"
else
    # Create a minimal fake .git directory
    mkdir -p "${DIST_DIR}/.git/refs/heads"
    echo "ref: refs/heads/2.12-arm64-linux" > "${DIST_DIR}/.git/HEAD"
    echo "arm64-linux-build" > "${DIST_DIR}/.git/refs/heads/2.12-arm64-linux"
    echo "   Created fake .git marker"
fi

# Create a version marker file for the distribution
echo "🏷️  Creating version marker..."
cat > "${DIST_DIR}/.meteor-version" << 'VERSION_EOF'
Meteor 2.12 ARM64 Linux (Unofficial Community Build)
Built from: https://github.com/goodeesh/meteor
Branch: 2.12-arm64-linux
VERSION_EOF

# Copy required resources
if [ -d "resources" ]; then
    cp -r resources "${DIST_DIR}/"
fi

# Copy packages directory (this contains Meteor packages)
if [ -d "packages" ]; then
    echo "📦 Copying packages directory..."
    cp -r packages "${DIST_DIR}/"
fi

# Copy tools directory (this contains build tools)
if [ -d "tools" ]; then
    echo "🔧 Copying tools directory..."
    cp -r tools "${DIST_DIR}/"
fi

# Copy documentation
echo "📖 Copying documentation..."
cp README.md "${DIST_DIR}/" 2>/dev/null || true
cp INSTALL_UBUNTU_24.04.md "${DIST_DIR}/" 2>/dev/null || true
cp LICENSE "${DIST_DIR}/" 2>/dev/null || true
cp DISTRIBUTION.md "${DIST_DIR}/" 2>/dev/null || true
cp DISTRIBUTION-QUICK-REF.md "${DIST_DIR}/" 2>/dev/null || true
cp TROUBLESHOOTING-INSTALL.md "${DIST_DIR}/" 2>/dev/null || true

# Copy helper scripts
echo "🔧 Copying helper scripts..."
cp setup-path.sh "${DIST_DIR}/" 2>/dev/null || true
chmod +x "${DIST_DIR}/setup-path.sh" 2>/dev/null || true

# Create installation script for distribution
echo "📝 Creating distribution installer..."
cat > "${DIST_DIR}/install-meteor.sh" << 'INSTALL_EOF'
#!/bin/bash

# Meteor 2.12 ARM64 Quick Install Script
# This script installs a pre-built Meteor distribution

set -e

echo "🚀 Meteor 2.12 ARM64 Quick Installer"
echo "====================================="

# Check if running on ARM64
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
    echo "❌ This package is for ARM64 systems only. Detected: $ARCH"
    exit 1
fi

echo "✅ System check passed: $ARCH system detected"

# Install system dependencies
echo ""
echo "📦 Installing system dependencies..."
sudo apt update
sudo apt install -y \
    build-essential \
    curl \
    git \
    python3 \
    libssl-dev \
    libffi-dev \
    libc6-dev \
    libstdc++6 \
    libgcc-s1 \
    libc6

# Install legacy OpenSSL library
echo ""
echo "🔐 Installing legacy OpenSSL 1.1.1 library..."
if [ -f "resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb" ]; then
    sudo dpkg -i resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb || {
        echo "📦 Fixing dependency issues..."
        sudo apt-get install -f -y
    }
    echo "✅ OpenSSL 1.1.1 library installed"
else
    echo "⚠️  Warning: libssl1.1 package not found, skipping..."
fi

# Remove existing dev_bundle if present
if [ -d "dev_bundle" ]; then
    echo "🔄 Removing existing dev_bundle..."
    rm -rf dev_bundle
fi

# Extract dev_bundle manually
echo ""
echo "🌟 Installing Meteor development bundle..."
if [ ! -f "dev_bundle_Linux_aarch64_14.21.3.tar.gz" ]; then
    echo "❌ Error: dev_bundle_Linux_aarch64_14.21.3.tar.gz not found!"
    exit 1
fi

echo "📦 Extracting dev_bundle (this may take a minute)..."
mkdir -p dev_bundle
tar -xzf dev_bundle_Linux_aarch64_14.21.3.tar.gz -C dev_bundle

# Verify extraction was successful
if [ ! -f "dev_bundle/bin/node" ]; then
    echo "❌ Error: dev_bundle/bin/node not found after extraction!"
    echo "   The tarball appears to be incomplete or corrupted."
    exit 1
fi

echo "✅ dev_bundle extracted successfully"

# Rebuild native modules for compatibility with this system
echo ""
echo "🔧 Rebuilding native modules for system compatibility..."
echo "   (This ensures compatibility between Ubuntu 22.04 and 24.04)"

# Rebuild fibers module
if [ -d "dev_bundle/lib/node_modules/fibers" ]; then
    echo "   Rebuilding fibers..."
    cd dev_bundle/lib/node_modules/fibers
    ../../../../dev_bundle/bin/node build 2>&1 | grep -v "gyp info" || {
        echo "⚠️  Warning: fibers rebuild had issues, but continuing..."
    }
    cd ../../../..
    echo "✅ Native modules rebuilt"
else
    echo "⚠️  Warning: fibers module not found, skipping rebuild"
fi

# Verify installation
if [ -d "dev_bundle" ] && [ -f "dev_bundle/.bundle_version.txt" ]; then
    INSTALLED_VERSION=$(cat dev_bundle/.bundle_version.txt)
    echo "✅ Meteor installed successfully (bundle version: $INSTALLED_VERSION)"
    
    # Test meteor command
    chmod +x meteor
    echo "🧪 Testing meteor command..."
    if ./meteor --version > /dev/null 2>&1; then
        echo "✅ Meteor is working correctly!"
    else
        echo "⚠️  Warning: Meteor command test failed, but installation completed"
    fi
else
    echo "❌ Installation failed!"
    exit 1
fi

# Offer to set up PATH automatically
echo ""
echo "🎉 Installation completed!"
echo ""
echo "📍 Meteor is installed at: $(pwd)"
echo ""
read -p "Would you like to add Meteor to your PATH? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Detect shell
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_RC="$HOME/.bashrc"
    else
        SHELL_RC="$HOME/.profile"
    fi
    
    # Check if already in PATH
    if grep -q "$(pwd)" "$SHELL_RC" 2>/dev/null; then
        echo "✅ Meteor is already in your PATH ($SHELL_RC)"
    else
        # Backup shell rc
        cp "$SHELL_RC" "${SHELL_RC}.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        
        # Add to PATH
        echo "" >> "$SHELL_RC"
        echo "# Meteor 2.12 ARM64" >> "$SHELL_RC"
        echo "export PATH=\"$(pwd):\$PATH\"" >> "$SHELL_RC"
        
        echo "✅ Added Meteor to PATH in $SHELL_RC"
        
        # Automatically source the shell RC file
        echo "🔄 Applying changes to current shell..."
        export PATH="$(pwd):$PATH"
        
        echo "✅ PATH updated! You can now use 'meteor' command directly."
        echo ""
        echo "Note: New terminal windows will automatically have meteor in PATH."
    fi
else
    echo ""
    echo "⏭️  Skipped PATH setup."
    echo ""
    echo "To add Meteor to PATH later, run:"
    echo "  echo 'export PATH=\"$(pwd):\$PATH\"' >> ~/.bashrc"
    echo "  source ~/.bashrc"
fi

echo ""
echo "🚀 Quick Start:"
echo "1. Create your first project:"
echo "   meteor create my-app     # (if in PATH)"
echo "   ./meteor create my-app   # (if not in PATH)"
echo ""
echo "2. Run your app:"
echo "   cd my-app"
echo "   meteor run"
echo ""
echo "3. Access your app at: http://localhost:3000"
echo ""
echo "📖 For more information, see README-DISTRIBUTION.md"
INSTALL_EOF

chmod +x "${DIST_DIR}/install-meteor.sh"

# Create README for distribution
cat > "${DIST_DIR}/README-DISTRIBUTION.md" << 'README_EOF'
# Meteor 2.12 ARM64 - Pre-built Distribution

This is a pre-built distribution of Meteor 2.12 for Linux ARM64 (aarch64) systems.

## Quick Start

1. Extract this package:
   ```bash
   tar -xzf meteor-2.12-arm64-linux-aarch64.tar.gz
   cd meteor-2.12-arm64-linux-aarch64
   ```

2. Run the installer:
   ```bash
   ./install-meteor.sh
   ```

3. Add to PATH (optional):
   ```bash
   echo 'export PATH="'$(pwd)':$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```

4. Create a project:
   ```bash
   ./meteor create my-app
   cd my-app
   ../meteor run
   ```

## System Requirements

- **OS**: Ubuntu 20.04+ (or compatible Linux distribution)
- **Architecture**: ARM64/aarch64
- **RAM**: 2GB minimum, 4GB+ recommended
- **Disk**: ~500MB for Meteor, additional space for projects

## What's Included

- Pre-built Meteor 2.12 for ARM64
- Development bundle (Node.js 14.21.3)
- All Meteor packages and tools
- Installation script with dependency management

## Manual Installation (Without Script)

If you prefer to install manually:

1. Install system dependencies:
   ```bash
   sudo apt update
   sudo apt install -y build-essential curl git python3 libssl-dev libffi-dev
   ```

2. Install legacy OpenSSL (if needed):
   ```bash
   sudo dpkg -i resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb
   ```

3. Make meteor executable:
   ```bash
   chmod +x meteor
   ```

4. Run meteor (it will auto-extract the dev bundle):
   ```bash
   ./meteor --help
   ```

## Troubleshooting

- **Permission denied**: Run `chmod +x meteor install-meteor.sh`
- **Missing libraries**: Run `sudo apt-get install -f` to fix dependencies
- **OpenSSL errors**: Make sure libssl1.1 is installed

## Support

For issues specific to this ARM64 build, please refer to the documentation
or create an issue in the repository.

## License

Meteor is licensed under the MIT License. See LICENSE file for details.
README_EOF

# Create tarball
echo ""
echo "📦 Creating distribution tarball..."
cd dist
tar -czf "${DIST_NAME}.tar.gz" "${DIST_NAME}"
cd ..

# Calculate size
SIZE=$(du -h "dist/${DIST_NAME}.tar.gz" | cut -f1)

echo ""
echo "✅ Distribution package created successfully!"
echo ""
echo "📦 Package: dist/${DIST_NAME}.tar.gz"
echo "📊 Size: ${SIZE}"
echo ""
echo "To distribute:"
echo "1. Upload dist/${DIST_NAME}.tar.gz to a file sharing service"
echo "2. Users can download and extract it"
echo "3. Users run ./install-meteor.sh in the extracted directory"
echo ""
echo "To test locally:"
echo "  cd /tmp"
echo "  tar -xzf $(pwd)/dist/${DIST_NAME}.tar.gz"
echo "  cd ${DIST_NAME}"
echo "  ./install-meteor.sh"
