const _ = require('lodash');
const Promise = require("bluebird");
const path = require("path");
const chalk = require('chalk');
const util = require('./util.js');
const Web3 = new require('web3');
const SolidityEvent = require('web3/lib/web3/event.js');
const EthWallet = require('ethereumjs-wallet');
const ethUtil = require('ethereumjs-util');
const fs = require('fs');
Promise.config({
  longStackTraces: false
});

module.exports = exports = function(file, extra, walletFile, showTransactions, showEvents, genPreload) {
  var ALL_STEPS, VARS, CONTRACTS, STEP_INDEX, CONTRACT_ADDRESS, TX2CB, TEST_RESULTS = [];

  util.readFile(file).then(function(data) {
    var cf;
    try {
      cf = JSON.parse(data);
    } catch(e) {
      console.log(chalk.red("Failed parsing config file: " + e));
      process.exit();
    }
    VARS = _.extend(_.get(cf, 'vars', {}), extra);
    ALL_STEPS = _.get(cf, 'steps', []);
    CONTRACTS = {};
    CONTRACT_ADDRESS = _.get(cf, 'addresses', {});
    TX2CB = {};
    STEP_INDEX = 0;

    var walletPromise;
    if (walletFile) {
      walletPromise = extractPrivateKeyFromWallet(walletFile);
    } else {
      walletPromise = Promise.resolve();
    }

    var scriptDir = path.dirname(file);

    return walletPromise.then(function() {
      return util.step('Compiling contracts', Promise.map(cf.contracts || [], function(file) {
        return util.getContract(path.resolve(scriptDir, file));
      }).then(function(res) {
        res.forEach(function(c) {
          CONTRACTS[c.name] = c;
        });
      })).then(execStep);
    }).then(() => {
      if (genPreload) {
        let preload = [];
        _.each(CONTRACT_ADDRESS, (addr, name) => {
          let abi = CONTRACTS[name].abi;
          preload.push(`${name} = eth.contract(${JSON.stringify(abi)}).at(${JSON.stringify(addr)});\n`);
        });

        return new Promise((resolve, reject) => {
          fs.writeFile(genPreload, preload.join('\n'), function(err) {
            if (err) {
              reject(`Failed writing preload file at ${genPreload}`);
            } else {
              console.log(chalk.green(`Preload file writen in ${genPreload}`));
              resolve();
            }
          });
        });
      }
    });
  }).catch(util.printException).finally(function() {
    if (TEST_RESULTS.length>0) {
      console.log();
      console.log();
      console.log('Test results:');
      TEST_RESULTS.forEach(function(line) {
        console.log(line);
      });
    }
    process.exit();
  });

  var resolveVar = function(name) {
    var val = name;
    while (true) {
      if (CONTRACT_ADDRESS[val]!==undefined) {
        return CONTRACT_ADDRESS[val];
      } else if (VARS[val]!==undefined) {
        val = VARS[val];
      } else {
        if (_.isArray(val)) {
          val = _.map(val, resolveVar);
        }
        break;
      }
    };

    return val;
  };

  var resolveName = function(name) {
    var val = name;
    while (true) {
      if (VARS[val]!==undefined) {
        val = VARS[val];
      } else {
        if (_.isArray(val)) {
          val = _.map(val, resolveName);
        }
        break;
      }
    };

    return val;
  };


  var prepareStep = function(step) {
    var keys = step.key;
    if (!_.isArray(keys)) {
      keys = [keys];
    }
    keys = _.flatten(_.map(keys, resolveVar));

    return keys.map(function(key) {
      var toArray = function(v) {
        if (_.isArray(v)) {
          return v;
        }
        return [v];
      };
      args = toArray(step.args || []).map(function(arg) {
        return resolveVar(arg);
      });

      var res = _.extend({
        key: key,
        args: args
      }, _.pick(step, ['type', 'contract', 'method', 'value', 'as']));

      if (step.address) {
        res['address'] = resolveVar(step.address);
      }

      return res;
    });
  };

  var prepareTxForStep = function(key, nonce, step) {
    var to;
    var args = [];
    var contractName = resolveName(step.contract);
    var contractInfo = CONTRACTS[contractName];
    if (!contractInfo) {
      console.log(chalk.red(`Unknown contract ${contractName}`));
      process.exit();
    }
    var contract = contractInfo.contract;
    var method;
    var methodName;
    var methodAbi;
    var data;

    var abiReplaceBinaries = function(abi) {
      return abi.replace(/__(.{38})/g, function(lib) {
        lib = _.trim(lib, '_').split(':')[0].replace(/\.sol$/, '');
        if (!CONTRACT_ADDRESS[lib]) {
          console.log(chalk.red(`Library address for ${lib} unknown`));
          process.exit();
        }
        return CONTRACT_ADDRESS[lib].substr(2);
      });
    };

    if (step.type=='call') {
      to = resolveVar(contractInfo.name);
      if (!to) {
        console.log(chalk.red("Contract ${contractName} missing address"));
      }
      methodName = resolveName(step.method);
      methodAbi = contractInfo.abi.find(function(item) {
        if (item.type=='function' && item.name==methodName) {
          return true;
        }
      });
      if (!methodAbi) {
        console.log(chalk.red(`Unknown method ${methodName}`));
        process.exit();
      }
      contract = contract.at(to);
      method = contract[methodName];
    } else if (step.type=='deploy') {
      to = null;

      methodName = 'new';
      methodAbi = contractInfo.abi.find(function(item) {
        if (item.type=='constructor') {
          return true;
        }
      }) || {inputs:[]};
      method = contract[methodName];
    }

    var args = util.prepareArgs(methodAbi.inputs, step.args).map(function(item) {
      return item.value;
    });
    if (step.type=='deploy') {
      args.push({
        data: abiReplaceBinaries(contractInfo.byteCode)
      });
    }
    data = method.getData.apply(method, args);
    if (step.type=='deploy') {
      data = '0x'+data;
    }

    if (data.substr(0, 2)!='0x' || data.substr(0, 4)=='0x0x') {
      throw new Error('Bad data');
    }

    return {
      sign: util.signWithNonce(key, nonce, util.privateToAddress(key), to, step.value||0, data),
      cb: function(messages) {
        return function(info) {
          if (step.type=='deploy') {
            CONTRACT_ADDRESS[step.as || contractName] = info.contractAddress;
            var alias = '';
            if (step.as) {
              alias = ` (${step.as})`;
            }
            messages.push('Contract '+chalk.blue(contractName)+alias+' mined at '+chalk.blue(info.contractAddress));
          } else if (step.type=='call') {
            messages.push('Method '+contractName+'@'+methodName+' executed');
            var formater = contract.allEvents().formatter;
            info.logs.forEach(function(log) {
              if (log.address!=to) {
                return;
              }

              var result = formater(log);

              if (showEvents) {
                messages.push('  '+result.event+': '+JSON.stringify(result.args));
              }

              if (result.event=='AssertSuccess') {
                TEST_RESULTS.push(chalk.green(`+ ${contractName}@${methodName} ${result.args.msg}`));
              } else if (result.event=='AssertFailure') {
                TEST_RESULTS.push(chalk.red(`- ${contractName}@${methodName} ${result.args.msg}`));
              }
            });
          }
        };
      }
    }
  };

  var execStep = function() {
    STEP_INDEX++;

    var steps = ALL_STEPS.shift();
    if (!steps) {
      return;
    }

    if (!_.isArray(steps)) {
      steps = [steps];
    }

    steps = _.reduce(steps, function(res, step) {
      return res.concat(prepareStep(step));
    }, []);

    var stepByKey = _.groupBy(steps, "key");


    var usedKeys = _.keys(stepByKey);
    var usedAddresses = _.map(usedKeys, util.privateToAddress);
    var keyToAddress = _.zipObject(usedKeys, usedAddresses);
    var promises = [];
    var afterDeployed = [];
    var afterMined = {};
    var txList = [];
    var txToWatch = [];
    var messages = [];

    // prepare and sign txs
    util.writeLabel('Executing step '+STEP_INDEX);
    return util.getNonce(usedAddresses).then(function(nonces) {
      _.each(stepByKey, function(steps, key) {
        var fromAddress = keyToAddress[key];
        _.each(steps, function(step, ii) {
          if (step.type=='test') {
            var testMethods = CONTRACTS[resolveName(step.contract)].abi.filter(function(item) {
              return item.type=='function' && /^test/.test(item.name);
            }).map(function(item) {
              var testStep = _.extend(_.pick(step, ['key', 'contract']), {
                type: 'call',
                method: item.name
              });

              var res = prepareTxForStep(key, nonces[fromAddress]++, testStep);
              promises.push(res.sign);
              afterDeployed.push(res.cb);
            });
            return;
          }

          var res = prepareTxForStep(key, nonces[fromAddress]++, step);
          promises.push(res.sign);
          afterDeployed.push(res.cb);
        });
      });
    }).then(function() {
      // broadcast txs
      return Promise.all(promises).then(function(signed) {
        return Promise.map(signed, util.sendRaw).then(function(res) {
          _.map(res, function(tx, ii) {
            txToWatch.push(tx);
            txList.push(tx);
            afterMined[tx] = afterDeployed[ii](messages);
          });
        });
      }).then(function() {
        return util.watchTxs(txToWatch, afterMined);
      });
    }).then(function() {
      util.writeDone();
      if (showTransactions) {
        console.log('Transactions:');
        txList.forEach(function(tx) {
          console.log('- '+tx);
        });
      }
      console.log('Messages:');
      messages.forEach(function(msg) {
        console.log("- "+msg);
      });
    }).then(execStep);
  };

  var extractPrivateKeyFromWallet = function(file) {
    return util.readFile(file).then(function(data) {
      var wallet = JSON.parse(data);
      if (wallet.Crypto && !wallet.crypto) {
        wallet.crypto = wallet.Crypto;
      } 

      var privateKey, address;
      return util.read({ prompt: chalk.red(chalk.blue("Enter wallet password: ")), silent: true }).then(function(password) {
        privateKey = EthWallet.fromV3(wallet, password).getPrivateKey().toString('hex');

        var public = ethUtil.privateToPublic(new Buffer(privateKey, 'hex'));
        address = '0x' + ethUtil.publicToAddress(public).toString('hex');

        console.log(chalk.green(`Wallet decoded, you will be signing as ${address}`));
        return util.read({ prompt: chalk.blue("[yes]/no: ") });
      }).then(function(answer) {
        if (answer=='yes' || answer=='y') {
        } else {
          process.exit();
        }

        VARS['__WALLET_ADDRESS__'] = address;
        VARS['__WALLET_KEY__'] = privateKey;
      });
    });
  };
};
