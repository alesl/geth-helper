var _ = require('lodash');
var Promise = require("bluebird");
var chalk = require('chalk');
var util = require('../src/util.js');
const solc = require('solc');
Promise.config({
  longStackTraces: false
});

exports.command = 'bin <file>'
exports.desc = 'Compiles contract'
exports.builder = {
};

exports.handler = function (argv) {
  util.getContract(argv.file, false).then(function(info) {
    console.error(chalk.blue(solc.version()));
    console.error();
    console.log(info.byteCode);
  }).catch(util.printException);
}
