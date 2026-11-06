"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addObjectToStack = exports.setMember = exports.addVarToStack = exports.createEmptyObjectVar = exports.Action = void 0;
exports.createJsonDeclaration = createJsonDeclaration;
exports.createBytecode = createBytecode;
const utils_1 = require("../utils");
const bytes_1 = require("./bytes");
var Action;
(function (Action) {
    Action[Action["Push"] = 150] = "Push";
    Action[Action["GetVariable"] = 28] = "GetVariable";
    Action[Action["CallMethod"] = 82] = "CallMethod";
    Action[Action["DefineLocal"] = 60] = "DefineLocal";
    Action[Action["Add2"] = 71] = "Add2";
    Action[Action["NewObject"] = 64] = "NewObject";
    Action[Action["SetMember"] = 79] = "SetMember";
    Action[Action["InitObject"] = 67] = "InitObject";
    Action[Action["GetMember"] = 78] = "GetMember";
    Action[Action["InitArray"] = 66] = "InitArray";
    Action[Action["Pop"] = 23] = "Pop";
    Action[Action["CallFunction"] = 61] = "CallFunction";
    Action[Action["ConstantPool"] = 136] = "ConstantPool";
})(Action || (exports.Action = Action = {}));
function addElement(code, element) {
    if (Array.isArray(element)) {
        addArray(code, element);
    }
    else if (typeof element === 'object') {
        addObject(code, element);
    }
    else {
        if (!['string', 'number', 'boolean'].includes(typeof element)) {
            throw new Error('Invalid type for element');
        }
        code.push([Action.Push, element]);
    }
}
function addArray(code, array) {
    [...array].reverse().forEach(element => {
        addElement(code, element);
    });
    code.push([Action.Push, array.length], Action.InitArray);
}
function addObject(code, obj) {
    (0, utils_1.iterateEntries)(obj, (key, value) => {
        code.push([Action.Push, key]);
        addElement(code, value);
    });
    code.push([Action.Push, Object.keys(obj).length], Action.InitObject);
}
function createJsonDeclaration(obj) {
    const code = [];
    if (Array.isArray(obj)) {
        addArray(code, obj);
    }
    else {
        addObject(code, obj);
    }
    return code;
}
/** Equiv to `var name = new Object();` */
const createEmptyObjectVar = (name) => {
    return [
        [Action.Push, name],
        [Action.Push, 0],
        [Action.Push, "Object"],
        Action.NewObject,
        Action.DefineLocal
    ];
};
exports.createEmptyObjectVar = createEmptyObjectVar;
/** Add var of a name to the AVM1 stack */
const addVarToStack = (name) => {
    return [
        [Action.Push, name],
        Action.GetVariable
    ];
};
exports.addVarToStack = addVarToStack;
/**
 * Equiv to a member assingment `name.member = something` or `name[1] = something`
 * v: PCode that pushes a vairable to stack
 * member: Name of member that will be set (eg a property of object or index of array)
 * value: PCode that pushes the value to the stack, which will be assigned to member
 * */
const setMember = (v, member, value) => {
    return [
        ...v,
        [Action.Push, member],
        ...value,
        Action.SetMember
    ];
};
exports.setMember = setMember;
/**
 * Pushes a simple object as a value to the AVM1 stack
*/
const addObjectToStack = (obj) => {
    const entries = Object.entries(obj);
    const keys = entries.flatMap(([key, value]) => [
        [Action.Push, key],
        [Action.Push, value]
    ]);
    return [
        ...keys,
        [Action.Push, entries.length],
        Action.InitObject
    ];
};
exports.addObjectToStack = addObjectToStack;
function createBytecode(code) {
    const numbers = [];
    code.forEach(line => {
        if (typeof line === 'number') {
            numbers.push(line);
        }
        else {
            const action = line[0];
            const args = line.slice(1);
            switch (action) {
                case Action.Push:
                    numbers.push(Action.Push);
                    let bytes = 0;
                    args.forEach(arg => {
                        // type
                        bytes += 1;
                        if (typeof arg === 'number') {
                            // this is a UI32
                            bytes += 4;
                        }
                        else if (typeof arg === 'boolean') {
                            bytes += 1;
                        }
                        else {
                            // null terminated string
                            bytes += (new TextEncoder().encode(arg)).length + 1;
                        }
                    });
                    numbers.push(...(0, bytes_1.to2BytesLittleEndian)(bytes));
                    args.forEach(arg => {
                        if (typeof arg === 'number') {
                            numbers.push(0x07, ...(0, bytes_1.to4BytesLittleEndian)(arg));
                        }
                        else if (typeof arg === 'boolean') {
                            numbers.push(0x05, arg ? 1 : 0);
                        }
                        else {
                            const bytes = new TextEncoder().encode(arg);
                            numbers.push(0x00, ...bytes, 0x00);
                        }
                    });
                    break;
                default:
                    throw new Error(`Unimplemented bytecode with arguments: ${action}`);
            }
        }
    });
    return new Uint8Array(numbers);
}
