// ===== Project Club: voz por proximidade (Falar / Ouvir) DENTRO da barra =====
// A caixa de escrever do chat fica 60 px mais curta (o botão de enviar vem
// junto) e, no espaço que sobra, entram dois botões desenhados igual aos da
// barra (mesmos círculos e cores do botão do interface.swf: normal, mouse em
// cima e apertado), no mesmo espaçamento de 30 px dos outros:
//   enviar 453.2 · FALAR 483.2 · OUVIR 513.2 · cartão do pinguim 543.2 …
// A barra não muda de tamanho.
// Clicar avisa a página (ExternalInterface "pracaVoiceToggle"); a página
// devolve o estado com "pracaVoiceState" (ligado/desligado, falando, ouvindo).

/*CRESCENT*/

function pcvCircle(m, x, y, r, col)
{
   var c = Math.cos(Math.PI / 8);
   m.beginFill(col, 100);
   m.moveTo(x + r, y);
   var i = 0;
   while(i < 8)
   {
      var a = (i + 1) * Math.PI / 4;
      var h = a - Math.PI / 8;
      m.curveTo(x + Math.cos(h) * r / c, y + Math.sin(h) * r / c, x + Math.cos(a) * r, y + Math.sin(a) * r);
      i++;
   }
   m.endFill();
}

function pcvRect(m, x, y, w, h)
{
   m.beginFill(0xff00ff, 100);
   m.moveTo(x, y);
   m.lineTo(x + w, y);
   m.lineTo(x + w, y + h);
   m.lineTo(x, y + h);
   m.lineTo(x, y);
   m.endFill();
}

// Igual ao botão 226 da barra (círculo de raio 10 escalado + meia-lua).
function pcvDrawButton(g, state)
{
   g.clear();
   pcvCircle(g, 1, 1, 13, 0x00ccff);
   pcvCircle(g, -1, -1, 13, 0x00529b);
   if(state == "down")
   {
      pcvCircle(g, 0, 0, 10, 0x003366);
      pcvCircle(g, 0, -0.85, 8.3333, 0x00529b);
      pcvCrescent(g, 0.8197, 0.8148, -2.5, -3.35, 0x009ace);
   }
   else if(state == "over")
   {
      pcvCircle(g, 0, 0, 12, 0x003366);
      pcvCircle(g, 0, -1, 10, 0x00529b);
      pcvCrescent(g, 0.9836, 0.9778, -3, -4, 0x009ace);
   }
   else
   {
      pcvCircle(g, 0, 0, 12, 0x003366);
      pcvCircle(g, 0, -1, 10, 0x0280cd);
      pcvCrescent(g, 0.9836, 0.9778, -3, -4, 0x00ccff);
   }
}

// Risco vermelho de "desligado".
function pcvDrawBan(m)
{
   m.clear();
   m.lineStyle(3.8, 0x000000, 100, true, "normal", "round");
   m.moveTo(-6, -6);
   m.lineTo(6, 6);
   m.lineStyle(2.2, 0xe8141b, 100, true, "normal", "round");
   m.moveTo(-6, -6);
   m.lineTo(6, 6);
   m.lineStyle(0.6, 0xff7a7a, 80, true, "normal", "round");
   m.moveTo(-5.4, -5.8);
   m.lineTo(-0.6, -1);
}

var pcvState = {talk:false, listen:false, talking:false, hearing:false, busy:false};
var pcvButtons = {};
var pcvEI = flash.external.ExternalInterface;

function pcvHintText(kind)
{
   if(kind == "talk")
   {
      return !pcvState.talk ? "Microfone desligado" : "Microfone ligado";
   }
   return !pcvState.listen ? "Sem ouvir ninguém" : "Ouvindo quem está perto";
}

function pcvApply()
{
   var kinds = ["talk", "listen"];
   var i = 0;
   while(i < kinds.length)
   {
      var k = kinds[i];
      var b = pcvButtons[k];
      if(b != undefined)
      {
         var on = k == "talk" ? pcvState.talk : pcvState.listen;
         var glow = k == "talk" ? pcvState.talking : pcvState.hearing;
         b.ban_mc._visible = !on;
         b.icon_mc._alpha = !(pcvState.busy && on) ? 100 : 55;
         b.pcvGlow = on && glow;
         if(!b.pcvGlow)
         {
            b.icon_mc.filters = [];
         }
      }
      i++;
   }
}

