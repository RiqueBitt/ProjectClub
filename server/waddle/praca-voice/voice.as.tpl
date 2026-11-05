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

// Lista de amigos: o botão de amigos da barra (e o "Adicionar amigo" do
// cartão) chamavam o sistema novo de Amigos da Disney — um módulo AS3 que
// precisa de arquivos e servidores que não existem aqui, então não abria
// nada; e a lista clássica não tem mais a arte nessa interface. Aqui vai uma
// lista de amigos nova, no estilo do jogo: os amigos (que já incluem os do
// Project Club), online primeiro; clicar num amigo abre o cartão dele (com
// os botões de achar e de iglu). Pedidos de amizade pelo jeito antigo.
var PCB_W = 214;
var PCB_ROW = 26;
var PCB_ROWS = 10;
var pcbPage = 0;
var pcbPanel = undefined;

function pcbBox(mc, x, y, w, h, r, fill, line)
{
   mc.lineStyle(3, line, 100);
   mc.beginFill(fill, 100);
   mc.moveTo(x + r, y);
   mc.lineTo(x + w - r, y);
   mc.curveTo(x + w, y, x + w, y + r);
   mc.lineTo(x + w, y + h - r);
   mc.curveTo(x + w, y + h, x + w - r, y + h);
   mc.lineTo(x + r, y + h);
   mc.curveTo(x, y + h, x, y + h - r);
   mc.lineTo(x, y + r);
   mc.curveTo(x, y, x + r, y);
   mc.endFill();
}
function pcbText(mc, name, depth, x, y, w, h, size, color, bold, align)
{
   var t = mc.createTextField(name, depth, x, y, w, h);
   t.selectable = false;
   t.setNewTextFormat(new TextFormat("_sans", size, color, bold, false, false, null, null, align));
   return t;
}
// Lista de amigos própria (o shell desta mídia não guarda mais a lista do
// servidor — isso era do sistema novo da Disney): escuta os pacotes de
// amigos do jogo (gb, go, bon, bof, ba, rb) e também preenche a lista do
// shell (ROSTER), pro cartão do jogador saber quem já é amigo.
var pcbRoster = [];
var pcbGotList = false;
var pcbAsked = false;
function pcbFind(id)
{
   var i = 0;
   while(i < pcbRoster.length)
   {
      if(pcbRoster[i].player_id == id)
      {
         return pcbRoster[i];
      }
      i++;
   }
   return undefined;
}
function pcbSync()
{
   var r = _global.getCurrentShell().ROSTER.buddies;
   if(r != undefined)
   {
      r.splice(0, r.length);
      var i = 0;
      while(i < pcbRoster.length)
      {
         r.push(pcbRoster[i]);
         i++;
      }
   }
   pcbRender();
}
function pcbAdd(id, name, online)
{
   id = Number(id);
   if(isNaN(id))
   {
      return undefined;
   }
   var f = pcbFind(id);
   if(f == undefined)
   {
      f = {player_id:id, nickname:String(name), is_online:online == true};
      pcbRoster.push(f);
   }
   else
   {
      if(name != undefined)
      {
         f.nickname = String(name);
      }
      if(online != undefined)
      {
         f.is_online = online == true;
      }
   }
   return f;
}
var pcbAT = undefined;
// o AIRTOWER do shell só existe depois do login: liga quando aparecer
function pcbHook()
{
   if(pcbAT != undefined)
   {
      return true;
   }
   var at = _global.getCurrentAirtower();
   if(at == undefined)
   {
      return false;
   }
   pcbAT = at;
   pcbAT.addListener(pcbAT.GET_BUDDY_LIST, function(d)
   {
      pcbGotList = true;
      pcbRoster = [];
      var i = 1;
      while(i < d.length)
      {
         var e = String(d[i]).split("|");
         if(e[0] != "")
         {
            pcbAdd(e[0], e[1], Number(e[2]) == 1);
         }
         i++;
      }
      pcbSync();
   });
   pcbAT.addListener("go", function(d)
   {
      var i = 1;
      while(i < d.length)
      {
         var f = pcbFind(Number(d[i]));
         if(f != undefined)
         {
            f.is_online = true;
         }
         i++;
      }
      pcbSync();
   });
   pcbAT.addListener(pcbAT.BUDDY_ONLINE, function(d)
   {
      var f = pcbFind(Number(d[1]));
      if(f != undefined)
      {
         f.is_online = true;
      }
      pcbSync();
   });
   pcbAT.addListener(pcbAT.BUDDY_OFFLINE, function(d)
   {
      var f = pcbFind(Number(d[1]));
      if(f != undefined)
      {
         f.is_online = false;
      }
      pcbSync();
   });
   pcbAT.addListener(pcbAT.ACCEPT_BUDDY, function(d)
   {
      pcbAdd(d[1], d[2], true);
      pcbSync();
   });
   pcbAT.addListener(pcbAT.REMOVE_BUDDY, function(d)
   {
      var id = Number(d[1]);
      var i = 0;
      while(i < pcbRoster.length)
      {
         if(pcbRoster[i].player_id == id)
         {
            pcbRoster.splice(i, 1);
            break;
         }
         i++;
      }
      pcbSync();
   });
   pcbAT.addListener(pcbAT.REQUEST_BUDDY, function(d)
   {
      pcvOnBuddyRequest({player_id:Number(d[1]), nickname:String(d[2])});
   });
   return true;
}
function pcbBuddies()
{
   var on = [];
   var off = [];
   var i = 0;
   while(i < pcbRoster.length)
   {
      if(pcbRoster[i].is_online)
      {
         on.push(pcbRoster[i]);
      }
      else
      {
         off.push(pcbRoster[i]);
      }
      i++;
   }
   var byName = function(a, b)
   {
      return String(a.nickname).toLowerCase() < String(b.nickname).toLowerCase() ? -1 : 1;
   };
   on.sort(byName);
   off.sort(byName);
   return {list:on.concat(off), online:on.length};
}
function pcbClose()
{
   if(pcbPanel != undefined)
   {
      pcbPanel.removeMovieClip();
   }
   pcbPanel = undefined;
}
function pcbRender()
{
   if(pcbPanel == undefined)
   {
      return undefined;
   }
   var p = pcbPanel;
   p.rows_mc.removeMovieClip();
   var rows = p.createEmptyMovieClip("rows_mc", 20);
   var b = pcbBuddies();
   var pages = Math.max(1, Math.ceil(b.list.length / PCB_ROWS));
   if(pcbPage >= pages)
   {
      pcbPage = pages - 1;
   }
   p.count_txt.text = b.online + " online · " + b.list.length + (b.list.length == 1 ? " amigo" : " amigos");
   if(b.list.length == 0)
   {
      var e = pcbText(rows, "empty_txt", 1, 12, 70, PCB_W - 24, 90, 12, 0xFFFFFF, false, "center");
      e.multiline = true;
      e.wordWrap = true;
      e.text = "Você ainda não tem amigos aqui. Os seus amigos do Project Club aparecem nesta lista assim que entrarem na ilha.";
   }
   var i = 0;
   while(i < PCB_ROWS)
   {
      var f = b.list[pcbPage * PCB_ROWS + i];
      if(f == undefined)
      {
         break;
      }
      var r = rows.createEmptyMovieClip("r" + i, 10 + i);
      r._x = 10;
      r._y = 56 + i * PCB_ROW;
      var bg = r.createEmptyMovieClip("bg_mc", 1);
      pcbBox(bg, 0, 0, PCB_W - 20, PCB_ROW - 4, 6, 0xEAF4FF, 0x7DB2E6);
      var dot = r.createEmptyMovieClip("dot_mc", 2);
      dot.lineStyle(1, f.is_online ? 0x1F7A1F : 0x6B6B6B, 100);
      dot.beginFill(f.is_online ? 0x37C837 : 0xB5B5B5, 100);
      var a = 0;
      dot.moveTo(13 + 5, 11);
      while(a <= 12)
      {
         dot.lineTo(13 + Math.cos(a * Math.PI / 6) * 5, 11 + Math.sin(a * Math.PI / 6) * 5);
         a++;
      }
      dot.endFill();
      var n = pcbText(r, "name_txt", 3, 24, 2, PCB_W - 50, 20, 13, 0x0A3A70, f.is_online, "left");
      n.text = f.nickname;
      r.pcbId = f.player_id;
      r.pcbName = f.nickname;
      r.onRelease = function()
      {
         showPlayerWidget(this.pcbId, this.pcbName);
      };
      r.onRollOver = function()
      {
         this._alpha = 80;
      };
      r.onRollOut = r.onDragOut = function()
      {
         this._alpha = 100;
      };
      i++;
   }
   p.prev_mc._visible = pcbPage > 0;
   p.next_mc._visible = pcbPage < pages - 1;
   p.page_txt.text = pages > 1 ? (pcbPage + 1) + "/" + pages : "";
}
function pcbArrow(p, name, depth, x, y, up)
{
   var m = p.createEmptyMovieClip(name, depth);
   m._x = x;
   m._y = y;
   pcbBox(m, 0, 0, 30, 22, 6, 0x2C8FE0, 0x0A3A70);
   m.lineStyle(0, 0xFFFFFF, 0);
   m.beginFill(0xFFFFFF, 100);
   if(up)
   {
      m.moveTo(8, 15);
      m.lineTo(22, 15);
      m.lineTo(15, 6);
   }
   else
   {
      m.moveTo(8, 7);
      m.lineTo(22, 7);
      m.lineTo(15, 16);
   }
   m.endFill();
   return m;
}
function pcbOpen()
{
   pcbClose();
   // mesma camada da barra e dos cartões (coordenadas da tela do jogo)
   var host = DOCK._parent;
   var p = host.createEmptyMovieClip("pcbPanel_mc", host.getNextHighestDepth());
   pcbPanel = p;
   var h = 56 + PCB_ROWS * PCB_ROW + 40;
   p._x = 760 - PCB_W - 12;
   p._y = Math.round((430 - h) / 2) + 4;
   var bg = p.createEmptyMovieClip("bg_mc", 1);
   pcbBox(bg, 0, 0, PCB_W, h, 14, 0x1C67B5, 0x0A3A70);
   var t = pcbText(p, "title_txt", 2, 12, 6, PCB_W - 50, 24, 17, 0xFFFFFF, true, "left");
   t.text = "Amigos";
   pcbText(p, "count_txt", 3, 12, 30, PCB_W - 24, 18, 11, 0xCFE6FF, false, "left");
   var x = p.createEmptyMovieClip("close_mc", 4);
   x._x = PCB_W - 34;
   x._y = 8;
   pcbBox(x, 0, 0, 24, 24, 12, 0x2C8FE0, 0x0A3A70);
   x.lineStyle(3, 0xFFFFFF, 100);
   x.moveTo(7, 7);
   x.lineTo(17, 17);
   x.moveTo(17, 7);
   x.lineTo(7, 17);
   x.onRelease = pcbClose;
   var pv = pcbArrow(p, "prev_mc", 5, 12, h - 32, true);
   pv.onRelease = function()
   {
      pcbPage = Math.max(0, pcbPage - 1);
      pcbRender();
   };
   var nx = pcbArrow(p, "next_mc", 6, PCB_W - 42, h - 32, false);
   nx.onRelease = function()
   {
      pcbPage = pcbPage + 1;
      pcbRender();
   };
   pcbText(p, "page_txt", 7, 50, h - 30, PCB_W - 100, 18, 12, 0xFFFFFF, true, "center");
   // fundo do painel segura o clique (não anda o pinguim)
   bg.onRelease = function()
   {
   };
   bg.useHandCursor = false;
   pcbRender();
}
function pcvToggleBuddies()
{
   if(pcbPanel != undefined)
   {
      pcbClose();
   }
   else
   {
      pcbPage = 0;
      pcbOpen();
      if(!pcbGotList && pcbAT != undefined)
      {
         pcbAT.send(pcbAT.PLAY_EXT, pcbAT.BUDDY_HANDLER + "#" + pcbAT.GET_BUDDY_LIST, [], "str", shell.getCurrentServerRoomId());
      }
   }
   closeHint();
   chatController.handleBlur();
}
sendBuddyRequest = function()
{
   var id = Number(getActivePlayerId());
   showPrompt("ok", getLocalizedString("buddy_request_sent_prompt"));
   if(!isNaN(id))
   {
      shell.sendBuddyRequest(id);
   }
};
var pcvBuddyReq = undefined;
function pcvOnBuddyRequest(o)
{
   if(o == undefined || isNaN(Number(o.player_id)))
   {
      return undefined;
   }
   pcvBuddyReq = o;
   showPrompt("question", o.nickname + " quer ser seu amigo. Aceitar?", "", function()
   {
      shell.sendBuddyAccept(Number(pcvBuddyReq.player_id));
   });
}
var pcvBuddyWatch = this.createEmptyMovieClip("pcvBuddyWatch_mc", 8998);
pcvBuddyWatch.onEnterFrame = function()
{
   // já dentro de uma sala e sem a lista: pede (a resposta do login pode ter
   // chegado antes de a gente escutar)
   if(pcbHook() && !pcbGotList && !pcbAsked && shell.getCurrentRoomId() > 0)
   {
      pcbAsked = true;
      pcbAT.send(pcbAT.PLAY_EXT, pcbAT.BUDDY_HANDLER + "#" + pcbAT.GET_BUDDY_LIST, [], "str", shell.getCurrentServerRoomId());
      pcbAT.send(pcbAT.PLAY_EXT, pcbAT.BUDDY_HANDLER + "#go", [], "str", shell.getCurrentServerRoomId());
   }
   // a barra é montada (e remontada) pelo próprio jogo: mantém o botão ligado na lista nova
   if(DOCK.buddy_btn != undefined && DOCK.buddy_btn.onRelease != pcvToggleBuddies)
   {
      DOCK.buddy_btn.onRelease = pcvToggleBuddies;
   }
   // some junto com a barra (minijogos, editor do iglu, troca de sala)
   if(pcbPanel != undefined && DOCK._visible == false)
   {
      pcbClose();
   }
};

