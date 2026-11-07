// GERADO por build_map.py (de icons.json) — não editar à mão.
// Ícones de salas do Project Club no mapa: cada um vai pra MAP.id_0 (camada
// dos ícones base), com área de clique própria (pc_hit_*), dica e clique.
var __pcIcons = [
   {key:"lake",x:490,y:362,room:"lake",sx:220,sy:160,hint:"w.map.lago"},
   {key:"monte1",x:278,y:178,room:"monte1",sx:390,sy:325,hint:"w.map.monte1"},
   {key:"monte2",x:312,y:144,room:"monte2",sx:157,sy:290,hint:"w.map.monte2"},
   {key:"monte3",x:346,y:112,room:"monte3",sx:157,sy:290,hint:"w.map.monte3"},
   {key:"monte4",x:380,y:82,room:"monte4",sx:330,sy:375,hint:"w.map.monte4"},
   {key:"monte5",x:414,y:54,room:"monte5",sx:400,sy:325,hint:"w.map.monte5"},
   {key:"monte6",x:246,y:208,room:"monte6",sx:400,sy:320,hint:"w.map.monte6"},
   {key:"cavex1",x:606,y:286,room:"cavex1",sx:95,sy:260,hint:"w.map.cavex1"},
   {key:"cavex2",x:644,y:266,room:"cavex2",sx:140,sy:115,hint:"w.map.cavex2"},
   {key:"cavex3",x:682,y:248,room:"cavex3",sx:95,sy:260,hint:"w.map.cavex3"},
   {key:"wilder1",x:733,y:302,room:"wilder1",sx:197,sy:236,hint:"w.map.wilder1"},
   {key:"jam10",x:424,y:228,room:"jam10",sx:375,sy:360,hint:"w.map.jam10"},
   {key:"copas",x:546,y:294,room:"copas",sx:355,sy:374,hint:"w.map.copas"},
   {key:"pirata",x:62,y:384,room:"pirata",sx:170,sy:223,hint:"w.map.pirata"}
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
