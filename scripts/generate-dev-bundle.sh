#!/usr/bin/env bash

set -e
set -u

# Read the bundle version from the meteor shell script.
BUNDLE_VERSION=$(perl -ne 'print $1 if /BUNDLE_VERSION=(\S+)/' meteor)
if [ -z "$BUNDLE_VERSION" ]; then
    echo "BUNDLE_VERSION not found"
    exit 1
fi

source "$(dirname $0)/build-dev-bundle-common.sh"
echo CHECKOUT DIR IS "$CHECKOUT_DIR"
echo BUILDING DEV BUNDLE "$BUNDLE_VERSION" IN "$DIR"

cd "$DIR"

echo $(pwd)

extractNodeFromTarGz() {
    LOCAL_TGZ="${CHECKOUT_DIR}/node_${PLATFORM}_v${NODE_VERSION}.tar.gz"
    if [ -f "$LOCAL_TGZ" ]
    then
        echo "Skipping download and installing Node from $LOCAL_TGZ" >&2
        tar zxf "$LOCAL_TGZ"
        return 0
    fi
    return 1
}

downloadNodeFromS3() {
    test -n "${NODE_BUILD_NUMBER}" || return 1
    S3_HOST="s3.amazonaws.com/com.meteor.jenkins"
    S3_TGZ="node_${UNAME}_${ARCH}_v${NODE_VERSION}.tar.gz"
    NODE_URL="https://${S3_HOST}/dev-bundle-node-${NODE_BUILD_NUMBER}/${S3_TGZ}"
    echo "Downloading Node from ${NODE_URL}" >&2
    curl "${NODE_URL}" | tar zx --strip-components 1
}

# Nodejs 14 official download source has been discontinued, we are switching to our custom source https://static.meteor.com
downloadOfficialNode14() {
    METEOR_NODE_URL="https://static.meteor.com/dev-bundle-node-os/v${NODE_VERSION}/${NODE_TGZ}"
    echo "Downloading Node from ${METEOR_NODE_URL}" >&2
    curl "${METEOR_NODE_URL}" | tar zx --strip-components 1
}

downloadOfficialNode() {
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}"
    echo "Downloading Node from ${NODE_URL}" >&2
    curl "${NODE_URL}" | tar zx --strip-components 1
}

downloadReleaseCandidateNode() {
    NODE_URL="https://nodejs.org/download/rc/v${NODE_VERSION}/${NODE_TGZ}"
    echo "Downloading Node from ${NODE_URL}" >&2
    curl "${NODE_URL}" | tar zx --strip-components 1
}

# Try each strategy in the following order:
extractNodeFromTarGz || downloadNodeFromS3 || downloadOfficialNode

# Download Mongo from mongodb.com. Will download a 64-bit version of Mongo
# by default. Will download a 32-bit version of Mongo if using a 32-bit based
# OS.
if [ "$ARCH" == "aarch64" ] ; then
  MONGO_VERSION=$MONGO_VERSION_64BIT
  # Download official MongoDB Ubuntu aarch64 binaries
  MONGO_URL="https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2004-4.4.29.tgz"
  MONGO_NAME="mongodb-linux-aarch64-ubuntu2004-${MONGO_VERSION}"
  echo "Downloading Mongo from ${MONGO_URL}"
  curl -L "${MONGO_URL}" | tar zx
  echo $(pwd)
  echo $(ls)
else
  MONGO_VERSION=$MONGO_VERSION_64BIT
  if [ $ARCH = "i686" ]; then
    MONGO_VERSION=$MONGO_VERSION_32BIT
  fi
  MONGO_NAME="mongodb-${OS}-${ARCH}-ubuntu1804-${MONGO_VERSION}"
  MONGO_TGZ="${MONGO_NAME}.tgz"
  MONGO_URL="http://fastdl.mongodb.org/${OS}/${MONGO_TGZ}"
  echo "Downloading Mongo from ${MONGO_URL}"
  curl "${MONGO_URL}" | tar zx
fi

# Put Mongo binaries in the right spot (mongodb/bin)
mkdir -p "mongodb/bin"
mv "${MONGO_NAME}/bin/mongod" "mongodb/bin"
mv "${MONGO_NAME}/bin/mongo" "mongodb/bin"
echo ${MONGO_NAME}
rm -rf "${MONGO_NAME}"

# export path so we use the downloaded node and npm
export PATH="$DIR/bin:$PATH"

# Set environment variables to bypass SSL verification for corporate environments
export NODE_TLS_REJECT_UNAUTHORIZED=0
export npm_config_strict_ssl=false
export npm_config_registry=https://registry.npmjs.org/

cd "$DIR/lib"
# Use the NPM version that comes bundled with Node.js
# npm install "npm@$NPM_VERSION"

which node
which npm
npm version

