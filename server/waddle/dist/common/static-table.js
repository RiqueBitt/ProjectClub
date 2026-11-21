"use strict";
/**
 * This class handles the big data tables. The "type code" meant for type safety is a bit cumbersome,
 * but its usability is rather simple if you look at how it is used in the codebase.
 * */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticDataTable = void 0;
/**
 * Defines a data table, which functions similarly to a SQL
 * table, but it is only meant to be used for reading data,
 * not deleting, creating or updating. It is used
 * for storing big chunks of data in organized way, for example
 * data on all the items in the game.
 *
 * The first type argument is an object meant to represent each "row"
 * in this table.
 *
 * The second type argument is an array containing all the property names
 * of the first type argument, in a specific order. Essentially, this should
 * be an array that lists all properties in the order you will be placing them
 * in the constructor argument.
 */
class StaticDataTable {
    map;
    /**
     * @param keys This should be the exact same as the second type argument
     * @param data An array, where each element is another array, containing elements for each property, in the order you have defined the properties of the type T
     */
    constructor(keys, data) {
        this.map = new Map();
        for (const row of data) {
            const object = {};
            for (let i = 0; i < keys.length; i++) {
                object[keys[i]] = row[i];
            }
            this.map.set(object.id, object);
        }
    }
    /** Given an ID number, get an item in the database. */
    get(id) {
        return this.map.get(id);
    }
    getStrict(id) {
        const item = this.get(id);
        if (item === undefined) {
            throw new Error(`Missing ID: ${id}`);
        }
        return item;
    }
    get rows() {
        return Array.from(this.map.values());
    }
    /** If id exists in the table */
    has(id) {
        return this.map.has(id);
    }
}
exports.StaticDataTable = StaticDataTable;
