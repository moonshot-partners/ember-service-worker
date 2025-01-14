'use strict';

const ServiceWorkerBuilder = require('./lib/service-worker-builder');
const InlineRegistration = require('./lib/inline-registration');
const mergeTrees = require('broccoli-merge-trees');
const writeFile = require('broccoli-file-creator');
const hashForDep = require('hash-for-dep');
const addonUtils = require('./lib/addon-utils');
const IndexFile = require('./lib/index-file');

module.exports = {
  name: 'ember-service-worker',

  included(app) {
    if (this._super.included) {
      this._super.included.apply(this, arguments);
    }

    // Configures Ember CLI's build system to not add a fingerprint to sw.js
    this.app = app;
    this.app.options = this.app.options || {};
    let options = this.app.options['ember-service-worker'] =  this.app.options['ember-service-worker'] || {}
    options.serviceWorkerFilename = options.serviceWorkerFilename || 'sw.js';

    this.app.options.fingerprint = this.app.options.fingerprint || {};
    this.app.options.fingerprint.exclude = this.app.options.fingerprint.exclude || [];
    this.app.options.fingerprint.exclude.push(options.serviceWorkerFilename);

    options.registrationStrategy = options.registrationStrategy || 'default';

    if (options.enabled === undefined) {
      options.enabled = this.app.env !== 'test';
    }

    if (process.env.SW_DISABLED) {
      options.enabled = false;
    }

    if (options.registrationStrategy === 'after-ember' && options.enabled !== false) {
      app.import('vendor/ember-service-worker/load-registration-script.js');
    }
  },

  treeForVendor() {
    return writeFile('ember-service-worker/load-registration-script.js', `
      (function() {
        if (typeof FastBoot === 'undefined') {
          var script = document.createElement('script')
          script.src = '${this._getRootURL()}sw-registration.js';
          document.body.appendChild(script);
        }
      })();
    `);
  },

  postprocessTree(type, appTree) {
    let options = this._getOptions();

    if (type !== 'all' || options.enabled === false) {
      return appTree;
    }

    let plugins = this._findPluginsFor(this.project);

    // Add the project itself as a possible plugin, this way user can add custom
    // service-worker code in their app, without needing to build a plugin.
    plugins = [this].concat(plugins, this.project);

    let serviceWorkerBuilder = new ServiceWorkerBuilder({
      app: this,
      appTree,
      minifyJS: this.app.options.minifyJS,
      fingerprint: this.app.options.fingerprint.enabled,
      plugins,
      rootURL: this._getRootURL(),
      sourcemaps: this.app.options.sourcemaps,
      registrationDistPath: options.registrationDistPath,
      serviceWorkerFilename: options.serviceWorkerFilename,
      ignoreRegistration: options.ignoreRegistration
    });

    let serviceWorkerTree = serviceWorkerBuilder.build('service-worker');
    let serviceWorkerRegistrationTree =
      serviceWorkerBuilder.build('service-worker-registration');

    if (options.registrationStrategy === 'inline') {
      serviceWorkerRegistrationTree = new InlineRegistration([appTree, serviceWorkerRegistrationTree], options);
    }

    return mergeTrees([
      appTree,
      serviceWorkerTree,
      serviceWorkerRegistrationTree
    ], { overwrite: true });
  },

  contentFor(type, config) {
    let options = this._getOptions();

    if (options.enabled === false) {
      return;
    }

    let registrationDistPath = options.registrationDistPath;
    let srcPath = 'sw-registration.js';

    if (registrationDistPath) {
      srcPath = `${registrationDistPath}/${srcPath}`;
    }

    if (type === 'body-footer') {
      if (options.registrationStrategy === 'default') {
        return `<script src="${this._getRootURL()}${srcPath}"></script>`;
      }

      if (options.registrationStrategy === 'inline') {
        return `<!-- ESW_INLINE_PLACEHOLDER -->`;
      }
    }

    if (type === 'head-footer' && options.registrationStrategy === 'async') {
      return `<script async src="${this._getRootURL()}${srcPath}"></script>`;
    }
  },

  treeForServiceWorker(swTree, appTree) {
    var options = this._getOptions();
    options.projectVersion = this.project.pkg.version;

    try {
      options.projectRevision = hashForDep(this.project.root);
    } catch (e) {
      options.projectRevision = '0';
    }

    var indexFile = new IndexFile([appTree], options);

    return mergeTrees([swTree, indexFile]);
  },

  _getRootURL() {
    if (this._projectRootURL) {
      return this._projectRootURL;
    }

    let options = this._getOptions();
    let config = this._getConfig();
    let rootURL = options.rootUrl || config.rootURL || config.baseURL || '/';

    return this._projectRootURL = rootURL;
  },

  _getOptions() {
    return this.app.options['ember-service-worker'];
  },

  _getConfig() {
    return this.project.config(this.app.env);
  },

  _findPluginsFor(project) {
    let addons = project.addons || [];
    return addonUtils.filterByKeyword(addons, 'ember-service-worker-plugin');
  }
};
