/* eslint-disable import/no-cycle */

// Q: how are we merging mapping key and ownerPK in edge case?
// Q: should we reduce constraints a mapping's commitment's preimage by not having the extra inner hash? Not at the moment, because it adds complexity to transpilation.

class BoilerplateGenerator {
  generateBoilerplate(node: any) {
    const { bpSection, bpType, ...otherParams } = node;
    return this?.[bpType]?.[bpSection]?.(otherParams) ?? [];
  }

  static uniqueify(arr: any[]) {
    return Array.from(new Set(arr));
  }

  PoKoSK = {
    importStatements(): string[] {
      return [
      `from "ecc/babyjubjubParams" import main as curveParams`,
      `from "ecc/edwardsScalarMult" import main as scalarMult`,
      `from "ecc/edwardsCompress" import main as edwardsCompress`,
      `from "utils/pack/bool/pack256.zok" import main as bool_256_to_field`,
      `from "utils/pack/bool/nonStrictUnpack256.zok" import main as field_to_bool_256`,
      ];
    },

    parameters({ name: x }): string[] {
      return [`private field mut ${x}_oldCommitment_owner_secretKey`];
    },

    postStatements({ name: x }): string[] {
      // default nullification lines (for partitioned & whole states)
      return [
        `
        // ${x}_oldCommitment - PoKoSK:
        // The correctness of this secret key will be constrained within the oldCommitment existence check.

        field[2] ${x}_oldCommitment_owner_publicKey_point = scalarMult(field_to_bool_256(${x}_oldCommitment_owner_secretKey), [curveParams().Gu, curveParams().Gv], curveParams());

        bool ${x}_oldCommitment_owner_publicKey_sign = edwardsCompress(${x}_oldCommitment_owner_publicKey_point)[0];

        bool[254] mut ${x}_oldCommitment_yBits = field_to_bool_256(${x}_oldCommitment_owner_publicKey_point[1])[2..256];
        ${x}_oldCommitment_yBits[0] = ${x}_oldCommitment_owner_publicKey_sign;

        field ${x}_oldCommitment_owner_publicKey = bool_256_to_field([false, false, ...${x}_oldCommitment_yBits]);`,
      ];
    },
  };

  nullification = {
    importStatements(): string[] {
      return [
        `from "utils/pack/bool/nonStrictUnpack256.zok" import main as field_to_bool_256`,
        `from "./common/hashes/poseidon/poseidon.zok" import main as poseidon`,
        `from "./common/merkle-tree/sparse-merkle-tree/checkproof.zok" import main as checkproof`,
        `from "./common/merkle-tree/sparse-merkle-tree/checkproof.zok" import checkUpdatedPath as checkUpdatedPath`,
      ];
    },

    parameters({ name: x, isAccessed, isNullified }): string[] {
      let para = [
        `private field mut ${x}_oldCommitment_owner_secretKey`,
        `public field mut ${x}_oldCommitment_nullifier`,
        
      ]
      return para;
    },

    preStatements({ name: x, id, isMapping }): string[] {
      if (isMapping) return [];
      return [
        `
        // We need to hard-code each stateVarId into the circuit:
        field ${x}_stateVarId_field = ${id};`
         // TODO: this results in unnecessary unpacking constraints, but simplifies transpilation effort, for now.
      ];
    },

    postStatements({ name: x , isAccessed, isNullified, initialisationRequired, isWhole, structProperties, structPropertiesTypes, typeName }): string[] {
      // default nullification lines (for partitioned & whole states)
      const lines: string[] = [];
      lines.push(
        `
        // Nullify ${x}:

        field ${x}_oldCommitment_nullifier_check_field = poseidon([\\
          ${x}_stateVarId_field,\\
          ${x}_oldCommitment_owner_secretKey,\\
          ${x}_oldCommitment_salt\\
        ]);

        assert(\\
        field_to_bool_256(${x}_oldCommitment_nullifier)[8..256] == field_to_bool_256(${x}_oldCommitment_nullifier_check_field)[8..256]\\
        );
        // ${x}_oldCommitment_nullifier : non-existence check`);

      if (initialisationRequired && isWhole) {
        // whole states also need to handle the case of a dummy nullifier
        lines.push(
          `
          ${x}_oldCommitment_owner_secretKey = if (${x}_oldCommitment_isDummy) { 0 } else { ${x}_oldCommitment_owner_secretKey };

          ${x}_oldCommitment_salt = if (${x}_oldCommitment_isDummy) { 0 } else { ${x}_oldCommitment_salt };`
        );
        if (structProperties) {
          if (structPropertiesTypes) {
            structPropertiesTypes.forEach(property => {
              if (property.typeName === 'bool'){
                lines.push(`${x}_oldCommitment_value.${property.name} = if (${x}_oldCommitment_isDummy) { false } else { ${x}_oldCommitment_value.${property.name} };`);
              } else{
                lines.push(
                  `${x}_oldCommitment_value.${property.name} = if (${x}_oldCommitment_isDummy) { 0 } else { ${x}_oldCommitment_value.${property.name} };`
                );
                }
            });
          }
        } else {
          if (typeName === 'bool'){
            lines.push(
              `${x}_oldCommitment_value = if (${x}_oldCommitment_isDummy) { false } else { ${x}_oldCommitment_value };`
            );
          } else {
            lines.push(
              `${x}_oldCommitment_value = if (${x}_oldCommitment_isDummy) { 0 } else { ${x}_oldCommitment_value };`
            );
          }
        }
      }
      return lines;
    },
  };

