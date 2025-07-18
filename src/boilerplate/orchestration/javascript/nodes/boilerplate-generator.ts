/* eslint-disable consistent-return */
import { StateVariableIndicator } from '../../../../traverse/Indicator.js';
import MappingKey from '../../../../traverse/MappingKey.js';
import buildNode from '../../../../types/orchestration-types.js';

/**
 * @param {string} nodeType - the type of node you'd like to build
 * @param {Object} fields - important key, value pairs to include in the node, and which enable the rest of the node's info to be derived. How do you know which data to include in `fields`? Read this function.
 */
export function buildPrivateStateNode(nodeType: string, fields: any = {}): any {
  switch (nodeType) {
    case 'InitialisePreimage': {
      const { privateStateName, id, accessedOnly = false, indicator = {} } = fields;
      return {
        privateStateName,
        stateVarId: id,
        accessedOnly,
        mappingKey: indicator.isMapping ? indicator.referencedKeyName || indicator.keyPath.node.name : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
        structProperties: indicator.isStruct ? Object.keys(indicator.structProperties) : null,
      };
    }
    case 'ReadPreimage': {
      const {
        id,
        increment,
        initialised,
        reinitialisedOnly,
        accessedOnly,
        indicator = {},
      } = fields;
      return {
        increment,
        stateVarId: id,
        isSharedSecret: indicator.isSharedSecret,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        structProperties: indicator.isStruct ? Object.keys(indicator.structProperties) : null,
        mappingKey: indicator.isMapping ? indicator.referencedKeyName || indicator.keyPath.node.name : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
        nullifierRequired: indicator.isNullified,
        reinitialisedOnly,
        accessedOnly,
        initialised,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
        ownerIsParam: indicator.isOwned ? indicator.owner.isParam : null,
        reinitialisable: (indicator instanceof MappingKey) ? indicator.container.binding.reinitialisable : (indicator instanceof StateVariableIndicator) ? indicator.binding.reinitialisable: null,
      };
    }
    case 'WritePreimage': {
      const { id, increment, burnedOnly, reinitialisedOnly, indicator = {} } = fields
      return {
        increment,
        stateVarId: id,
        isSharedSecret: indicator.isSharedSecret,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        structProperties: indicator.isStruct ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.map(m => m.name) : null,
        mappingKey: indicator.isMapping ? indicator.referencedKeyName || indicator.keyPath.node.name : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
        nullifierRequired: indicator.isNullified,
        burnedOnly,
        reinitialisedOnly,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
      };
    }
    case 'MembershipWitness': {
      const {
        id,
        increment,
        privateStateName,
        accessedOnly,
        indicator = {},
      } = fields;
      return {
        increment,
        stateVarId: id,
        isSharedSecret: indicator.isSharedSecret,
        privateStateName,
        accessedOnly,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        structProperties: indicator.isStruct ? Object.keys(indicator.structProperties) : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
      };
    }
    case 'CalculateNullifier': {
      const { increment, accessedOnly = false, indicator = {} } = fields;
      return {
        increment,
        accessedOnly,
        isSharedSecret: indicator.isSharedSecret,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
      };
    }
    case 'CalculateCommitment': {
      const { id, increment, privateStateName, indicator = {} } = fields;
      return {
        privateStateName,
        stateVarId: id,
        increment,
        isSharedSecret: indicator.isSharedSecret,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        nullifierRequired: indicator.isNullified,
        structProperties: indicator.isStruct ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.map(m => m.name) : null,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
      };
    }
    case 'GenerateProof': {
      const {
        id,
        increment,
        reinitialisedOnly,
        burnedOnly,
        accessedOnly,
        privateStateName,
        indicator = {},
        localMappingKey,
      } = fields;
      const structProperties = !indicator.isStruct ? null : indicator.isAccessed ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.map(m => m.name) : Object.keys(indicator.structProperties);
      return {
        privateStateName,
        stateVarId: id,
        reinitialisedOnly,
        burnedOnly,
        accessedOnly,
        isSharedSecret: indicator.isSharedSecret,
        nullifierRequired: indicator.isNullified,
        increment,
        structProperties,
        isMapping: indicator.isMapping,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        initialisationRequired: indicator.initialisationRequired,
        encryptionRequired: indicator.encryptionRequired,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
        localMappingKey: localMappingKey,
      };
    }

    case 'EncryptBackupPreimage': {
      const { id, increment, privateStateName, indicator = {} } = fields;
      return {
        privateStateName,
        stateVarId: id,
        increment,
        mappingKey: indicator.isMapping ? indicator.referencedKeyName || indicator.keyPath.node.name : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        nullifierRequired: indicator.isNullified,
        structProperties: indicator.isStruct ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.map(m => m.name) : null,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        encryptionRequired: indicator.encryptionRequired,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
      };
    }
    case 'SendTransaction': {
      const {
        increment,
        reinitialisedOnly,
        burnedOnly,
        accessedOnly,
        indicator = {},
      } = fields;
      return {
        increment,
        isPartitioned: indicator.isPartitioned,
        isWhole: indicator.isWhole,
        reinitialisedOnly,
        burnedOnly,
        accessedOnly,
        encryptionRequired: indicator.encryptionRequired,
        nullifierRequired: indicator.isNullified,
      };
    }

    case 'buildBoilerplateReciever': {
      const { id, increment, privateStateName, indicator = {} } = fields;
      return {
        privateStateName,
        stateVarId: id,
        increment,
        mappingKey: indicator.isMapping ? indicator.referencedKeyName || indicator.keyPath.node.name : null,
        mappingName: indicator.isMapping ? indicator.node?.name : null,
        isWhole: indicator.isWhole,
        isPartitioned: indicator.isPartitioned,
        structProperties: indicator.isStruct ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.map(m => m.name) : null,
        isOwned: indicator.isOwned,
        mappingOwnershipType: indicator.mappingOwnershipType,
        encryptionRequired: indicator.encryptionRequired,
        owner: indicator.isOwned
          ? indicator.owner.node?.name || indicator.owner.name
          : null,
        ownerIsSecret: indicator.isOwned
          ? indicator.owner.isSecret || indicator.owner.node?.isSecret
          : null,
      };
    }

    default:
      throw new TypeError(nodeType);
  }
}

