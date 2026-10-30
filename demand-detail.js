/* One detail surface; mobile puts the metadata before the production content. */
(() => {
 'use strict';
 const mobile=matchMedia('(max-width:900px)');
 const modal=()=>document.getElementById('modal-detail');
 function arrange(){
  const root=modal();if(!root)return;
  const main=root.querySelector('.dd-main'),side=root.querySelector('.dd-side'),metadata=document.getElementById('det-metadata'),actions=document.getElementById('det-admin-controls');
  if(mobile.matches){if(metadata.parentElement!==main)main.prepend(metadata);if(actions.parentElement!==main)main.append(actions);}
  else{if(metadata.parentElement!==side)side.prepend(metadata);if(actions.parentElement!==side)side.append(actions);}
 }
 function fitTitle(){const title=document.getElementById('det-title');if(title?.tagName==='TEXTAREA'){title.style.height='auto';title.style.height=Math.min(title.scrollHeight,150)+'px';}}
 function opened(){
  arrange();const root=modal();
  document.getElementById('det-metadata').classList.toggle('detail-client',isClient());
  fitTitle();
  for(const el of [root,...root.querySelectorAll('.modal,.dd-grid,.dd-main,.dd-side')]){el.scrollTop=0;el.scrollLeft=0;}
  document.getElementById('det-close')?.focus({preventScroll:true});
  requestAnimationFrame(()=>{if(root.classList.contains('open'))root.querySelector('.dd-grid').scrollTop=0;});
 }
 window.MagemindDemandDetail={opened,fitTitle};
 function init(){arrange();mobile.addEventListener('change',arrange);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