  oldCommitmentPreimage = {
    importStatements(): string[] {
      return [
        `from "./common/hashes/poseidon/poseidon.zok" import main as poseidon`,
      ];
    },

    parameters({ name: x, typeName, reinitialisable }): string[] {
      // prettier-ignore
      if(!reinitialisable)
      return [
        `private  ${typeName ? typeName : 'field'} mut ${x}_oldCommitment_value`,
        `private field mut ${x}_oldCommitment_salt`,
      ];
    },

    preStatements({ name: x, typeName, reinitialisable }): string[] {
      // For a state variable, we'll have passed in `${x}_oldCommitment_value` as a parameter. But our AST nodes will be using `${x}`. This line resolves the two.
      if (reinitialisable)
      return [ `${typeName ? typeName : 'field'} mut ${x} = 0;`]; // TODO?
      return [
        `
        ${typeName ? typeName : 'field'} mut ${x} = ${x}_oldCommitment_value;`,
      ];
    },

    postStatements({ name: x, structProperties, reinitialisable, structPropertiesTypes, typeName }): string[] {
      const lines: string[] = [];
      if (!structProperties && !reinitialisable ) {
        if (typeName === 'bool'){
          lines.push(`field ${x}_oldCommitment_value_field = if (${x}_oldCommitment_value) { 1 } else { 0 };`);
        } else {
          lines.push(`field ${x}_oldCommitment_value_field = ${x}_oldCommitment_value;`);
        }  
      } 

      if (structProperties){
        if (structPropertiesTypes) {
          structPropertiesTypes.forEach(property => {
            if (property.typeName === 'bool'){
              lines.push(`field ${x}_oldCommitment_value_${property.name}_field = if (${x}_oldCommitment_value.${property.name}) { 1 } else { 0 };`);
            }
          });
        }
        return [
          `
          // prepare secret state '${x}' for commitment

          ${lines.join('\n')}
          
          // ${x}_oldCommitment_commitment: preimage check

          field ${x}_oldCommitment_commitment_field = poseidon([\\
            ${x}_stateVarId_field,\\
            ${structPropertiesTypes.map(p => (p.typeName === 'bool') ? `\t \t \t \t \t \t${x}_oldCommitment_value_${p.name}_field,\\` : `\t ${x}_oldCommitment_value.${p.name},\\`).join('\n')}
            ${x}_oldCommitment_owner_publicKey,\\
            ${x}_oldCommitment_salt\\
          ]);`,
        ];
      }
      if(!reinitialisable)  
      return [

        `

        // prepare secret state '${x}' for commitment

          ${lines.join('\n')}
          
        // ${x}_oldCommitment_commitment: preimage check


        field ${x}_oldCommitment_commitment_field = poseidon([\\
          ${x}_stateVarId_field,\\
          ${x}_oldCommitment_value_field,\\
          ${x}_oldCommitment_owner_publicKey,\\
          ${x}_oldCommitment_salt\
        ]);`,
      ];
    },
  };

