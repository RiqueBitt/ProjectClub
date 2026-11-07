var __pcLagoHome = this.id_0 != undefined ? this.id_0 : this;
var __pcLago = __pcLagoHome.attachMovie("pc_lago_icon","id_lago",__pcLagoHome.getNextHighestDepth());
var __pcLagoHit = __pcLagoHome.attachMovie("pc_lago_hit","id_lago_hit",__pcLagoHome.getNextHighestDepth());
if(__pcLago != undefined && __pcLagoHit != undefined)
{
   __pcLago._x = 490;
   __pcLago._y = 362;
   __pcLago.gotoAndStop(1);
   __pcLagoHit._x = 490;
   __pcLagoHit._y = 362;
   __pcLagoHit._alpha = 0;
   __pcLagoHit.useHandCursor = true;
   __pcLagoHit.onRollOver = function()
   {
      __pcLago.gotoAndStop(2);
      _global.getCurrentInterface().showHint(__pcLago,"w.map.lago",0,28);
   };
   __pcLagoHit.onRollOut = function()
   {
      __pcLago.gotoAndStop(1);
      _global.getCurrentInterface().closeHint();
   };
   __pcLagoHit.onReleaseOutside = __pcLagoHit.onRollOut;
   __pcLagoHit.onRelease = function()
   {
      __pcLago.gotoAndStop(1);
      var _shell = _global.getCurrentShell();
      _global.getCurrentInterface().closeHint();
      _shell.sendHideQuestUI();
      _shell.sendJoinRoomFromMap("lago",150,165,0,90,90);
      _shell.showMapLegendAnimation = null;
      _root.close();
   };
}
