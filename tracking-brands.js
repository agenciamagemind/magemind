(() => {
 const brands={meta:{name:'Meta Ads',logo:'meta.svg'},google:{name:'Google Ads',logo:'google.svg'},tiktok:{name:'TikTok Ads',logo:'tiktok.svg'},kiwify:{name:'Kiwify',logo:'kiwify.svg'},hotmart:{name:'Hotmart',logo:'hotmart.png'},custom:{name:'API de pedidos',logo:null}};
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.MagemindTrackingBrands={
  name:p=>brands[p]?.name||p,
  logo(p){const brand=brands[p];if(!brand?.logo)return '<span class="mt-brand-mark mt-brand-custom" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 4l-4 16"/></svg></span>';return '<span class="mt-brand-mark mt-brand-'+p+'"><img src="assets/integrations/'+brand.logo+'" alt="'+esc(brand.name)+'" width="32" height="32"></span>';}
 };
})();