  oldCommitmentExistence = {
    importStatements(): string[] {
      return [
        `from "utils/pack/bool/nonStrictUnpack256.zok" import main as field_to_bool_256`,
        `from "./common/merkle-tree/mimc/altbn254/verify-membership/height32.zok" import main as checkRoot`,
      ];
    },

    parameters({ name: x, initialisationRequired, isWhole }): string[] {
      const lines = [
        `public field commitmentRoot`,
        `private field ${x}_oldCommitment_membershipWitness_index`,
        `private field[32] ${x}_oldCommitment_membershipWitness_siblingPath`,
      ];
      if (isWhole && initialisationRequired) {
        lines.unshift(`private bool ${x}_oldCommitment_isDummy`);
      }
      return lines;
    },

    postStatements({ name: x, isWhole, isAccessed, isNullified, initialisationRequired }): string[] {
      const lines = [
        `
        // ${x}_oldCommitment_commitment: existence check`,

        `
        field mut ${x}_commitmentRoot_check = checkRoot(\\
          ${x}_oldCommitment_membershipWitness_siblingPath,\\
          ${x}_oldCommitment_commitment_field,\\
          ${x}_oldCommitment_membershipWitness_index\\
        );`,

        `
        assert(\\
          field_to_bool_256(commitmentRoot)[8..256] == field_to_bool_256(${x}_commitmentRoot_check)[8..256]\\
        );`
        ,
      ];

      if (isWhole && initialisationRequired) {
        // initialisation of whole states requires a dummy oldCommitment to be ignored.
        lines.splice(
          -1,
          0,
          `
        // Note: Don't bother actually asserting existence, if the oldCommitment is a dummy:
        ${x}_commitmentRoot_check = if (${x}_oldCommitment_isDummy == true) { commitmentRoot } else { ${x}_commitmentRoot_check };`,
        );
      }
      return lines;
    },
  };

  newCommitment = {
    importStatements(): string[] {
      return [
        `from "utils/pack/bool/nonStrictUnpack256.zok" import main as field_to_bool_256`,
        `from "./common/hashes/poseidon/poseidon.zok" import main as poseidon`,
      ];
    },

    parameters({ name: x }): string[] {
      return [
        `private field ${x}_newCommitment_owner_publicKey`,
        `private field ${x}_newCommitment_salt`,
        `public field ${x}_newCommitment_commitment`,
      ];
    },

    preStatements({ name: x, id, isMapping, isWhole, isNullified, typeName, structProperties }): string[] {
      if (isMapping && isWhole) return [];
      let decLine = '';
      let stateVarIdLine = ``;
      if (!isMapping) stateVarIdLine = `
      // We need to hard-code each stateVarId into the circuit:
      field ${x}_stateVarId_field = ${id};`;
      if (!isWhole && isNullified) {
        const i = parseInt(x.slice(-1), 10);
        const x0 = x.slice(0, -1) + `${i-2}`;
        const x1 = x.slice(0, -1) + `${i-1}`;
        const x_name = x.slice(0, -2);
        let type = typeName ? typeName : 'field';
        decLine = `${type} mut ${x_name} = ${structProperties ? `${type} {${structProperties.map(p => ` ${p}: ${x0}.${p} + ${x1}.${p}`)}};` :`${x0} + ${x1};`} `;
      } else if (!isWhole){
        const x_name = x.slice(0, -2);
        let type = typeName ? typeName : 'field';
        decLine = `${type} mut ${x_name} = ${structProperties ? `${type} {${structProperties.map(p => ` ${p}: 0`)}};` :`0;`}`;
      } else{
        return [`
        // We need to hard-code each stateVarId into the circuit:
        field ${x}_stateVarId_field = ${id};`];
      }
      return [
        `${decLine}
        \n
        ${stateVarIdLine}`,
        // TODO: this results in unnecessary unpacking constraints, but simplifies transpilation effort, for now.
      ];
    },

    postStatements({ name: x, isWhole, isNullified, newCommitmentValue, structProperties, structPropertiesTypes, typeName }): string[] {
      // if (!isWhole && !newCommitmentValue) throw new Error('PATH');
      let y = isWhole ? x : x.slice(0, -2);
      const lines: string[] = [];
      if (!isWhole && isNullified) {
        // decrement
        const i = parseInt(x.slice(-1), 10);
        const x0 = x.slice(0, -1) + `${i-2}`;
        const x1 = x.slice(0, -1) + `${i-1}`;
        if (!structProperties) {
          lines.push(
            `assert(${y} >0);
            // TODO: assert no under/overflows

            field ${x}_newCommitment_value_field = ${y};`
          );
        } else {
          // TODO types for each structProperty
          lines.push(
            `${structProperties.map(p => newCommitmentValue[p] === '0' ? '' : `assert(${y}.${p} > 0);`).join('\n')}
            // TODO: assert no under/overflows

            ${typeName} ${x}_newCommitment_value = ${typeName} { ${structProperties.map(p => ` ${p}: ${y}.${p}`)} };`
          );
        }
      } else {
        if (!structProperties ) {
          if (typeName === 'bool'){
            lines.push(`field ${x}_newCommitment_value_field = if (${y}) {1} else {0};`);
          } else {
            lines.push(`field ${x}_newCommitment_value_field = ${y};`);
          }
          
        }
        else {
          lines.push(`${typeName} ${x}_newCommitment_value = ${typeName} { ${structProperties.map(p => ` ${p}: ${y}.${p}`)} };\n`);
          if (structPropertiesTypes) {
            structPropertiesTypes.forEach(property => {
              if (property.typeName === 'bool'){
                lines.push(`\t \t \t \t field ${x}_newCommitment_value_${property.name}_field = if (${x}_newCommitment_value.${property.name})  {1} else {0};`);
              }
            });
          }
        }
      }

      if (structProperties)
        return [
          `
          // prepare secret state '${x}' for commitment

          ${lines.join('\n')}

          // ${x}_newCommitment_commitment - preimage check

          field ${x}_newCommitment_commitment_check_field = poseidon([\\
            ${x}_stateVarId_field,\\
            ${structPropertiesTypes.map(p => (p.typeName === 'bool') ? `\t \t \t \t \t \t${x}_newCommitment_value_${p.name}_field,\\` : `\t ${x}_newCommitment_value.${p.name},\\`).join('\n')}
            ${x}_newCommitment_owner_publicKey,\\
            ${x}_newCommitment_salt\\
          ]);

          assert(\\
            field_to_bool_256(${x}_newCommitment_commitment)[8..256] == field_to_bool_256(${x}_newCommitment_commitment_check_field)[8..256]\\
          );`,
        ];

      return [
        `
        // prepare secret state '${x}' for commitment

        ${lines}

        // ${x}_newCommitment_commitment - preimage check

        field ${x}_newCommitment_commitment_check_field = poseidon([\\
          ${x}_stateVarId_field,\\
          ${x}_newCommitment_value_field,\\
          ${x}_newCommitment_owner_publicKey,\\
          ${x}_newCommitment_salt\\
        ]);

        assert(\\
          field_to_bool_256(${x}_newCommitment_commitment)[8..256] == field_to_bool_256(${x}_newCommitment_commitment_check_field)[8..256]\\
        );`
        ,
      ];
    },
  };

