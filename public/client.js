// public/client.js
const socket = io();

// join our ROOM
socket.emit('join-room', window.GAME_ROOM);

let hand = [];
let tableCards = [];
let dotPositions = [];
let hexPositions = [];
let squarePositions = [];
let opponentCount = 0; // track the other player's hand size

const cardBaseUrl = 'https://geremygeorge.com/cardosseum/';
const playArea    = document.getElementById('play-area');
const mainPile    = document.getElementById('draw-pile');
const specialPile = document.getElementById('draw-pile-2');

const CARD_WIDTH  = 70;
const CARD_HALF   = CARD_WIDTH / 2;
const PLAY_AREA_WIDTH   = 500;
const PLAY_AREA_HEIGHT  = 500;
const DOT_COUNT         = 10;
const DOT_SIZE          = 20;
const DOT_MARGIN        = 10;
const DOT_LEFT_OFFSET   = 10;
const DOT_RIGHT_OFFSET  = PLAY_AREA_WIDTH - DOT_SIZE - DOT_LEFT_OFFSET;
const HEX_PER_COLUMN    = 3;
const SQUARE_COUNT      = 12;
const SQUARE_MARGIN     = 10;

// listen for updated hand counts from server
socket.on('hand-counts', counts => {
  counts.forEach(c => {
    if (c.id !== socket.id) {
      opponentCount = c.count;
    }
  });
  updateOpponentDisplay();
});

function updateOpponentDisplay() {
  const el = document.getElementById('opponent-count');
  if (el) {
    el.textContent = `Opponent: ${opponentCount} cards`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // STARTUP OVERLAY
  const startupOverlay = document.getElementById('startup-overlay');
  const dismissBtn     = document.getElementById('startup-dismiss');
  function hideStartup() {
    startupOverlay.style.display = 'none';
  }
  dismissBtn.addEventListener('click', hideStartup);
  startupOverlay.addEventListener('click', e => {
    if (e.target === startupOverlay) hideStartup();
  });

  // DRAW & SHUFFLE
  mainPile.addEventListener('click', () => socket.emit('draw-card'));
  mainPile.addEventListener('contextmenu', e => {
    e.preventDefault();
    socket.emit('shuffle-main-deck');
  });
  specialPile.addEventListener('click', () => socket.emit('draw-special-card'));
  specialPile.addEventListener('contextmenu', e => {
    e.preventDefault();
    socket.emit('shuffle-special-deck');
  });

  // DROP HAND CARDS → play area
  playArea.addEventListener('dragover', e => e.preventDefault());
  playArea.addEventListener('drop', e => {
    e.preventDefault();
    // ignore drags coming from table cards
    if (e.dataTransfer.types.includes('application/json')) return;
    const r = playArea.getBoundingClientRect();
    const c = e.dataTransfer.getData('text/plain');
    if (c) {
      const x = e.clientX - r.left - CARD_HALF;
      const y = e.clientY - r.top  - CARD_HALF;
      playCard(c, x, y);
    }
  });

  // DROP TABLE CARDS → back into hand
  const handEl = document.getElementById('player1-hand');
  handEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  handEl.addEventListener('drop', e => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    const { from, index, card } = JSON.parse(data);
    if (from === 'table') {
      socket.emit('return-card-from-table-to-hand', { index, card });
    }
  });

  // Opponent count: centered just above bottom squares
  const oppEl = document.createElement('div');
  oppEl.id = 'opponent-count';
  Object.assign(oppEl.style, {
    position:   'absolute',
    // DOT_SIZE + SQUARE_MARGIN positions it right above the bottom row
    bottom:     `${DOT_SIZE + SQUARE_MARGIN + 5}px`,
    left:       '50%',
    transform:  'translateX(-50%)',
    color:      'white',
    fontSize:   '14px',
    background: 'rgba(0,0,0,0.5)',
    padding:    '2px 6px',
    borderRadius: '4px',
    zIndex:     '1001'
  });
  playArea.appendChild(oppEl);
  updateOpponentDisplay();
});

