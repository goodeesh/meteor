# Installing Meteor 2.12 on Ubuntu 24.04 ARM64

This guide provides step-by-step instructions to install Meteor 2.12 on Ubuntu 24.04 ARM64 systems.

## Quick Installation (Automated)

For a fully automated installation, simply run:

```bash
git clone https://github.com/shivendoodeshmukh/meteor-aarch64.git
cd meteor-aarch64
./install.sh
```

The script will automatically handle all dependencies, build the development bundle, and verify the installation. This typically takes 15-30 minutes.

## Manual Installation (Step-by-Step)

If you prefer to understand each step or need to customize the installation, follow the manual steps below. These are the same steps that the automated script performs.

### Prerequisites

- Ubuntu 24.04 LTS (ARM64/aarch64)
- Internet connection for downloading dependencies
- Basic command line knowledge

## Manual Installation Steps

### Step 1: Install System Dependencies

```bash
# Update your system
sudo apt update && sudo apt upgrade -y

# Install essential build tools and dependencies
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
    gzip
```

### Step 2: Install Node.js Prerequisites

Meteor 2.12 requires specific Node.js dependencies that may not be available in Ubuntu 24.04 by default.

```bash
# Install Node.js build dependencies
sudo apt install -y \
    libc6-dev \
    libstdc++6 \
    libgcc-s1 \
    libc6
```

### Step 3: Install Legacy OpenSSL Library

Ubuntu 24.04 ships with OpenSSL 3.0, but Meteor 2.12 ARM64 build requires OpenSSL 1.1.1. We need to install the legacy library:

```bash
# Clone the meteor-aarch64 repository
git clone https://github.com/shivendoodeshmukh/meteor-aarch64.git
cd meteor-aarch64

# Install the legacy OpenSSL 1.1.1 library
sudo dpkg -i resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb

# If you get dependency issues, run:
sudo apt-get install -f
```

### Step 4: Build Meteor Development Bundle

```bash
# Make sure you're in the meteor-aarch64 directory
cd meteor-aarch64

# Generate the development bundle (this will take 15-30 minutes)
./scripts/generate-dev-bundle.sh
```

**Note:** The build process will:
- Download Node.js 14.21.3 for ARM64
- Download MongoDB 4.4.29 for ARM64  
- Compile native Node.js modules
- Package everything into a development bundle

### Step 5: Install Meteor Development Bundle

After the build completes, you'll have a `dev_bundle_Linux_aarch64_14.21.3.tar.gz` file. The Meteor script will automatically detect and install this:

```bash
# The first time you run meteor, it will automatically install the dev bundle
./meteor --help
```

**What happens during installation:**
1. Meteor detects the local `dev_bundle_Linux_aarch64_14.21.3.tar.gz` file
2. Extracts it to a temporary directory 
3. Removes any existing `dev_bundle` directory
4. Moves the extracted bundle to `dev_bundle/`
5. Creates version tracking file

You should see output like:
```
Skipping download and installing kit from /home/adria/meteor-aarch64/dev_bundle_Linux_aarch64_14.21.3.tar.gz
Installed dependency kit v14.21.3 in dev_bundle.
```

**Manual Installation (if needed):**
If you need to manually reinstall the dev bundle:

```bash
# Remove existing dev bundle
rm -rf dev_bundle

# Extract the tarball
tar -xzf dev_bundle_Linux_aarch64_14.21.3.tar.gz

# The extracted directory will be named 'dev_bundle'
ls -la dev_bundle/
```

### Step 6: Verify Installation

```bash
# Check Meteor version
./meteor --version

# Create a test project
./meteor create test-app
cd test-app

# Run the test project
../meteor run
```

If everything is working correctly, you should see:
```
=> Started proxy.
=> Started MongoDB.
=> Started your app.
=> App running at: http://localhost:3000/
```

### Adding to PATH (Optional)

To use `meteor` command globally, add it to your PATH:

```bash
# Add to your ~/.bashrc or ~/.zshrc
echo 'export PATH="/path/to/meteor-aarch64:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Now you can use meteor globally
meteor --version
```

## Troubleshooting

### MongoDB Connection Issues

If you see MongoDB hanging during startup:
- The build includes fixes for ARM64 MongoDB log format compatibility
- MongoDB should start automatically with proper replica set configuration

### OpenSSL Errors

If you encounter OpenSSL-related errors:
```bash
# Verify libssl1.1 is installed
dpkg -l | grep libssl1.1

# If missing, reinstall
sudo dpkg -i resources/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb
```

### Build Failures

If the development bundle build fails:
```bash
# Clean any partial builds
rm -rf dev_bundle dev_bundle_*.tar.gz

# Retry the build
./scripts/generate-dev-bundle.sh
```

### Reinstalling the Dev Bundle

If you need to reinstall or update the development bundle:

```bash
# Method 1: Let Meteor handle it automatically
rm -rf dev_bundle
./meteor --help  # This will reinstall from the tarball

# Method 2: Manual extraction
rm -rf dev_bundle
tar -xzf dev_bundle_Linux_aarch64_14.21.3.tar.gz

# Method 3: Force rebuild everything
rm -rf dev_bundle dev_bundle_*.tar.gz
./scripts/generate-dev-bundle.sh
```

### Corrupted Installation

If you suspect the dev bundle is corrupted:
```bash
# Check the bundle version
cat dev_bundle/.bundle_version.txt

# Should show: 14.21.3
# If missing or wrong, reinstall the bundle

# Verify Node.js works
./dev_bundle/bin/node --version
# Should show: v14.21.3
```

### Permission Issues

If you encounter permission errors:
```bash
# Make sure meteor script is executable
chmod +x meteor

# For build scripts
chmod +x scripts/generate-dev-bundle.sh
```

## Support

This build has been tested on:
- Ubuntu 24.04 LTS ARM64 in a WSL2 environment using a Snapdragon CPU in Windows on ARM
- Feel free to test on other ARM64 systems and report any issues.
