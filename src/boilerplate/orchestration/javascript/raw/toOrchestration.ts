/* eslint-disable no-param-reassign, no-shadow, no-unused-vars, no-continue */

import OrchestrationBP from './boilerplate-generator.js';


const stateVariableIds = (node: any) => {
  const {privateStateName, stateNode} = node;
  const stateVarIds: string[] = [];
  // state variable ids
  // if not a mapping, use singular unique id (if mapping, stateVarId is an array)
  if (!stateNode.stateVarId[1]) {
    stateVarIds.push(
      `\nconst ${privateStateName}_stateVarId = generalise(${stateNode.stateVarId}).hex(32);`,
    );
  } else {
    // if is a mapping...
    stateVarIds.push(
      `\nlet ${privateStateName}_stateVarIdInit = ${stateNode.stateVarId[0]};`,
    );
    // ... and the mapping key is not msg.sender, but is a parameter
    if (
      privateStateName.includes(stateNode.stateVarId[1].replaceAll('.', 'dot')) &&
      stateNode.stateVarId[1] !== 'msg'
    ) {
      if (+stateNode.stateVarId[1] || stateNode.stateVarId[1] === '0') {
        stateVarIds.push(
          `\nconst ${privateStateName}_stateVarId_key = generalise(${stateNode.stateVarId[1]});`,
        );
      } else {
        stateVarIds.push(
          `\nconst ${privateStateName}_stateVarId_key = ${stateNode.stateVarId[1]};`,
        );
      }
    }
    // ... and the mapping key is msg, and the caller of the fn has the msg key
    if (
      stateNode.stateVarId[1] === 'msg' &&
      privateStateName.includes('msg')
    ) {
      stateVarIds.push(
        `\nconst ${privateStateName}_stateVarId_key = generalise(config.web3.options.defaultAccount); // emulates msg.sender`,
      );
    }
    stateVarIds.push(
      `\nlet ${privateStateName}_stateVarId = generalise(utils.mimcHash([generalise(${privateStateName}_stateVarIdInit).bigInt, ${privateStateName}_stateVarId_key.bigInt], 'ALT_BN_254')).hex(32);`,
    );
  }
  return stateVarIds;
}

/**
 * @desc:
 * Generates boilerplate for orchestration files
 * Handles logic for ordering and naming inside a function.mjs file
 */
const Orchestrationbp = new OrchestrationBP();
export const sendTransactionBoilerplate = (node: any) => {
  const { privateStates } = node;
  const output: string[][] = [[],[],[],[],[],[],[]];
  // output[0] = arr of nullifiers
  // output[1] = commitments root(s)
  // output[2] = arr of commitments
  // output[3] = arr of nullifiers to check, not add (for accessed states)
  // output[4] = arr of cipherText
  // output[5] = arr of enc keys
  let privateStateName: string;
  let stateNode: any;
  for ([privateStateName, stateNode] of Object.entries(privateStates)) {
    switch (stateNode.isPartitioned) {
      case true:
        switch (stateNode.nullifierRequired) {
          case true:
            // decrement
            output[1].push(`${privateStateName}_root.integer`);
            output[0].push(
              `${privateStateName}_0_nullifier.integer, ${privateStateName}_1_nullifier.integer`,
            );
            output[2].push(`${privateStateName}_2_newCommitment.integer`);
            break;
          case false:
          default:
            // increment
            output[2].push(`${privateStateName}_newCommitment.integer`);
            if (stateNode.encryptionRequired) {
              output[4].push(`${privateStateName}_cipherText`);
              output[5].push(`${privateStateName}_encKey`);
            }
            break;
        }
        break;
      case false:
      default:
        // whole 
        if (!stateNode.reinitialisedOnly)
          output[1].push(`${privateStateName}_root.integer`);
          if (stateNode.accessedOnly) {
            output[3].push(`${privateStateName}_nullifier.integer`);
          } else {
            if (!stateNode.reinitialisedOnly) {
              output[0].push(`${privateStateName}_nullifier.integer`);
          }
        }
        if (!stateNode.accessedOnly && !stateNode.burnedOnly)
          output[2].push(`${privateStateName}_newCommitment.integer`);
        if (stateNode.encryptionRequired) {
          output[4].push(`${privateStateName}_cipherText`);
          output[5].push(`${privateStateName}_encKey`);
        }
        break;
    }
  }
  return output;
};

// Helper to transform parameter into the expected `.integer` accessor
function transformToIntegerAccess(para: string): string {
  if (para === 'msgValue') return 'msgValue';
  if (para === 'msgSender') return 'msgSender.integer';

  if (para.includes('.')) {
    const [first, ...rest] = para.split('.');
    return `${[first + '_init', ...rest].join('.')}.integer`;
  } else {
    return `${para}_init.integer`;
  }
};

