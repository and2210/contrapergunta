const socket = io();

const screens = {
  home: document.getElementById("homeScreen"),
  lobby: document.getElementById("lobbyScreen"),
  question: document.getElementById("questionScreen"),
  vote: document.getElementById("voteScreen"),
  reveal: document.getElementById("revealScreen")
};

const els = {
  nameInput: document.getElementById("nameInput"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  homeMessage: document.getElementById("homeMessage"),
  lobbyCode: document.getElementById("lobbyCode"),
  hostName: document.getElementById("hostName"),
  impostorModeSelect: document.getElementById("impostorModeSelect"),
  roundModeSelect: document.getElementById("roundModeSelect"),
  masterSetupCard: document.getElementById("masterSetupCard"),
  masterThemeInput: document.getElementById("masterThemeInput"),
  masterMainQuestionInput: document.getElementById("masterMainQuestionInput"),
  masterCounterQuestionInput: document.getElementById("masterCounterQuestionInput"),
  masterImpostorSelect: document.getElementById("masterImpostorSelect"),
  saveMasterSetupBtn: document.getElementById("saveMasterSetupBtn"),
  playerCountText: document.getElementById("playerCountText"),
  playerList: document.getElementById("playerList"),
  startRoundActions: document.getElementById("startRoundActions"),
  startRoundBtn: document.getElementById("startRoundBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  themeText: document.getElementById("themeText"),
  questionTableLayout: document.getElementById("questionTableLayout"),
  privateQuestionPanel: document.getElementById("privateQuestionPanel"),
  roleLabel: document.getElementById("roleLabel"),
  privateQuestion: document.getElementById("privateQuestion"),
  leftHint: document.getElementById("leftHint"),
  rightHint: document.getElementById("rightHint"),
  seatHint: document.getElementById("seatHint"),
  groupQuestionCard: document.getElementById("groupQuestionCard"),
  groupQuestionText: document.getElementById("groupQuestionText"),
  questionReadyBtn: document.getElementById("questionReadyBtn"),
  questionGuardedMessage: document.getElementById("questionGuardedMessage"),
  readyProgressText: document.getElementById("readyProgressText"),
  answerInput: document.getElementById("answerInput"),
  openVotingActions: document.getElementById("openVotingActions"),
  openVotingBtn: document.getElementById("openVotingBtn"),
  questionMessage: document.getElementById("questionMessage"),
  voteProgress: document.getElementById("voteProgress"),
  voteTableLayout: document.getElementById("voteTableLayout"),
  voteRoleLabel: document.getElementById("voteRoleLabel"),
  votePrivateQuestion: document.getElementById("votePrivateQuestion"),
  voteGroupQuestionCard: document.getElementById("voteGroupQuestionCard"),
  voteGroupQuestionText: document.getElementById("voteGroupQuestionText"),
  confirmVoteBtn: document.getElementById("confirmVoteBtn"),
  voteMessage: document.getElementById("voteMessage"),
  impostorName: document.getElementById("impostorName"),
  mostVotedName: document.getElementById("mostVotedName"),
  foundText: document.getElementById("foundText"),
  revealTheme: document.getElementById("revealTheme"),
  revealOutcomeBadge: document.getElementById("revealOutcomeBadge"),
  revealTableLayout: document.getElementById("revealTableLayout"),
  mainQuestionText: document.getElementById("mainQuestionText"),
  counterQuestionText: document.getElementById("counterQuestionText"),
  newRoundActions: document.getElementById("newRoundActions"),
  newRoundBtn: document.getElementById("newRoundBtn")
};

let myId = null;
let myQuestion = "";
let myRoleLabel = "";
let myQuestionReady = false;
let myLeftPlayerName = "";
let myRightPlayerName = "";
let myGroupQuestion = "";
let publicAnswers = [];
let tablePlayers = [];
let lastState = null;
let selectedVoteTargetId = null;
let hasVoted = false;
let masterImpostorId = "";

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
}

function setMessage(target, text, isError = false) {
  target.textContent = text || "";
  target.style.color = isError ? "#ff96a9" : "";
}

function resetVoteState() {
  selectedVoteTargetId = null;
  hasVoted = false;
  els.confirmVoteBtn.disabled = true;
}

function renderPlayers(state) {
  els.playerList.innerHTML = "";
  els.playerCountText.textContent = `${state.players.length} jogadores`;

  state.players.forEach((player) => {
    const li = document.createElement("li");
    li.className = "player-row";

    const badge = document.createElement("span");
    badge.className = "player-avatar";
    badge.textContent = player.name.slice(0, 1).toUpperCase();

    const playerText = document.createElement("div");
    playerText.className = "player-text";

    const name = document.createElement("strong");
    name.textContent = player.name;

    const meta = document.createElement("span");
    meta.className = "player-meta";
    meta.textContent = player.id === state.hostId ? "Host da sala" : "Jogador conectado";

    playerText.append(name, meta);
    li.append(badge, playerText);
    els.playerList.appendChild(li);
  });
}

function populateMasterImpostorSelect(players) {
  els.masterImpostorSelect.innerHTML = "";
  players.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    option.selected = player.id === masterImpostorId;
    els.masterImpostorSelect.appendChild(option);
  });

  if (!masterImpostorId && players.length) {
    masterImpostorId = players[0].id;
  }
  if (masterImpostorId) {
    els.masterImpostorSelect.value = masterImpostorId;
  }
}

