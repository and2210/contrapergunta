const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const questions = require("./questions");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const CUSTOM_QUESTIONS_FILE = path.join(__dirname, "customQuestions.json");

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const impostorAwarenessModes = new Set(["hidden", "known"]);
const roundModes = new Set(["automatic", "master"]);
let customQuestionsCache = [];

function loadCustomQuestions() {
  try {
    if (!fs.existsSync(CUSTOM_QUESTIONS_FILE)) {
      fs.writeFileSync(CUSTOM_QUESTIONS_FILE, "[]\n", "utf8");
      customQuestionsCache = [];
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(CUSTOM_QUESTIONS_FILE, "utf8"));
    customQuestionsCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    customQuestionsCache = [];
  }
}

function persistCustomQuestion(questionSet) {
  const exists = customQuestionsCache.some((item) =>
    item.theme === questionSet.theme
    && item.mainQuestion === questionSet.mainQuestion
    && item.counterQuestion === questionSet.counterQuestion
  );

  if (exists) return;

  customQuestionsCache.push(questionSet);
  try {
    fs.writeFileSync(CUSTOM_QUESTIONS_FILE, `${JSON.stringify(customQuestionsCache, null, 2)}\n`, "utf8");
  } catch {
    // Render and some read-only environments may not preserve local writes.
  }
}

function makeCode() {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function shuffledPlayerIds(players) {
  const ids = players.map((player) => player.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
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

function getNeighborNames(room, playerId) {
  const seating = publicTablePlayers(room);
  const index = seating.findIndex((player) => player.id === playerId);
  if (index === -1 || seating.length < 2) {
    return { leftPlayerName: "", rightPlayerName: "" };
  }

  const leftIndex = (index - 1 + seating.length) % seating.length;
  const rightIndex = (index + 1) % seating.length;
  return {
    leftPlayerName: seating[leftIndex]?.name || "",
    rightPlayerName: seating[rightIndex]?.name || ""
  };
}

function randomTargetPlayerName(room, playerId) {
  const availablePlayers = publicTablePlayers(room).filter((player) => player.id !== playerId);
  if (!availablePlayers.length) return "";
  return availablePlayers[Math.floor(Math.random() * availablePlayers.length)].name;
}

function applyQuestionTarget(question, targetPlayerName) {
  if (!String(question || "").includes("{{targetPlayerName}}")) return String(question || "");
  return String(question).replaceAll("{{targetPlayerName}}", targetPlayerName || "alguém da mesa");
}

function publicQuestionText(question) {
  return applyQuestionTarget(question, "alguém da mesa");
}

function sanitizeQuestionSet(questionSet) {
  return {
    theme: String(questionSet?.theme || "").trim().slice(0, 60),
    mainQuestion: String(questionSet?.mainQuestion || "").trim().slice(0, 160),
    counterQuestion: String(questionSet?.counterQuestion || "").trim().slice(0, 160)
  };
}

function getPublicAnswersForRoom(room) {
  return publicTablePlayers(room)
    .filter((player) => room.answers.has(player.id))
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      answer: room.answers.get(player.id)
    }));
}

function allPlayersReady(room) {
  return Boolean(room.currentRound?.readyPlayers) && room.currentRound.readyPlayers.size === room.players.length;
}

function publicRoomState(room, viewerId = "") {
  const state = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    hostName: room.players.find((player) => player.id === room.hostId)?.name || "",
    players: room.players.map((player) => ({ id: player.id, name: player.name })),
    impostorAwarenessMode: room.impostorAwarenessMode,
    roundMode: room.roundMode,
    masterSetup: {
      theme: room.masterSetup.theme,
      mainQuestion: room.masterSetup.mainQuestion,
      counterQuestion: room.masterSetup.counterQuestion
    },
    theme: room.currentRound?.theme || "",
    tablePlayers: publicTablePlayers(room),
    readyProgress: room.currentRound?.readyPlayers ? `${room.currentRound.readyPlayers.size}/${room.players.length}` : "0/0",
    allPlayersReady: allPlayersReady(room),
    voteProgress: `${room.votes.size}/${room.players.length}`
  };

  if (viewerId && viewerId === room.hostId && room.phase === "lobby" && room.roundMode === "master") {
    state.masterSetup.impostorId = room.masterSetup.impostorId || "";
  }

  if (room.phase === "vote" || room.phase === "reveal") {
    state.answers = getPublicAnswersForRoom(room);
  }

  return state;
}

