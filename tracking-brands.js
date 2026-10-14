(() => {
 const brands={meta:{name:'Meta Ads',logo:'meta.svg'},google:{name:'Google Ads',logo:'google.svg'},tiktok:{name:'TikTok Ads',logo:'tiktok.svg'},kiwify:{name:'Kiwify',logo:'kiwify.svg'},hotmart:{name:'Hotmart',logo:'hotmart.png'},cartpanda:{name:'Cartpanda',logo:'cartpanda.png'},perfectpay:{name:'PerfectPay',logo:'perfectpay.png'},custom:{name:'API de pedidos',logo:null}};
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.MagemindTrackingBrands={
  integrationSections(card){
   const section=(id,title,subtitle,providers,classes='')=>'<section id="'+id+'" class="mt-integration-section '+classes+'"><div class="mt-integration-section-head"><h2 tabindex="-1">'+title+'</h2><p>'+subtitle+'</p></div><div class="cards-grid">'+providers.map(card).join('')+'</div></section>';
   return section('integration-ad-managers','Gerenciadores de anúncios','Contas que veiculam as campanhas.',['meta','google','tiktok'],'mt-ad-managers')+section('integration-checkouts','Checkouts','Pedidos, aprovações e informações dos compradores.',['kiwify','hotmart','cartpanda','perfectpay'])+'<section id="integration-gateways" class="mt-integration-section"><div class="mt-integration-section-head"><h2>Gateways de pagamento</h2><p>Conexões diretas com processadores de pagamentos.</p></div><div class="mt-category-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/></svg><div><strong>Nenhum gateway direto disponível</strong><p>Os pagamentos dos checkouts conectados já são acompanhados em Pedidos.</p></div></div></section>'+section('integration-other','Outras integrações','Pedidos por API e origem das vendas.',['custom']);
  },
  name:p=>brands[p]?.name||p,
  logo(p){const brand=brands[p];if(!brand?.logo)return '<span class="mt-brand-mark mt-brand-custom" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 4l-4 16"/></svg></span>';return '<span class="mt-brand-mark mt-brand-'+p+'"><img src="assets/integrations/'+brand.logo+'" alt="'+esc(brand.name)+'" width="32" height="32"></span>';}
 };
})();
