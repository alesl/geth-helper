# Installation

```
npm i -g https://github.com/cashila/geth-helper
```

# Usage

## ABI

Following commands compiles contract and outputs ABI. Please note:
- contract name must be the same as file name (contract named Test in file Test.sol)
- imports will be resolved, eg. for ``import "path/to/AnotherContract.sol";`` file at path/to/AnotherContract.sol will be loaded

```
gh abi Contract.sol
```

## Deploy single contract

To deploy single contract you can use command bellow.

```
gh deploy Contract.sol -p '0x123...89'
```

Deploy single contract and capture web3 line.

```
# To file
gh deploy Contract.sol -p '0x123...89' 2> contract.js

# To clipboard (osx)
gh deploy Contract.sol -p '0x123...89' 3>&2 2>&1 1>&3 | pbcopy
```

Command takes parameters:
- ``-p`` Private key used to deploy (required)
- ``-g`` Path to geth.ipc (optional)
- ``-r`` Ip:port pair (optional, by default script tries to connect to ``127.0.0.1:8545``)

If contract constructor takes arguments they can be provided last:
```
gh deploy Contract.sol -p '0x123...89' arg1 arg2 ...
```

## Deploy multiple (dependent) contracts

When multiple contracts needs to be deployed, where one contract (address) might be used to initialize another contract, where some additional calls are needed to fully deploy it you can use ``script`` command.

```
gh script complex_deploy.json
```

Structure of script file is as follows:

```json
{
  "//" : "variables",
  "vars": {
    "private_key": "abcd...",
    "Contract2": "0x123...",
    "var1": "val2",
    "var2": "val3"
  },
  "//" : "contract files",
  "contracts": [
    "path/to/Contract1.sol",
    "path/to/Contract2.sol"
  ],
  "//" : "deploy procedure consisting of one or multiple steps",
  "steps": [
    {
      "type": "deploy",
      "key": "private_key",
      "contract": "Contract1",
      "args": [
        "var1",
        "var2"
      ]
    },
    {
      "type": "call",
      "key": "private_key",
      "contract": "Contract2",
      "method": "someMethod",
      "args": [
        "Contract1",
        "var1",
        "var2"
      ]
    }
  ]
}
```

The example above, first deploy Contract1 with arguments "val2" and "val3" then invokes method someMethod on contract Contract2 with arguments: address of deployed Contract1, "val2" and "val3". All transactions are signed by private key "abcd...".

In ``vars`` section you can define all parameters/args and keys used to deploy/call each steps. In ``contracts`` list all used contracts.
``steps`` is array of steps where each step consist is either of action or array of actions. Actions can be of two types:
- ``deploy`` is used to deploy new contract. After the contract is mined variable with same name as contract will be defined and can be used in latter steps (this can be overriden by providing ``as`` alias)
- ``call`` is used to call existing contract method

For each action ``key`` must be provided, this is private key that will sign transaction.
