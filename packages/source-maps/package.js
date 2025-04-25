Package.describe({
  name: 'source-maps',
  summary: 'Concat source maps; very fast and in pure js',
  version: '1.1.1',
  git: 'https://github.com/zodern/source-maps.git'
});

Npm.depends({
  'vlq': '2.0.4'
});

Package.onUse(function(api) {
  api.use('ecmascript');
  api.mainModule('index.js');
  api.export('SourceMaps');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('mocha');
  api.use('zodern:source-maps');
  api.mainModule('tests/index.js');
});