const _ = require('lodash');
const Promise = require("bluebird");
const fs = require('fs');
const net = require('net');
const os = require('os');
const solc = require('solc');
const path = require('path');
const crypto = require('crypto');
const Tx = require('ethereumjs-tx');
const chalk = require('chalk');
const read = require('read');
const Web3 = require('web3');
const util = require('util');
const ethUtil = require('ethereumjs-util');
var web3;
Promise.config({
  longStackTraces: false
});

function getWeb3() {
  if (web3) {
    return web3;
  }

  var argv = require('yargs').argv;
  if (argv.g) {
    web3 = new Web3(new Web3.providers.IpcProvider(argv.g, net));
  } else {
    var ip = '127.0.0.1', port = 8545;
    if (argv.r) {
      var ipPort = argv.r.split(':');
      ip = ipPort[0];
      if (ipPort.length>1) {
        port = parseInt(ipPort[1], 10);
      }
    }

    web3 = new Web3(new Web3.providers.HttpProvider(`http://${ip}:${port}`));
  }

  return web3;
}

function privateToAddress(privateKey) {
  var public = ethUtil.privateToPublic(new Buffer(privateKey, 'hex'));
  return '0x' + ethUtil.publicToAddress(public).toString('hex');
}

function getNonce(address) {
  if (_.isArray(address)) {
    return Promise.map(address, getNonce).then(function(res) {
      return _.zipObject(address, res);
    });
  }

  return new Promise(function(resolve, reject) {
    getWeb3().eth.getTransactionCount(address, function(error, nonce) {
      if (error) {
        reject(error);
      } else {
        resolve(nonce);
      }
    });
  });
};

function signWithNonce(privateKey, nonce, from, to, amount, data) {
  return new Promise(function(resolve, reject) {
    var rawTx = {
      value: getWeb3().fromDecimal(amount),
      to: to,
      data: data,
      from: from,
    };

    getWeb3().eth.getGasPrice(function(error, price) {
      if (error) {
        reject(error);
        return;
      }
      getWeb3().eth.estimateGas(rawTx, function(error, gasUsage) {
        if (error) {
          reject(error);
          return;
        }
        var forceLimit = 4700000;
        if (gasUsage>forceLimit) {
          console.log(chalk.red(`Needed gas is too high: ${gasUsage}`));
          process.exit();
        }
        var tx = new Tx({
          nonce: (getWeb3().toHex(nonce)),
          to: rawTx.to,
          value: rawTx.value,
          from: from,
          gasPrice: getWeb3().toHex(price),
          gasLimit: getWeb3().toHex(/*gasUsage*/ forceLimit),
          data: data
        });
        var key = new Buffer(privateKey, 'hex')
        tx.sign(key);

        resolve('0x'+tx.serialize().toString('hex'));
      });
    });
  });
};

function signTx(privateKey, from, to, amount, data) {
  return getNonce(from).then(function(nonce) {
    return signWithNonce(privateKey, nonce, from, to, amount, data);
  });
};

function sendRaw(signed) {
  return new Promise(function(resolve, reject) {
    getWeb3().eth.sendRawTransaction(signed, function(error, res) {
      if (error) {
        reject(error);
      } else {
        resolve(res);
      }
    });
  });
};

function sendTx(from, to, amount, data) {
  var rawTx = {
    value: getWeb3().fromDecimal(amount),
    to: to,
    data: data,
    from: from,
  };

  return new Promise(function(resolve, reject) {
    getWeb3().eth.estimateGas(rawTx, function(error, gasUsage) {
      if (error) {
        reject(error);
        return;
      }

      var forceLimit = 4700000;
      if (gasUsage>forceLimit) {
        console.log(chalk.red(`Needed gas is too high: ${gasUsage}`));
        process.exit();
      }

      rawTx.gas = forceLimit;

      getWeb3().eth.sendTransaction(rawTx, function(error, res) {
        if (error) {
          reject(error);
        } else {
          resolve(res);
        }
      });
    });
  });
}

