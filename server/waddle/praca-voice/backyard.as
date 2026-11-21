// Project Club — quintal do iglu (backyard.swf) com o fundo do LOCAL escolhido.
//
// Inserido no 1º quadro do backyard.swf (ver README.md e
// src/server/file-server/swf-patches.ts). O jogo carrega
// content/global/backyard/<local>_backyard.swf, mas a mídia só tem o
// 1_backyard.swf: pra qualquer outro local ele caía no quintal padrão e o
// quintal não mudava junto com o fundo do iglu. Agora, quando o local não é o
// padrão, o cenário do próprio local (igloo/locations/sprites/<local>.swf —
// o mesmo que aparece atrás do iglu) entra embaixo do quintal e o fundo antigo
// some; o portão, a cerca, a área dos puffles e as bordas continuam os do quintal.
var pcbBBV = _global.com.clubpenguin.backyard.view.BackyardBackgroundView;

if(pcbBBV != undefined && pcbBBV.prototype.pcbPatched != true)
{
   pcbBBV.prototype.pcbPatched = true;
   var pcbOrigInit = pcbBBV.prototype.onBackgroundLoadInit;
   pcbBBV.prototype.onBackgroundLoadInit = function()
   {
      pcbOrigInit.apply(this, arguments);
      var loc = Number(this._backyardModel.iglooLocation);
      var room = this.room_mc;
      var bg = room.background_mc;
      if(isNaN(loc) || loc <= 1 || bg == undefined)
      {
         return;
      }
      var holder = room.createEmptyMovieClip("pcbLocation_mc", bg.getDepth() - 1);
      var url = this._backyardModel.SHELL.getGlobalContentPath() + "igloo/locations/sprites/" + loc + ".swf";
      var mcl = new MovieClipLoader();
      var lis = {};
      lis.onLoadInit = function(target)
      {
         bg._visible = false;
      };
      lis.onLoadError = function(target)
      {
         // sem o arquivo do local: fica o quintal padrão
         holder.unloadMovie();
      };
      mcl.addListener(lis);
      mcl.loadClip(url, holder);
   };
}
