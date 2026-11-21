var ENGINE = _global.getCurrentEngine();
var SHELL = _global.getCurrentShell();
var INTERFACE = _global.getCurrentInterface();
var start_x = 150;
var start_y = 165;
triggers_mc.forest_mc.triggerFunction = function()
{
   SHELL.sendJoinRoom("forest",440,218);
};
triggers_mc.cove_mc.triggerFunction = function()
{
   SHELL.sendJoinRoom("cove",48,215);
};
triggers_mc._visible = false;
block_mc._visible = false;
var _lagoT = 0;
foreground_mc.onEnterFrame = function()
{
   _lagoT = _lagoT + 0.045;
   this.water_mc._alpha = 94 + Math.sin(_lagoT) * 6;
};
