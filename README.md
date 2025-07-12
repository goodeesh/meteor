# Meteor 2.12 for ARM64 (Ubuntu 24.04)

A fully functional build of Meteor 2.12 for ARM64 systems, specifically tested on Ubuntu 24.04.

## Quick Start

### Automated Installation

```bash
git clone https://github.com/shivendoodeshmukh/meteor-aarch64.git
cd meteor-aarch64
./install.sh
```

### Manual Installation

See [INSTALL_UBUNTU_24.04.md](INSTALL_UBUNTU_24.04.md) for detailed step-by-step instructions.

## What's Included

- ✅ **Meteor 2.12** fully functional on ARM64
- ✅ **Node.js 14.21.3** compiled for ARM64
- ✅ **MongoDB 4.4.29** with ARM64 compatibility fixes
- ✅ **All native modules** properly compiled
- ✅ **OpenSSL 1.1.1** compatibility package
- ✅ **Enhanced MongoDB startup** with JSON log format support

## System Requirements

- Ubuntu 24.04 LTS (ARM64)
- 4GB+ RAM (8GB recommended)
- 2GB+ free disk space
- Internet connection for initial setup

## Key Features

### MongoDB ARM64 Fixes
This build includes critical fixes for MongoDB on ARM64:
- Enhanced log format detection (JSON vs text)
- Improved replica set initialization
- Timeout fallback mechanisms
- Proper port file handling

## Usage

```bash
# Create new project
./meteor create my-app

# Run project
cd my-app
../meteor run

# Access at http://localhost:3000
```

## Files Structure

```
meteor-aarch64/
├── install.sh                    # Automated installation script
├── INSTALL_UBUNTU_24.04.md      # Detailed installation guide
├── resources/
│   └── libssl1.1_*.deb          # OpenSSL 1.1.1 compatibility package
├── scripts/
│   └── generate-dev-bundle.sh   # Development bundle build script
├── meteor                       # Main Meteor executable
└── tools/                       # Meteor tools with ARM64 fixes
```

## Installation Time

- **First-time build**: Will take a while, depending on your system.

### Common Issues

1. **OpenSSL errors**: Ensure `libssl1.1` package is installed

### Getting Help

1. Check the detailed installation guide: [INSTALL_UBUNTU_24.04.md](INSTALL_UBUNTU_24.04.md)
2. Open an issue and I might look into it, but no guarantees.

## Technical Details

### What Was Fixed

1. **MongoDB Log Format**: Enhanced detection for JSON-formatted logs in MongoDB 4.4.29
2. **Replica Set Init**: Improved timeout and fallback mechanisms
3. **Type Conversion**: Fixed port number handling in MongoDB startup
4. **Dependencies**: Proper OpenSSL 1.1.1 compatibility

### Build Process

The build process:
1. Downloads Node.js 14.21.3 ARM64 binaries
2. Downloads MongoDB 4.4.29 ARM64 binaries
3. Compiles native Node.js modules (fibers, sqlite3, etc.)
4. Applies ARM64-specific patches
5. Packages everything into a development bundle

## License

Same as Meteor.js - MIT License

---

**Note**: This is an unofficial ARM64 build. For official x86_64 builds, use the standard Meteor installer.

---

## Original Meteor README

For the original Meteor documentation, see README_ORIGINAL.md.
