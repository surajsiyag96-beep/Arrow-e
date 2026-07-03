// --- GAME STATE & CONSTANTS ---
const GAME_VERSION = "1.0";
const REWARD_THRESHOLD = 1000;
const MAX_HEARTS = 5;

let state = {
    level: 1,
    points: 0,
    hearts: MAX_HEARTS,
    streak: 0,
    lastLoginDate: null,
    totalPlayTime: 0, // in seconds
    todayPlayTime: 0, // in seconds
    todayPlayTarget: 60 * 60, // Starts at 60 mins (3600 seconds)
    todayPlayBonusAwarded: false,
    firstLogin: true
};

// DOM Elements
const el = {
    level: document.getElementById('level-val'),
    points: document.getElementById('points-val'),
    hearts: document.getElementById('hearts-val'),
    streak: document.getElementById('streak-val'),
    time: document.getElementById('time-val'),
    progressBar: document.getElementById('progress-bar'),
    
    // Modals
    startModal: document.getElementById('modal-start'),
    levelCompleteModal: document.getElementById('modal-level-complete'),
    gameOverModal: document.getElementById('modal-game-over'),
    rewardsModal: document.getElementById('modal-rewards'),
    
    // Buttons
    btnStart: document.getElementById('btn-start'),
    btnNextLevel: document.getElementById('btn-next-level'),
    btnRestart: document.getElementById('btn-restart'),
    btnWatchAd: document.getElementById('btn-watch-ad'),
    btnRewardsMenu: document.getElementById('btn-rewards-menu'),
    btnRedeem: document.getElementById('btn-redeem'),
    btnCloseRewards: document.getElementById('btn-close-rewards'),
    
    // Canvases
    gameCanvas: document.getElementById('gameCanvas'),
    fxCanvas: document.getElementById('fxCanvas'),
    
    app: document.getElementById('app')
};

const ctx = el.gameCanvas.getContext('2d');
const fxCtx = el.fxCanvas.getContext('2d');

let gameTimer = null;
let lastTick = Date.now();

// --- LOCAL STORAGE ---
function saveState() {
    localStorage.setItem('arrowEscapeState', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('arrowEscapeState');
    if (saved) {
        try {
            state = { ...state, ...JSON.parse(saved) };
            // Make sure hearts don't go above MAX_HEARTS normally, though they can if rewarded
            if(state.hearts < 0) state.hearts = 0;
        } catch (e) {
            console.error("Failed to load state", e);
        }
    }
}

// --- INITIALIZATION & DAILY BONUSES ---
function checkDailyBonuses() {
    const today = new Date().toDateString();
    
    if (state.firstLogin) {
        state.points += 20;
        showFloatingText('+20 First Login Bonus!', window.innerWidth/2, window.innerHeight/3, 'bonus');
        state.firstLogin = false;
    }

    if (state.lastLoginDate !== today) {
        // New day
        if (state.lastLoginDate) {
            const lastDate = new Date(state.lastLoginDate);
            const diffTime = Math.abs(new Date() - lastDate);
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
            
            if (diffDays === 1) {
                // Consecutive day
                state.streak++;
                state.todayPlayTarget += 5 * 60; // Increase by 5 mins
            } else {
                // Streak broken
                state.streak = 1;
                state.todayPlayTarget = 60 * 60; // Reset to 60 mins
            }
        } else {
            // Very first time
            state.streak = 1;
        }
        
        state.lastLoginDate = today;
        state.todayPlayTime = 0;
        state.todayPlayBonusAwarded = false;
        
        state.points += 5; // Daily login bonus
        setTimeout(() => {
            showFloatingText('+5 Daily Login!', window.innerWidth/2, window.innerHeight/3 + 40, 'bonus');
            updateUI();
        }, 1000);
    }
    
    saveState();
}

function updateUI() {
    el.level.innerText = state.level;
    el.points.innerText = state.points;
    el.hearts.innerText = state.hearts;
    el.streak.innerText = state.streak;
    
    // Update Rewards UI
    document.getElementById('reward-points-val').innerText = state.points;
    el.btnRedeem.disabled = state.points < REWARD_THRESHOLD;
    
    // Play time formatting
    const m = Math.floor(state.todayPlayTime / 60).toString().padStart(2, '0');
    const s = (state.todayPlayTime % 60).toString().padStart(2, '0');
    el.time.innerText = `${m}:${s}`;
    
    // Progress bar for daily play bonus
    let progress = (state.todayPlayTime / state.todayPlayTarget) * 100;
    if (progress > 100) progress = 100;
    el.progressBar.style.width = `${progress}%`;
}

// --- FLOATING TEXT ---
function showFloatingText(text, x, y, type = 'positive') {
    const container = document.getElementById('floating-text-container');
    const el = document.createElement('div');
    el.className = `floating-text ${type}`;
    el.innerText = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    
    container.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, 1000);
}