function renderRoleLabel(target, label) {
  target.textContent = label || "";
  target.classList.toggle("hidden", !label);
}

function renderSeatHints() {
  const hasHints = Boolean(myLeftPlayerName || myRightPlayerName);
  els.seatHint.classList.toggle("hidden", !hasHints || myQuestionReady);
  els.leftHint.textContent = myLeftPlayerName ? `À esquerda: ${myLeftPlayerName}` : "";
  els.rightHint.textContent = myRightPlayerName ? `À direita: ${myRightPlayerName}` : "";
}

function renderGroupQuestionCards() {
  const hasGroupQuestion = Boolean(myGroupQuestion);
  els.groupQuestionCard.classList.toggle("hidden", !hasGroupQuestion || myQuestionReady);
  els.voteGroupQuestionCard.classList.toggle("hidden", !hasGroupQuestion);
  els.groupQuestionText.textContent = myGroupQuestion || "";
  els.voteGroupQuestionText.textContent = myGroupQuestion || "";
}

function renderQuestionPrivacy() {
  els.privateQuestionPanel.classList.toggle("hidden", myQuestionReady);
  els.questionGuardedMessage.classList.toggle("hidden", !myQuestionReady);
  renderSeatHints();
  renderGroupQuestionCards();
}

function updateReadyButton() {
  els.questionReadyBtn.disabled = myQuestionReady || !els.answerInput.value.trim();
}

function getTablePosition(index, total) {
  if (total === 3) {
    return [
      { x: 50, y: 15 },
      { x: 22, y: 80 },
      { x: 78, y: 80 }
    ][index];
  }

  if (total === 4) {
    return [
      { x: 50, y: 13 },
      { x: 84, y: 50 },
      { x: 50, y: 87 },
      { x: 16, y: 50 }
    ][index];
  }

  const angle = -90 + (360 / total) * index;
  const radians = (angle * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * 37,
    y: 50 + Math.sin(radians) * 37
  };
}

function findAnswerForPlayer(playerId) {
  return publicAnswers.find((item) => item.playerId === playerId)?.answer || "";
}

function submitVote() {
  if (hasVoted || !selectedVoteTargetId) return;

  hasVoted = true;
  els.confirmVoteBtn.disabled = true;
  renderAllTableLayouts(tablePlayers);

  socket.emit("cast-vote", { targetId: selectedVoteTargetId }, (response) => {
    if (!response?.ok) {
      hasVoted = false;
      els.confirmVoteBtn.disabled = false;
      setMessage(els.voteMessage, response?.message || "Não foi possível votar.", true);
      renderAllTableLayouts(tablePlayers);
      return;
    }

    setMessage(els.voteMessage, "Voto enviado.");
    renderAllTableLayouts(tablePlayers);
  });
}

