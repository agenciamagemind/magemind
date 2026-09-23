const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('partner capabilities cover production and subordinate staff without company finance or clients',()=>{
 const html=fs.readFileSync('index.html','utf8'),ctx=vm.createContext({DB:{me:{id:'p',role:'partner'},clients:[],plans:[]}});
 vm.runInContext(html.slice(html.indexOf('const ROLES ='),html.indexOf('/* ═══ HELPERS DE TEMPO')),ctx);
 for(const page of ['dashboard','partners','demands','team','settings','docs','solutions'])assert.equal(ctx.canAccessPage(page),true,page);
 for(const page of ['clients','sales','affiliates','firewall','goals','withdrawals'])assert.equal(ctx.canAccessPage(page),false,page);
 for(const role of ['gestor','editor']){assert.equal(ctx.canCreateRole(role),true);assert.equal(ctx.canManageRole({id:role,role}),true);}
 for(const role of ['ceo','manager','partner','client','affiliate']){assert.equal(ctx.canCreateRole(role),false);assert.equal(ctx.canManageRole({id:role,role}),false);}
 for(const perm of ['sales.create','sales.edit','clients.create','financial.view'])assert.equal(ctx.hasPermission(perm),false);
 assert.equal(ctx.canEditDemand({id:'d'}),true);
});
test('split summary combines independent referral and multiple partners, rejecting overflow and duplicates',()=>{
 const src=fs.readFileSync('partners.js','utf8'),ctx=vm.createContext({DB:{clients:[{id:'c',affiliateId:'ref'}],users:[{id:'ref',active:true,affiliateStatus:'approved',commissionRate:10}],commissions:[]},PartnerState:{draft:[{partner_id:'p',rate:50}]},editSaleId:null,document:{getElementById:id=>({value:id==='s-value'?'100':'c'})},toast:()=>{}});
 vm.runInContext(src.slice(src.indexOf('function getPartnerSplitSummary'),src.indexOf('async function openPartnerWithdrawal')),ctx);
 const s=ctx.getPartnerSplitSummary();assert.equal(s.referral,10);assert.equal(s.partners,50);assert.equal(s.remaining,40);assert.equal(ctx.validatePartnerDraft(),true);
 ctx.PartnerState.draft.push({partner_id:'p2',rate:20});assert.equal(ctx.getPartnerSplitSummary().remaining,20);assert.equal(ctx.validatePartnerDraft(),true);
 ctx.PartnerState.draft[1].rate=50;assert.equal(ctx.validatePartnerDraft(),false);
 ctx.PartnerState.draft[1]={partner_id:'p',rate:1};assert.equal(ctx.validatePartnerDraft(),false);
 ctx.PartnerState.draft=[];assert.equal(ctx.getPartnerSplitSummary().remaining,90);
});
test('team partner balances preserve reserved funds and exclude cancelled shares',()=>{
 const src=fs.readFileSync('partner-workspace.js','utf8'),ctx=vm.createContext({PartnerState:{shares:[{partner_id:'p',amount:100,state:'available',included:true},{partner_id:'p',amount:25,state:'pending',included:true},{partner_id:'p',amount:999,state:'cancelled',included:false},{partner_id:'other',amount:999,state:'available',included:true}],withdrawals:[{partner_id:'p',amount:20,status:'paid'},{partner_id:'p',amount:10,status:'approved'},{partner_id:'p',amount:4,status:'pending'},{partner_id:'p',amount:100,status:'reversed'}]}});
 vm.runInContext(src.slice(src.indexOf('function partnerTeamTotals'),src.indexOf('function renderTeamPartners')),ctx);
 const w=ctx.partnerTeamTotals('p');assert.equal(w.available,66);assert.equal(w.paid,20);assert.equal(w.total,125);
});
test('withdrawal rows preserve source so equal IDs cannot mix review endpoints',()=>{
 const src=fs.readFileSync('partner-workspace.js','utf8'),ctx=vm.createContext({DB:{withdrawals:[{id:'same',affiliate_name_snapshot:'Referral',amount:10}]},PartnerState:{withdrawals:[{id:'same',partner_name:'Partner',amount:50}]}});
 vm.runInContext(src.slice(src.indexOf('function unifiedWithdrawalRows'),src.indexOf('async function loadUnifiedWithdrawals')),ctx);
 const rows=ctx.unifiedWithdrawalRows();assert.equal(rows.length,2);assert.equal(rows[0].origin,'referral');assert.equal(rows[1].origin,'partner');assert.equal(rows[0].person,'Referral');assert.equal(rows[1].person,'Partner');
});