// --- GAME LOOP / TIMERS ---
function startGameTimer() {
    if (gameTimer) clearInterval(gameTimer);
    lastTick = Date.now();
    gameTimer = setInterval(() => {
        const now = Date.now();
        const delta = Math.floor((now - lastTick) / 1000);
        
        if (delta >= 1) {
            state.totalPlayTime += delta;
            state.todayPlayTime += delta;
            lastTick = now;
            
            // Check play time bonus
            if (state.todayPlayTime >= state.todayPlayTarget && !state.todayPlayBonusAwarded) {
                state.todayPlayBonusAwarded = true;
                state.points += 5;
                showFloatingText('+5 Play Time Bonus!', window.innerWidth/2, 100, 'bonus');
                saveState();
            }
            
            updateUI();
        }
    }, 1000);
}

// Setup Event Listeners for UI
el.btnStart.addEventListener('click', () => {
    el.startModal.style.display = 'none';
    startGameTimer();
    initGame();
});

// --- MAZE & RENDER LOGIC ---
let maze = [];
let gridSize = 3; // Starts small
let cellSize = 0;
let playerPos = { x: 0, y: 0 };
let endPos = { x: 0, y: 0 };
let currentPath = []; // Tracks the correct path to the end

function resizeCanvas() {
    const container = document.getElementById('game-container');
    const size = Math.min(container.clientWidth - 20, container.clientHeight - 60);
    el.gameCanvas.width = size;
    el.gameCanvas.height = size;
    el.fxCanvas.width = window.innerWidth;
    el.fxCanvas.height = window.innerHeight;
    cellSize = size / gridSize;
    drawMaze();
}

window.addEventListener('resize', resizeCanvas);

function generateMaze(level) {
    // Increase difficulty
    gridSize = Math.min(3 + Math.floor(level / 3), 15); // Caps at 15x15 for visibility
    
    // Initialize empty grid
    maze = [];
    for (let y = 0; y < gridSize; y++) {
        let row = [];
        for (let x = 0; x < gridSize; x++) {
            row.push({
                x, y,
                visited: false,
                edges: [], // Possible directions to move out of this cell
                correctDir: null // The single correct direction to the end
            });
        }
        maze.push(row);
    }
    
    playerPos = { x: 0, y: 0 };
    endPos = { x: gridSize - 1, y: gridSize - 1 };
    
    // Depth-First Search for Perfect Maze Generation
    let stack = [maze[0][0]];
    maze[0][0].visited = true;
    
    // To track the path to the end
    let pathToEnd = [];
    let endFound = false;

    while (stack.length > 0) {
        let current = stack[stack.length - 1];
        
        if (!endFound) {
            pathToEnd.push(current);
            if (current.x === endPos.x && current.y === endPos.y) {
                endFound = true;
                currentPath = [...pathToEnd];
            }
        }

        let neighbors = getUnvisitedNeighbors(current);
        
        if (neighbors.length > 0) {
            // Choose random neighbor
            let next = neighbors[Math.floor(Math.random() * neighbors.length)];
            
            // Determine direction from current to next
            let dir = getDirection(current, next);
            
            // Add directed edge (maze paths flow outward from start)
            current.edges.push(dir);
            
            next.visited = true;
            stack.push(next);
        } else {
            if (!endFound) pathToEnd.pop();
            stack.pop();
        }
    }
    
    // Set correct paths
    for (let i = 0; i < currentPath.length - 1; i++) {
        let curr = currentPath[i];
        let next = currentPath[i+1];
        curr.correctDir = getDirection(curr, next);
    }
    
    // Add misleading paths to increase difficulty based on level
    addMisleadingPaths(level);
}

