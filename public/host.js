// ==========================================================================
// 👨‍🏫 Teacher/Presentation Dashboard Client Javascript (host.js)
// ==========================================================================

// Global state
let socket;
let roomCode = '';
let roomData = null;
let activeQuestionIndex = 0;
let isFloating = true;

// Cards physics state
let activeCards = []; // Array of { id, element, x, y, vx, vy, width, height, angle, rotationSpeed }
let dragCard = null;  // Card currently being dragged
let dragStart = { x: 0, y: 0 };
let cardStart = { x: 0, y: 0 };
let lastDragPos = { x: 0, y: 0, time: 0 };
let dragVelocity = { x: 0, y: 0 };

// Particle engine state
let particleAnimationId = null;
let particles = [];

// DOM Elements
let boardContainer;
let boardCanvas;
let activeQuestionDisplay;
let roomPinDisplay;
let responseCountDisplay;
let emptyMsg;
let questionListContainer;
let newQuestionInput;
let controlPanel;
let zoomBackdrop;
let zoomContainer;
let particleCanvas;
let ctx;

// Dynamic Socket.io loader
function loadSocketIO(callback) {
  const isFileProtocol = window.location.protocol === 'file:';
  const serverUrl = isFileProtocol ? 'http://localhost:3000' : window.location.origin;

  if (typeof io === 'undefined') {
    console.log('Loading socket.io client from CDN...');
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    script.onload = () => {
      try {
        const socketInstance = io(serverUrl, {
          transports: ['websocket', 'polling']
        });
        callback(socketInstance);
      } catch (e) {
        console.error('Socket.io initialization error:', e);
      }
    };
    script.onerror = () => {
      alert('Socket.io 라이브러리를 로드할 수 없습니다. 인터넷 연결을 확인해 주세요.');
    };
    document.head.appendChild(script);
  } else {
    const socketInstance = io(serverUrl);
    callback(socketInstance);
  }
}

// 1. Initial Load & Setup
window.addEventListener('DOMContentLoaded', () => {
  // Parse room code from URL query parameter
  const params = new URLSearchParams(window.location.search);
  roomCode = params.get('room');

  if (!roomCode) {
    alert('참여할 방 코드가 없습니다. 메인 페이지로 이동합니다.');
    window.location.href = './index.html';
    return;
  }

  // Load DOM Cache
  boardContainer = document.getElementById('board-container');
  boardCanvas = document.getElementById('board-canvas');
  activeQuestionDisplay = document.getElementById('active-question-display');
  roomPinDisplay = document.getElementById('room-pin');
  responseCountDisplay = document.getElementById('response-count');
  emptyMsg = document.getElementById('empty-msg');
  questionListContainer = document.getElementById('question-list-container');
  newQuestionInput = document.getElementById('new-question-input');
  controlPanel = document.getElementById('control-panel');
  zoomBackdrop = document.getElementById('zoom-backdrop');
  zoomContainer = document.getElementById('zoom-container');
  particleCanvas = document.getElementById('particle-canvas');
  ctx = particleCanvas.getContext('2d');

  roomPinDisplay.textContent = roomCode;
  
  // Set current page URL in control panel instruction
  document.getElementById('join-url-text').textContent = `${window.location.protocol}//${window.location.host}`;

  // Resize canvas handler
  window.addEventListener('resize', handleWindowResize);
  handleWindowResize();

  // Initialize Socket.io connection dynamically
  loadSocketIO((socketInstance) => {
    socket = socketInstance;

    // Listen to Server Sockets
    setupSocketListeners();
  });

  // Start physics loop for floating cards
  requestAnimationFrame(physicsLoop);
});

// Window resizing
function handleWindowResize() {
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
  
  // Reposition floating cards inside new boundaries if resized
  if (boardCanvas && activeCards.length > 0) {
    const canvasWidth = boardCanvas.clientWidth;
    const canvasHeight = boardCanvas.clientHeight;
    
    activeCards.forEach(card => {
      // Clamp coordinates to fit in new dimensions
      if (card.x + card.width > canvasWidth) card.x = canvasWidth - card.width - 20;
      if (card.y + card.height > canvasHeight) card.y = canvasHeight - card.height - 20;
      if (card.x < 10) card.x = 10;
      if (card.y < 10) card.y = 10;
    });
  }
}

