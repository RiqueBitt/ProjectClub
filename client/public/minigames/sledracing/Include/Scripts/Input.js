// Handle key inputs
$(window).keydown(function(e) {
	if(e.which == 37 || e.which == 40) {
		playerTurn(me,"left")
	}
	else if(e.which == 38 || e.which == 39) {
		playerTurn(me,"right")
	}
})

// Project Club: controle por TOQUE direto no jogo (celular/tablet). O trenó
// só respondia ao teclado, então no celular não dava pra virar — "só funciona
// no desktop". Agora, tocar na metade esquerda da tela vira à esquerda e na
// metade direita vira à direita; segurar repete devagar, como manter a seta
// pressionada. Funciona junto com os botões ◀ ▶ na tela, sem depender deles.
;(function() {
	var touch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0
	if(!touch) return
	var holdDir = null, repeatTimer = null
	function turn(dir) { if(app.currentState() == "Game") playerTurn(me, dir) }
	function startTurn(clientX) {
		var w = window.innerWidth || document.documentElement.clientWidth || 1
		holdDir = clientX < w / 2 ? "left" : "right"
		turn(holdDir)
		clearInterval(repeatTimer)
		repeatTimer = setInterval(function() { if(holdDir) turn(holdDir) }, 170)
	}
	function stopTurn() { holdDir = null; clearInterval(repeatTimer); repeatTimer = null }
	window.addEventListener("touchstart", function(e) {
		if(e.touches && e.touches.length > 1) return
		var t = e.changedTouches && e.changedTouches[0]
		if(t) startTurn(t.clientX)
	}, { passive: true })
	window.addEventListener("touchend", stopTurn, { passive: true })
	window.addEventListener("touchcancel", stopTurn, { passive: true })
	window.addEventListener("blur", stopTurn)
})()

// Handle button clicks
$("body").on("click", ".play-again", function() {
	parent.location.reload()
}).on("click", ".solo", function() {
	multiplayer = false
	Init()
	server.emit("solo_game")
})

// Project Club: sem prompt() (não funciona no app desktop) e sem filtro
// externo (purgomalum). O nome vem do Project Club (?name=) ou "Guest".
function promptUsername() {
	var name = ""
	try { name = new URLSearchParams(parent.location.search).get("name") || "" } catch(e) {}
	name = name.trim().slice(0, 19)
	if(name.length) {
		username = $("<p></p>").text(name).html()
	}
	Init()
}

// Set cookies
function setCookie(name, val, exdays) {
	var d = new Date()
	d.setTime(d.getTime()+(exdays*24*60*60*1000))
	document.cookie = name+"="+val+";"+"expires="+d.toUTCString()+";path=/"
}
// Get cookies
function getCookie(c) {
	var name = c+"="
	var decodedCookie = decodeURIComponent(document.cookie)
	var ca = decodedCookie.split(';')
	for(var i = 0; i <ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') {
		  c = c.substring(1)
		}
		if (c.indexOf(name) == 0) {
		  return c.substring(name.length, c.length)
		}
	}
	return ""
}