  encryption = {
    importStatements(): string[] {
      return [
        `from "ecc/babyjubjubParams" import BabyJubJubParams`,
        `from "ecc/babyjubjubParams" import main as curveParams`,
        `from "ecc/edwardsScalarMult" import main as scalarMult`,
        `from "ecc/edwardsCompress" import main as edwardsCompress`,
        `from "utils/pack/bool/pack256.zok" import main as bool_256_to_field`,
        `from "utils/casts/u32_to_field" import main as u32_to_field`,
        `from "./common/hashes/poseidon/poseidon.zok" import main as poseidon`,
        `from "./common/encryption/kem-dem.zok" import main as enc`,
        `from "./common/encryption/kem-dem.zok" import EncryptedMsgs as EncryptedMsgs`,
      ];
    },

    parameters({ name: x }): string[] {
      return [
        `private field ${x}_newCommitment_ephSecretKey`,
        `private field[2] ${x}_newCommitment_owner_publicKey_point`,
      ];
    },

    preStatements({ name: x }): string[] {
      return [
        `
        // calculate ${x}_newCommitment_owner_publicKey from its point
        bool ${x}_newCommitment_owner_publicKey_sign = edwardsCompress(${x}_newCommitment_owner_publicKey_point)[0];

        bool[254] mut ${x}_newCommitment_yBits = field_to_bool_256(${x}_newCommitment_owner_publicKey_point[1])[2..256];
        ${x}_newCommitment_yBits[0] = ${x}_newCommitment_owner_publicKey_sign;

        field ${x}_newCommitment_owner_publicKey = bool_256_to_field([false, false, ...${x}_newCommitment_yBits]);`,
      ];
    },

    postStatements({ name: x, structProperties}): string[] {
      return [
        `
        // ${x}_newCommitment encryption for owner

        ${structProperties ?
          `EncryptedMsgs<${structProperties.length + 2}> ${x}_cipherText = enc(\\
            field_to_bool_256(${x}_newCommitment_ephSecretKey),\\
            ${x}_newCommitment_owner_publicKey_point,\\
            [\\
              ${x}_stateVarId_field,\\
              ${structProperties.map(p => `\t ${x}_newCommitment_value.${p},\\`).join('\n')}
              ${x}_newCommitment_salt\\
            ]);`
          :
          `EncryptedMsgs<3> ${x}_cipherText = enc(\\
            field_to_bool_256(${x}_newCommitment_ephSecretKey),\\
            ${x}_newCommitment_owner_publicKey_point,\\
            [\\
              ${x}_stateVarId_field,\\
              ${x}_newCommitment_value_field,\\
              ${x}_newCommitment_salt\\
            ]);`
        }`,
      ];
    },
  };