// 2. Socket.io Event Handling
function setupSocketListeners() {
  socket.on('connect', () => {
    console.log('Connected to server.');
    
    // Join room as Host
    socket.emit('join-room', { roomCode, isHost: true }, (res) => {
      if (res.success) {
        console.log('Successfully joined room:', roomCode);
        roomData = res.room;
        activeQuestionIndex = roomData.activeQuestionIndex;
        
        // Sync display theme from database
        if (roomData.theme) {
          changeBoardTheme(roomData.theme, false); // change class, don't emit
        }
        
        // Populate existing Google Sheet URL if set
        if (roomData.sheetUrl) {
          const sheetInput = document.getElementById('sheet-url-input');
          if (sheetInput) {
            sheetInput.value = roomData.sheetUrl;
          }
        }
        
        // Render state
        renderActiveQuestion();
        renderQuestionList();
        renderResponses();
      } else {
        alert(res.error || '방 세션 연결에 실패했습니다.');
        window.location.href = './index.html';
      }
    });
  });

  // Listen for real-time incoming student responses
  socket.on('new-response', ({ questionIndex, response }) => {
    if (!roomData) return;
    
    // Update local database
    roomData.questions[questionIndex].responses.push(response);
    
    // If it's for the currently active question, spawn card with animation
    if (questionIndex === activeQuestionIndex) {
      spawnCard(response);
      updateResponseCount();
    }
  });

  // Listen for synced position updates from another host instance (optional)
  socket.on('response-position-synced', ({ questionIndex, responseId, x, y }) => {
    if (questionIndex === activeQuestionIndex) {
      const card = activeCards.find(c => c.id === responseId);
      if (card && card !== dragCard) {
        const canvasWidth = boardCanvas.clientWidth;
        const canvasHeight = boardCanvas.clientHeight;
        card.x = (x / 100) * canvasWidth;
        card.y = (y / 100) * canvasHeight;
      }
    }
  });

  // Listen for deleted cards
  socket.on('response-deleted', ({ questionIndex, responseId }) => {
    if (!roomData) return;
    
    // Update local database
    const question = roomData.questions[questionIndex];
    if (question) {
      question.responses = question.responses.filter(r => r.id !== responseId);
    }
    
    // If active, animate card removal
    if (questionIndex === activeQuestionIndex) {
      removeCardFromBoard(responseId);
      updateResponseCount();
    }
  });

  // Listen for question list updates
  socket.on('questions-updated', (questions) => {
    if (!roomData) return;
    roomData.questions = questions;
    renderQuestionList();
  });

  socket.on('disconnect', () => {
    console.warn('Disconnected from server.');
  });
}

// 3. UI Renders

function renderActiveQuestion() {
  if (!roomData) return;
  const currentQ = roomData.questions[activeQuestionIndex];
  if (currentQ) {
    activeQuestionDisplay.textContent = currentQ.text;
  }
}

function updateResponseCount() {
  if (!roomData) return;
  const currentQ = roomData.questions[activeQuestionIndex];
  if (currentQ) {
    responseCountDisplay.textContent = currentQ.responses.length;
  }
}

// Render questions inside host sidebar control panel
function renderQuestionList() {
  if (!roomData) return;
  questionListContainer.innerHTML = '';
  
  roomData.questions.forEach((q, idx) => {
    const li = document.createElement('li');
    li.className = `question-item ${idx === activeQuestionIndex ? 'active' : ''}`;
    
    // Add truncated text
    const textSpan = document.createElement('span');
    textSpan.textContent = `${idx + 1}. ${q.text}`;
    li.appendChild(textSpan);
    
    // Click triggers question selection
    li.addEventListener('click', () => {
      if (idx !== activeQuestionIndex) {
        activateQuestion(idx);
      }
    });

    questionListContainer.appendChild(li);
  });
}

// Set newly active question (Teacher action)
function activateQuestion(index) {
  activeQuestionIndex = index;
  renderActiveQuestion();
  renderQuestionList();
  
  // Notify backend to push question change to students
  socket.emit('set-active-question', index);

  // Re-render responses with fly-in
  renderResponses();
}

