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
  playerList: document.getElementById("playerList"),
  startRoundBtn: document.getElementById("startRoundBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  themeText: document.getElementById("themeText"),
  privateQuestion: document.getElementById("privateQuestion"),
  answerInput: document.getElementById("answerInput"),
  submitAnswerBtn: document.getElementById("submitAnswerBtn"),
  answerMessage: document.getElementById("answerMessage"),
  answerList: document.getElementById("answerList"),
  openVotingBtn: document.getElementById("openVotingBtn"),
  questionMessage: document.getElementById("questionMessage"),
  voteProgress: document.getElementById("voteProgress"),
  voteButtons: document.getElementById("voteButtons"),
  voteAnswerList: document.getElementById("voteAnswerList"),
  voteMessage: document.getElementById("voteMessage"),
  impostorName: document.getElementById("impostorName"),
  mostVotedName: document.getElementById("mostVotedName"),
  foundText: document.getElementById("foundText"),
  revealTheme: document.getElementById("revealTheme"),
  mainQuestionText: document.getElementById("mainQuestionText"),
  counterQuestionText: document.getElementById("counterQuestionText"),
  revealAnswerList: document.getElementById("revealAnswerList"),
  newRoundBtn: document.getElementById("newRoundBtn")
};

let currentRoom = null;
let myName = "";
let myId = null;
let myQuestion = "";
let lastState = null;
let publicAnswers = [];

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
  renderAnswerList(els.answerList, answers);
  renderAnswerList(els.voteAnswerList, answers);
  renderAnswerList(els.revealAnswerList, answers);
}

function updateButtons(state) {
  const isHost = state.hostId === myId;
  els.startRoundBtn.classList.toggle("hidden", !isHost);
  els.openVotingBtn.classList.toggle("hidden", !isHost);
  els.newRoundBtn.classList.toggle("hidden", !isHost);
}

function renderState(state) {
  lastState = state;
  currentRoom = state.code;
  renderPlayers(state);
  updateButtons(state);
  els.lobbyCode.textContent = state.code || "";
  els.hostName.textContent = state.hostName || "";

  if (state.phase === "lobby") {
    showScreen("lobby");
    setMessage(els.lobbyMessage, "");
    publicAnswers = [];
    renderAllAnswerLists();
    els.answerInput.value = "";
    els.answerInput.disabled = false;
    els.submitAnswerBtn.disabled = false;
    setMessage(els.answerMessage, "");
    setMessage(els.questionMessage, "");
  } else if (state.phase === "question") {
    showScreen("question");
    els.themeText.textContent = state.theme || "";
    els.privateQuestion.textContent = state.questionText || myQuestion || "";
    els.answerInput.disabled = false;
    els.submitAnswerBtn.disabled = false;
    renderAllAnswerLists();
  } else if (state.phase === "vote") {
    showScreen("vote");
    els.answerInput.disabled = true;
    els.submitAnswerBtn.disabled = true;
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

els.submitAnswerBtn.onclick = () => {
  socket.emit("answer:send", { roomCode: currentRoom, answer: els.answerInput.value }, (response) => {
    if (!response?.ok) return setMessage(els.answerMessage, response?.message || "Nao foi possivel enviar.", true);
    setMessage(els.answerMessage, "Resposta enviada.");
  });
};

els.openVotingBtn.onclick = () => socket.emit("open-voting", {}, (response) => {
  if (!response?.ok) setMessage(els.questionMessage, response?.message || "Nao foi possivel abrir a votacao.", true);
  else setMessage(els.questionMessage, "");
});

els.newRoundBtn.onclick = () => socket.emit("new-round", {}, (response) => {
  if (!response?.ok) setMessage(els.lobbyMessage, response?.message || "Nao foi possivel reiniciar.", true);
});

socket.on("private-question", ({ theme, question }) => {
  myQuestion = question;
  els.themeText.textContent = theme || "";
  els.privateQuestion.textContent = question || "";
  els.answerInput.value = "";
  els.answerInput.disabled = false;
  els.submitAnswerBtn.disabled = false;
  setMessage(els.answerMessage, "");
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
