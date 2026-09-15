const {test}=require('node:test'),assert=require('node:assert/strict');
const {periodRange,filterSales,financeTotals,goalProgress}=require('../app-core.js');
const now=new Date('2026-10-01T01:30Z'); // Still September 30 in São Paulo.
const sales=[{date:'2026-09-29',status:'Fechado',value:100,plan:'supreme'}, {date:'2026-09-30',status:'Fechado',value:200,plan:'supreme'}, {date:'2026-09-30',status:'Gasto',value:125.75}, {date:'2026-09-30',status:'Pendente',value:500,plan:'supreme'}, {date:'2026-09-30',status:'Cancelado',value:1000,plan:'supreme'}, {date:'2026-10-01',status:'Fechado',value:1000,plan:'supreme'}];
test('date presets use civil day, inclusive boundaries and exclude future dates',()=>{
 assert.deepEqual(periodRange('today','','',now),{from:'2026-09-30',to:'2026-09-30'});
 assert.deepEqual(periodRange('yesterday','','',now),{from:'2026-09-29',to:'2026-09-29'});
 assert.deepEqual(periodRange('month','','',now),{from:'2026-09-01',to:'2026-09-30'});
 assert.equal(filterSales(sales,periodRange('today','','',now)).length,4);
 assert.equal(filterSales(sales,periodRange('all','','',now)).length,5);
 assert.equal(filterSales(sales,periodRange('custom','2026-09-29','2026-09-30',now)).length,5);
});
test('expense, revenue, net profit and average ticket reconcile in every period',()=>{
 const t=financeTotals(filterSales(sales,periodRange('today','','',now)));
 assert.deepEqual(t,{revenue:200,expenses:125.75,profit:74.25,pending:500,ticket:200});
 assert.equal(financeTotals([{status:'Gasto',value:500}]).profit,-500);
 assert.equal(financeTotals([{status:'Fechado',value:.1},{status:'Fechado',value:.2},{status:'Gasto',value:.1}]).profit,.2);
});
test('automatic goals count only closed sales for the plan and dates; revisions regress progress',()=>{
 const g={metric:'revenue',start_date:'2026-09-29',end_date:'2026-10-05',target:15000,plan_id:null};
 assert.equal(goalProgress(g,sales,now).current,300);
 assert.equal(goalProgress({...g,metric:'count',target:3,plan_id:'supreme'},sales,now).remaining,1);
 assert.equal(goalProgress({...g,metric:'count',target:3,plan_id:'other'},sales,now).current,0);
 assert.equal(goalProgress(g,sales.map(s=>s.value===200?{...s,status:'Cancelado'}:s),now).current,100);
 assert.equal(goalProgress({...g,end_date:'2026-09-29'},sales,now).current,100);
 assert.equal(goalProgress({...g,start_date:'2026-10-01'},sales,now).state,'scheduled');
});
test('manual goals allow custom units, overachievement and archive without negative remaining',()=>{
 const g={metric:'manual',manual_value:12,target:10,start_date:'2026-09-01',end_date:'2026-09-30',unit:'reuniões'};
 assert.deepEqual(goalProgress(g,[],now),{current:12,remaining:0,percent:100,state:'achieved'});
 assert.equal(goalProgress({...g,archived:true},[],now).state,'archived');
 assert.equal(goalProgress({...g,manual_value:4,end_date:'2026-09-29'},[],now).state,'missed');
});
