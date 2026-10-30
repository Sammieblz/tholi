/** Synthetic private paint. Fixture oracles return geometry, never field text. */
export const privateCapturePage = String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><title>Private pixel fixture</title>
<style>
html,body{margin:0;background:rgb(17,19,23);color:white;font:14px sans-serif}
html{overflow-y:scroll;scrollbar-gutter:stable}body{height:1600px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:40px 16px 0}
.cell,input,select,textarea,[contenteditable],[role=textbox],[role=searchbox],[role=combobox]{box-sizing:border-box;min-width:0;width:100%;height:28px;margin:0;border:0;padding:2px;background:rgb(244,17,183);color:white;font:14px sans-serif}
#public-color{position:fixed;left:40px;top:6px;width:36px;height:18px;background:rgb(31,111,235)}
#right-edge{position:fixed;right:0;top:340px;width:24px;height:26px;padding:0}
#owned{position:fixed;right:2px;top:2px;width:12px;height:12px;background:rgb(244,17,183);z-index:2147483000}
#owned-overflow{position:fixed;right:2px;top:16px;width:14px;height:14px;visibility:visible!important;background:rgb(244,17,183)}
</style>
<div id="public-color"></div><div class="grid">
<input data-private-oracle id="search" type="search" aria-label="Search catalogue" value="SYNTHETIC_ALPHA" autocomplete="off">
<select data-private-oracle aria-label="Choice"><option>SYNTHETIC_SELECT</option></select>
<textarea data-private-oracle aria-label="Notes">SYNTHETIC_TEXTAREA</textarea>
<div data-private-oracle contenteditable="true" aria-label="Editor">SYNTHETIC_EDITOR</div>
<div data-private-oracle role="textbox" aria-label="Custom editor">SYNTHETIC_TEXTBOX</div>
<div data-private-oracle role="searchbox" aria-label="Custom search">SYNTHETIC_SEARCH</div>
<div data-private-oracle role="combobox" aria-label="Custom choice" aria-expanded="false">SYNTHETIC_COMBOBOX</div>
<div data-private-oracle data-sensitive="true">SYNTHETIC_SCOPE</div>
<iframe data-private-oracle title="Private embedded content" style="width:100%;height:28px;border:0" srcdoc="<body style='margin:0;background:rgb(244,17,183);color:white'>SYNTHETIC_FRAME</body>"></iframe>
<div class="cell" id="open-root"></div><div class="cell" id="closed-root"></div><div class="cell" id="nested-root"></div>
<div class="cell" id="dynamic-open"></div><div class="cell" id="dynamic-closed"></div>
</div>
<input data-private-oracle id="right-edge" aria-label="Right edge field" value="SYNTHETIC_EDGE" autocomplete="off">
<input data-private-oracle id="bottom-edge" aria-label="Bottom edge field" value="SYNTHETIC_BOTTOM" style="position:fixed;left:80px;bottom:0;width:36px;height:1px;padding:0" autocomplete="off">
<div id="owned" data-tholi-ui style="opacity:0.81!important;visibility:visible!important;transition-property:opacity,transform!important;animation-play-state:paused!important"><div id="owned-overflow"></div></div>
<script>
(() => {
 const oracles=[...document.querySelectorAll('[data-private-oracle]')].map(element=>()=>element.getBoundingClientRect());
 const box=rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height});
 const privateNode=root=>{
  const element=document.createElement('div'); element.setAttribute('role','textbox'); element.setAttribute('aria-label','Shadow editor');
  element.style.cssText='display:block;box-sizing:border-box;width:100%;height:28px;background:rgb(244,17,183);color:white;font:14px sans-serif';
  element.textContent='SYNTHETIC_SHADOW'; root.append(element); oracles.push(()=>element.getBoundingClientRect()); return element;
 };
 privateNode(document.getElementById('open-root').attachShadow({mode:'open'}));
 privateNode(document.getElementById('closed-root').attachShadow({mode:'closed'}));
 const nested=document.getElementById('nested-root').attachShadow({mode:'closed'}),inner=document.createElement('span'); nested.append(inner);
 privateNode(inner.attachShadow({mode:'open'}));
 const textScope=document.createElement('div'); textScope.dataset.sensitive='true';
 textScope.style.cssText='position:fixed;left:16px;top:270px;width:0;height:0;overflow:visible;white-space:nowrap;font:16px sans-serif';
 const text=document.createTextNode('SYNTHETIC_PRIVATE_TEXT');textScope.append(text);document.body.append(textScope);
 oracles.push(()=>{const range=document.createRange();range.selectNodeContents(text);const rect=range.getBoundingClientRect();range.detach();return rect});
 const band=document.createElement('div');band.dataset.sensitive='true';band.style.cssText='position:fixed;left:160px;width:0;height:0;overflow:visible;white-space:nowrap;font:1px/1px sans-serif';
 const bandText=document.createTextNode('SYNTHETIC_FRACTIONAL_TEXT');band.append(bandText);document.body.append(band);
 const positionBand=()=>{band.style.top=innerHeight+'px'};positionBand();window.addEventListener('resize',positionBand);
 oracles.push(()=>{const range=document.createRange();range.selectNodeContents(bandText);const rect=range.getBoundingClientRect();range.detach();return rect});
 const zeroHost=document.createElement('div');zeroHost.style.cssText='position:fixed;left:250px;top:300px;width:0;height:0;overflow:visible';document.body.append(zeroHost);
 const overflow=privateNode(zeroHost.attachShadow({mode:'closed'}));overflow.style.cssText+=';position:absolute;left:0;top:0;width:80px;height:20px';
 const slotHost=document.createElement('div');slotHost.style.cssText='position:fixed;left:110px;top:6px;width:0;height:0;overflow:visible';
 const assigned=document.createElement('span');assigned.slot='private';assigned.style.cssText='display:block;width:64px;height:18px;background:rgb(244,17,183);color:white;font:12px sans-serif';assigned.textContent='SYNTHETIC_SLOT';
 const publicSibling=document.createElement('span');publicSibling.style.cssText='position:fixed;left:280px;top:6px;width:36px;height:18px;background:rgb(245,166,35)';
 slotHost.append(assigned,publicSibling);document.body.append(slotHost);
 const slotRoot=slotHost.attachShadow({mode:'closed'}),privateWrapper=document.createElement('div'),privateSlot=document.createElement('slot');
 privateWrapper.dataset.sensitive='true';privateWrapper.style.cssText='width:0;height:0;overflow:visible';privateSlot.name='private';privateWrapper.append(privateSlot);slotRoot.append(privateWrapper,document.createElement('slot'));
 const privateSlotIndex=oracles.length;oracles.push(()=>assigned.getBoundingClientRect());
 const slotTextRect=()=>{const range=document.createRange();range.selectNodeContents(assigned);const rect=range.getBoundingClientRect();range.detach();return rect};
 const privateSlotOverflowIndex=oracles.length;oracles.push(()=>{const text=slotTextRect(),span=assigned.getBoundingClientRect();return new DOMRect(span.right,text.y,text.right-span.right,text.height)});
 let dynamic=false,animation;
 window.__vision38Fixture={
  addDynamic(){if(dynamic)return;dynamic=true;privateNode(document.getElementById('dynamic-open').attachShadow({mode:'open'}));privateNode(document.getElementById('dynamic-closed').attachShadow({mode:'closed'}))},
  geometry(){const range=document.createRange();range.selectNodeContents(bandText);const fractionalTextRect=box(range.getBoundingClientRect());range.detach();const text=slotTextRect(),span=assigned.getBoundingClientRect(),publicRect=publicSibling.getBoundingClientRect();return{privateRects:oracles.map(read=>box(read())),privateSlotIndex,privateSlotOverflowIndex,publicSlotOutsidePrivateText:publicRect.x>Math.max(text.right,span.right)+2,publicSlotRect:box(publicRect),bottomRect:box(document.getElementById('bottom-edge').getBoundingClientRect()),fractionalTextRect,viewport:{layoutHeight:innerHeight,visualHeight:visualViewport.height,visualWidth:visualViewport.width},publicRect:box(document.getElementById('public-color').getBoundingClientRect()),ownedRects:[box(document.getElementById('owned').getBoundingClientRect()),box(document.getElementById('owned-overflow').getBoundingClientRect())]}},
  ownedStyles(){const e=document.getElementById('owned');return['opacity','visibility','transition-property','animation-play-state'].map(key=>[key,e.style.getPropertyValue(key),e.style.getPropertyPriority(key)])},
  changePrivateValue(){document.getElementById('search').value='SYNTHETIC_BETA'},
  changePrivateGeometry(){document.getElementById('search').style.width='80px'},
  animatePrivate(){animation=document.getElementById('search').animate([{transform:'translateX(0)'},{transform:'translateX(4px)'}],{duration:1000,iterations:Infinity})},
  stopAnimation(){if(animation){animation.cancel();animation=undefined}}
 };
})();
</script></html>`;
