/* eslint-disable no-param-reassign, no-shadow, no-continue */

import cloneDeep from 'lodash.clonedeep';
import { buildNode } from '../../types/zokrates-types.js';
import { TODOError } from '../../error/errors.js';
import { traversePathsFast, traverseNodesFast } from '../../traverse/traverse.js';
import NodePath from '../../traverse/NodePath.js';
import explode from './explode.js';
import internalCallVisitor from './circuitInternalFunctionCallVisitor.js';
import { VariableBinding } from '../../traverse/Binding.js';
import { StateVariableIndicator} from '../../traverse/Indicator.js';
import { LocalVariableIndicator} from '../../traverse/Indicator.js';
import { interactsWithSecretVisitor, internalFunctionCallVisitor, parentnewASTPointer, getIndexAccessName } from './common.js';




// Adjusts names of indicator.increment so that they match the names of the corresponding indicators i.e. index_1 instead of index
const incrementNames = (node: any, indicator: any) => {
  if (node.bpType === 'incrementation'){
    let rhsNode = node.addend;
    const adjustIncrementsVisitor = (thisNode: any) => {
      if (thisNode.nodeType === 'Identifier'){
        if (!indicator.increments.some((inc: any) => inc.name === thisNode.name)){
          let lastUnderscoreIndex = thisNode.name.lastIndexOf("_");
          let origName = thisNode.name.substring(0, lastUnderscoreIndex); 
          let count =0;
          indicator.increments.forEach((inc: any) => {
            if (origName === inc.name && !inc.modName && count === 0){
              inc.modName = thisNode.name;
              count++;
            }
          });
        }
      }     
    }
    if (rhsNode) traverseNodesFast(rhsNode, adjustIncrementsVisitor);
  } else if (node.bpType === 'decrementation'){
    let rhsNode = node.subtrahend;
    const adjustDecrementsVisitor = (thisNode: any) => {
      if (thisNode.nodeType === 'Identifier'){
        if (!indicator.decrements.some((dec: any) => dec.name === thisNode.name)){
          let lastUnderscoreIndex = thisNode.name.lastIndexOf("_");
          let origName = thisNode.name.substring(0, lastUnderscoreIndex); 
          let count =0;
          indicator.decrements.forEach((dec: any) => {
            if (origName === dec.name && !dec.modName && count === 0){
              dec.modName = thisNode.name;
              count++;
            }
          });
        }
      }     
    }
    if (rhsNode) traverseNodesFast(rhsNode, adjustDecrementsVisitor);
  }
};


//Finds a statement with the correct ID 
const findStatementId = (statements: any, ID: number) => {
  let expNode = statements.find((n:any) => n?.id === ID);
  let index_expNode = statements.indexOf(expNode);
  let location = {index: index_expNode, trueIndex: -1, falseIndex: -1};
  statements.forEach((st:any) => {
    if (st.trueBody){
      if (!expNode) {
        expNode = st.trueBody.find((n:any) => n?.id === ID);
        location.index = statements.indexOf(st);
        location.trueIndex = st.trueBody.indexOf(expNode);
      }
    } 
    if (st.falseBody){
      if (!expNode) {
        expNode = st.falseBody.find((n:any) => n?.id === ID);
        location.index = statements.indexOf(st);
        location.falseIndex = st.falseBody.indexOf(expNode);
      } 
    }
  });
  return {expNode, location};
};


// public variables that interact with the secret also need to be modified within the circuit.
const publicVariables = (path: NodePath, state: any, IDnode: any) => {
  const {parent, node } = path;
  // Break if the identifier is a mapping or array. 
  if ( parent.indexExpression && parent.baseExpression === node ) {
    return;}
  const binding = path.getReferencedBinding(node);
  if (!['Identifier', 'IndexAccess'].includes(path.nodeType)) return;
  
  // If there is a statement where a secret variable interacts with a public one, we need to adjust previous statements where the public variable was modified.

  
  if (
    binding instanceof VariableBinding &&
    (node.interactsWithSecret || node.baseExpression?.interactsWithSecret) &&
    (node.interactsWithPublic || node.baseExpression?.interactsWithPublic) &&
    binding.stateVariable && !binding.isSecret 
  ) 
  {
    const fnDefNode = path.getAncestorOfType('FunctionDefinition');
    if (!fnDefNode) throw new Error(`Not in a function`);

    const modifiedBeforePaths = path.scope.getReferencedIndicator(node, true)?.modifyingPaths?.filter((p: NodePath) => p.node.id < node.id);
    const statements = fnDefNode.node._newASTPointer.body.statements;

    let num_modifiers=0;
    // For each statement that modifies the public variable previously, we need to ensure that the modified variable is stored for later. 
    // We also need that the original public variable is updated, e.g if the statement is index_2 = index +1, we need an extra statement index = index_2.
    modifiedBeforePaths?.forEach((p: NodePath) => {
      const expressionId = p.getAncestorOfType('ExpressionStatement')?.node?.id;
      if (expressionId) {
        if (path.containerName !== 'indexExpression') {
          num_modifiers++;
        } 
        let {expNode, location} = findStatementId(statements, expressionId);
        if (expNode && !expNode.isAccessed) {
          expNode.isAccessed = true;
          if((expNode.expression &&  expNode.expression.leftHandSide && expNode.expression.leftHandSide?.name === node.name) || 
          (expNode.initialValue &&  expNode.initialValue.leftHandSide &&  expNode.initialValue.leftHandSide?.name === node.name) ||
          (expNode.expression.initialValue &&  expNode.expression.initialValue.name === node.name)){
            if (num_modifiers !=0){
              const initInnerNode = buildNode('Assignment', {
                leftHandSide: buildNode('Identifier', { name: `${node.name}_${num_modifiers}`, subType: 'generalNumber'  }),
                operator: '=',
                rightHandSide: buildNode('Identifier', { name: `${node.name}`, subType: 'generalNumber' })
              });
              const newNode1 = buildNode('ExpressionStatement', {
                  expression: initInnerNode,
                  interactsWithSecret: true,
                  isVarDec: true,
              });
              newNode1.outsideIf = true;
              if (location.index!== -1) {
                if (location.trueIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].trueBody.splice(location.trueIndex + 1, 0, newNode1); }
                else if (location.falseIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].falseBody.splice(location.falseIndex + 1, 0, newNode1); }
                else {fnDefNode.node._newASTPointer.body.statements.splice(location.index + 1, 0, newNode1);}
              }
            }
          } else{
            let modName = expNode.expression.initialValue?.leftHandSide?.name || expNode.expression.initialValue?.name || expNode.expression.leftHandSide?.name;
            const InnerNode = buildNode('Assignment', {
              leftHandSide: buildNode('Identifier', { name: `${node.name}`, subType: 'generalNumber'  }),
              operator: '=',
              rightHandSide: buildNode('Identifier', { name: `${modName}`, subType: 'generalNumber' })
            });
            const newNode1 = buildNode('ExpressionStatement', {
              expression: InnerNode,
              interactsWithSecret: true,
            });
            newNode1.outsideIf = true;
            if (location.index!== -1) {
              if (location.trueIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].trueBody.splice(location.trueIndex + 1, 0, newNode1); }
              else if (location.falseIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].falseBody.splice(location.falseIndex + 1, 0, newNode1); }
              else {fnDefNode.node._newASTPointer.body.statements.splice(location.index + 1, 0, newNode1);}
            }
            if (`${modName}` !== `${node.name}_${num_modifiers}` && num_modifiers !==0){
              const initInnerNode1 = buildNode('Assignment', {
                leftHandSide: buildNode('Identifier', { name: `${node.name}_${num_modifiers}`, subType: 'generalNumber'  }),
                operator: '=',
                rightHandSide: buildNode('Identifier', { name: `${node.name}`, subType: 'generalNumber' })
              });
              const newNode2 = buildNode('ExpressionStatement', {
                  expression: initInnerNode1,
                  interactsWithSecret: true,
                  isVarDec: true,
              });
              newNode2.outsideIf = true;
              if (location.index!== -1) {
                if (location.trueIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].trueBody.splice(location.trueIndex + 2, 0, newNode2); }
                else if (location.falseIndex !== -1){ fnDefNode.node._newASTPointer.body.statements[location.index].falseBody.splice(location.falseIndex + 2, 0, newNode2); }
                else {fnDefNode.node._newASTPointer.body.statements.splice(location.index + 2, 0, newNode2);}
              }
            }
          }
        }
      }
    });
    // We ensure here that the public variable used has the correct name, e.g index_2 instead of index.
    if (num_modifiers != 0)  {
      if (IDnode.name === node.name){
        IDnode.name += `_${num_modifiers}`;
      } else {
        IDnode.name =  `${node.name}_${num_modifiers}`;
      }
    }
    // After the non-secret variables have been modified we need to reset the original variable name to its initial value.
    // e.g. index = index_init. 
    for (let i = fnDefNode.node._newASTPointer.body.statements.length - 1; i >= 0; i--) {
      const p = fnDefNode.node._newASTPointer.body.statements[i];
      if (p.expression?.rightHandSide?.name === `${node.name}_init`) {
        fnDefNode.node._newASTPointer.body.statements.splice(i, 1);
      }
    }
    const endNodeInit = buildNode('Assignment', {
      leftHandSide: buildNode('Identifier', { name: `${node.name}`, subType: 'generalNumber'   }),
      operator: '=',
      rightHandSide: buildNode('Identifier', { name: `${node.name}_init`, subType: 'generalNumber' }),
    });
    const endNode = buildNode('ExpressionStatement', {
        expression: endNodeInit,
        interactsWithSecret: true,
        isVarDec: false,
    });
    endNode.isEndInit = true;
    fnDefNode.node._newASTPointer.body.statements.push(endNode);
  }
  // We no longer need this because index expression nodes are not input. 
    //if (['Identifier', 'IndexAccess'].includes(node.indexExpression?.nodeType)) publicVariables(NodePath.getPath(node.indexExpression), state, null);
}

