/**
 * @module build-context
 * @description Functions for managing build context and module files for RSPack plugin
 */

const fs = require('fs');
const path = require('path');

const { logError } = require('meteor/tools-core/lib/log');

const { capitalizeFirstLetter } = require('meteor/tools-core/lib/string');

const {
  getMeteorAppDir,
  getMeteorInitialAppEntrypoints,
  isMeteorAppDevelopment,
  addEnvSuffixToFilename,
  isMeteorAppRun,
  isMeteorAppBuild,
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
  GLOBAL_STATE_KEYS,
  FILE_ROLE,
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


  const env = isMeteorAppDevelopment() ? { isDevelopment: true } : { isProduction: true };
  const commandRole = isMeteorAppRun()
    ? { role: FILE_ROLE.run }
    : isMeteorAppBuild()
    ? { role: FILE_ROLE.build }
    : { role: FILE_ROLE.run };
  const initialEntrypoints = getInitialEntrypoints();
  console.log("--> (build-context.js-Line: 104)\n initialEntrypoints: ", initialEntrypoints);
  const mainClientFiles = {
    entryFile: initialEntrypoints.mainClient || '',
    outputFile: getBuildFilename({ isMain: true, isClient: true, ...env, role: FILE_ROLE.output })
  };
  const mainServerFiles = {
    entryFile: initialEntrypoints.mainServer || '',
    outputFile: getBuildFilename({ isMain: true, isServer: true, ...env, role: FILE_ROLE.output })
  };
  const testClientFiles = {
    entryFile: initialEntrypoints.testClient || '',
    outputFile: getBuildFilename({ isTest: true, isClient: true, role: FILE_ROLE.output })
  };
  const testServerFiles = {
    entryFile: initialEntrypoints.testServer || '',
    outputFile: getBuildFilename({ isTest: true, isServer: true, role: FILE_ROLE.output })
  };

  const moduleFiles = {
    /* Main module files for client and server */
    [getBuildFilename({ isMain: true, isClient: true, ...env, ...commandRole })]:
      getBuildFileContent({ isMain: true, isClient: true, ...env, ...commandRole, ...mainClientFiles }),
    [getBuildFilename({ isMain: true, isClient: true, ...env, role: FILE_ROLE.entry })]:
      getBuildFileContent({ isMain: true, isClient: true, ...env, role: FILE_ROLE.entry, ...mainClientFiles }),
    [getBuildFilename({ isMain: true, isClient: true, ...env, role: FILE_ROLE.output })]:
      getBuildFileContent({ isMain: true, isClient: true, ...env, role: FILE_ROLE.output, ...mainClientFiles }),
    [getBuildFilename({ isMain: true, isServer: true, ...env, ...commandRole })]:
      getBuildFileContent({ isMain: true, isServer: true, ...env, ...commandRole, ...mainServerFiles }),
    [getBuildFilename({ isMain: true, isServer: true, ...env, role: FILE_ROLE.entry })]:
      getBuildFileContent({ isMain: true, isServer: true, ...env, role: FILE_ROLE.entry, ...mainServerFiles }),
    [getBuildFilename({ isMain: true, isServer: true, ...env, role: FILE_ROLE.output })]:
      getBuildFileContent({ isMain: true, isServer: true, ...env, role: FILE_ROLE.output, ...mainServerFiles }),
    /* Test module files for client and server */
    [getBuildFilename({ isTest: true, isClient: true, ...commandRole })]:
      getBuildFileContent({ isTest: true, isClient: true, ...commandRole, ...testClientFiles }),
    [getBuildFilename({ isTest: true, isClient: true, role: FILE_ROLE.entry })]:
      getBuildFileContent({ isTest: true, isClient: true, role: FILE_ROLE.entry, ...testClientFiles }),
    [getBuildFilename({ isTest: true, isClient: true, role: FILE_ROLE.output })]:
      getBuildFileContent({ isTest: true, isClient: true, role: FILE_ROLE.output, ...testClientFiles }),
    [getBuildFilename({ isTest: true, isServer: true, ...commandRole })]:
      getBuildFileContent({ isTest: true, isServer: true, ...commandRole, ...testServerFiles }),
    [getBuildFilename({ isTest: true, isServer: true, role: FILE_ROLE.entry })]:
      getBuildFileContent({ isTest: true, isServer: true, role: FILE_ROLE.entry, ...testServerFiles }),
    [getBuildFilename({ isTest: true, isServer: true, role: FILE_ROLE.output })]:
      getBuildFileContent({ isTest: true, isServer: true, role: FILE_ROLE.output, ...testServerFiles }),
    // /* TODO: deprecate */
    // 'main-client.hmr.js': '// Main client entry point for RSPack to enable HMR\n',
    // 'main-client.js': '// Main client entry point for Meteor compiled by RSPack\n',
    // 'main-server.js': '// Main server entry point for Meteor compiled by RSPack\n',
    // 'test-client.js': '// Test client entry point for Meteor compiled by RSPack\n',
    // 'test-server.js': '// Test server entry point for Meteor compiled by RSPack\n',
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

export function getBuildFilename(config) {
  const module = config?.isTest ? 'test' : config?.isMain ? 'main' : '';
  const side = config?.isServer ? 'server' : config?.isClient ? 'client' : '';
  const env = config?.isDevelopment ? 'dev' : config?.isProduction ? 'prod' : '';
  const role = config?.role;
  const extension = config?.extension || 'js';
  return `${module}-${side}${
    env ? `.${env}-${role}` : `.${role}`
  }.${extension}`;
}

export function getBuildFileContent(config) {
  const module = config?.isTest ? 'test' : config?.isMain ? 'main' : '';
  const side = config?.isServer ? 'server' : config?.isClient ? 'client' : '';
  const env = config?.isDevelopment ? 'development' : config?.isProduction ? 'production' : '';
  const role = config?.role;

  const banner = [FILE_ROLE.run, FILE_ROLE.build].includes(role) ? `/**
 * --------------------------------------------------------------------------
 * ☄️ Meteor ${capitalizeFirstLetter(side)} Entry Point (${capitalizeFirstLetter(env || module)})
 * --------------------------------------------------------------------------
 * Starts the Meteor application in ${env || module} mode when running the "${role}" command.
 */` : `/**
 * --------------------------------------------------------------------------
 * ⚡ Rspack ${capitalizeFirstLetter(side)} ${capitalizeFirstLetter(role)} (${capitalizeFirstLetter(env || module)})
 * --------------------------------------------------------------------------
 * Acts as the Rspack ${role} file in ${env} mode.
 */`;

  const hmr = role === FILE_ROLE.run && config?.isClient
    ? `/* Enables HMR */
if (module.hot) {
  module.hot.accept();
}` : '';

  const importContent = role === FILE_ROLE.entry
    ? `/* Entry to Meteor ${side} app */
import '../${config?.entryFile}';`
    : role === FILE_ROLE.build || role === FILE_ROLE.run && config?.isServer
      ? `/* Link to Rspack ${side} app */
import './${config?.outputFile || ''}';`
      : role === FILE_ROLE.run && config?.isClient
      ? '/* No link to Rspack client app as served by HMR server */'
      : role === FILE_ROLE.output && config?.isClient
      ? '/* No code generated for Rspack client app as served by HMR server */'
      : role === FILE_ROLE.output && config?.isServer
      ? '/* Code generated for Rspack server app */'
      : '';

  return `${banner}
${hmr && `
${hmr}
` || ''}
${importContent}
`;
}

module.exports = {
  getInitialEntrypoints,
  ensureRSPackBuildContextExists,
  ensureModuleFilesExist,
  writeMainClientEntryForHMR,
  getBuildFilename,
  getBuildFileContent,
};
