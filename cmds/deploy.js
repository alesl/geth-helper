var _ = require('lodash');
var Promise = require("bluebird");
var chalk = require('chalk');
var util = require('../src/util.js');

exports.command = 'deploy [file]'
exports.desc = 'Deploys contract'
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
  }
};

exports.handler = function (argv) {
  var contractFile = argv.file;
  var privateKey = argv.private;
  var constructorArgs = argv._.slice(1);

  util.step('Compiling contract', util.getContract(contractFile)).then(function(info) {
    var contractName = info.name;
    var byteCode = info.byteCode;
    var abi = info.abi;
    var contract = info.contract;

    var contructor = abi.find(function(item) {
      if (item.type=='constructor') {
        return true;
      }
    }) || {inputs:[]};

    console.log('Arguments:');
    var args = [];
    util.prepareArgs(contructor.inputs, constructorArgs).forEach(function(item) {
      args.push(item.value);
      console.log(' - '+item.name+': '+item.value);
    });
    args.push({
      data: byteCode
    });

    return util.confirm('Do you want to deploy '+contractName).then(function() {
      return util.callMethod(
        privateKey,
        null,
        0,
        contract,
        'new',
        args
      ).then(function(info) {
        console.log('Address:');
        console.log(chalk.green(info.contractAddress));
      });
    });
  }).catch(util.printException).finally(function() {
    process.exit();
  });
}
