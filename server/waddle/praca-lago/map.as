// GERADO por build_map.py (de icons.json) — não editar à mão.
// Ícones de salas do Project Club no mapa: cada um vai pra MAP.id_0 (camada
// dos ícones base), com área de clique própria (pc_hit_*), dica e clique.
var __pcIcons = [
   {key:"lake",x:490,y:362,room:"lake",sx:220,sy:160,hint:"w.map.lago"}
];
var __pcHome = this.id_0 != undefined ? this.id_0 : this;
var __pcMake = function(ic)
{
   var icon = __pcHome.attachMovie("pc_icon_" + ic.key,"id_pc_" + ic.key,__pcHome.getNextHighestDepth());
   var hit = __pcHome.attachMovie("pc_hit_" + ic.key,"id_pc_" + ic.key + "_hit",__pcHome.getNextHighestDepth());
   if(icon == undefined || hit == undefined)
   {
      return undefined;
   }
   icon._x = ic.x;
   icon._y = ic.y;
   icon.gotoAndStop(1);
   hit._x = ic.x;
   hit._y = ic.y;
   hit._alpha = 0;
   hit.useHandCursor = true;
   hit.onRollOver = function()
   {
      icon.gotoAndStop(2);
      _global.getCurrentInterface().showHint(icon,ic.hint,0,28);
   };
   hit.onRollOut = function()
   {
      icon.gotoAndStop(1);
      _global.getCurrentInterface().closeHint();
   };
   hit.onReleaseOutside = hit.onRollOut;
   hit.onRelease = function()
   {
      icon.gotoAndStop(1);
      var _shell = _global.getCurrentShell();
      _global.getCurrentInterface().closeHint();
      _shell.sendHideQuestUI();
      _shell.sendJoinRoomFromMap(ic.room,ic.sx,ic.sy,0,90,90);
      _shell.showMapLegendAnimation = null;
      _root.close();
   };
};
var __pcI = 0;
while(__pcI < __pcIcons.length)
{
   __pcMake(__pcIcons[__pcI]);
   __pcI = __pcI + 1;
}
