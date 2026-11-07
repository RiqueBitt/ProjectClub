// Enseada → Lago: andar até a beirada esquerda (riacho) leva pro Lago.
var __pcLagoStart = startRoom;
startRoom = function()
{
   __pcLagoStart();
   var t = triggers_mc.createEmptyMovieClip("lago_mc",triggers_mc.getNextHighestDepth());
   t.beginFill(65280,50);
   t.moveTo(0,160);
   t.lineTo(22,160);
   t.lineTo(22,275);
   t.lineTo(0,275);
   t.endFill();
   t.triggerFunction = function()
   {
      _global.getCurrentShell().sendJoinRoom("lago",718,258);
   };
};
