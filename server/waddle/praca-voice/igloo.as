// Project Club — editor do iglu (igloo.swf): escolher a direção do móvel.
//
// Inserido no 1º quadro do igloo.swf (depois das classes do editor; ver
// README.md e src/server/file-server/swf-patches.ts). Em 2012 só dava pra
// girar um móvel com as setas do teclado ENQUANTO ele estava sendo arrastado
// (← → giram, ↑ ↓ trocam o modelo) — quase ninguém sabia, e no celular não
// tem teclado. Agora, ao soltar um móvel que tem outras direções, aparece um
// painel com a imagem do móvel em cada direção: clicar numa delas gira o
// móvel (e o iglu salva como sempre). Só no celular/tablet (tela de toque):
// no computador dá pra girar com as setas do teclado, então o painel não
// aparece (a página responde "pracaIsTouch" pelo ExternalInterface).
var pciDZ = _global.com.clubpenguin.igloo.mediator.iglooEditor.IglooRendererDragZoneMediator;
var pciPicker = undefined;
var PCI_THUMB = 40;
var PCI_GAP = 4;
var PCI_PAD = 6;
var PCI_MAX = 8;
var pciTouch = undefined;

function pciIsTouch()
{
   if(pciTouch == undefined)
   {
      var r = flash.external.ExternalInterface.call("pracaIsTouch");
      pciTouch = r == true || r == "true";
   }
   return pciTouch;
}

function pciHidePicker()
{
   if(pciPicker != undefined)
   {
      Mouse.removeListener(pciPicker.pciMouse);
      pciPicker.removeMovieClip();
   }
   pciPicker = undefined;
}

