/* One detail surface; mobile puts the metadata before the production content. */
(() => {
 'use strict';
 const mobile=matchMedia('(max-width:900px)');let viewportFrame=0;
 const modal=()=>document.getElementById('modal-detail');
 function arrange(){
  const root=modal();if(!root)return;
  const main=root.querySelector('.dd-main'),side=root.querySelector('.dd-side'),metadata=document.getElementById('det-metadata'),actions=document.getElementById('det-admin-controls');
  if(mobile.matches){if(metadata.parentElement!==main)main.prepend(metadata);if(actions.parentElement!==main)main.append(actions);}
  else{if(metadata.parentElement!==side)side.prepend(metadata);if(actions.parentElement!==side)side.append(actions);}
 }
 function fitTitle(){const title=document.getElementById('det-title');if(title?.tagName==='TEXTAREA'){title.style.height='auto';const css=getComputedStyle(title),border=parseFloat(css.borderTopWidth)+parseFloat(css.borderBottomWidth);title.style.height=Math.min(title.scrollHeight+border,parseFloat(css.maxHeight)||150)+'px';}}
 function viewport(){viewportFrame=0;const root=modal(),v=window.visualViewport;if(!mobile.matches){root.style.removeProperty('--demand-viewport-height');root.style.removeProperty('--demand-viewport-top');return;}if(v&&Math.abs(v.scale-1)>.05)return;root.style.setProperty('--demand-viewport-height',Math.round(v?.height||innerHeight)+'px');root.style.setProperty('--demand-viewport-top',Math.round(v?.offsetTop||0)+'px');}
 function scheduleViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(viewport);}
 function refreshStatus(status){for(const button of document.querySelectorAll('[data-detail-status]'))button.setAttribute('aria-pressed',String(button.dataset.detailStatus===status));}
 function opened(){
  arrange();viewport();const root=modal();refreshStatus(DB.demands.find(d=>d.id===currentDemandId)?.status);
  document.getElementById('det-metadata').classList.toggle('detail-client',isClient());
  fitTitle();
  for(const el of [root,...root.querySelectorAll('.modal,.dd-grid,.dd-main,.dd-side')]){el.scrollTop=0;el.scrollLeft=0;}
  window.focusDialogSurface(root);
  requestAnimationFrame(()=>{if(root.classList.contains('open'))root.querySelector('.dd-grid').scrollTop=0;});
 }
 window.MagemindDemandDetail={opened,fitTitle,refreshStatus};
 function init(){arrange();mobile.addEventListener('change',()=>{arrange();scheduleViewport();fitTitle();});window.visualViewport?.addEventListener('resize',scheduleViewport,{passive:true});window.visualViewport?.addEventListener('scroll',scheduleViewport,{passive:true});addEventListener('resize',scheduleViewport,{passive:true});document.addEventListener('focusin',scheduleViewport);document.addEventListener('focusout',scheduleViewport);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