export const generateProofBoilerplate = (node: any) => {
  const output: (string[] | string)[] = [];
  const enc: any[][] = [];
  const cipherTextLength: number[] = [];
  let containsRoot = false;
  let containsNullifierRoot = false;
  let containsNewNullifierRoot = false;
  const privateStateNames = Object.keys(node.privateStates);
  let stateName: string;
  let stateNode: any;
  for ([stateName, stateNode] of Object.entries(node.privateStates)) {
    // we prepare the return cipherText and encKey when required
    if (stateNode.encryptionRequired) {
      stateNode.structProperties ? cipherTextLength.push(stateNode.structProperties.length + 2) : cipherTextLength.push(3);
      enc[0] ??= [];
      enc[0].push(`const ${stateName}_cipherText = res.inputs.slice(START_SLICE, END_SLICE).map(e => generalise(e).integer);`);
      enc[1] ??= [];
      enc[1].push(`const ${stateName}_encKey = res.inputs.slice(START_SLICE END_SLICE).map(e => generalise(e).integer);`);
    }
    const parameters: string[] = [];
    // we include the state variable key (mapping key) if its not a param (we include params separately)
    const msgSenderParamAndMappingKey = stateNode.isMapping && (node.parameters.includes('msgSender') || output.join().includes('_msg_stateVarId_key.integer')) && stateNode.stateVarId[1] === 'msg';
    const msgValueParamAndMappingKey = stateNode.isMapping && (node.parameters.includes('msgValue') || output.join().includes('_msg_stateVarId_key.integer')) && stateNode.stateVarId[1] === 'msg';
    const constantMappingKey = stateNode.isMapping && (+stateNode.stateVarId[1] || stateNode.stateVarId[1] === '0');

    // We are keeping this code in comments, for future if have any issue with extra mapping keys getting added for a zapp we can come to this
    
    // let name: string;
    // let state: any;
    // let isIncluded = false;
    // console.log(node.privateStates);
    // for ([name, state] of Object.entries(node.privateStates)) {
    //   if (stateNode.stateVarId[0] === state.stateVarId[0] && stateName != name && node.parameters.includes(state.stateVarId[1]) ) {
    //     console.log(stateNode.stateVarId, stateName, name);
    //     console.log(node.parameters);
    //     isIncluded = true;
    //   }
    // }
    const stateVarIdLines =
    !stateNode.localMappingKey && stateNode.isMapping && !(node.parameters.includes(stateNode.stateVarId[1])) && !(node.parameters.includes(stateNode.stateVarId[2])) && !msgSenderParamAndMappingKey && !msgValueParamAndMappingKey && !constantMappingKey
        ? [`\n\t\t\t\t\t\t\t\t${stateName}_stateVarId_key.integer,`]
        : [];  
    // we add any extra params the circuit needs
    node.parameters
    .filter((para: string) => {
      if (privateStateNames.includes(para)) return false;
      const transformed = transformToIntegerAccess(para);
      return !output.join().includes(transformed);
    })
    .forEach((para: string) => {
      const transformed = transformToIntegerAccess(para);
      if (para === 'msgValue') {
        parameters.unshift(`\t${transformed},`);
      } else if (para === 'msgSender') {
        parameters.unshift(`\t${transformed},`);
      } else {
        parameters.push(`\t${transformed},`);
      }
    });
     
    // then we build boilerplate code per state
    switch (stateNode.isWhole) {
      case true:
        output.push(
          Orchestrationbp.generateProof.parameters({
            stateName,
            stateType: 'whole',
            stateVarIds: stateVarIdLines,
            structProperties: stateNode.structProperties,
            reinitialisedOnly: stateNode.reinitialisedOnly,
            burnedOnly: stateNode.burnedOnly,
            accessedOnly: stateNode.accessedOnly,
            isSharedSecret: stateNode.isSharedSecret,
            nullifierRootRequired: !containsNullifierRoot,
            newNullifierRootRequired: !containsNewNullifierRoot,
            initialisationRequired: stateNode.initialisationRequired,
            encryptionRequired: stateNode.encryptionRequired,
            rootRequired: !containsRoot,
            parameters,
          })
        );
        if (!stateNode.reinitialisedOnly) containsRoot = true;
        break;

      case false:
      default:
        switch (stateNode.nullifierRequired) {
          case true:
            // decrement
            if (stateNode.structProperties) stateNode.increment = Object.values(stateNode.increment).flat(Infinity);
            // Below has been removed as it does not appear to be needed. Revisit if issues arise.
            /*stateNode.increment.forEach((inc: any) => {
              // +inc.name tries to convert into a number -  we don't want to add constants here
              if (
                !output.join().includes(`\t${inc.name}.integer`) &&
                !parameters.includes(`\t${inc.name}.integer,`) &&
                !privateStateNames.includes(inc.name) && !inc.accessed &&
                !+inc.name && inc.name
              )
                output.push(`\n\t\t\t\t\t\t\t\t${inc.name}.integer`);
            });*/
            output.push(
              Orchestrationbp.generateProof.parameters({
                stateName,
                stateType: 'decrement',
                stateVarIds: stateVarIdLines,
                structProperties: stateNode.structProperties,
                reinitialisedOnly: false,
                burnedOnly: false,
                nullifierRootRequired: !containsNullifierRoot,
                newNullifierRootRequired: !containsNewNullifierRoot,
                initialisationRequired: false,
                encryptionRequired: stateNode.encryptionRequired,
                rootRequired: !containsRoot,
                accessedOnly: false,
                isSharedSecret: stateNode.isSharedSecret,
                parameters,
              })
            );
            containsNullifierRoot = true;
            containsNewNullifierRoot = true;
            containsRoot = true;
            break;
          case false:
          default:
            // increment
            if (stateNode.structProperties) stateNode.increment = Object.values(stateNode.increment).flat(Infinity);
            // Below has been removed as it does not appear to be needed. Revisit if issues arise.
            /*stateNode.increment.forEach((inc: any) => {
              if (
                !output.join().includes(`\t${inc.name}.integer`) &&
                !parameters.includes(`\t${inc.name}.integer,`) && !inc.accessed &&
                !+inc.name
              )
                output.push(`\n\t\t\t\t\t\t\t\t${inc.name}.integer`);
            });*/
            output.push(
              Orchestrationbp.generateProof.parameters( {
                stateName,
                stateType: 'increment',
                stateVarIds: stateVarIdLines,
                structProperties: stateNode.structProperties,
                reinitialisedOnly: false,
                burnedOnly: false,
                nullifierRootRequired: false,
                newNullifierRootRequired: false,
                initialisationRequired: false,
                encryptionRequired: stateNode.encryptionRequired,
                rootRequired: false,
                accessedOnly: false,
                isSharedSecret: stateNode.isSharedSecret,
                parameters,
              })
            );
            break;
        }
    }
  }
  // we now want to go backwards and calculate where our cipherText is
  let start = 0;
  for (let i = cipherTextLength.length -1; i >= 0; i--) {
    // extract enc key
    enc[1][i] = start === 0 ? enc[1][i].replace('END_SLICE', '') : enc[1][i].replace('END_SLICE', ', ' + start);
    enc[1][i] = enc[1][i].replace('START_SLICE', start - 2);
    // extract cipherText
    enc[0][i] = enc[0][i].replace('END_SLICE', start - 2);
    start -= cipherTextLength[i] + 2;
    enc[0][i] = enc[0][i].replace('START_SLICE', start);
  }
  
   // extract the nullifier Root

  output.push(`\n].flat(Infinity);`);
  return [output, [enc]];
};