// SOCKET EVENTS
socket.on('room-full',    () => alert('Room is full'));
socket.on('your-hand',    cards => { hand = cards.slice(); renderHand(); });
socket.on('table-update', cards => { tableCards = cards.slice(); renderTable(); });
socket.on('dots-update',  pos   => { dotPositions = pos.slice(); renderTable(); });
socket.on('hexes-update', pos   => { hexPositions = pos.slice(); renderTable(); });
socket.on('squares-update', pos => { squarePositions = pos.slice(); renderTable(); });
socket.on('joined', num => {
  // num === 1 or 2 in this room
  if (num === 2) {
    const board    = document.getElementById('game-board');
    const handEl   = document.getElementById('player1-hand');
    const middleEl = document.getElementById('middle-area');
    board.removeChild(handEl);
    board.insertBefore(handEl, middleEl);
  }
});

function renderHand() {
  const hd = document.getElementById('player1-hand');
  hd.innerHTML = '';
  hand.forEach(c => {
    const img = document.createElement('img');
    img.src       = `${cardBaseUrl}${c}.png`;
    img.width     = CARD_WIDTH;
    img.draggable = true;
    img.style.cursor = 'grab';

    img.addEventListener('dragstart', e =>
      e.dataTransfer.setData('text/plain', c)
    );
    img.addEventListener('click', () =>
      showCardOverlay(img.src)
    );
    img.addEventListener('contextmenu', e => {
      e.preventDefault();
      socket.emit('return-card-from-hand', { card: c });
    });

    hd.appendChild(img);
  });
}

function renderTable() {
  playArea.innerHTML = '';

  // 1) Placed cards
  tableCards.forEach((e, i) => {
    const img = document.createElement('img');
    img.src        = `${cardBaseUrl}${e.card}.png`;
    img.className  = 'table-card';
    img.style.cssText = `
      position:absolute;
      left:${e.x}px;
      top:${e.y}px;
      width:${CARD_WIDTH}px;
      cursor:grab;
    `;

    // enable dragging back to hand
    img.draggable = true;
    img.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData(
        'application/json',
        JSON.stringify({ from: 'table', index: i, card: e.card })
      );
      ev.dataTransfer.effectAllowed = 'move';
    });

    // track whether this mouse session became a drag
    let isDragging = false;

    // a) Drag‑to‑move handler
    img.addEventListener('mousedown', dn => {
      dn.preventDefault();
      isDragging = false;
      const sX = dn.clientX, sY = dn.clientY;
      const oX = e.x, oY = e.y;

      function onMove(mv) {
        isDragging = true;
        img.style.left = `${oX + (mv.clientX - sX)}px`;
        img.style.top  = `${oY + (mv.clientY - sY)}px`;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        socket.emit('move-table-card', {
          index: i,
          x: parseInt(img.style.left,10),
          y: parseInt(img.style.top,10)
        });
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    // b) Click handler — only fire overlay if not dragged
    img.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!isDragging) {
        showCardOverlay(img.src);
      }
    });

    img.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      socket.emit('return-card-from-table', { index: i, card: e.card });
    });

    playArea.appendChild(img);
  });

  // 2) Red dots
  dotPositions.forEach((p, i) => {
    const dot = document.createElement('div');
    dot.className     = 'red-dot';
    dot.style.left    = `${p.x}px`;
    dot.style.top     = `${p.y}px`;
    dot.dataset.index = i;
    dot.addEventListener('mousedown', dn => {
      dn.preventDefault();
      const sX = dn.clientX, sY = dn.clientY;
      const oX = p.x, oY = p.y;
      function onDrag(mv) {
        dot.style.left = `${oX + (mv.clientX - sX)}px`;
        dot.style.top  = `${oY + (mv.clientY - sY)}px`;
      }
      function onDrop() {
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup',   onDrop);
        socket.emit('move-dot', {
          index: i,
          x: parseInt(dot.style.left,10),
          y: parseInt(dot.style.top,10)
        });
      }
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup',   onDrop);
    });
    playArea.appendChild(dot);
  });

  // 3) Hexagons
  hexPositions.forEach((h, i) => {
    const el = document.createElement('div');
    el.className   = 'hexagon';
    el.style.left  = `${h.x}px`;
    el.style.top   = `${h.y}px`;
    el.textContent = h.value;
    attachControlBehavior(el, i, 'hex', 1, 20);
    playArea.appendChild(el);
  });

  // 4) Squares
  squarePositions.forEach((s, i) => {
    const el = document.createElement('div');
    el.className   = 'square';
    el.style.left  = `${s.x}px`;
    el.style.top   = `${s.y}px`;
    el.textContent = s.value;
    attachControlBehavior(el, i, 'square', 1, 6);
    playArea.appendChild(el);
  });

  // 5) Help button
  const help = document.createElement('div');
  help.id = 'help-button';
  help.textContent = '?';
  help.addEventListener('click', () => {
    document.getElementById('startup-overlay').style.display = 'flex';
  });
  playArea.appendChild(help);
}

