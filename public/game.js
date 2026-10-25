(() => {
  'use strict';
  const C = window.ARROW_CONST;
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d'), logBox = $('messageLog');
  const state = { ws: null, id: null, you: 0, room: '—', phase: 'idle', players: [], arrows: [], wind: 0, score: [0,0], seq: 0, gaps: 0, rtts: [], log: [], sent: 0, received: 0, sentBytes: 0, receivedBytes: 0, txTimes: [], rxTimes: [], snapTimes: [], delay: 0, muted: localStorage.getItem('ad-muted') === '1', keys: {}, move: 0, aim: 0, charging: false, histories: new Map(), particles: [], floats: [], shake: 0, reconnectAttempt: 0 };
  let audio = null, chargeOsc = null, chargeGain = null, reconnectTimer = null, pauseAutoScroll = false;
  $('nameInput').value = localStorage.getItem('ad-name') || '';
  $('serverAddress').textContent = location.host || 'local';
  $('shareUrl').textContent = location.host;
  $('muteButton').textContent = state.muted ? '♫ SOUND OFF' : '♫ SOUND ON';
  function audioStart() { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); }
  function tone(freq, duration=.12, type='sine', volume=.04, endFreq=null) { if (state.muted || !audio) return; const o=audio.createOscillator(), g=audio.createGain(), t=audio.currentTime; o.type=type; o.frequency.setValueAtTime(freq,t); if(endFreq) o.frequency.exponentialRampToValueAtTime(endFreq,t+duration); g.gain.setValueAtTime(volume,t); g.gain.exponentialRampToValueAtTime(.001,t+duration); o.connect(g).connect(audio.destination); o.start(t); o.stop(t+duration); }
  function startChargeSound(){if(state.muted||!audio)return;stopChargeSound();chargeOsc=audio.createOscillator();chargeGain=audio.createGain();const t=audio.currentTime;chargeOsc.type='triangle';chargeOsc.frequency.setValueAtTime(145,t);chargeOsc.frequency.exponentialRampToValueAtTime(430,t+1.2);chargeGain.gain.setValueAtTime(.001,t);chargeGain.gain.linearRampToValueAtTime(.025,t+.12);chargeOsc.connect(chargeGain).connect(audio.destination);chargeOsc.start(t);}
  function stopChargeSound(){if(!chargeOsc)return;const o=chargeOsc,g=chargeGain,t=audio.currentTime;g.gain.cancelScheduledValues(t);g.gain.setTargetAtTime(.001,t,.035);o.stop(t+.16);chargeOsc=null;chargeGain=null;}
  function setBadge(text, kind='') { const b=$('connBadge'); b.textContent=text.toUpperCase(); b.className='badge '+kind; }
  function showScreen(id) { ['startScreen','waitingScreen','gameLayout'].forEach(x=>$(x).classList.toggle('hidden',x!==id)); }
  function initSocket() {
    if(state.ws && (state.ws.readyState===WebSocket.OPEN || state.ws.readyState===WebSocket.CONNECTING)) return;
    const proto=location.protocol==='https:'?'wss:':'ws:', ws=new WebSocket(proto+'//'+location.host); state.ws=ws; setBadge('Connecting');
    ws.addEventListener('open',()=>{state.reconnectAttempt=0;setBadge('Connected','connected'); if(state.wantJoin){state.phase='waiting';send('join',{name:$('nameInput').value||localStorage.getItem('ad-name')||'Archer'});}});
    ws.addEventListener('message',ev=>{state.received++;state.receivedBytes+=new TextEncoder().encode(ev.data).length;state.rxTimes.push(performance.now());let m;try{m=JSON.parse(ev.data)}catch(_){return} logMessage('in',m); handle(m); updateDashboard();});
    ws.addEventListener('close',()=>{setBadge('Disconnected','disconnected'); if(state.phase!=='idle'){state.wantJoin=true;$('lostOverlay').classList.remove('hidden');scheduleReconnect();}});
    ws.addEventListener('error',()=>setBadge('Disconnected','disconnected'));
  }
  function send(type, fields={}) {
    const msg={type,...fields}, raw=JSON.stringify(msg);
    logMessage('out',msg);
    const transmit=()=>{if(state.ws&&state.ws.readyState===WebSocket.OPEN){state.ws.send(raw);state.sent++;state.sentBytes+=new TextEncoder().encode(raw).length;state.txTimes.push(performance.now());updateDashboard();}};
    if(state.delay>0) setTimeout(transmit,state.delay); else transmit();
  }
  function logMessage(dir,m) {
    const type=m.type||'unknown'; const high=type==='state'||type==='ping'||type==='pong';
    state.log.push({dir,m,time:new Date(),high});if(state.log.length>300)state.log.shift();
    if(high && !(type==='state'? $('showState').checked : $('showPing').checked)) return;
    if($('pauseLog').checked)return;
    appendLogRow(state.log[state.log.length-1]);
  }
  function appendLogRow(d){const type=d.m.type||'unknown',row=document.createElement('div');row.className='log-row '+(['fire_event','hit_event','miss_event'].includes(type)?'event ':'')+(type==='error'?'error':'');const stamp=d.time.toLocaleTimeString('en-GB',{hour12:false})+'.'+String(d.time.getMilliseconds()).padStart(3,'0');row.innerHTML='<span class="time">'+stamp+'</span> <b class="'+(d.dir==='out'?'out':'in')+'">'+(d.dir==='out'?'OUT →':'IN ←')+'</b> '+escapeHtml(type)+' '+escapeHtml(JSON.stringify(d.m).slice(0,105));logBox.appendChild(row);while(logBox.children.length>140)logBox.removeChild(logBox.firstChild);if(!pauseAutoScroll)logBox.scrollTop=logBox.scrollHeight;$('logCount').textContent=state.log.length;}
  function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function handle(m) {
    switch(m.type){
      case 'welcome':state.id=m.id;break;
      case 'status': if(m.state==='waiting'){state.phase='waiting';setBadge('Waiting');showScreen('waitingScreen');$('waitStatus').textContent=m.message;} else if(m.state==='idle'){state.phase='idle';$('disconnectOverlay').classList.remove('hidden');} break;
      case 'match_start':state.you=m.you;state.room=m.room;state.phase='countdown';state.opponent=m.opponentName;state.histories.clear();state.gaps=0;showScreen('gameLayout');$('disconnectOverlay').classList.add('hidden');$('gameoverOverlay').classList.add('hidden');$('lostOverlay').classList.add('hidden');setBadge('In match','inmatch');$('roomInfo').textContent=state.you+' / '+state.room; break;
      case 'countdown':if(m.n===C.COUNTDOWN){$('gameoverOverlay').classList.add('hidden');$('rematchButton').disabled=false;$('rematchButton').textContent='REMATCH';}state.phase=m.n===0?'playing':'countdown';$('countdownText').textContent=m.n===0?'FIGHT!':String(m.n);$('countdownText').className='countdown '+(m.n===0?'fight':'');if(m.n===0)setTimeout(()=>{$('countdownText').textContent='';},650);tone(m.n===0?880:520,.16,'sine',.05);break;
      case 'state': if(Number.isInteger(m.seq)){if(state.seq&&m.seq>state.seq+1)state.gaps+=m.seq-state.seq-1; if(m.seq<=state.seq){state.gaps++;} state.seq=Math.max(state.seq,m.seq);} state.players=m.players;state.arrows=m.arrows;state.wind=m.wind;state.score=m.score;state.phase=m.phase;state.snapTimes.push(performance.now());if(state.snapTimes.length>90)state.snapTimes.shift();for(let i=0;i<m.players.length;i++){if(!state.histories.has(i))state.histories.set(i,[]);const h=state.histories.get(i);h.push({t:m.t,p:{...m.players[i]}});if(h.length>8)h.shift();}break;
      case 'pong':if(typeof m.t==='number'){const rtt=performance.now()-m.t;state.rtts.push(rtt);if(state.rtts.length>10)state.rtts.shift();$('pingValue').innerHTML=Math.round(rtt)+'<i>ms</i>';tone(1,.001);}break;
      case 'fire_event':tone(260,.18,'sawtooth',.035,110);break;
      case 'hit_event':hitEffect(m);tone(m.headshot?760:125,m.headshot?.35:.14,m.headshot?'sine':'triangle',.08,m.headshot?1100:65);break;
      case 'gameover':state.phase='gameover';$('gameoverOverlay').classList.remove('hidden');$('resultTitle').textContent=m.winner===state.you?'VICTORY':'DEFEAT';$('resultTitle').style.color=m.winner===state.you?'#5de1d0':'#ff716c';$('scoreText').textContent='SERIES SCORE  ·  '+(m.score||state.score).join(' — ');$('statsTable').innerHTML=statsHtml(m.stats);$('rematchButton').disabled=false;$('rematchButton').textContent='REMATCH';tone(m.winner===state.you?620:180,.5,'triangle',.06,m.winner===state.you?980:90);break;
      case 'opponent_left':state.phase='idle';$('disconnectOverlay').classList.remove('hidden');break;
      case 'error':break;
    }
  }
  function statsHtml(stats){if(!stats)return '';return '<table class="stats-table"><thead><tr><th>ARCHER</th><th>SHOTS</th><th>HITS</th><th>ACC.</th><th>HEAD</th></tr></thead><tbody>'+stats.map(s=>'<tr><td>'+escapeHtml(s.name)+'</td><td>'+s.shots+'</td><td>'+s.hits+'</td><td>'+s.accuracy+'%</td><td>'+s.headshots+'</td></tr>').join('')+'</tbody></table>';}
  function hitEffect(m){state.shake=10;for(let i=0;i<22;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*220;state.particles.push({x:m.x,y:m.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.4+Math.random()*.5,color:m.headshot?'#ffe39b':'#69e6d4'});}state.floats.push({x:m.x,y:m.y,text:m.headshot?'HEADSHOT -2!':'-1',life:1});}
  function scheduleReconnect(){clearTimeout(reconnectTimer);state.reconnectAttempt++;const wait=Math.min(10000,500*Math.pow(2,state.reconnectAttempt-1));reconnectTimer=setTimeout(()=>{initSocket();},wait);}
  function updateDashboard(){
    $('msgCounts').textContent=state.sent+' / '+state.received;$('byteCounts').textContent=formatBytes(state.sentBytes)+' / '+formatBytes(state.receivedBytes);
    const now=performance.now(),recent=arr=>arr.filter(x=>now-x<1000).length;$('msgRate').textContent=recent(state.txTimes)+' / '+recent(state.rxTimes);
    $('snapshotRate').textContent=state.snapTimes.filter(x=>now-x<1000).length;$('seqValue').textContent=state.seq||'—';$('gapsValue').textContent=state.gaps;
    if(state.rtts.length){const avg=state.rtts.reduce((a,b)=>a+b,0)/state.rtts.length;let jit=0;for(let i=1;i<state.rtts.length;i++)jit+=Math.abs(state.rtts[i]-state.rtts[i-1]);jit=state.rtts.length>1?jit/(state.rtts.length-1):0;$('avgPing').textContent=Math.round(avg)+' ms';$('jitter').textContent=Math.round(jit)+' ms';const el=$('pingValue');el.style.color=avg<50?'#5fe1a3':avg<120?'#ffd074':'#ff7171';}drawChart();
  }
  function formatBytes(n){return n<1024?n+' B':(n/1024).toFixed(1)+' KB';}
  function drawChart(){const c=$('pingChart'),g=c.getContext('2d'),w=c.width,h=c.height;g.clearRect(0,0,w,h);g.strokeStyle='#203b48';g.lineWidth=1;g.beginPath();for(let y=18;y<h;y+=18){g.moveTo(0,y);g.lineTo(w,y)}g.stroke();const a=state.rtts;if(a.length<2)return;const max=Math.max(100,...a);g.strokeStyle='#5de1d0';g.lineWidth=2;g.beginPath();a.forEach((v,i)=>{const x=i/(a.length-1)*w,y=h-5-(v/max)*(h-12);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();}
  function interpPlayer(i, now){const list=state.histories.get(i);if(!list||!list.length)return state.players[i];const target=now-C.INTERPOLATION_MS;let a=list[0],b=list[list.length-1];for(let j=1;j<list.length;j++)if(list[j].t>=target){a=list[j-1];b=list[j];break;}const span=b.t-a.t,t=span?Math.max(0,Math.min(1,(target-a.t)/span)):1;return {...b.p,x:a.p.x+(b.p.x-a.p.x)*t};}
  function draw(){
    const now=Date.now(),t=performance.now()/1000;ctx.save();if(state.shake>0){ctx.translate((Math.random()-.5)*state.shake,(Math.random()-.5)*state.shake);state.shake*=.82;if(state.shake<.3)state.shake=0;}
    const sky=ctx.createLinearGradient(0,0,0,620);const phase=(Math.sin(t*.035)+1)/2;sky.addColorStop(0,phase>.5?'#20394e':'#533d52');sky.addColorStop(.7,phase>.5?'#84a3a3':'#d4866c');sky.addColorStop(1,'#e2b17b');ctx.fillStyle=sky;ctx.fillRect(0,0,1280,720);
    const sunGlow=ctx.createRadialGradient(640,315,12,640,315,210);sunGlow.addColorStop(0,phase>.5?'rgba(255,237,192,.78)':'rgba(255,205,171,.62)');sunGlow.addColorStop(.22,'rgba(255,220,178,.22)');sunGlow.addColorStop(1,'rgba(255,220,178,0)');ctx.fillStyle=sunGlow;ctx.fillRect(410,85,460,460);ctx.fillStyle=phase>.5?'rgba(255,240,208,.76)':'rgba(255,218,192,.63)';ctx.beginPath();ctx.arc(640,315,52,0,Math.PI*2);ctx.fill();
    for(let i=0;i<5;i++){const x=((i*310+t*(8+state.wind*.04))%1500)-120;ctx.fillStyle='rgba(255,245,218,.17)';cloud(x,110+i%2*90,1+i%3*.3);}
    ctx.fillStyle='#334d58';ctx.beginPath();ctx.moveTo(0,490);for(let x=0;x<=1280;x+=80)ctx.lineTo(x,440+Math.sin(x*.009)*47+Math.cos(x*.017)*18);ctx.lineTo(1280,620);ctx.lineTo(0,620);ctx.fill();
    ctx.fillStyle='#243f49';ctx.beginPath();ctx.moveTo(0,545);for(let x=0;x<=1280;x+=60)ctx.lineTo(x,510+Math.sin(x*.012+1)*28);ctx.lineTo(1280,620);ctx.lineTo(0,620);ctx.fill();
    ctx.fillStyle='#172f32';ctx.fillRect(0,620,1280,100);ctx.fillStyle='#38604b';ctx.fillRect(0,620,1280,4);
    for(let i=0;i<75;i++){const x=(i*97)%1280,y=623+((i*31)%25);ctx.strokeStyle=i%3?'#507254':'#718454';ctx.beginPath();ctx.moveTo(x,y+8);ctx.lineTo(x-3,y);ctx.moveTo(x,y+8);ctx.lineTo(x+4,y-2);ctx.stroke();}
    drawHud();
    if(state.players.length===2){for(let i=0;i<2;i++){const p=interpPlayer(i,now)||state.players[i];drawArcher(p,i);}drawAim();}
    state.arrows.forEach(a=>drawArrow(a));drawEffects(t);ctx.restore();requestAnimationFrame(draw);
  }
  function cloud(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.beginPath();ctx.ellipse(0,0,60,13,0,0,Math.PI*2);ctx.ellipse(-25,-8,26,18,0,0,Math.PI*2);ctx.ellipse(5,-14,34,24,0,0,Math.PI*2);ctx.ellipse(36,-7,24,15,0,0,Math.PI*2);ctx.fill();ctx.restore();}
  function drawHud(){ctx.fillStyle='rgba(6,18,27,.62)';roundRect(ctx,35,24,350,65,8);roundRect(ctx,895,24,350,65,8);ctx.fillStyle='#e6f1f4';ctx.font='bold 18px Segoe UI';ctx.textAlign='left';ctx.fillText(state.players[0]?.name||'BLUE',52,49);ctx.textAlign='right';ctx.fillText(state.players[1]?.name||'RED',1228,49);health(53,63,state.players[0]?.hp||0,'#59b9ff');health(896,63,state.players[1]?.hp||0,'#ff716c');ctx.textAlign='center';ctx.fillStyle='#def1ee';ctx.font='bold 19px Segoe UI';ctx.fillText((state.score[0]||0)+'  :  '+(state.score[1]||0),640,54);ctx.font='bold 12px Segoe UI';ctx.fillStyle='#d9ede4';ctx.fillText('WIND '+(state.wind<0?'←':'→')+' '+Math.abs(state.wind),640,82);}
  function health(x,y,hp,color){for(let i=0;i<C.HP;i++){ctx.fillStyle=i<hp?color:'#314650';roundRect(ctx,x+i*26,y,19,8,4);}}
  function roundRect(c,x,y,w,h,r){c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  function drawArcher(p,i){const local=i+1===state.you,x=p.x,dir=i===0?1:-1,color=i===0?'#58b8ff':'#ff716c';ctx.save();ctx.translate(x,C.GROUND);ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.ellipse(0,2,42,8,0,0,7);ctx.fill();ctx.strokeStyle=local?'#e2f9f5':color;ctx.lineWidth=13;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-5,-17);ctx.lineTo(0,-56);ctx.stroke();ctx.fillStyle='#efc6a0';ctx.beginPath();ctx.arc(0,-73,14,0,7);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,-77,15,Math.PI,Math.PI*2);ctx.lineTo(14,-73);ctx.fill();ctx.strokeStyle='#e2c17f';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-56);ctx.lineTo(-17,-25);ctx.moveTo(0,-56);ctx.lineTo(17,-25);ctx.stroke();ctx.strokeStyle='#dbc69c';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-7,-3);ctx.lineTo(-11,0);ctx.moveTo(6,-3);ctx.lineTo(11,0);ctx.stroke();const rad=p.angle*Math.PI/180;const bx=dir*9,by=-55;ctx.save();ctx.translate(bx,by);ctx.scale(dir,1);ctx.rotate(-rad);ctx.strokeStyle='#e4c17e';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,23,-1.05,1.05);ctx.stroke();ctx.strokeStyle='#f0e0bd';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(23*Math.cos(-1.05),23*Math.sin(-1.05));ctx.lineTo(23*Math.cos(1.05),23*Math.sin(1.05));ctx.stroke();const pull=(p.charge||0)/100*16;ctx.beginPath();ctx.moveTo(23*Math.cos(-1.05),23*Math.sin(-1.05));ctx.lineTo(23+pull,0);ctx.lineTo(23*Math.cos(1.05),23*Math.sin(1.05));ctx.stroke();if(p.charge>0){ctx.strokeStyle='#dce9e5';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(23+pull,0);ctx.lineTo(48+pull,0);ctx.stroke();ctx.fillStyle='#f7e5bc';ctx.beginPath();ctx.moveTo(53+pull,0);ctx.lineTo(45+pull,-3);ctx.lineTo(45+pull,3);ctx.fill();}ctx.restore();ctx.fillStyle=local?'#e9fffa':'#ffe2da';ctx.font='bold 11px Segoe UI';ctx.textAlign='center';ctx.fillText(local?'YOU':p.name,x,C.GROUND-111);if(local){ctx.fillStyle='#152b34';roundRect(ctx,x-34,C.GROUND-102,68,7,4);const g=ctx.createLinearGradient(x-34,0,x+34,0);g.addColorStop(0,'#50d99e');g.addColorStop(.7,'#f0d65d');g.addColorStop(1,'#ee665e');ctx.fillStyle=g;roundRect(ctx,x-34,C.GROUND-102,68*(p.charge||0)/100,7,4);const cd=Math.max(0,(p.cooldown||0)/C.COOLDOWN);if(cd>0){ctx.fillStyle='rgba(8,15,19,.7)';ctx.fillRect(x-22,C.GROUND-10,44,5);ctx.fillStyle='#f5bb68';ctx.fillRect(x-22,C.GROUND-10,44*(1-cd),5);}}ctx.restore();}
  function drawAim(){const p=state.players[state.you-1];if(!p)return;const dir=state.you===1?1:-1,ang=p.angle*Math.PI/180,power=(p.charge||0)/100,speed=C.SHOT_MIN+power*C.SHOT_RANGE,x=p.x+dir*22,y=C.GROUND-68;ctx.fillStyle='rgba(218,246,236,.55)';for(let t=.08;t<.58;t+=.045){const px=x+Math.cos(ang)*speed*t*dir,py=y-Math.sin(ang)*speed*t+.5*C.GRAVITY*t*t;if(py>C.GROUND)break;ctx.beginPath();ctx.arc(px,py,2,0,7);ctx.fill();}}
  function drawArrow(a){ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(a.vy,a.vx));ctx.strokeStyle=a.owner===0?'#d3eaff':'#ffe0d7';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-20,0);ctx.lineTo(12,0);ctx.stroke();ctx.fillStyle='#e8d29c';ctx.beginPath();ctx.moveTo(19,0);ctx.lineTo(10,-5);ctx.lineTo(10,5);ctx.fill();ctx.strokeStyle='#9fc8d4';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-17,0);ctx.lineTo(-22,-5);ctx.moveTo(-17,0);ctx.lineTo(-22,5);ctx.stroke();ctx.restore();}
  function drawEffects(t){const dt=.016;state.particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=220*dt;p.life-=dt;ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,4,4)});state.particles=state.particles.filter(p=>p.life>0);state.floats.forEach(f=>{f.y-=.7;f.life-=dt;ctx.globalAlpha=Math.max(0,f.life);ctx.fillStyle='#fff1ca';ctx.font='bold 18px Segoe UI';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y)});state.floats=state.floats.filter(f=>f.life>0);ctx.globalAlpha=1;}
  function sendInput(){if(state.phase!=='playing')return;if(state.move!==state.lastMove||state.aim!==state.lastAim){send('input',{move:state.move,aim:state.aim});state.lastMove=state.move;state.lastAim=state.aim;}}
  function updateKeys(){const k=state.keys;state.move=(k.ArrowLeft||k.a?-1:0)+(k.ArrowRight||k.d?1:0);state.aim=(k.ArrowUp||k.w?1:0)+(k.ArrowDown||k.s?-1:0);state.move=Math.max(-1,Math.min(1,state.move));state.aim=Math.max(-1,Math.min(1,state.aim));sendInput();}
  window.addEventListener('keydown',e=>{if(e.target.matches('input,textarea'))return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key))e.preventDefault();if(e.repeat)return;audioStart();if(e.key.toLowerCase()==='n'){toggleDashboard();return;}if(e.key.toLowerCase()==='m'){toggleMute();return;}if(e.code==='Space'&&state.phase==='playing'&&!state.charging){state.charging=true;send('charge_start');startChargeSound();return;}state.keys[e.key]=true;state.keys[e.key.toLowerCase()]=true;updateKeys();});
  window.addEventListener('keyup',e=>{if(e.code==='Space'&&state.charging){state.charging=false;stopChargeSound();send('fire');return;}state.keys[e.key]=false;state.keys[e.key.toLowerCase()]=false;updateKeys();});
  window.addEventListener('blur',()=>{state.keys={};updateKeys();if(state.charging){state.charging=false;stopChargeSound();send('fire');}});
  function toggleDashboard(){ $('dashboard').classList.toggle('collapsed');$('dashToggle').textContent=$('dashboard').classList.contains('collapsed')?'SHOW NETWORK':'HIDE NETWORK';}
  function toggleMute(){state.muted=!state.muted;if(state.muted)stopChargeSound();localStorage.setItem('ad-muted',state.muted?'1':'0');$('muteButton').textContent=state.muted?'♫ SOUND OFF':'♫ SOUND ON';}
  $('muteButton').onclick=()=>{audioStart();toggleMute();};$('dashToggle').onclick=toggleDashboard;
  $('findButton').onclick=()=>{audioStart();localStorage.setItem('ad-name',$('nameInput').value);state.wantJoin=true;if(state.ws&&state.ws.readyState===WebSocket.OPEN){send('join',{name:$('nameInput').value||'Archer'});}else initSocket();};
  $('cancelWait').onclick=()=>{state.phase='idle';state.wantJoin=false;if(state.ws)state.ws.close();showScreen('startScreen');setBadge('Connected','connected');};
  $('rematchButton').onclick=()=>{send('rematch');$('rematchButton').disabled=true;$('rematchButton').textContent='WAITING FOR OPPONENT…';};
  $('leaveButton').onclick=()=>{if(state.ws)state.ws.close();state.phase='idle';showScreen('startScreen');};
  $('newMatchButton').onclick=()=>{state.phase='idle';$('disconnectOverlay').classList.add('hidden');state.wantJoin=true;showScreen('waitingScreen');send('find_match');};
  $('reconnectButton').onclick=()=>{if(state.ws)state.ws.close();state.wantJoin=state.phase!=='idle';initSocket();};
  $('latencySlider').oninput=e=>{state.delay=Number(e.target.value);$('latencyValue').textContent=state.delay;};
  $('showState').onchange=()=>renderLog();$('showPing').onchange=()=>renderLog();$('pauseLog').onchange=()=>{if(!$('pauseLog').checked)renderLog();};
  logBox.addEventListener('scroll',()=>{pauseAutoScroll=logBox.scrollTop+logBox.clientHeight<logBox.scrollHeight-20;});
  function renderLog(){logBox.innerHTML='';const arr=state.log.filter(x=>!x.high||(x.m.type==='state'?$('showState').checked:$('showPing').checked));arr.slice(-140).forEach(appendLogRow);}
  $('clearLog').onclick=()=>{state.log=[];logBox.innerHTML='';$('logCount').textContent='0';};
  $('downloadLog').onclick=()=>{const text=state.log.map(x=>x.time.toLocaleTimeString('en-GB',{hour12:false})+' '+(x.dir==='out'?'OUT ->':'IN <-')+' '+x.m.type+' '+JSON.stringify(x.m)).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.download='arrow-duel-network-log.txt';a.click();URL.revokeObjectURL(a.href);};
  setInterval(()=>{const cutoff=performance.now()-5000;state.txTimes=state.txTimes.filter(t=>t>=cutoff);state.rxTimes=state.rxTimes.filter(t=>t>=cutoff);if(state.ws&&state.ws.readyState===WebSocket.OPEN)send('ping',{t:performance.now()});},1000);
  setInterval(updateDashboard,500);
  initSocket();requestAnimationFrame(draw);
})();
