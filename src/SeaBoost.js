function init() {
  $ui.register((ctx) => {
    const BOOTSTRAP_ATTR = "data-seaboost-bootstrap";
    const PLUGIN_VERSION = "0.3.0";
    var pokeSerial = 0;
    var configuredMax = parseInt($getUserPreference("maxVolume") || "300", 10);
    if (!isFinite(configuredMax)) configuredMax = 300;
    configuredMax = Math.max(100, Math.min(500, configuredMax));

    function pageBootstrap(maxVolume) {
      (function () {
        var host = window.parent;
        var doc = host && host.document;
        if (!host || !doc) return;

        var VERSION = "0.3.0";
        var MARKER = "data-seaboost-native";
        var STYLE_ID = "seaboost-native-slider-style";
        var TRACK_CLASS = "sb-native-track";
        var STORAGE_KEY = "seaboost.volumePercent";
        var VOLUME_STEP = 10;

        maxVolume = parseInt(String(maxVolume), 10);
        if (!isFinite(maxVolume)) maxVolume = 300;
        maxVolume = Math.max(100, Math.min(500, maxVolume));

        if (host.__seaboost && host.__seaboost.version === VERSION && host.__seaboost.maxVolume === maxVolume) {
          try { host.__seaboost.mount(); } catch (_) {}
          return;
        }

        if (host.__seaboost && host.__seaboost.destroy) {
          try { host.__seaboost.destroy(); } catch (_) {}
        }

        function readSavedPercent() {
          try {
            var stored = parseFloat(host.localStorage.getItem(STORAGE_KEY));
            if (isFinite(stored)) return Math.max(0, Math.min(maxVolume, stored));
          } catch (_) {}
          return null;
        }

        var savedPercent = readSavedPercent();
        var currentPercent = savedPercent === null ? 100 : savedPercent;
        var hasSavedPercent = savedPercent !== null;
        var currentVideo = null;
        var currentVideoVolumeHandler = null;
        var audioContext = null;
        var sourceNode = null;
        var gainNode = null;
        var compressorNode = null;
        var bodyObserver = null;
        var frameObserver = null;
        var mountQueued = false;
        var mpvSyncTimer = null;
        var cleanupControl = null;
        var currentMpvPlayer = null;
        var activeEngine = "";

        function getVideo() {
          return doc.querySelector('video[data-vc-element="video"], video[data-video-core-element]');
        }

        function getNativeVolumeControl() {
          return doc.querySelector('[data-vc-element="control-volume"]');
        }

        function getSlider(control) {
          return control ? control.querySelector('[data-vc-element="control-volume-slider"]') : null;
        }

        function looksLikeMpvPlayer(value) {
          return !!value &&
            (typeof value === "object" || typeof value === "function") &&
            typeof value.setProperty === "function" &&
            (typeof value.setVolume === "function" || typeof value.runCommand === "function");
        }

        function getReactFiber(node) {
          if (!node) return null;
          var names = [];
          try { names = Object.getOwnPropertyNames(node); } catch (_) {}
          for (var i = 0; i < names.length; i++) {
            if (
              names[i].indexOf("__reactFiber$") === 0 ||
              names[i].indexOf("__reactInternalInstance$") === 0
            ) {
              try { return node[names[i]] || null; } catch (_) { return null; }
            }
          }
          return null;
        }

        function playerFromFiber(fiber) {
          if (!fiber) return null;
          var candidates = [fiber.memoizedProps, fiber.pendingProps, fiber.stateNode];
          for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            if (looksLikeMpvPlayer(candidate)) return candidate;
            if (candidate && looksLikeMpvPlayer(candidate.player)) return candidate.player;
          }

          var state = fiber.memoizedState;
          var guard = 0;
          while (state && guard < 16) {
            if (looksLikeMpvPlayer(state.memoizedState)) return state.memoizedState;
            if (state.memoizedState && looksLikeMpvPlayer(state.memoizedState.player)) {
              return state.memoizedState.player;
            }
            state = state.next;
            guard++;
          }
          return null;
        }

        function findMpvPlayer(force) {
          if (!force && looksLikeMpvPlayer(currentMpvPlayer)) return currentMpvPlayer;

          var container = doc.querySelector('[data-vc-element="container"]');
          if (!container) return null;

          var start = getReactFiber(container);
          if (!start) {
            var nodes = container.querySelectorAll("*");
            for (var n = 0; n < nodes.length && n < 100; n++) {
              start = getReactFiber(nodes[n]);
              if (start) break;
            }
          }
          if (!start) return null;

          var parent = start;
          for (var p = 0; parent && p < 16; p++) {
            var parentPlayer = playerFromFiber(parent);
            if (parentPlayer) {
              currentMpvPlayer = parentPlayer;
              return parentPlayer;
            }
            parent = parent.return;
          }

          var queue = [start];
          var seen = typeof Set === "function" ? new Set() : null;
          var checked = 0;

          while (queue.length && checked < 1600) {
            var fiber = queue.shift();
            if (!fiber) continue;
            if (seen) {
              if (seen.has(fiber)) continue;
              seen.add(fiber);
            }
            checked++;

            var found = playerFromFiber(fiber);
            if (found) {
              currentMpvPlayer = found;
              return found;
            }

            if (fiber.child) queue.push(fiber.child);
            if (fiber.sibling) queue.push(fiber.sibling);
          }

          return null;
        }

        function ignorePromise(value) {
          try {
            if (value && typeof value.catch === "function") value.catch(function () {});
          } catch (_) {}
        }

        function applyMpvPercent(percent, forceFind) {
          var player = findMpvPlayer(!!forceFind);
          if (!player) return false;

          currentMpvPlayer = player;
          try {
            ignorePromise(player.setProperty("volume-max", maxVolume));
            ignorePromise(player.setProperty("volume", percent));
            return true;
          } catch (_) {
            try {
              if (typeof player.setVolume === "function") {
                ignorePromise(player.setVolume(percent));
                return true;
              }
            } catch (_) {}
          }
          return false;
        }

        function readNativePercent(control) {
          if (!control) return null;
          var nativeProgress = control.querySelector('[data-vc-element="control-volume-slider-progress"]');
          if (!nativeProgress) return null;
          var raw = "";
          try { raw = nativeProgress.style.width || ""; } catch (_) {}
          var linearPercent = parseFloat(raw);
          if (!isFinite(linearPercent)) return null;
          var linear = Math.max(0, Math.min(1, linearPercent / 100));
          return Math.round((linear * linear * 100) / VOLUME_STEP) * VOLUME_STEP;
        }

        function ensureStyle() {
          var style = doc.getElementById(STYLE_ID);
          if (!style) {
            style = doc.createElement("style");
            style.id = STYLE_ID;
            (doc.head || doc.documentElement).appendChild(style);
          }

          style.textContent =
            '[data-vc-element="control-volume"][data-seaboost-native="1"] [data-vc-element="control-volume-slider-progress"],' +
            '[data-vc-element="control-volume"][data-seaboost-native="1"] [data-vc-element="control-volume-slider-background"]{opacity:0!important}' +
            '[data-vc-element="control-volume"][data-seaboost-native="1"] [data-vc-element="control-volume-slider"]{overflow:visible!important}' +
            '.sb-native-track{position:absolute;inset:0;pointer-events:none;z-index:5;overflow:visible;opacity:0;visibility:hidden;transition:opacity .1s ease}' +
            '.sb-native-line{position:absolute;left:0;right:0;top:50%;height:6px;transform:translateY(-50%);border-radius:999px;background:linear-gradient(90deg,#fff 0%,#fff var(--sb-normal-stop),#ffb84d var(--sb-gold-stop),#ff4d32 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}' +
            '.sb-native-dim{position:absolute;top:0;bottom:0;right:0;left:var(--sb-pos);border-radius:999px;background:rgba(10,10,12,.66);transition:left .08s linear}' +
            '.sb-native-tick{position:absolute;top:50%;width:5px;height:5px;border-radius:999px;transform:translate(-50%,-50%);background:rgba(255,255,255,.48);box-shadow:0 0 0 1px rgba(0,0,0,.2);z-index:3}' +
            '.sb-native-tick[data-reached="1"]{background:#fff}' +
            '.sb-native-thumb{position:absolute;top:50%;left:var(--sb-pos);width:11px;height:11px;border-radius:999px;transform:translate(-50%,-50%);background:var(--sb-thumb-color,#fff);border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);z-index:4;transition:left .08s linear,background .12s ease}' +
            '.sb-native-readout{position:absolute;left:var(--sb-pos);bottom:19px;padding:2px 5px;border-radius:5px;background:rgba(12,12,14,.94);border:1px solid rgba(255,255,255,.14);color:#fff;font:700 10px/1.25 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;opacity:0;transition:opacity .1s ease,left .06s linear;z-index:6}' +
            '[data-vc-element="control-volume"]:hover .sb-native-track,' +
            '[data-vc-element="control-volume"].sb-dragging .sb-native-track{opacity:1;visibility:visible}' +
            '[data-vc-element="control-volume"]:hover .sb-native-readout,' +
            '[data-vc-element="control-volume"].sb-dragging .sb-native-readout{opacity:1}';
        }

        function savePercent() {
          try { host.localStorage.setItem(STORAGE_KEY, String(Math.round(currentPercent))); } catch (_) {}
          hasSavedPercent = true;
        }

        function removeVideoVolumeHandler() {
          if (currentVideo && currentVideoVolumeHandler) {
            try { currentVideo.removeEventListener("volumechange", currentVideoVolumeHandler); } catch (_) {}
          }
          currentVideoVolumeHandler = null;
        }

        function resetAudioForNewVideo(video) {
          removeVideoVolumeHandler();
          if (sourceNode) { try { sourceNode.disconnect(); } catch (_) {} }
          if (gainNode) { try { gainNode.disconnect(); } catch (_) {} }
          if (compressorNode) { try { compressorNode.disconnect(); } catch (_) {} }
          if (audioContext) { try { audioContext.close(); } catch (_) {} }
          currentVideo = video;
          audioContext = null;
          sourceNode = null;
          gainNode = null;
          compressorNode = null;
        }

        function ensureAudio() {
          var video = getVideo();
          if (!video) return false;
          if (currentVideo !== video) resetAudioForNewVideo(video);

          if (gainNode && audioContext) {
            try {
              if (audioContext.state === "suspended") audioContext.resume().catch(function () {});
            } catch (_) {}
            return true;
          }

          var AudioContextCtor = host.AudioContext || host.webkitAudioContext;
          if (!AudioContextCtor) return false;

          try {
            audioContext = new AudioContextCtor();
            sourceNode = audioContext.createMediaElementSource(video);
            gainNode = audioContext.createGain();
            compressorNode = audioContext.createDynamicsCompressor();

            compressorNode.threshold.value = -3;
            compressorNode.knee.value = 4;
            compressorNode.ratio.value = 12;
            compressorNode.attack.value = 0.003;
            compressorNode.release.value = 0.25;

            sourceNode.connect(gainNode);
            gainNode.connect(compressorNode);
            compressorNode.connect(audioContext.destination);

            if (audioContext.state === "suspended") {
              audioContext.resume().catch(function () {});
            }
            return true;
          } catch (_) {
            return false;
          }
        }

        function setGain(multiplier) {
          if (multiplier > 1 && !ensureAudio()) return;
          if (!gainNode || !audioContext) return;
          try {
            gainNode.gain.cancelScheduledValues(audioContext.currentTime);
            gainNode.gain.setTargetAtTime(multiplier, audioContext.currentTime, 0.015);
            compressorNode.ratio.value = multiplier > 1 ? 12 : 1;
            compressorNode.threshold.value = multiplier > 1 ? -3 : 0;
          } catch (_) {}
        }

        function getLevelColor(percent) {
          if (percent <= 100) return "#ffffff";
          var boostRange = Math.max(1, maxVolume - 100);
          var t = Math.max(0, Math.min(1, (percent - 100) / boostRange));
          var r = 255;
          var g = Math.round(184 - (107 * t));
          var b = Math.round(77 - (27 * t));
          return "rgb(" + r + "," + g + "," + b + ")";
        }

        function buildTickValues() {
          var values = [];
          var value = 100;
          while (value < maxVolume) {
            values.push(value);
            value += 100;
          }
          if (values.indexOf(maxVolume) === -1) values.push(maxVolume);
          return values;
        }

        function ensureTrack(slider) {
          if (!slider) return null;
          var track = slider.querySelector("." + TRACK_CLASS);
          if (track) return track;

          track = doc.createElement("div");
          track.className = TRACK_CLASS;

          var line = doc.createElement("div");
          line.className = "sb-native-line";

          var dim = doc.createElement("div");
          dim.className = "sb-native-dim";
          line.appendChild(dim);

          var ticks = buildTickValues();
          for (var i = 0; i < ticks.length; i++) {
            var tick = doc.createElement("span");
            tick.className = "sb-native-tick";
            tick.setAttribute("data-value", String(ticks[i]));
            tick.style.left = ((ticks[i] / maxVolume) * 100) + "%";
            line.appendChild(tick);
          }

          var thumb = doc.createElement("span");
          thumb.className = "sb-native-thumb";

          var readout = doc.createElement("span");
          readout.className = "sb-native-readout";

          track.appendChild(line);
          track.appendChild(thumb);
          track.appendChild(readout);
          slider.appendChild(track);
          return track;
        }

        function flashReadout() {
          var control = getNativeVolumeControl();
          if (!control) return;
          try {
            if (control.matches(":hover")) updateProgress(currentPercent);
          } catch (_) {}
        }

        function updateProgress(percent) {
          var control = getNativeVolumeControl();
          if (!control) return;
          var slider = getSlider(control);
          if (!slider) return;

          var track = ensureTrack(slider);
          if (!track) return;

          var position = Math.max(0, Math.min(100, (percent / maxVolume) * 100));
          var normalStop = Math.max(0, Math.min(100, (100 / maxVolume) * 100));
          var goldStop = Math.max(normalStop, Math.min(100, (((maxVolume + 100) / 2) / maxVolume) * 100));
          var color = getLevelColor(percent);

          track.style.setProperty("--sb-pos", position + "%");
          track.style.setProperty("--sb-normal-stop", normalStop + "%");
          track.style.setProperty("--sb-gold-stop", goldStop + "%");
          track.style.setProperty("--sb-thumb-color", color);

          var readout = track.querySelector(".sb-native-readout");
          if (readout) {
            readout.textContent = Math.round(percent) + "%";
            if (position >= 88) readout.style.transform = "translateX(-100%)";
            else if (position <= 12) readout.style.transform = "translateX(0)";
            else readout.style.transform = "translateX(-50%)";
          }

          var ticks = track.querySelectorAll(".sb-native-tick");
          for (var i = 0; i < ticks.length; i++) {
            var value = parseInt(ticks[i].getAttribute("data-value") || "0", 10);
            ticks[i].setAttribute("data-reached", percent >= value ? "1" : "0");
          }

          slider.setAttribute("role", "slider");
          slider.setAttribute("tabindex", "0");
          slider.setAttribute("aria-label", "Volume");
          slider.setAttribute("aria-valuemin", "0");
          slider.setAttribute("aria-valuemax", String(maxVolume));
          slider.setAttribute("aria-valuenow", String(Math.round(percent)));
          slider.setAttribute("aria-valuetext", Math.round(percent) + "%");
          slider.setAttribute("title", "Volume: " + Math.round(percent) + "% (SeaBoost max " + maxVolume + "%)");


        }

        function applyPercent(percent, shouldSave) {
          var video = getVideo();
          var mpvPlayer = video ? null : findMpvPlayer(false);
          if (!video && !mpvPlayer) return;

          percent = Math.max(0, Math.min(maxVolume, percent));
          percent = Math.round(percent / VOLUME_STEP) * VOLUME_STEP;
          percent = Math.max(0, Math.min(maxVolume, percent));

          var changed = percent !== currentPercent;
          currentPercent = percent;

          if (video) {
            if (percent <= 100) {
              setGain(1);
              try { video.volume = percent / 100; } catch (_) {}
            } else {
              try { video.volume = 1; } catch (_) {}
              setGain(percent / 100);
            }
          } else {
            applyMpvPercent(percent, false);
          }

          if (shouldSave === true || (changed && shouldSave !== false)) savePercent();
          updateProgress(percent);
        }

        function percentFromPointer(event, slider) {
          var rect = slider.getBoundingClientRect();
          if (!rect.width) return currentPercent;
          var position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          return position * maxVolume;
        }

        function attachVideo(video) {
          if (!video) return;
          if (currentVideo !== video) resetAudioForNewVideo(video);

          currentVideoVolumeHandler = function () {
            var expected = currentPercent <= 100 ? currentPercent / 100 : 1;
            if (Math.abs(video.volume - expected) > 0.015) {
              try { video.volume = expected; } catch (_) {}
            }
            updateProgress(currentPercent);
          };
          video.addEventListener("volumechange", currentVideoVolumeHandler);

          if (!hasSavedPercent) {
            currentPercent = Math.max(0, Math.min(100, Math.round((video.volume * 100) / VOLUME_STEP) * VOLUME_STEP));
            savePercent();
          }

          applyPercent(currentPercent, false);
        }

        function attachMpvPlayer(player, control) {
          if (!player) return false;
          currentMpvPlayer = player;

          if (!hasSavedPercent) {
            var nativePercent = readNativePercent(control);
            if (nativePercent !== null) currentPercent = nativePercent;
            savePercent();
          }

          applyMpvPercent(currentPercent, false);
          updateProgress(currentPercent);
          return true;
        }

        function attachControl(control) {
          if (!control) return false;
          var slider = getSlider(control);
          if (!slider) return false;

          if (
            control.getAttribute(MARKER) === "1" &&
            slider.querySelector("." + TRACK_CLASS)
          ) {
            updateProgress(currentPercent);
            return true;
          }

          if (cleanupControl) {
            try { cleanupControl(); } catch (_) {}
            cleanupControl = null;
          }

          ensureStyle();
          control.setAttribute(MARKER, "1");
          ensureTrack(slider);
          var dragging = false;

          function onPointerDown(event) {
            if (!slider.contains(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dragging = true;
            control.classList.add("sb-dragging");
            try { slider.setPointerCapture(event.pointerId); } catch (_) {}
            applyPercent(percentFromPointer(event, slider), false);
          }

          function onPointerMove(event) {
            if (!dragging) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            applyPercent(percentFromPointer(event, slider), false);
          }

          function onPointerUp(event) {
            if (!dragging) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dragging = false;
            control.classList.remove("sb-dragging");
            try { slider.releasePointerCapture(event.pointerId); } catch (_) {}
            applyPercent(percentFromPointer(event, slider), true);
          }

          function onWheel(event) {
            if (!control.contains(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            applyPercent(currentPercent + (event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP), true);
            flashReadout();
          }

          slider.addEventListener("pointerdown", onPointerDown, true);
          slider.addEventListener("pointermove", onPointerMove, true);
          slider.addEventListener("pointerup", onPointerUp, true);
          slider.addEventListener("pointercancel", onPointerUp, true);
          control.addEventListener("wheel", onWheel, { capture: true, passive: false });

          cleanupControl = function () {
            slider.removeEventListener("pointerdown", onPointerDown, true);
            slider.removeEventListener("pointermove", onPointerMove, true);
            slider.removeEventListener("pointerup", onPointerUp, true);
            slider.removeEventListener("pointercancel", onPointerUp, true);
            control.removeEventListener("wheel", onWheel, true);
            var track = slider.querySelector("." + TRACK_CLASS);
            if (track) track.remove();
            control.classList.remove("sb-key-active");
            control.classList.remove("sb-dragging");
            control.removeAttribute(MARKER);
          };

          updateProgress(currentPercent);
          return true;
        }

        function onKeyDown(event) {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

          var target = event.target;
          if (target) {
            var tag = String(target.tagName || "").toLowerCase();
            if (
              tag === "input" ||
              tag === "textarea" ||
              tag === "select" ||
              target.isContentEditable
            ) return;
          }

          var video = getVideo();
          if (!video || !video.isConnected) return;

          event.preventDefault();
          event.stopImmediatePropagation();

          var delta = event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP;
          applyPercent(currentPercent + delta, true);
          flashReadout();
        }

        function mount(forceMpvFind) {
          var control = getNativeVolumeControl();
          if (!control) return false;

          var video = getVideo();
          if (video) {
            if (activeEngine !== "videocore") {
              currentMpvPlayer = null;
              activeEngine = "videocore";
            }
            if (currentVideo !== video || !currentVideoVolumeHandler) {
              attachVideo(video);
            }
          } else {
            if (activeEngine !== "mpvcore") {
              if (currentVideo) resetAudioForNewVideo(null);
              activeEngine = "mpvcore";
              currentMpvPlayer = null;
            }

            var mpvPlayer = findMpvPlayer(!!forceMpvFind);
            if (!mpvPlayer) return false;
            attachMpvPlayer(mpvPlayer, control);
          }

          return attachControl(control);
        }

        function queueMount() {
          if (mountQueued) return;
          mountQueued = true;
          host.requestAnimationFrame(function () {
            mountQueued = false;
            mount();
            updateProgress(currentPercent);
          });
        }

        function queueMpvSync() {
          if (mpvSyncTimer) return;
          mpvSyncTimer = host.setTimeout(function () {
            mpvSyncTimer = null;
            currentMpvPlayer = null;
            if (mount(true)) applyPercent(currentPercent, false);
          }, 250);
        }

        function reapplyCurrentLevel() {
          if (getVideo()) {
            mount();
            applyPercent(currentPercent, false);
          } else {
            queueMpvSync();
          }
        }

        host.addEventListener("keydown", onKeyDown, true);

        bodyObserver = new host.MutationObserver(function () {
          var control = getNativeVolumeControl();
          if (!control) return;

          var video = getVideo();
          var slider = getSlider(control);
          var needsUiMount =
            control.getAttribute(MARKER) !== "1" ||
            !slider ||
            !slider.querySelector("." + TRACK_CLASS);

          if (video) {
            if (video !== currentVideo || needsUiMount) queueMount();
          } else {
            if (needsUiMount) queueMpvSync();
          }
        });
        if (doc.body) bodyObserver.observe(doc.body, { childList: true, subtree: true });

        var frameElement = null;
        try { frameElement = window.frameElement; } catch (_) {}
        if (frameElement) {
          frameObserver = new host.MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
              if (mutations[i].attributeName === "data-seaboost-poke") {
                reapplyCurrentLevel();
                break;
              }
            }
          });
          frameObserver.observe(frameElement, {
            attributes: true,
            attributeFilter: ["data-seaboost-poke"]
          });
        }

        host.__seaboost = {
          version: VERSION,
          maxVolume: maxVolume,
          mount: mount,
          getLevel: function () { return currentPercent; },
          setLevel: function (value) { applyPercent(value, true); },
          reapply: reapplyCurrentLevel,
          destroy: function () {
            host.removeEventListener("keydown", onKeyDown, true);
            if (mpvSyncTimer) {
              host.clearTimeout(mpvSyncTimer);
              mpvSyncTimer = null;
            }
            if (bodyObserver) { try { bodyObserver.disconnect(); } catch (_) {} }
            if (frameObserver) { try { frameObserver.disconnect(); } catch (_) {} }
            if (cleanupControl) { try { cleanupControl(); } catch (_) {} }
            removeVideoVolumeHandler();
            resetAudioForNewVideo(null);
            currentMpvPlayer = null;
          }
        };

        mount();
      })();
    }

    function makeBootstrapHTML() {
      var script = "(" + pageBootstrap.toString() + ")(" + JSON.stringify(configuredMax) + ");";
      return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>" +
        script.replace(/<\/script/gi, "<\\/script") +
        "</script></body></html>";
    }

    async function ensureBootstrap() {
      try {
        var existing = await ctx.dom.queryOne("iframe[" + BOOTSTRAP_ATTR + "=\"1\"]");
        if (existing) {
          var existingVersion = await existing.getAttribute("data-seaboost-version");
          if (existingVersion === PLUGIN_VERSION) return existing;
          existing.remove();
        }

        var frame = await ctx.dom.createElement("iframe");
        frame.setAttribute(BOOTSTRAP_ATTR, "1");
        frame.setAttribute("data-seaboost-version", PLUGIN_VERSION);
        frame.setAttribute("data-seaboost-poke", "0");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("tabindex", "-1");
        frame.setCssText("display:none!important;width:0!important;height:0!important;border:0!important;position:absolute!important;");
        frame.setAttribute("srcdoc", makeBootstrapHTML());

        ctx.setTimeout(async () => {
          try {
            var mounted = await ctx.dom.queryOne('[data-vc-element="control-volume"][data-seaboost-native="1"]');
            if (!mounted) {
              var video = await ctx.dom.queryOne('video[data-vc-element="video"]');
              if (video) ctx.toast.warning("SeaBoost could not extend Seanime's volume slider.");
            }
          } catch (_) {}
        }, 1400);
        return frame;
      } catch (_) {
        try { ctx.toast.error("SeaBoost failed to initialize."); } catch (_) {}
      }
    }

    async function ensureIfPlayerExists() {
      try {
        var control = await ctx.dom.queryOne('[data-vc-element="control-volume"]');
        if (control) await ensureBootstrap();
      } catch (_) {}
    }

    async function pokeBootstrap() {
      try {
        var frame = await ensureBootstrap();
        if (!frame) return;
        pokeSerial++;
        frame.setAttribute("data-seaboost-poke", String(pokeSerial));
      } catch (_) {}
    }

    ctx.dom.onReady(() => { ensureIfPlayerExists(); });
    ctx.dom.onMainTabReady(() => { ensureIfPlayerExists(); });
    ctx.dom.observe('video[data-vc-element="video"]', (elements) => {
      if (elements && elements.length) ensureBootstrap();
    });
    ctx.dom.observe('[data-vc-element="control-volume"]', (elements) => {
      if (elements && elements.length) ensureBootstrap();
    });

    try {
      if (ctx.videoCore && typeof ctx.videoCore.addEventListener === "function") {
        ctx.videoCore.addEventListener("video-loaded", () => {
          pokeBootstrap();
        });
        ctx.videoCore.addEventListener("video-loaded-metadata", () => {
          pokeBootstrap();
        });
      }
    } catch (_) {}
  });
}