function selectVoteTarget(targetId) {
  if (hasVoted) return;
  selectedVoteTargetId = targetId;
  els.confirmVoteBtn.disabled = false;
  setMessage(els.voteMessage, "");
  renderAllTableLayouts(tablePlayers);
}

function renderTableLayout(target, players, options = {}) {
  target.innerHTML = "";
  target.classList.toggle("hidden", !players.length);
  if (!players.length) return;

  const center = document.createElement("div");
  center.className = "table-center";
  center.innerHTML = "<span>Mesa</span><small>Observe, compare e decida</small>";
  target.appendChild(center);

  players.forEach((player, index) => {
    const position = getTablePosition(index, players.length);
    const wrapper = document.createElement("div");
    wrapper.className = "table-seat";
    wrapper.style.left = `${position.x}%`;
    wrapper.style.top = `${position.y}%`;

    const bubble = document.createElement(options.selectable ? "button" : "div");
    bubble.className = "table-player";
    bubble.dataset.playerId = player.id;
    bubble.classList.toggle("is-clickable", Boolean(options.selectable));
    bubble.classList.toggle("is-selected", selectedVoteTargetId === player.id);
    bubble.classList.toggle("is-locked", hasVoted);

    const avatar = document.createElement("span");
    avatar.className = "table-player-avatar";
    avatar.textContent = player.name.slice(0, 1).toUpperCase();

    const name = document.createElement("span");
    name.className = "table-player-name";
    name.textContent = player.name;

    bubble.append(avatar, name);

    if (options.selectable) {
      bubble.type = "button";
      bubble.disabled = hasVoted;
      bubble.onclick = () => selectVoteTarget(player.id);
    }

    wrapper.appendChild(bubble);

    if (options.showAnswers) {
      const answerText = findAnswerForPlayer(player.id);
      if (answerText) {
        const answerBubble = document.createElement("div");
        answerBubble.className = "answer-bubble";
        answerBubble.textContent = answerText;
        wrapper.appendChild(answerBubble);
      }
    }

    target.appendChild(wrapper);
  });
}

function renderAllTableLayouts(players = tablePlayers) {
  renderTableLayout(els.questionTableLayout, players);
  renderTableLayout(els.voteTableLayout, players, { selectable: true, showAnswers: true });
  renderTableLayout(els.revealTableLayout, players, { showAnswers: true });
}

function updateButtons(state) {
  const isHost = state.hostId === myId;
  const masterMode = state.roundMode === "master";

  els.startRoundActions.classList.toggle("hidden", !isHost);
  els.startRoundBtn.classList.toggle("hidden", !isHost);
  els.newRoundActions.classList.toggle("hidden", !isHost);
  els.newRoundBtn.classList.toggle("hidden", !isHost);
  els.openVotingActions.classList.toggle("hidden", !isHost || !state.allPlayersReady);
  els.openVotingBtn.classList.toggle("hidden", !isHost || !state.allPlayersReady);
  els.impostorModeSelect.disabled = !isHost || state.phase !== "lobby";
  els.roundModeSelect.disabled = !isHost || state.phase !== "lobby";
  els.masterSetupCard.classList.toggle("hidden", !masterMode);
  els.masterThemeInput.disabled = !isHost || state.phase !== "lobby" || !masterMode;
  els.masterMainQuestionInput.disabled = !isHost || state.phase !== "lobby" || !masterMode;
  els.masterCounterQuestionInput.disabled = !isHost || state.phase !== "lobby" || !masterMode;
  els.masterImpostorSelect.disabled = !isHost || state.phase !== "lobby" || !masterMode;
  els.saveMasterSetupBtn.disabled = !isHost || state.phase !== "lobby" || !masterMode;
}