function callMethod(privateKey, toAddress, value, contract, methodName, args) {
  var fromAddress = privateKey ? privateToAddress(privateKey) : getWeb3().eth.accounts[0];
  var method = contract[methodName];
  var data = method.getData.apply(method, args);
  if (methodName=='new') {
    data = '0x'+data;
  }
  return new Promise(function(resolve, reject) {
    var txId;

    getWeb3().eth.filter('latest').watch(function(error, block) {
      if (error || !txId) {
        return;
      }

      getWeb3().eth.getTransactionReceipt(txId, function(err, info) {
        if (!info) {
          return;
        }
        writeDone();
        resolve(info);
      });
    });

    if (!privateKey) {
      return step('Broadcasting tx for '+methodName, sendTx(
        fromAddress,
        toAddress,
        value,
        data
      )).then(function(id) {
        txId = id;
        console.log('Transaction:');
        console.log(chalk.green(id));
        writeLabel('Waiting to be mined');
      });
    }

    return step('Broadcasting tx for '+methodName, signTx(
      privateKey,
      fromAddress,
      toAddress,
      value,
      data
    ).then(sendRaw)).then(function(id) {
      txId = id;
      console.log('Transaction:');
      console.log(chalk.green(id));
      writeLabel('Waiting to be mined');
    });
  });
};

function resolve(fileName) {
  var cwd = path.dirname(fileName)
  var name = path.basename(fileName);
  var processed = [];

  var _resolve = function(cwd, name) {
    var extractImports = function(content) {
      var imports = [];
      var lines = content.split(/\n/);
      lines.forEach(function(line, ii) {
        var m = line.replace(/\/\/.*$/, '').match(/import\s+["']([^"']+)["']/);
        if (m) {
          var fp = fs.realpathSync(cwd+'/'+m[1]);
          lines[ii] = `import "${fp}";`;
          imports.push(m[1]);
        }
      });
      var finalCode = lines.join('\n');

      return [finalCode, imports];
    };

    var res = {};
    var fullName = fs.realpathSync(cwd + '/' + name);
    if (processed.indexOf(fullName)!=-1) {
      return res;
    }
    processed.push(fullName);
    return readFile(fullName).then(function(content) {
      var contentImports = extractImports(content);
      res[fullName] = {content: contentImports[0], file:fullName};

      return Promise.all(contentImports[1].map(function(name) {
        var newCwd = fs.realpathSync(cwd+'/'+name).split('/').slice(0, -1).join('/');
        return _resolve(newCwd, name);
      }));
    }).then(function(items) {
      items.forEach(function(child) {
        _.extend(res, child);
      })
      return res;
    });
  }

  return _resolve(cwd, name);
};