// Render all responses for the active question onto the board canvas
function renderResponses() {
  if (!roomData) return;

  // Clear existing cards
  activeCards.forEach(c => c.element.remove());
  activeCards = [];
  
  const currentQ = roomData.questions[activeQuestionIndex];
  updateResponseCount();

  if (!currentQ || currentQ.responses.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  
  emptyMsg.classList.add('hidden');
  
  // Render cards
  currentQ.responses.forEach(resp => {
    spawnCard(resp, false); // spawn without flashing entrance trigger
  });
}

// 4. Card Creation & Physics

// Spawn individual card element
function spawnCard(resp, isNew = true) {
  emptyMsg.classList.add('hidden');

  const cardEl = document.createElement('div');
  cardEl.id = `card-${resp.id}`;
  cardEl.className = `rolling-card card-${resp.theme}`;
  
  // Font styling
  if (resp.font === 'Nanum Pen Script') cardEl.classList.add('font-handwriting');
  else if (resp.font === 'Gamja Flower') cardEl.classList.add('font-cute');
  else if (resp.font === 'Jua') cardEl.classList.add('font-round');
  else cardEl.classList.add('font-gothic');

  // Tape effect for postits
  if (resp.theme === 'postit') {
    const tape = document.createElement('div');
    tape.className = 'tape-effect';
    cardEl.appendChild(tape);
  }

  // Background and color styling
  if (resp.theme === 'neon') {
    cardEl.style.setProperty('--neon-border', resp.color);
    cardEl.style.setProperty('--neon-shadow', `${resp.color}66`);
  } else if (resp.theme === 'chalkboard') {
    cardEl.style.color = resp.color;
  } else if (resp.theme === 'balloon') {
    cardEl.style.backgroundColor = resp.color;
    cardEl.style.setProperty('color', resp.color); // triangle arrow color
  } else {
    cardEl.style.backgroundColor = resp.color;
  }

  // Delete Card Button (Host control)
  const delBtn = document.createElement('button');
  delBtn.className = 'card-delete-btn';
  delBtn.innerHTML = '✕';
  delBtn.title = '이 답변 카드 삭제';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent zoom modal
    deleteResponse(resp.id);
  });
  cardEl.appendChild(delBtn);

  // Card stickers
  const stickersDiv = document.createElement('div');
  stickersDiv.className = 'card-stickers';
  (resp.stickers || []).forEach(st => {
    const sEl = document.createElement('span');
    sEl.className = 'placed-sticker';
    sEl.textContent = st.emoji;
    sEl.style.left = `${st.x}%`;
    sEl.style.top = `${st.y}%`;
    sEl.style.setProperty('--rot', `${st.rot}deg`);
    stickersDiv.appendChild(sEl);
  });
  cardEl.appendChild(stickersDiv);

  // Message body
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'card-body';
  const textEl = document.createElement('p');
  textEl.className = 'card-text';
  textEl.textContent = resp.content;
  bodyDiv.appendChild(textEl);
  cardEl.appendChild(bodyDiv);

  // Footer nickname
  const footerDiv = document.createElement('div');
  footerDiv.className = 'card-footer';
  const authorEl = document.createElement('span');
  authorEl.className = 'card-author';
  authorEl.textContent = `From. ${resp.nickname}`;
  footerDiv.appendChild(authorEl);
  cardEl.appendChild(footerDiv);

  // Append card to board DOM
  boardCanvas.appendChild(cardEl);

  // Retrieve widths and heights after DOM append
  const width = cardEl.offsetWidth || 250;
  const height = cardEl.offsetHeight || 250;
  
  // Calculate pixel coordinates
  const canvasWidth = boardCanvas.clientWidth;
  const canvasHeight = boardCanvas.clientHeight;
  
  let posX = (resp.x / 100) * canvasWidth;
  let posY = (resp.y / 100) * canvasHeight;

  // Make sure it doesn't overflow bounds initially
  if (posX + width > canvasWidth) posX = canvasWidth - width - 20;
  if (posY + height > canvasHeight) posY = canvasHeight - height - 20;
  if (posX < 10) posX = 10;
  if (posY < 10) posY = 10;

  // Apply initial position
  cardEl.style.left = `${posX}px`;
  cardEl.style.top = `${posY}px`;
  
  // Random micro rotation initially
  const randomRot = Math.random() * 8 - 4; // -4 to 4 degrees
  cardEl.style.transform = `rotate(${randomRot}deg)`;

  // If is new incoming card, apply fly-in animation
  if (isNew) {
    cardEl.style.transform = 'scale(0.1) rotate(45deg)';
    cardEl.style.opacity = '0';
    cardEl.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    // Trigger transition
    setTimeout(() => {
      cardEl.style.transform = `scale(1) rotate(${randomRot}deg)`;
      cardEl.style.opacity = '1';
      // Reset transition after animation so it drags instantly
      setTimeout(() => {
        cardEl.style.transition = '';
      }, 600);
    }, 50);
  }

  // Push to physics arrays
  const cardPhysics = {
    id: resp.id,
    element: cardEl,
    x: posX,
    y: posY,
    vx: (Math.random() - 0.5) * 0.35, // floating speeds
    vy: (Math.random() - 0.5) * 0.35,
    width: width,
    height: height,
    angle: randomRot,
    rotationSpeed: (Math.random() - 0.5) * 0.05
  };
  
  activeCards.push(cardPhysics);

  // Setup drag event listeners
  setupDragListeners(cardPhysics);
}

