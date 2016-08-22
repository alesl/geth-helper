var _ = require('lodash');
var Promise = require("bluebird");
var chalk = require('chalk');
var util = require('../src/util.js');
Promise.config({
  longStackTraces: false
});


exports.command = 'send [amount]';
exports.desc = 'Send ether to address';
exports.builder = {
  p: {
    alias: 'private',
    demand: true,
    describe: 'Private key to send tx from',
    type: 'string'
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
  t: {
    alias: 'to',
    demand: true,
    describe: 'Address to send ether to',
    type: 'string'
  }
};

exports.handler = function (argv) {
  var to = argv.to;
  var amount = argv.amount;
  var privateKey = argv.private;
  var from = util.privateToAddress(privateKey);

  return util.signTx(privateKey, from, to, util.toWei(amount)).then(util.sendRaw).then(function(tx) {
    console.log(tx);
  }).finally(() => {
    process.exit();
  });
}
