Package.describe({
  name: 'standard-minifier-js',
  version: '3.0.0',
  summary: 'Standard javascript minifiers used with Meteor apps by default.',
  documentation: 'README.md',
});

Package.registerBuildPlugin({
  name: "minifyStdJS",
  use: [
    'minifier-js',
    'ecmascript',
    'caching-minifier',
    'source-maps',
  ],
  npmDependencies: {
    'meteor-package-install-swc': '1.1.2',
    'acorn': '8.10.0',
    '@babel/parser': '7.22.7',
    'terser': '5.19.2',
    "@babel/runtime": "7.18.9"
  },
  sources: [
    'plugin/minify-js.js',
    'plugin/stats.js',
  ],
});

Package.onUse(function(api) {
  api.use('isobuild:minifier-plugin@1.0.0');
  api.use('caching-minifier'); 
  api.use('source-maps'); 
});
