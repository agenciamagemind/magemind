(function(root){
  function groupFirewallSessions(rows){
    const groups=[], active=new Map();
    for(const row of [...rows].sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at))){
      const time=Date.parse(row.occurred_at);
      const key=JSON.stringify([row.user_id,row.ip_address,row.user_agent||[row.browser,row.operating_system,row.device_type].join('|')]);
      const previous=active.get(key);
      const standalone=!row.user_id||row.outcome!=='success';
      const fresh=standalone||!previous||time-previous.lastTime>1800000||row.event_type==='login_success'||row.event_type==='signup_success';
      const group=fresh?{...row,steps:[],lastTime:time}:previous;
      if(fresh)groups.push(group);
      group.steps.push(row);group.lastTime=time;group.occurred_at=row.occurred_at;group.path=row.path;
      if(!standalone)active.set(key,group);
      if(row.event_type==='logout')active.delete(key);
    }
    return groups.sort((a,b)=>b.lastTime-a.lastTime);
  }
  root.groupFirewallSessions=groupFirewallSessions;
  if(typeof module!=='undefined')module.exports={groupFirewallSessions};
})(typeof window==='undefined'?globalThis:window);
