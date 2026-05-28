// ==========================================================================
// 👥 Student Client Javascript Logic (app.js)
// ==========================================================================

// Global state
let socket;
let roomCode = '';
let nickname = '익명';
let activeQuestionIndex = 0;

let selectedTheme = 'postit';
let selectedColor = '#fff9c4'; // Default post-it pastel yellow
let selectedFont = 'Nanum Pen Script';
let stickers = [];

// Color Palettes by Theme
const COLOR_PALETTES = {
  postit: [
    '#fff9c4', // Pastel Yellow
    '#ffcfdf', // Pastel Pink
    '#cbf0f8', // Pastel Blue
    '#d6ffd2', // Pastel Mint
    '#e2d5ff', // Pastel Lavender
    '#ffd8b3'  // Pastel Orange
  ],
  chalkboard: [
    '#ffffff', // Chalk White
    '#ffeb3b', // Chalk Yellow
    '#ff4081', // Chalk Pink
    '#00e676', // Chalk Green
    '#00b0ff'  // Chalk Blue
  ],
  balloon: [
    '#ffe3e3', // Soft Rose
    '#e8f5e9', // Soft Mint
    '#e3f2fd', // Soft Sky
    '#fbf9db', // Soft Lemon
    '#f3e5f5'  // Soft Lavender
  ],
  notebook: [
    '#ffffff', // Clean White
    '#faf6e8', // Parchment Yellow
    '#f1f5f9', // Clean Grey
    '#eef2ff'  // Light Indigo Tint
  ],
  neon: [
    '#00f2fe', // Cyber Cyan
    '#ff007f', // Hot Pink
    '#39ff14', // Neon Green
    '#fff01f', // Neon Yellow
    '#bd00ff'  // Electric Purple
  ]
};

// Elements
const stepNickname = document.getElementById('step-nickname');
const stepEditor = document.getElementById('step-editor');
const stepSuccess = document.getElementById('step-success');

const nicknameInput = document.getElementById('nickname-input');
const messageInput = document.getElementById('message-input');
const roomCodeBadge = document.getElementById('room-code-badge');
const activeQuestionText = document.getElementById('active-question-text');

const cardPreview = document.getElementById('card-preview');
const previewContent = document.getElementById('preview-content');
const previewNickname = document.getElementById('preview-nickname');
const previewStickersContainer = document.getElementById('preview-stickers');
const colorPaletteContainer = document.getElementById('color-palette');
const currentCharCount = document.getElementById('current-char-count');

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

  roomCodeBadge.textContent = roomCode;

  // Initialize Socket.io dynamically
  loadSocketIO((socketInstance) => {
    socket = socketInstance;
    
    // Handle Socket Events
    setupSocketListeners();
  });

  // Populate color palette for the default theme (post-it)
  generateColorPalette('postit');
});

// 2. Socket.io Connection & Events
function setupSocketListeners() {
  if (!socket) return;

  // Connect and Join Room
  socket.on('connect', () => {
    console.log('Connected to server.');
    
    // Join room as Student
    socket.emit('join-room', { roomCode, isHost: false }, (res) => {
      if (res.success) {
        console.log('Successfully joined room:', roomCode);
        
        // Render initial active question
        const room = res.room;
        activeQuestionIndex = room.activeQuestionIndex;
        const currentQ = room.questions[activeQuestionIndex];
        if (currentQ) {
          activeQuestionText.textContent = currentQ.text;
        }
      } else {
        alert(res.error || '방 입장에 실패했습니다.');
        window.location.href = './index.html';
      }
    });
  });

  // Listen for real-time question changes from the host
  socket.on('question-changed', ({ index, text }) => {
    activeQuestionIndex = index;
    activeQuestionText.textContent = text;
    
    // Briefly highlight student page header
    const header = document.querySelector('.student-header');
    header.style.transform = 'scale(1.02)';
    header.style.borderColor = 'var(--primary)';
    setTimeout(() => {
      header.style.transform = 'scale(1)';
      header.style.borderColor = 'var(--glass-border)';
    }, 400);
  });

  socket.on('disconnect', () => {
    console.warn('Disconnected from server.');
  });
}

// 3. Flow Controllers

// Step 1: Save nickname and move to editor
function saveNickname() {
  const inputVal = nicknameInput.value.trim();
  if (!inputVal) {
    alert('닉네임을 입력해 주세요!');
    nicknameInput.focus();
    return;
  }

  nickname = inputVal;
  previewNickname.textContent = `From. ${nickname}`;

  // Transitions
  stepNickname.classList.add('hidden');
  stepEditor.classList.remove('hidden');
}

// Update card preview content as user types
function updatePreviewText() {
  const text = messageInput.value;
  currentCharCount.textContent = text.length;

  if (text.trim() === '') {
    previewContent.textContent = '여기에 내용을 적어주세요. 멋진 롤링페이퍼 카드가 완성됩니다! ✨';
    previewContent.style.opacity = 0.5;
  } else {
    previewContent.textContent = text;
    previewContent.style.opacity = 1;
  }
}

// 4. Style Customizers

// Change Themes
function setTheme(themeName) {
  selectedTheme = themeName;

  // Toggle active button state
  document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`theme-${themeName}`).classList.add('active');

  // Reset preview card theme classes
  cardPreview.className = 'rolling-card'; // Reset
  cardPreview.classList.add(`card-${themeName}`);

  // Apply default font classes based on state
  applyFontClass(selectedFont);

  // Re-generate color palette for the new theme
  generateColorPalette(themeName);
}