function emitRoom(room) {
  room.players.forEach((player) => {
    io.to(player.id).emit("room-updated", publicRoomState(room, player.id));
  });
}

function safeResetToLobby(room) {
  room.phase = "lobby";
  room.currentRound = null;
  room.questionsByPlayer = new Map();
  room.answers = new Map();
  room.votes = new Map();
  room.voteOpen = false;
  emitRoom(room);
}

function getRoomBySocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function buildAutomaticRound(room) {
  const questionSet = questions[Math.floor(Math.random() * questions.length)];
  const impostorIndex = Math.floor(Math.random() * room.players.length);
  return {
    questionSet,
    impostorId: room.players[impostorIndex].id
  };
}

function buildMasterRound(room) {
  const questionSet = sanitizeQuestionSet(room.masterSetup);
  return {
    questionSet,
    impostorId: room.masterSetup.impostorId
  };
}

loadCustomQuestions();

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }, cb) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    if (!cleanName) return cb?.({ ok: false, message: "Nome é obrigatório." });

    const code = makeCode();
    const room = {
      code,
      phase: "lobby",
      hostId: socket.id,
      players: [{ id: socket.id, name: cleanName }],
      impostorAwarenessMode: "hidden",
      roundMode: "automatic",
      masterSetup: {
        theme: "",
        mainQuestion: "",
        counterQuestion: "",
        impostorId: ""
      },
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
    cb?.({ ok: true, code, state: publicRoomState(room, socket.id) });
    emitRoom(room);
  });

  socket.on("join-room", ({ code, name }, cb) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const cleanName = String(name || "").trim().slice(0, 24);
    const room = rooms.get(roomCode);

    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (!cleanName) return cb?.({ ok: false, message: "Nome é obrigatório." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "A rodada já começou." });

    room.players.push({ id: socket.id, name: cleanName });
    if (room.roundMode === "master" && !room.masterSetup.impostorId) {
      room.masterSetup.impostorId = room.players[0]?.id || "";
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = cleanName;
    cb?.({ ok: true, code: roomCode, state: publicRoomState(room, socket.id) });
    emitRoom(room);
  });

  socket.on("impostor-mode:update", ({ mode }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode alterar o modo." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "O modo só pode ser alterado no lobby." });
    if (!impostorAwarenessModes.has(mode)) return cb?.({ ok: false, message: "Modo inválido." });

    room.impostorAwarenessMode = mode;
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("round-mode:update", ({ mode }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode alterar o modo." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "O modo da rodada só pode ser alterado no lobby." });
    if (!roundModes.has(mode)) return cb?.({ ok: false, message: "Modo de rodada inválido." });

    room.roundMode = mode;
    if (mode === "master" && !room.masterSetup.impostorId) {
      room.masterSetup.impostorId = room.players[0]?.id || "";
    }
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("master-setup:update", ({ theme, mainQuestion, counterQuestion, impostorId }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode editar o Modo Mestre." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "O Modo Mestre só pode ser editado no lobby." });
    if (room.roundMode !== "master") return cb?.({ ok: false, message: "Troque para Modo Mestre antes de editar." });

    const sanitized = sanitizeQuestionSet({ theme, mainQuestion, counterQuestion });
    if (impostorId && !room.players.some((player) => player.id === impostorId)) {
      return cb?.({ ok: false, message: "Impostor inválido." });
    }

    room.masterSetup = {
      theme: sanitized.theme,
      mainQuestion: sanitized.mainQuestion,
      counterQuestion: sanitized.counterQuestion,
      impostorId: impostorId || room.masterSetup.impostorId || room.players[0]?.id || ""
    };

    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("start-round", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode iniciar." });
    if (room.phase !== "lobby") return cb?.({ ok: false, message: "A rodada atual precisa terminar primeiro." });
    if (room.players.length < 3) return cb?.({ ok: false, message: "É preciso ter pelo menos 3 jogadores." });

    const roundSeed = room.roundMode === "master" ? buildMasterRound(room) : buildAutomaticRound(room);
    const questionSet = sanitizeQuestionSet(roundSeed.questionSet);
    if (!questionSet.theme || !questionSet.mainQuestion || !questionSet.counterQuestion) {
      return cb?.({ ok: false, message: "Complete tema, pergunta principal e contrapergunta antes de iniciar." });
    }
    if (!room.players.some((player) => player.id === roundSeed.impostorId)) {
      return cb?.({ ok: false, message: "Escolha um impostor válido antes de iniciar." });
    }

    room.phase = "question";
    room.currentRound = {
      theme: questionSet.theme,
      mainQuestion: questionSet.mainQuestion,
      counterQuestion: questionSet.counterQuestion,
      impostorId: roundSeed.impostorId,
      impostorAwarenessMode: room.impostorAwarenessMode,
      roundMode: room.roundMode,
      seatingOrder: shuffledPlayerIds(room.players),
      readyPlayers: new Set(),
      targetPlayersByPlayerId: new Map()
    };
    room.questionsByPlayer = new Map();
    room.answers = new Map();
    room.votes = new Map();
    room.voteOpen = false;

    if (room.roundMode === "master") {
      persistCustomQuestion(questionSet);
    }

    for (const player of room.players) {
      const isImpostor = player.id === room.currentRound.impostorId;
      const baseQuestion = isImpostor ? questionSet.counterQuestion : questionSet.mainQuestion;
      const targetPlayerName = randomTargetPlayerName(room, player.id);
      const question = applyQuestionTarget(baseQuestion, targetPlayerName);
      const groupQuestion = applyQuestionTarget(questionSet.mainQuestion, targetPlayerName);
      const { leftPlayerName, rightPlayerName } = getNeighborNames(room, player.id);
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
        leftPlayerName,
        rightPlayerName,
        groupQuestion: room.currentRound.impostorAwarenessMode === "known" && isImpostor ? groupQuestion : "",
        targetPlayerName: baseQuestion.includes("{{targetPlayerName}}") ? targetPlayerName : ""
      });
    }

    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("question:ready", ({ answer }, cb) => {
    const room = getRoomBySocket(socket);
    const player = room?.players.find((p) => p.id === socket.id);
    const cleanAnswer = String(answer || "").trim().slice(0, 120);

    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (!room.currentRound) return cb?.({ ok: false, message: "A rodada ainda não começou." });
    if (!player) return cb?.({ ok: false, message: "Jogador não encontrado na sala." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Não é possível marcar pronto agora." });
    if (!cleanAnswer) return cb?.({ ok: false, message: "Escreva uma resposta antes de ficar pronto." });

    room.answers.set(socket.id, cleanAnswer);
    room.currentRound.readyPlayers.add(socket.id);
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("open-voting", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, message: "Apenas o host pode abrir a votação." });
    if (room.phase !== "question") return cb?.({ ok: false, message: "Não é possível votar agora." });
    if (!allPlayersReady(room)) {
      return cb?.({ ok: false, message: "Todos os jogadores precisam estar prontos antes da votação." });
    }
    if (room.answers.size < room.players.length) {
      return cb?.({ ok: false, message: "Todos os jogadores precisam responder antes da votação." });
    }

    room.phase = "vote";
    room.votes = new Map();
    room.voteOpen = true;
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("cast-vote", ({ targetId }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
    if (room.phase !== "vote" || !room.voteOpen) return cb?.({ ok: false, message: "A votação não está aberta." });
    if (!room.players.some((player) => player.id === targetId)) return cb?.({ ok: false, message: "Jogador inválido." });
    if (room.votes.has(socket.id)) return cb?.({ ok: false, message: "Você já votou nesta rodada." });

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

      const impostor = room.players.find((player) => player.id === room.currentRound.impostorId);
      const mostVoted = room.players.find((player) => player.id === mostVotedId);
      const found = mostVotedId === room.currentRound.impostorId;

      room.phase = "reveal";
      room.voteOpen = false;
      io.to(room.code).emit("reveal-round", {
        impostorName: impostor?.name || "",
        mostVotedName: mostVoted?.name || "",
        found,
        theme: room.currentRound.theme,
        mainQuestion: publicQuestionText(room.currentRound.mainQuestion),
        counterQuestion: publicQuestionText(room.currentRound.counterQuestion),
        answers: getPublicAnswersForRoom(room),
        votes: Array.from(room.votes.entries())
      });
      emitRoom(room);
    }

    cb?.({ ok: true });
  });

  socket.on("new-round", (_, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb?.({ ok: false, message: "Sala não encontrada." });
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

    if (room.masterSetup.impostorId === socket.id) {
      room.masterSetup.impostorId = room.players[0]?.id || "";
    }

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
