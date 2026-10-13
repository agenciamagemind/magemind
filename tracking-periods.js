(() => {
 'use strict';
 const presets=Object.freeze([
  {id:'today',label:'Hoje'}, {id:'yesterday',label:'Ontem'}, {id:'two-days',label:'Ontem e hoje'},
  {id:'week',label:'Última semana',hint:'Últimos 7 dias'}, {id:'fortnight',label:'Últimos 14 dias'},
  {id:'month',label:'Último mês',hint:'Últimos 30 dias'}, {id:'quarter',label:'Últimos 3 meses',hint:'Últimos 90 dias'},
  {id:'custom',label:'Período personalizado'}
 ].map(Object.freeze));
 const dateKey=(now,timeZone)=>new Intl.DateTimeFormat('sv-SE',{timeZone}).format(new Date(now));
 function shift(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
 function range(id,now=Date.now(),timeZone='America/Sao_Paulo'){
  const today=dateKey(now,timeZone),length={today:1,'two-days':2,week:7,fortnight:14,month:30,quarter:90}[id];
  if(id==='yesterday'){const yesterday=shift(today,-1);return {from:yesterday,to:yesterday};}
  if(!length)throw new Error('Período rápido inválido');return {from:shift(today,1-length),to:today};
 }
 function validRange(from,to){return [from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d)&&from<=to;}
 function infer(from,to,now,timeZone){return presets.find(p=>p.id!=='custom'&&JSON.stringify(range(p.id,now,timeZone))===JSON.stringify({from,to}))?.id||'custom';}
 window.MagemindTrackingPeriods=Object.freeze({presets,range,validRange,infer});
})();
