(() => {
 'use strict';
 const widget=document.getElementById('support-whatsapp'),link=document.getElementById('support-whatsapp-link'),bubble=document.getElementById('support-message');
 const messages=['Precisa de uma ajuda? Estamos por aqui.','Travou em alguma etapa? Vamos resolver juntos.','Uma dúvida por aí? Chama a gente no WhatsApp.','Quer uma mão para seguir? É só chamar.','Podemos ajudar em alguma coisa? Conte com a gente.'];
 let timer=null,hideTimer=null,shown=0,lastMessage=-1,account=null;
 const hide=()=>{bubble.hidden=true;clearTimeout(hideTimer);};
 function greeting(){const h=new Date().getHours();return h>=6&&h<12?'Bom dia':h>=12&&h<18?'Boa tarde':'Boa noite';}
 function schedule(delay=75000+Math.random()*45000){clearTimeout(timer);if(shown<4)timer=setTimeout(show,delay);}
 function show(){
  if(!sync())return;
  if(document.visibilityState!=='visible'||document.querySelector('.overlay.open,.install-guide.open,.sidebar.mobile-open')||document.getElementById('notif-panel')?.style.display==='block'){schedule(30000);return;}
  const options=messages.map((_,i)=>i).filter(i=>i!==lastMessage);lastMessage=options[Math.floor(Math.random()*options.length)];
  document.getElementById('support-message-text').textContent=greeting()+'! '+messages[lastMessage];bubble.hidden=false;shown++;
  hideTimer=setTimeout(hide,8000);schedule();
 }
 function sync(){
  const me=typeof DB!=='undefined'?DB.me:null,phone=typeof getAgencyPhone==='function'?getAgencyPhone():'';
  const active=Boolean(me&&phone&&document.getElementById('app')?.style.display!=='none');widget.hidden=!active;
  if(!active){hide();clearTimeout(timer);account=null;return false;}
  link.href='https://wa.me/'+phone+'?text='+encodeURIComponent('Olá, equipe Magemind! Preciso de ajuda com o aplicativo.');
  if(account!==me.id){account=me.id;shown=0;lastMessage=-1;hide();schedule(12000);}
  return true;
 }
 document.getElementById('support-message-close').addEventListener('click',hide);
 link.addEventListener('click',()=>{sync();hide();});
 document.addEventListener('magemind:session-ready',sync);
 document.addEventListener('magemind:tracking-signed-out',sync);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')hide();else sync();});
 new MutationObserver(sync).observe(document.getElementById('app'),{attributes:true,attributeFilter:['style']});
 window.MagemindSupport={sync};sync();
})();