// Balão de "falando" (voz da ilha): quem está falando no microfone ganha um
// balão do jogo em cima do pinguim com o alto-falante (praca-ui/speaker-*.png),
// as ondas pulsando enquanto a pessoa fala. A página manda quem está
// falando: player.pracaSpeaking("1000,1003").
var pcsSpeaking = {};
var pcsLayer = undefined;
var PCS_W = 50;
var PCS_H = 36;
var PCS_LIFT = 64; // do pé do pinguim até a ponta do balão

function pcsBalloon(mc)
{
   // balão branco com borda, como os do chat, e o biquinho pra baixo
   var w = PCS_W;
   var h = PCS_H;
   var r = 10;
   var x = - w / 2;
   var y = - h - 9;
   mc.lineStyle(2, 0x5A5A5A, 100);
   mc.beginFill(0xFFFFFF, 100);
   mc.moveTo(x + r, y);
   mc.lineTo(x + w - r, y);
   mc.curveTo(x + w, y, x + w, y + r);
   mc.lineTo(x + w, y + h - r);
   mc.curveTo(x + w, y + h, x + w - r, y + h);
   mc.lineTo(5, y + h);
   mc.lineTo(0, 0);
   mc.lineTo(-5, y + h);
   mc.lineTo(x + r, y + h);
   mc.curveTo(x, y + h, x, y + h - r);
   mc.lineTo(x, y + r);
   mc.curveTo(x, y, x + r, y);
   mc.endFill();
}
function pcsLoad(holder, file)
{
   var l = new MovieClipLoader();
   var o = {};
   o.onLoadInit = function(m)
   {
      m.forceSmoothing = true;
      m._width = 40;
      m._height = 30;
   };
   l.addListener(o);
   l.loadClip("/praca-ui/" + file, holder);
}
function pcsMake(id)
{
   var c = pcsLayer.createEmptyMovieClip("s" + id, pcsLayer.getNextHighestDepth());
   pcsBalloon(c.createEmptyMovieClip("bg_mc", 1));
   var icon = c.createEmptyMovieClip("icon_mc", 2);
   icon._x = -20;
   icon._y = - PCS_H - 9 + 3;
   pcsLoad(icon.createEmptyMovieClip("cone_mc", 1), "speaker-cone.png");
   pcsLoad(icon.createEmptyMovieClip("w1_mc", 2), "speaker-wave1.png");
   pcsLoad(icon.createEmptyMovieClip("w2_mc", 3), "speaker-wave2.png");
   c.pcsId = id;
   c.pcsT = 0;
   c._xscale = c._yscale = 10;
   c.onEnterFrame = function()
   {
      var pm = ENGINE.getPlayerMovieClip(this.pcsId);
      if(pm == undefined || pm._visible == false)
      {
         this._visible = false;
         return undefined;
      }
      this._visible = true;
      var inv = ENGINE.getRoomMovieClip().invertedPenguins;
      this._x = pm._x;
      this._y = inv ? pm._y + PCS_LIFT : pm._y - PCS_LIFT;
      this.pcsT++;
      var t = this.pcsT;
      var leaving = this.pcsLeaving == true;
      // entra "estourando", sai encolhendo
      var target = leaving ? 0 : 100;
      var sc = this._xscale + (target - this._xscale) * 0.35;
      if(!leaving && t < 8)
      {
         sc = Math.min(112, sc + 8);
      }
      this._xscale = sc;
      this._yscale = inv ? - sc : sc;
      if(leaving && sc < 6)
      {
         this.removeMovieClip();
         return undefined;
      }
      // ondas do som: a pequena e depois a grande, pulsando
      var w1 = this.icon_mc.w1_mc;
      var w2 = this.icon_mc.w2_mc;
      var a = (t % 18) / 18;
      w1._alpha = a < 0.5 ? 35 + 130 * a : 100 - 100 * (a - 0.5);
      var b = ((t + 6) % 18) / 18;
      w2._alpha = b < 0.5 ? 25 + 150 * b : 100 - 110 * (b - 0.5);
      // o balão "puxa" de leve no ritmo da fala
      this.bg_mc._yscale = 100 + Math.sin(t / 2.2) * 4;
      this.icon_mc._xscale = this.icon_mc._yscale = 100 + Math.sin(t / 2.2) * 5;
   };
   return c;
}
function pcsUpdate(csv)
{
   if(BALLOONS == undefined || ENGINE == undefined)
   {
      return false;
   }
   if(pcsLayer == undefined || pcsLayer._name == undefined)
   {
      pcsLayer = BALLOONS.createEmptyMovieClip("pcsTalk_mc", 1000000);
      pcsSpeaking = {};
   }
   var now = {};
   var ids = String(csv == undefined ? "" : csv).split(",");
   var i = 0;
   while(i < ids.length)
   {
      var id = Number(ids[i]);
      if(ids[i] != "" && !isNaN(id))
      {
         now[id] = true;
         var c = pcsSpeaking[id];
         if(c == undefined || c._name == undefined)
         {
            pcsSpeaking[id] = pcsMake(id);
         }
         else
         {
            c.pcsLeaving = false;
         }
      }
      i++;
   }
   for(var k in pcsSpeaking)
   {
      if(now[k] != true)
      {
         if(pcsSpeaking[k]._name != undefined)
         {
            pcsSpeaking[k].pcsLeaving = true;
         }
         delete pcsSpeaking[k];
      }
   }
   return true;
}
if(pcvEI.available)
{
   pcvEI.addCallback("pracaSpeaking", null, function(csv)
   {
      return pcsUpdate(csv);
   });
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
   // Segundo plano (a pessoa saiu da página do jogo, mas ele continua
   // conectado): a página baixa a qualidade ("low" = sem anti-aliasing, quase
   // nada de memória de vídeo) e volta pra "best" quando a pessoa volta.
   pcvEI.addCallback("pracaQuality", null, function(q)
   {
      var v = String(q).toUpperCase();
      if(v != "LOW" && v != "MEDIUM" && v != "HIGH" && v != "BEST")
      {
         return false;
      }
      _quality = v;
      return true;
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
   // Visitar o iglu de alguém a partir do site (perfil/lista de amigos).
   pcvEI.addCallback("pracaJoinIgloo", null, function(playerId)
   {
      var id = Number(playerId);
      if(isNaN(id) || id <= 0)
      {
         return false;
      }
      shell.sendJoinPlayerIgloo(id);
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

// Centro de Download do Project Club: ícone ao lado do jornal e do correio
// (client/public/praca-ui/download-96.png). Abre o painel da página
// (window.pracaOpenDownloads → praca/DownloadCenter.jsx).
var PCD_SIZE = 40;
function pcdMake()
{
   var icons = MAIL_ICON._parent;
   if(icons == undefined || icons.pcdl_mc != undefined)
   {
      return icons != undefined;
   }
   var b = icons.createEmptyMovieClip("pcdl_mc", icons.getNextHighestDepth());
   var art = b.createEmptyMovieClip("art_mc", 1);
   var holder = art.createEmptyMovieClip("img_mc", 1);
   var l = new MovieClipLoader();
   var lis = {};
   lis.onLoadInit = function(t)
   {
      t.forceSmoothing = true;
      t._width = PCD_SIZE;
      t._height = PCD_SIZE;
      t._x = - PCD_SIZE / 2;
      t._y = - PCD_SIZE / 2;
   };
   l.addListener(lis);
   l.loadClip("/praca-ui/download-96.png", holder);
   var mb = MAIL_ICON.getBounds(icons);
   b._x = mb.xMax + 8 + PCD_SIZE / 2;
   b._y = (mb.yMin + mb.yMax) / 2;
   b.onRollOver = function()
   {
      this.art_mc._xscale = this.art_mc._yscale = 110;
      showHint(this, "Centro de Download", 0, 30, false);
   };
   b.onRollOut = b.onDragOut = function()
   {
      this.art_mc._xscale = this.art_mc._yscale = 100;
      closeHint();
   };
   b.onPress = function()
   {
      this.art_mc._xscale = this.art_mc._yscale = 94;
   };
   b.onRelease = function()
   {
      this.art_mc._xscale = this.art_mc._yscale = 110;
      closeHint();
      if(pcvEI.available)
      {
         pcvEI.call("pracaOpenDownloads");
      }
   };
   return true;
}
var pcdTimer = setInterval(function()
{
   if(MAIL_ICON != undefined && pcdMake())
   {
      clearInterval(pcdTimer);
   }
}, 500);
