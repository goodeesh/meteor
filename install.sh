#!/bin/bash

# Meteor 2.12 ARM64 Installation Script for Ubuntu 24.04
# This script automates the installation of dependencies and builds Meteor

set -e  # Exit on any error

# Parse command line arguments
FORCE_REBUILD=false
if [ "$1" = "--force-rebuild" ] || [ "$1" = "-f" ]; then
    FORCE_REBUILD=true
    echo "🔄 Force rebuild requested"
fi

echo "🚀 Meteor 2.12 ARM64 Installation Script for Ubuntu 24.04"
echo "============================================================="

# Check if running on ARM64
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
    echo "❌ This script is designed for ARM64 systems. Detected: $ARCH"
    exit 1
fi

# Check if running on Ubuntu
if ! grep -q "Ubuntu" /etc/os-release; then
    echo "⚠️  Warning: This script is designed for Ubuntu. Proceeding anyway..."
fi

echo "✅ System check passed: $ARCH Ubuntu system detected"

# Step 1: Update system and install dependencies
echo ""
echo "📦 Installing system dependencies..."
sudo apt update
sudo apt install -y \
    build-essential \
    curl \
    git \
    python3 \
    python3-dev \
    python3-pip \
    libssl-dev \
    libffi-dev \
    wget \
    tar \
    gzip \
    libc6-dev \
    libstdc++6 \
    libgcc-s1 \
    libc6

echo "✅ System dependencies installed"

# Step 2: Install legacy OpenSSL library
echo ""
echo "🔐 Installing legacy OpenSSL 1.1.1 library..."
if [ -f "resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb" ]; then
    sudo dpkg -i resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb || {
        echo "📦 Fixing dependency issues..."
        sudo apt-get install -f -y
    }
    echo "✅ OpenSSL 1.1.1 library installed"
else
    echo "❌ Error: libssl1.1 package not found in resources/ directory"
    echo "Please make sure you're running this script from the meteor-aarch64 directory"
    exit 1
fi

# Step 3: Build development bundle
echo ""
echo "🔨 Checking Meteor development bundle..."

# Check if dev bundle tarball already exists and force rebuild is not requested
if [ -f "dev_bundle_Linux_aarch64_14.21.3.tar.gz" ] && [ "$FORCE_REBUILD" = false ]; then
    echo "✅ Development bundle already exists, skipping build"
    echo "   Use --force-rebuild or -f to rebuild anyway"
else
    if [ "$FORCE_REBUILD" = true ]; then
        echo "🔄 Force rebuilding development bundle..."
        # Remove existing bundle to ensure clean rebuild
        rm -f dev_bundle_Linux_aarch64_14.21.3.tar.gz
        rm -rf dev_bundle
    else
        echo "Building Meteor development bundle..."
    fi
    
    echo "This will take 15-30 minutes depending on your system..."
    echo "You can monitor progress in the terminal output."

    if [ ! -f "scripts/generate-dev-bundle.sh" ]; then
        echo "❌ Error: generate-dev-bundle.sh script not found"
        echo "Please make sure you're running this script from the meteor-aarch64 directory"
        exit 1
    fi

    chmod +x scripts/generate-dev-bundle.sh
    ./scripts/generate-dev-bundle.sh

    echo "✅ Development bundle built successfully"
fi

# Step 4: Install Meteor Development Bundle
echo ""
echo "🌟 Installing Meteor development bundle..."
echo "The meteor script will automatically detect and install the generated dev bundle."

# Check if dev bundle tarball exists
if [ ! -f "dev_bundle_Linux_aarch64_14.21.3.tar.gz" ]; then
    echo "❌ Error: Development bundle not found!"
    echo "Please run the build process first: ./scripts/generate-dev-bundle.sh"
    exit 1
fi

# Remove any existing dev_bundle to force fresh installation
if [ -d "dev_bundle" ]; then
    echo "🔄 Removing existing dev_bundle for fresh installation..."
    rm -rf dev_bundle
fi

# Run meteor to trigger automatic installation
chmod +x meteor
echo "🔧 Running meteor to install development bundle..."
./meteor --help > /dev/null 2>&1

# Verify installation
if [ -d "dev_bundle" ] && [ -f "dev_bundle/.bundle_version.txt" ]; then
    INSTALLED_VERSION=$(cat dev_bundle/.bundle_version.txt)
    echo "✅ Development bundle installed successfully (version: $INSTALLED_VERSION)"
else
    echo "❌ Development bundle installation failed!"
    exit 1
fi

echo ""
echo "🎉 Installation completed successfully!"
echo ""
echo "Usage:"
echo "  ./install.sh           - Install with existing dev bundle (if available)"
echo "  ./install.sh -f        - Force rebuild dev bundle"
echo "  ./install.sh --force-rebuild - Force rebuild dev bundle"
echo ""
echo "Next steps:"
echo "1. Add Meteor to your PATH (optional):"
echo "   echo 'export PATH=\"$(pwd):$PATH\"' >> ~/.bashrc"
echo "   source ~/.bashrc"
echo ""
echo "2. Create your first project:"
echo "   ./meteor create my-app"
echo "   cd my-app"
echo "   ../meteor run"
echo ""
echo "3. Access your app at: http://localhost:3000"
echo ""
echo "📖 For more information, see INSTALL_UBUNTU_24.04.md"
