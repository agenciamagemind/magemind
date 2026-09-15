(function(){
  'use strict';
  const allowed=new Set(['P','H2','H3','STRONG','EM','U','S','BR']);
  const discarded=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE']);
  const inlineCommands=new Set(['bold','italic','underline','strikeThrough']);

  function cleanNode(source,target){
    if(source.nodeType===Node.TEXT_NODE){target.append(document.createTextNode(source.nodeValue||''));return;}
    if(source.nodeType!==Node.ELEMENT_NODE)return;
    let tag=source.tagName.toUpperCase();
    if(discarded.has(tag))return;
    if(tag==='DIV')tag='P';
    if(tag==='B')tag='STRONG';
    if(tag==='I')tag='EM';
    if(tag==='STRIKE'||tag==='DEL')tag='S';
    if(!allowed.has(tag)){
      [...source.childNodes].forEach(child=>cleanNode(child,target));
      return;
    }
    const safe=document.createElement(tag.toLowerCase());
    [...source.childNodes].forEach(child=>cleanNode(child,safe));
    target.append(safe);
  }

  window.sanitizeDemandRichHTML=function(value){
    const source=document.createElement('div');source.innerHTML=String(value||'');
    const target=document.createElement('div');
    [...source.childNodes].forEach(node=>cleanNode(node,target));
    return target.innerHTML.trim();
  };

  window.demandRichEditorHTML=function(value){
    const raw=String(value||'');
    if(/<\/?(?:p|h2|h3|strong|em|u|s|br)\b/i.test(raw))return sanitizeDemandRichHTML(raw);
    return escapeHTML(raw).replace(/\r?\n/g,'<br>');
  };

  window.demandRichValue=function(editor){
    if(!editor)return '';
    const safe=sanitizeDemandRichHTML(editor.innerHTML);
    const probe=document.createElement('div');probe.innerHTML=safe;
    return probe.textContent?.trim()?safe:'';
  };

  function linkify(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    const pattern=/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    nodes.forEach(node=>{
      const text=node.nodeValue||'';pattern.lastIndex=0;if(!pattern.test(text))return;
      pattern.lastIndex=0;const fragment=document.createDocumentFragment();let last=0,match;
      while((match=pattern.exec(text))){
        fragment.append(document.createTextNode(text.slice(last,match.index)));
        let label=match[0];while(/[),.;:!?}\]]$/.test(label))label=label.slice(0,-1);
        const suffix=match[0].slice(label.length),href=/^www\./i.test(label)?`https://${label}`:label;
        try{const parsed=new URL(href);if(!['http:','https:'].includes(parsed.protocol))throw new Error('protocol');const a=document.createElement('a');a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;fragment.append(a);}catch(_){fragment.append(document.createTextNode(label));}
        if(suffix)fragment.append(document.createTextNode(suffix));last=match.index+match[0].length;
      }
      fragment.append(document.createTextNode(text.slice(last)));node.replaceWith(fragment);
    });
  }

  window.renderDemandRichHTML=function(value){
    const raw=String(value||'');
    const root=document.createElement('div');
    root.innerHTML=/<\/?(?:p|h2|h3|strong|em|u|s|br)\b/i.test(raw)
      ? sanitizeDemandRichHTML(raw)
      : escapeHTML(raw);
    linkify(root);return root.innerHTML;
  };

  window.setDemandRichEditor=function(id,value){
    const editor=document.getElementById(id);if(editor)editor.innerHTML=demandRichEditorHTML(value);
  };

  window.formatDemandText=function(editorId,command,value){
    const editor=document.getElementById(editorId);if(!editor)return;
    editor.focus({preventScroll:true});
    if(command==='formatBlock')document.execCommand('formatBlock',false,value);
    else if(inlineCommands.has(command))document.execCommand(command,false,null);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  };

  window.demandRichToolbar=function(editorId){
    const button=(label,title,command,value='')=>`<button type="button" title="${title}" aria-label="${title}" onmousedown="event.preventDefault()" onclick="formatDemandText('${editorId}','${command}','${value}')">${label}</button>`;
    return `<div class="demand-format-toolbar" role="toolbar" aria-label="Formatação da descrição">${button('<b>B</b>','Negrito','bold')}${button('<i>I</i>','Itálico','italic')}${button('<u>U</u>','Sublinhado','underline')}${button('<s>S</s>','Tachado','strikeThrough')}<span aria-hidden="true"></span>${button('Título','Tamanho título','formatBlock','h2')}${button('Subtítulo','Tamanho subtítulo','formatBlock','h3')}${button('Parágrafo','Tamanho parágrafo','formatBlock','p')}</div>`;
  };
})();
