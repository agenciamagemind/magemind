(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(Number(n)/100);
 const compact=n=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n/100);
 function render(series){
  const rows=series?.rows||[];
  if(!rows.length)return '<div class="md-empty">As vendas aprovadas aparecerão aqui</div>';
  const width=640,height=240,left=58,right=18,top=20,bottom=38,base=height-bottom;
  const max=Math.max(100,...rows.map(r=>Number(r.gross_minor))),step=(width-left-right)/Math.max(1,rows.length-1);
  const points=rows.map((r,i)=>[left+i*step,base-Number(r.gross_minor)/max*(base-top)]);
  const line=points.map(p=>p.join(',')).join(' '),tickEvery=Math.max(1,Math.ceil((rows.length-1)/4));
  const grid=[0,.5,1].map(f=>{const y=base-f*(base-top);return '<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y+'" y2="'+y+'"/><text x="'+(left-8)+'" y="'+(y+4)+'" text-anchor="end">'+esc(compact(max*f))+'</text>';}).join('');
  const ticks=rows.map((r,i)=>i%tickEvery===0||i===rows.length-1?'<text class="mr-axis-label" x="'+points[i][0]+'" y="'+(height-13)+'" text-anchor="'+(i===0?'start':i===rows.length-1?'end':'middle')+'">'+esc(r.label)+'</text>':'').join('');
  const description=rows.map(r=>r.detail+': '+money(r.gross_minor)).join('; ');
  return '<div class="mr-chart" data-granularity="'+esc(series.granularity)+'"><div class="mr-chart-caption"><span>Faturamento bruto · '+esc({hour:'por hora',day:'por dia',week:'por semana',month:'por mês',year:'por ano'}[series.granularity])+'</span><strong>'+esc(money(rows.reduce((n,r)=>n+Number(r.gross_minor),0)))+'</strong></div><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Evolução do faturamento"><desc>'+esc(description)+'</desc><g class="mr-chart-grid">'+grid+'</g><polygon points="'+left+','+base+' '+line+' '+points.at(-1)[0]+','+base+'" fill="#a78bfa" opacity=".12"/><polyline points="'+line+'" fill="none" stroke="#ad8aff" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><g>'+points.map(([x,y],i)=>'<circle class="mr-point" tabindex="0" role="img" aria-label="'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'" data-tooltip="'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'" cx="'+x+'" cy="'+y+'" r="4" fill="#ad8aff"><title>'+esc(rows[i].detail+': '+money(rows[i].gross_minor))+'</title></circle>').join('')+'</g>'+ticks+'</svg></div>';
 }
 window.MagemindRevenueChart={render};
})();
