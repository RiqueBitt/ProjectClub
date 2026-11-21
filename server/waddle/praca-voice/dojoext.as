// Project Club — Pátio do Dojo (dojoext.swf de 2015) sem travar.
//
// Inserido no 1º quadro do dojoext.swf (ver README.md e
// src/server/file-server/swf-patches.ts). A sala de 2015
// (com.clubpenguin.world.rooms2013.ninja.DojoExterior) só liga a interface se
// o pinguim tiver os QUATRO baralhos iniciais (normal 821, Fogo 8006, Água 8010
// e Neve 8011). Sem algum deles ela chama disableInterface() e nunca mais
// liga: o pinguim não anda, não abre o mapa nem entra no Dojo. Aqui a
// interface é ligada de novo logo depois do init() original, para todo mundo.
var pcdDE = _global.com.clubpenguin.world.rooms2013.ninja.DojoExterior;

if(pcdDE != undefined && pcdDE.prototype.pcdPatched != true)
{
   pcdDE.prototype.pcdPatched = true;
   var pcdOrigInit = pcdDE.prototype.init;
   pcdDE.prototype.init = function()
   {
      pcdOrigInit.apply(this, arguments);
      var itf = _global.getCurrentInterface();
      if(itf != undefined)
      {
         itf.enableInterface();
      }
      if(this.showCards != undefined)
      {
         this.showCards();
      }
   };
}