# Comprehensive SSL and proxy bypass for corporate environments
npm config set strict-ssl false
npm config set registry https://registry.npmjs.org/
npm config set ca null
npm config set https-proxy null
npm config set proxy null

# Additional environment variables for SSL bypass
export NODE_TLS_REJECT_UNAUTHORIZED=0
export npm_config_strict_ssl=false

# Upgrade node-gyp to a version compatible with Python 3.9+ before any package installations
echo "Upgrading node-gyp for Python 3.9+ compatibility..."
cd "$DIR/lib/node_modules/npm"
npm install node-gyp@9.4.1 --no-save
# Also upgrade the node-gyp in npm-lifecycle if it exists
if [ -d "node_modules/npm-lifecycle/node_modules/node-gyp" ]; then
    cd "node_modules/npm-lifecycle"
    npm install node-gyp@9.4.1 --no-save
    cd "../.."
fi
cd "$DIR/lib"

# Make node-gyp use Node headers and libraries from $DIR/include/node.
echo $(ls)
echo $(ls include)
export HOME="$DIR"
export USERPROFILE="$DIR"
export npm_config_nodedir="$DIR"

# Workaround for Python 3.9+ compatibility with old node-gyp
export PYTHON=python3
export npm_config_python=python3
export GYP_MSVS_VERSION=2022

INCLUDE_PATH="${DIR}/include/node"
echo "Contents of ${INCLUDE_PATH}:"
ls -al "$INCLUDE_PATH"

# When adding new node modules (or any software) to the dev bundle,
# remember to update LICENSE.txt! Also note that we include all the
# packages that these depend on, so watch out for new dependencies when
# you update version numbers.

# First, we install the modules that are dependencies of tools/server/boot.js:
# the modules that users of 'meteor bundle' will also have to install. We save a
# shrinkwrap file with it, too.  We do this in a separate place from
# $DIR/server-lib/node_modules originally, because otherwise 'npm shrinkwrap'
# will get confused by the pre-existing modules.
mkdir "${DIR}/build/npm-server-install"
cd "${DIR}/build/npm-server-install"
node "${CHECKOUT_DIR}/scripts/dev-bundle-server-package.js" > package.json
# XXX For no apparent reason this npm install will fail with an EISDIR
# error if we do not help it by creating the .npm/_locks directory.
mkdir -p "${DIR}/.npm/_locks"
npm install
npm shrinkwrap

mkdir -p "${DIR}/server-lib/node_modules"
# This ignores the stuff in node_modules/.bin, but that's OK.
cp -R node_modules/* "${DIR}/server-lib/node_modules/"

mkdir -p "${DIR}/etc"
mv package.json npm-shrinkwrap.json "${DIR}/etc/"

# Now, install the npm modules which are the dependencies of the command-line
# tool.
mkdir "${DIR}/build/npm-tool-install"
cd "${DIR}/build/npm-tool-install"
node "${CHECKOUT_DIR}/scripts/dev-bundle-tool-package.js" >package.json
npm install
cp -R node_modules/* "${DIR}/lib/node_modules/"
# Also include node_modules/.bin, so that `meteor npm` can make use of
# commands like node-gyp and node-pre-gyp.
cp -R node_modules/.bin "${DIR}/lib/node_modules/"

cd "${DIR}/lib"

cd node_modules

## Clean up some bulky stuff.

# Used to delete bulky subtrees. It's an error (unlike with rm -rf) if they
# don't exist, because that might mean it moved somewhere else and we should
# update the delete line.
delete () {
    if [ ! -e "$1" ]; then
        echo "Missing (moved?): $1"
        exit 1
    fi
    rm -rf "$1"
}

# Since we install a patched version of pacote in $DIR/lib/node_modules,
# we need to remove npm's bundled version to make it use the new one.
if [ -d "pacote" ]
then
    delete npm/node_modules/pacote
    mv pacote npm/node_modules/
fi

delete sqlite3/deps
delete sqlite3/node_modules/node-pre-gyp
delete wordwrap/test
delete moment/min

# Remove esprima tests to reduce the size of the dev bundle
find . -path '*/esprima-fb/test' | xargs rm -rf

# Using the NPM version bundled with Node.js
INSTALLED_NPM_VERSION=$(cat "$DIR/lib/node_modules/npm/package.json" |
xargs -0 node -e "console.log(JSON.parse(process.argv[1]).version)")
echo "Using bundled NPM version: $INSTALLED_NPM_VERSION"

echo BUNDLING

cd "$DIR"
echo "${BUNDLE_VERSION}" > .bundle_version.txt
rm -rf build CHANGELOG.md ChangeLog LICENSE README.md .npm

tar czf "${CHECKOUT_DIR}/dev_bundle_${PLATFORM}_${BUNDLE_VERSION}.tar.gz" .

echo DONE