function renderRevealOutcome(found) {
  els.revealOutcomeBadge.textContent = found ? "Grupo acertou" : "Grupo errou";
  els.revealOutcomeBadge.classList.toggle("success-pill", Boolean(found));
  els.revealOutcomeBadge.classList.toggle("danger-pill", !found);
}

function syncMasterSetupFromState(state) {
  const setup = state.masterSetup || {};
  els.masterThemeInput.value = setup.theme || "";
  els.masterMainQuestionInput.value = setup.mainQuestion || "";
  els.masterCounterQuestionInput.value = setup.counterQuestion || "";
  if (setup.impostorId) {
    masterImpostorId = setup.impostorId;
  }
  populateMasterImpostorSelect(state.players || []);
}

function renderState(state) {
  lastState = state;
  tablePlayers = state.tablePlayers || [];
  publicAnswers = Array.isArray(state.answers) ? state.answers : [];
  renderPlayers(state);
  syncMasterSetupFromState(state);
  updateButtons(state);
  renderAllTableLayouts(tablePlayers);
  els.lobbyCode.textContent = state.code || "";
  els.hostName.textContent = state.hostName || "";
  els.impostorModeSelect.value = state.impostorAwarenessMode || "hidden";
  els.roundModeSelect.value = state.roundMode || "automatic";

  if (state.phase === "lobby") {
    resetVoteState();
    myRoleLabel = "";
    myQuestionReady = false;
    myQuestion = "";
    myLeftPlayerName = "";
    myRightPlayerName = "";
    myGroupQuestion = "";
    publicAnswers = [];
    tablePlayers = [];
    els.answerInput.value = "";
    els.answerInput.disabled = false;
    renderRoleLabel(els.roleLabel, "");
    renderRoleLabel(els.voteRoleLabel, "");
    renderQuestionPrivacy();
    renderAllTableLayouts([]);
    setMessage(els.lobbyMessage, "");
    setMessage(els.questionMessage, "");
    setMessage(els.voteMessage, "");
    showScreen("lobby");
    return;
  }

  if (state.phase === "question") {
    showScreen("question");
    els.themeText.textContent = state.theme || "";
    els.privateQuestion.textContent = myQuestion || "";
    els.readyProgressText.textContent = `Prontos: ${state.readyProgress || "0/0"}`;
    els.answerInput.disabled = myQuestionReady;
    renderRoleLabel(els.roleLabel, myRoleLabel);
    renderQuestionPrivacy();
    updateReadyButton();
    return;
  }

  if (state.phase === "vote") {
    showScreen("vote");
    els.voteProgress.textContent = `Votos: ${state.voteProgress}`;
    els.votePrivateQuestion.textContent = myQuestion || "";
    renderRoleLabel(els.voteRoleLabel, myRoleLabel);
    renderGroupQuestionCards();
    renderAllTableLayouts(tablePlayers);
    els.confirmVoteBtn.disabled = hasVoted || !selectedVoteTargetId;
    return;
  }

  if (state.phase === "reveal") {
    showScreen("reveal");
  }
}

els.createRoomBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  socket.emit("create-room", { name }, (response) => {
    if (!response?.ok) {
      return setMessage(els.homeMessage, response?.message || "Não foi possível criar.", true);
    }

    myId = socket.id;
    renderState(response.state);
    setMessage(els.homeMessage, `Sala criada: ${response.code}`);
  });
};

els.joinRoomBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  const code = els.roomCodeInput.value.trim().toUpperCase();
  socket.emit("join-room", { name, code }, (response) => {
    if (!response?.ok) {
      return setMessage(els.homeMessage, response?.message || "Não foi possível entrar.", true);
    }

    myId = socket.id;
    renderState(response.state);
    setMessage(els.homeMessage, `Entrou na sala ${response.code}`);
  });
};

els.startRoundBtn.onclick = () => {
  socket.emit("start-round", {}, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Não foi possível iniciar.", true);
    }
  });
};