// Animate card deletion
function removeCardFromBoard(responseId) {
  const index = activeCards.findIndex(c => c.id === responseId);
  if (index !== -1) {
    const card = activeCards[index];
    card.element.style.transition = 'all 0.4s ease-in-out';
    card.element.style.transform = 'scale(0.1) rotate(-20deg)';
    card.element.style.opacity = '0';
    
    setTimeout(() => {
      card.element.remove();
      activeCards.splice(index, 1);
      
      // If board is empty, show prompt
      if (activeCards.length === 0) {
        emptyMsg.classList.remove('hidden');
      }
    }, 400);
  }
}

// Setup dragging event listeners for individual cards
function setupDragListeners(card) {
  const el = card.element;

  // Primary event listener on card elements
  const startDrag = (e) => {
    // Left-click or touch only
    if (e.type === 'mousedown' && e.button !== 0) return;
    
    // Ignore clicks on delete button
    if (e.target.classList.contains('card-delete-btn')) return;

    dragCard = card;
    el.classList.add('dragging');
    
    // Get mouse/touch coordinate
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

    dragStart.x = clientX;
    dragStart.y = clientY;

    cardStart.x = card.x;
    cardStart.y = card.y;

    // Tracker for throws (velocities)
    lastDragPos.x = card.x;
    lastDragPos.y = card.y;
    lastDragPos.time = performance.now();
    dragVelocity.x = 0;
    dragVelocity.y = 0;

    // Add global tracking handlers
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
    
    e.preventDefault();
  };

  el.addEventListener('mousedown', startDrag);
  el.addEventListener('touchstart', startDrag, { passive: false });

  // Move Handler
  function moveDrag(e) {
    if (!dragCard) return;

    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

    const dx = clientX - dragStart.x;
    const dy = clientY - dragStart.y;

    let targetX = cardStart.x + dx;
    let targetY = cardStart.y + dy;

    // Check Boundaries of board canvas
    const canvasWidth = boardCanvas.clientWidth;
    const canvasHeight = boardCanvas.clientHeight;

    if (targetX < 10) targetX = 10;
    if (targetX + dragCard.width > canvasWidth - 10) targetX = canvasWidth - dragCard.width - 10;
    if (targetY < 10) targetY = 10;
    if (targetY + dragCard.height > canvasHeight - 10) targetY = canvasHeight - dragCard.height - 10;

    dragCard.x = targetX;
    dragCard.y = targetY;

    // Update DOM immediately
    dragCard.element.style.left = `${targetX}px`;
    dragCard.element.style.top = `${targetY}px`;

    // Track move coordinates to calculate push inertia velocity
    const now = performance.now();
    const dt = now - lastDragPos.time;
    if (dt > 10) {
      dragVelocity.x = (targetX - lastDragPos.x) / dt * 15; // scalar multiplier
      dragVelocity.y = (targetY - lastDragPos.y) / dt * 15;
      
      // Clamp velocity
      const maxVel = 8;
      dragVelocity.x = Math.max(-maxVel, Math.min(maxVel, dragVelocity.x));
      dragVelocity.y = Math.max(-maxVel, Math.min(maxVel, dragVelocity.y));

      lastDragPos.x = targetX;
      lastDragPos.y = targetY;
      lastDragPos.time = now;
    }

    if (e.type === 'touchmove') e.preventDefault();
  }

  // End Handler
  function endDrag(e) {
    if (!dragCard) return;

    const currentDragCard = dragCard;
    const el = currentDragCard.element;
    
    el.classList.remove('dragging');

    // Remove event listeners
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', moveDrag);
    document.removeEventListener('touchend', endDrag);

    dragCard = null;

    // Give it the throw velocity inertia
    currentDragCard.vx = dragVelocity.x;
    currentDragCard.vy = dragVelocity.y;

    // Check if it was a simple click (not dragged much) to trigger highlight modal
    const clientX = e.type === 'touchend' ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.type === 'touchend' ? e.changedTouches[0].clientY : e.clientY;
    const dragDistance = Math.sqrt(Math.pow(clientX - dragStart.x, 2) + Math.pow(clientY - dragStart.y, 2));

    if (dragDistance < 5) {
      // It was a click! Show Zoom Modal
      triggerHighlight(currentDragCard);
    } else {
      // Drag completed: Save coordinates to backend (convert to percentages)
      const canvasWidth = boardCanvas.clientWidth;
      const canvasHeight = boardCanvas.clientHeight;
      const pctX = (currentDragCard.x / canvasWidth) * 100;
      const pctY = (currentDragCard.y / canvasHeight) * 100;
      
      socket.emit('update-response-position', {
        questionIndex: activeQuestionIndex,
        responseId: currentDragCard.id,
        x: Math.round(pctX),
        y: Math.round(pctY)
      });
    }
  }
}

