const util = require('../src/util.js');

const _ = require('lodash');

exports.command = 'script <script>'
exports.desc = 'Run script'
exports.builder = {
  t: {
    alias: 'transactions',
    demand: false,
    describe: 'Print mined transactions',
    type: 'boolean'
  },
  e: {
    alias: 'events',
    demand: false,
    describe: 'Print transaction events',
    type: 'boolean'
  },
  w: {
    alias: 'wallet',
    demand: false,
    describe: 'Use mist wallet key'
  },
  r: {
    alias: 'rpc',
    demand: false,
    describe: 'Rpc address and port'
  },
  g: {
    alias: 'geth',
    demand: false,
    describe: 'Geth IPC file',
    type: 'string'
  },
  p: {
    alias: 'preload',
    demand: false,
    describe: 'Generates preload',
    type: 'string'
  }
};

exports.handler = function (argv) {
  var extra = _.omit(argv, ['_', 't', 'transactions', 'e', 'events', 'h', 'help', '$0']);

  require('../src/script.js')(argv.script, extra, argv.w, argv.t, argv.e, argv.p);
};
