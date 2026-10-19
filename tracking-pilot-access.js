(() => {
 let allowed=false;
 const local=window.MAGEMIND_TRACKING_ENV?.mode!=='supabase-pilot';
 window.trackingEnabled=()=>local||allowed;
 // The server grants availability to active accounts; failures stay closed.
 window.MagemindTrackingAccess={async load(client){allowed=false;if(local)return;try{const r=await client.rpc('tracking_pilot_access');allowed=!r.error&&r.data===true;}catch{allowed=false;}},clear(){allowed=false;}};
})();
