// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

// Serve Spectator Page
app.get('/board/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve Controller Page
app.get('/play/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Join API
app.post('/api/join', (req, res) => {
    const { gameId, uuid, name, role } = req.body;
    if (!gameId || !uuid || !name) {
        return res.status(400).json({ error: "Missing parameters." });
    }

    const game = getGame(gameId);
    
    // Check if player is already registered in a role
    if (game.player1 && game.player1.uuid === uuid) {
        return res.json({ success: true, role: 'red', game });
    }
    if (game.player2 && game.player2.uuid === uuid) {
        return res.json({ success: true, role: 'yellow', game });
    }

    if (role === 'red') {
        if (game.player1) return res.status(400).json({ error: "Red slot already taken." });
        game.player1 = { uuid, name };
    } else if (role === 'yellow') {
        if (game.player2) return res.status(400).json({ error: "Yellow slot already taken." });
        game.player2 = { uuid, name };
    } else {
        // Auto assign
        if (!game.player1) {
            game.player1 = { uuid, name };
        } else if (!game.player2) {
            game.player2 = { uuid, name };
        } else {
            return res.status(400).json({ error: "Game is full." });
        }
    }

    if (game.player1 && game.player2) {
        game.status = 'playing';
    }

    io.to(gameId).emit('update', game);
    res.json({ success: true, role: game.player1 && game.player1.uuid === uuid ? 'red' : 'yellow', game });
});

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
app.post('/api/move', (req, res) => {
    const { gameId, role, col } = req.body;
    const game = games[gameId];

    if (!game) return res.status(404).json({ error: "Game not found." });
    if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

    const playerNum = role === 'red' ? 1 : 2;
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
    let vibeEvents = [];

    if (winResult) {
        game.status = 'won';
        game.winner = winResult.winner;
        game.winCoords = winResult.coords;

        // Vibe Event: Win/Loss
        vibeEvents.push({ role: 'red', type: game.winner === 1 ? 'win' : 'lose' });
        vibeEvents.push({ role: 'yellow', type: game.winner === 2 ? 'win' : 'lose' });
    } else if (checkDraw(game.board)) {
        game.status = 'draw';
    } else {
        // Game continues. Switch turn
        game.turn = opponentNum;

        // Threat Detection *after* the move
        const myWinningSlotsAfter = getWinningSlots(game.board, playerNum);
        
        // If player has a threat, alert the opponent
        if (myWinningSlotsAfter.length > 0) {
            vibeEvents.push({ role: role === 'red' ? 'yellow' : 'red', type: 'threat' });
        }

        // If player successfully blocked the opponent's threat, reward them
        if (isBlock) {
            vibeEvents.push({ role: role, type: 'block' });
        } else {
            // Standard move vibrations
            vibeEvents.push({ role: role === 'red' ? 'yellow' : 'red', type: 'turn_alert' });
            vibeEvents.push({ role: role, type: 'move' });
        }
    }

    io.to(gameId).emit('update', { game, vibeEvents, lastMove: { r, c, player: playerNum } });
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
