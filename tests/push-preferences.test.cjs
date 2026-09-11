const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const calls=[];let subscriptionExists=true;let failDisable=false;
 const subscription={endpoint:'https://push.example.invalid/device',toJSON:()=>({keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{subscriptionExists=false;return true;}};
 const registration={pushManager:{getSubscription:async()=>subscriptionExists?subscription:null,subscribe:async()=>subscription}};
 const context={console,Uint8Array,atob,URLSearchParams,Date,setTimeout:()=>0,DB:{me:{id:'current-user'}},Notification:{permission:'granted',requestPermission:async()=>'granted'},matchMedia:()=>({matches:true}),
  navigator:{userAgent:'Android',platform:'Linux',maxTouchPoints:1,serviceWorker:{register:async()=>registration,addEventListener:()=>{}}},
  document:{getElementById:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},localStorage:{getItem:()=>null,removeItem:()=>{},setItem:()=>{}},toast:(message,type)=>calls.push({type,message}),
  supa:{from:table=>{
    let action='select',values;
    const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{push_enabled:true,comments:false,sales:false}}),
      upsert:data=>{action='upsert';values=data;return query;},update:data=>{action='update';values=data;return query;},
      then:resolve=>{calls.push({table,action,values});return Promise.resolve({error:table==='push_subscriptions'&&failDisable?{message:'network failure'}:null}).then(resolve);}};
    return query;
  }}
 };
 context.window=context;context.PushManager={};context.addEventListener=()=>{};
 vm.createContext(context);vm.runInContext(fs.readFileSync('push-notifications.js','utf8'),context);context.renderPushSettings=async()=>{};
 return {context,calls,fail:()=>{failDisable=true;},subscribed:()=>subscriptionExists};
}
test('enabling mobile push does not overwrite saved categories',async()=>{
 const {context,calls}=fixture();await context.enablePushNotifications();
 const prefs=calls.find(c=>c.table==='notification_preferences');
 assert.equal(prefs.values.push_enabled,true);assert.equal('comments' in prefs.values,false);assert.equal('sales' in prefs.values,false);
});
test('disabling push affects only this device, preserving other devices and categories',async()=>{
 const {context,calls,subscribed}=fixture();await context.disablePushNotifications();
 assert.equal(calls.some(c=>c.table==='notification_preferences'),false);assert.equal(calls.find(c=>c.table==='push_subscriptions').values.enabled,false);assert.equal(subscribed(),false);
});
test('failed device persistence is reported and the subscription is retained',async()=>{
 const f=fixture();f.fail();await f.context.disablePushNotifications();assert.equal(f.subscribed(),true);assert.ok(f.calls.some(c=>c.type==='err'));assert.equal(f.calls.some(c=>c.type==='ok'),false);
});
