// Project Club — conserto do shell.swf (inserido no 1º quadro, depois do
// script principal; ver README.md e src/server/file-server/swf-patches.ts).
//
// Pátio do Dojo: o shell desta mídia (2013) manda pra sala "dojoextsolo"
// QUALQUER saída do Dojo/Pátio de quem não tem o amuleto + os 4 baralhos do
// Card-Jitsu — até escolher outro lugar no mapa. Essa sala abre um módulo
// do Sensei que não existe aqui: o pinguim ficava preso (não teleportava).
// Durante o sendJoinRoom esses 5 itens contam como "tem", então a sala
// escolhida é a de verdade.
var pcsOrigJoinRoom = sendJoinRoom;
sendJoinRoom = function(room_name, xpos, ypos, startTime)
{
   var pcsOrigHas = isItemInMyInventory;
   isItemInMyInventory = function(id)
   {
      if(id == AMULET_ITEM_ID || id == STARTER_DECK_ITEM_ID || id == FIRE_DECK_ITEM_ID || id == WATER_DECK_ITEM_ID || id == SNOW_DECK_ITEM_ID)
      {
         return true;
      }
      return pcsOrigHas(id);
   };
   var pcsResult = pcsOrigJoinRoom(room_name, xpos, ypos, startTime);
   isItemInMyInventory = pcsOrigHas;
   return pcsResult;
};