els.impostorModeSelect.onchange = () => {
  socket.emit("impostor-mode:update", { mode: els.impostorModeSelect.value }, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Não foi possível alterar o modo.", true);
      if (lastState) els.impostorModeSelect.value = lastState.impostorAwarenessMode || "hidden";
      return;
    }

    setMessage(els.lobbyMessage, "");
  });
};

els.roundModeSelect.onchange = () => {
  socket.emit("round-mode:update", { mode: els.roundModeSelect.value }, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Não foi possível alterar o modo da rodada.", true);
      if (lastState) els.roundModeSelect.value = lastState.roundMode || "automatic";
      return;
    }

    setMessage(els.lobbyMessage, "");
  });
};

els.saveMasterSetupBtn.onclick = () => {
  masterImpostorId = els.masterImpostorSelect.value;
  socket.emit("master-setup:update", {
    theme: els.masterThemeInput.value,
    mainQuestion: els.masterMainQuestionInput.value,
    counterQuestion: els.masterCounterQuestionInput.value,
    impostorId: masterImpostorId
  }, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Não foi possível salvar o Modo Mestre.", true);
      return;
    }

    setMessage(els.lobbyMessage, "Modo Mestre atualizado.");
  });
};

els.answerInput.oninput = updateReadyButton;
els.confirmVoteBtn.onclick = submitVote;

els.questionReadyBtn.onclick = () => {
  socket.emit("question:ready", { answer: els.answerInput.value }, (response) => {
    if (!response?.ok) {
      return setMessage(els.questionMessage, response?.message || "Não foi possível enviar.", true);
    }

    myQuestionReady = true;
    els.answerInput.disabled = true;
    renderQuestionPrivacy();
    updateReadyButton();
    setMessage(els.questionMessage, "");
  });
};

els.openVotingBtn.onclick = () => {
  socket.emit("open-voting", {}, (response) => {
    if (!response?.ok) {
      setMessage(els.questionMessage, response?.message || "Não foi possível abrir a votação.", true);
      return;
    }

    setMessage(els.questionMessage, "");
  });
};

els.newRoundBtn.onclick = () => {
  socket.emit("new-round", {}, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Não foi possível reiniciar.", true);
    }
  });
};

socket.on("private-question", ({
  theme,
  question,
  roleLabel,
  leftPlayerName,
  rightPlayerName,
  groupQuestion
}) => {
  resetVoteState();
  myQuestion = question || "";
  myRoleLabel = roleLabel || "";
  myQuestionReady = false;
  myLeftPlayerName = leftPlayerName || "";
  myRightPlayerName = rightPlayerName || "";
  myGroupQuestion = groupQuestion || "";
  publicAnswers = [];
  els.themeText.textContent = theme || "";
  els.privateQuestion.textContent = myQuestion;
  els.votePrivateQuestion.textContent = myQuestion;
  els.answerInput.value = "";
  els.answerInput.disabled = false;
  renderRoleLabel(els.roleLabel, myRoleLabel);
  renderRoleLabel(els.voteRoleLabel, myRoleLabel);
  renderQuestionPrivacy();
  updateReadyButton();
  setMessage(els.questionMessage, "");
  setMessage(els.voteMessage, "");
  showScreen("question");
});

socket.on("room-updated", (state) => {
  myId = socket.id;
  renderState(state);
});

socket.on("vote-progress", ({ count, total }) => {
  els.voteProgress.textContent = `Votos: ${count}/${total}`;
});

socket.on("reveal-round", (result) => {
  showScreen("reveal");
  els.impostorName.textContent = result.impostorName || "";
  els.mostVotedName.textContent = result.mostVotedName || "";
  els.foundText.textContent = result.found ? "Sim" : "Não";
  els.revealTheme.textContent = result.theme || "";
  els.mainQuestionText.textContent = result.mainQuestion || "";
  els.counterQuestionText.textContent = result.counterQuestion || "";
  publicAnswers = result.answers || [];
  renderRevealOutcome(result.found);
  renderAllTableLayouts(tablePlayers);
});

showScreen("home");
