(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(Number(n)/100);
 const compact=n=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n/100);
 function render(series,{width:availableWidth=640,height:availableHeight=240}={}){
  const rows=series?.rows||[];
  if(!rows.length)return '<div class="md-empty">As vendas aprovadas aparecerão aqui</div>';
  const width=Math.max(118,availableWidth),height=Math.max(82,availableHeight-33);
  const left=width<300?34:49,right=9,top=9,bottom=21,base=height-bottom;
  const max=Math.max(100,...rows.map(r=>Number(r.gross_minor))),step=(width-left-right)/Math.max(1,rows.length-1);
  const points=rows.map((r,i)=>[left+i*step,base-Number(r.gross_minor)/max*(base-top)]);
  const line=points.map(p=>p.join(',')).join(' ');
  const tickCount=Math.min(rows.length,6,Math.max(2,Math.floor((width-left-right)/74)+1));
  const indices=Array.from({length:tickCount},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,tickCount-1)));
  const grid=[0,.5,1].map(f=>{const y=base-f*(base-top);return '<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y+'" y2="'+y+'"/><text x="'+(left-8)+'" y="'+(y+4)+'" text-anchor="end">'+esc(compact(max*f))+'</text>';}).join('');
  const ticks=indices.map(i=>'<text class="mr-axis-label" x="'+points[i][0]+'" y="'+(height-5)+'" text-anchor="'+(i===0?'start':i===rows.length-1?'end':'middle')+'">'+esc(rows[i].label)+'</text>').join('');
  const description=rows.map(r=>r.detail+': '+money(r.gross_minor)).join('; ');
  return '<div class="mr-chart" data-granularity="'+esc(series.granularity)+'"><div class="mr-chart-caption"><span>Faturamento bruto · '+esc({hour:'por hora',day:'por dia',week:'por semana',month:'por mês',year:'por ano'}[series.granularity])+'</span><strong>'+esc(money(rows.reduce((n,r)=>n+Number(r.gross_minor),0)))+'</strong></div><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Evolução do faturamento"><desc>'+esc(description)+'</desc><g class="mr-chart-grid">'+grid+'</g><polygon points="'+left+','+base+' '+line+' '+points.at(-1)[0]+','+base+'" fill="var(--accent)" opacity=".12"/><polyline points="'+line+'" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><g>'+points.map(([x,y],i)=>'<circle class="mr-point" tabindex="0" role="img" aria-label="'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'" data-tooltip="'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'" cx="'+x+'" cy="'+y+'" r="4" fill="var(--accent)"><title>'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'</title></circle>').join('')+'</g>'+ticks+'</svg></div>';
 }
 window.MagemindRevenueChart={render};
})();