function attachControlBehavior(el, idx, type, min, max) {
  // Track if the user has moved the element during mouse down
  let isDragging = false;

  // 1) Drag‑to‑move
  el.addEventListener('mousedown', dn => {
    dn.preventDefault();
    isDragging = false;

    const sX = dn.clientX, sY = dn.clientY;
    const arr = type === 'hex' ? hexPositions : squarePositions;
    const oX  = arr[idx].x, oY = arr[idx].y;

    function onMove(mv) {
      isDragging = true;
      el.style.left = `${oX + (mv.clientX - sX)}px`;
      el.style.top  = `${oY + (mv.clientY - sY)}px`;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      socket.emit(`move-${type}`, {
        index: idx,
        x: parseInt(el.style.left,10),
        y: parseInt(el.style.top,10)
      });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // 2) Click → only open input if NOT dragging
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    if (!isDragging) {
      showInputOverlay(el.textContent, n => {
        socket.emit(`update-${type}`, { index: idx, value: n });
      }, min, max);
    }
  });

  // 3) Right‑click roll behavior
  const HOLD_DURATION_MS = 2000;
  el.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    el.textContent = '0';

    const label = document.createElement('div');
    label.textContent = '-0-';
    Object.assign(label.style, {
      position:      'absolute',
      color:         'green',
      fontSize:      '10px',
      fontWeight:    'bold',
      whiteSpace:    'nowrap',
      pointerEvents: 'none',
      zIndex:        '999'
    });

    const x = el.offsetLeft + el.offsetWidth / 2;
    const y = el.offsetTop  - 12;
    label.style.left      = `${x}px`;
    label.style.top       = `${y}px`;
    label.style.transform = 'translateX(-50%)';

    playArea.appendChild(label);

    setTimeout(() => {
      label.remove();
      el.textContent = result;
      socket.emit(`update-${type}`, {
        index: idx,
        value: result
      });
    }, HOLD_DURATION_MS);
  });
}

function showInputOverlay(initial, onCommit, min, max) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0, left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000
  });
  const input = document.createElement('input');
  input.type = 'number';
  input.min  = min;
  input.max  = max;
  input.value = initial;
  Object.assign(input.style, {
    fontSize: '24px',
    width: '80px',
    textAlign: 'center',
    padding: '8px',
    background: 'rgba(0,0,0,0.5)',
    color: 'white',
    border: 'none',
    outline: '2px solid #888'
  });
  overlay.appendChild(input);
  document.body.appendChild(overlay);
  input.focus();
  input.select();

  function commit() {
    let n = parseInt(input.value, 10);
    if (isNaN(n) || n < min || n > max) n = initial;
    onCommit(n);
    document.body.removeChild(overlay);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') document.body.removeChild(overlay);
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) commit();
  });
}

function showCardOverlay(src) {
  if (document.getElementById('card-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'card-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0, left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3000,
    cursor: 'pointer'
  });
  const img = document.createElement('img');
  img.src = src;
  img.style.maxWidth  = '300%';
  img.style.maxHeight = '300%';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => document.body.removeChild(overlay));
}

function playCard(card, x, y) {
  const i = hand.indexOf(card);
  if (i !== -1) {
    hand.splice(i, 1);
    renderHand();
  }
  socket.emit('play-card', { card, x, y });
}