  mapping = {
    importStatements(): string[] {
      return [
        `from "./common/hashes/mimc/altbn254/mimc2.zok" import main as mimc2`,
      ];
    },

    parameters({ mappingKeyName: k, mappingKeyTypeName: t }): string[] {
      if (t === 'local') return [];
      return [
        `private ${t ? t : 'field'} ${k}`, // must be a field, in case we need to do arithmetic on it.
      ];
    },

    preStatements({ id: mappingId, mappingName: m }): string[] {
      return [
        `
        // We need to hard-code the mappingId's of mappings into the circuit:
        field ${m}_mappingId = ${mappingId};`,
      ];
    },

    postStatements({ name: x, mappingName: m, mappingKeyName: k }): string[] {
      // const x = `${m}_${k}`;
      return [
        `
        field ${x}_stateVarId_field = mimc2([${m}_mappingId, ${k}]);`,
      ];
    },
  };

  incrementation = {
    importStatements(): string[] {
      return []; // TODO: we might eventually import some underflow/overflow functions.
    },
    statements({ name: x, addend, newCommitmentValue, structProperties, memberName}): string[] {
      if (addend.incrementType === '+='){
        if (structProperties) {
          return [`${x}.${memberName} = ${x}.${memberName} + ${newCommitmentValue};`]
        }
        return [`${x} = ${x} + ${newCommitmentValue};`];
      } else if (addend.incrementType === '='){
        if (structProperties) {
          return [`${x}.${memberName} = ${newCommitmentValue};`]
        }
        return [`${x} = ${newCommitmentValue};`];
      }
      //return [
      //  `// Skipping incrementation of ${x}`
        // `
      //];
    },
  };

  /** Partitioned states need boilerplate for a decrementation, because it's so weird and different from `a = a - b`. Whole states inherit directly from the AST, so don't need boilerplate here. */
  decrementation = {
    importStatements(): string[] {
      return []; // TODO: we might eventually import some underflow/overflow functions.
    },

    statements({ name: x, subtrahend, newCommitmentValue, structProperties, memberName}): string[] {
      if (subtrahend.decrementType === '-='){
        if (structProperties) {
          return [`${x}.${memberName} = ${x}.${memberName} - (${newCommitmentValue});`]
        }
        return [`${x} =  ${x} - (${newCommitmentValue});`];
      } else if (subtrahend.decrementType === '='){
        if (structProperties) {
          return [`${x}.${memberName} = ${newCommitmentValue};`]
        }
        return [`${x} = ${newCommitmentValue};`];
      }
      
      // const y = codeGenerator(subtrahend);
      // let i = startIndex;
      // const x0 = `${x}_${i++}`;
      // const x1 = `${x}_${i++}`;
      // const x2 = `${x}_${i}`;

      //return [
        //`// Moved decrementation of ${x}`
        // `
        // // The below represents the decrementation '${x} = ${x} - ${y}':
        //
        // assert(${x0} + ${x1} > ${y})
        // // TODO: assert no under/overflows
        //
        // field ${x2} = (${x0} + ${x1}) - ${y}`,
      //];
    },
  };
  internalFunctionCall = {
    importStatements( { name: x , circuitImport, structImport, structName: structName, isEncrypted} ): string[] {
      let internalFncImports = [];
      if(circuitImport)
      internalFncImports.push(`from "./${x}_internal.zok" import main as ${x}_internal`);
      if( structImport)
      internalFncImports.push(`from "./${x}_internal.zok" import ${structName} as ${structName} `);
      if(isEncrypted)
      internalFncImports.push(`from "./common/encryption/kem-dem.zok" import EncryptedMsgs as EncryptedMsgs `);
      return internalFncImports;
    },
  };

}

export default BoilerplateGenerator;