export const preimageBoilerPlate = (node: any) => {
  const output: string[][] = [];
  let privateStateName: string;
  let stateNode: any;
  for ([privateStateName, stateNode] of Object.entries(node.privateStates)) {
    const stateVarIds = stateVariableIds({ privateStateName, stateNode });
    const initialiseParams: string[] = [];
    const preimageParams:string[] = [];
    if (stateNode.accessedOnly) {
      output.push(
        Orchestrationbp.readPreimage.postStatements({
          stateName:privateStateName,
          contractName: node.contractName,
          stateType: 'whole',
          mappingName: null,
          mappingKey: null,
          increment: false,
          newOwnerStatment: null,
          reinitialisedOnly: false,
          initialised: stateNode.initialised,
          structProperties: stateNode.structProperties,
          isSharedSecret: stateNode.isSharedSecret,
          accessedOnly: true,
          stateVarIds,
        }));
      continue;
    }

    initialiseParams.push(`\nlet ${privateStateName}_prev = generalise(0);`);
    preimageParams.push(`\t${privateStateName}: 0,`);

    // ownership (PK in commitment)
    const newOwner = stateNode.isOwned ? stateNode.owner : null;
    let newOwnerStatment: string;
    switch (newOwner) {
      case null:
        if(stateNode.isSharedSecret)
        newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? sharedPublicKey : ${privateStateName}_newOwnerPublicKey;`;
        else
        newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? publicKey : ${privateStateName}_newOwnerPublicKey;`;
        break;
      case 'msg':
        if (privateStateName.includes('msg')) {
          newOwnerStatment = `publicKey;`;
        } else if (stateNode.mappingOwnershipType === 'key') {
          // the stateVarId[1] is the mapping key
          newOwnerStatment = `generalise(await instance.methods.zkpPublicKeys(${stateNode.stateVarId[1]}.hex(20)).call()); // address should be registered`;
        } else if (stateNode.mappingOwnershipType === 'value') {
          if (stateNode.reinitialisable){
            newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? publicKey : ${privateStateName}_newOwnerPublicKey;`;
          } else {
            // TODO test below
            // if the private state is an address (as here) its still in eth form - we need to convert
            newOwnerStatment = `await instance.methods.zkpPublicKeys(${privateStateName}.hex(20)).call();
            \nif (${privateStateName}_newOwnerPublicKey === 0) {
              console.log('WARNING: Public key for given eth address not found - reverting to your public key');
              ${privateStateName}_newOwnerPublicKey = publicKey;
            }
            \n${privateStateName}_newOwnerPublicKey = generalise(${privateStateName}_newOwnerPublicKey);`;
          }
        } else {
          if(stateNode.isSharedSecret)
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? sharedPublicKey : ${privateStateName}_newOwnerPublicKey;`;
          else
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? publicKey : ${privateStateName}_newOwnerPublicKey;`;
        }
        break;
      default:
        // TODO - this is the case where the owner is an admin (state var)
        // we have to let the user submit the key and check it in the contract
        if (!stateNode.ownerIsSecret && !stateNode.ownerIsParam) {
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? generalise(await instance.methods.zkpPublicKeys(await instance.methods.${newOwner}().call()).call()) : ${privateStateName}_newOwnerPublicKey;`;
        } else if (stateNode.ownerIsParam && newOwner) {
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? ${newOwner} : ${privateStateName}_newOwnerPublicKey;`;
        } else {
          // is secret - we just use the users to avoid revealing the secret owner
          if(stateNode.isSharedSecret)
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? sharedPublicKey : ${privateStateName}_newOwnerPublicKey;`;
          else
          newOwnerStatment = `_${privateStateName}_newOwnerPublicKey === 0 ? publicKey : ${privateStateName}_newOwnerPublicKey;`

          // BELOW reveals the secret owner as we check the public key in the contract
          // `_${privateStateName}_newOwnerPublicKey === 0 ? generalise(await instance.methods.zkpPublicKeys(${newOwner}.hex(20)).call()) : ${privateStateName}_newOwnerPublicKey;`
        }
        break;
    }

    switch (stateNode.isWhole) {
      case true:
        output.push(
          Orchestrationbp.readPreimage.postStatements({
            stateName: privateStateName,
            contractName: node.contractName,
            stateType: 'whole',
            mappingName: null,
            mappingKey: null,
            initialised: stateNode.initialised,
            structProperties: stateNode.structProperties,
            reinitialisedOnly: stateNode.reinitialisedOnly,
            increment: stateNode.increment,
            newOwnerStatment,
            isSharedSecret: stateNode.isSharedSecret,
            accessedOnly: false,
            stateVarIds,
          }));

        break;
      case false:
      default:
        switch (stateNode.nullifierRequired) {
          case true:
            // decrement
            output.push(
              Orchestrationbp.readPreimage.postStatements({
                stateName: privateStateName,
                contractName: node.contractName,
                stateType: 'decrement',
                mappingName: stateNode.mappingName || privateStateName,
                mappingKey: stateNode.mappingKey
                  ? `[${privateStateName}_stateVarId_key.integer]`
                  : ``,
                increment: stateNode.increment,
                structProperties: stateNode.structProperties,
                newOwnerStatment,
                initialised: false,
                reinitialisedOnly: false,
                isSharedSecret: stateNode.isSharedSecret,
                accessedOnly: false,
                stateVarIds,
              }));

            break;
          case false:
          default:
            // increment
            output.push(
            Orchestrationbp.readPreimage.postStatements({
                stateName: privateStateName,
                contractName: node.contractName,
                stateType: 'increment',
                mappingName: null,
                mappingKey: null,
                increment: stateNode.increment,
                newOwnerStatment,
                structProperties: stateNode.structProperties,
                initialised: false,
                reinitialisedOnly: false,
                isSharedSecret: stateNode.isSharedSecret,
                accessedOnly: false,
                stateVarIds,
              }));

        }
    }
  }
  return output;
};

/**
 * Parses the boilerplate import statements, and grabs any common statements.
 * @param node - must always include stage, for some cases includes other info
 * @return - common statements
 */

export const OrchestrationCodeBoilerPlate: any = (node: any) => {
  const lines: any[] = [];
  const params:any[] = [];
  const states: string[] = [];
  const rtnparams: string[] = [];
  const functionSig: string[] = [];
  let returnInputs: string[] = [];
  let stateName: string;
  let stateNode: any;

  switch (node.nodeType) {
    case 'Imports':
      return { statements:  Orchestrationbp.generateProof.import() }

    case 'FunctionDefinition':
      // the main function class
      if (node.name !== 'cnstrctr') {functionSig.push(
        `export class ${(node.name).charAt(0).toUpperCase() + node.name.slice(1)}Manager {
          constructor(web3) {
            this.web3 = web3;
          }
          
          async init() {
            this.instance = await getContractInstance('${node.contractName}');
            this.contractAddr = await getContractAddress('${node.contractName}');
          }
        `
      );
      lines.push(`
      const instance = this.instance;
      const contractAddr = this.contractAddr;
      const web3 =  this.web3;`)
    }
      if (node.stateMutability !== 'view') {
        lines.push(`let BackupData = [];`);
      } 
      if (node.msgSenderParam)
        lines.push(`
              \nconst msgSender = generalise(config.web3.options.defaultAccount);`);
      if (node.msgValueParam)
        lines.push(`
              \nconst msgValue = 1;`);
              else
              lines.push(`
              \nconst msgValue = 0;`);  
      node.inputParameters.forEach((param: string) => {
        lines.push(`\nlet ${param} = generalise(_${param});`);
        lines.push(`\nconst ${param}_init = generalise(_${param});`);
        params.push(`_${param}`);
      });
      node.parameters.modifiedStateVariables.forEach((param: any) => {
        states.push(`_${param.name}_newOwnerPublicKey = 0`);
        lines.push(
          `\nlet ${param.name}_newOwnerPublicKey = generalise(_${param.name}_newOwnerPublicKey);`,
        );
      });
      if (node.decrementsSecretState) {
        node.decrementedSecretStates.forEach((decrementedState: string) => {
          states.push(` _${decrementedState}_0_oldCommitment = 0`);
          states.push(` _${decrementedState}_1_oldCommitment = 0`);
        });
      }
      let publicReturns = "";
      node.returnParameters.parameters.forEach((paramnode: any) => {
        if (!paramnode.isSecret){
          publicReturns = "publicReturns";
        }
      });
      const decStates = node.decrementedSecretStates;
      const incStates = node.incrementedSecretStates;
      let returnParameterNames = node.returnParameters.parameters
        .filter((paramnode: any) => (paramnode.isSecret || paramnode.typeName.name === 'bool'))
          .map(paramnode => (paramnode.name)) || [];
      returnParameterNames.forEach( (param, index) => {
        if(decStates) {
          if(decStates?.includes(param)){
            returnParameterNames[index] = returnParameterNames[index]+'_change';
          }
        } else if(incStates) {
          if(incStates?.includes(param)){
            returnParameterNames[index] = returnParameterNames[index]+'_newCommitmentValue';
          }
        }
      });
      returnParameterNames.forEach( (param, index) => {
       if(param === 'true')
        rtnparams?.push('bool: bool');
       else 
       rtnparams?.push( ` ${param.replace('_change', '').replace('_newCommitmentValue', '')}_newCommitmentValue : ${param}.integer  `);
     });
      if (params) params[params.length - 1] += `,`;
      let txReturns = "tx, encEvent, encBackupEvent,";
      if (node.stateMutability === 'view'){
        txReturns = "";
      }
      if (node.name === 'cnstrctr')
        return {
          signature: [
            `\n export default async function ${node.name}(${params} ${states}) {`,
            `\nprocess.exit(0);
          \n}`,
          ],
          statements: lines,
        };
      if(rtnparams.length == 0) {
        return {
          signature: [
            `${functionSig}
            \n async  ${node.name}(${params} ${states}) {`,
            `\n return  { ${txReturns} ${publicReturns}};
            \n}
          \n}`,
          ],
          statements: lines,
        };
      }
      if(rtnparams.includes('bool: bool')) {
        return {
          signature: [
            `
            \n async  ${node.name}(${params} ${states}) {`,
            `\n const bool = true; \n return  { ${txReturns} ${rtnparams}, ${publicReturns} };
            \n}
          \n}`,
          ],
          statements: lines,
        };
      }
      return {
        signature: [
          ` ${functionSig}
          \n async ${node.name}(${params} ${states}) {`,
          `\nreturn  { ${txReturns} ${rtnparams}, ${publicReturns}};
          \n}
        \n}`,
        ],
        statements: lines,
      };

    case 'InitialisePreimage':
      for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        let mappingKey: string;
        switch (stateNode.mappingKey) {
          case 'msg':
            // msg.sender => key is _newOwnerPublicKey
            mappingKey = `[${stateName}_stateVarId_key.integer]`;
            break;
          case null:
          case undefined:
            // not a mapping => no key
            mappingKey = ``;
            break;
          default:
            if (+stateNode.mappingKey || stateNode.mappingKey === '0') {
              // we have a constant number
              mappingKey = `[${stateNode.mappingKey}]`;
            } else {
              // any other => a param or accessed var
              mappingKey = `[${stateNode.mappingKey}.integer]`;
            }
        }
        lines.push(
          Orchestrationbp.initialisePreimage.preStatements( {
            stateName,
            accessedOnly: stateNode.accessedOnly,
            stateVarIds: stateVariableIds({ privateStateName: stateName, stateNode}),
            mappingKey,
            mappingName: stateNode.mappingName || stateName,
            structProperties: stateNode.structProperties
          }));
      }
      return {
        statements: lines,
      };

    case 'InitialiseKeys':
      states[0] = node.onChainKeyRegistry ? `true` : `false`;
      return {
        statements: [
          `${Orchestrationbp.initialiseKeys.postStatements(
           node.contractName,
           states[0],
          ) }`,
        ],
      };

    case 'ReadPreimage':
      lines[0] = preimageBoilerPlate(node);
      return {
        statements: [`${params.join('\n')}`, lines[0].join('\n')],
      };

    case 'WritePreimage':
      for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        // TODO commitments with more than one value inside
        switch (stateNode.isPartitioned) {
          case true:
            switch (stateNode.nullifierRequired) {
              case true:
                lines.push(
                  Orchestrationbp.writePreimage.postStatements({
                    stateName,
                    stateType: 'decrement',
                    isSharedSecret: stateNode.isSharedSecret,
                    mappingName: stateNode.mappingName || stateName,
                    mappingKey: stateNode.mappingKey
                      ? `${stateName}_stateVarId_key.integer`
                      : ``,
                    burnedOnly: false,
                    structProperties: stateNode.structProperties,
                    isConstructor: node.isConstructor,
                    reinitialisedOnly: false,
                  }));

                break;
              case false:
              default:
                lines.push(
                    Orchestrationbp.writePreimage.postStatements({
                    stateName,
                    stateType: 'increment',
                    isSharedSecret: stateNode.isSharedSecret,
                    mappingName:stateNode.mappingName || stateName,
                    mappingKey: stateNode.mappingKey
                      ? `${stateName}_stateVarId_key.integer`
                      : ``,
                    burnedOnly: false,
                    structProperties: stateNode.structProperties,
                    isConstructor: node.isConstructor,
                    reinitialisedOnly: stateNode.reinitialisedOnly,
                  }));

                break;
            }
            break;
          case false:
          default:
            lines.push(
                Orchestrationbp.writePreimage.postStatements({
                stateName,
                stateType: 'whole',
                isSharedSecret: stateNode.isSharedSecret,
                mappingName: stateNode.mappingName || stateName,
                mappingKey: stateNode.mappingKey
                  ? `${stateName}_stateVarId_key.integer`
                  : ``,
                burnedOnly: stateNode.burnedOnly,
                reinitialisedOnly: stateNode.reinitialisedOnly,
                structProperties: stateNode.structProperties,
                isConstructor: node.isConstructor,
              }));
        }
      }
      if (node.isConstructor) lines.push(`\nfs.writeFileSync("/app/orchestration/common/db/constructorTx.json", JSON.stringify(tx, null, 4));`)
      return {
        statements: [
          `\n// Write new commitment preimage to db: \n`,
          lines.join('\n'),
        ],
      };

    case 'MembershipWitness':
      for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        const stateVarIds = stateVariableIds({ privateStateName: stateName, stateNode });
        if (node.isConstructor) {
          lines.push([`
            const ${stateName}_index = generalise(0);
            const ${stateName}_root = generalise(0);
            const ${stateName}_path = generalise(new Array(32).fill(0)).all;\n
            `]);
            continue;
        }
        if (stateNode.isPartitioned) {
          lines.push(
            Orchestrationbp.membershipWitness.postStatements({
              stateName,
              contractName: node.contractName,
              stateType: 'partitioned',
              mappingName: stateNode.mappingName || stateName,
              structProperties: stateNode.structProperties,
              isSharedSecret: stateNode.isSharedSecret,
              stateVarIds
            }));

        }
        if (stateNode.accessedOnly) {
          lines.push(
            Orchestrationbp.membershipWitness.postStatements({
              stateName,
              contractName: node.contractName,
              stateType: 'accessedOnly',
              mappingName: stateNode.mappingName || stateName,
              structProperties: stateNode.structProperties,
              isSharedSecret: stateNode.isSharedSecret,
              stateVarIds
            }));

        } else if (stateNode.isWhole) {
          lines.push(
            Orchestrationbp.membershipWitness.postStatements({
              stateName,
              contractName: node.contractName,
              stateType: 'whole',
              mappingName: stateNode.mappingName || stateName,
              structProperties: stateNode.structProperties,
              isSharedSecret: stateNode.isSharedSecret,
              stateVarIds
            }));

        }
      }
      return {
        statements: [`\n// Extract set membership witness: \n\n`, ...lines],
      };

    case 'CalculateNullifier':
        for ([stateName, stateNode] of Object.entries(node.privateStates)) {
          if (stateNode.isPartitioned) {
            lines.push(
              Orchestrationbp.calculateNullifier.postStatements({
                stateName,
                isSharedSecret: stateNode.isSharedSecret,
                accessedOnly: stateNode.accessedOnly,
                stateType: 'partitioned',
              }));
          } else {
            lines.push(
              Orchestrationbp.calculateNullifier.postStatements({
                stateName,
                isSharedSecret: stateNode.isSharedSecret,
                accessedOnly: stateNode.accessedOnly,
                stateType: 'whole',
              }));
          }
        }
        // for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        //   if (stateNode.isPartitioned) {
        //     lines.push(
        //       Orchestrationbp.temporaryUpdatedNullifier.postStatements({
        //         stateName,
        //         accessedOnly: stateNode.accessedOnly,
        //         stateType: 'partitioned',
        //       }));
        //   } else {
        //     lines.push(
        //       Orchestrationbp.temporaryUpdatedNullifier.postStatements({
        //         stateName,
        //         accessedOnly: stateNode.accessedOnly,
        //         stateType: 'whole',
        //       }));
        //   }
        // }
        // for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        //   if (stateNode.isPartitioned) {
        //     lines.push(
        //       Orchestrationbp.calculateUpdateNullifierPath.postStatements({
        //         stateName,
        //         accessedOnly: stateNode.accessedOnly,
        //         stateType: 'partitioned',
        //       }));
  
        //   } else {
        //     lines.push(
        //       Orchestrationbp.calculateUpdateNullifierPath.postStatements({
        //         stateName,
        //         accessedOnly: stateNode.accessedOnly,
        //         stateType: 'whole',
        //       }));
        //   }
        // }
        return {
          statements: [`\n// Calculate nullifier(s): \n`, ...lines],
        };

    case 'CalculateCommitment':
      for ([stateName, stateNode] of Object.entries(node.privateStates)) {
        switch (stateNode.isPartitioned) {
          case undefined:
          case false:
            lines.push(
              Orchestrationbp.calculateCommitment.postStatements( {
                stateName,
                stateType: 'whole',
                isSharedSecret: stateNode.isSharedSecret,
                structProperties: stateNode.structProperties,
              }));
            break;
          case true:
          default:
            switch (stateNode.nullifierRequired) {
              case true:
                // decrement
                lines.push(
                  Orchestrationbp.calculateCommitment.postStatements( {
                    stateName,
                    stateType: 'decrement',
                    isSharedSecret: stateNode.isSharedSecret,
                    structProperties: stateNode.structProperties,
                  }));
                break;
              case false:
              default:
                // increment
                lines.push(
                  Orchestrationbp.calculateCommitment.postStatements( {
                    stateName,
                    stateType: 'increment',
                    isSharedSecret: stateNode.isSharedSecret,
                    structProperties: stateNode.structProperties,
                  }));
            }
        }
      }
      return {
        statements: [`\n\n// Calculate commitment(s): \n`, ...lines],
      };

    case 'GenerateProof':
      [ lines[0], params[0] ] = generateProofBoilerplate(node);
      return {
        statements: [
          `\n\n// Call Zokrates to generate the proof:
          \nconst allInputs = [`,
          `${lines[0]}`,
          `\nconst res = await generateProof('${node.circuitName}', allInputs);`,
          `\nconst proof = generalise(Object.values(res.proof).flat(Infinity))
          .map(coeff => coeff.integer)
          .flat(Infinity);`,
          `${params[0].flat(Infinity).join('\n')}`
        ],
      };

    case 'EncryptBackupPreimage':
        for ([stateName, stateNode] of Object.entries(node.privateStates)) {
          let stateType;
          if (stateNode.isWhole) {
            stateType = 'whole';
          } else if (stateNode.nullifierRequired) {
            stateType = 'decrement';
          } else {
            stateType = 'increment';
          }
          lines.push(
            Orchestrationbp.encryptBackupPreimage.postStatements( {
              stateName,
              stateType,
              structProperties: stateNode.structProperties,
              encryptionRequired: stateNode.encryptionRequired,
              mappingName: stateNode.mappingName || stateName,
              mappingKey: stateNode.mappingKey
                  ? `${stateName}_stateVarId_key.integer`
                  : ``,
            }));
        }
        return {
          statements: lines,
        };
  

    case 'SendTransaction':
      if (node.publicInputs[0]) {
        node.publicInputs.forEach((input: any) => {
          if (input.properties) {
            lines.push(`[${input.properties.map(p => p.type === 'bool' ? `(${input.name}_init${input.isConstantArray ? '.all' : ''}.${p.name}.integer === "1")` : `${input.name}_init${input.isConstantArray ? '.all' : ''}.${p.name}.integer`).join(',')}]`);
          } else if (input.isConstantArray) {
            lines.push(`${input.name}_init.all.integer`);
          } else if(input.isBool) {
            lines.push(`parseInt(${input.name}_init.integer, 10)`);
          } else if(input.isAddress) {
            lines.push(`${input.name}_init.hex(20)`);
          }
          else {
            lines.push(`${input}_init.integer`);
          }           
        });
      }

      if(node.returnInputs[0]) {
        node.returnInputs.forEach((input: any) => { 
          input == 'true' ? returnInputs.push(`1`) : input == 'false' ? returnInputs.push(`0`) : returnInputs.push(input+'.integer');
          
        })
      } 
  
      params[0] = sendTransactionBoilerplate(node);
      if(!node.returnInputs[0] && !params[0][5][0]) returnInputs.push(`1`); // If there are no return, circuit's default return is true
      // params[0] = arr of nullifier 
      // params[1] = arr of commitment root(s)
      // params[3] = arr of commitments
      (params[0][0][0]) ? params[0][0] = ` [${params[0][0]}],` : params[0][0] = ` [],  `; // nullifiers - array
      (params[0][1][0]) ? params[0][1] = ` ${params[0][1][0]}, ` : params[0][1] = ` 0, `;  // commitmentRoot 
      (params[0][2][0]) ? params[0][2] = ` [${params[0][2]}],` : params[0][2] = ` [] , ` ; // commitment -array
      (params[0][3][0]) ? params[0][3] = `[${params[0][3]}],` : params[0][3] = ` [], `; // accessed nullifiers -array
      (params[0][4][0]) ? params[0][4] = `[${params[0][4]}],` : params[0][4] = ` [], `; // cipherText - array of arrays
      (params[0][5][0]) ? params[0][5] = `[${params[0][5]}],`: params[0][5] = ` [], `;// cipherText - array of arrays

      if (node.functionName === 'cnstrctr'){
        const publicInputs: any[] = [];
        if (node.publicInputs[0]) {
          node.publicInputs.forEach((input: any) => {
            if (input.properties) {
              publicInputs.push(`${input.name}: [${input.properties.map(p => p.type === 'bool' ? `(${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer === "1")` : `${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer`).join(',')}]`);
            } else if (input.isConstantArray) {
              publicInputs.push(`${input.name}: ${input.name}.all.integer`);
            } else if(input.isBool) {
              publicInputs.push(`${input.name}: parseInt(${input.name}.integer, 10)`);
            } else if(input.isAddress) {
              publicInputs.push(`${input.name}: ${input.name}.hex(20)`);
            }
            else {
              publicInputs.push(`${input}: ${input}.integer`);
            }           
          });
        }
        return {
          statements: [
            `\n\n// Save transaction for the constructor:
            \nBackupData.forEach((element) => {
              element.cipherText = element.cipherText.map(ct => generalise(ct).hex(32));
            });
            \nconst tx = { proofInput: [{customInputs: [${returnInputs}], newNullifiers: ${params[0][0]} commitmentRoot:${params[0][1]} checkNullifiers: ${params[0][3]} newCommitments: ${params[0][2]} cipherText:${params[0][4]}  encKeys: ${params[0][5]}}, proof, BackupData], nullifiers: ${params[0][1]} ${publicInputs}};`
          ]
        }
      }
      let returnsCall = "";
      if (node.isPublicReturns){
        returnsCall = `\n\n// Get returns:
        \nlet publicReturns = await instance.methods
        .${node.functionName}(${lines.length > 0 ? `${lines},`: ``} {customInputs: [${returnInputs}], newNullifiers: ${params[0][0]}  commitmentRoot:${params[0][1]} checkNullifiers: ${params[0][3]}  newCommitments: ${params[0][2]}  cipherText:${params[0][4]}  encKeys: ${params[0][5]}}, proof, BackupData).call();
        publicReturns = JSON.parse(
          JSON.stringify(publicReturns, (key, value) =>
            typeof value === "bigint" ? value.toString() : value
          )
        );`;
      }  

      if (node.isReadOnly){
        return {
          statements: [
            `${returnsCall}`,
          ],
        };
      }
      let checkLeaves = 
        `\n tx = tx[0];\n
        \n if (!tx) {
          throw new Error( 'Tx failed - the commitment was not accepted on-chain, or the contract is not deployed.');
        } \n`;
      if (!node.newCommitmentsRequired){
        checkLeaves = '';
      }
      return {
        statements: [
          `${returnsCall}
          \n\n// Send transaction to the blockchain:
          \nconst txData = await instance.methods
          .${node.functionName}(${lines.length > 0 ? `${lines},`: ``} {customInputs: [${returnInputs}], newNullifiers: ${params[0][0]}  commitmentRoot:${params[0][1]} checkNullifiers: ${params[0][3]}  newCommitments: ${params[0][2]}  cipherText:${params[0][4]}  encKeys: ${params[0][5]}}, proof, BackupData).encodeABI();
          \n	let txParams = {
            from: config.web3.options.defaultAccount,
            to: contractAddr,
            gas: config.web3.options.defaultGas,
            gasPrice: config.web3.options.defaultGasPrice,
            data: txData,
            chainId: await web3.eth.net.getId(),
            };
            \n 	const key = config.web3.key;
            \n 	const signed = await web3.eth.accounts.signTransaction(txParams, key);
            \n 	const sendTxn = await web3.eth.sendSignedTransaction(signed.rawTransaction);
            \n  let tx = await instance.getPastEvents("NewLeaves", {fromBlock: sendTxn?.blockNumber || 0, toBlock: sendTxn?.blockNumber || 'latest'});
            ${checkLeaves}
            let encEvent = '';
            \n try {
            \n  encEvent = await instance.getPastEvents("EncryptedData", {fromBlock: sendTxn?.blockNumber || 0, toBlock: sendTxn?.blockNumber || 'latest'});
            \n } catch (err) {
            \n  console.log('No encrypted event');
            \n}
            \nlet encBackupEvent = '';
            \n try {
            \n  encBackupEvent = await instance.getPastEvents("EncryptedBackupData", {fromBlock: sendTxn?.blockNumber || 0, toBlock: sendTxn?.blockNumber || 'latest'});
            \n } catch (err) {
            \n  console.log('No encrypted backup event');
            \n}`,

          // .send({
          //     from: config.web3.options.defaultAccount,
          //     gas: config.web3.options.defaultGas,
          //     value: msgValue,
          //   });\n`,
        ],
      };
  
    case 'SendPublicTransaction':  
      if (node.functionName === 'cnstrctr') {
        if (node.publicInputs[0]) {
          node.publicInputs.forEach((input: any) => {
            if (input.properties) {
              lines.push(`${input.name}: [${input.properties.map(p => p.type === 'bool' ? `(${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer === "1")` : `${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer`).join(',')}]`);
            } else if (input.isConstantArray) {
              lines.push(`${input.name}: ${input.name}.all.integer`);
            } else if(input.isBool) {
              lines.push(`${input.name}: parseInt(${input.name}.integer, 10)`);
            } else if(input.isAddress) {
              lines.push(`${input.name}: ${input.name}.hex(20)`);
            }
            else {
              lines.push(`${input}: ${input}.integer`);
            }           
          });
        }
        return {
          statements: [
            `\n\n// Save transaction for the constructor:
            \nconst tx = { ${lines}};
            \nfs.writeFileSync("/app/orchestration/common/db/constructorTx.json", JSON.stringify(tx, null, 4));`
          ]
        }
      } 

      if (node.publicInputs[0]) {
        node.publicInputs.forEach((input: any) => {
          if (input.properties) {
            lines.push(`[${input.properties.map(p => p.type === 'bool' ? `(${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer === "1")` : `${input.name}${input.isConstantArray ? '.all' : ''}.${p.name}.integer`).join(',')}]`);
          } else if (input.isConstantArray) {
            lines.push(`${input.name}.all.integer`);
          } else if(input.isBool) {
            lines.push(`parseInt(${input.name}.integer, 10)`);
          } else if(input.isAddress) {
            lines.push(`${input.name}.hex(20)`);
          }
          else {
            lines.push(`${input}.integer`);
          }           
        });
      }
      let returnsCallPublic = "";
      if (node.isPublicReturns){
        returnsCallPublic = `\n\n// Get returns:
        \nlet publicReturns = await instance.methods.${node.functionName}(${lines}).call();
        publicReturns = JSON.parse(
          JSON.stringify(publicReturns, (key, value) =>
            typeof value === "bigint" ? value.toString() : value
          )
        );`;
      } 

      if (node.isReadOnly){
        return {
          statements: [
            `${returnsCallPublic}`,
          ],
        };
      }

      return {
        statements: [
          `${returnsCallPublic}
          \n\n// Send transaction to the blockchain:
           \nconst txData = await instance.methods.${node.functionName}(${lines}).encodeABI();
          \nlet txParams = {
            from: config.web3.options.defaultAccount,
            to: contractAddr,
            gas: config.web3.options.defaultGas,
            gasPrice: config.web3.options.defaultGasPrice,
            data: txData,
            chainId: await web3.eth.net.getId(),
          };
          \nconst key = config.web3.key;
          \nconst signed = await web3.eth.accounts.signTransaction(txParams, key);
          \nconst tx = await web3.eth.sendSignedTransaction(signed.rawTransaction);
          \nconst encEvent = {};
          \nconst encBackupEvent ={};
         `
        ]
      }
      default:
        return {};
  }
};

export default OrchestrationCodeBoilerPlate;
