const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
test('only CEO and manager gain Oráculo; every other role retains its pages',()=>{
 const source=html.slice(html.indexOf('const ROLE_PAGES ='),html.indexOf('const ROLE_RANK ='));
 const roles=vm.runInNewContext(source+';ROLE_PAGES');
 const expected={ceo:['dashboard','clients','demands','sales','withdrawals','goals','solutions','affiliates','team','docs','firewall','settings'],manager:['dashboard','clients','demands','sales','withdrawals','goals','solutions','affiliates','team','docs','settings'],partner:['dashboard','partners','demands','team','docs','solutions','settings'],gestor:['dashboard','demands','affiliates','team','docs','settings'],editor:['dashboard','demands','affiliates','docs','settings'],affiliate:['dashboard','affiliates','docs','settings'],client:['dashboard','demands','solutions','affiliates','docs','settings']};
 for(const [role,pages] of Object.entries(expected))assert.deepEqual(Array.from(roles[role]),['ceo','manager'].includes(role)?[...pages,'oraculo']:pages);
});
test('Oráculo appears once inside existing work navigation without auxiliary menu pages',()=>{
 const source=fs.readFileSync('product-ui.js','utf8').split('function setupSettingsTabs')[0];
 const group=vm.runInNewContext(source+';groupSidebarNavigation');
 const items=['dashboard','demands','docs','oraculo','clients','settings'].map(id=>({id}));
 const nav=group(items,item=>'<button>'+item.id+'</button>');
 assert.equal(nav.match(/<button>oraculo<\/button>/g).length,1);
 assert.match(nav,/<button>docs<\/button><button>oraculo<\/button>/);
 assert.equal((nav.match(/<section/g)||[]).length,3);
 assert.match(html,/frame-src https:\/\/oraculo-magemind\.oraculo-magemind\.workers\.dev;/);
});
