// Ajusta o jogo (1000x610) pra caber inteiro na janela, centralizado.
// Project Club: antes escalava pra "cobrir" a tela e cortava as laterais
// quando o jogo abria dentro do app.
app.mainLoop(function() {
	var g = $(".game-box")
	var s = Math.min(innerWidth / 1000, innerHeight / 610)
	g.css({ width: "1000px", left: "50%", top: Math.max(0, (innerHeight - 610 * s) / 2) + "px", "transform-origin": "top center", transform: "translateX(-50%) scale(" + s + ")" })
}, {fps:30})
