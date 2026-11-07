// Project Club: multiplayer hospedado no PRÓPRIO Project Club (namespace
// /sled do Socket.IO, mesma origem — ver server/src/sockets/sledRacing.js).
// O servidor externo original (ep8script) foi removido; agora a sala de
// espera, a contagem de 15s e o repasse das jogadas rodam aqui. Se o
// Socket.IO não carregar (sem rede), "server" vira um objeto vazio e o jogo
// cai no modo solo, sem travar nada.
var players = [], startTimer = setInterval
// Torneio (chaveamento até 8): estado local — ver tournament_* abaixo.
var tournament = { active: false, score: 0, stage: null }
var hasIO = (typeof io === "function")
var multiplayer = hasIO
var server = hasIO
	? io("/sled", {
		autoConnect: false,
		reconnection: false,
		timeout: 6000,
		transports: ["websocket", "polling"],
		// Nome de exibição vindo do Project Club (?name=), lido na hora de conectar.
		auth: function(cb) { cb({ name: (typeof username !== "undefined" ? username : "") }) }
	})
	: { connect: function() {}, emit: function() {}, on: function() {}, once: function() {}, off: function() {} }

// Não deu pra falar com o servidor (offline, ou demorou demais): joga sozinho.
if(hasIO) {
	server.on("connect_error", function() {
		if(multiplayer && app.currentState() == "Lobby") {
			multiplayer = false
			$(".server-status .online").toggleClass("offline online")
			Init()
		}
	})
}

// The room is updated - start the countdown if necessary
function updateRoom(count) {
	$(".starting").remove()
	// Show the players in the room
	$(".waiting div").text("Esperando jogadores... ("+players.length+"/4)")
	if(count) {
		// Do the countdown
		startTimer = setInterval(function() {
			// Show the current countdown number
			if($(".starting").length) {
				$(".starting").text(count)
			}
			else {
				$(".waiting").append('<div class="starting">'+count+'</div>')
			}
			count--
			if(count < 0) {
				LoadMap()
			}
		}, 1000)
		return
	}
	$(".waiting").append('<div class="starting"><span class="solo">Jogar sozinho</span><span class="tourney">Torneio (até 8)</span></div>')
}

// ---- Torneio ----
function tournamentWaitingText(t) {
	$(".starting").remove()
	var txt = "Torneio: " + t.count + "/" + t.max + " inscritos"
	if(t.seconds > 0) txt += " · começa em " + t.seconds + "s"
	else if(t.count < t.min) txt += " · faltam " + (t.min - t.count) + " pra abrir a contagem"
	$(".waiting div").text(txt)
	$(".waiting").append('<div class="starting"><span class="leave-tourney">Sair do torneio</span></div>')
}
server.on("tournament_update", function(t) {
	if(t && t.full) { $(".waiting div").text("Torneios lotados agora — tente de novo em instantes."); return }
	if(app.currentState() == "Lobby") tournamentWaitingText(t)
})
// Nova corrida do torneio (bateria ou final): prepara a arena; o
// game_connected + contagem chegam logo em seguida.
server.on("tournament_stage", function(st) {
	tournament.active = true
	tournament.stage = st.stage
	if(st.stage == "wait") {
		$(".victory-screen .tournament-note").remove()
		$(".victory-screen").append('<div class="tournament-note">'+st.label+'</div>')
		return
	}
	if(app.currentState() != "Lobby") ResetArena()
	$(".waiting div").text(st.label)
	clearInterval(startTimer)
})
server.on("tournament_eliminated", function(e) {
	tournament.active = false
	$(".victory-screen .tournament-note").remove()
	$(".victory-screen").append('<div class="tournament-note eliminated">Torneio: '+e.label+'</div>')
	if(app.currentState() == "Lobby") { $(".waiting div").text("Torneio: " + e.label); $(".starting").remove(); $(".waiting").append('<div class="starting"><span class="solo">Jogar sozinho</span></div>') }
})
server.on("tournament_result", function(r) {
	tournament.active = false
	var html = '<div class="tournament-podium"><span class="header">Resultado do torneio</span>'
	$.each(r.standings || [], function(i, p) {
		html += '<span class="placement">' + p.place + 'º — ' + $("<p></p>").text(p.name).html() + (p.dnf ? ' (não terminou)' : '') + '</span>'
	})
	if(r.walkover) html += '<span class="placement">Vitória por W.O.</span>'
	html += '<div class="play-again">Jogar de novo</div></div>'
	$(".game").append(html)
	// Campeão ganha bônus na pontuação da sessão.
	var mine = (r.standings || []).filter(function(p) { return p.name == username })[0]
	if(mine && mine.place == 1) {
		tournament.score += 500
		window.__pcScore = tournament.score
		if(typeof pcReportScore === "function") pcReportScore(tournament.score)
	}
})

// Connected to the server
server.once("connect", function() {
	if(app.currentState() == "Lobby") {
		// Get the main tags
		var tags = []
		$(".game *").each(function() {
			tags.push($(this).prop("tagName").toLowerCase())
		})
		// Verification
		server.emit("tag_verify", tags, username)
	}
})

// Disconnected from the server
server.once("disconnect", function() {
	switch(app.currentState()) {
		case "Lobby":
			// In the lobby, load a single player game
			multiplayer = false
			$(".server-status .online").toggleClass("offline online")
			Init()
			break
		case "Game":
			// Display error message (if they haven't finished)
			if(!$(".player[me]").attr("finished")) {
				maxSpeed = 0
				alert("You were disconnected from the server.")
			}
	}
})

// Game verified
server.once("confirmed", function() {
	$(".waiting div").text("Procurando partida...")
})

// A game was found / created
server.on("game_connected", (game) => {
	if(app.currentState() == "Lobby") {
		currentMap = Object.assign([],map[game.map])
		players = game.players
		clearInterval(startTimer)
	}
})
// A new player joined
server.on("new_player", (pl) => {
	if(app.currentState() == "Lobby") {
		players.push(pl)
		clearInterval(startTimer)
	}
})
// Update the room
server.on("update_room", updateRoom)
// Start race
server.on("start_race", StartRacing)
// Handle actions from other players in game
server.on("player_action", (id, action) => {
	var $p = $(".player[player='"+id+"']")||$(".player").last()
	switch(action.type) {
		case "turn":
			playerTurn(id, action.dir||"left")
			break
		case "crash":
			$p.attr("crashed",true).attr("crash-state",1).css({"margin-left":15,"margin-top":15/XMultiplier}).find(".penguin").attr("src", "Assets/Penguin/right.png")
			$p.find(".tube").attr("src", "Assets/Tube/right.png")
			break
		case "boost":
			$p.attr("speed", boostSpeed)
	}
})
// A player disconnected
server.on("player_disconnected", (id) => {
	switch(app.currentState()) {
		case "Lobby":
			players.splice(id,1)
			clearInterval(startTimer)
			break
		case "Game":
			$(".player[player='"+parseInt(id+1)+"']").addClass("disconnected")
	}
})