// 5. Zero-Gravity Physics Update Loop
function physicsLoop(timestamp) {
  if (isFloating) {
    const canvasWidth = boardCanvas.clientWidth;
    const canvasHeight = boardCanvas.clientHeight;

    activeCards.forEach(card => {
      // Skip updates if card is currently being dragged
      if (card === dragCard) return;

      // Update positions
      card.x += card.vx;
      card.y += card.vy;

      // Apply friction drag so cards don't float at crazy speeds forever
      card.vx *= 0.992;
      card.vy *= 0.992;

      // Add small micro constant float force if velocity gets too low
      const minForce = 0.05;
      const speed = Math.sqrt(card.vx * card.vx + card.vy * card.vy);
      if (speed < minForce) {
        // Gently push in random direction
        const angle = Math.random() * Math.PI * 2;
        card.vx += Math.cos(angle) * 0.01;
        card.vy += Math.sin(angle) * 0.01;
      }

      // Check Canvas edge collisions (bounce)
      // Left and Right bounds
      if (card.x <= 10) {
        card.x = 10;
        card.vx = Math.abs(card.vx) * 0.8; // reverse and lose energy
      } else if (card.x + card.width >= canvasWidth - 10) {
        card.x = canvasWidth - card.width - 10;
        card.vx = -Math.abs(card.vx) * 0.8;
      }

      // Top and Bottom bounds
      if (card.y <= 10) {
        card.y = 10;
        card.vy = Math.abs(card.vy) * 0.8;
      } else if (card.y + card.height >= canvasHeight - 10) {
        card.y = canvasHeight - card.height - 10;
        card.vy = -Math.abs(card.vy) * 0.8;
      }

      // Slowly update sway rotations
      card.angle += card.rotationSpeed;
      if (card.angle > 12) {
        card.angle = 12;
        card.rotationSpeed = -Math.abs(card.rotationSpeed);
      } else if (card.angle < -12) {
        card.angle = -12;
        card.rotationSpeed = Math.abs(card.rotationSpeed);
      }

      // Render positions and sways
      card.element.style.left = `${card.x}px`;
      card.element.style.top = `${card.y}px`;
      card.element.style.transform = `rotate(${card.angle}deg)`;
    });
  }

  // Next frame
  requestAnimationFrame(physicsLoop);
}

// 6. Highlight Zoom Modal & Canvas Confetti Engine

function triggerHighlight(card) {
  // Clear zoom modal container
  zoomContainer.innerHTML = '';
  
  // Clone element, remove delete button inside cloned node
  const clone = card.element.cloneNode(true);
  const delBtn = clone.querySelector('.card-delete-btn');
  if (delBtn) delBtn.remove();
  
  // Reset placement style attributes so it fits in modal flex container
  clone.style.left = 'auto';
  clone.style.top = 'auto';
  clone.style.position = 'relative';
  
  // Append clone
  zoomContainer.appendChild(clone);
  
  // Display modal
  zoomBackdrop.classList.remove('hidden');

  // Trigger fireworks particle burst
  createExplosion();
}

