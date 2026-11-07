// Floresta → Lago: andar até o laguinho da cachoeira (topo da Floresta) leva pro Lago.
// Roda depois do script da sala; o gatilho entra quando o engine chama startRoom().
var __pcLagoStart = startRoom;
startRoom = function()
{
   __pcLagoStart();
   var t = triggers_mc.createEmptyMovieClip("lago_mc",triggers_mc.getNextHighestDepth());
   t.beginFill(65280,50);
   t.moveTo(392,176);
   t.lineTo(490,176);
   t.lineTo(490,200);
   t.lineTo(392,200);
   t.endFill();
   t.triggerFunction = function()
   {
      _global.getCurrentShell().sendJoinRoom("lago",120,150);
   };
};
