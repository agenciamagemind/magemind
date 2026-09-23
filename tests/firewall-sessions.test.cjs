const {test}=require('node:test');const assert=require('node:assert/strict');
const {groupFirewallSessions}=require('../firewall-sessions.js');
const event=(minute,extra={})=>({user_id:'a',ip_address:'192.0.2.1',browser:'Safari',outcome:'success',event_type:'page_view',occurred_at:new Date(Date.UTC(2026,8,23,10,minute)).toISOString(),...extra});
test('groups continuous navigation without merging people, devices or failures',()=>{
 const groups=groupFirewallSessions([event(1),event(2,{user_id:'b'}),event(3),event(4,{outcome:'blocked'}),event(5,{browser:'Chrome'})]);
 assert.equal(groups.length,4);assert.equal(groups.find(g=>g.steps.length===2).steps[1].occurred_at,event(3).occurred_at);
 assert.equal(groups.reduce((n,g)=>n+g.steps.length,0),5);
});
test('new login, logout and inactivity delimit access sessions',()=>{
 assert.equal(groupFirewallSessions([event(0),event(31)]).length,2);
 assert.equal(groupFirewallSessions([event(0),event(1,{event_type:'login_success'})]).length,2);
 assert.equal(groupFirewallSessions([event(0),event(1,{event_type:'logout'}),event(2)]).length,2);
 assert.equal(groupFirewallSessions([event(0,{user_id:null}),event(1,{user_id:null})]).length,2);
});
