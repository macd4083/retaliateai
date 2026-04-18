export function generateJSON(demo) {
  return JSON.stringify(demo, null, 2);
}

function encodeDemo(demo) {
  try {
    return encodeURIComponent(JSON.stringify(demo));
  } catch (_error) {
    return encodeURIComponent('{}');
  }
}

export function generateEmbedScript(demo, options = {}) {
  const {
    autoplay = true,
    trigger = '',
    position = 'center',
    src = '/retaliateai-demo-player.js',
  } = options;

  const encodedDemo = encodeDemo(demo);

  return `<script src="${src}" data-demo="${encodedDemo}" data-autoplay="${String(autoplay)}" data-trigger="${trigger}" data-position="${position}" defer></script>`;
}

export function generateStandaloneHTML(demo) {
  const encodedDemo = encodeDemo(demo);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${(demo?.name || 'RetaliateAI Demo').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #09090b; color: #fff; font-family: Inter, system-ui, sans-serif; }
    #retaliateai-standalone-root { min-height: 100vh; display: grid; place-items: center; }
    .retaliateai-launch { border: 1px solid #7f1d1d; background: #dc2626; color: #fff; border-radius: 12px; padding: 12px 18px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div id="retaliateai-standalone-root">
    <button id="retaliateai-start" class="retaliateai-launch">Play Demo</button>
  </div>
  <script>
    window.__RETALIATEAI_EMBED_DEMO__ = decodeURIComponent('${encodedDemo}');
  </script>
  <script>
${standalonePlayerScript()}
  </script>
  <script>
    (function () {
      var button = document.getElementById('retaliateai-start');
      if (!button || !window.RetaliateAIDemo) return;
      button.addEventListener('click', function () {
        window.RetaliateAIDemo.play();
      });
    })();
  </script>
</body>
</html>`;
}

function standalonePlayerScript() {
  return `
(function () {
  if (window.RetaliateAIDemo) return;

  var style = document.createElement('style');
  style.textContent = '\n.retdemo-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483646;color:#fff;font-family:Inter,system-ui,sans-serif;}\n.retdemo-close{position:absolute;top:16px;left:16px;background:#18181b;border:1px solid #3f3f46;color:#fff;border-radius:8px;padding:8px 10px;cursor:pointer;}\n.retdemo-progress{position:absolute;left:0;bottom:0;height:4px;background:#dc2626;transition:width .2s linear;}\n.retdemo-tooltip,.retdemo-text,.retdemo-modal{position:absolute;background:#111827;border:1px solid #7f1d1d;border-radius:12px;padding:12px;max-width:320px;box-shadow:0 15px 40px rgba(0,0,0,.45);}\n.retdemo-modal-wrap{position:absolute;inset:0;display:grid;place-items:center;background:rgba(9,9,11,.56);}\n.retdemo-pointer{position:absolute;transform:translate(-50%,-50%);font-size:26px;line-height:1;}\n.retdemo-highlight{position:absolute;border:2px solid #ef4444;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.6);pointer-events:none;}\n';
  document.head.appendChild(style);

  function parseDemo() {
    var inline = window.__RETALIATEAI_EMBED_DEMO__;
    if (!inline) return null;
    try { return JSON.parse(inline); } catch (_e) { return null; }
  }

  var api = {
    play: play,
    pause: pause,
    stop: stop,
    goTo: goTo,
  };

  var demo = parseDemo() || { steps: [] };
  var state = { index: 0, timer: null, playing: false, overlay: null, progress: null, startedAt: 0 };

  function createOverlay() {
    if (state.overlay) return;
    var node = document.createElement('div');
    node.className = 'retdemo-overlay';
    node.innerHTML = '<button class="retdemo-close">✕</button><div class="retdemo-stage"></div><div class="retdemo-progress" style="width:0%"></div>';
    node.querySelector('.retdemo-close').addEventListener('click', stop);
    node.addEventListener('click', function (event) {
      var step = demo.steps[state.index];
      if (step && step.advance === 'click') {
        event.stopPropagation();
        next();
      }
    });
    document.body.appendChild(node);
    state.overlay = node;
    state.progress = node.querySelector('.retdemo-progress');
  }

  function clearStage() {
    var stage = state.overlay && state.overlay.querySelector('.retdemo-stage');
    if (stage) stage.innerHTML = '';
  }

  function renderStep(step) {
    if (!step || !state.overlay) return;
    var stage = state.overlay.querySelector('.retdemo-stage');
    if (!stage) return;

    if (step.type === 'highlight' && step.selector) {
      var target = document.querySelector(step.selector);
      if (target) {
        var rect = target.getBoundingClientRect();
        var ring = document.createElement('div');
        ring.className = 'retdemo-highlight';
        var pad = step.config && step.config.padding || 8;
        ring.style.left = (rect.left - pad) + 'px';
        ring.style.top = (rect.top - pad) + 'px';
        ring.style.width = (rect.width + pad * 2) + 'px';
        ring.style.height = (rect.height + pad * 2) + 'px';
        ring.style.borderColor = step.config && step.config.color || '#ef4444';
        ring.style.borderRadius = ((step.config && step.config.borderRadius) || 8) + 'px';
        stage.appendChild(ring);
      }
      return;
    }

    if (step.type === 'tooltip') {
      var tooltip = document.createElement('div');
      tooltip.className = 'retdemo-tooltip';
      tooltip.textContent = (step.config && step.config.text) || '';
      tooltip.style.left = 'calc(50% - 160px)';
      tooltip.style.top = '20%';
      stage.appendChild(tooltip);
      return;
    }

    if (step.type === 'modal') {
      var wrap = document.createElement('div');
      wrap.className = 'retdemo-modal-wrap';
      var modal = document.createElement('div');
      modal.className = 'retdemo-modal';
      modal.innerHTML = '<h3 style="margin:0 0 8px 0">' + ((step.config && step.config.title) || 'Modal') + '</h3><p style="margin:0 0 10px 0;color:#d4d4d8">' + ((step.config && step.config.body) || '') + '</p><button style="background:#dc2626;border:1px solid #7f1d1d;border-radius:8px;color:#fff;padding:8px 12px;cursor:pointer">' + ((step.config && step.config.cta) || 'Continue') + '</button>';
      wrap.appendChild(modal);
      stage.appendChild(wrap);
      var button = modal.querySelector('button');
      if (button) {
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          var action = step.config && step.config.ctaAction;
          if (action === 'url' && step.config && step.config.ctaUrl) {
            window.open(step.config.ctaUrl, '_blank', 'noopener,noreferrer');
            return;
          }
          next();
        });
      }
      return;
    }

    if (step.type === 'pointer') {
      var pointer = document.createElement('div');
      pointer.className = 'retdemo-pointer';
      pointer.textContent = '🖱️';
      pointer.style.left = ((step.config && step.config.x) || 50) + '%';
      pointer.style.top = ((step.config && step.config.y) || 50) + '%';
      stage.appendChild(pointer);
      return;
    }

    if (step.type === 'cursor-path') {
      var points = (step.config && step.config.points) || [];
      if (!points.length) return;
      var pathPointer = document.createElement('div');
      pathPointer.className = 'retdemo-pointer';
      pathPointer.textContent = '🖱️';
      stage.appendChild(pathPointer);
      var i = 0;
      function tick() {
        if (!state.playing || i >= points.length) return;
        pathPointer.style.left = points[i].x + '%';
        pathPointer.style.top = points[i].y + '%';
        i += 1;
        setTimeout(tick, Math.max(150, (step.duration || 3000) / Math.max(points.length, 1)));
      }
      tick();
      return;
    }

    if (step.type === 'text') {
      var text = document.createElement('div');
      text.className = 'retdemo-text';
      text.textContent = (step.config && step.config.content) || '';
      text.style.left = ((step.config && step.config.textX) || 50) + '%';
      text.style.top = ((step.config && step.config.textY) || 30) + '%';
      text.style.transform = 'translate(-50%, -50%)';
      stage.appendChild(text);
    }
  }

  function updateProgress(step) {
    if (!state.progress) return;
    state.progress.style.width = '0%';
    var total = Math.max((step.delay || 0) + (step.duration || 0), 1);
    var start = Date.now();
    function frame() {
      if (!state.playing) return;
      var elapsed = Date.now() - start;
      state.progress.style.width = Math.min((elapsed / total) * 100, 100) + '%';
      if (elapsed < total) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function goTo(index) {
    if (!demo.steps || !demo.steps.length) return;
    state.index = Math.max(0, Math.min(index, demo.steps.length - 1));
    clearTimeout(state.timer);
    clearStage();

    var step = demo.steps[state.index];
    renderStep(step);
    updateProgress(step);

    if (step.advance !== 'click') {
      state.timer = setTimeout(next, (step.delay || 0) + (step.duration || 0));
    }
  }

  function next() {
    if (!demo.steps || state.index >= demo.steps.length - 1) {
      stop();
      return;
    }
    goTo(state.index + 1);
  }

  function play() {
    if (!demo.steps || !demo.steps.length) return;
    createOverlay();
    state.overlay.style.display = 'block';
    state.playing = true;
    goTo(state.index || 0);
  }

  function pause() {
    state.playing = false;
    clearTimeout(state.timer);
  }

  function stop() {
    state.playing = false;
    clearTimeout(state.timer);
    state.index = 0;
    if (state.overlay) {
      state.overlay.style.display = 'none';
      clearStage();
    }
  }

  window.RetaliateAIDemo = api;
})();
`;
}
