(function(root){
  'use strict';
  const zone='America/Sao_Paulo';
  function civilDate(value=new Date()){
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const part=type=>parts.find(p=>p.type===type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function shiftDay(day,offset){return new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
  function revenueSeries(sales,period,now=new Date()){
    const today=civilDate(now);
    let from='';
    if(period==='24h') from=today;
    else if(period==='48h') from=shiftDay(today,-1);
    else if(period==='7d'||period==='14d') from=shiftDay(today,1-parseInt(period));
    else if(period==='month') from=today.slice(0,7)+'-01';
    else if(period==='year') from=today.slice(0,4)+'-01-01';
    const rows=sales.filter(s=>s.status==='Fechado'&&civilDate(s.date||s.createdAt)&&civilDate(s.date||s.createdAt)<=today&&(!from||civilDate(s.date||s.createdAt)>=from));
    const total=rows.reduce((sum,s)=>sum+Math.round(Number(s.value||0)*100),0)/100;
    const monthly=period==='max'||period==='year';
    if(!from) from=rows.reduce((first,s)=>civilDate(s.date||s.createdAt)<first?civilDate(s.date||s.createdAt):first,today).slice(0,7)+'-01';
    const buckets=[];
    for(let day=from;day<=today;){
      const key=monthly?day.slice(0,7):day;
      const label=monthly?`${day.slice(5,7)}/${day.slice(2,4)}`:`${day.slice(8,10)}/${day.slice(5,7)}`;
      buckets.push({key,label,value:0});
      if(monthly){const date=new Date(day+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+1,1);day=date.toISOString().slice(0,10);}
      else day=shiftDay(day,1);
    }
    const byKey=new Map(buckets.map(b=>[b.key,b]));
    rows.forEach(s=>{const day=civilDate(s.date||s.createdAt);const b=byKey.get(monthly?day.slice(0,7):day);if(b)b.value+=Math.round(Number(s.value||0)*100);});
    buckets.forEach(b=>b.value/=100);
    return {rows,total,buckets,from,to:today};
  }
  function periodRange(period,from='',to='',now=new Date()){
    const today=civilDate(now);
    if(period==='custom')return {from,to};
    if(period==='today')return {from:today,to:today};
    if(period==='yesterday'){const day=shiftDay(today,-1);return {from:day,to:day};}
    if(period==='7d'||period==='14d')return {from:shiftDay(today,1-parseInt(period)),to:today};
    if(period==='month')return {from:today.slice(0,7)+'-01',to:today};
    return {from:'',to:today};
  }
  function filterSales(sales,range){return sales.filter(s=>{const d=civilDate(s.date||s.createdAt);return d&&(!range.from||d>=range.from)&&(!range.to||d<=range.to);});}
  function financeTotals(sales){
    const sum=status=>sales.filter(s=>s.status===status).reduce((n,s)=>n+Math.round(Number(s.value||0)*100),0);
    const revenue=sum('Fechado'),expenses=sum('Gasto'),pending=sum('Pendente');
    return {revenue:revenue/100,expenses:expenses/100,profit:(revenue-expenses)/100,pending:pending/100,ticket:sales.filter(s=>s.status==='Fechado').length?revenue/100/sales.filter(s=>s.status==='Fechado').length:0};
  }
  function goalProgress(goal,sales,now=new Date()){
    const today=civilDate(now),end=goal.end_date<today?goal.end_date:today;
    const rows=filterSales(sales,{from:goal.start_date,to:end}).filter(s=>s.status==='Fechado'&&(!goal.plan_id||s.plan===goal.plan_id));
    const current=goal.metric==='manual'?Number(goal.manual_value||0):goal.metric==='count'?rows.length:financeTotals(rows).revenue;
    const target=Number(goal.target),percent=target>0?Math.min(100,current/target*100):0;
    return {current,remaining:Math.max(0,target-current),percent,state:goal.archived?'archived':current>=target?'achieved':today<goal.start_date?'scheduled':today>goal.end_date?'missed':'active'};
  }
  const api={civilDate,shiftDay,revenueSeries,periodRange,filterSales,financeTotals,goalProgress};
  root.MagemindCore=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
