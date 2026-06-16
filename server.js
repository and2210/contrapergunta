const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const questionPool = [
  {
    theme: "Super-herois",
    mainQuestion: "Qual super-heroi voce seria?",
    counterQuestion: "Qual super-heroi combina mais com seu melhor amigo?"
  },
  {
    theme: "Comida",
    mainQuestion: "Qual prato voce pediria hoje sem pensar duas vezes?",
    counterQuestion: "Qual comida combina mais com a vibe do grupo agora?"
  },
  {
    theme: "Filmes",
    mainQuestion: "Qual filme voce assistiria de novo com prazer?",
    counterQuestion: "Qual filme voce recomendaria para alguem do grupo?"
  },
  {
    theme: "Musica",
    mainQuestion: "Qual musica nunca sai da sua playlist?",
    counterQuestion: "Qual musica lembra mais um amigo seu?"
  },
  {
    theme: "Amigos",
    mainQuestion: "Qual tipo de amigo voce mais valoriza?",
    counterQuestion: "Qual amigo do grupo resolveria qualquer situacao?"
  },
  {
    theme: "Infancia",
    mainQuestion: "Qual brincadeira da infancia voce mais gostava?",
    counterQuestion: "Qual lembranca de infancia combina mais com o grupo?"
  },
  {
    theme: "Valorant",
    mainQuestion: "Qual agente voce escolheria para subir rank?",
    counterQuestion: "Qual agente combina mais com o estilo do time?"
  },
  {
    theme: "Animais",
    mainQuestion: "Qual animal voce gostaria de ter por perto?",
    counterQuestion: "Qual animal representa melhor alguem do grupo?"
  },
  {
    theme: "Viagem",
    mainQuestion: "Qual destino voce visitaria agora?",
    counterQuestion: "Qual viagem combinaria mais com os amigos?"
  },
  {
    theme: "Escola",
    mainQuestion: "Qual materia voce menos odiava?",
    counterQuestion: "Qual materia parecia feita para o grupo?"
  },
  {
    theme: "Trabalho",
    mainQuestion: "Qual tipo de trabalho voce faria bem?",
    counterQuestion: "Qual ambiente de trabalho combina com o grupo?"
  },
  {
    theme: "Situacoes absurdas",
    mainQuestion: "O que voce faria se acordasse em um planeta desconhecido?",
    counterQuestion: "Quem do grupo sobreviveria melhor a uma situacao absurda?"
  }
];

const rooms = new Map();

function makeCode() {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    hostName: room.players.find((p) => p.id === room.hostId)?.name || "",
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    theme: room.currentRound?.theme || "",
    voteProgress: `${room.votes.size}/${room.players.length}`
  };
}

function publicAnswerList(room) {
  return room.players
    .filter((player) => room.answers.has(player.id))
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      answer: room.answers.get(player.id)
    }));
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", publicRoomState(room));
}

function emitAnswers(room) {
  io.to(room.code).emit("answer:update", publicAnswerList(room));
}

function safeResetToLobby(room) {
  room.phase = "lobby";
  room.currentRound = null;
  room.questionsByPlayer = new Map();
  room.answers = new Map();
  room.votes = new Map();
  room.voteOpen = false;
  emitAnswers(room);
  emitRoom(room);
}

function getRoomBySocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }, cb) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    if (!cleanName) return cb?.({ ok: false, message: "Nome e obrigatorio." });

    const code = makeCode();
    const room = {
      code,
      phase: "lobby",
      hostId: socket.id,
      players: [{ id: socket.id, name: cleanName }],
      currentRound: null,
      questionsByPlayer: new Map(),
      answers: new Map(),
      votes: new Map(),
      voteOpen: false
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = cleanName;
    cb?.({ ok: true, code, state: publicRoomState(room) });
    emitRoom(room);
  });

  socket.on("join-room", ({ code, name }, cb) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const cleanName = String(name || "").trim().slice(0, 24);
    const room = rooms.get(roomCode);

    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (!cleanName) return cb?.({ ok: false, message: "Nome e obrigatorio." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "A rodada ja comecou." });

    room.players.push({ id: socket.id, name: cleanName });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = cleanName;
    cb?.({ ok: true, code: roomCode, state: publicRoomState(room) });
    emitRoom(room);
  });

  socket.on("start-round", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode iniciar." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "A rodada atual precisa terminar primeiro." });
    if (room.players.length < 3) return cb?.({ ok: false, message: "E preciso ter pelo menos 3 jogadores." });

    const questionSet = questionPool[Math.floor(Math.random() * questionPool.length)];
    const impostorIndex = Math.floor(Math.random() * room.players.length);
    const impostor = room.players[impostorIndex];

    room.phase = "question";
    room.currentRound = {
      theme: questionSet.theme,
      mainQuestion: questionSet.mainQuestion,
      counterQuestion: questionSet.counterQuestion,
      impostorId: impostor.id
    };
    room.questionsByPlayer = new Map();
    room.answers = new Map();
    room.votes = new Map();
    room.voteOpen = false;

    for (const player of room.players) {
      const question = player.id === impostor.id ? questionSet.counterQuestion : questionSet.mainQuestion;
      room.questionsByPlayer.set(player.id, question);
      io.to(player.id).emit("private-question", {
        phase: "question",
        theme: questionSet.theme,
        question
      });
    }

    cb?.({ ok: true });
    emitAnswers(room);
    emitRoom(room);
  });

  socket.on("answer:send", ({ roomCode, answer }, cb) => {
    const code = String(roomCode || socket.data.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    const player = room?.players.find((p) => p.id === socket.id);
    const cleanAnswer = String(answer || "").trim().slice(0, 120);

    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (!room.currentRound) return cb?.({ ok: false, message: "A rodada ainda nao comecou." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Nao e possivel responder agora." });
    if (!player) return cb?.({ ok: false, message: "Jogador nao encontrado na sala." });
    if (!cleanAnswer) return cb?.({ ok: false, message: "Escreva uma resposta antes de enviar." });

    room.answers.set(socket.id, cleanAnswer);
    cb?.({ ok: true });
    emitAnswers(room);
  });

  socket.on("open-voting", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode abrir a votacao." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Nao e possivel votar agora." });
    if (room.answers.size < room.players.length) {
      return cb?.({ ok: false, message: "Todos os jogadores precisam responder antes da votacao." });
    }

    room.phase = "vote";
    room.votes = new Map();
    room.voteOpen = true;
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("cast-vote", ({ targetId }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.phase !== "vote" || !room.voteOpen) return cb?.({ ok: false, message: "A votacao nao esta aberta." });
    if (!room.players.some((p) => p.id === targetId)) return cb?.({ ok: false, message: "Jogador invalido." });

    room.votes.set(socket.id, targetId);
    io.to(room.code).emit("vote-progress", {
      count: room.votes.size,
      total: room.players.length
    });

    if (room.votes.size === room.players.length) {
      const tally = new Map();
      for (const votedId of room.votes.values()) {
        tally.set(votedId, (tally.get(votedId) || 0) + 1);
      }
      let mostVotedId = null;
      let topVotes = -1;
      for (const [playerId, votes] of tally.entries()) {
        if (votes > topVotes) {
          topVotes = votes;
          mostVotedId = playerId;
        }
      }

      const impostor = room.players.find((p) => p.id === room.currentRound.impostorId);
      const mostVoted = room.players.find((p) => p.id === mostVotedId);
      const found = mostVotedId === room.currentRound.impostorId;

      room.phase = "reveal";
      room.voteOpen = false;
      io.to(room.code).emit("reveal-round", {
        impostorName: impostor?.name || "",
        mostVotedName: mostVoted?.name || "",
        found,
        theme: room.currentRound.theme,
        mainQuestion: room.currentRound.mainQuestion,
        counterQuestion: room.currentRound.counterQuestion,
        answers: publicAnswerList(room),
        votes: Array.from(room.votes.entries())
      });
      emitRoom(room);
    }

    cb?.({ ok: true });
  });

  socket.on("new-round", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode reiniciar." });

    safeResetToLobby(room);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket);
    if (!room) return;

    room.players = room.players.filter((player) => player.id !== socket.id);
    room.answers.delete(socket.id);
    room.votes.delete(socket.id);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    if (room.phase !== "lobby") {
      safeResetToLobby(room);
      return;
    }

    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Contrapergunta running at http://localhost:${PORT}`);
});
