# 🟦 BLOCKBLAST - Guide de déploiement

## Fichiers inclus

- `index.html` — Le jeu complet (solo + interface multijoueur)
- `server.js`  — Serveur Node.js WebSocket pour le multijoueur
- `package.json` — Dépendances Node

---

## ▶️ Lancer en local

```bash
npm install
node server.js
# Ouvre http://localhost:3000
```

---

## 🌍 Mettre en ligne — 3 options

### Option 1 : Solo uniquement (GRATUIT, 2 minutes)

> Si tu veux juste jouer en solo, sans multijoueur.

**Netlify Drop** (le plus simple) :
1. Va sur https://app.netlify.com/drop
2. Glisse `index.html` dans la zone
3. C'est en ligne ! Tu auras une URL genre `https://magical-name.netlify.app`

**GitHub Pages** :
1. Crée un repo GitHub
2. Upload `index.html`
3. Dans Settings → Pages → Source: main branch
4. URL : `https://ton-user.github.io/ton-repo`

---

### Option 2 : Multijoueur sur Railway (GRATUIT au début)

Railway héberge Node.js gratuitement avec WebSocket.

1. **Crée un compte** sur https://railway.app
2. **Nouveau projet** → Deploy from GitHub
3. Upload tes fichiers (ou pousse sur GitHub d'abord)
4. Railway détecte automatiquement Node.js
5. Dans l'onglet **Settings** → **Networking** : génère un domaine public
6. **Modifie `index.html`** : remplace `wss://YOUR-SERVER.com` par ton URL Railway :
   ```js
   const WS_URL = 'wss://ton-app.up.railway.app';
   ```
7. Redéploie → C'est en ligne !

**Commandes utiles Railway :**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

---

### Option 3 : Render (GRATUIT, dormance après 15 min)

1. https://render.com → New Web Service
2. Connecte GitHub avec tes fichiers
3. Build command : `npm install`
4. Start command : `node server.js`
5. Récupère l'URL `https://ton-app.onrender.com`
6. Remplace `wss://YOUR-SERVER.com` → `wss://ton-app.onrender.com`

> ⚠️ Sur le plan gratuit, le serveur dort après 15 min d'inactivité. Premier chargement = ~30s.

---

### Option 4 : VPS (DigitalOcean / OVH / Hetzner) — Payant, le plus stable

```bash
# Sur ton VPS Ubuntu
sudo apt update && sudo apt install nodejs npm nginx -y
npm install

# PM2 pour garder le serveur allumé
npm install -g pm2
pm2 start server.js --name blockblast
pm2 startup
pm2 save

# Nginx comme reverse proxy
sudo nano /etc/nginx/sites-available/blockblast
```

```nginx
server {
    listen 80;
    server_name ton-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/blockblast /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS avec Certbot
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d ton-domaine.com
```

---

## 🔌 Connecter le client au serveur

Dans `index.html`, trouve cette ligne :
```js
const WS_URL = 'wss://YOUR-SERVER.com';
```

Remplace par ton URL selon l'hébergeur :
| Hébergeur | URL |
|-----------|-----|
| Railway | `wss://ton-app.up.railway.app` |
| Render | `wss://ton-app.onrender.com` |
| VPS | `wss://ton-domaine.com` |
| Local | `ws://localhost:3000` |

Puis dans `createRoom()`, supprime le commentaire sur `connectWebSocket('create')` et fais de même dans `joinRoom()`.

---

## 📦 package.json

```json
{
  "name": "blockblast",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "ws": "^8.14.2"
  },
  "engines": {
    "node": ">=18"
  }
}
```

---

## 🎮 Architecture multijoueur

```
Client A ─┐
           ├─ WebSocket ─→ server.js ─→ broadcast ─→ Client B
Client B ─┘                              └─────────→ Client A
```

**Flow d'une partie :**
1. A crée un salon → reçoit un code (ex: `K7PQ`)
2. B entre le code → rejoint le salon
3. A (host) clique "Lancer" → le serveur envoie `game_start` à tous
4. Chaque move envoie l'état de la grille aux adversaires
5. Quand un joueur bloque → `player_lost` → le serveur détermine le gagnant

---

*Bon jeu ! 🟦*
