// ================================================
//  BLOCKBLAST - Serveur Multijoueur
//  Node.js + WebSocket (ws)
//  npm install ws
//  node server.js
// ================================================

const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Serveur HTTP (pour servir le jeu ET le WebSocket)
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(file);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket Server
const wss = new WebSocketServer({ server });

// Stockage des salons
// rooms = { code: { host, players: [{ws, name}], started: bool } }
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function broadcast(room, message, excludeWs = null) {
  room.players.forEach(({ ws }) => {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  });
}

function broadcastAll(room, message) {
  room.players.forEach(({ ws }) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  });
}

function getPlayersList(room) {
  return room.players.map(p => ({ name: p.name }));
}

function checkGameOver(room) {
  // Si tous les joueurs ont perdu sauf un → le dernier gagne
  const alive = room.players.filter(p => !p.lost);
  if (alive.length === 1 && room.players.length > 1) {
    broadcastAll(room, {
      type: 'game_over',
      winner: alive[0].name,
      scores: room.players.map(p => ({ name: p.name, score: p.score }))
    });
    room.started = false;
  }
  // Tous perdus → meilleur score gagne
  if (alive.length === 0) {
    const best = room.players.reduce((a, b) => a.score > b.score ? a : b);
    broadcastAll(room, {
      type: 'game_over',
      winner: best.name,
      scores: room.players.map(p => ({ name: p.name, score: p.score }))
    });
    room.started = false;
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerName = '';

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      // ── CRÉER UN SALON ──────────────────────────
      case 'create_room': {
        const code = generateCode();
        playerName = msg.name || 'Joueur';
        const room = {
          code,
          host: ws,
          players: [{ ws, name: playerName, score: 0, lost: false }],
          started: false,
        };
        rooms.set(code, room);
        currentRoom = room;

        ws.send(JSON.stringify({
          type: 'room_created',
          code,
          players: getPlayersList(room)
        }));
        console.log(`[${code}] Salon créé par ${playerName}`);
        break;
      }

      // ── REJOINDRE UN SALON ──────────────────────
      case 'join_room': {
        const code = msg.code?.toUpperCase();
        const room = rooms.get(code);

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable' }));
          return;
        }
        if (room.started) {
          ws.send(JSON.stringify({ type: 'error', message: 'Partie déjà commencée' }));
          return;
        }
        if (room.players.length >= 4) {
          ws.send(JSON.stringify({ type: 'error', message: 'Salon plein (max 4)' }));
          return;
        }

        playerName = msg.name || 'Joueur';
        room.players.push({ ws, name: playerName, score: 0, lost: false });
        currentRoom = room;

        // Confirmer au joueur qui arrive
        ws.send(JSON.stringify({
          type: 'room_joined',
          code,
          players: getPlayersList(room)
        }));

        // Informer tous les autres
        broadcast(room, {
          type: 'player_joined',
          name: playerName,
          players: getPlayersList(room)
        }, ws);

        console.log(`[${code}] ${playerName} a rejoint`);
        break;
      }

      // ── LANCER LA PARTIE ────────────────────────
      case 'start_game': {
        if (!currentRoom || currentRoom.host !== ws) return;
        const room = currentRoom;
        if (room.players.length < 1) return;

        room.started = true;
        room.players.forEach(p => { p.score = 0; p.lost = false; });

        const seed = Math.floor(Math.random() * 999999);
        broadcastAll(room, { type: 'game_start', seed });
        console.log(`[${room.code}] Partie lancée (${room.players.length} joueurs)`);
        break;
      }

      // ── MISE À JOUR DU JEU ──────────────────────
      case 'move': {
        if (!currentRoom || !currentRoom.started) return;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player) return;

        player.score = msg.score || 0;
        player.grid = msg.grid;

        // Envoyer l'état de ce joueur aux adversaires
        broadcast(currentRoom, {
          type: 'opponent_update',
          name: player.name,
          grid: msg.grid,
          score: msg.score,
          lines: msg.lines
        }, ws);
        break;
      }

      // ── GAME OVER D'UN JOUEUR ───────────────────
      case 'player_lost': {
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (player) {
          player.lost = true;
          broadcast(currentRoom, { type: 'opponent_lost', name: player.name }, ws);
          checkGameOver(currentRoom);
        }
        break;
      }

      // ── QUITTER ─────────────────────────────────
      case 'leave': {
        handleDisconnect();
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

    console.log(`[${room.code}] ${name} a quitté`);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      console.log(`[${room.code}] Salon supprimé`);
    } else {
      // Transférer le host si nécessaire
      if (room.host === ws) room.host = room.players[0].ws;
      broadcastAll(room, {
        type: 'player_left',
        name,
        players: getPlayersList(room)
      });
      if (room.started) checkGameOver(room);
    }
    currentRoom = null;
  }

  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);
});

server.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────┐
  │   BLOCKBLAST SERVER             │
  │   http://localhost:${PORT}          │
  │   WebSocket: ws://localhost:${PORT} │
  └─────────────────────────────────┘
  `);
});
