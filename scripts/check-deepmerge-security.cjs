const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// Run only after approval, against the retained candidate extraction.
const candidate = process.env.DEEPMERGE_CANDIDATE || path.dirname(require.resolve('@scottdensmore/deepmerge-safe/package.json'));
const merge = require(path.resolve(candidate, 'dist/cjs.js'));
const payload = () => JSON.parse('{"__proto__":{"poisoned":true}}');
test('source writes on null-prototype targets cannot poison returned prototypes', () => {
 const result = merge(Object.create(null), payload());
 assert.equal(Object.getPrototypeOf(result), Object.prototype);
 assert.equal(result.poisoned, undefined);
 assert.equal(Object.hasOwn(result, '__proto__'), true);
 assert.equal(result.__proto__.poisoned, true);
 assert.equal({}.poisoned, undefined);
});
test('target copy and recursive source writes cannot trigger the prototype setter', () => {
 for (const result of [merge(payload(), {}), merge(payload(), payload()), merge({nested:payload()}, {nested:payload()}).nested]) {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.poisoned, undefined);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
 }
});
test('array cloning cannot poison returned element prototypes', () => {
 const r=merge({list:[payload()]},{}).list[0];
 assert.equal(Object.getPrototypeOf(r),Object.prototype);
 assert.equal(r.poisoned,undefined);
 assert.equal({}.poisoned,undefined);
});
test('Jest all/globals merging, array concat, symbols and clones retain semantics', () => {
 const symbol=Symbol('key');const first={a:{x:1},list:[{x:1}],[symbol]:{x:1}};
 const result=merge.all([first,{a:{y:2},list:[{y:2}]}]);
 assert.deepEqual(result.a,{x:1,y:2});assert.deepEqual(result.list,[{x:1},{y:2}]);
 assert.deepEqual(result[symbol],{x:1});assert.notEqual(result[symbol],first[symbol]);
 assert.notEqual(result.list[0],first.list[0]);
 assert.equal(merge({},first,{clone:false}).a,first.a);
});
test('custom merge and arrayMerge contracts are retained', () => {
 assert.deepEqual(merge({a:[1]},{a:[2]},{arrayMerge:(_a,b)=>b}),{a:[2]});
 const r=merge({a:{x:1}},{a:{y:2}},{customMerge:k=>k==='a'?()=>({custom:true}):undefined});
 assert.deepEqual(r,{a:{custom:true}});
});

test('UMD export also writes safe own data properties', () => {
 const fs=require('node:fs');const vm=require('node:vm');const context={};
 vm.runInNewContext(fs.readFileSync(path.resolve(candidate,'dist/umd.js'),'utf8'),context,{timeout:1000});
 assert.equal(typeof context.deepmerge,'function');
 const result=context.deepmerge(Object.create(null),payload());
 assert.equal(result.poisoned,undefined);
 assert.equal(Object.hasOwn(result,'__proto__'),true);
 assert.equal(result.__proto__.poisoned,true);
});
