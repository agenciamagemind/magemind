const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {civilDate,revenueSeries}=require('../app-core.js');
test('São Paulo keeps the civil sale date after 21h and across month boundaries',()=>{
 assert.equal(civilDate('2026-09-10'),'2026-09-10');
 assert.equal(civilDate('2026-09-11T01:00:00Z'),'2026-09-10');
 assert.equal(civilDate('2026-09-01T02:00:00Z'),'2026-08-31');
});
const sales=[{status:'Fechado',date:'2026-09-10',value:0.1},{status:'Fechado',date:'2026-09-10',value:0.2},{status:'Pendente',date:'2026-09-10',value:200},{status:'Cancelado',date:'2026-09-10',value:300},{status:'Fechado',date:'2026-09-11',value:400},{status:'Fechado',date:'2026-09-09',value:100},{status:'Fechado',date:'2026-08-01',value:50}];
test('revenue excludes future, pending and canceled sales; total matches every chart bucket',()=>{
 for(const period of ['24h','48h','7d','14d','month','year','max']){
  const series=revenueSeries(sales,period,new Date('2026-09-11T01:00:00Z'));
  assert.equal(Math.round(series.buckets.reduce((sum,b)=>sum+b.value,0)*100),Math.round(series.total*100));
  assert.equal(series.rows.some(s=>s.value===400),false);
 }
 assert.equal(revenueSeries(sales,'24h',new Date('2026-09-10T18:00Z')).total,0.3);
 assert.equal(revenueSeries(sales,'48h',new Date('2026-09-10T18:00Z')).total,100.3);
 assert.equal(revenueSeries(sales,'month',new Date('2026-09-10T18:00Z')).total,100.3);
 assert.equal(revenueSeries(sales,'max',new Date('2026-09-10T18:00Z')).total,150.3);
});
test('empty revenue and year/month transitions retain a usable, consistent series',()=>{
 const series=revenueSeries([],'max',new Date('2026-01-01T15:00Z'));
 assert.equal(series.total,0);assert.equal(series.buckets.length,1);
 const previous=revenueSeries([{status:'Fechado',date:'2025-12-31',value:9}],'48h',new Date('2026-01-01T15:00Z'));
 assert.equal(previous.total,9);assert.deepEqual(previous.buckets.map(b=>b.label),['31/12','01/01']);
});
test('sale mapping and persisted editing keep the linked demand',async()=>{
 const html=fs.readFileSync('index.html','utf8');
 const map=html.slice(html.indexOf('function mapSale('),html.indexOf('function mapDoc('));
 const ctx=vm.createContext({});vm.runInContext(map,ctx);
 assert.equal(ctx.mapSale({id:'sale',client_id:'client',demand_id:'demand'}).demand,'demand');
 const save=html.slice(html.indexOf('async function saveSale('),html.indexOf('async function removeSale('));
 const fields={'s-value':'369','s-plan':'','s-client':'client','s-demand':'demand','s-desc':'test','s-assignee':'staff','s-status':'Pendente','s-date':'2026-09-10'};
 let stored;let closed=false;const errors=[];
 Object.assign(ctx,{DB:{sales:[{id:'sale',demand:''}],demands:[{id:'demand',client:'client'}],plans:[]},editSaleId:'sale',document:{getElementById:id=>({value:fields[id]}),querySelector:()=>null},Number,
  supa:{from:()=>({update:data=>({eq:()=>({select:()=>({single:async()=>{stored=data;return {data:{id:'sale',...data}};}})})})})},toast:(msg,type)=>{if(type==='err')errors.push(msg);},closeModal:()=>{closed=true;},loadSales:()=>{},renderPaymentAlert:()=>{}});
 vm.runInContext(save,ctx);await ctx.saveSale();assert.equal(stored.demand_id,'demand');assert.equal(ctx.DB.sales[0].demand,'demand');assert.equal(closed,true);assert.equal(errors.length,0);
 // A rejected update must keep the modal open and not report success.
 closed=false;ctx.supa.from=()=>({update:()=>({eq:()=>({select:()=>({single:async()=>({error:{message:'RLS denied'}})})})})});
 await ctx.saveSale();assert.equal(closed,false);assert.equal(errors.length,1);
});
test('all shipped JavaScript parses',()=>{
 const html=fs.readFileSync('index.html','utf8');for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 for(const path of ['mobile-app.js','app-core.js','app-accessibility.js','push-notifications.js','service-worker.js'])new vm.Script(fs.readFileSync(path,'utf8'));
});