//Visitor for publicVariables
const publicVariablesVisitor = (thisPath: NodePath, thisState: any) => {
  const { node } = thisPath;
  let { name } = node;
  if (!['Identifier', 'IndexAccess'].includes(thisPath.nodeType)) return;
  const binding = thisPath.getReferencedBinding(node);
      if ( (binding instanceof VariableBinding) && !binding.isSecret && 
      binding.stateVariable && thisPath.getAncestorContainedWithin('rightHandSide') ){
      } else{
        name = thisPath.scope.getIdentifierMappingKeyName(node);
      }
      const newNode = buildNode(
        node.nodeType,
        { name, type: node.typeDescriptions?.typeString },
      );
  publicVariables(thisPath, thisState, newNode);
};


// below stub will only work with a small subtree - passing a whole AST will always give true!
// useful for subtrees like ExpressionStatements
const publicInputsVisitor = (thisPath: NodePath, thisState: any) => {
  const { node } = thisPath;

  if (!['Identifier', 'IndexAccess'].includes(thisPath.nodeType)) return;
  if(node.typeDescriptions.typeIdentifier.includes(`_function_`)) return;
  if (thisPath.isRequireStatement(node)) return;

  let { name } = thisPath.isMsg(node) ? node : thisPath.scope.getReferencedIndicator(node, true);
  const binding = thisPath.getReferencedBinding(node);
  let isCondition = !!thisPath.getAncestorContainedWithin('condition') && thisPath.getAncestorOfType('IfStatement')?.containsSecret;
  let isForCondition = !!thisPath.getAncestorContainedWithin('condition') && thisPath.getAncestorOfType('ForStatement')?.containsSecret;
  const isInitializationExpression = !!thisPath.getAncestorContainedWithin('initializationExpression') && thisPath.getAncestorOfType('ForStatement')?.containsSecret;
  const isLoopExpression = !!thisPath.getAncestorContainedWithin('loopExpression') && thisPath.getAncestorOfType('ForStatement')?.containsSecret;
  //Check if for-if statements are both together.
  if(thisPath.getAncestorContainedWithin('condition') && thisPath.getAncestorOfType('IfStatement') &&  thisPath.getAncestorOfType('ForStatement')){
    //Currently We only support if statements inside a for loop no the other way around, so getting the public inputs according to inner if statement
    if((thisPath.getAncestorOfType('IfStatement')).getAncestorOfType('ForStatement'))
    isForCondition = isCondition;
  }
  // below: we have a public state variable we need as a public input to the circuit
  // local variable decs and parameters are dealt with elsewhere
  // secret state vars are input via commitment values
  if (
    binding instanceof VariableBinding &&
    (node.interactsWithSecret || node.baseExpression?.interactsWithSecret || isCondition || isForCondition || isInitializationExpression || isLoopExpression) &&
    (node.interactsWithPublic || node.baseExpression?.interactsWithPublic || isCondition || isForCondition || isInitializationExpression || isLoopExpression) &&
    binding.stateVariable && !binding.isSecret &&
    // if the node is the indexExpression, we dont need its value in the circuit unless its a public state variable which is needed for the stateVarId
    !(thisPath.containerName === 'indexExpression' && !(thisPath.parentPath.isSecret|| thisPath.parent.containsSecret))
  ) {
    // TODO other types
    if (thisPath.isMapping() || thisPath.isArray())
      name = name.replace('[', '_').replace(']', '').replace('.sender', 'Sender').replace('.value','Value');
    let nodeTypeString = node.typeDescriptions.typeString === 'bool' ? 'bool': 'field';
    // We never need the input to the circuit to be the MappingKeyName
    //if (thisPath.containerName === 'indexExpression'){
    //  name = binding.getMappingKeyName(thisPath);
    //}
    const parameterNode = buildNode('VariableDeclaration', { name, type: nodeTypeString, isSecret: false, declarationType: 'parameter'});
    parameterNode.id = thisPath.isMapping() || thisPath.isArray() ? binding.id + thisPath.getAncestorOfType('IndexAccess')?.node.indexExpression.referencedDeclaration : binding.id;
    const fnDefNode = thisPath.getAncestorOfType('FunctionDefinition')?.node;
    const params = fnDefNode._newASTPointer.parameters.parameters;
    if (!params.some(n => n.id === parameterNode.id)){
      params.push(parameterNode);
      // For each non-secret variable that is input to the circuit, we need to ensure the initial value is stored for later.
      const beginNodeInit = buildNode('Assignment', {
        leftHandSide: buildNode('Identifier', { name: `${name}_init`, subType: 'generalNumber'   }),
        operator: '=',
        rightHandSide: buildNode('Identifier', { name: `${name}`, subType: 'generalNumber' }),
      });
      if (node.typeDescriptions?.typeString === 'bool') {
        beginNodeInit.leftHandSide.typeName ='bool';
      }
      const beginNode = buildNode('ExpressionStatement', {
          expression: beginNodeInit,
          interactsWithSecret: true,
          isVarDec: true,
      });
      fnDefNode._newASTPointer.body.statements.unshift(beginNode);
    }
    // even if the indexAccessNode is not a public input, we don't want to check its base and index expression nodes
    thisState.skipSubNodes = true;
  }
};

const addStructDefinition = (path: NodePath) => {
  const { node, parent, scope } = path;
  const { indicators } = scope;
  const structDef = path.getStructDeclaration(path.node);
  const structNode = buildNode('StructDefinition', {
    name: structDef.name,
    members: structDef.members.map((mem: any) => {
      return { name: mem.name,
        type: mem.typeName.name === 'bool' ? 'bool' : 'field',
      }
    }),
  });
  const thisFnPath = path.getAncestorOfType('FunctionDefinition');
  const thisFile = thisFnPath?.parent._newASTPointer.find((file: any) => file.fileName === thisFnPath?.getUniqueFunctionName());
  if (!thisFile.nodes.some(n => n.nodeType === 'StructDefinition' && n.name === structNode.name))
  // add struct def after imports, before fndef
    thisFile.nodes.splice(1, 0, structNode);
  return structNode;
}

let interactsWithSecret = false; // Added globaly as two objects are accesing it
let oldStateArray : string[];
let circuitImport = [];
/**
 * @desc:
 * Visitor transforms a `.zol` AST into a `.zok` AST
 * NB: the resulting `.zok` AST is custom, and can only be interpreted by this
 * repo's code generator. ZoKrates itself will not be able to interpret this
 * AST.
 */


