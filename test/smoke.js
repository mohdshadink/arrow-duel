'use strict';
const WebSocket=require('ws');
const {spawn}=require('child_process');
const path=require('path');
const project=path.resolve(__dirname,'..'),port=31000+Math.floor(Math.random()*20000);
const proc=spawn(process.execPath,['server.js'],{cwd:project,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let output='';proc.stdout.on('data',d=>output+=d);proc.stderr.on('data',d=>output+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=12000){const start=Date.now();while(Date.now()-start<timeout){if(fn())return;await wait(25)}throw new Error('Timed out waiting for server event');}
function client(name){const ws=new WebSocket('ws://127.0.0.1:'+port),messages=[];ws.on('message',b=>{try{messages.push(JSON.parse(b))}catch{}});return{ws,messages,join:()=>ws.send(JSON.stringify({type:'join',name})),send:(type,x={})=>ws.send(JSON.stringify({type,...x}))};}
async function main(){try{
 await until(()=>output.includes('ARROW DUEL SERVER'),10000);
 const a=client('TesterA'),b=client('TesterB');await Promise.all([new Promise(r=>a.ws.once('open',r)),new Promise(r=>b.ws.once('open',r))]);
 a.join();await until(()=>a.messages.some(m=>m.type==='status'&&m.state==='waiting'));b.join();
 await until(()=>a.messages.some(m=>m.type==='match_start')&&b.messages.some(m=>m.type==='match_start'));console.log('PASS pairing two clients into one room');
 await until(()=>a.messages.some(m=>m.type==='countdown'&&m.n===0),5000);
 a.send('input',{move:0,aim:-1});await wait(600);a.send('input',{move:0,aim:0});a.send('charge_start');await wait(1300);a.send('fire');await until(()=>a.messages.some(m=>m.type==='fire_event'),3000);console.log('PASS authoritative fire event');
 await until(()=>b.messages.some(m=>m.type==='hit_event'),10000);await until(()=>b.messages.some(m=>m.type==='state'&&m.players[1].hp<5),3000);console.log('PASS server hit detection and health change');
 for(let i=0;i<5;i++){if(a.messages.some(m=>m.type==='gameover'))break;a.send('charge_start');await wait(1250);a.send('fire');await wait(1800);}
 await until(()=>a.messages.some(m=>m.type==='gameover'),10000);console.log('PASS gameover and match stats');
 b.ws.close();await until(()=>a.messages.some(m=>m.type==='opponent_left'),3000);console.log('PASS disconnect notification and room cleanup');a.ws.close();
 const c=client('RoomC'),d=client('RoomD'),e=client('RoomE'),f=client('RoomF');await Promise.all([c,d,e,f].map(x=>new Promise(r=>x.ws.once('open',r))));c.join();d.join();e.join();f.join();await until(()=>[c,d,e,f].every(x=>x.messages.some(m=>m.type==='match_start')),5000);const roomIds=[c,d,e,f].map(x=>x.messages.find(m=>m.type==='match_start').room);if(roomIds[0]!==roomIds[1]||roomIds[2]!==roomIds[3]||roomIds[0]===roomIds[2])throw new Error('Rooms were not isolated');console.log('PASS multiple isolated rooms');[c,d,e,f].forEach(x=>x.ws.close());
 proc.kill('SIGINT');await wait(200);console.log('All smoke checks passed.');
}catch(e){console.error('FAIL',e.message,'\n',output);proc.kill('SIGKILL');process.exitCode=1;}}
main();