function pcvMakeButton(parent, kind, depth, x, iconUrl)
{
   var b = parent.createEmptyMovieClip("pcv_" + kind + "_btn", depth);
   b._x = x;
   b._y = 461.3;
   b._xscale = 100.37842;
   b._yscale = 99.81079;
   b.pcvKind = kind;
   var g = b.createEmptyMovieClip("bg_mc", 1);
   pcvDrawButton(g, "up");
   var icon = b.createEmptyMovieClip("icon_mc", 2);
   var holder = icon.createEmptyMovieClip("img_mc", 1);
   var ban = b.createEmptyMovieClip("ban_mc", 3);
   pcvDrawBan(ban);
   var loader = new MovieClipLoader();
   var lis = {};
   lis.onLoadInit = function(t)
   {
      t.forceSmoothing = true;
      t._xscale = 12.847;
      t._yscale = 12.847;
      t._x = -9.25;
      t._y = -9.25;
   };
   loader.addListener(lis);
   loader.loadClip(iconUrl, holder);
   b.onRollOver = function()
   {
      pcvDrawButton(this.bg_mc, "over");
      showHint(this, pcvHintText(this.pcvKind), 0, -28, false);
   };
   b.onRollOut = b.onDragOut = function()
   {
      pcvDrawButton(this.bg_mc, "up");
      closeHint();
   };
   b.onPress = function()
   {
      pcvDrawButton(this.bg_mc, "down");
   };
   b.onRelease = function()
   {
      pcvDrawButton(this.bg_mc, "over");
      closeHint();
      if(chatController != undefined && chatController.handleBlur != undefined)
      {
         chatController.handleBlur();
      }
      if(pcvEI.available)
      {
         pcvEI.call("pracaVoiceToggle", this.pcvKind);
      }
   };
   pcvButtons[kind] = b;
   return b;
}

// Caixa do chat 60 px mais curta. A caixa é lisa na horizontal: basta esconder
// (máscara) o pedaço da direita e trazer o botão de enviar (e o ícone dele) pra
// nova ponta; o campo de texto encolhe junto. Por baixo aparece o azul da barra.
var PCV_SHIFT = 60;
function pcvShrinkChat()
{
   var chat = DOCK.chat_mc;
   if(chat == undefined || chat.send_btn == undefined)
   {
      return undefined;
   }
   if(chat.pcvBaseInputW == undefined)
   {
      chat.pcvBaseInputW = chat.chat_input._width;
   }
   if(chat.send_btn._x > -59)
   {
      chat.send_btn._x = -PCV_SHIFT;
      for(var k in chat)
      {
         var o = chat[k];
         // ícone do enviar (clipe sem nome, em cima do botão)
         if(typeof o == "movieclip" && o != chat.send_btn && o._x > -6 && o._x < 6)
         {
            o._x = o._x - PCV_SHIFT;
         }
      }
      chat.chat_input._width = chat.pcvBaseInputW - PCV_SHIFT;
   }
   if(DOCK.pcvChatMask_mc == undefined)
   {
      var m = DOCK.createEmptyMovieClip("pcvChatMask_mc", 8990);
      var x0 = chat._x;
      var y0 = chat._y;
      // tudo à esquerda da nova ponta (a caixa é igual na horizontal)…
      pcvRect(m, x0 - 300, y0 - 30, 300 - PCV_SHIFT + 4, 60);
      // …mais o botão de enviar inteiro na posição nova
      pcvCircle(m, x0 - PCV_SHIFT, y0, 14.3, 0xff00ff);
      chat.setMask(m);
   }
}

function pcvSetup()
{
   if(DOCK == undefined || DOCK.pcv_mc != undefined)
   {
      return DOCK != undefined;
   }
   var c = DOCK.createEmptyMovieClip("pcv_mc", 9000);
   pcvShrinkChat();
   pcvMakeButton(c, "talk", 10, 483.2, "/praca-ui/mic.png");
   pcvMakeButton(c, "listen", 11, 513.2, "/praca-ui/headset.png");
   // brilho pulsando enquanto alguém (você / quem está perto) fala
   c.pcvT = 0;
   c.onEnterFrame = function()
   {
      this.pcvT++;
      // a caixa do chat volta ao normal se a interface redesenhar o quadro dela
      if(DOCK.chat_mc.send_btn != undefined && DOCK.chat_mc.send_btn._x > -59)
      {
         pcvShrinkChat();
      }
      var s = 4 + 3 * (1 + Math.sin(this.pcvT / 3));
      var kinds = ["talk", "listen"];
      var i = 0;
      while(i < kinds.length)
      {
         var b = pcvButtons[kinds[i]];
         if(b.pcvGlow && flash.filters.GlowFilter != undefined)
         {
            b.icon_mc.filters = [new flash.filters.GlowFilter(0xffe240, 1, s, s, 2, 2)];
         }
         i++;
      }
   };
   pcvApply();
   if(pcvEI.available)
   {
      pcvEI.addCallback("pracaVoiceState", null, function(talk, listen, talking, hearing, busy)
      {
         pcvState.talk = talk == true;
         pcvState.listen = listen == true;
         pcvState.talking = talking == true;
         pcvState.hearing = hearing == true;
         pcvState.busy = busy == true;
         pcvApply();
      });
      pcvEI.call("pracaVoiceReady");
   }
   return true;
}

if(!pcvSetup())
{
   var pcvWait = this.createEmptyMovieClip("pcvWait_mc", 8999);
   pcvWait.onEnterFrame = function()
   {
      if(pcvSetup())
      {
         this.removeMovieClip();
      }
   };
}