const visitor = {
  ContractDefinition: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;
      node._newASTPointer = parent._newASTPointer;
    },
  // We Add the InternalFunctionCall nodes at the exit node so that all others gets build we need to access
    exit(path: NodePath, state: any) {
      // Internal Call Visitor
      path.traverse(explode(internalCallVisitor), state);

    },
  },

  ImportDirective: {
    enter(path: NodePath, state: any) {
      const { node } = path;
      state.contractImports ??= [];
      state.contractImports.push({
        absolutePath: node.absolutePath,
        file: node.file,
      });
      // we assume all import statements come before all functions
    },

  },


  FunctionDefinition: {
    // parent._newASTPointer location is Folder.files[].
    enter(path: NodePath, state: any) {

      const { node, parent, scope } = path;

      // Check the function for modifications to any stateVariables.
      // We'll need to create a new circuit file if we find a modification.
      // TODO: will we also need a new circuit file even if we're merely 'referring to' a secret state (because then a nullifier might be needed?)
      if (scope.modifiesSecretState()) {
        // Let's create a new circuit File to represent this function.
        // We'll add a new 'File' node to our newAST:

        const newFunctionDefinitionNode = buildNode('FunctionDefinition', {
          name: 'main',
        });
        const newImportStatementListNode = buildNode('ImportStatementList');

        const { indicators } = scope;

        newImportStatementListNode.imports.push(
          ...buildNode('Boilerplate', {
            bpSection: 'importStatements',
            indicators,
          }),
        );


        // before creating a function node we check for functions with same name
        const fnName = path.getUniqueFunctionName();
        node.fileName = fnName;


        // After getting an appropriate Name , we build the node
        const newNode = buildNode('File', {
         fileName: fnName,
          fileId: node.id,
          nodes: [newImportStatementListNode, newFunctionDefinitionNode],
        });

        node._newASTPointer = newFunctionDefinitionNode; // TODO: we might want to make this point to newNode (the 'File') rather than newNode.nodes[1] (the 'FunctionDefinition'), so that in future we can more easily access the ImportStatements.

        const files = parent._newASTPointer;
        files.push(newNode);
      } else {
        // a non secret function - we skip it for circuits
        state.skipSubNodes = true;
      }

    },

    exit(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      const { indicators } = scope;
      const newFunctionDefinitionNode = node._newASTPointer;

      
      // We need to ensure the correctness of the circuitImport flag for each internal function call. The state may have been updated due to later function calls that modify the same secret state.
      let importStatementList: any;
      parent._newASTPointer.forEach((file: any) => {
        if (file.fileName === node.fileName) {
          importStatementList = file.nodes[0];
        }
      });
      importStatementList.imports.forEach((importNode: any) => {
        if (importNode.bpType === 'internalFunctionCall' && importNode.circuitImport) {
          if (state.circuitImport[importNode.functionCallIndex].isImported === 'false'){
            importNode.circuitImport = false;
          }
        } 
      });

      //Ensure we do not have any statements of the form x = x_init where x is not a parameter input to the circuit.
      for (let i = newFunctionDefinitionNode.body.statements.length - 1; i >= 0; i--) {
        const statementNode = newFunctionDefinitionNode.body.statements[i];
        if ( statementNode.isEndInit && 
          newFunctionDefinitionNode.parameters.parameters.every(paramNode => paramNode.name !== statementNode.expression?.leftHandSide.name)
        ) {
          newFunctionDefinitionNode.body.statements.splice(i, 1);
        }
      }

     /// Ensure non-secret inputs to the circuit are not declared      
      for (let i = newFunctionDefinitionNode.body.statements.length - 1; i >= 0; i--) {
        const statementNode = newFunctionDefinitionNode.body.statements[i];
        newFunctionDefinitionNode.parameters.parameters.forEach((paramNode) => {
          if ( statementNode.isVarDec && statementNode.expression && (paramNode.name === statementNode.expression.leftHandSide?.name || paramNode.name === statementNode.expression.initialValue?.name)) {
            statementNode.isVarDec =false;
          }
        });
      }

      const joinCommitmentsNode = buildNode('File', {
       fileName: `joinCommitments`,
        fileId: node.id,
        nodes: [ ],
      });

      const splitCommitmentsNode = buildNode('File', {
        fileName: `splitCommitments`,
         fileId: node.id,
         nodes: [ ],
       });

      // check for joinCommitments and splitCommitments
      for(const [, indicator ] of Object.entries(indicators)){
        if((indicator instanceof StateVariableIndicator)
          && indicator.isPartitioned
          && indicator.isNullified && !indicator.isStruct) {
            if (!parent._newASTPointer.some(n => n.fileName === joinCommitmentsNode.fileName)){
              parent._newASTPointer.push(joinCommitmentsNode);
            }
            if (!parent._newASTPointer.some(n => n.fileName === splitCommitmentsNode.fileName)){
              parent._newASTPointer.push(splitCommitmentsNode);
            }
        }
        if(indicator instanceof StateVariableIndicator && indicator.encryptionRequired) {
          const num = indicator.isStruct ? indicator.referencingPaths[0]?.getStructDeclaration()?.members.length + 2 : 3;
          let encMsgsNode;
          if (indicator.isMapping && indicator.mappingKeys) {
            for(const [, mappingKey ] of Object.entries(indicator.mappingKeys)) {
              if (mappingKey.encryptionRequired) {
                let indicatorname: any;
                if(mappingKey.returnKeyName(mappingKey.keyPath.node) == 'msg')
                  indicatorname  = mappingKey.returnKeyName(mappingKey.keyPath.parent)
                else
                  indicatorname = mappingKey.returnKeyName(mappingKey.keyPath.node)
                encMsgsNode = buildNode('VariableDeclaration', {
                  name: `${indicator.name}_${indicatorname}`.replaceAll('.', 'dot').replace('[', '_').replace(']', ''),
                  type: `EncryptedMsgs<${num}>`,
                });
              }
            };
          } else {
            encMsgsNode = buildNode('VariableDeclaration', {
              name: indicator.name,
              type: `EncryptedMsgs<${num}>`,
            }); 
          }
          encMsgsNode.isPartitioned = indicator.isPartitioned;
          newFunctionDefinitionNode.returnParameters.parameters.push(encMsgsNode);
        }
      }
    

      if (node.kind === 'constructor' && state.constructorStatements && state.constructorStatements[0]) newFunctionDefinitionNode.body.statements.unshift(...state.constructorStatements);

      // We populate the boilerplate for the function
      newFunctionDefinitionNode.parameters.parameters.push(
        ...buildNode('Boilerplate', {
          bpSection: 'parameters',
          indicators,
        }),
      );

      newFunctionDefinitionNode.body.preStatements.push(
        ...buildNode('Boilerplate', {
          bpSection: 'preStatements',
          indicators,
        }),
      );

      newFunctionDefinitionNode.body.postStatements.push(
        ...buildNode('Boilerplate', {
          bpSection: 'postStatements',
          indicators,
        }),
      );

      if (indicators.msgSenderParam) {
        node._newASTPointer.parameters.parameters.unshift(
          buildNode('VariableDeclaration', {
            name: 'msgSender',
            declarationType: 'parameter',
            type: 'field',
          }),
        ); // insert a msgSender parameter, because we've found msg.sender in the body of this function.
      }
      if (indicators.msgValueParam) {
        node._newASTPointer.parameters.parameters.unshift(
          buildNode('VariableDeclaration', {
            name: 'msgValue',
            declarationType: 'parameter',
            type: 'field',
          }),
        ); // insert a msgValue parameter, because we've found msg.value in the body of this function.
      }
    },
  },

  EventDefinition: {
    enter(path: NodePath, state: any) {
      state.skipSubNodes = true;
    }
  },

  EmitStatement: {
    enter(path: NodePath, state: any) {
      state.skipSubNodes = true;
    }
  },

  WhileStatement: {
    enter(path: NodePath, state: any) {
      state.skipSubNodes = true;
    }
  },

  DoWhileStatement: {
    enter(path: NodePath, state: any) {
      state.skipSubNodes = true;
    }
  },

  ParameterList: {
    enter(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      let returnName : string[] =[];
      if(!!path.getAncestorOfType('EventDefinition')) return;
       if(path.key === 'parameters'){
      const newNode = buildNode('ParameterList', {functionName: parent.name});
      node._newASTPointer = newNode.parameters;
      parent._newASTPointer[path.containerName] = newNode;
    } else if(path.key === 'returnParameters'){
       parent.body.statements.forEach(node => {
        if(node.nodeType === 'Return'){
          if(node.expression.nodeType === 'TupleExpression'){
           node.expression.components.forEach(component => {
             if(component.name){
              returnName?.push(component.name);
            }else if(component.nodeType === 'IndexAccess'){
              returnName?.push(getIndexAccessName(component));
            }else
             returnName?.push(component.value);
           });
         } else if(node.expression.nodeType === 'IndexAccess'){
          returnName?.push(getIndexAccessName(node.expression));
       } else{
          if(node.expression.name)
           returnName?.push(node.expression.name);
          else
          returnName?.push(node.expression.value);
        }
        }
      });
    node.parameters.forEach((node, index) => {
    if(node.nodeType === 'VariableDeclaration'){
    node.name = returnName[index];
  }
    });
    const newNode = buildNode('ParameterList');
    node._newASTPointer = newNode.parameters;
    parent._newASTPointer[path.containerName] = newNode;
    }
  },
  exit(path: NodePath, state: any){
    const { node, parent, scope } = path;
    if(path.key === 'returnParameters'){
      node._newASTPointer.forEach(item =>{
      parent.body.statements.forEach( node => {
        if(node.nodeType === 'Return'){
          for(const [ id , bindings ] of Object.entries(scope.referencedBindings)){
            switch(node.expression.nodeType) {
              case 'TupleExpression' : {
                node.expression.components.forEach(component => {
                  if((component.nodeType === 'IndexAccess' && id == component.indexExpression?.referencedDeclaration )||(component.nodeType === 'MemberAccess' && id == component.expression?.referencedDeclaration )|| id == component.referencedDeclaration) {
                    if ((bindings instanceof VariableBinding)) {
                      if(item.name.includes(bindings.node.name))
                   item.isPrivate = bindings.isSecret
                    }
                  }
                })
                break;
              }
              case 'IndexAccess':{
                if(id == node.expression.indexExpression.referencedDeclaration) {
                  if ((bindings instanceof VariableBinding)){
                    if(item.name.includes(bindings.node.name))
                     item.isPrivate = bindings.isSecret
                  }
                } 
                break ;
              }
              case 'MemberAccess':{
                if(id == node.expression.referencedDeclaration) {
                  if ((bindings instanceof VariableBinding)){
                    if(item.name.includes(bindings.node.name))
                      item.isPrivate = bindings.isSecret
                  }
                } 
                break;
              }  
              default: {
                if( id == node.expression.referencedDeclaration){
                  if ((bindings instanceof VariableBinding)){
                    if(item.name == bindings.node.name)
                    item.isPrivate = bindings.isSecret
                   }
                } 
                break ;
              } 
            }
          }
        }
      })
    })
    }
  },
  },

  Block: {
    enter(path: NodePath) {
      const { node, parent } = path;
      if (['trueBody', 'falseBody', 99999999].includes(path.containerName)) {
        node._newASTPointer = parent._newASTPointer[path.containerName];
        return;
      }
      const newNode = buildNode('Block');
      node._newASTPointer = newNode.statements;
      parent._newASTPointer.body = newNode;
    },
  },

  Return: {
     enter(path: NodePath) {
       const { node, parent } = path;
       const newNode = buildNode(
       node.nodeType,
       { value: node.expression.value });
       node._newASTPointer = newNode;
       if (Array.isArray(parent._newASTPointer)) {
        parent._newASTPointer.push(newNode);
      } else {
        parent._newASTPointer[path.containerName].push(newNode);
      }
    },

   },

  VariableDeclarationStatement: {
    enter(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      if (node.stateVariable) {
        throw new Error(
          `TODO: VariableDeclarationStatements of secret state variables are tricky to initialise because they're assigned-to outside of a function. Future enhancement.`,
        );
      }
      let declarationType: string = ``;
      if (path.isLocalStackVariableDeclaration())
        declarationType = 'localStack';
      if (path.isFunctionParameterDeclaration()) declarationType = 'parameter';

      if (
        declarationType === 'localStack' &&
        !node.isSecret && !node.declarations[0].isSecret &&
        !scope.getReferencedIndicator(node)?.interactsWithSecret &&
        !path.getAncestorContainedWithin('initializationExpression')
      ) {
        // we don't want to add non secret local vars

        node._newASTPointer = parent._newASTPointer;
        state.skipSubNodes = true;
        return;
      }
      

      const newNode = buildNode('VariableDeclarationStatement');
      node._newASTPointer = newNode;

      if (Array.isArray(parent._newASTPointer)) {
        parent._newASTPointer.push(newNode);
      } else if (Array.isArray(parent._newASTPointer[path.containerName])) {
        parent._newASTPointer[path.containerName].push(newNode);
      } else {
        parent._newASTPointer[path.containerName] = newNode;
      }
    },
  },

  BinaryOperation: {
    enter(path: NodePath) {
      const { node, parent } = path;
      const { operator } = node;

      const newNode = buildNode('BinaryOperation', { operator });
      node._newASTPointer = newNode;
      if (parent.nodeType === "TupleExpression") {
        path.inList ? parent._newASTPointer.push(newNode) : parent._newASTPointer = newNode;
      } else {
        path.inList ? parent._newASTPointer[path.containerName].push(newNode) : parent._newASTPointer[path.containerName] = newNode;
      } 
    },
  },

  Assignment: {
    enter(path: NodePath) {
      const { node, parent } = path;
      const { operator } = node;
      const newNode = buildNode('Assignment', { operator });
      node._newASTPointer = newNode;
      parent._newASTPointer.expression = newNode;
    },

    exit(path: NodePath) {
      // Convert 'a += b' into 'a = a + b' for all operators, because zokrates doesn't support the shortened syntax.
      // We do this on exit, so that the child nodes of this assignment get transformed into the correct zokrates nodeTypes (otherwise they might get missed).
      const expandAssignment = (node: any) => {
        const { operator, leftHandSide, rightHandSide } = node;
        const expandableOps = ['+=', '-=', '*=', '/=', '%=', '|=', '&=', '^='];
        if (!expandableOps.includes(operator)) return node;
        const op = operator.charAt(0);
        const binOpNode = buildNode('BinaryOperation', {
          operator: op,
          leftExpression: cloneDeep(leftHandSide),
          rightExpression: rightHandSide,
        });
        const assNode = buildNode('Assignment', {
          operator: '=',
          leftHandSide,
          rightHandSide: binOpNode,
        });
        // We need to ensure that for non-secret variables the name used on the right hand side of the assignment 
        // is always the original name. (As the original variable is always updated we always get the right value.)
        const binding = path.getReferencedBinding(path.node.leftHandSide);
        if( (binding instanceof VariableBinding) && !binding.isSecret && 
        binding.stateVariable){
          binOpNode.leftExpression.name = path.node.leftHandSide.name;
        } else {
        binOpNode.leftExpression.name = path.scope.getIdentifierMappingKeyName(path.node.leftHandSide, true);
        }
        return assNode;
      };

      const { parent } = path;
      const circuitNode = parent._newASTPointer.expression;
      const newNode = expandAssignment(circuitNode);
      // node._newASTPointer = newNode; // no need to ascribe the node._newASTPointer, because we're exiting.
      parent._newASTPointer.expression = newNode;
    },
  },

  TupleExpression: {
    enter(path: NodePath) {
      const { node, parent } = path;
      const newNode = buildNode(node.nodeType);
      node._newASTPointer = newNode.components;
      parent._newASTPointer[path.containerName] = newNode;
    },
  },

  UnaryOperation: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;
      const { operator, prefix, subExpression } = node;
      const binding = path.getReferencedBinding(node.subExpression);
      const newNode = buildNode(node.nodeType, {
        operator,
        prefix,
        subExpression: buildNode(subExpression.nodeType, {
          name: path.scope.getIdentifierMappingKeyName(subExpression, true),
        }),
        initialValue: buildNode(subExpression.nodeType, {
          name: path.scope.getIdentifierMappingKeyName(subExpression)
        }),
      });
      if (subExpression.typeDescriptions.typeString === 'bool') {
        newNode.subExpression.typeName =  buildNode('ElementaryTypeName', {
          name: `bool`});
        }
      //We need to ensure that for non-secret variables the name used on the right hand side of the assignment 
      // is always the original name. (As the original variable is always updated we always get the right value.)
      if ( (binding instanceof VariableBinding) && !binding.isSecret && 
      binding.stateVariable){
        newNode.subExpression.name = subExpression.name;
      } 
      node._newASTPointer = newNode;
      parentnewASTPointer(parent, path, newNode, parent._newASTPointer[path.containerName]);
      state.skipSubNodes = true;
    }
  },

  ExpressionStatement: {    
    enter(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      const { expression } = node;
      // TODO: make sure isDecremented / isIncremented are also ascribed to UnaryOperation node (not just Assignment nodes).
      // TODO: what other expressions are there?
      // NOTE: THIS IS A TEMP BODGE - we need non-secrets when they interact with secrets later, add a check for local vars
      if(expression.nodeType === 'FunctionCall'){
      if((scope.getReferencedNode(expression.expression))?.containsSecret)
      node.containsSecret = 'true';
    }
     let childOfSecret =  path.getAncestorOfType('ForStatement')?.containsSecret;
      if(path.getAncestorOfType('ForStatement') && expression.containsPublic ){
        childOfSecret = false;
      }

      const thisState = { interactsWithSecretInScope: false };

      const leftHandSideInteracts = expression.leftHandSide && scope.getReferencedIndicator(expression.leftHandSide)?.interactsWithSecret;

  
      if (leftHandSideInteracts) {
        thisState.interactsWithSecretInScope = true; // Update thisState flag
      }

      if (expression.nodeType === 'UnaryOperation') {
        const { operator, subExpression } = expression;
        if ((operator === '++' || operator === '--') && subExpression.nodeType === 'Identifier') {
          const referencedIndicator = scope.getReferencedIndicator(subExpression);
          if (referencedIndicator?.interactsWithSecret) {
            thisState.interactsWithSecretInScope = true;
          }
        }
      }
    
      
      if (!node.containsSecret && !childOfSecret && !thisState.interactsWithSecretInScope) {
        state.skipSubNodes = true;
        return;
 
      }

      const { isIncremented, isDecremented } = expression;
      let newNode: any;

      // TODO: tidy this up...
      if (isIncremented || isDecremented) {
        switch (expression.nodeType) {
          case 'Assignment': {
            const { leftHandSide: lhs, rightHandSide: rhs } = expression;
            const lhsIndicator = scope.getReferencedIndicator(lhs);
            if (!lhsIndicator?.isPartitioned) break;

            const rhsPath = NodePath.getPath(rhs);
            // We need to _clone_ the path, because we want to temporarily modify some of its properties for this traversal. For future AST transformations, we'll want to revert to the original path.
            const tempRHSPath = cloneDeep(rhsPath);
            const tempRHSParent = tempRHSPath.parent;
            if (isDecremented) {
              newNode = buildNode('BoilerplateStatement', {
                bpType: 'decrementation',
                indicators: lhsIndicator,
                subtrahendId: rhs.id,
                ...(lhsIndicator.isMapping && {
                  mappingKeyName: scope.getMappingKeyName(lhs) ||
                    lhs.indexExpression?.name ||
                    lhs.indexExpression.expression.name,
                }), // TODO: tidy this
                ...(lhsIndicator.isStruct && {
                  memberName: lhs.memberName 
                }),
              });
              tempRHSPath.containerName = 'subtrahend'; // a dangerous bodge that works
              node._newASTPointer = newNode.subtrahend;
            } else {
              // isIncremented
              newNode = buildNode('BoilerplateStatement', {
                bpType: 'incrementation',
                indicators: lhsIndicator,
                addendId: rhs.id,
                ...(lhsIndicator.isMapping && {
                  mappingKeyName: scope.getMappingKeyName(lhs) ||
                    lhs.indexExpression?.name ||
                    lhs.indexExpression.expression.name,
                }), // TODO: tidy this
                ...(lhsIndicator.isStruct && {
                  memberName: lhs.memberName 
                }),
              });
              tempRHSPath.containerName = 'addend'; // a dangerous bodge that works
              node._newASTPointer = newNode.addend;
            }

            // The child of this 'ExpressionStatement' node is an 'Assignment' node. But we've built a newNode to replace the 'Assignment' node of the original tree. The child of this newNode will be the RHS of the original 'Assignment' node. We discard the LHS, so we need to 'skip' the traversal of the 'Assignment' (using skipSubNodes = true), and instead traverse directly into the RHS node.
            tempRHSParent._newASTPointer = newNode;
            // we don't want to add public inputs twice:

            tempRHSPath.traverse(visitor, { skipPublicInputs: true });
            rhsPath.traversePathsFast(publicInputsVisitor, {});
            rhsPath.traversePathsFast(publicVariablesVisitor, {});
            path.traversePathsFast(p => {
              if (p.node.nodeType === 'Identifier' && p.isStruct(p.node)){
                addStructDefinition(p);
              }
            }, state);
            state.skipSubNodes = true;
            parent._newASTPointer.push(newNode);
            incrementNames(newNode, lhsIndicator);
            if (newNode.addend) newNode.addend.incrementType = expression.operator;
            if (newNode.subtrahend) newNode.subtrahend.decrementType = expression.operator;
            return;
          }
          default:
            throw Error(
              `Expressions of nodeType ${expression.nodeType} are not yet supported. Please open a new issue in github (if none exists).`,
            );
        }
      }

      // Otherwise, copy this ExpressionStatement into the circuit's language.

      // But, let's check to see if this ExpressionStatement is an Assignment to a state variable. If it's the _first_ such assignment, we'll need to mutate this ExpressionStatement node into a VariableDeclarationStatement.

      let isVarDec: boolean = false;
      if (node.expression.nodeType === 'Assignment' || node.expression.nodeType === 'UnaryOperation') {
        let { leftHandSide: lhs } = node.expression;
        if (!lhs) lhs = node.expression.subExpression;
        const referencedIndicator = scope.getReferencedIndicator(lhs, true);

        const name = referencedIndicator?.isMapping
          ? referencedIndicator.name
              .replace('[', '_')
              .replace(']', '')
              .replace('.sender', 'Sender')
              .replace('.value','Value')
              .replace('.', 'dot')
          : referencedIndicator?.name;
        if (referencedIndicator?.isMapping && lhs.baseExpression) {
          lhs = lhs.baseExpression;
        } else if (lhs.nodeType === 'MemberAccess') {
          lhs = lhs.expression;
          if (lhs.baseExpression) lhs = lhs.baseExpression;
        }
        // collect all index names
        const names = referencedIndicator.referencingPaths.map((p: NodePath) => ({ name: p.getAncestorContainedWithin('rightHandSide') ?  p.node.name : scope.getIdentifierMappingKeyName(p.node), id: p.node.id })).filter(n => n.id <= lhs.id);
        // check whether this is the first instance of a new index name. We only care if the previous index name is on the left hand side, because this will lead to a double variable declaration. 
        let firstInstanceOfNewName = true;
        let i =0;
        // We check that the name has not been used previously, in this case we need to declare it. 
        // We ensure that variables are not declared when they are input to the circuit elsewhere. 
        names.forEach((elem) => {
          if (i !== names.length - 1 && names[names.length - 1].name === elem.name){
            firstInstanceOfNewName = false;
          }
          i++;
        });   
        
        if (referencedIndicator instanceof StateVariableIndicator &&
          (firstInstanceOfNewName 
            || (referencedIndicator.isSecret && (lhs.id === referencedIndicator.referencingPaths[0].node.id ||lhs.id === referencedIndicator.referencingPaths[0].parent.id))
           ) && // the parent logic captures IndexAccess nodes whose IndexAccess.baseExpression was actually the referencingPath
          !(
            referencedIndicator.isWhole &&
            referencedIndicator.oldCommitmentAccessRequired
          ) // FIX - sometimes a variable will be declared twice when we insert oldCommitmentPreimage preStatements before an overwrite - we check here
        ) {
          isVarDec = true;
        }  
        if (referencedIndicator instanceof LocalVariableIndicator &&  firstInstanceOfNewName && names[names.length - 1].name !== referencedIndicator.name){
          isVarDec = true;
        }    
      }
      let nodeID = node.id;
      newNode = buildNode('ExpressionStatement', { isVarDec });
      newNode.id = nodeID;
      newNode.isAccessed = false;
      node._newASTPointer = newNode;
      if (Array.isArray(parent._newASTPointer)) {
        parent._newASTPointer.push(newNode);
      } else {
        parent._newASTPointer[path.containerName] = newNode;
      }
      const fnDefNode = path.getAncestorOfType('FunctionDefinition');
      // We ensure the original variable name is set to the initial value only at the end of the statements. 
      //E.g index = index_init should only appear at the end of all the modifying statements. 
      for (let i = fnDefNode.node._newASTPointer.body.statements.length - 1; i >= 0; i--) {
        if (fnDefNode.node._newASTPointer.body.statements[i].isEndInit) {
          let element = fnDefNode.node._newASTPointer.body.statements.splice(i, 1)[0];
          fnDefNode.node._newASTPointer.body.statements.push(element);
        }
      }
    }
  },

  StructDefinition: {
    enter(path: NodePath, state: any) {
      state.skipSubNodes = true;
    }
  },



  VariableDeclaration: {
    enter(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      if(!!path.getAncestorOfType('EventDefinition')) return;
      if (node.stateVariable && !node.value) {
        // Then the node represents assignment of a state variable.
        // State variables don't get declared within a circuit;
        // their old/new values are passed in as parameters.
        node._newASTPointer = parent._newASTPointer;
        state.skipSubNodes = true;
        return;
      }
      if (node.stateVariable && node.value && node.isSecret) {
        const initNode = buildNode('Assignment', {
          leftHandSide: buildNode('Identifier', {
            name: node.name
          }),
          operator: '=',
          rightHandSide: buildNode(node.value.nodeType, {
            name: node.value.name, value: node.value.value
            })
          });
        state.constructorStatements ??= [];
        state.constructorStatements.push(initNode);
        node._newASTPointer = parent._newASTPointer;
        state.skipSubNodes = true;
        return;
      }

      if (path.isFunctionReturnParameterDeclaration())
        throw new Error(
          `TODO: VariableDeclarations of return parameters are tricky to initialise because we might rearrange things so they become _input_ parameters to the circuit. Future enhancement.`,
        );

      let declarationType: string = ``;
      // TODO: `memery` declarations and `returnParameter` declarations
      if (path.isLocalStackVariableDeclaration())
        declarationType = 'localStack';
      if (path.isFunctionParameterDeclaration()) declarationType = 'parameter';

      if (
        declarationType === 'localStack' &&
        !node.isSecret &&
        !scope.getReferencedIndicator(node)?.interactsWithSecret &&
        !path.getAncestorContainedWithin('initializationExpression')
      ) {
        // we don't want to add non secret local vars
        node._newASTPointer = parent._newASTPointer;
        state.skipSubNodes = true;
        return;
      }
      let interactsWithSecret = scope.getReferencedIndicator(node)?.interactsWithSecret ;
      scope.bindings[node.id].referencingPaths.forEach(refPath => {
        const newState: any = {};
        refPath.parentPath.traversePathsFast(
          interactsWithSecretVisitor,
          newState,
        );

        interactsWithSecret ||= newState.interactsWithSecret || refPath.node.interactsWithSecret;

        // check for internal function call if the parameter passed in the function call interacts with secret or not
        if(refPath.parentPath.isInternalFunctionCall()){
          refPath.parentPath.node.arguments?.forEach((element, index) => {
            if(node.id === element.referencedDeclaration) {
             let key = (Object.keys((refPath.getReferencedPath(refPath.parentPath.node?.expression) || refPath.parentPath).scope.bindings)[index]);
             interactsWithSecret ||= refPath.getReferencedPath(refPath.parentPath.node?.expression)?.scope.indicators[key]?.interactsWithSecret
            }
          })
        }
      });

      if (path.getAncestorContainedWithin('initializationExpression') && path.getAncestorOfType('ForStatement')?.containsSecret) interactsWithSecret ??= true;

//We need to add return return parameters as well

      if (
        parent.nodeType === 'VariableDeclarationStatement' &&
        interactsWithSecret
      )
        parent._newASTPointer.interactsWithSecret = interactsWithSecret;
      if(!interactsWithSecret && path.parentPath.key !== 'returnParameters') {
        state.skipSubNodes = true;
        return;
}

      //If it's not declaration of a state variable, it's either a function parameter or a local stack variable declaration. We _do_ want to add this to the newAST.
      const newNode = buildNode('VariableDeclaration', {
        name: node.name,
        isSecret: node.isSecret,
        interactsWithSecret,
        declarationType,
      });

      if (path.isStruct(node)) {
        state.structNode = addStructDefinition(path);
        newNode.typeName.name = state.structNode.name;
        newNode.typeName.members = state.structNode.members;
      }
      node._newASTPointer = newNode;
      if (Array.isArray(parent._newASTPointer)) {
        parent._newASTPointer.push(newNode);
      } else {
        parent._newASTPointer[path.containerName].push(newNode);
      }
    },

  },

  ArrayTypeName: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;
      const newNode = buildNode('ElementaryTypeName', {
        name: `${node.baseType.name === 'bool' ?  'bool' : 'field'}[${node.length.value}]`
      });

      node._newASTPointer = newNode;
      if (Array.isArray(parent._newASTPointer)) {
        parent._newASTPointer.push(newNode);
      } else {
        parent._newASTPointer[path.containerName] = newNode;
      }
      state.skipSubNodes = true;
    }
  },

  ElementaryTypeNameExpression: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;

      // node._newASTPointer = // no pointer needed, because this is a leaf, so we won't be recursing any further.
      parent._newASTPointer[path.containerName] = buildNode(
        'ElementaryTypeName',
        {
          name: node.typeName.name === 'bool' ? 'bool' : 'field', // convert uint & address types to 'field', for now.
        },
      );
      state.skipSubNodes = true;
    },
  },

  ElementaryTypeName: {
    enter(path: NodePath) {
      const { node, parent } = path;
      if(!!path.getAncestorOfType('EventDefinition')) return;
      const supportedTypes = ['uint', 'uint256', 'address', 'bool'];
      if (!supportedTypes.includes(node.name))
        throw new Error(
          `Currently, only transpilation of types "${supportedTypes}" is supported. Got ${node.name} type.`,
        );

      // node._newASTPointer = // no pointer needed, because this is a leaf, so we won't be recursing any further.
      parent._newASTPointer[path.containerName] = buildNode(
        'ElementaryTypeName',
        {
          name: node.name === 'bool' ? 'bool' : 'field', // convert uint & address types to 'field', for now.
        },
      );
    },
  },

  Identifier: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;
      let { name } = node;
      if(!!path.getAncestorOfType('EventDefinition')) return;
      if(!!path.getAncestorOfType('EmitStatement')) return;
      // const binding = path.getReferencedBinding(node);
      // below: we have a public state variable we need as a public input to the circuit
      // local variable decs and parameters are dealt with elsewhere
      // secret state vars are input via commitment values
      if (!state.skipPublicInputs) path.traversePathsFast(publicInputsVisitor, {});
      // Only use the mapping key name if it is on the left hand side. 
      const binding = path.getReferencedBinding(node);
      if ( (binding instanceof VariableBinding) && !binding.isSecret && 
      binding.stateVariable && path.getAncestorContainedWithin('rightHandSide') ){
      } else{
        name = path.scope.getIdentifierMappingKeyName(node);
      }
      const newNode = buildNode(
        node.nodeType,
        { name, type: node.typeDescriptions?.typeString },
      );
      if (path.isStruct(node)) addStructDefinition(path);
      publicVariables(path, state,newNode);
      if (path.getAncestorOfType('IfStatement')) node._newASTPointer = newNode;
      // no pointer needed, because this is a leaf, so we won't be recursing any further.
      // UNLESS we must add and rename if conditionals 
      parentnewASTPointer(parent, path, newNode, parent._newASTPointer[path.containerName]);
    },
  },

  IfStatement: {
    enter(path: NodePath, state: any) {
      const { node, parent, scope } = path;
      let isIfStatementSecret: boolean;
      let interactsWithSecret = false;
      function bodyInteractsWithSecrets(statements) {
        statements.forEach((st) => {
          if (st.nodeType === 'ExpressionStatement') {
            if (st.expression.nodeType === 'UnaryOperation') {
              const { operator, subExpression } = st.expression;
              if ((operator === '++' || operator === '--') && subExpression.nodeType === 'Identifier') {
                const referencedIndicator = scope.getReferencedIndicator(subExpression);
                if (referencedIndicator?.interactsWithSecret) {
                  interactsWithSecret = true;
                }
              }
            } else {
              const referencedIndicator = scope.getReferencedIndicator(st.expression.leftHandSide);
                if (referencedIndicator?.interactsWithSecret) {
                  interactsWithSecret = true;
                }
            }
          }
        });
      }
      if (node.trueBody?.statements) bodyInteractsWithSecrets(node.trueBody?.statements);
      if (node.falseBody?.statements) bodyInteractsWithSecrets(node.falseBody?.statements);


      if(node.falseBody?.containsSecret || node.trueBody?.containsSecret || interactsWithSecret ||  node.condition?.containsSecret)
        isIfStatementSecret = true;
      if(isIfStatementSecret) {
      if(node.trueBody.statements[0].expression.nodeType === 'FunctionCall')
      {
        const newNode = buildNode(node.nodeType, {
          condition: {},
          trueBody: [],
          falseBody: [],
          isRevert : true
        });
        node._newASTPointer = newNode;
        parent._newASTPointer.push(newNode);
        return;
      }
      const newNode = buildNode(node.nodeType, {
        condition: {},
        trueBody: [],
        falseBody: [],
        isRevert : node.isrevert
      });
      node._newASTPointer = newNode;
      parent._newASTPointer.push(newNode);
    } else {
      state.skipSubNodes = true;
      return ;
    }
    },
    exit(path: NodePath) {
      // a visitor to collect all identifiers in an if condition
      // we use this list later to init temp variables
      //First, we need to find identifiers already declared in previous if statements so we know to avoid redeclaring them.
      let ifStatementPaths = path.getSiblingNodes().filter(element => element.nodeType === 'IfStatement');
      let tempDec: any[] = [];
      ifStatementPaths.forEach((element) => {
        if (element._newASTPointer && element._newASTPointer.conditionVars) {
          element._newASTPointer.conditionVars.forEach((elem) => {
            tempDec.push(elem.name);
          });
        }
      });
      // Next we find the identifiers in the current if statement and add them to the list.
      const findConditionIdentifiers = (thisPath: NodePath, state: any) => {
        if (!thisPath.scope.getReferencedIndicator(thisPath.node)?.isModified) return;
        if (!thisPath.getAncestorContainedWithin('condition')) return;
        if (thisPath.getAncestorContainedWithin('baseExpression') || (
          thisPath.getAncestorOfType('MemberAccess') && thisPath.containerName === 'expression'
        )) return;
        // depending on the type in the condition, we rename it to `name_temp`
        // and store the original in state.list to init later
        switch (thisPath.node.nodeType) {
          case 'Identifier':
            if (!thisPath.getAncestorOfType('IndexAccess')) {
              if (thisPath.parent.nodeType === 'UnaryOperation'){
                if (thisPath.getAncestorContainedWithin('subExpression')){
                  state.list.push(cloneDeep(thisPath.parent._newASTPointer.subExpression));
                  thisPath.parent._newASTPointer.subExpression.name += '_temp';
                } 
                if (thisPath.getAncestorContainedWithin('initialValue')) {
                  state.list.push(cloneDeep(thisPath.parent._newASTPointer.initialValue));
                  thisPath.parent._newASTPointer.initialValue.name += '_temp';
                } 
              } else{
                state.list.push(cloneDeep(thisPath.node._newASTPointer));
                thisPath.node._newASTPointer.name += '_temp';
              }
            } else {
              thisPath.parent._newASTPointer.indexExpression.name += '_temp';
            }
            break;
          case 'IndexAccess':
            thisPath.node._newASTPointer.typeName ??= thisPath.node._newASTPointer.baseExpression.typeName;
            if (thisPath.isMsg(thisPath.getMappingKeyIdentifier())) {
              state.list.push(cloneDeep(thisPath.node._newASTPointer));
              thisPath.node._newASTPointer.indexExpression.name = thisPath.node._newASTPointer.indexExpression.nodeType.replace('M', 'm') + `_temp`;
              state.skipSubNodes = true;
              break;
            }
            state.list.push(cloneDeep(thisPath.node._newASTPointer));
            break;
          case 'MemberAccess':
            if (!thisPath.getAncestorOfType('IndexAccess')) state.list.push(cloneDeep(thisPath.node._newASTPointer));
            if (thisPath.isMsgSender() || thisPath.isMsgValue()) {
              thisPath.node._newASTPointer.name = thisPath.isMsgSender() ? `msgSender_temp` : `msgValue_temp`;
              break;
            }
            thisPath.node._newASTPointer.memberName += '_temp';
            break;
          default:
            break;
        }
      };
      let identifiersInCond = { skipSubNodes: false, list: [] };
      path.traversePathsFast(findConditionIdentifiers, identifiersInCond);
      // Remove duplicates 
      identifiersInCond.list = identifiersInCond.list.filter((value, index, self) => 
        index === self.findIndex((t) => (
          t.name === value.name
        ))
      );
      path.node._newASTPointer.conditionVars = identifiersInCond.list;
      // Determine whether each identifier in conditionVar is a new declaration or a redeclaration.
      path.node._newASTPointer.conditionVars.forEach((condVar) => {
        condVar.isVarDec = true;
        tempDec.forEach((prevCondVar) => {
          if (condVar.name === prevCondVar) {
            condVar.isVarDec = false;
          }
        });
      });
    }
  },

  Conditional: {
    enter(path: NodePath) {
      const { node, parent } = path;
      const newNode = buildNode(node.nodeType, {
        condition: {},
        falseExpression: [],
        trueExpression: []
      });
      node._newASTPointer = newNode;
      parent._newASTPointer.push(newNode);
    },
  },

  ForStatement: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;
      node.body.statements.forEach(element => {
        if(element.containsPublic){
          state.skipSubelementNodes = true;
        }
      });
    if(!path?.containsSecret){
    state.skipSubNodes = true;
  } if(!state.skipSubNodes){
      const newNode = buildNode(node.nodeType);
      node._newASTPointer = newNode;
      parent._newASTPointer.push(newNode);
    }
    },
  },

  Literal: {
    enter(path: NodePath) {
      const { node, parent , parentPath } = path;
      const { value } = node;
      if (parentPath.isRequireStatement() && node.kind === 'string'){
        return;
      };
      if (node.kind !== 'number' && node.kind !== 'bool' && !path.getAncestorOfType('Return'))
        throw new Error(
          `Only literals of kind "number" are currently supported. Found literal of kind '${node.kind}'. Please open an issue.`,
        );

      // node._newASTPointer = // no pointer needed, because this is a leaf, so we won't be recursing any further.
      parent._newASTPointer[path.containerName] = buildNode('Literal', {
        value,
      });
    },
  },

  MemberAccess: {
    enter(path: NodePath, state: any) {
      const { parent, node } = path;
      let newNode: any;

      if (path.isMsgSender()) {
        newNode = buildNode('MsgSender');
        state.skipSubNodes = true;
      } else if (path.isMsgValue()) {
        newNode = buildNode('MsgValue');
        state.skipSubNodes = true;
      } else {
        newNode = buildNode('MemberAccess', { memberName: node.memberName, isStruct: path.isStruct(node)});
        node._newASTPointer = newNode;
      }


      // node._newASTPointer = // no pointer needed, because this is a leaf, so we won't be recursing any further.
      if (Array.isArray(parent._newASTPointer[path.containerName])) {
        parent._newASTPointer[path.containerName].push(newNode);
      } else {
        parent._newASTPointer[path.containerName] = newNode;
      }


    },
  },

  IndexAccess: {
    enter(path: NodePath, state: any) {
      const { node, parent } = path;

      if (!state.skipPublicInputs) path.traversePathsFast(publicInputsVisitor, {});

      const newNode = buildNode('IndexAccess');
      if (path.isConstantArray(node) && (path.isLocalStackVariable(node) || path.isFunctionParameter(node))) newNode.isConstantArray = true;
      // We don't need this because index access expressions always contain identifiers. 
      //publicVariables(path, state,newNode);
      node._newASTPointer = newNode;
      parent._newASTPointer[path.containerName] = newNode;
    },
  },

  FunctionCall: {
    enter(path: NodePath, state: any) {
      const { parent, node, scope } = path;


      // If this node is a require statement, it might include arguments which themselves are expressions which need to be traversed. So rather than build a corresponding 'assert' node upon entry, we'll first traverse into the arguments, build their nodes, and then upon _exit_ build the assert node.

      if (path.isRequireStatement() && !node.requireStatementPrivate) {
        // HACK: eventually we'll need to 'copy over' (into the circuit) require statements which have arguments which have interacted with secret states elsewhere in the function (at least)
        state.skipSubNodes = true;
        return;

        // newNode = buildNode('Assert', { arguments: node.arguments });
        //
        // node._newASTPointer = newNode;
        // parent._newASTPointer[path.containerName] = newNode;
        // return;
      }
      if (node.requireStatementPrivate) {
        const newNode = buildNode('Assert', { arguments: [] });

        node._newASTPointer = newNode;
        parent._newASTPointer[path.containerName] = newNode;
        return;
      }

      if (path.isExternalFunctionCall() || path.isExportedSymbol()) {
        // External function calls are the fiddliest of things, because they must be retained in the Solidity contract, rather than brought into the circuit. With this in mind, it's easiest (from the pov of writing this transpiler) if External function calls appear at the very start or very end of a function. If they appear interspersed around the middle, we'd either need multiple circuits per Zolidity function, or we'd need a set of circuit parameters (non-secret params / return-params) per external function call, and both options are too painful for now.

        // ignore external function calls; they'll be retained in Solidity, so won't be copied over to a circuit.
        state.skipSubNodes = true;
      }
      if(path.isInternalFunctionCall()) {

    const args = node.arguments;
    state.isAddStructDefinition = true;
    path.getAncestorOfType('FunctionDefinition')?.node.parameters.parameters.some(para => {
      for (const arg of args) {
        if((arg.typeDescriptions.typeIdentifier === para.typeDescriptions.typeIdentifier)
         && arg.typeDescriptions.typeIdentifier.includes('_struct') && para.typeDescriptions.typeIdentifier.includes('_struct'))
          state.isAddStructDefinition = false}})



    let isCircuit = false;
    state.newStateArray ??= {};
    const name = node.expression.name;
    state.newStateArray[name] ??= [];
    for (const arg of args) {
      if(arg.typeDescriptions.typeIdentifier.includes('_struct')){
        state.newStateArray[name] =  args.map(arg => ({name: arg.name, memberName: arg.memberName} ));
        state.structName = (arg.typeDescriptions.typeString.split(' '))[1].split('.')[1];
      }
      else
       state.newStateArray[name] =  args.map(arg => ({name: arg.name}));
      }
     let internalFunctionInteractsWithSecret = false;
     const newState: any = {};
     state.oldStateArray = state.oldStateArray ? state.oldStateArray : {};
     state.oldStateArray[name] = internalFunctionCallVisitor(path, newState);
     internalFunctionInteractsWithSecret ||= newState.internalFunctionInteractsWithSecret;
     state.internalFncName ??= [];
     state.internalFncName.push(node.expression.name);
     if(internalFunctionInteractsWithSecret === true){
      const callingfnDefPath = path.getFunctionDefinition();
      const callingfnDefIndicators = callingfnDefPath?.scope.indicators;
      const functionReferncedNode = scope.getReferencedPath(node.expression);
      const internalfnDefIndicators = functionReferncedNode?.scope.indicators;
      state.isEncrypted = internalfnDefIndicators.encryptionRequired;
      const startNodePath = path.getAncestorOfType('ContractDefinition');
      isCircuit = true;
      let modifiedVariables = [];
      // Check if the internal function should be imported into the circuit (this is updated later if future internal function calls modify the state variables accessed in this internal function)
      startNodePath?.node.nodes.forEach(node => {
        //every state variable in the contract that isn't a struct
        if(node.nodeType === 'VariableDeclaration' && !node.typeDescriptions.typeIdentifier.includes('_struct')){
          // Check if this state variable is accessed in the current internal function i.e. AddA, AddB
          if(internalfnDefIndicators[node.id]){
            if (state.circuitImport) state.circuitImport.forEach(fnCall => {
              if (fnCall.modVars.includes(node.name) && fnCall.callingFunction === callingfnDefPath.node.name) {
                isCircuit = false;
                fnCall.isImported = 'false';
              }
            });
            // Check if this state variable is modified in the current internal function i.e. AddA, AddB
            if(internalfnDefIndicators[node.id].isModified){
              modifiedVariables.push(node.name);
            }
            // Check if the state variable is accessed or modified outside of the current internal function
            if(callingfnDefIndicators[node.id]) {
              // Check if the state variable is modified outside of the current internal function
              if(callingfnDefIndicators[node.id].isModified) {
                if(internalfnDefIndicators[node.id].isMapping){
                  Object.keys(internalfnDefIndicators[node.id].mappingKeys).forEach(vars => {
                    if(state.newStateArray[name].some(statename => statename === vars))
                      isCircuit = false;
                  })
                } else
                  isCircuit = false;
              } else {
                  if(internalfnDefIndicators[node.id].isModified){
                    isCircuit = false;
                  }
              } 
            }           
          } 
        }
      });
    state.circuitImport ??= [];
    if(isCircuit)
      state.circuitImport.push({isImported: 'true', modVars: modifiedVariables, callingFunction: callingfnDefPath.node.name});
    else
      state.circuitImport.push({isImported: 'false', modVars: modifiedVariables, callingFunction: callingfnDefPath.node.name});
    let newNode: any;
    if(parent.nodeType === 'VariableDeclarationStatement') {
      state.isReturnInternalFunctionCall = true;
      state.functionArgs = node.arguments.map(args => args.name);
      const returnPara = functionReferncedNode.node.returnParameters.parameters[0].name;
      newNode = buildNode('InternalFunctionCall', {
        name: returnPara,
        internalFunctionInteractsWithSecret: internalFunctionInteractsWithSecret, // return
      });
      let fnDefNode = path.getContractDefinition().getFunctionByName(node.expression.name);
      fnDefNode._newASTPointer.isInternalFunctionCall = true;
      fnDefNode._newASTPointer.interactsWithSecret = internalFunctionInteractsWithSecret;

      
      if(parent._newASTPointer.declarations.length > 0){
        const functionParams = callingfnDefPath.node._newASTPointer.parameters.parameters.map(param => param.name);
        if(!functionParams.includes(returnPara)){
          callingfnDefPath.node._newASTPointer.parameters.parameters.push(functionReferncedNode.node.returnParameters.parameters[0]._newASTPointer);
          callingfnDefPath.node._newASTPointer.parameters.parameters[functionParams.length].declarationType = 'parameter';
          callingfnDefPath.node._newASTPointer.parameters.parameters[functionParams.length].interactsWithSecret = true;
        }
      }
     let includeExpressionNode = false;
      // this functions checks if the parent node interact with secret in the calling function or not
      callingfnDefIndicators[parent.declarations[0].id].interactsWith.forEach( node => {
        if(node.key != 'arguments' && node.interactsWithSecret)
        includeExpressionNode = true;
        })
          functionReferncedNode.node.body.statements.forEach(exp => {
            // If the return para interacts with public only in the internal function but with secret in calling function we need this expression in calling function
          if(exp?.expression.leftHandSide?.name === returnPara && !exp.expression.leftHandSide.interactsWithSecret){
            let initNode: any;
            if(['+=', '-=', '*=', '/='].includes(exp.expression.operator)) {
              initNode = buildNode('BinaryOperation', {
                leftExpression: exp.expression.leftHandSide,
                operator: exp.expression.operator.slice(0,-1),
                rightExpression: exp.expression.rightHandSide,
              });
            } else
            initNode = buildNode('BinaryOperation', {
              leftExpression: exp.expression.rightHandSide.leftExpression,
              operator: exp.expression.rightHandSide.operator,
              rightExpression: exp.expression.rightHandSide.rightExpression,
            });
            newNode = buildNode('InternalFunctionCall', {
              name: returnPara,
              internalFunctionInteractsWithSecret: internalFunctionInteractsWithSecret,
            });
            
            let fnDefNode = path.getContractDefinition().getFunctionByName(node.expression.name);
            fnDefNode._newASTPointer.isInternalFunctionCall = true;
            fnDefNode._newASTPointer.interactsWithSecret = internalFunctionInteractsWithSecret;

            if(includeExpressionNode) { 
              state.initNode ??= [];
              state.initNode[ returnPara ] = initNode;
            } 
          }
                
        })
      } else
      { 
        newNode = buildNode('InternalFunctionCall', {
        name: node.expression.name,
        internalFunctionInteractsWithSecret: internalFunctionInteractsWithSecret,
        CircuitArguments: [],
        CircuitReturn:[],
      });
      let fnDefNode = path.getContractDefinition().getFunctionByName(node.expression.name);
      fnDefNode._newASTPointer.isInternalFunctionCall = true;
      fnDefNode._newASTPointer.interactsWithSecret = internalFunctionInteractsWithSecret;

      
      }
     const fnNode = buildNode('InternalFunctionBoilerplate', {
       name: node.expression.name,
       internalFunctionInteractsWithSecret: internalFunctionInteractsWithSecret,
       circuitImport: isCircuit,
       functionCallIndex: state.circuitImport.length -1,
       structImport: !state.isAddStructDefinition,
       structName: state.structName,
       isEncrypted: state.isEncrypted,
      });
      node._newASTPointer = newNode ;
      parentnewASTPointer(parent, path, newNode, parent._newASTPointer[path.containerName]);
      const fnDefNode = path.getAncestorOfType('FunctionDefinition');
       state.callingFncName ??= [];
       state.callingFncName.push({name: fnDefNode?.node.name, parent: path.parentPath.parentPath.parent.nodeType});
       fnDefNode?.parent._newASTPointer.forEach(file => {
         if (file.fileName === fnDefNode.node.name) {
           file.nodes.forEach(childNode => {
             if (childNode.nodeType === 'ImportStatementList')
              childNode.imports?.push(fnNode);
           })
         }
       })
      }
     }
       if(path.isTypeConversion()) {
         const newNode = buildNode('TypeConversion', {
         type: node.typeDescriptions.typeString,
         });
          node._newASTPointer = newNode;
          parent._newASTPointer[path.containerName] = newNode;
          return;
        }
       if (path.isZero()) {
    // The path represents 0. E.g. "address(0)", so we don't need to traverse further into it.
         state.skipSubNodes = true;

          // Let's replace this thing with a '0' in the new AST:
          const newNode = buildNode('Literal', { value: 0 });
          parent._newASTPointer[path.containerName] = newNode;
        }
      },
    },
  };

export default visitor;
