'use strict';
const http = require('http');
const os = require('os');
const express = require('express');
const WebSocket = require('ws');
const C = require('./shared/constants');

const app = express();
app.use('/shared', express.static(__dirname + '/shared'));
app.use(express.static(__dirname + '/public'));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 1024 });
const clients = new Map(), waiting = [], rooms = new Map();
let nextRoom = 1, nextArrow = 1;
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const send = (ws, msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
function safeName(value) { const s = String(value || 'Archer').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 12); return s || 'Archer'; }
function newPlayer(client, index) { return { client, id: client.id, name: client.name, x: C.PLAYER_X[index], hp: C.HP, angle: 45, chargeAt: 0, charge: 0, move: 0, aim: 0, cooldownAt: 0, shots: 0, hits: 0, headshots: 0 }; }
function roomSnapshot(room) { return { type: 'state', room: room.id, seq: ++room.seq, t: Date.now(), players: room.players.map(p => ({ x: p.x, hp: p.hp, angle: p.angle, charge: p.charge, cooldown: Math.max(0, p.cooldownAt - Date.now()) / 1000, name: p.name })), arrows: room.arrows.map(a => ({ id: a.id, owner: a.owner, x: a.x, y: a.y, vx: a.vx, vy: a.vy, stuck: a.stuck })), wind: room.wind, score: room.score.slice(), phase: room.phase }; }
function broadcast(room, message) { room.players.forEach(p => send(p.client.ws, message)); }
function beginRound(room) {
  if (!room.timer) room.timer = setInterval(() => { try { tick(room); } catch (err) { log('room error', room.id, err.stack || err); destroyRoom(room); } }, 1000 / C.TICK);
  room.phase = 'countdown'; room.arrows = []; room.wind = Math.round((Math.random() * 2 - 1) * C.WIND_MAX);
  room.players.forEach((p, i) => Object.assign(p, { x: C.PLAYER_X[i], hp: C.HP, angle: 45, chargeAt: 0, charge: 0, move: 0, aim: 0, cooldownAt: 0, shots: 0, hits: 0, headshots: 0 }));
  let n = C.COUNTDOWN; broadcast(room, { type: 'countdown', n });
  room.countTimer = setInterval(() => { n--; broadcast(room, { type: 'countdown', n }); if (n <= 0) { clearInterval(room.countTimer); room.countTimer = null; room.phase = 'playing'; log('game start', room.id); } }, 1000);
}
function pair(a, b) {
  const room = { id: `R${nextRoom++}`, players: [newPlayer(a, 0), newPlayer(b, 1)], arrows: [], wind: 0, score: [0, 0], phase: 'waiting', seq: 0, tick: 0, timer: null, countTimer: null };
  rooms.set(room.id, room); a.room = room; b.room = room;
  [a, b].forEach((c, i) => { send(c.ws, { type: 'status', state: 'matched', message: 'Opponent found' }); send(c.ws, { type: 'match_start', room: room.id, you: i + 1, opponentName: room.players[1 - i].name, constantsVersion: C.VERSION }); });
  log('paired', room.id, a.name, b.name); beginRound(room);
}
function finish(room, winner) {
  if (room.phase === 'gameover') return; room.phase = 'gameover'; room.players[winner - 1] && room.score[winner - 1]++;
  if (room.countTimer) clearInterval(room.countTimer); room.countTimer = null;
  if (room.timer) clearInterval(room.timer); room.timer = null;
  const stats = room.players.map(p => ({ name: p.name, shots: p.shots, hits: p.hits, accuracy: p.shots ? Math.round(p.hits / p.shots * 100) : 0, headshots: p.headshots, hp: p.hp }));
  broadcast(room, { type: 'gameover', winner, stats, score: room.score.slice() }); log('game over', room.id, 'winner', winner);
}
function distSegment(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy; const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0; return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function hitTest(arrow, target, oldX, oldY) {
  const tip = (x, y) => ({ x: x + Math.cos(Math.atan2(arrow.vy, arrow.vx)) * 15, y: y + Math.sin(Math.atan2(arrow.vy, arrow.vx)) * 15 });
  const a = tip(oldX, oldY), b = tip(arrow.x, arrow.y); const bodyY = C.GROUND - C.BODY_H;
  const segRect = (x1, y1, x2, y2, rx, ry, rw, rh) => { const steps = 8; for (let i = 0; i <= steps; i++) { const t = i / steps, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true; } return false; };
  const bx = target.x - C.BODY_W / 2, headX = target.x, headY = C.GROUND - C.HEAD_Y;
  if (distSegment(headX, headY, a.x, a.y, b.x, b.y) <= C.HEAD_R) return C.HIT_HEAD;
  if (segRect(a.x, a.y, b.x, b.y, bx, bodyY, C.BODY_W, C.BODY_H)) return C.HIT_BODY;
  return 0;
}
function tick(room) {
  if (!rooms.has(room.id)) return;
  const dt = 1 / C.TICK, now = Date.now();
  if (room.phase === 'playing') {
    for (const p of room.players) {
      p.x = clamp(p.x + p.move * C.MOVE_SPEED * dt, C.PLAYER_MIN_X[p.client.slot], C.PLAYER_MAX_X[p.client.slot]);
      p.angle = clamp(p.angle + p.aim * C.AIM_SPEED * dt, C.AIM_MIN, C.AIM_MAX);
      p.charge = p.chargeAt ? C.MIN_POWER + clamp((now - p.chargeAt) / (C.CHARGE_SECONDS * 1000), 0, 1) * (C.MAX_POWER - C.MIN_POWER) : 0;
    }
    for (let i = room.arrows.length - 1; i >= 0; i--) {
      const a = room.arrows[i]; if (a.stuck) { if (now > a.stuckUntil) room.arrows.splice(i, 1); continue; }
      const ox = a.x, oy = a.y; a.vx += room.wind * dt; a.vy += C.GRAVITY * dt; a.x += a.vx * dt; a.y += a.vy * dt;
      const targetIndex = 1 - a.owner, target = room.players[targetIndex]; const damage = hitTest(a, target, ox, oy);
      if (damage) { target.hp -= damage; const shooter = room.players[a.owner]; shooter.hits++; if (damage === C.HIT_HEAD) shooter.headshots++; broadcast(room, { type: 'hit_event', player: targetIndex + 1, damage, headshot: damage === C.HIT_HEAD, x: a.x, y: a.y }); room.arrows.splice(i, 1); if (target.hp <= 0) finish(room, a.owner + 1); continue; }
      if (a.y >= C.GROUND) { a.y = C.GROUND; a.stuck = true; a.stuckUntil = now + C.ARROW_STICK_MS; broadcast(room, { type: 'miss_event', x: a.x }); }
      else if (a.x < 0 || a.x > C.W || a.y < -50) room.arrows.splice(i, 1);
    }
  }
  room.tick++; if (room.tick % C.SNAPSHOT_EVERY === 0) broadcast(room, roomSnapshot(room));
}
function destroyRoom(room) { if (room.timer) clearInterval(room.timer); if (room.countTimer) clearInterval(room.countTimer); rooms.delete(room.id); room.players.forEach(p => { if (p.client.room === room) p.client.room = null; }); }
function disconnect(client) {
  if (client.closed) return; client.closed = true; clients.delete(client.id); const qi = waiting.indexOf(client); if (qi >= 0) waiting.splice(qi, 1);
  const room = client.room; if (room && rooms.has(room.id)) { const other = room.players.find(p => p.client !== client); if (other && other.client.ws.readyState === WebSocket.OPEN) { send(other.client.ws, { type: 'opponent_left' }); send(other.client.ws, { type: 'status', state: 'idle', message: 'Opponent disconnected' }); other.client.room = null; } destroyRoom(room); }
  log('disconnect', client.id, client.name || 'unjoined');
}
function queue(client, name) {
  if (client.room) return; const old = waiting.indexOf(client); if (old >= 0) waiting.splice(old, 1); client.name = safeName(name || client.name);
  const other = waiting.shift(); if (other && other.ws.readyState === WebSocket.OPEN && !other.room) pair(other, client); else { waiting.push(client); send(client.ws, { type: 'status', state: 'waiting', message: 'Waiting for opponent' }); }
}
function onMessage(client, raw) {
  const now = Date.now(); if (now - client.rateAt >= 1000) { client.rateAt = now; client.rateCount = 0; } client.rateCount++;
  if (client.rateCount > 60) { if (!client.floodAt) { client.floodAt = now; send(client.ws, { type: 'error', message: 'Message rate limit exceeded' }); } if (now - client.floodAt >= 5000) client.ws.close(1008, 'Rate limit'); return; }
  let m; try { m = JSON.parse(raw.toString()); } catch (_) { send(client.ws, { type: 'error', message: 'Invalid JSON' }); return; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return;
  const room = client.room, p = room && room.players.find(x => x.client === client);
  switch (m.type) {
    case 'join': if (m.name !== undefined && (typeof m.name !== 'string' || m.name.length > 40)) return; queue(client, m.name); break;
    case 'find_match': if (typeof m.type === 'string') queue(client, client.name); break;
    case 'input': if (room && room.phase === 'playing' && p && [-1,0,1].includes(m.move) && [-1,0,1].includes(m.aim)) { p.move = m.move; p.aim = m.aim; } break;
    case 'charge_start': if (room && room.phase === 'playing' && p && !p.chargeAt) p.chargeAt = now; break;
    case 'fire': if (room && room.phase === 'playing' && p && p.chargeAt && now >= p.cooldownAt && room.arrows.length < C.MAX_ARROWS) { const power = C.MIN_POWER + clamp((now - p.chargeAt) / (C.CHARGE_SECONDS * 1000), 0, 1) * (C.MAX_POWER - C.MIN_POWER); const angle = p.angle * Math.PI / 180, dir = client.slot === 0 ? 1 : -1, speed = C.SHOT_MIN + power / 100 * C.SHOT_RANGE; const sx = p.x + dir * 22, sy = C.GROUND - 68; room.arrows.push({ id: nextArrow++, owner: client.slot, x: sx, y: sy, vx: Math.cos(angle) * speed * dir, vy: -Math.sin(angle) * speed, stuck: false }); p.shots++; p.chargeAt = 0; p.charge = 0; p.cooldownAt = now + C.COOLDOWN * 1000; broadcast(room, { type: 'fire_event', player: client.slot + 1, power: Math.round(power), angle: p.angle }); } break;
    case 'rematch': if (room && room.phase === 'gameover') { client.rematch = room.id; if (room.players.every(x => x.client.rematch === room.id)) { room.players.forEach(x => x.client.rematch = null); beginRound(room); } else send(client.ws, { type: 'status', state: 'rematch_wait', message: 'Waiting for opponent to accept' }); } break;
    case 'ping': if (typeof m.t === 'number' && Number.isFinite(m.t)) send(client.ws, { type: 'pong', t: m.t, serverTime: now }); break;
    default: send(client.ws, { type: 'error', message: 'Unknown message type' });
  }
}
wss.on('connection', ws => {
  const client = { id: require('crypto').randomUUID(), ws, name: 'Archer', room: null, slot: -1, rateAt: Date.now(), rateCount: 0, floodAt: 0, closed: false };
  clients.set(client.id, client); send(ws, { type: 'welcome', id: client.id, serverTime: Date.now() }); log('connection', client.id);
  ws.on('message', raw => { try { onMessage(client, raw); } catch (err) { log('message error', client.id, err.message); } }); ws.on('close', () => disconnect(client)); ws.on('error', () => disconnect(client));
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
});
// Assign slots at pairing-time; slot is a server-owned side identifier.
const originalPair = pair;
// pair() assigns slots before simulation starts.
// Kept as a wrapper so every room is correctly isolated.
pair = function (a, b) { a.slot = 0; b.slot = 1; return originalPair(a, b); };
const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 5000);
const port = Number(process.env.PORT) || 3000;
server.on('error', e => { if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use. Try: set PORT=3001 (Windows) or PORT=3001 (macOS/Linux), then start again.`); clearInterval(heartbeat); process.exit(1); } else throw e; });
server.listen(port, '0.0.0.0', () => { const addresses = []; for (const entries of Object.values(os.networkInterfaces())) for (const n of entries || []) if (n.family === 'IPv4' && !n.internal) addresses.push(n.address); addresses.sort((a,b) => Number(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b)) - Number(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a))); console.log('\n=== ARROW DUEL SERVER ==='); console.log(`Local:  http://localhost:${port}`); addresses.forEach(ip => console.log(`LAN:    http://${ip}:${port}`)); console.log('Open the LAN URL on the other laptop.\n'); });
function shutdown() { clearInterval(heartbeat); for (const room of rooms.values()) destroyRoom(room); for (const ws of wss.clients) ws.close(1001, 'Server shutting down'); wss.close(() => server.close(() => process.exit(0))); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown);
module.exports = { server, wss, app, rooms, clients, waiting, close: shutdown };
