var _ = require('lodash');
var Promise = require("bluebird");
var chalk = require('chalk');
var util = require('../src/util.js');

exports.command = 'abi <file>'
exports.desc = 'Compiles contract'
exports.builder = {
};

exports.handler = function (argv) {
  util.getContract(argv.file).then(function(info) {
    console.log(JSON.stringify(info.abi));
  }).catch(util.printException).finally(function() {
    process.exit();
  });
}
