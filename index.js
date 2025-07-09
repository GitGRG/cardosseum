// index.js (Server-side)
const express = require('express');
const app     = express();
const http    = require('http').createServer(app);
const io      = require('socket.io')(http);

app.use(express.static('public'));

let players = [];
let hands   = {};
let table   = [];

// shuffle helper
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// build decks
function createMainDeck() {
  const d = [];
  for (let i = 1; i <= 44; i++) d.push(i.toString().padStart(2,'0'));
  return shuffle(d);
}
function createSpecialDeck() {
  const d = [];
  for (let i = 1; i <= 10; i++) d.push(`glads/${i.toString().padStart(2,'0')}`);
  return shuffle(d);
}
let deck        = createMainDeck();
let specialDeck = createSpecialDeck();

// layout
const WIDTH            = 500;
const HEIGHT           = 500;
const DOT_COUNT        = 10;
const DOT_SIZE         = 20;
const DOT_MARGIN       = 10;
const DOT_LEFT_OFFSET  = 10;
const DOT_RIGHT_OFFSET = WIDTH - DOT_SIZE - DOT_LEFT_OFFSET;
const HEX_COUNT        = 3;
const SQUARE_COUNT     = 12;
const SQUARE_MARGIN    = 10;

// shared state
let dotPositions    = [];
let hexPositions    = [];
let squarePositions = [];

// init dots
(function(){
  const totalH = DOT_COUNT*DOT_SIZE + (DOT_COUNT-1)*DOT_MARGIN;
  const startY = (HEIGHT-totalH)/2;
  for (let i=0;i<DOT_COUNT;i++) dotPositions.push({x:DOT_LEFT_OFFSET,  y:startY+i*(DOT_SIZE+DOT_MARGIN)});
  for (let i=0;i<DOT_COUNT;i++) dotPositions.push({x:DOT_RIGHT_OFFSET, y:startY+i*(DOT_SIZE+DOT_MARGIN)});
})();

// init hexes
(function(){
  const totalH = DOT_COUNT*DOT_SIZE + (DOT_COUNT-1)*DOT_MARGIN;
  const startY = (HEIGHT-totalH)/2;
  const hexY   = startY - DOT_MARGIN - DOT_SIZE;
  for (let i=0;i<HEX_COUNT;i++) hexPositions.push({x:DOT_LEFT_OFFSET,  y:hexY - i*(DOT_SIZE+DOT_MARGIN), value:20});
  for (let i=0;i<HEX_COUNT;i++) hexPositions.push({x:DOT_RIGHT_OFFSET, y:hexY - i*(DOT_SIZE+DOT_MARGIN), value:20});
})();

// init squares (top & bottom rows)
(function(){
  const totalW = SQUARE_COUNT*DOT_SIZE + (SQUARE_COUNT-1)*SQUARE_MARGIN;
  const startX = (WIDTH-totalW)/2;
  const topY   = DOT_MARGIN;
  const botY   = HEIGHT - DOT_MARGIN - DOT_SIZE;
  for (let i=0;i<SQUARE_COUNT;i++) {
    squarePositions.push({ x:startX + i*(DOT_SIZE+SQUARE_MARGIN), y:topY, value:6 });
  }
  for (let i=0;i<SQUARE_COUNT;i++) {
    squarePositions.push({ x:startX + i*(DOT_SIZE+SQUARE_MARGIN), y:botY, value:6 });
  }
})();

io.on('connection', socket => {
  if (players.length < 2) {
    players.push(socket.id);
    hands[socket.id] = [];
  } else {
    socket.emit('room-full');
    return;
  }

  // initial sync
  socket.emit('player-number', players.length);
  socket.emit('table-update',   table);
  socket.emit('dots-update',    dotPositions);
  socket.emit('hexes-update',   hexPositions);
  socket.emit('squares-update', squarePositions);

  // draw/shuffle
  socket.on('draw-card',         () => { if(deck.length){const c=deck.pop(); hands[socket.id].push(c); socket.emit('your-hand', hands[socket.id]); }});
  socket.on('draw-special-card', () => { if(specialDeck.length){const c=specialDeck.pop(); hands[socket.id].push(c); socket.emit('your-hand', hands[socket.id]); }});
  socket.on('shuffle-main-deck',    () => deck = shuffle(deck));
  socket.on('shuffle-special-deck', () => specialDeck = shuffle(specialDeck));

  // play & move cards
  socket.on('play-card',       ({card,x,y}) => {
    const i = hands[socket.id].indexOf(card);
    if(i!==-1){ hands[socket.id].splice(i,1); socket.emit('your-hand', hands[socket.id]); }
    table.push({card,x,y}); io.emit('table-update', table);
  });
  socket.on('move-table-card', ({index,x,y}) => {
    if(table[index]){ table[index].x=x; table[index].y=y; io.emit('table-update', table); }
  });

  // return card from hand
  socket.on('return-card-from-hand', ({card}) => {
    const h = hands[socket.id];
    const idx = h.indexOf(card);
    if(idx!==-1){
      h.splice(idx,1);
      socket.emit('your-hand',h);
      if(card.startsWith('glads/')){
        specialDeck.push(card);
        specialDeck = shuffle(specialDeck);
      } else {
        deck.push(card);
        deck = shuffle(deck);
      }
    }
  });

  // return card from table
  socket.on('return-card-from-table', ({index,card}) => {
    if(table[index] && table[index].card===card){
      table.splice(index,1);
      io.emit('table-update', table);
      if(card.startsWith('glads/')){
        specialDeck.push(card);
        specialDeck = shuffle(specialDeck);
      } else {
        deck.push(card);
        deck = shuffle(deck);
      }
    }
  });

  // dot sync
  socket.on('move-dot', ({index,x,y}) => {
    if(dotPositions[index]){
      dotPositions[index] = { x, y };
      io.emit('dots-update', dotPositions);
    }
  });

  // hex sync
  socket.on('move-hex',    ({index,x,y}) => {
    if(hexPositions[index]){
      hexPositions[index].x=x; hexPositions[index].y=y;
      io.emit('hexes-update', hexPositions);
    }
  });
  socket.on('update-hex',  ({index,value}) => {
    if(hexPositions[index]){
      hexPositions[index].value=value;
      io.emit('hexes-update', hexPositions);
    }
  });

  // square sync
  socket.on('move-square',   ({index,x,y}) => {
    if(squarePositions[index]){
      squarePositions[index].x=x; squarePositions[index].y=y;
      io.emit('squares-update', squarePositions);
    }
  });
  socket.on('update-square', ({index,value}) => {
    if(squarePositions[index]){
      squarePositions[index].value=value;
      io.emit('squares-update', squarePositions);
    }
  });

  socket.on('disconnect', () => {
    players = players.filter(id => id!==socket.id);
    delete hands[socket.id];
  });
});

http.listen(3000, () => console.log('Server listening on port 3000'));
