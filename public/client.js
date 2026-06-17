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
  playerList: document.getElementById("playerList"),
  startRoundActions: document.getElementById("startRoundActions"),
  startRoundBtn: document.getElementById("startRoundBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  themeText: document.getElementById("themeText"),
  privateQuestionPanel: document.getElementById("privateQuestionPanel"),
  roleLabel: document.getElementById("roleLabel"),
  privateQuestion: document.getElementById("privateQuestion"),
  questionReadyBtn: document.getElementById("questionReadyBtn"),
  questionGuardedMessage: document.getElementById("questionGuardedMessage"),
  readyProgressText: document.getElementById("readyProgressText"),
  answerInput: document.getElementById("answerInput"),
  openVotingActions: document.getElementById("openVotingActions"),
  openVotingBtn: document.getElementById("openVotingBtn"),
  questionMessage: document.getElementById("questionMessage"),
  voteProgress: document.getElementById("voteProgress"),
  voteButtons: document.getElementById("voteButtons"),
  voteTableLayout: document.getElementById("voteTableLayout"),
  voteAnswerList: document.getElementById("voteAnswerList"),
  voteMessage: document.getElementById("voteMessage"),
  impostorName: document.getElementById("impostorName"),
  mostVotedName: document.getElementById("mostVotedName"),
  foundText: document.getElementById("foundText"),
  revealTheme: document.getElementById("revealTheme"),
  revealTableLayout: document.getElementById("revealTableLayout"),
  mainQuestionText: document.getElementById("mainQuestionText"),
  counterQuestionText: document.getElementById("counterQuestionText"),
  revealAnswerList: document.getElementById("revealAnswerList"),
  newRoundActions: document.getElementById("newRoundActions"),
  newRoundBtn: document.getElementById("newRoundBtn")
};

let currentRoom = null;
let myName = "";
let myId = null;
let myQuestion = "";
let myRoleLabel = "";
let myQuestionReady = false;
let lastState = null;
let publicAnswers = [];
let tablePlayers = [];

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
}

function setMessage(target, text, isError = false) {
  target.textContent = text || "";
  target.style.color = isError ? "#ff7c91" : "";
}

function renderPlayers(state) {
  els.playerList.innerHTML = "";
  state.players.forEach((player) => {
    const li = document.createElement("li");
    li.textContent = player.id === state.hostId ? `${player.name} (host)` : player.name;
    els.playerList.appendChild(li);
  });
}

function renderVoteButtons(state) {
  els.voteButtons.innerHTML = "";
  state.players.forEach((player) => {
    const button = document.createElement("button");
    button.textContent = `Votar em ${player.name}`;
    button.onclick = () => socket.emit("cast-vote", { targetId: player.id }, (response) => {
      if (!response?.ok) setMessage(els.voteMessage, response?.message || "Nao foi possivel votar.", true);
      else setMessage(els.voteMessage, "Voto enviado.");
    });
    els.voteButtons.appendChild(button);
  });
}

function renderAnswerList(target, answers) {
  target.innerHTML = "";
  if (!answers.length) {
    const li = document.createElement("li");
    li.className = "empty-answer";
    li.textContent = "Nenhuma resposta enviada ainda.";
    target.appendChild(li);
    return;
  }

  answers.forEach(({ playerName, answer }) => {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    const text = document.createElement("span");
    name.textContent = playerName;
    text.textContent = answer;
    li.append(name, text);
    target.appendChild(li);
  });
}

function renderAllAnswerLists(answers = publicAnswers) {
  renderAnswerList(els.voteAnswerList, answers);
  renderAnswerList(els.revealAnswerList, answers);
}

function renderRoleLabel(label) {
  els.roleLabel.textContent = label || "";
  els.roleLabel.classList.toggle("hidden", !label);
}

function renderQuestionPrivacy() {
  els.privateQuestionPanel.classList.toggle("hidden", myQuestionReady);
  els.privateQuestion.classList.toggle("hidden", myQuestionReady);
  els.roleLabel.classList.toggle("hidden", myQuestionReady || !myRoleLabel);
  els.questionReadyBtn.classList.toggle("hidden", myQuestionReady);
  els.questionGuardedMessage.classList.toggle("hidden", !myQuestionReady);
}

function updateReadyButton() {
  els.questionReadyBtn.disabled = myQuestionReady || !els.answerInput.value.trim();
}

function renderTableLayout(target, players) {
  target.innerHTML = "";
  target.classList.toggle("hidden", !players.length);
  if (!players.length) return;

  const center = document.createElement("div");
  center.className = "table-center";
  center.textContent = "Mesa";
  target.appendChild(center);

  players.forEach((player, index) => {
    const angle = -90 + (360 / players.length) * index;
    const radians = (angle * Math.PI) / 180;
    const x = 50 + Math.cos(radians) * 38;
    const y = 50 + Math.sin(radians) * 38;
    const bubble = document.createElement("div");
    bubble.className = "table-player";
    bubble.style.left = `${x}%`;
    bubble.style.top = `${y}%`;
    bubble.textContent = player.name;
    target.appendChild(bubble);
  });
}

function renderAllTableLayouts(players = tablePlayers) {
  renderTableLayout(els.voteTableLayout, players);
  renderTableLayout(els.revealTableLayout, players);
}

