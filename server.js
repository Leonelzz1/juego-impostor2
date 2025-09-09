/**
 * server.js
 * Backend para "El Impostor"
 * - Express sirve archivos estáticos (frontend)
 * - Socket.IO gestiona salas, lobby, selección de palabra e impostor, turno por turno
 *
 * Importante: las palabras se cargan desde palabras.json con fs.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Configuración básica ---
const PORT = process.env.PORT || 3000;

// Servir carpeta pública
app.use(express.static(path.join(__dirname, '/')));

// --- Cargar palabras desde archivo JSON (no hardcodear) ---
let palabras = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'palabras.json'), 'utf8');
  palabras = JSON.parse(data);
  if (!Array.isArray(palabras)) {
    console.error('palabras.json debe contener un array de strings. Se cargó un formato inválido.');
    palabras = [];
  }
  console.log(`Cargadas ${palabras.length} palabras desde palabras.json`);
} catch (err) {
  console.error('Error leyendo palabras.json:', err);
  palabras = [];
}

// --- Estructura en memoria para salas ---
/**
 * rooms = {
 *   roomCode: {
 *     players: [{ id: socketId, name: 'Carlos', isHost: true }],
 *     hostId: socketId,
 *     secretWord: 'Pizza',
 *     impostorId: socketId,
 *     turnIndex: 0,
 *     order: [socketId,...]
 *   }
 * }
 */
const rooms = {};

// --- Utilidades ---
function generateRoomCode() {
  // 4 letras mayúsculas (A-Z)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  // Evitar colisiones simples
  if (rooms[code]) return generateRoomCode();
  return code;
}

function getRoomPlayers(room) {
  return (rooms[room]?.players || []).map(p => ({ id: p.id, name: p.name, isHost: p.isHost }));
}

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log('Conexión:', socket.id);

  // Crear sala
  socket.on('create_room', ({ name }, cb) => {
    const code = generateRoomCode();
    rooms[code] = {
      players: [{ id: socket.id, name: name || 'Anónimo', isHost: true }],
      hostId: socket.id,
      secretWord: null,
      impostorId: null,
      turnIndex: 0,
      order: [socket.id]
    };
    socket.join(code);
    console.log(`${name} creó la sala ${code}`);
    // Responder con éxito y datos iniciales de la sala
    cb({ ok: true, room: code, players: getRoomPlayers(code), isHost: true });
    // Emitir actualización por si necesario
    io.to(code).emit('update_lobby', { room: code, players: getRoomPlayers(code), hostId: rooms[code].hostId });
  });

  // Unirse a sala existente
  socket.on('join_room', ({ name, room }, cb) => {
    const r = rooms[room];
    if (!r) {
      return cb({ ok: false, message: 'Sala no encontrada.' });
    }
    // Evitar duplicar jugador con mismo socket id
    r.players.push({ id: socket.id, name: name || 'Anónimo', isHost: false });
    r.order.push(socket.id);
    socket.join(room);
    console.log(`${name} se unió a la sala ${room}`);
    cb({ ok: true, room: room, players: getRoomPlayers(room), isHost: false });
    io.to(room).emit('update_lobby', { room: room, players: getRoomPlayers(room), hostId: r.hostId });
  });

  // Solicitud para empezar partida - solo host puede pedirlo
  socket.on('start_game', ({ room }, cb) => {
    const r = rooms[room];
    if (!r) return cb({ ok: false, message: 'Sala no encontrada.' });
    if (r.hostId !== socket.id) return cb({ ok: false, message: 'Solo el anfitrión puede empezar la partida.' });
    if (r.players.length < 3) return cb({ ok: false, message: 'Se necesitan al menos 3 jugadores para empezar.' });
    if (palabras.length === 0) return cb({ ok: false, message: 'No hay palabras cargadas en el servidor.' });

    // Elegir palabra secreta al azar desde array cargado
    const secretWord = palabras[Math.floor(Math.random() * palabras.length)];

    // Elegir impostor aleatoriamente
    const impostorIndex = Math.floor(Math.random() * r.players.length);
    const impostorId = r.players[impostorIndex].id;

    // Guardar en estado de sala
    r.secretWord = secretWord;
    r.impostorId = impostorId;
    r.turnIndex = 0;
    // Asegurar order está sincronizado con players (por si alguien se desconectó)
    r.order = r.players.map(p => p.id);

    // Enviar palabra a todos excepto al impostor
    r.players.forEach(p => {
      if (p.id === impostorId) {
        io.to(p.id).emit('game_role', { role: 'Impostor', message: 'Eres el Impostor. Mantén el secreto.' });
      } else {
        io.to(p.id).emit('game_role', { role: 'Ciudadano', word: secretWord, message: 'Eres Ciudadano. Usa la palabra para jugar.' });
      }
    });

    // Informar a la sala que la partida empezó y quién tiene el turno
    const currentTurnId = r.order[r.turnIndex];
    io.to(room).emit('game_started', {
      room,
      players: getRoomPlayers(room),
      impostorId,
      currentTurnId
    });

    console.log(`Partida en ${room} iniciada. Palabra: "${secretWord}". Impostor: ${impostorId}`);
    cb({ ok: true });
  });

  // Petición para avanzar al siguiente turno (puede venir del servidor o cliente)
  socket.on('next_turn', ({ room }, cb) => {
    const r = rooms[room];
    if (!r) return cb?.({ ok: false, message: 'Sala no encontrada.' });

    // Incrementar índice circular
    r.turnIndex = (r.turnIndex + 1) % r.order.length;
    const currentTurnId = r.order[r.turnIndex];
    io.to(room).emit('turn_changed', { currentTurnId });
    cb?.({ ok: true, currentTurnId });
  });

  // Petición para obtener estado actual de sala (útil para reconexión)
  socket.on('get_room_state', ({ room }, cb) => {
    const r = rooms[room];
    if (!r) return cb({ ok: false, message: 'Sala no encontrada.' });
    cb({
      ok: true,
      players: getRoomPlayers(room),
      hostId: r.hostId,
      secretWordLoaded: !!r.secretWord,
      impostorId: r.impostorId,
      currentTurnId: r.order[r.turnIndex]
    });
  });

  // Manejo de desconexiones: remover jugador de cualquier sala donde esté
  socket.on('disconnect', () => {
    console.log('Desconexión:', socket.id);
    // Buscar la sala(s) donde estaba el jugador
    for (const code of Object.keys(rooms)) {
      const r = rooms[code];
      const idx = r.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const wasHost = r.players[idx].isHost;
        console.log(`Removiendo jugador ${r.players[idx].name} (${socket.id}) de sala ${code}`);
        // Remover de players y order
        r.players.splice(idx, 1);
        r.order = r.order.filter(id => id !== socket.id);

        // Si no quedan jugadores, borrar la sala
        if (r.players.length === 0) {
          delete rooms[code];
          console.log(`Sala ${code} eliminada (vacía).`);
          continue;
        }

        // Si el host se fue, transferir host al primero
        if (wasHost) {
          r.hostId = r.players[0].id;
          r.players[0].isHost = true;
          console.log(`Nuevo host de ${code}: ${r.players[0].name} (${r.hostId})`);
        }

        // Ajustar turnIndex si es necesario
        if (r.order.length > 0) {
          r.turnIndex = r.turnIndex % r.order.length;
        } else {
          r.turnIndex = 0;
        }

        // Emitir actualización de lobby a la sala
        io.to(code).emit('update_lobby', { room: code, players: getRoomPlayers(code), hostId: r.hostId });
      }
    }
  });
});

// --- Iniciar servidor ---
server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