function pciRect(mc, x, y, w, h, r, fill, line, lineAlpha)
{
   mc.lineStyle(2, line, lineAlpha);
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

// Desenha o móvel (com o quadro atual) num quadrinho de PCI_THUMB px.
function pciSnapshot(item, holder)
{
   var b = item.getBounds(item);
   var w = b.xMax - b.xMin;
   var h = b.yMax - b.yMin;
   if(!(w > 0) || !(h > 0))
   {
      return;
   }
   var s = Math.min((PCI_THUMB - 6) / w, (PCI_THUMB - 6) / h);
   var bmp = new flash.display.BitmapData(PCI_THUMB, PCI_THUMB, true, 0);
   var m = new flash.geom.Matrix();
   m.translate(- b.xMin, - b.yMin);
   m.scale(s, s);
   m.translate((PCI_THUMB - w * s) / 2, (PCI_THUMB - h * s) / 2);
   bmp.draw(item, m, null, null, null, true);
   holder.attachBitmap(bmp, 1, "auto", true);
}

function pciApply(zone, med, mainFrame, artFrame)
{
   var item = med.view.item;
   var state = med.state;
   item.gotoAndStop(mainFrame);
   if(artFrame > item.art._totalframes)
   {
      artFrame = 1;
   }
   item.art.gotoAndStop(artFrame);
   state.mainFrame = mainFrame;
   state.artFrame = artFrame;
   zone._renderer.updateFurnitureMediator(med);
}

function pciShowPicker(zone, med)
{
   pciHidePicker();
   if(med == undefined || med.view == undefined || med.view.item == undefined || med.view._name == undefined)
   {
      return;
   }
   var item = med.view.item;
   var rot = item._totalframes;
   var mainNow = item._currentframe;
   var artNow = item.art._currentframe;
   // girar (quadros do item) ou, sem direções, trocar o modelo (quadros da arte)
   var useArt = rot <= 1;
   var count = useArt ? item.art._totalframes : rot;
   if(!(count > 1))
   {
      return;
   }
   count = Math.min(count, PCI_MAX);
   var host = zone._renderer.view;
   var p = host.createEmptyMovieClip("pciPicker_mc", host.getNextHighestDepth());
   pciPicker = p;
   var w = PCI_PAD * 2 + count * PCI_THUMB + (count - 1) * PCI_GAP;
   var h = PCI_PAD * 2 + PCI_THUMB + 16;
   var bg = p.createEmptyMovieClip("bg_mc", 1);
   pciRect(bg, 0, 0, w, h, 9, 0x1C67B5, 0x0A3A70, 100);
   var title = p.createTextField("title_txt", 2, PCI_PAD, 1, w - PCI_PAD * 2, 16);
   var fmt = new TextFormat("_sans", 11, 0xFFFFFF, true, false, false, null, null, "center");
   title.setNewTextFormat(fmt);
   title.selectable = false;
   title.text = useArt ? "Escolha o modelo" : "Escolha a direção";
   var i = 1;
   while(i <= count)
   {
      var b = p.createEmptyMovieClip("opt" + i, 10 + i);
      b._x = PCI_PAD + (i - 1) * (PCI_THUMB + PCI_GAP);
      b._y = PCI_PAD + 14;
      var current = useArt ? i == artNow : i == mainNow;
      var face = b.createEmptyMovieClip("face_mc", 1);
      pciRect(face, 0, 0, PCI_THUMB, PCI_THUMB, 6, current ? 0xFFE240 : 0xEAF4FF, current ? 0xC98A00 : 0x7DB2E6, 100);
      if(useArt)
      {
         item.art.gotoAndStop(i);
      }
      else
      {
         item.gotoAndStop(i);
         if(artNow <= item.art._totalframes)
         {
            item.art.gotoAndStop(artNow);
         }
      }
      pciSnapshot(item, b.createEmptyMovieClip("img_mc", 2));
      b.pciFrame = i;
      b.onRelease = function()
      {
         var pk = this._parent;
         if(pk.pciUseArt)
         {
            pciApply(pk.pciZone, pk.pciMed, pk.pciMed.view.item._currentframe, this.pciFrame);
         }
         else
         {
            pciApply(pk.pciZone, pk.pciMed, this.pciFrame, pk.pciArt);
         }
         pciShowPicker(pk.pciZone, pk.pciMed);
      };
      b.onRollOver = function()
      {
         this._alpha = 80;
      };
      b.onRollOut = b.onDragOut = function()
      {
         this._alpha = 100;
      };
      i++;
   }
   // volta o móvel pra direção em que ele estava
   item.gotoAndStop(mainNow);
   item.art.gotoAndStop(artNow);
   p.pciZone = zone;
   p.pciMed = med;
   p.pciUseArt = useArt;
   p.pciArt = artNow;
   // embaixo do móvel (ou em cima, se não couber), sem sair da tela
   var bb = med.view.getBounds(host);
   var px = Math.round((bb.xMin + bb.xMax) / 2 - w / 2);
   var py = Math.round(bb.yMax + 8);
   if(py + h > 470)
   {
      py = Math.round(bb.yMin - h - 8);
   }
   p._x = Math.max(4, Math.min(756 - w, px));
   p._y = Math.max(90, Math.min(470 - h, py));
   // clicou fora do painel: fecha
   p.pciMouse = {};
   p.pciMouse.onMouseDown = function()
   {
      if(pciPicker != undefined && !pciPicker.hitTest(_root._xmouse, _root._ymouse, false))
      {
         pciHidePicker();
      }
   };
   Mouse.addListener(p.pciMouse);
}

if(pciDZ != undefined && pciDZ.prototype.pciPatched != true)
{
   pciDZ.prototype.pciPatched = true;
   var pciOrigApply = pciDZ.prototype.applyAsset;
   pciDZ.prototype.applyAsset = function()
   {
      var med = this._furnitureMediator;
      pciOrigApply.apply(this, arguments);
      if(med != undefined && med.hasValidPosition && pciIsTouch())
      {
         pciShowPicker(this, med);
      }
   };
   var pciOrigClick = pciDZ.prototype.onFurnitureClick;
   pciDZ.prototype.onFurnitureClick = function()
   {
      pciHidePicker();
      return pciOrigClick.apply(this, arguments);
   };
   var pciOrigRemove = pciDZ.prototype.removeAsset;
   pciDZ.prototype.removeAsset = function()
   {
      pciHidePicker();
      return pciOrigRemove.apply(this, arguments);
   };
}

// Fila de carregamento do editor: trocar o piso (ou o local) enquanto o
// anterior ainda estava baixando destruía o item no meio do carregamento — a
// fila (IglooItemViewLoader) ficava esperando um arquivo que nunca chegava e
// nada mais carregava: o editor "travava". Agora item destruído sai da fila e
// ela segue pro próximo.
var pciLoaderClass = _global.com.clubpenguin.igloo.services.IglooItemViewLoader;
var pciItemClass = _global.com.clubpenguin.igloo.mediator.iglooItems.IglooItemViewMediator;
if(pciLoaderClass != undefined && pciItemClass != undefined && pciLoaderClass.prototype.pciQueuePatched != true)
{
   pciLoaderClass.prototype.pciQueuePatched = true;
   var pciOrigLoadNext = pciLoaderClass.prototype.loadNext;
   pciLoaderClass.prototype.loadNext = function()
   {
      while(this._queue.length > 0 && this._queue[0].pciDead == true)
      {
         this._queue.shift();
      }
      if(this._queue.length == 0)
      {
         this._isLoading = false;
         this._currentView = undefined;
         return;
      }
      this._queue[0].pciLoader = this;
      pciOrigLoadNext.apply(this, arguments);
   };
   var pciOrigDestroy = pciItemClass.prototype.destroy;
   pciItemClass.prototype.destroy = function()
   {
      var me = this;
      var ld = this.pciLoader;
      this.pciDead = true;
      pciOrigDestroy.apply(this, arguments);
      if(ld != undefined && ld._isLoading && ld._currentView == me)
      {
         _global.setTimeout(function()
         {
            if(ld._isLoading && ld._currentView == me)
            {
               ld.onLoadError();
            }
         }, 1);
      }
   };
}