function getUnvisitedNeighbors(cell) {
    let neighbors = [];
    if (cell.y > 0 && !maze[cell.y-1][cell.x].visited) neighbors.push(maze[cell.y-1][cell.x]); // Up
    if (cell.x < gridSize - 1 && !maze[cell.y][cell.x+1].visited) neighbors.push(maze[cell.y][cell.x+1]); // Right
    if (cell.y < gridSize - 1 && !maze[cell.y+1][cell.x].visited) neighbors.push(maze[cell.y+1][cell.x]); // Down
    if (cell.x > 0 && !maze[cell.y][cell.x-1].visited) neighbors.push(maze[cell.y][cell.x-1]); // Left
    return neighbors;
}

function getDirection(from, to) {
    if (to.y < from.y) return 'up';
    if (to.x > from.x) return 'right';
    if (to.y > from.y) return 'down';
    if (to.x < from.x) return 'left';
    return null;
}

function addMisleadingPaths(level) {
    // Add fake arrows to make it harder. Higher level = more fake arrows.
    let numFakes = Math.floor(level * 1.5);
    let added = 0;
    
    while(added < numFakes) {
        let rx = Math.floor(Math.random() * gridSize);
        let ry = Math.floor(Math.random() * gridSize);
        let cell = maze[ry][rx];
        
        // Don't modify the end cell
        if (rx === endPos.x && ry === endPos.y) continue;
        
        let dirs = ['up', 'right', 'down', 'left'];
        // Remove valid directions out of bounds
        if (ry === 0) dirs = dirs.filter(d => d !== 'up');
        if (rx === gridSize - 1) dirs = dirs.filter(d => d !== 'right');
        if (ry === gridSize - 1) dirs = dirs.filter(d => d !== 'down');
        if (rx === 0) dirs = dirs.filter(d => d !== 'left');
        
        // Remove existing edges
        dirs = dirs.filter(d => !cell.edges.includes(d));
        
        if (dirs.length > 0) {
            let randDir = dirs[Math.floor(Math.random() * dirs.length)];
            cell.edges.push(randDir);
            added++;
        } else {
            // No valid spots to add fake arrow, try again but prevent infinite loops
            numFakes--;
        }
    }
}

