const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Railway injecte PORT automatiquement — NE PAS mettre de valeur fixe
const PORT = process.env.PORT;
if (!PORT) { console.error('PORT non défini !'); process.exit(1); }

// ── Serveur HTTP ──────────────────────────────
const server = http.createServer((req, res) => {
  // Health check pour Railway
  if (req.url === '/health') {
    res.writeHead(200); res.end('OK');
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const file = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(file);
    } catch(e) {
      res.writeHead(500); res.end('Erreur');
    }
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket ─────────────────────────────────
const wss = new WebSocketServer({ server });

// rooms = Map<code, { host, players:[{ws,name,score,lost,grid}], started }>
const rooms = new Map();

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

function broadcast(room, msg, excludeWs) {
  const str = JSON.stringify(msg);
  room.players.forEach(p => { if (p.ws !== excludeWs && p.ws.readyState === 1) p.ws.send(str); });
}
function broadcastAll(room, msg) {
  const str = JSON.stringify(msg);
  room.players.forEach(p => { if (p.ws.readyState === 1) p.ws.send(str); });
}
function playerList(room) { return room.players.map(p => ({ name: p.name })); }

function checkGameOver(room) {
  const alive = room.players.filter(p => !p.lost);
  if (alive.length === 1 && room.players.length > 1) {
    broadcastAll(room, { type:'game_over', winner: alive[0].name, scores: room.players.map(p=>({name:p.name,score:p.score})) });
    room.started = false;
  } else if (alive.length === 0) {
    const best = room.players.reduce((a,b) => a.score > b.score ? a : b);
    broadcastAll(room, { type:'game_over', winner: best.name, scores: room.players.map(p=>({name:p.name,score:p.score})) });
    room.started = false;
  }
}

wss.on('connection', ws => {
  let currentRoom = null;
  let playerName = '';

  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch(msg.type) {

      case 'create_room': {
        playerName = msg.name || 'Joueur';
        const code = genCode();
        const room = { code, host: ws, players: [{ws, name:playerName, score:0, lost:false}], started:false };
        rooms.set(code, room);
        currentRoom = room;
        ws.send(JSON.stringify({ type:'room_created', code, players: playerList(room) }));
        console.log(`[${code}] Créé par ${playerName}`);
        break;
      }

      case 'join_room': {
        const code = msg.code?.toUpperCase();
        const room = rooms.get(code);
        if (!room) { ws.send(JSON.stringify({type:'error', message:'Salon introuvable'})); return; }
        if (room.started) { ws.send(JSON.stringify({type:'error', message:'Partie en cours'})); return; }
        if (room.players.length >= 4) { ws.send(JSON.stringify({type:'error', message:'Salon plein'})); return; }
        playerName = msg.name || 'Joueur';
        room.players.push({ws, name:playerName, score:0, lost:false});
        currentRoom = room;
        ws.send(JSON.stringify({ type:'room_joined', code, players: playerList(room) }));
        broadcast(room, { type:'player_joined', name:playerName, players: playerList(room) }, ws);
        console.log(`[${code}] ${playerName} a rejoint`);
        break;
      }

      case 'start_game': {
        if (!currentRoom || currentRoom.host !== ws) return;
        currentRoom.started = true;
        currentRoom.players.forEach(p => { p.score=0; p.lost=false; });
        broadcastAll(currentRoom, { type:'game_start', seed: Math.floor(Math.random()*999999) });
        console.log(`[${currentRoom.code}] Partie lancée (${currentRoom.players.length} joueurs)`);
        break;
      }

      case 'move': {
        if (!currentRoom) return;
        const p = currentRoom.players.find(p => p.ws === ws);
        if (!p) return;
        p.score = msg.score || 0;
        p.grid = msg.grid;
        broadcast(currentRoom, { type:'opponent_update', name:p.name, grid:msg.grid, score:msg.score }, ws);
        break;
      }

      case 'player_lost': {
        if (!currentRoom) return;
        const p = currentRoom.players.find(p => p.ws === ws);
        if (p) { p.lost = true; broadcast(currentRoom, {type:'opponent_lost', name:p.name}, ws); checkGameOver(currentRoom); }
        break;
      }
    }
  });

  function handleDisconnect() {
    if (!currentRoom) return;
    const room = currentRoom;
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx === -1) return;
    const name = room.players[idx].name;
    room.players.splice(idx, 1);
    console.log(`[${room.code}] ${name} déconnecté`);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      if (room.host === ws) room.host = room.players[0].ws;
      broadcastAll(room, { type:'player_left', name, players: playerList(room) });
      if (room.started) checkGameOver(room);
    }
    currentRoom = null;
  }

  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);
});

// ── Démarrage ─────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOCKBLAST SERVER démarré sur port ${PORT}`);
});