// Moeda única: o saldo do jogo é o das moedas do Project Club — o cartão do
// jogador mostra a moeda "PC" (client/public/praca-ui/coin.png) por cima da
// moeda antiga, ao lado de "Suas Moedas".
var PCV_COIN = 23;
var PCV_COIN_GAP = 2;
function pcvCoinIcon(art)
{
   if(art == undefined || art.coins_txt == undefined)
   {
      return undefined;
   }
   if(art.pcvCoin_mc != undefined)
   {
      return art.pcvCoin_mc;
   }
   var c = art.createEmptyMovieClip("pcvCoin_mc", art.getNextHighestDepth());
   var h = c.createEmptyMovieClip("img_mc", 1);
   var l = new MovieClipLoader();
   var o = {};
   o.onLoadInit = function(m)
   {
      m.forceSmoothing = true;
      m._width = PCV_COIN;
      m._height = PCV_COIN;
   };
   l.addListener(o);
   l.loadClip("/praca-ui/coin.png", h);
   c.onEnterFrame = function()
   {
      var t = this._parent.coins_txt;
      var show = t != undefined && t._visible && t.text.length > 0;
      this._visible = show;
      if(show)
      {
         this._x = t._x - PCV_COIN - PCV_COIN_GAP + PCV_COIN_DX;
         this._y = t._y + (t._height - PCV_COIN) / 2 + PCV_COIN_DY;
      }
   };
   return c;
}
var PCV_COIN_DX = -6;
var PCV_COIN_DY = -3;
var pcvOrigWidgetCoins = updatePlayerWidgetCoins;
updatePlayerWidgetCoins = function()
{
   pcvOrigWidgetCoins();
   pcvCoinIcon(PLAYER_WIDGET.art_mc);
};

// Mini-Jogos do Project Club: a página abre a Praça e pede pra entrar direto
// no minijogo (ou numa sala) do próprio Club Penguin.
if(pcvEI.available)
{
   pcvEI.addCallback("pracaJoinGame", null, function(key)
   {
      if(shell.getCurrentGameRoomId() == undefined && shell.getGameCrumbsByName(String(key)) != undefined)
      {
         shell.sendJoinGame(String(key));
         return true;
      }
      return false;
   });
   pcvEI.addCallback("pracaJoinRoom", null, function(key, x, y)
   {
      if(shell.getRoomCrumbsByName(String(key)) == undefined)
      {
         return false;
      }
      shell.sendJoinRoom(String(key), Number(x), Number(y));
      return true;
   });
}

// Tirar a roupa clicando no item de novo: na interface de 2012 o único jeito
// de tirar um item é clicar NELE no pinguim do cartão — clicar no item no
// inventário (o que todo mundo tenta) não fazia nada. Agora clicar num item
// que já está vestido tira ele.
var pcvOrigClickItem = clickPlayerWidgetItem;
clickPlayerWidgetItem = function(itemID)
{
   var slot = undefined;
   if(itemID != SPY_PHONE_ICON_ID && itemID != CARD_DECK_ICON_ID && isItemOnPlayer(itemID))
   {
      var t = getInventoryObjectById(itemID).type;
      if(t == getShellConstant("INVENTORY_TYPE_HEAD")) slot = "head";
      else if(t == getShellConstant("INVENTORY_TYPE_FACE")) slot = "face";
      else if(t == getShellConstant("INVENTORY_TYPE_NECK")) slot = "neck";
      else if(t == getShellConstant("INVENTORY_TYPE_BODY")) slot = "body";
      else if(t == getShellConstant("INVENTORY_TYPE_HAND")) slot = "hand";
      else if(t == getShellConstant("INVENTORY_TYPE_FEET")) slot = "feet";
      else if(t == getShellConstant("INVENTORY_TYPE_FLAG")) slot = "flag_id";
      else if(t == getShellConstant("INVENTORY_TYPE_PHOTO")) slot = "photo_id";
   }
   if(slot != undefined)
   {
      clickPlayerWidgetRemoveItem(slot);
   }
   else
   {
      pcvOrigClickItem(itemID);
   }
};


// ===== Project Club: compra de iglus, pisos e locais no catálogo =====
// O catálogo (pigfarm_catalog.swf, AS3) manda MSG_PURCHASE_ITEM com
// itemType 3 (iglu), 5 (piso) e 6 (local), mas a interface de 2012 ignora
// esses tipos (case vazio) — clicar no iglu/piso/local "não fazia nada".
// Aqui eles vão pras funções de compra que a própria interface já tem.
var pcvOrigPurchase = purchaseItemFromAS3;
purchaseItemFromAS3 = function(itemType, itemID, enablePrompt)
{
   var t = Number(itemType);
   var id = Number(itemID);
   if(t == 3)
   {
      buyIglooUpgrade(id);
   }
   else if(t == 5)
   {
      buyIglooFloor(id);
   }
   else if(t == 6)
   {
      buyIglooLocation(id);
   }
   else
   {
      pcvOrigPurchase(itemType, itemID, enablePrompt);
   }
};
