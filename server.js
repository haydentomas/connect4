// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Lovense Credentials
const LOVENSE_TOKEN = "q9U33GxiMHTq0z1K3gEM3T70RJKPb_3MLlgD0ElnOLFlMN42OFJat-HTWQNIkMyL";
const LOVENSE_KEY = "6997e394b26472e4";
const LOVENSE_IV = "6D3C56950B40AF10";

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Game Store (In-Memory)
const games = {};

// Helper: Initialize a empty board (7 columns, 6 rows)
// Represented as grid[row][col] where row 0 is bottom, row 5 is top.
function createEmptyBoard() {
    const board = [];
    for (let r = 0; r < 6; r++) {
        board.push(new Array(7).fill(0));
    }
    return board;
}

// Check for Win (4-in-a-row)
function checkWin(board) {
    const ROWS = 6;
    const COLS = 7;

    // Horizontal
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const p = board[r][c];
            if (p !== 0 && p === board[r][c+1] && p === board[r][c+2] && p === board[r][c+3]) {
                return { winner: p, coords: [[r, c], [r, c+1], [r, c+2], [r, c+3]] };
            }
        }
    }

    // Vertical
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = board[r][c];
            if (p !== 0 && p === board[r+1][c] && p === board[r+2][c] && p === board[r+3][c]) {
                return { winner: p, coords: [[r, c], [r+1, c], [r+2, c], [r+3, c]] };
            }
        }
    }

    // Diagonal Up-Right
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const p = board[r][c];
            if (p !== 0 && p === board[r+1][c+1] && p === board[r+2][c+2] && p === board[r+3][c+3]) {
                return { winner: p, coords: [[r, c], [r+1, c+1], [r+2, c+2], [r+3, c+3]] };
            }
        }
    }

    // Diagonal Down-Right
    for (let r = 3; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const p = board[r][c];
            if (p !== 0 && p === board[r-1][c+1] && p === board[r-2][c+2] && p === board[r-3][c+3]) {
                return { winner: p, coords: [[r, c], [r-1, c+1], [r-2, c+2], [r-3, c+3]] };
            }
        }
    }

    return null;
}

// Check for Draw (board full)
function checkDraw(board) {
    return board[5].every(cell => cell !== 0);
}

// Find winning threats (3-in-a-row with the 4th empty)
// Returns list of string coords "r_c" that would win the game for player.
function getWinningSlots(board, player) {
    const ROWS = 6;
    const COLS = 7;
    const winningSlots = [];

    const checkAndAdd = (coords) => {
        let count = 0;
        let emptySpot = null;
        for (const [r, c] of coords) {
            if (board[r][c] === player) count++;
            else if (board[r][c] === 0) emptySpot = { r, c };
        }
        if (count === 3 && emptySpot !== null) {
            winningSlots.push(`${emptySpot.r}_${emptySpot.c}`);
        }
    };

    // Horizontal
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            checkAndAdd([[r, c], [r, c+1], [r, c+2], [r, c+3]]);
        }
    }

    // Vertical
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS; c++) {
            checkAndAdd([[r, c], [r+1, c], [r+2, c], [r+3, c]]);
        }
    }

    // Diagonal Up-Right
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            checkAndAdd([[r, c], [r+1, c+1], [r+2, c+2], [r+3, c+3]]);
        }
    }

    // Diagonal Down-Right
    for (let r = 3; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            checkAndAdd([[r, c], [r-1, c+1], [r-2, c+2], [r-3, c+3]]);
        }
    }

    return winningSlots;
}

// Retrieve or Initialize Game
function getGame(gameId) {
    if (!games[gameId]) {
        games[gameId] = {
            id: gameId,
            player1: null, // Red (e.g. { uuid, name })
            player2: null, // Yellow
            board: createEmptyBoard(),
            turn: 1, // Red starts
            status: 'waiting', // waiting, playing, won, draw
            winner: 0,
            winCoords: [],
            lastThreats: { 1: [], 2: [] }
        };
    }
    return games[gameId];
}

