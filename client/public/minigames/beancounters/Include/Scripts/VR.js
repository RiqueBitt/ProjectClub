 var isVR = false

// VR Play
function PlayVR() {
	$(".menu").fadeOut("slow", function() {
		// Enter fullscreen (should be already)
		$("html").get(0).webkitRequestFullscreen()
		isVR = true
		app.setState("Not_Menu")
		// Show the VR help
		$(this).toggleClass("menu vr-setup").html('<div class="vr-help"><img class="headset" src="Assets/VR/LaboVR.png"><div class="help-text">Coloque o aparelho nos óculos de realidade virtual.</div></div></div>').delay(300).fadeIn("slow", function() {
			app.setState("VR")
		})
		// Split the screen
		setTimeout(function() {
			var VRSetup = '<div class="vr-setup"><img class="headset" src="Assets/VR/LaboVR.png"><div class="vr-final">Insert the console and look into the<br>Labo VR Goggles. Then, press <img class="vr-go" src="Assets/Start.png">.</div></div>'
			$(".vr-setup").before('<div class="vr"><div class="vr-viewing-shadow"></div><div class="left-eye vr-viewing">'+VRSetup+'</div></div><div class="vr right"><div class="vr-viewing-shadow right-shadow"></div><div class="right-eye vr-viewing">'+VRSetup+'</div></div>').remove()
		}, 5300)
	})
}

// The player confirms the headset is ready
function VRStart() {
	if(isVR && $(".left-eye").length && $(".right-eye").length) {
		playerPos = 200
		var ran = false
		$(".how-to").fadeOut("slow", function() {
			if(!ran) {
				ran = true
				$(this).remove()
				// Create the game arena
				app.setState("Game")
				$(".left-eye").html('<div class="play-area"><img class="background" src="Assets/Background.png"><div class="alert" style="display:none">Caminhão descarregado!!</div><img class="platform" src="Assets/Platform.png"><div class="stack"></div><div class="player" style="left: 200px;"><div class="hitbox"></div><img src="Assets/Player/0.png"></div><div class="badluck" style="display:none">Tente de novo...</div><div class="scoreboard">Vidas: <span class="lives">3</span> Caminhão: <span class="truck-num">1</span> Pontos: <span class="score">0</span></div><img class="truck ready" src="Assets/Truck.png"></div>')
				addBags()
				//StartHazards()
			}
		})
	}
}

$("body").on('DOMSubtreeModified', ".left-eye", function() {
	if(isVR) {
		$(".right-eye").html($(".left-eye").html())
	}
})