/**
 * @param {string} nodeType - the type of node you'd like to build
 * @param {Object} fields - important key, value pairs to include in the node, and which enable the rest of the node's info to be derived. How do you know which data to include in `fields`? Read this function.
 */
export function buildBoilerplateNode(nodeType: string, fields: any = {}): any {
  switch (nodeType) {
    case 'InitialiseKeys': {
      const { onChainKeyRegistry, contractName } = fields;
      return {
        nodeType,
        contractName,
        onChainKeyRegistry,
      };
    }
    case 'InitialisePreimage': {
      const { privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
      };
    }
    case 'ReadPreimage': {
      const { contractName, privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
        contractName,
      };
    }
    case 'WritePreimage': {
      const {
        contractName,
        onChainKeyRegistry = false,
        privateStates = {},
      } = fields;
      return {
        nodeType,
        privateStates,
        contractName,
        onChainKeyRegistry,
      };
    }
    case 'MembershipWitness': {
      const { contractName, privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
        contractName,
      };
    }
    case 'CalculateNullifier': {
      const { privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
      };
    }
    case 'CalculateCommitment': {
      const { privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
      };
    }
    case 'GenerateProof': {
      const { circuitName, privateStates = {}, parameters = [] } = fields;
      return {
        nodeType,
        circuitName,
        privateStates,
        parameters,
      };
    }
    case 'EncryptBackupPreimage': {
      const { privateStates = {} } = fields;
      return {
        nodeType,
        privateStates,
      };
    }
    case 'SendTransaction': {
      const {
        functionName,
        contractName,
        publicInputs = [],
        returnInputs = [],
        privateStates = {},
        publicReturns,
        isReadOnly,
        newCommitmentsRequired,
      } = fields;
      return {
        nodeType,
        privateStates,
        functionName,
        contractName,
        publicInputs,
        returnInputs,
        publicReturns,
        isReadOnly,
        newCommitmentsRequired,
      };
    }
    case 'SendPublicTransaction': {
      const {
        functionName,
        contractName,
        publicInputs = [],
        isPublicReturns,
        isReadOnly,
      } = fields;
      return {
        nodeType,
        functionName,
        contractName,
        publicInputs,
        isPublicReturns,
        isReadOnly,
      };
    }
    case 'SetupCommonFilesBoilerplate': {
      const {
        contractName,
        functionNames = [],
        constructorParams = [],
        contractImports = [],
        isConstructor = false,
      } = fields;
      return {
        nodeType,
        contractName,
        functionNames,
        constructorParams,
        contractImports,
        isConstructor,
      };
    }
    case 'EditableCommitmentCommonFilesBoilerplate': {
      return {
        nodeType,
      };
    }
    // TODO link to buildNode for function -> param list -> buildPrivateStateNode
    case 'IntegrationTestBoilerplate': {
      const {
        contractName,
        functions = [],
        constructorParams = [],
        contractImports = [],
      } = fields;
      return {
        nodeType,
        contractName,
        functions,
        constructorParams,
        contractImports,
      };
    }
    case 'IntegrationApiServicesBoilerplate': {
      const {
        contractName,
        functionNames = [],
        functions = [],
        constructorParams = [],
        contractImports = [],
      } = fields;
      return {
        nodeType,
        contractName,
        functionNames,
        functions,
        constructorParams,
        contractImports,
      };
    }
    case 'IntegrationApiRoutesBoilerplate': {
      const {
        contractName,
        functions = [],
        contractImports = [],
      } = fields;
      return {
        nodeType,
        contractName,
        functions,
        contractImports,
      };
    }
    case 'IntegrationEncryptedListenerBoilerplate': {
      const {
        contractName,
        stateVariables = [],
      } = fields;
      return {
        nodeType,
        contractName,
        stateVariables
      };
    }
    case 'IntegrationTestFunction': {
      const {
        name,
        parameters = buildNode('ParameterList', fields),
        decrementsSecretState = false,
        encryptionRequired = false,
      } = fields;
      return {
        nodeType,
        name,
        parameters,
        decrementsSecretState,
        encryptionRequired,
      };
    }
    case 'IntegrationApiServiceFunction': {
      const {
        name,
        parameters = buildNode('ParameterList', fields),
        returnParameters =  buildNode('ParameterList', fields),
        decrementsSecretState = [],
        isConstructor = false,
        stateMutability,
      } = fields;
      return {
        nodeType,
        name,
        parameters,
        returnParameters,
        decrementsSecretState,
        isConstructor,
        stateMutability,
      };
    }
    case 'IntegrationPublicApiServiceFunction': {
      const {
        name,
        parameters = buildNode('ParameterList', fields),
        returnParameters =  buildNode('ParameterList', fields),
        isConstructor = false,
        stateMutability,
      } = fields;
      return {
        nodeType,
        name,
        parameters,
        returnParameters,
        isConstructor,
        stateMutability,
      };
    }
    case 'IntegrationApiRoutesFunction': {
      const {
        name,
        stateMutability,
      } = fields;
      return {
        nodeType,
        name,
        stateMutability,
      };
    }

    case 'BackupDataRetrieverBoilerplate': {
      const {
        contractName,
        privateStates = [],
      } = fields;
      return {
        nodeType,
        contractName,
        privateStates,
      };
    }

    case 'BackupVariableBoilerplate': {
      const {
        contractName,
        privateStates = [],
      } = fields;
      return {
        nodeType,
        contractName,
        privateStates,
      };
    }

    default:
      throw new TypeError(nodeType);
  }
}