function closeZoomModal(event) {
  // Close if clicked backdrop (not the zoomed card itself)
  if (event.target === zoomBackdrop || event.target.id === 'particle-canvas' || event.target.classList.contains('zoom-close-hint')) {
    zoomBackdrop.classList.add('hidden');
    
    // Stop particle animation
    if (particleAnimationId) {
      cancelAnimationFrame(particleAnimationId);
      particleAnimationId = null;
    }
    particles = [];
  }
}

// Particle constructor
class ConfettiParticle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 12 + 6;
    
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed - 4; // slight upward push bias
    
    this.size = Math.random() * 8 + 6;
    this.color = `hsl(${Math.random() * 360}, 90%, 60%)`;
    this.gravity = 0.25;
    this.friction = 0.96;
    this.alpha = 1;
    this.decay = Math.random() * 0.015 + 0.01;
    this.shape = Math.random() > 0.5 ? 'circle' : 'square';
    this.rotation = Math.random() * 360;
    this.rotationSpeed = (Math.random() - 0.5) * 10;
  }

  update() {
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy += this.gravity;
    
    this.x += this.vx;
    this.y += this.vy;
    
    this.rotation += this.rotationSpeed;
    this.alpha -= this.decay;
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.fillStyle = this.color;

    if (this.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    }
    ctx.restore();
  }
}

// Trigger particles explosion at the center of modal
function createExplosion() {
  particles = [];
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  // Add 120 particles
  for (let i = 0; i < 120; i++) {
    particles.push(new ConfettiParticle(centerX, centerY));
  }

  // Start draw loop
  if (particleAnimationId) cancelAnimationFrame(particleAnimationId);
  particleAnimationId = requestAnimationFrame(updateParticles);
}

function updateParticles() {
  ctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

  particles.forEach((p, idx) => {
    p.update();
    p.draw();

    // Remove faded particles
    if (p.alpha <= 0) {
      particles.splice(idx, 1);
    }
  });

  if (particles.length > 0) {
    particleAnimationId = requestAnimationFrame(updateParticles);
  }
}

// 7. Theme Controls

