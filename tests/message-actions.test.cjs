const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectedMessages, formatMessages } = require('../src/message-actions.cjs');
test('bounded exact message IDs scoped to active project, never renderer text', () => {
 const p = { id:'a', messages:[{id:'m',role:'assistant',content:'hello',at:'now'}] };
 assert.equal(selectedMessages(p,{projectId:'a',messageIds:['m']})[0].content,'hello');
 for(const arg of [{projectId:'b',messageIds:['m']},{projectId:'a',messageIds:['unknown']},{projectId:'a',messageIds:['m','m']},{projectId:'a',messageIds:Array(21).fill('m')}]) assert.throws(()=>selectedMessages(p,arg));
 assert.equal(formatMessages(selectedMessages(p,{projectId:'a',messageIds:['m']}),'txt'),'ADActive · now\nhello');
 assert.throws(()=>formatMessages(p.messages,'html'));
});
