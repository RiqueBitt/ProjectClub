// Import other files
include("Include/Scripts/Game")
include("Include/Scripts/Input")
include("Include/Scripts/Maps")
include("Include/Scripts/Multiplayer")
include("Include/Scripts/Tiles")

// Preload assets with optional callback, and percentage callback
function preload(a, c, pc) {
	var count = a.length
	var loaded = 0
	var assetLoaded = function() {
		loaded++
		if(loaded == count && typeof c == "function") {
			c()
			$(".audioPreloaded").remove()
		}
		if(typeof pc == "function") {
			var percent = (loaded / count) * 100
			pc(percent)
		}
	}
	$.each(a, function(i, f) {
		if(f.endsWith(".mp3")) {
			var audio = new Audio()
			audio.src = f
			audio.addEventListener("canplaythrough", assetLoaded, false)
			audio.addEventListener("error", assetLoaded, false)
			$("body").append('<audio class="audioPreloaded" muted="muted" preload="auto" src="'+f+'"></audio>')
		}
		else {
			$("<img>").attr("src", f).on("load error", assetLoaded)
		}
	})
}

app.onLoad(function() {
	// Check for a mobile client
	if(false && testMobile()) { // Project Club: celular liberado (controles na tela)
		app.setState("Mobile")
		$("body").toggleClass("loading sorry").html("Foi mal :(")
		setTimeout(function() {
			alert("Este jogo não funciona neste aparelho.")
		}, 1)
		return
	}
	app.setState("Loading")
	var a = "Assets/"
	var c = a+"Clapping/"
	var h = a+"HillTiles/"
	var p = a+"Penguin/"
	var pl = a+"Players/"
	var t = a+"Tube/"
	// Preload all the assets
	var pre = [a+"Background.png",a+"Clouds.png",a+"Finish.mp3",a+"FinishLine.png",a+"MapCorner.png",a+"Music.mp3",a+"Timer.png",a+"UserIcon.png",c+"1.gif",c+"2.gif",h+"20_A.png",h+"Finish.png",h+"Start.png",p+"back.png",p+"crashed.gif",p+"default.png",p+"left.png",p+"right.png",pl+"Other.png",pl+"Self.png",t+"default.png",t+"flipped.png",t+"left.png",t+"right.png",t+"shadow.png"]
	for (var i = 0; i <= 20; i++) { 
		pre.push(h+i+".png")
	}
	preload(pre, function() {
		// Wait a little bit longer
		setTimeout(function() {
			// Project Club: sem servidor externo — vai direto pro modo solo
			$(".loading-bar").css("width","0%")
			multiplayer = false
			Lobby()
		}, 400)
	}, function(percent) {
		$(".loading-bar").css("width",percent+"%")
	})
})


app.mainLoop(function() {
	if(app.currentState() == "Game") {
		$(".player").each(function() {
			movePlayer($(this))
			var $p = $(this).find(".penguin")
			// Stop the penguin from appearing giant
			if($p.hasClass("crashed")) {
				if($p.attr("src") !== "Assets/Penguin/crashed.gif") {
					$p.removeClass("crashed")
				}
			}
		})
	}
}, {allowCursor:true})