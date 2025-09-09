/**
 * script.js
 * Lógica del cliente para "El Impostor"
 *
 * - Conecta con Socket.IO
 * - Maneja UI: inicio, lobby, juego
 * - Recibe roles y actualizaciones de turno desde el servidor
 */

// IMPORTANTE: ¡CAMBIA ESTA LÍNEA POR LA URL DE TU SERVIDOR PÚBLICO!
const socket = io("https://juego-impostor2.onrender.com"); // Si tu servidor es remoto, reemplaza por: io("https://mi-servidor.com")

// --- Elementos DOM ---
const startScreen = document.getElementById('start-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startMessage = document.getElementById('startMessage');

const playersList = document.getElementById('playersList');
const lobbyRoomCode = document.getElementById('lobbyRoomCode');
const startGameBtn = document.getElementById('startGameBtn');
const leaveBtn = document.getElementById('leaveBtn');
const lobbyMessage = document.getElementById('lobbyMessage');

const gameRoomCode = document.getElementById('gameRoomCode');
const yourRoleSpan = document.getElementById('yourRole');
const secretWordSpan = document.getElementById('secretWord');
const wordBox = document.getElementById('wordBox');
const impostorBox = document.getElementById('impostorBox');
const turnOwnerSpan = document.getElementById('turnOwner');
const nextTurnBtn = document.getElementById('nextTurnBtn');
const gameMessage = document.getElementById('gameMessage');

// Estado cliente
let currentRoom = null;
let myName = null;
let myId = null;
let isHost = false;
let players = []; // {id, name, isHost}

// --- Helpers UI ---
function showScreen(screen) {
  startScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.add('hidden');
  screen.classList.remove('hidden');
}

function renderPlayersList(list) {
  playersList.innerHTML = '';
  list.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name + (p.isHost ? ' (host)' : '');
    playersList.appendChild(li);
  });
}

function updateLobbyUI(room, list, hostId) {
  currentRoom = room;
  lobbyRoomCode.textContent = room;
  renderPlayersList(list);
  // Si soy host, mostrar botón empezar
  isHost = (hostId === socket.id);
  startGameBtn.classList.toggle('hidden', !isHost);
  lobbyMessage.textContent = '';
  showScreen(lobbyScreen);
}

function enterGameUI(room) {
  gameRoomCode.textContent = room;
  showScreen(gameScreen);
}

/* ------------------ Eventos UI ------------------ */

// Crear sala
createBtn.addEventListener('click', () => {
  const name = (nameInput.value || 'Anónimo').trim();
  if (!name) return startMessage.textContent = 'Introduce un nombre';
  myName = name;
  socket.emit('create_room', { name }, (res) => {
    if (!res.ok) {
      startMessage.textContent = res.message || 'Error creando sala';
      return;
    }
    currentRoom = res.room;
    players = res.players;
    isHost = res.isHost;
    startMessage.textContent = '';
    updateLobbyUI(res.room, res.players, res.room?.hostId);
  });
});

// Unirse a sala
joinBtn.addEventListener('click', () => {
  const name = (nameInput.value || 'Anónimo').trim();
  const room = (roomCodeInput.value || '').trim().toUpperCase();
  if (!name) return startMessage.textContent = 'Introduce un nombre';
  if (!room || room.length !== 4) return startMessage.textContent = 'Código de sala inválido (4 letras)';
  myName = name;
  socket.emit('join_room', { name, room }, (res) => {
    if (!res.ok) {
      startMessage.textContent = res.message || 'No se pudo unir';
      return;
    }
    currentRoom = res.room;
    players = res.players;
    isHost = res.isHost;
    startMessage.textContent = '';
    updateLobbyUI(res.room, res.players, res.hostId);
  });
});

// Empezar partida (host)
startGameBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  startGameBtn.disabled = true;
  socket.emit('start_game', { room: currentRoom }, (res) => {
    startGameBtn.disabled = false;
    if (!res.ok) {
      lobbyMessage.textContent = res.message || 'No se pudo iniciar partida';
      return;
    }
    lobbyMessage.textContent = '';
    // El servidor enviará event game_started y game_role
  });
});

// Salir a pantalla inicial (recargar estado local)
leaveBtn.addEventListener('click', () => {
  // Simplemente recargar la página para limpiar estado local y desconectar socket
  location.reload();
});

// Siguiente turno (puede usarse como ejemplo, en un juego real quizás lo controle el servidor u otro mecanismo)
nextTurnBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('next_turn', { room: currentRoom }, (res) => {
    if (!res.ok) {
      gameMessage.textContent = res.message || 'No se pudo avanzar el turno';
    } else {
      gameMessage.textContent = '';
    }
  });
});

/* ------------------ Eventos Socket.IO ------------------ */

// Guardar myId cuando conectado
socket.on('connect', () => {
  myId = socket.id;
  console.log('Conectado como', myId);
});

// Actualización del lobby (cuando alguien entra/sale)
socket.on('update_lobby', ({ room, players: sPlayers, hostId }) => {
  // Si el update pertenece a la sala en la que estamos, actualizar UI
  if (currentRoom && room === currentRoom) {
    players = sPlayers;
    updateLobbyUI(room, sPlayers, hostId);
  }
});

// Cuando el servidor indica tu rol (enviado sólo a cada jugador individualmente)
socket.on('game_role', (data) => {
  // data = { role: 'Ciudadano'|'Impostor', word?, message }
  console.log('Recibido role:', data);
  if (data.role === 'Impostor') {
    yourRoleSpan.textContent = 'Impostor';
    secretWordSpan.textContent = '—';
    wordBox.classList.add('hidden');
    impostorBox.classList.remove('hidden');
  } else {
    yourRoleSpan.textContent = 'Ciudadano';
    secretWordSpan.textContent = data.word || '—';
    wordBox.classList.remove('hidden');
    impostorBox.classList.add('hidden');
  }
  // Entrar a pantalla de juego (si venimos del lobby)
  enterGameUI(currentRoom);
});

// El servidor anuncia que la partida empezó (incluye quién tiene el turno)
socket.on('game_started', ({ room, players: sPlayers, impostorId, currentTurnId }) => {
  players = sPlayers;
  // Mostrar lista y turno inicial
  const owner = players.find(p => p.id === currentTurnId);
  turnOwnerSpan.textContent = owner ? owner.name : '—';
  // Ir a pantalla de juego
  enterGameUI(room);
});

// Cambio de turno
socket.on('turn_changed', ({ currentTurnId }) => {
  const owner = players.find(p => p.id === currentTurnId);
  turnOwnerSpan.textContent = owner ? owner.name : '—';
});

// Manejo de errores y mensajes generales (puedes extender)
socket.on('disconnect', () => {
  console.log('Desconectado del servidor');
  gameMessage.textContent = 'Desconectado. Recarga la página para reconectar.';
});

// Obtener estado de sala si te reconectas (opcional en este ejemplo)
// (El servidor ofrece get_room_state event; puedes llamarlo en reconexión si implementas rejoin)
