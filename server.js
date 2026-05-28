const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Database state
let rooms = {};

// Load database from file
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      rooms = JSON.parse(data || '{}');
      console.log('Database loaded successfully.');
    } else {
      rooms = {};
      saveDb();
    }
  } catch (err) {
    console.error('Error loading database, resetting in-memory state:', err);
    rooms = {};
  }
}

// Save database to file
function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(rooms, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

// Load DB on startup
loadDb();

// Default questions for new rooms
const DEFAULT_QUESTIONS = [
  "오늘 수업에서 가장 기억에 남는 단어나 개념은 무엇인가요? ✏️",
  "오늘 하루 동안 고마웠던 사람에게 마음을 전해보세요! 💖",
  "우리 반 친구들과 선생님에게 하고 싶은 응원의 한마디! 🌟"
];

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Serve static files from root directory (to support references to images directly in the root)
app.use(express.static(__dirname));

// API Endpoint to check if a room code exists
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code;
  if (rooms[code]) {
    res.json({ exists: true });
  } else {
    res.status(404).json({ exists: false, error: "방을 찾을 수 없습니다." });
  }
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Create a new room (Host)
  socket.on('create-room', (callback) => {
    let roomCode;
    // Generate a unique 4-digit numeric code
    do {
      roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      code: roomCode,
      activeQuestionIndex: 0,
      questions: DEFAULT_QUESTIONS.map((q, idx) => ({
        id: idx,
        text: q,
        responses: []
      })),
      theme: 'chalkboard', // default theme for display board
      createdAt: new Date().toISOString()
    };

    saveDb();
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;

    console.log(`Room created: ${roomCode}`);
    callback({ success: true, room: rooms[roomCode] });
  });

  // 2. Join room (Student or Host reconnecting)
  socket.on('join-room', ({ roomCode, isHost }, callback) => {
    roomCode = roomCode.trim();
    if (!rooms[roomCode]) {
      return callback({ success: false, error: '존재하지 않는 입장 코드입니다.' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = !!isHost;

    console.log(`User ${socket.id} joined room ${roomCode} as ${isHost ? 'Host' : 'Student'}`);
    
    // Send back current room state
    callback({ 
      success: true, 
      room: rooms[roomCode]
    });
  });

  // 3. Set Active Question (Host)
  socket.on('set-active-question', (questionIndex) => {
    const code = socket.roomCode;
    if (code && rooms[code] && socket.isHost) {
      rooms[code].activeQuestionIndex = questionIndex;
      saveDb();
      // Notify all students in the room that the question has changed
      socket.to(code).emit('question-changed', {
        index: questionIndex,
        text: rooms[code].questions[questionIndex].text
      });
      console.log(`Room ${code} active question changed to index ${questionIndex}`);
    }
  });

  // 4. Add New Question (Host)
  socket.on('add-question', (questionText, callback) => {
    const code = socket.roomCode;
    if (code && rooms[code] && socket.isHost) {
      const newQuestion = {
        id: rooms[code].questions.length,
        text: questionText,
        responses: []
      };
      rooms[code].questions.push(newQuestion);
      saveDb();

      // Broadcast updated questions list to host
      io.to(code).emit('questions-updated', rooms[code].questions);
      
      callback({ success: true, questions: rooms[code].questions });
      console.log(`Room ${code} added question: ${questionText}`);
    } else {
      callback({ success: false, error: '권한이 없거나 방을 찾을 수 없습니다.' });
    }
  });

  // 5. Submit Response (Student)
  socket.on('submit-response', (responseData, callback) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) {
      return callback({ success: false, error: '방 연결이 끊어졌거나 존재하지 않습니다.' });
    }

    const room = rooms[code];
    const qIndex = room.activeQuestionIndex;
    const activeQuestion = room.questions[qIndex];

    if (!activeQuestion) {
      return callback({ success: false, error: '진행 중인 질문이 없습니다.' });
    }

    // Prepare response data with unique id and timestamp
    const newResponse = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      nickname: responseData.nickname || '익명',
      content: responseData.content,
      theme: responseData.theme || 'postit',
      color: responseData.color || '#fff9c4',
      font: responseData.font || 'Nanum Pen Script',
      stickers: responseData.stickers || [],
      x: Math.floor(Math.random() * 70) + 10, // Default random position from 10% to 80%
      y: Math.floor(Math.random() * 60) + 15, // Default random position from 15% to 75%
      createdAt: new Date().toISOString()
    };

    activeQuestion.responses.push(newResponse);
    saveDb();

    // Broadcast new response to all users in the room (primarily the host display)
    io.to(code).emit('new-response', {
      questionIndex: qIndex,
      response: newResponse
    });

    callback({ success: true, response: newResponse });
    console.log(`Room ${code} Question ${qIndex} received response from ${newResponse.nickname}`);
  });

  // 6. Update Card Position (Host dragging notes)
  socket.on('update-response-position', ({ questionIndex, responseId, x, y }) => {
    const code = socket.roomCode;
    if (code && rooms[code] && socket.isHost) {
      const room = rooms[code];
      const question = room.questions[questionIndex];
      if (question) {
        const response = question.responses.find(r => r.id === responseId);
        if (response) {
          response.x = x;
          response.y = y;
          saveDb();
          // Sync card drag across host views (if there are multiple)
          socket.to(code).emit('response-position-synced', { questionIndex, responseId, x, y });
        }
      }
    }
  });

  // 7. Delete Response (Host deleting card)
  socket.on('delete-response', ({ questionIndex, responseId }, callback) => {
    const code = socket.roomCode;
    if (code && rooms[code] && socket.isHost) {
      const room = rooms[code];
      const question = room.questions[questionIndex];
      if (question) {
        const initialLen = question.responses.length;
        question.responses = question.responses.filter(r => r.id !== responseId);
        if (question.responses.length < initialLen) {
          saveDb();
          io.to(code).emit('response-deleted', { questionIndex, responseId });
          if (callback) callback({ success: true });
          console.log(`Response ${responseId} deleted from Room ${code} Question ${questionIndex}`);
          return;
        }
      }
    }
    if (callback) callback({ success: false, error: '삭제에 실패했습니다.' });
  });

  // 8. Update Room Display Theme (Host change background)
  socket.on('update-room-theme', (themeName) => {
    const code = socket.roomCode;
    if (code && rooms[code] && socket.isHost) {
      rooms[code].theme = themeName;
      saveDb();
      socket.to(code).emit('room-theme-changed', themeName);
      console.log(`Room ${code} background theme changed to: ${themeName}`);
    }
  });

  // Disconnect logic
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  Interactive Rolling Paper App Server is running!`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
