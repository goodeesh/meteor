// RequireExternalsPlugin.js

const fs = require('fs');
const path = require('path');

class RequireExternalsPlugin {
  constructor({ buildContext } = {}) {
    this.pluginName = 'RequireExternalsPlugin';
    this._prefix = 'external ';
    this._prefixLen = this._prefix.length;
    this._funcCount = 1;
    this._buildContext = buildContext;
    this.filePath = path.resolve(
      process.cwd(),
      buildContext,
      `main-client.dev.js`
    );
  }

  apply(compiler) {
    compiler.hooks.done.tap({ name: this.pluginName, stage: -10 }, (stats) => {
      // 1) Ensure globalThis.module / exports block is present
      this._ensureGlobalThisModule();

      // 2) Re-load existing requires from disk on every run
      const existing = this._readExistingRequires();

      // 3) Collect any new externals from this build
      const info = stats.toJson({ modules: true });
      const newRequires = [];

      for (const module of info.modules) {
        const name = module.name;
        if (typeof name !== 'string' || !name.startsWith(this._prefix)) continue;
        let pkg = name.slice(this._prefixLen);
        if (pkg.startsWith('"') && pkg.endsWith('"')) pkg = pkg.slice(1, -1);
        if (!existing.has(pkg)) {
          existing.add(pkg);
          newRequires.push(`require('${pkg}')`);
        }
      }

      // 4) Append new imports if any
      if (newRequires.length) {
        const fnName = `lazyExternalImports${this._funcCount++}`;
        const body = newRequires.map(req => `  ${req};`).join('\n');
        const fnCode = `\nfunction ${fnName}() {\n${body}\n}\n`;
        try {
          fs.appendFileSync(this.filePath, fnCode);
        } catch (err) {
          console.error(`Failed to append imports to ${this.filePath}:`, err);
        }
      }
    });
  }

  _ensureGlobalThisModule() {
    const block = [
      `if (typeof globalThis.module === 'undefined') {`,
      `  globalThis.module = { exports: {} };`,
      `}`,
      `if (typeof globalThis.exports === 'undefined') {`,
      `  globalThis.exports = globalThis.module.exports;`,
      `}`
    ].join('\n') + '\n';

    let content = '';
    if (fs.existsSync(this.filePath)) {
      content = fs.readFileSync(this.filePath, 'utf-8');
      if (!content.includes(`typeof globalThis.module === 'undefined'`)) {
        // Prepend so it lives at the very top
        fs.writeFileSync(this.filePath, block + content, 'utf-8');
      }
    } else {
      // File doesn’t exist yet: create with just the block
      fs.writeFileSync(this.filePath, block, 'utf-8');
    }
  }

  _readExistingRequires() {
    const existing = new Set();
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const requireRegex = /require\('([^']+)'\)/g;
      let match;
      while ((match = requireRegex.exec(content)) !== null) {
        existing.add(match[1]);
      }
    } catch {
      // ignore if file missing or unreadable
    }
    return existing;
  }
}

module.exports = RequireExternalsPlugin;