function updateButtons(state) {
  const isHost = state.hostId === myId;
  els.startRoundBtn.classList.toggle("hidden", !isHost);
  els.openVotingBtn.classList.toggle("hidden", !isHost || !state.allPlayersReady);
  els.newRoundBtn.classList.toggle("hidden", !isHost);
  els.startRoundActions.classList.toggle("hidden", !isHost);
  els.openVotingActions.classList.toggle("hidden", !isHost || !state.allPlayersReady);
  els.newRoundActions.classList.toggle("hidden", !isHost);
  els.impostorModeSelect.disabled = !isHost || state.phase !== "lobby";
}

function renderState(state) {
  lastState = state;
  currentRoom = state.code;
  renderPlayers(state);
  updateButtons(state);
  els.lobbyCode.textContent = state.code || "";
  els.hostName.textContent = state.hostName || "";
  els.impostorModeSelect.value = state.impostorAwarenessMode || "hidden";
  tablePlayers = state.tablePlayers || [];
  renderAllTableLayouts();

  if (state.phase === "lobby") {
    showScreen("lobby");
    setMessage(els.lobbyMessage, "");
    myRoleLabel = "";
    myQuestionReady = false;
    renderRoleLabel("");
    renderQuestionPrivacy();
    tablePlayers = [];
    renderAllTableLayouts();
    publicAnswers = [];
    renderAllAnswerLists();
    els.answerInput.value = "";
    els.answerInput.disabled = false;
    updateReadyButton();
    setMessage(els.questionMessage, "");
  } else if (state.phase === "question") {
    showScreen("question");
    els.themeText.textContent = state.theme || "";
    els.privateQuestion.textContent = state.questionText || myQuestion || "";
    renderRoleLabel(myRoleLabel);
    renderQuestionPrivacy();
    els.readyProgressText.textContent = `Prontos: ${state.readyProgress || "0/0"}`;
    els.answerInput.disabled = myQuestionReady;
    updateReadyButton();
    renderAllAnswerLists();
  } else if (state.phase === "vote") {
    showScreen("vote");
    els.answerInput.disabled = true;
    renderAllAnswerLists();
    els.voteProgress.textContent = `Votos: ${state.voteProgress}`;
    renderVoteButtons(state);
  } else if (state.phase === "reveal") {
    showScreen("reveal");
  }
}

els.createRoomBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  myName = name;
  socket.emit("create-room", { name }, (response) => {
    if (!response?.ok) return setMessage(els.homeMessage, response?.message || "Nao foi possivel criar.", true);
    myId = socket.id;
    setMessage(els.homeMessage, `Sala criada: ${response.code}`);
    renderState(response.state);
  });
};

els.joinRoomBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  const code = els.roomCodeInput.value.trim().toUpperCase();
  myName = name;
  socket.emit("join-room", { name, code }, (response) => {
    if (!response?.ok) return setMessage(els.homeMessage, response?.message || "Nao foi possivel entrar.", true);
    myId = socket.id;
    setMessage(els.homeMessage, `Entrou na sala ${response.code}`);
    renderState(response.state);
  });
};

els.startRoundBtn.onclick = () => socket.emit("start-round", {}, (response) => {
  if (!response?.ok) setMessage(els.lobbyMessage, response?.message || "Nao foi possivel iniciar.", true);
});

els.impostorModeSelect.onchange = () => {
  socket.emit("impostor-mode:update", { mode: els.impostorModeSelect.value }, (response) => {
    if (!response?.ok) {
      setMessage(els.lobbyMessage, response?.message || "Nao foi possivel alterar o modo.", true);
      if (lastState) els.impostorModeSelect.value = lastState.impostorAwarenessMode || "hidden";
      return;
    }
    setMessage(els.lobbyMessage, "");
  });
};

els.answerInput.oninput = updateReadyButton;

els.questionReadyBtn.onclick = () => {
  socket.emit("question:ready", { answer: els.answerInput.value }, (response) => {
    if (!response?.ok) return setMessage(els.questionMessage, response?.message || "Nao foi possivel marcar pronto.", true);
    myQuestionReady = true;
    renderQuestionPrivacy();
    els.answerInput.disabled = true;
    updateReadyButton();
    setMessage(els.questionMessage, "");
  });
};

els.openVotingBtn.onclick = () => socket.emit("open-voting", {}, (response) => {
  if (!response?.ok) setMessage(els.questionMessage, response?.message || "Nao foi possivel abrir a votacao.", true);
  else setMessage(els.questionMessage, "");
});

els.newRoundBtn.onclick = () => socket.emit("new-round", {}, (response) => {
  if (!response?.ok) setMessage(els.lobbyMessage, response?.message || "Nao foi possivel reiniciar.", true);
});

socket.on("private-question", ({ theme, question, roleLabel }) => {
  myQuestion = question;
  myRoleLabel = roleLabel || "";
  myQuestionReady = false;
  els.themeText.textContent = theme || "";
  els.privateQuestion.textContent = question || "";
  renderRoleLabel(myRoleLabel);
  renderQuestionPrivacy();
  els.answerInput.value = "";
  els.answerInput.disabled = false;
  updateReadyButton();
  setMessage(els.questionMessage, "");
  showScreen("question");
});

socket.on("answer:update", (answers) => {
  publicAnswers = answers || [];
  renderAllAnswerLists();
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
  els.foundText.textContent = result.found ? "Sim" : "Nao";
  els.revealTheme.textContent = result.theme || "";
  els.mainQuestionText.textContent = result.mainQuestion || "";
  els.counterQuestionText.textContent = result.counterQuestion || "";
  publicAnswers = result.answers || publicAnswers;
  renderAllAnswerLists(publicAnswers);
});

showScreen("home");
