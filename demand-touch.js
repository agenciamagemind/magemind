/* Hold to pick up; a quick swipe keeps native scrolling. Persist through the
   same permission checks, ordering RPC and rollback path as desktop drops. */
(() => {
 'use strict';
 let board=null,gesture=null,frame=0,lastFrame=0,blockClickUntil=0,lastTouchTime=0,announcement=null;
 const mobile=()=>matchMedia('(max-width:900px),(pointer:coarse)').matches;
 const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
 const touch=(list,id)=>[...list].find(t=>t.identifier===id);
 function announce(message){if(!announcement){announcement=document.createElement('div');announcement.className='touch-drag-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');document.body.append(announcement);}announcement.textContent=message;}
 function clean({keepGhost=false,clearDrag=true}={}){
  const old=gesture;if(!old)return null;gesture=null;clearTimeout(old.timer);cancelAnimationFrame(frame);frame=0;lastFrame=0;
  old.card.classList.remove('touch-hold-pending','touch-drag-source');old.marker?.remove();if(!keepGhost)old.ghost?.remove();
  board?.querySelectorAll('.touch-drop-column').forEach(c=>c.classList.remove('touch-drop-column'));document.body.classList.remove('kanban-touch-dragging');
  if(clearDrag&&old.active)dragEnd();return old;
 }
 function cancel(){const active=gesture?.active;clean();if(active){blockClickUntil=Date.now()+500;suppressDemandClickUntil=blockClickUntil;announce('Movimentação cancelada.');}}
 function target(){
  const g=gesture;if(!g?.active)return;const br=board.getBoundingClientRect();let column=null;
  if(g.x>=Math.max(0,br.left)&&g.x<=Math.min(innerWidth,br.right))column=[...board.querySelectorAll('.k-col')].find(c=>{const r=c.getBoundingClientRect();return g.x>=r.left&&g.x<=r.right;});
  board.querySelectorAll('.k-col').forEach(c=>c.classList.toggle('touch-drop-column',c===column));
  if(!column){g.column=null;g.marker.hidden=true;return;}
  const cards=[...column.querySelectorAll('.k-card')].filter(c=>c!==g.card),following=cards.find(c=>{const r=c.getBoundingClientRect();return g.y<r.top+r.height/2;});
  const last=cards.at(-1),reference=following||last,rect=reference?.getBoundingClientRect(),list=column.querySelector('.k-cards').getBoundingClientRect();
  g.targetId=reference?.dataset.demandId||null;g.after=!following&&Boolean(last);g.column=column.dataset.demandStatus;
  const y=rect?(following?rect.top-4:rect.bottom+4):list.top+10;
  g.marker.hidden=y<0||y>innerHeight;g.marker.style.width=Math.max(0,list.width-20)+'px';g.marker.style.transform=`translate3d(${list.left+10}px,${y}px,0)`;
  if(g.lastColumn!==g.column){g.lastColumn=g.column;announce('Destino: '+g.column+'. Solte para posicionar.');}
 }
 function edgeSpeed(point,min,max,zone,speed){if(point<min+zone)return -speed*Math.min(1,Math.max(0,(min+zone-point)/zone));if(point>max-zone)return speed*Math.min(1,Math.max(0,(point-max+zone)/zone));return 0;}
 function tick(time){
  const g=gesture;if(!g?.active)return;
  const d=DB.demands.find(d=>d.id===g.demandId);
  if(DB.me?.id!==g.owner||!g.card.isConnected||!d||!canMoveDemand(d)||!document.getElementById('pg-demands').classList.contains('active')){cancel();return;}
  const factor=lastFrame?Math.min(2,(time-lastFrame)/16.67):1;lastFrame=time;
  const r=board.getBoundingClientRect(),m=g.main.getBoundingClientRect(),css=getComputedStyle(document.documentElement);
  const top=Math.max(m.top,0)+(parseFloat(css.getPropertyValue('--mobile-header-height'))||60)+12;
  const bottom=Math.min(m.bottom,innerHeight)-(parseFloat(css.getPropertyValue('--mobile-nav-h'))||66)-20;
  const vx=edgeSpeed(g.x,Math.max(r.left,0),Math.min(r.right,innerWidth),48,11),vy=edgeSpeed(g.y,top,bottom,58,12);
  if(vx)board.scrollLeft+=vx*factor;if(vy)g.main.scrollTop+=vy*factor;
  g.ghost.style.transform=`translate3d(${g.x-g.offsetX}px,${g.y-g.offsetY-10}px,0) scale(1.025) rotate(1deg)`;target();frame=requestAnimationFrame(tick);
 }
 function activate(){
  const g=gesture,d=g&&DB.demands.find(d=>d.id===g.demandId);if(!g||!g.card.isConnected||DB.me?.id!==g.owner||kanbanOrderSaving||!d||!canMoveDemand(d)){cancel();return;}
  g.active=true;closeDemandContextMenu();dragId=g.demandId;dragOverId=null;dragInsertAfter=false;
  const r=g.card.getBoundingClientRect();g.offsetX=Math.min(r.width,Math.max(0,g.x-r.left));g.offsetY=Math.min(r.height,Math.max(0,g.y-r.top));
  const ghost=g.card.cloneNode(true);ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));ghost.classList.remove('touch-hold-pending');ghost.classList.add('touch-drag-ghost');ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.draggable=false;ghost.style.width=r.width+'px';ghost.style.height=r.height+'px';document.body.append(ghost);g.ghost=ghost;
  const marker=document.createElement('div');marker.className='touch-drop-line';marker.setAttribute('aria-hidden','true');document.body.append(marker);g.marker=marker;
  g.card.classList.remove('touch-hold-pending');g.card.classList.add('touch-drag-source');document.body.classList.add('kanban-touch-dragging');
  announce('Demanda selecionada. Arraste para mudar a posição ou o status.');frame=requestAnimationFrame(tick);
 }
 function start(e){
  if(e.touches.length!==1){cancel();return;}if(!mobile()||kanbanOrderSaving||document.querySelector('.overlay.open'))return;
  const card=e.target.closest('.k-card[data-demand-id]');if(!card||!board.contains(card)||e.target.closest('button,a,input,textarea,select'))return;
  lastTouchTime=Date.now();
  const d=DB.demands.find(d=>d.id===card.dataset.demandId);if(!d||!canMoveDemand(d))return;cancel();const t=e.touches[0];
  gesture={card,demandId:d.id,owner:DB.me.id,identifier:t.identifier,x:t.clientX,y:t.clientY,startX:t.clientX,startY:t.clientY,main:board.closest('.main'),active:false,column:null};
  card.classList.add('touch-hold-pending');gesture.timer=setTimeout(activate,360);
 }
 function move(e){
  const g=gesture;if(!g)return;if(e.touches.length!==1){cancel();return;}const t=touch(e.touches,g.identifier);if(!t)return;
  g.x=t.clientX;g.y=t.clientY;if(!g.active){if(Math.hypot(g.x-g.startX,g.y-g.startY)>8)cancel();return;}
  if(e.cancelable)e.preventDefault();e.stopPropagation();
 }
 function settle(old){
  const ghost=old.ghost;if(!ghost)return;if(reduced()){ghost.remove();return;}
  requestAnimationFrame(()=>{const r=document.getElementById('kc-'+old.demandId)?.getBoundingClientRect(),visible=r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;
   const end=visible?{transform:`translate3d(${r.left}px,${r.top}px,0) scale(1) rotate(0deg)`,opacity:0}:{opacity:0};
   ghost.animate([{transform:ghost.style.transform,opacity:.95},end],{duration:170,easing:'cubic-bezier(.2,.75,.25,1)',fill:'forwards'}).finished.catch(()=>{}).finally(()=>ghost.remove());
  });
 }
 function end(e){
  const g=gesture;if(!g)return;if(!touch(e.changedTouches,g.identifier))return;
  if(!g.active){clean();return;}if(e.cancelable)e.preventDefault();e.stopPropagation();target();
  const d=DB.demands.find(d=>d.id===g.demandId),allowed=DB.me?.id===g.owner&&g.column&&d&&canMoveDemand(d);
  const old=clean({keepGhost:Boolean(allowed),clearDrag:!allowed});blockClickUntil=Date.now()+550;suppressDemandClickUntil=blockClickUntil;
  if(!allowed){announce('Movimentação cancelada.');return;}
  dragId=old.demandId;dragOverId=old.targetId;dragInsertAfter=old.after;
  drop({preventDefault(){},stopPropagation(){}},old.column).catch(error=>{console.error('Movimentação por toque:',error);toast('Não foi possível mover a demanda. Tente novamente.','err');});settle(old);
 }
 function init(){
  board=document.getElementById('kanban-board');if(!board)return;
  board.addEventListener('touchstart',start,{passive:true});board.addEventListener('touchmove',move,{passive:false});
  document.addEventListener('touchend',end,{passive:false});document.addEventListener('touchcancel',cancel,{passive:true});
  document.addEventListener('click',e=>{if(Date.now()<blockClickUntil&&e.target.closest('.k-card')){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  document.addEventListener('contextmenu',e=>{if((gesture||Date.now()-lastTouchTime<1500)&&e.target.closest('.k-card')){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  addEventListener('resize',cancel,{passive:true});addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  new MutationObserver(()=>{if(gesture&&!gesture.card.isConnected)cancel();}).observe(board,{childList:true});
 }
 window.MagemindTouchKanban={cancel,isTouchGesture:()=>Boolean(gesture)};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
