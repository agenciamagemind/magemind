(function(){
  'use strict';

  const VAPID_PUBLIC_KEY='BAWq7ruFDzLHp_dn__VNDO06gmbneBZGfucxBEcy85Dp_Qg8DTE-WEN6aQePVpx3BMc6araXih1Xp41Dbkx7Plo';
  const PROMPT_DAYS=14;
  const defaults={
    push_enabled:false,demand_updates:true,comments:true,sales:true,team_activity:true,general:true
  };
  let preferences={...defaults};

  function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1); }
  function isAndroid(){ return /android/i.test(navigator.userAgent); }
  function isStandalone(){ return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true; }
  function supported(){ return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window; }
  function platform(){ return isIOS()?'ios':(isAndroid()?'android':(matchMedia('(max-width:900px)').matches?'other':'desktop')); }
  function urlBase64ToUint8Array(value){
    const padding='='.repeat((4-value.length%4)%4);
    const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  }
  function hasSession(){ return typeof DB!=='undefined'&&Boolean(DB.me); }
  function promptKey(){ return `mm_push_prompt_${hasSession()?DB.me.id:'guest'}`; }

  async function registerServiceWorker(){
    if(!('serviceWorker' in navigator)) return null;
    try{ return await navigator.serviceWorker.register('./service-worker.js',{scope:'./'}); }
    catch(error){ console.error('Service Worker:',error); return null; }
  }

  async function currentSubscription(){
    const registration=await registerServiceWorker();
    return registration ? registration.pushManager.getSubscription() : null;
  }

  async function loadPreferences(){
    if(!hasSession()) return preferences;
    const {data,error}=await supa.from('notification_preferences').select('*').eq('user_id',DB.me.id).maybeSingle();
    if(error) console.error('notification_preferences:',error);
    preferences={...defaults,...(data||{})};
    return preferences;
  }

  window.renderPushSettings=async function(){
    const card=document.getElementById('push-settings-card');
    if(!card||!hasSession()) return;
    await loadPreferences();
    const toggle=document.getElementById('push-master-toggle');
    const status=document.getElementById('push-status');
    const button=document.getElementById('push-enable-button');
    const available=supported();
    let subscription=null;
    if(available) subscription=await currentSubscription();
    const active=Boolean(preferences.push_enabled&&subscription&&Notification.permission==='granted');

    toggle?.classList.toggle('on',active);
    toggle?.setAttribute('aria-checked',String(active));
    if(toggle) toggle.disabled=!available||Notification.permission==='denied';
    if(button){
      button.style.display=active?'none':'inline-flex';
      button.textContent=isIOS()&&!isStandalone()?'Instalar para ativar':'Ativar notificações';
    }
    if(status){
      if(!available) status.textContent='Este navegador não oferece suporte a notificações Web Push.';
      else if(Notification.permission==='denied') status.textContent='As notificações estão bloqueadas nas permissões do navegador.';
      else if(isIOS()&&!isStandalone()) status.textContent='No iPhone, instale e abra a Magemind pela Tela de Início para ativar.';
      else if(active) status.textContent='Ativas neste aparelho. Nada de aviso aleatório que não seja seu.';
      else status.textContent='Desativadas. Ative para receber os eventos importantes deste perfil.';
    }
    document.querySelectorAll('[data-push-pref]').forEach(input=>{
      input.checked=preferences[input.dataset.pushPref]!==false;
      input.disabled=!available;
    });
  };

  window.enablePushNotifications=async function(fromOnboarding=false){
    if(!hasSession()){ toast('Entre na sua conta antes de ativar notificações.','err'); return; }
    if(!supported()){ toast('Este navegador não oferece suporte a notificações.','err'); return; }
    if(isIOS()&&!isStandalone()){
      if(fromOnboarding) document.getElementById('push-onboarding')?.classList.remove('open');
      openInstallGuide(true);
      toast('No iPhone, abra o app pela Tela de Início para liberar notificações.','err');
      return;
    }
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){
        toast(permission==='denied'?'Permissão bloqueada no navegador.':'Ativação cancelada.','err');
        await window.renderPushSettings();
        return;
      }
      const registration=await registerServiceWorker();
      if(!registration) throw new Error('Não foi possível preparar o aplicativo');
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      const serialized=subscription.toJSON();
      const {error:subscriptionError}=await supa.from('push_subscriptions').upsert({
        user_id:DB.me.id,endpoint:subscription.endpoint,p256dh:serialized.keys?.p256dh,
        auth:serialized.keys?.auth,platform:platform(),enabled:true,last_seen_at:new Date().toISOString()
      },{onConflict:'user_id,endpoint'});
      if(subscriptionError) throw subscriptionError;
      const {error:preferenceError}=await supa.from('notification_preferences').upsert({
        user_id:DB.me.id,...preferences,push_enabled:true
      },{onConflict:'user_id'});
      if(preferenceError) throw preferenceError;
      preferences.push_enabled=true;
      localStorage.removeItem('mm_app_just_installed');
      document.getElementById('push-onboarding')?.classList.remove('open');
      toast('Notificações ativadas neste celular.','ok');
      await window.renderPushSettings();
    }catch(error){
      console.error('enablePushNotifications:',error);
      toast('Não foi possível ativar: '+(error.message||error),'err');
    }
  };

  window.disablePushNotifications=async function(){
    try{
      const subscription=await currentSubscription();
      if(subscription){
        await supa.from('push_subscriptions').delete().eq('user_id',DB.me.id).eq('endpoint',subscription.endpoint);
        await subscription.unsubscribe();
      }
      await supa.from('notification_preferences').upsert({user_id:DB.me.id,push_enabled:false},{onConflict:'user_id'});
      preferences.push_enabled=false;
      toast('Notificações desativadas. O silêncio venceu.','ok');
      await window.renderPushSettings();
    }catch(error){ toast('Erro ao desativar notificações: '+(error.message||error),'err'); }
  };

  window.togglePushNotifications=async function(){
    const subscription=supported()?await currentSubscription():null;
    if(preferences.push_enabled&&subscription) await window.disablePushNotifications();
    else await window.enablePushNotifications();
  };

  window.savePushCategory=async function(input){
    if(!hasSession()||!input?.dataset?.pushPref) return;
    const key=input.dataset.pushPref;
    const previous=preferences[key];
    preferences[key]=input.checked;
    const {error}=await supa.from('notification_preferences').upsert({user_id:DB.me.id,[key]:input.checked},{onConflict:'user_id'});
    if(error){ preferences[key]=previous; input.checked=previous; toast('Não foi possível salvar essa preferência.','err'); }
    else toast('Preferência de notificações salva.','ok');
  };

  window.dismissPushOnboarding=function(){
    document.getElementById('push-onboarding')?.classList.remove('open');
    try{ localStorage.setItem(promptKey(),String(Date.now())); }catch(_){}
  };

  async function maybePromptOnboarding(){
    if(!hasSession()||!supported()) return;
    await loadPreferences();
    if(preferences.push_enabled||Notification.permission==='denied') return;
    const installed=isStandalone()||localStorage.getItem('mm_app_just_installed')==='1';
    if(!installed) return;
    const dismissed=Number(localStorage.getItem(promptKey())||0);
    if(dismissed&&Date.now()-dismissed<PROMPT_DAYS*86400000) return;
    setTimeout(()=>document.getElementById('push-onboarding')?.classList.add('open'),900);
  }

  function openDemandFromPush(demandId){
    if(!demandId||!hasSession()) return;
    goTo('demands');
    setTimeout(()=>openDetail(demandId),250);
  }

  document.addEventListener('magemind:session-ready',()=>{
    window.renderPushSettings();
    maybePromptOnboarding();
    const pending=new URLSearchParams(location.search).get('openDemand');
    if(pending){ history.replaceState({},'',location.pathname); openDemandFromPush(pending); }
  });
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='OPEN_DEMAND') openDemandFromPush(event.data.demandId);
  });
  window.addEventListener('appinstalled',()=>setTimeout(maybePromptOnboarding,1000));
  document.addEventListener('DOMContentLoaded',()=>{
    registerServiceWorker();
    if(hasSession()){ window.renderPushSettings(); maybePromptOnboarding(); }
  });
})();
