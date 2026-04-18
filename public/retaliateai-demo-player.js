(function () {
  if (window.RetaliateAIDemo) return;

  var PLAYER_ID = 'retaliateai-demo-player-overlay';
  var STYLE_ID = 'retaliateai-demo-player-styles';

  function parseBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return String(value).toLowerCase() !== 'false';
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value || '');
    } catch (_error) {
      return value || '';
    }
  }

  function parseDemo(raw) {
    if (!raw) return { steps: [] };
    try {
      return JSON.parse(safeDecode(raw));
    } catch (_error) {
      return { steps: [] };
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = "\n@keyframes retaliateai-pulse{0%{transform:translate(-50%,-50%) scale(1);opacity:.9}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:.9}}\n@keyframes retaliateai-bounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-10px)}}\n@keyframes retaliateai-click{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(.82)}}\n#" + PLAYER_ID + "{position:fixed;inset:0;background:rgba(9,9,11,.78);z-index:2147483646;color:#fff;font-family:Inter,system-ui,sans-serif;}\n#" + PLAYER_ID + " .ra-stage{position:absolute;inset:0;}\n#" + PLAYER_ID + " .ra-close{position:absolute;left:16px;top:16px;padding:8px 10px;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#fff;cursor:pointer;}\n#" + PLAYER_ID + " .ra-progress{position:absolute;left:0;bottom:0;height:4px;background:#dc2626;width:0%;transition:width .1s linear;}\n#" + PLAYER_ID + " .ra-step-count{position:absolute;top:16px;right:16px;border:1px solid #3f3f46;background:#18181b;padding:8px 10px;border-radius:10px;font-size:12px;color:#d4d4d8;}\n#" + PLAYER_ID + " .ra-hint{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 14px;border-radius:999px;background:#dc2626;border:1px solid #7f1d1d;font-size:13px;font-weight:600;cursor:pointer;color:#fff;}\n#" + PLAYER_ID + " .ra-tooltip,#" + PLAYER_ID + " .ra-text{position:absolute;max-width:320px;background:#18181b;border:1px solid #7f1d1d;border-radius:12px;padding:10px 12px;box-shadow:0 18px 40px rgba(0,0,0,.45);}\n#" + PLAYER_ID + " .ra-modal-backdrop{position:absolute;inset:0;background:rgba(9,9,11,.62);display:grid;place-items:center;}\n#" + PLAYER_ID + " .ra-modal{width:min(420px,92vw);background:#18181b;border:1px solid #7f1d1d;border-radius:16px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.55);}\n#" + PLAYER_ID + " .ra-modal h3{margin:0 0 8px 0;font-size:20px;}\n#" + PLAYER_ID + " .ra-modal p{margin:0 0 14px 0;color:#d4d4d8;line-height:1.5;}\n#" + PLAYER_ID + " .ra-cta{padding:9px 14px;border-radius:10px;border:1px solid #7f1d1d;background:#dc2626;color:#fff;cursor:pointer;font-weight:600;}\n#" + PLAYER_ID + " .ra-highlight{position:absolute;border:2px solid #ef4444;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;}\n#" + PLAYER_ID + " .ra-pointer{position:absolute;transform:translate(-50%,-50%);pointer-events:none;}\n#" + PLAYER_ID + " .ra-pointer svg{width:34px;height:34px;filter:drop-shadow(0 8px 12px rgba(0,0,0,.45));}\n#" + PLAYER_ID + " .ra-trail{position:absolute;width:7px;height:7px;border-radius:999px;background:rgba(239,68,68,.45);transform:translate(-50%,-50%);pointer-events:none;}\n";
    document.head.appendChild(style);
  }

  function createContainer() {
    var existing = document.getElementById(PLAYER_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = PLAYER_ID;
    root.style.display = 'none';
    root.innerHTML = '<button class="ra-close" aria-label="Close demo">✕</button><div class="ra-step-count">0 / 0</div><div class="ra-stage"></div><div class="ra-progress"></div>';
    root.querySelector('.ra-close').addEventListener('click', stop);
    root.addEventListener('click', function (event) {
      if (state.currentStep && state.currentStep.advance === 'click') {
        if (event.target.closest('.ra-modal')) return;
        next();
      }
    });
    document.body.appendChild(root);
    return root;
  }

  function clearTimers() {
    if (state.stepTimer) {
      clearTimeout(state.stepTimer);
      state.stepTimer = null;
    }
    if (state.progressTimer) {
      cancelAnimationFrame(state.progressTimer);
      state.progressTimer = null;
    }
    if (state.pathTimer) {
      clearInterval(state.pathTimer);
      state.pathTimer = null;
    }
  }

  function clearStage() {
    if (!state.root) return;
    var stage = state.root.querySelector('.ra-stage');
    if (stage) stage.innerHTML = '';
    var hint = state.root.querySelector('.ra-hint');
    if (hint) hint.remove();
  }

  function updateProgress(total) {
    if (!state.root) return;
    var progress = state.root.querySelector('.ra-progress');
    if (!progress) return;
    progress.style.width = '0%';
    var start = Date.now();

    function frame() {
      if (!state.playing) return;
      var elapsed = Date.now() - start;
      var value = Math.min(100, (elapsed / Math.max(total, 1)) * 100);
      progress.style.width = value + '%';
      if (value < 100) {
        state.progressTimer = requestAnimationFrame(frame);
      }
    }

    state.progressTimer = requestAnimationFrame(frame);
  }

  function updateCounter() {
    if (!state.root) return;
    var node = state.root.querySelector('.ra-step-count');
    if (!node) return;
    node.textContent = (state.index + 1) + ' / ' + state.demo.steps.length;
  }

  function addClickHint() {
    if (!state.root) return;
    var hint = document.createElement('button');
    hint.className = 'ra-hint';
    hint.textContent = 'Click to continue →';
    hint.addEventListener('click', function (event) {
      event.stopPropagation();
      next();
    });
    state.root.appendChild(hint);
  }

  function selectorRect(selector) {
    if (!selector) return null;
    var element = document.querySelector(selector);
    if (!element) return null;
    return element.getBoundingClientRect();
  }

  function placeTooltip(targetRect, position, node) {
    var x = targetRect.left + targetRect.width / 2;
    var y = targetRect.top + targetRect.height / 2;

    if (position === 'top') {
      node.style.left = x + 'px';
      node.style.top = (targetRect.top - 12) + 'px';
      node.style.transform = 'translate(-50%, -100%)';
      return;
    }
    if (position === 'left') {
      node.style.left = (targetRect.left - 12) + 'px';
      node.style.top = y + 'px';
      node.style.transform = 'translate(-100%, -50%)';
      return;
    }
    if (position === 'right') {
      node.style.left = (targetRect.right + 12) + 'px';
      node.style.top = y + 'px';
      node.style.transform = 'translate(0, -50%)';
      return;
    }

    node.style.left = x + 'px';
    node.style.top = (targetRect.bottom + 12) + 'px';
    node.style.transform = 'translate(-50%, 0)';
  }

  function renderStep(step) {
    if (!state.root) return;
    var stage = state.root.querySelector('.ra-stage');
    if (!stage || !step) return;

    if (step.type === 'highlight') {
      var rect = selectorRect(step.selector);
      if (!rect) return;
      var pad = step.config && step.config.padding || 8;
      var node = document.createElement('div');
      node.className = 'ra-highlight';
      node.style.left = (rect.left - pad) + 'px';
      node.style.top = (rect.top - pad) + 'px';
      node.style.width = (rect.width + pad * 2) + 'px';
      node.style.height = (rect.height + pad * 2) + 'px';
      node.style.borderRadius = ((step.config && step.config.borderRadius) || 8) + 'px';
      node.style.borderColor = step.config && step.config.color || '#ef4444';
      if (step.config && step.config.pulse) {
        node.style.animation = 'retaliateai-pulse 1.1s infinite ease-in-out';
      }
      stage.appendChild(node);
      return;
    }

    if (step.type === 'tooltip') {
      var targetRect = selectorRect(step.selector) || {
        left: window.innerWidth / 2 - 60,
        top: window.innerHeight / 2 - 20,
        width: 120,
        height: 40,
        right: window.innerWidth / 2 + 60,
        bottom: window.innerHeight / 2 + 20,
      };
      var tooltip = document.createElement('div');
      tooltip.className = 'ra-tooltip';
      tooltip.textContent = step.config && step.config.text || '';
      placeTooltip(targetRect, step.config && step.config.position || 'bottom', tooltip);
      stage.appendChild(tooltip);
      return;
    }

    if (step.type === 'modal') {
      var backdrop = document.createElement('div');
      backdrop.className = 'ra-modal-backdrop';
      var modal = document.createElement('div');
      modal.className = 'ra-modal';
      var title = document.createElement('h3');
      title.textContent = step.config && step.config.title || 'Notice';
      var body = document.createElement('p');
      body.textContent = step.config && step.config.body || '';
      var button = document.createElement('button');
      button.className = 'ra-cta';
      button.textContent = step.config && step.config.cta || 'Continue';
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        var action = step.config && step.config.ctaAction;
        if (action === 'url' && step.config && step.config.ctaUrl) {
          window.open(step.config.ctaUrl, '_blank', 'noopener,noreferrer');
          return;
        }
        if (action === 'close') {
          stop();
          return;
        }
        next();
      });
      modal.appendChild(title);
      modal.appendChild(body);
      modal.appendChild(button);
      backdrop.appendChild(modal);
      stage.appendChild(backdrop);
      return;
    }

    if (step.type === 'pointer') {
      var pointer = document.createElement('div');
      pointer.className = 'ra-pointer';
      pointer.style.left = ((step.config && step.config.x) || 50) + '%';
      pointer.style.top = ((step.config && step.config.y) || 50) + '%';
      pointer.style.color = step.config && step.config.pointerColor || '#ef4444';
      var animationType = step.config && step.config.animation || 'pulse';
      if (animationType === 'bounce') {
        pointer.style.animation = 'retaliateai-bounce .8s infinite ease-in-out';
      } else if (animationType === 'click') {
        pointer.style.animation = 'retaliateai-click .9s infinite ease-in-out';
      } else {
        pointer.style.animation = 'retaliateai-pulse 1s infinite ease-in-out';
      }
      pointer.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3l8.5 8.5M4 3l3 13 3.5-4.5L15 15 16.5 13.5 12 9l4.5-3.5z"></path></svg>';
      stage.appendChild(pointer);
      return;
    }

    if (step.type === 'cursor-path') {
      var points = step.config && step.config.points || [];
      if (!points.length) return;

      if (step.config && step.config.showTrail) {
        points.forEach(function (point) {
          var trail = document.createElement('span');
          trail.className = 'ra-trail';
          trail.style.left = point.x + '%';
          trail.style.top = point.y + '%';
          stage.appendChild(trail);
        });
      }

      var cursor = document.createElement('div');
      cursor.className = 'ra-pointer';
      cursor.style.left = points[0].x + '%';
      cursor.style.top = points[0].y + '%';
      cursor.style.color = '#ef4444';
      cursor.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3l8.5 8.5M4 3l3 13 3.5-4.5L15 15 16.5 13.5 12 9l4.5-3.5z"></path></svg>';
      stage.appendChild(cursor);

      var index = 0;
      var segmentMs = Math.max((step.duration || 3000) / Math.max(points.length - 1, 1), 180);
      state.pathTimer = setInterval(function () {
        index += 1;
        if (index >= points.length) {
          clearInterval(state.pathTimer);
          state.pathTimer = null;
          return;
        }
        cursor.style.left = points[index].x + '%';
        cursor.style.top = points[index].y + '%';
      }, segmentMs);
      return;
    }

    if (step.type === 'text') {
      var text = document.createElement('div');
      text.className = 'ra-text';
      text.textContent = step.config && step.config.content || '';
      text.style.left = ((step.config && step.config.textX) || 50) + '%';
      text.style.top = ((step.config && step.config.textY) || 20) + '%';
      text.style.transform = 'translate(-50%, -50%)';

      var style = step.config && step.config.style || 'card';
      if (style === 'bubble') {
        text.style.background = '#dc2626';
        text.style.borderColor = '#7f1d1d';
      }
      if (style === 'inline') {
        text.style.background = 'rgba(0,0,0,.65)';
        text.style.borderColor = '#3f3f46';
        text.style.borderRadius = '8px';
        text.style.padding = '6px 10px';
        text.style.fontSize = '12px';
      }

      stage.appendChild(text);
    }
  }

  function goTo(index) {
    if (!state.demo.steps.length) return;
    clearTimers();
    clearStage();

    state.index = Math.max(0, Math.min(index, state.demo.steps.length - 1));
    state.currentStep = state.demo.steps[state.index];
    renderStep(state.currentStep);
    updateCounter();

    var total = (state.currentStep.delay || 0) + (state.currentStep.duration || 0);
    updateProgress(total);

    if (state.currentStep.advance !== 'click') {
      state.stepTimer = setTimeout(function () {
        next();
      }, total);
    } else {
      addClickHint();
    }
  }

  function next() {
    if (state.index >= state.demo.steps.length - 1) {
      stop();
      return;
    }
    goTo(state.index + 1);
  }

  function play() {
    if (!state.demo.steps.length) return;
    ensureStyles();
    state.root = createContainer();
    state.root.style.display = 'block';
    state.playing = true;
    goTo(state.index || 0);
  }

  function pause() {
    state.playing = false;
    clearTimers();
  }

  function stop() {
    state.playing = false;
    clearTimers();
    state.index = 0;
    state.currentStep = null;
    if (state.root) {
      state.root.style.display = 'none';
      clearStage();
      var progress = state.root.querySelector('.ra-progress');
      if (progress) progress.style.width = '0%';
      updateCounter();
    }
  }

  function initFromScriptTag() {
    var script = document.currentScript;
    if (!script) return;

    var demo = parseDemo(script.getAttribute('data-demo'));
    var autoplay = parseBool(script.getAttribute('data-autoplay'), true);
    var trigger = script.getAttribute('data-trigger') || '';
    var position = script.getAttribute('data-position') || 'center';

    state.demo = demo;
    state.options = { autoplay: autoplay, trigger: trigger, position: position };

    if (!autoplay && trigger) {
      var triggerEl = document.querySelector(trigger);
      if (triggerEl) {
        triggerEl.addEventListener('click', function () {
          play();
        });
        return;
      }
    }

    if (autoplay) {
      play();
    }
  }

  var state = {
    root: null,
    demo: { steps: [] },
    options: { autoplay: true, trigger: '', position: 'center' },
    index: 0,
    currentStep: null,
    stepTimer: null,
    progressTimer: null,
    pathTimer: null,
    playing: false,
  };

  window.RetaliateAIDemo = {
    play: play,
    pause: pause,
    stop: stop,
    goTo: goTo,
  };

  initFromScriptTag();
})();