// Helper: Secure POST request using built-in https module
function securePost(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// Serve Spectator Page
app.get('/board/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve Controller Page
app.get('/play/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Join API
app.post('/api/join', async (req, res) => {
    const { gameId, uuid, name, role } = req.body;
    if (!gameId || !uuid || !name) {
        return res.status(400).json({ error: "Missing parameters." });
    }

    const game = getGame(gameId);
    let playerObj = null;
    let assignedRole = null;
    
    // Check if player is already registered in a role
    if (game.player1 && game.player1.uuid === uuid) {
        return res.json({ success: true, role: 'red', game });
    }
    if (game.player2 && game.player2.uuid === uuid) {
        return res.json({ success: true, role: 'yellow', game });
    }

    if (role === 'red') {
        if (game.player1) return res.status(400).json({ error: "Red slot already taken." });
        game.player1 = { uuid, name, connected: false, qrCode: null, qrLink: null, qrError: null, linkCode: null };
        playerObj = game.player1;
        assignedRole = 'red';
    } else if (role === 'yellow') {
        if (game.player2) return res.status(400).json({ error: "Yellow slot already taken." });
        game.player2 = { uuid, name, connected: false, qrCode: null, qrLink: null, qrError: null, linkCode: null };
        playerObj = game.player2;
        assignedRole = 'yellow';
    } else {
        // Auto assign
        if (!game.player1) {
            game.player1 = { uuid, name, connected: false, qrCode: null, qrLink: null, qrError: null, linkCode: null };
            playerObj = game.player1;
            assignedRole = 'red';
        } else if (!game.player2) {
            game.player2 = { uuid, name, connected: false, qrCode: null, qrLink: null, qrError: null, linkCode: null };
            playerObj = game.player2;
            assignedRole = 'yellow';
        } else {
            return res.status(400).json({ error: "Game is full." });
        }
    }

    // Call Lovense to get the QR code for this user if it's not a local mock browser user
    if (playerObj && !uuid.startsWith('browser_')) {
        try {
            console.log(`Requesting Lovense QR code for ${name} (${uuid})`);
            const resJson = await securePost('https://api.lovense-api.com/api/lan/getQrCode', {
                token: LOVENSE_TOKEN,
                uid: uuid,
                v: 2,
                uname: name
            });
            if (resJson.code === 0 && resJson.data) {
                playerObj.qrCode = resJson.data.qr;
                playerObj.qrLink = resJson.data.qr; // Use qr URL as fallback
                playerObj.linkCode = resJson.data.code;
                playerObj.qrError = null;
                console.log(`Lovense QR Code retrieved: ${resJson.data.qr}, Code: ${resJson.data.code}`);
            } else {
                playerObj.qrError = resJson.message || "Lovense API error";
                console.error("Lovense QR Code error response:", resJson);
            }
        } catch (err) {
            playerObj.qrError = err.message || "Failed to contact Lovense";
            console.error("Error fetching Lovense QR Code:", err);
        }
    } else if (playerObj) {
        // For local mock player testing, auto-connect immediately!
        playerObj.connected = true;
    }

    if (game.player1 && game.player2) {
        game.status = 'playing';
    }

    io.to(gameId).emit('update', game);
    res.json({ success: true, role: assignedRole, game });
});

// Lovense Webhook Callback
app.post('/api/lovense/callback', (req, res) => {
    console.log("Received Lovense Callback:", req.body);
    const { uid, status } = req.body;
    
    if (!uid) {
        return res.status(400).send("Missing uid.");
    }
    
    const isConnected = (status === 1 || status === '1');
    
    // Find player in active games and update connection status
    for (const gameId in games) {
        const game = games[gameId];
        let updated = false;
        
        if (game.player1 && game.player1.uuid === uid) {
            game.player1.connected = isConnected;
            updated = true;
        }
        if (game.player2 && game.player2.uuid === uid) {
            game.player2.connected = isConnected;
            updated = true;
        }
        
        if (updated) {
            console.log(`Updated connection for player ${uid} in game ${gameId} to: ${isConnected}`);
            io.to(gameId).emit('update', game);
        }
    }
    
    res.send("OK");
});

// Test Vibration API
app.post('/api/vibe/test', async (req, res) => {
    const { gameId, role } = req.body;
    const game = games[gameId];
    if (!game) return res.status(404).json({ error: "Game not found." });
    
    const player = role === 'red' ? game.player1 : game.player2;
    if (!player) return res.status(400).json({ error: "Player not registered." });
    
    console.log(`Triggering test vibration for ${player.name} (${player.uuid})`);
    await triggerVibration(player.uuid, 'move');
    res.json({ success: true });
});

// Helper: Trigger Server-Side Vibration
async function triggerVibration(uid, type) {
    if (!uid) return;
    if (uid.startsWith('browser_')) {
        console.log(`Skipping vibration for local browser mock player: ${uid}`);
        return;
    }
    
    let strength = 0;
    let duration = 0;
    
    switch (type) {
        case 'move':
            strength = 6;
            duration = 1;
            break;
        case 'turn_alert':
            strength = 8;
            duration = 1;
            break;
        case 'block':
            strength = 12;
            duration = 2;
            break;
        case 'threat':
            strength = 15;
            duration = 2;
            break;
        case 'win':
            strength = 12;
            duration = 4;
            break;
        case 'lose':
            strength = 20; // Heavy rumble for defeat!
            duration = 5;
            break;
        default:
            return;
    }
    
    try {
        console.log(`Sending vibration command: Vibrate:${strength} for ${duration}s to UID ${uid}`);
        const resJson = await securePost('https://api.lovense-api.com/api/lan/v2/command', {
            token: LOVENSE_TOKEN,
            uid: uid,
            command: "Function",
            action: `Vibrate:${strength}`,
            timeSec: duration,
            apiVer: 2
        });
        console.log("Lovense command response:", resJson);
    } catch (err) {
        console.error("Error triggering Lovense vibration:", err);
    }
}

// Reset Game API
app.post('/api/reset', (req, res) => {
    const { gameId } = req.body;
    const game = games[gameId];
    if (game) {
        game.board = createEmptyBoard();
        game.turn = 1;
        game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
        game.winner = 0;
        game.winCoords = [];
        game.lastThreats = { 1: [], 2: [] };
        io.to(gameId).emit('update', game);
    }
    res.json({ success: true, game });
});

// Drop Token API
app.post('/api/move', async (req, res) => {
    const { gameId, role, uuid, col } = req.body;
    const game = games[gameId];

    if (!game) return res.status(404).json({ error: "Game not found." });
    if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

    let activeRole = role;
    if (uuid) {
        if (game.player1 && game.player1.uuid === uuid) {
            activeRole = 'red';
        } else if (game.player2 && game.player2.uuid === uuid) {
            activeRole = 'yellow';
        } else {
            return res.status(400).json({ error: "You are not a registered player in this game." });
        }
    }

    if (!activeRole) {
        return res.status(400).json({ error: "Player role not specified." });
    }

    const playerNum = activeRole === 'red' ? 1 : 2;
    if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

    const c = parseInt(col);
    if (isNaN(c) || c < 0 || c > 6) return res.status(400).json({ error: "Invalid column." });

    // Find lowest empty row in column
    let r = -1;
    for (let row = 0; row < 6; row++) {
        if (game.board[row][c] === 0) {
            r = row;
            break;
        }
    }

    if (r === -1) return res.status(400).json({ error: "Column is full." });

    // Identify threats for both players *before* making the move
    const opponentNum = playerNum === 1 ? 2 : 1;
    const oppWinningSlotsBefore = getWinningSlots(game.board, opponentNum);

    // Make the move
    game.board[r][c] = playerNum;

    // Detect Block: Did this move cover a slot that would have won the game for the opponent?
    const isBlock = oppWinningSlotsBefore.includes(`${r}_${c}`);

    // Check for Win or Draw
    const winResult = checkWin(game.board);
    
    // Server-Side Vibration commands to queue
    const vibeQueue = [];

    if (winResult) {
        game.status = 'won';
        game.winner = winResult.winner;
        game.winCoords = winResult.coords;

        if (game.player1) vibeQueue.push({ uid: game.player1.uuid, type: game.winner === 1 ? 'win' : 'lose' });
        if (game.player2) vibeQueue.push({ uid: game.player2.uuid, type: game.winner === 2 ? 'win' : 'lose' });
    } else if (checkDraw(game.board)) {
        game.status = 'draw';
    } else {
        // Game continues. Switch turn
        game.turn = opponentNum;

        // Threat Detection *after* the move
        const myWinningSlotsAfter = getWinningSlots(game.board, playerNum);
        
        // If player has a threat, alert the opponent
        if (myWinningSlotsAfter.length > 0) {
            const oppUuid = role === 'red' ? (game.player2 && game.player2.uuid) : (game.player1 && game.player1.uuid);
            vibeQueue.push({ uid: oppUuid, type: 'threat' });
        }

        // If player successfully blocked the opponent's threat, reward them
        if (isBlock) {
            const myUuid = role === 'red' ? (game.player1 && game.player1.uuid) : (game.player2 && game.player2.uuid);
            vibeQueue.push({ uid: myUuid, type: 'block' });
        } else {
            // Standard move vibrations
            const oppUuid = role === 'red' ? (game.player2 && game.player2.uuid) : (game.player1 && game.player1.uuid);
            const myUuid = role === 'red' ? (game.player1 && game.player1.uuid) : (game.player2 && game.player2.uuid);
            
            vibeQueue.push({ uid: oppUuid, type: 'turn_alert' });
            vibeQueue.push({ uid: myUuid, type: 'move' });
        }
    }

    // Broadcast the state update to all spectators and controllers
    io.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });
    
    // Execute all vibrations
    vibeQueue.forEach(item => {
        if (item.uid) triggerVibration(item.uid, item.type);
    });

    res.json({ success: true, game });
});

// Socket Connections
io.on('connection', (socket) => {
    socket.on('join_game', (gameId) => {
        socket.join(gameId);
        const game = getGame(gameId);
        socket.emit('update', game);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Connect 4 Server running on port ${PORT}`);
});