function readFile(fileName) {
  return new Promise(function(resolve, reject) {
    fs.readFile(fileName, 'UTF-8', function(err, data) {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  })
};

function fileTime(fileName) {
  return new Promise(function(resolve, reject) {
    fs.stat(fileName, function(err, stat) {
      if (err) {
        reject(err);
      } else {
        resolve(stat.mtime.getTime());
      }
    });
  });
};

function valToPromise(val) {
  if (_.isFunction(val)) {
    return new Promise(function(resolve, reject) {
      resolve(val());
    });
  }

  return new Promise(function(resolve, reject) {
    resolve(val);
  });
};

function cache(key, val) {
  var dir = os.tmpdir();

  var exec = function(cachePath, val) {
    return valToPromise(val).then(function(val) {
      val = JSON.stringify(val);
      return new Promise(function(resolve, reject) {
        fs.writeFile(cachePath, val, function(err) {
          if (err) {
            reject(err);
            return;
          }
          fs.chmodSync(cachePath, '777');
          resolve(val);
        });
      });
    });
  };

  var hash = crypto.createHash('sha256');
  hash.update(key);
  var cacheFile = hash.digest('hex');
  var cachePath = dir+"/"+cacheFile;

  if (arguments[2]===true) {
    return exec(cachePath, val).then(function(res) {
      return JSON.parse(res);
    })
  }

  return readFile(cachePath).catch(function(err) {
    return exec(cachePath, val);
  }).then(function(res) {
    try {
      return JSON.parse(res);
    } catch(e) {
      console.log(chalk.red(`Failed reading cache file for ${key}:`));
      return cache(key, val, true);
    }
  });
};

var getContract = function(fileName, incContract) {
  fileName = fs.realpathSync(fileName);

  var fileMaxTime = function(files) {
    return Promise.map(files, fileTime).then(function(times) {
      return Math.max.apply(Math, times);
    });
  };

  var build = function() {
    return resolve(fileName).then(function(res) {
      var contractName = fileName.split('/').pop().replace(/\.sol$/, '');
      var input = {};
      var files = [];
      _.each(res, function(item, name) {
        input[name] = item.content;
        files.push(item.file);
      });

      return fileMaxTime(files).then(function(maxTime) {
        var output = solc.compile({sources: input}, 1);
        if (output.errors) {
          throw new Error(output.errors.join('\n'));
        }
        var contract = output.contracts[contractName];
        var byteCode = contract.bytecode;
        var jsonAbi = contract.interface;
        var abi = JSON.parse(jsonAbi);

        return {
          files: files,
          name: contractName,
          time: maxTime,
          byteCode: byteCode,
          abi: abi
        };
      });
    })
  };

  return cache(fileName, build).then(function(res) {
    var decorate = function(res) {
      var props = ['name', 'byteCode', 'abi'];
      return _.extend(_.pick(res, props), {
        contract: (incContract===undefined || incContract) ? getWeb3().eth.contract(res.abi) : null
      });
    };

    return fileMaxTime(res.files).then(function(time) {
      if (time==res.time) {
        return decorate(res);
      }

      return build().then(function(res) {
        return cache(fileName, res, true).then(function() {
          return decorate(res);
        });
      });
    })
  });
};

function prepareArgs(inputs, args) {
  return inputs.map(function(param, index) {
    var v = args[index];
    if (v===undefined) {
      throw new Error("Missing arg: "+param.name);
    }

    if (/\[\]$/.test(param.type)) {
      if (_.isString(v)) {
        try {
          v = JSON.parse(v);
        } catch (err) {
          throw new Error("Failed parsing arg: "+param.name);
        }
      }
    }

    return {
      name: param.name,
      value: v
    };
  });
};

var writeLabel = function(label) {
  process.stdout.write(label+' ... ');
};

var writeDone = function() {
  console.log(chalk.green('done'));
};

var writeFailed = function() {
  console.log(chalk.red('failed'));
};

var step = function(label, cb) {
  writeLabel(label);
  return valToPromise(cb).then(function(res) {
    writeDone();
    return res;
  }).catch(function(err) {
    writeFailed();
    throw err;
  });
};

var confirm = function(question) {
  console.log(question);
  return new Promise(function(resolve, reject) {
    read({ prompt: chalk.blue("[yes]/no: ") }, function(er, answer) {
      if (answer=='yes' || answer=='y') {
        resolve();
      } else {
        reject('canceled');
      }
    });
  });
};

var printException = function(err) {
  if (_.isString(err)) {
    console.log(chalk.red('Failed: '+err));
  } else {
    process.stdout.write(chalk.styles.red.open);
    console.log(err.stack);
    process.stdout.write(chalk.styles.red.close);
  }
};

function watchTxs(txToWatch, afterMined) {
  return new Promise(function(resolve, reject) {
    var blockFilter = getWeb3().eth.filter('latest');
    blockFilter.watch(function(error, block) {
      if (error) {
        return;
      }

      var checkTx = function(txId) {
        getWeb3().eth.getTransactionReceipt(txId, function(err, info) {
          if (!info) {
            return;
          }

          if (afterMined[txId]) {
            afterMined[txId](info);
            _.remove(txToWatch, function(id) { return id==txId; });

            if (txToWatch.length==0) {
              blockFilter.stopWatching();
              resolve();
            }
          }
        });
      };

      _.each(txToWatch, checkTx);
    });
  });
}

var exports = module.exports = {
  getContract: getContract,
  prepareArgs: prepareArgs,
  step: step,
  confirm: confirm,
  callMethod: callMethod,
  printException: printException,
  readFile: readFile,
  getNonce: getNonce,
  signWithNonce: signWithNonce,
  signTx: signTx,
  privateToAddress: privateToAddress,
  sendRaw: sendRaw,
  watchTxs: watchTxs,
  writeLabel: writeLabel,
  writeDone: writeDone,
  toWei : function(...args) {
    return getWeb3().toWei(...args);
  },
  read: function(options) {
    return new Promise(function(resolve, reject) {
      read(options, function(err, ret) {
        if (err) {
          reject(err);
        } else {
          resolve(ret);
        }
      })
    });
  },
  getBalance: function(addr) {
    return new Promise(function(resolve, reject) {
      getWeb3().eth.getBalance(addr, function(err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    });
  }
};