function changeBoardTheme(themeName, emit = true) {
  // Clear themes on body
  document.body.className = 'host-body';
  document.body.classList.add(`theme-${themeName}`);

  // Update Toolbar selection state
  document.querySelectorAll('.theme-select-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`theme-btn-${themeName}`).classList.add('active');

  // Trigger redraw size mappings if widths might have shifted due to chalkboard wooden frame border differences
  setTimeout(handleWindowResize, 100);

  if (emit) {
    // Notify server to save board background setting in DB
    socket.emit('update-room-theme', themeName);
  }
}

// 8. Control Toolbar Actions

function toggleFloating() {
  isFloating = !isFloating;
  const btn = document.getElementById('float-toggle-btn');
  if (isFloating) {
    btn.textContent = '⏸️ 움직임 멈춤';
  } else {
    btn.textContent = '▶️ 움직임 시작';
    // reset velocities so they stop drifting
    activeCards.forEach(c => {
      c.vx = 0;
      c.vy = 0;
    });
  }
}

// Scatter all cards inside current viewport dimensions randomly
function reScatterCards() {
  const canvasWidth = boardCanvas.clientWidth;
  const canvasHeight = boardCanvas.clientHeight;

  activeCards.forEach(card => {
    // Random position (with borders offset)
    let rx = Math.floor(Math.random() * (canvasWidth - card.width - 40)) + 20;
    let ry = Math.floor(Math.random() * (canvasHeight - card.height - 40)) + 20;

    // Clamp coordinates
    card.x = Math.max(10, Math.min(canvasWidth - card.width - 10, rx));
    card.y = Math.max(10, Math.min(canvasHeight - card.height - 10, ry));

    // Reset speeds
    card.vx = (Math.random() - 0.5) * 0.4;
    card.vy = (Math.random() - 0.5) * 0.4;

    // Apply immediate styles
    card.element.style.transition = 'all 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
    card.element.style.left = `${card.x}px`;
    card.element.style.top = `${card.y}px`;
    
    // Clear transition so dragging is snappy
    setTimeout(() => {
      card.element.style.transition = '';
    }, 600);
  });
}

// 9. Side Drawer Control Panel Actions

function toggleControlPanel() {
  controlPanel.classList.toggle('closed');
}

// Add custom new question inside sidebar form
function addNewQuestion(event) {
  event.preventDefault();
  const text = newQuestionInput.value.trim();
  if (!text) return;

  socket.emit('add-question', text, (res) => {
    if (res.success) {
      newQuestionInput.value = '';
      
      // Auto activate the new question!
      const newIndex = res.questions.length - 1;
      activateQuestion(newIndex);
    } else {
      alert(res.error || '질문 등록에 실패했습니다.');
    }
  });
}

// Teacher deletes a specific response (Host card control)
function deleteResponse(responseId) {
  if (confirm('이 답변 카드를 정말로 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다.)')) {
    socket.emit('delete-response', {
      questionIndex: activeQuestionIndex,
      responseId: responseId
    }, (res) => {
      if (!res.success) {
        alert(res.error || '삭제 실패');
      }
    });
  }
}

// Delete all responses for the currently active question (Teacher action)
function confirmClearBoard() {
  const currentQ = roomData.questions[activeQuestionIndex];
  if (!currentQ || currentQ.responses.length === 0) {
    alert('삭제할 답변이 없습니다.');
    return;
  }

  if (confirm(`이 질문의 모든 답변(${currentQ.responses.length}개)을 정말로 삭제하시겠습니까? \n(이 작업은 복구되지 않습니다.)`)) {
    // Loop through current responses and delete them
    const deletePromises = currentQ.responses.map(resp => {
      return new Promise((resolve) => {
        socket.emit('delete-response', {
          questionIndex: activeQuestionIndex,
          responseId: resp.id
        }, () => resolve());
      });
    });
    
    Promise.all(deletePromises).then(() => {
      console.log('Cleared all responses on board.');
    });
  }
}

// Google Sheets Google Apps Script Integration
const APPS_SCRIPT_TEMPLATE = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  
  // 첫 데이터 저장 시 헤더 행(제목)을 자동 생성합니다
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["기록일시", "방 코드", "질문 내용", "닉네임", "답변 메시지", "선택 테마"]);
  }
  
  // 데이터 기록
  sheet.appendRow([
    new Date(),
    data.roomCode,
    data.question,
    data.nickname,
    data.content,
    data.theme
  ]);
  
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

function copyAppsScriptCode() {
  navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE).then(() => {
    alert('구글 앱스 스크립트 코드가 복사되었습니다! 🎉\\n\\n[구글 스프레드시트 적용 방법]\\n1. 구글 스프레드시트를 열고 상단 메뉴의 [확장 프로그램] -> [Apps Script]를 클릭합니다.\\n2. 기존 편집창에 쓰인 모든 코드를 지우고, 복사한 코드를 붙여넣습니다.\\n3. 상단 [배포] -> [새 배포] 버튼을 누릅니다.\\n4. 유형은 [웹 앱]으로 설정하고, 액세스 권한은 반드시 [모든 사용자(Anyone)]로 선택해 배포합니다.\\n5. 배포 완료 후 제공되는 "웹 앱 URL"을 복사하여 아래 입력창에 넣고 [연결]을 눌러주세요.');
  }).catch(err => {
    console.error('클립보드 복사 실패:', err);
    alert('클립보드 복사에 실패했습니다. 관리자 안내 코드를 수동으로 복사해서 사용해 주세요.');
  });
}

function saveSheetUrl() {
  const sheetUrl = document.getElementById('sheet-url-input').value.trim();
  
  if (!socket || !socket.connected) {
    alert('서버와 실시간 연결이 활성화되어 있지 않습니다. 서버가 실행 중인지 확인하세요.');
    return;
  }

  socket.emit('update-sheet-url', sheetUrl, (res) => {
    if (res.success) {
      if (sheetUrl) {
        alert('구글 스프레드시트 연동 URL이 성공적으로 저장되었습니다! 📊\\n이제 학생들이 보내는 답변이 구글 시트에 실시간으로 기록됩니다.');
      } else {
        alert('구글 스프레드시트 연동이 해제되었습니다.');
      }
    } else {
      alert(res.error || '연동 URL 저장에 실패했습니다.');
    }
  });
}
