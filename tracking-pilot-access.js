(() => {
 let allowed=false;
 const local=window.MAGEMIND_TRACKING_ENV?.mode!=='supabase-pilot';
 window.trackingEnabled=()=>local||allowed;
 window.MagemindTrackingAccess={async load(client){allowed=false;if(local)return;const r=await client.rpc('tracking_pilot_access');allowed=!r.error&&r.data===true;},clear(){allowed=false;}};
})();
