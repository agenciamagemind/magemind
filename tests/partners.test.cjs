const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('partner capabilities cover production and subordinate staff without company finance or clients',()=>{
 const html=fs.readFileSync('index.html','utf8'),ctx=vm.createContext({DB:{me:{id:'p',role:'partner'},clients:[],plans:[]}});
 vm.runInContext(html.slice(html.indexOf('const ROLES ='),html.indexOf('/* ═══ HELPERS DE TEMPO')),ctx);
 for(const page of ['dashboard','partners','demands','team','settings'])assert.equal(ctx.canAccessPage(page),true,page);
 for(const page of ['clients','sales','affiliates','firewall','goals','docs'])assert.equal(ctx.canAccessPage(page),false,page);
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
