/**
 * @module build-context
 * @description Functions for managing build context and module files for RSPack plugin
 */

const fs = require('fs');
const path = require('path');

const {
  logInfo,
  logSuccess,
  logError
} = require('meteor/tools-core/lib/log');

const {
  getMeteorAppDir,
  getMeteorAppEntrypoints,
  getMeteorInitialAppEntrypoints,
  isMeteorAppDevelopment,
  getMeteorAppPackages,
  addEnvSuffixToFilename
} = require('meteor/tools-core/lib/meteor');

const {
  getGlobalState,
  setGlobalState
} = require('meteor/tools-core/lib/global-state');

const {
  addGitignoreEntries
} = require('meteor/tools-core/lib/git');

const {
  RSPACK_BUILD_CONTEXT,
  RSPACK_ASSETS_CONTEXT,
  RSPACK_BUNDLES_CONTEXT,
  GLOBAL_STATE_KEYS
} = require('./constants');

/**
 * Gets entry points from Meteor configuration
 * Retrieves from global state if already stored, otherwise gets from Meteor
 * @returns {Object} Object containing entry points for client and server
 */
function getInitialEntrypoints() {
  const existingEntrypoint = getGlobalState(GLOBAL_STATE_KEYS.INITIAL_ENTRYPONTS);
  if (existingEntrypoint) return existingEntrypoint;
  const initialEntrypoints = getMeteorInitialAppEntrypoints();
  const hasInitialEntrypoints = initialEntrypoints && Object.values(initialEntrypoints).length > 0 && Object.values(initialEntrypoints).every((value) => value != null);
  if (hasInitialEntrypoints) {
    setGlobalState(GLOBAL_STATE_KEYS.INITIAL_ENTRYPONTS, initialEntrypoints);
  }
  return initialEntrypoints;
}

/**
 * Ensures the RSPack build context directory exists
 * Creates the directory if it doesn't exist and adds it to .gitignore
 * @returns {string} Path to the build context directory
 * @throws {Error} If directory creation fails
 */
function ensureRSPackBuildContextExists() {
  const appDir = getMeteorAppDir();
  const buildContextPath = path.join(appDir, RSPACK_BUILD_CONTEXT);

  if (!fs.existsSync(buildContextPath)) {
    try {
      fs.mkdirSync(buildContextPath, { recursive: true });
    } catch (error) {
      logError(`Failed to create RSPack build context directory: ${error.message}`);
      throw error;
    }
  }

  addGitignoreEntries(
    appDir,
    [
      RSPACK_BUILD_CONTEXT,
      `public/${RSPACK_BUNDLES_CONTEXT}`,
      `public/${RSPACK_ASSETS_CONTEXT}`,
      `private/${RSPACK_ASSETS_CONTEXT}`,
    ],
    'Meteor-RSPack build context directory',
  );

  return buildContextPath;
}

/**
 * Ensures module files exist in the build context directory
 * Creates default module files if they don't exist
 * @returns {void}
 */
function ensureModuleFilesExist() {
  const appDir = getMeteorAppDir();

  const moduleFiles = {
    'main-client.hmr.js': '// Main client entry point for RSPack to enable HMR\n',
    'main-client.js': '// Main client entry point for Meteor compiled by RSPack\n',
    'main-server.js': '// Main server entry point for Meteor compiled by RSPack\n',
    'test-client.js': '// Test client entry point for Meteor compiled by RSPack\n',
    'test-server.js': '// Test server entry point for Meteor compiled by RSPack\n',
  };

  Object.entries(moduleFiles).forEach(([filename, defaultContent]) => {
    // Add environment suffix for main client and server files
    const actualFilename = (['main-client.js', 'main-client.hmr.js', 'main-server.js'].includes(filename))
      ? addEnvSuffixToFilename(filename)
      : filename;

    const filePath = `${appDir}/${RSPACK_BUILD_CONTEXT}/${actualFilename}`;

    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, defaultContent, 'utf8');
      } catch (error) {
        logError(`Failed to create module file ${actualFilename}: ${error.message}`);
      }
    }
  });
}

/**
 * Writes custom content to the main-client.hmr.js entrypoint when in dev mode.
 * This helper function can be used to inject custom code into the client entry point.
 *
 * @returns {boolean} - True if the content was written successfully, false otherwise
 */
function writeMainClientEntryForHMR() {
  // Only write custom content in development mode
  if (!isMeteorAppDevelopment()) {
    return false;
  }

  const appDir = getMeteorAppDir();
  const filePath = `${appDir}/${RSPACK_BUILD_CONTEXT}/${addEnvSuffixToFilename('main-client.hmr.js')}`;

  try {
    // Ensure the file exists before writing to it
    if (!fs.existsSync(filePath)) {
      ensureModuleFilesExist();
    }
    // Write the custom content to the file
    fs.writeFileSync(filePath, `
// Main client entry point for RSPack to enable HMR

if (module.hot) {
  module.hot.accept();
}

import '../${getInitialEntrypoints().mainClient}'; 
`, 'utf8');
    return true;
  } catch (error) {
    logError(`Failed to write custom content to main-client.hmr.js: ${error.message}`);
    return false;
  }
}

module.exports = {
  getInitialEntrypoints,
  ensureRSPackBuildContextExists,
  ensureModuleFilesExist,
  writeMainClientEntryForHMR
};