function drawMaze() {
    ctx.clearRect(0, 0, el.gameCanvas.width, el.gameCanvas.height);
    
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            let cell = maze[y][x];
            let cx = x * cellSize;
            let cy = y * cellSize;
            
            // Draw Cell Background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.fillRect(cx, cy, cellSize, cellSize);
            ctx.strokeRect(cx, cy, cellSize, cellSize);
            
            // Draw Start/End
            if (x === 0 && y === 0) {
                ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
                ctx.fillRect(cx, cy, cellSize, cellSize);
            }
            if (x === endPos.x && y === endPos.y) {
                ctx.fillStyle = 'rgba(255, 51, 102, 0.3)';
                ctx.fillRect(cx, cy, cellSize, cellSize);
                
                // Finish icon
                ctx.fillStyle = '#ff3366';
                ctx.font = `${cellSize*0.5}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('🏁', cx + cellSize/2, cy + cellSize/2);
            }
            
            // Draw Arrows
            ctx.fillStyle = '#4facfe'; // Base arrow color
            cell.edges.forEach(dir => drawArrow(cx, cy, dir));
        }
    }
    
    // Draw Player
    let px = playerPos.x * cellSize;
    let py = playerPos.y * cellSize;
    ctx.fillStyle = '#00ff88';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00ff88';
    ctx.beginPath();
    ctx.arc(px + cellSize/2, py + cellSize/2, cellSize/3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // reset
}

function drawArrow(x, y, dir) {
    ctx.save();
    ctx.translate(x + cellSize/2, y + cellSize/2);
    
    switch(dir) {
        case 'up': ctx.rotate(-Math.PI/2); break;
        case 'right': break;
        case 'down': ctx.rotate(Math.PI/2); break;
        case 'left': ctx.rotate(Math.PI); break;
    }
    
    // Draw arrow shape
    let s = cellSize * 0.3; // scale
    ctx.beginPath();
    ctx.moveTo(-s, -s/2);
    ctx.lineTo(s*0.2, -s/2);
    ctx.lineTo(s*0.2, -s);
    ctx.lineTo(s, 0);
    ctx.lineTo(s*0.2, s);
    ctx.lineTo(s*0.2, s/2);
    ctx.lineTo(-s, s/2);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
}

function initGame() {
    generateMaze(state.level);
    resizeCanvas();
}

// --- GAMEPLAY & INPUT LOGIC ---

let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('keydown', (e) => {
    if (el.startModal.style.display !== 'none' || 
        el.levelCompleteModal.style.display !== 'none' ||
        el.gameOverModal.style.display !== 'none' ||
        el.rewardsModal.style.display !== 'none') return;

    switch(e.key) {
        case 'ArrowUp': case 'w': case 'W': movePlayer('up'); break;
        case 'ArrowRight': case 'd': case 'D': movePlayer('right'); break;
        case 'ArrowDown': case 's': case 'S': movePlayer('down'); break;
        case 'ArrowLeft': case 'a': case 'A': movePlayer('left'); break;
    }
});

el.gameCanvas.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: false});

el.gameCanvas.addEventListener('touchend', (e) => {
    if (el.startModal.style.display !== 'none' || 
        el.levelCompleteModal.style.display !== 'none' ||
        el.gameOverModal.style.display !== 'none' ||
        el.rewardsModal.style.display !== 'none') return;

    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    
    let dx = touchEndX - touchStartX;
    let dy = touchEndY - touchStartY;
    
    if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > 30) movePlayer(dx > 0 ? 'right' : 'left');
    } else {
        if (Math.abs(dy) > 30) movePlayer(dy > 0 ? 'down' : 'up');
    }
}, {passive: false});

// Prevent scrolling when swiping on canvas
el.gameCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
}, {passive: false});

function movePlayer(dir) {
    let currentCell = maze[playerPos.y][playerPos.x];
    
    // Check if move is along an outgoing arrow
    if (currentCell.edges.includes(dir)) {
        
        // Check if it's the CORRECT arrow
        if (dir === currentCell.correctDir || (playerPos.x === endPos.x && playerPos.y === endPos.y)) {
            // Valid correct move
            switch(dir) {
                case 'up': playerPos.y--; break;
                case 'right': playerPos.x++; break;
                case 'down': playerPos.y++; break;
                case 'left': playerPos.x--; break;
            }
            drawMaze();
            checkWinCondition();
        } else {
            // Valid arrow, but WRONG path
            handleWrongMove();
        }
    } else {
        // Invalid move (no arrow in that direction) - Ignore or minor feedback
        shakeScreen(200);
    }
}

function handleWrongMove() {
    state.hearts--;
    state.points = Math.max(0, state.points - 1);
    
    showFloatingText('-1 Point', playerPos.x * cellSize + cellSize/2, playerPos.y * cellSize, 'negative');
    
    updateUI();
    saveState();
    
    shakeScreen(500);
    
    if (state.hearts <= 0) {
        showGameOver();
    } else {
        // Reset player to start
        playerPos = { x: 0, y: 0 };
        setTimeout(() => drawMaze(), 500); // Wait for shake to finish
    }
}

function checkWinCondition() {
    if (playerPos.x === endPos.x && playerPos.y === endPos.y) {
        state.points += 2;
        updateUI();
        saveState();
        showLevelComplete();
    }
}

function shakeScreen(duration) {
    el.app.classList.add('shake');
    setTimeout(() => {
        el.app.classList.remove('shake');
    }, duration);
}

function showLevelComplete() {
    el.levelCompleteModal.style.display = 'flex';
    createConfetti();
}

function showGameOver() {
    el.gameOverModal.style.display = 'flex';
    el.btnWatchAd.disabled = false;
}

// Next level button
el.btnNextLevel.addEventListener('click', () => {
    state.level++;
    saveState();
    updateUI();
    el.levelCompleteModal.style.display = 'none';
    initGame();
});

// Restart button (Game Over)
el.btnRestart.addEventListener('click', () => {
    state.hearts = MAX_HEARTS;
    saveState();
    updateUI();
    el.gameOverModal.style.display = 'none';
    initGame();
});

// --- PARTICLES / CONFETTI ---
let particles = [];
let animFrame = null;

function createConfetti() {
    particles = [];
    for(let i=0; i<100; i++) {
        particles.push({
            x: el.fxCanvas.width / 2,
            y: el.fxCanvas.height / 2,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10 - 5,
            size: Math.random() * 5 + 3,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            life: 1
        });
    }
    animateParticles();
}

function animateParticles() {
    fxCtx.clearRect(0, 0, el.fxCanvas.width, el.fxCanvas.height);
    
    let active = false;
    particles.forEach(p => {
        if (p.life > 0) {
            active = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.2; // gravity
            p.life -= 0.01;
            
            fxCtx.globalAlpha = p.life;
            fxCtx.fillStyle = p.color;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size, 0, Math.PI*2);
            fxCtx.fill();
        }
    });
    
    if (active) {
        animFrame = requestAnimationFrame(animateParticles);
    } else {
        fxCtx.clearRect(0, 0, el.fxCanvas.width, el.fxCanvas.height);
    }
}


// --- MONETIZATION & REWARDS ---

// Watch Ad Button
el.btnWatchAd.addEventListener('click', () => {
    el.btnWatchAd.disabled = true;
    el.btnWatchAd.innerText = "Watching Ad...";
    
    // Simulate watching an ad (e.g., 3 seconds)
    setTimeout(() => {
        state.hearts = Math.min(MAX_HEARTS, state.hearts + 3);
        saveState();
        updateUI();
        el.gameOverModal.style.display = 'none';
        
        el.btnWatchAd.innerText = "▶ Watch Ad for 3 ❤️";
        
        showFloatingText('+3 ❤️', window.innerWidth/2, window.innerHeight/2, 'positive');
        
        // Reset player pos and redraw
        playerPos = { x: 0, y: 0 };
        drawMaze();
    }, 3000);
});

// Rewards Menu Toggle
el.btnRewardsMenu.addEventListener('click', () => {
    el.rewardsModal.style.display = 'flex';
});

el.btnCloseRewards.addEventListener('click', () => {
    el.rewardsModal.style.display = 'none';
});

// Redeem Reward
el.btnRedeem.addEventListener('click', () => {
    if (state.points >= REWARD_THRESHOLD) {
        state.points -= REWARD_THRESHOLD;
        saveState();
        updateUI();
        
        alert("Reward Redeemed! (Simulated backend call)");
        // In a real app, you would handle the API request here
    }
});


// Init sequence
window.onload = () => {
    loadState();
    checkDailyBonuses();
    updateUI();
};
