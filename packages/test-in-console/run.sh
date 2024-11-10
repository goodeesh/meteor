#!/usr/bin/env bash

# from Meteor local checkout run like
# ./packages/test-in-console/run.sh
# or for a specific package
# ./packages/test-in-console/run.sh "mongo"

cd $(dirname $0)/../..
export METEOR_HOME=`pwd`

export PATH=$METEOR_HOME:$PATH

PUPPETEER_EXISTS=`node -e "try { require('./dev_bundle/lib/node_modules/puppeteer'); console.log('true'); } catch (e) { console.log('false'); }"`

whereis firefox
whereis chromium
whereis google-chrome
whereis chrome

if [ "$PUPPETEER_EXISTS" = "false" ]; then
  echo "Installing puppeteer..."
  # Installs into dev_bundle/lib/node_modules/puppeteer.
  PUPPETEER_PRODUCT=firefox ./meteor npm install -g puppeteer@23.6.0
  ./meteor npx -g puppeteer browsers install firefox
fi

export URL='http://localhost:4096/'
export METEOR_PACKAGE_DIRS='packages/deprecated'

echo "Starting test-in-console..."

# Replace the process substitution with direct execution and tee to see all output
if [ "$(uname)" = "Darwin" ]; then
  # On macOS, use script to unbuffer output
  ./meteor test-packages --driver-package test-in-console -p 4096 --exclude-archs=web.browser.legacy,web.cordova --exclude ${TEST_PACKAGES_EXCLUDE:-''} $1 | tee test.log &
else
  # On Linux, use stdbuf
  stdbuf -oL ./meteor test-packages --driver-package test-in-console -p 4096 --exclude-archs=web.browser.legacy,web.cordova --exclude ${TEST_PACKAGES_EXCLUDE:-''} $1 | tee test.log &
fi
METEOR_PID=$!

trap "pkill -TERM -P $METEOR_PID" EXIT

sleep 10

# Wait for the server to be ready
while ! grep --line-buffered -q "test-in-console listening" test.log; do
  sleep 1
done

curl $URL

echo "Starting puppeteer runner..."

node --trace-warnings "$METEOR_HOME/packages/test-in-console/puppeteer_runner.js"

STATUS=$?

pkill -TERM -P $METEOR_PID
exit $STATUS