// Generate color circles depending on theme
function generateColorPalette(themeName) {
  colorPaletteContainer.innerHTML = ''; // Clear previous palette
  const colors = COLOR_PALETTES[themeName] || COLOR_PALETTES['postit'];

  colors.forEach((color, index) => {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    
    if (themeName === 'neon') {
      // Glow preview for neon
      dot.style.backgroundColor = '#12131a';
      dot.style.borderColor = color;
      dot.style.boxShadow = `0 0 5px ${color}`;
    } else if (themeName === 'chalkboard') {
      // Color of chalk text
      dot.style.backgroundColor = '#21352a';
      dot.style.color = color;
      dot.style.border = `2px solid ${color}`;
      dot.innerHTML = `<span style="font-size:12px; font-weight:800; text-shadow:none;">A</span>`;
      dot.style.display = 'flex';
      dot.style.justifyContent = 'center';
      dot.style.alignItems = 'center';
    } else {
      // Normal background colors
      dot.style.backgroundColor = color;
    }

    // Set first color active by default
    if (index === 0) {
      dot.classList.add('active');
      setColor(color);
    }

    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      setColor(color);
    });

    colorPaletteContainer.appendChild(dot);
  });
}

// Apply Selected Color
function setColor(colorVal) {
  selectedColor = colorVal;

  if (selectedTheme === 'neon') {
    // Neon glow customization (Uses CSS variables on the element)
    cardPreview.style.backgroundColor = '';
    cardPreview.style.color = '';
    cardPreview.style.setProperty('--neon-border', colorVal);
    cardPreview.style.setProperty('--neon-shadow', `${colorVal}66`); // with opacity
  } else if (selectedTheme === 'chalkboard') {
    // Chalkboard has static board color, but custom text colors
    cardPreview.style.backgroundColor = '';
    cardPreview.style.color = colorVal;
  } else if (selectedTheme === 'balloon') {
    // Balloon background color.
    // Set background and customize CSS property for bottom triangular arrow border color
    cardPreview.style.backgroundColor = colorVal;
    cardPreview.style.color = '#2f3542';
    cardPreview.style.setProperty('color', colorVal); // sets currentColor for arrow border-top
  } else {
    // Normal styles (post-it, notebook)
    cardPreview.style.backgroundColor = colorVal;
    cardPreview.style.color = '#2f3542';
  }
}

// Set Font Style
function setFont(fontName) {
  selectedFont = fontName;

  // Toggle active font button state
  document.querySelectorAll('.font-btn').forEach(btn => btn.classList.remove('active'));
  if (fontName === 'Nanum Pen Script') document.getElementById('font-nanum').classList.add('active');
  if (fontName === 'Gamja Flower') document.getElementById('font-gamja').classList.add('active');
  if (fontName === 'Jua') document.getElementById('font-jua').classList.add('active');
  if (fontName === 'Outfit') document.getElementById('font-gothic').classList.add('active');

  applyFontClass(fontName);
}

// Translate font identifier to CSS class
function applyFontClass(fontName) {
  // Remove existing font classes
  cardPreview.classList.remove('font-handwriting', 'font-cute', 'font-round', 'font-gothic');

  if (fontName === 'Nanum Pen Script') cardPreview.classList.add('font-handwriting');
  else if (fontName === 'Gamja Flower') cardPreview.classList.add('font-cute');
  else if (fontName === 'Jua') cardPreview.classList.add('font-round');
  else cardPreview.classList.add('font-gothic');
}

// Add Decoration Sticker
function addSticker(emoji) {
  if (stickers.length >= 6) {
    alert('스티커는 최대 6개까지 부착할 수 있습니다.');
    return;
  }

  // Create random positions on the card preview (percentage-based)
  // Bound within 10% to 85% to keep sticker inside card edges
  const x = Math.floor(Math.random() * 70) + 10;
  const y = Math.floor(Math.random() * 65) + 15;
  const rot = Math.floor(Math.random() * 40) - 20; // rotation between -20 and 20 deg

  const newSticker = { emoji, x, y, rot };
  stickers.push(newSticker);

  renderStickers();
}

// Clear all stickers
function clearStickers() {
  stickers = [];
  renderStickers();
}

// Render Stickers on the preview card
function renderStickers() {
  previewStickersContainer.innerHTML = '';
  stickers.forEach(st => {
    const el = document.createElement('span');
    el.className = 'placed-sticker';
    el.textContent = st.emoji;
    el.style.left = `${st.x}%`;
    el.style.top = `${st.y}%`;
    el.style.setProperty('--rot', `${st.rot}deg`);
    previewStickersContainer.appendChild(el);
  });
}

// 5. Submit Response
function submitResponse() {
  const content = messageInput.value.trim();

  if (!content) {
    alert('답변을 입력해 주세요!');
    messageInput.focus();
    return;
  }

  const submitBtn = document.querySelector('.submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> 날아가는 중... ✈️';

  const responseData = {
    nickname: nickname,
    content: content,
    theme: selectedTheme,
    color: selectedColor,
    font: selectedFont,
    stickers: stickers
  };

  // Submit via Socket.io
  socket.emit('submit-response', responseData, (res) => {
    if (res.success) {
      // Transition to Success step
      stepEditor.classList.add('hidden');
      stepSuccess.classList.remove('hidden');
      
      // Reset editor fields for any next submissions
      messageInput.value = '';
      currentCharCount.textContent = '0';
      stickers = [];
      renderStickers();
      updatePreviewText();
    } else {
      alert(res.error || '답변 전송에 실패했습니다. 다시 시도해 주세요.');
    }
    
    // Enable button again
    submitBtn.disabled = false;
    submitBtn.innerHTML = '🚀 메시지 보내기!';
  });
}

// Go back to write another message (using the same nickname)
function resetEditor() {
  stepSuccess.classList.add('hidden');
  stepEditor.classList.remove('hidden');
  messageInput.focus();
}

// Redirect back to home landing page
function goHome() {
  window.location.href = './index.html';
}
