const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const questions = require("./questions");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const impostorAwarenessModes = new Set(["hidden", "known"]);

function makeCode() {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function shuffledPlayerIds(players) {
  const ids = players.map((player) => player.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
  }
  return ids;
}

function publicTablePlayers(room) {
  if (!room.currentRound?.seatingOrder) return [];

  return room.currentRound.seatingOrder
    .map((playerId) => room.players.find((player) => player.id === playerId))
    .filter(Boolean)
    .map((player) => ({ id: player.id, name: player.name }));
}

function randomTargetPlayerName(room, playerId) {
  const availablePlayers = publicTablePlayers(room).filter((player) => player.id !== playerId);
  if (!availablePlayers.length) return "";
  return availablePlayers[Math.floor(Math.random() * availablePlayers.length)].name;
}

function applyQuestionTarget(question, targetPlayerName) {
  if (!question.includes("{{targetPlayerName}}")) return question;
  return question.replaceAll("{{targetPlayerName}}", targetPlayerName || "alguem da mesa");
}

function publicQuestionText(question) {
  return applyQuestionTarget(question, "alguém da mesa");
}

function allPlayersReady(room) {
  return Boolean(room.currentRound?.readyPlayers) && room.currentRound.readyPlayers.size === room.players.length;
}

function publicRoomState(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    hostName: room.players.find((p) => p.id === room.hostId)?.name || "",
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    impostorAwarenessMode: room.impostorAwarenessMode,
    theme: room.currentRound?.theme || "",
    tablePlayers: publicTablePlayers(room),
    readyProgress: room.currentRound?.readyPlayers ? `${room.currentRound.readyPlayers.size}/${room.players.length}` : "0/0",
    allPlayersReady: allPlayersReady(room),
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
      impostorAwarenessMode: "hidden",
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

  socket.on("impostor-mode:update", ({ mode }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode alterar o modo." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "O modo so pode ser alterado no lobby." });
    if (!impostorAwarenessModes.has(mode)) return cb?.({ ok: false, message: "Modo invalido." });

    room.impostorAwarenessMode = mode;
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("start-round", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode iniciar." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "A rodada atual precisa terminar primeiro." });
    if (room.players.length < 3) return cb?.({ ok: false, message: "E preciso ter pelo menos 3 jogadores." });

    const questionSet = questions[Math.floor(Math.random() * questions.length)];
    const impostorIndex = Math.floor(Math.random() * room.players.length);
    const impostor = room.players[impostorIndex];

    room.phase = "question";
    room.currentRound = {
      theme: questionSet.theme,
      mainQuestion: questionSet.mainQuestion,
      counterQuestion: questionSet.counterQuestion,
      impostorId: impostor.id,
      impostorAwarenessMode: room.impostorAwarenessMode,
      seatingOrder: shuffledPlayerIds(room.players),
      readyPlayers: new Set(),
      targetPlayersByPlayerId: new Map()
    };
    room.questionsByPlayer = new Map();
    room.answers = new Map();
    room.votes = new Map();
    room.voteOpen = false;

    for (const player of room.players) {
      const isImpostor = player.id === impostor.id;
      const baseQuestion = isImpostor ? questionSet.counterQuestion : questionSet.mainQuestion;
      const targetPlayerName = randomTargetPlayerName(room, player.id);
      const question = applyQuestionTarget(baseQuestion, targetPlayerName);
      const roleLabel = room.currentRound.impostorAwarenessMode === "known"
        ? (isImpostor ? "Contrapergunta / Impostor" : "Pergunta normal")
        : "";
      room.currentRound.targetPlayersByPlayerId.set(player.id, targetPlayerName);
      room.questionsByPlayer.set(player.id, question);
      io.to(player.id).emit("private-question", {
        phase: "question",
        theme: questionSet.theme,
        question,
        roleLabel,
        targetPlayerName: baseQuestion.includes("{{targetPlayerName}}") ? targetPlayerName : ""
      });
    }

    cb?.({ ok: true });
    emitAnswers(room);
    emitRoom(room);
  });

  socket.on("question:ready", ({ answer }, cb) => {
    const room = getRoomBySocket(socket);
    const player = room?.players.find((p) => p.id === socket.id);
    const cleanAnswer = String(answer || "").trim().slice(0, 120);

    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (!room.currentRound) return cb?.({ ok: false, message: "A rodada ainda nao comecou." });
    if (!player) return cb?.({ ok: false, message: "Jogador nao encontrado na sala." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Nao e possivel marcar pronto agora." });
    if (!cleanAnswer) return cb?.({ ok: false, message: "Escreva uma resposta antes de ficar pronto." });

    room.answers.set(socket.id, cleanAnswer);
    room.currentRound.readyPlayers.add(socket.id);
    cb?.({ ok: true });
    emitAnswers(room);
    emitRoom(room);
  });

  socket.on("open-voting", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala nao encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode abrir a votacao." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Nao e possivel votar agora." });
    if (!allPlayersReady(room)) {
      return cb?.({ ok: false, message: "Todos os jogadores precisam estar prontos antes da votacao." });
    }
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
    if (room.votes.has(socket.id)) return cb?.({ ok: false, message: "Voce ja votou nesta rodada." });

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
        counterQuestion: publicQuestionText(room.currentRound.counterQuestion),
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
    room.currentRound?.readyPlayers?.delete(socket.id);
    room.currentRound?.targetPlayersByPlayerId?.delete(socket.id);

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
