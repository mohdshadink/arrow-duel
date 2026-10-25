'use strict';
const WebSocket=require('ws');
const url=process.argv[2]||('ws://localhost:'+(process.env.PORT||3000));
const ws=new WebSocket(url);
const send=(type,data={})=>{if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type,...data}));console.log('[bot] ->',type,data);}};
ws.on('open',()=>{console.log('[bot] connected to',url);send('join',{name:'Bot'});});
ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(['match_start','countdown','gameover','opponent_left','status','hit_event'].includes(m.type))console.log('[bot] <-',m);if(m.type==='match_start'||m.type==='countdown'&&m.n===0)play();if(m.type==='gameover')setTimeout(()=>send('rematch'),600);});
ws.on('close',()=>{console.log('[bot] disconnected');clearInterval(playTimer);process.exit(0);});
ws.on('error',e=>console.error('[bot] error:',e.message));
let playTimer;
function play(){clearInterval(playTimer);const action=()=>{const move=Math.random()<.25?(Math.random()<.5?-1:1):0,aim=Math.random()<.45?(Math.random()<.5?-1:1):0;send('input',{move,aim});setTimeout(()=>{send('charge_start');setTimeout(()=>send('fire'),500+Math.random()*700);},150);};action();playTimer=setInterval(action,1000+Math.random()*1000);}
setInterval(()=>send('ping',{t:Date.now()}),10000);
