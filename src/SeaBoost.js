function init() {
  $ui.register((ctx) => {
    const BOOTSTRAP_ATTR = "data-seaboost-bootstrap";
    var configuredMax = parseInt($getUserPreference("maxVolume") || "300", 10);
    if (!isFinite(configuredMax)) configuredMax = 300;
    configuredMax = Math.max(100, Math.min(500, configuredMax));

    function pageBootstrap(maxVolume) {
      (function () {
        var host = window.parent;
        var doc = host && host.document;
        if (!host || !doc) return;

        var VERSION = "0.2.0";
        var MARKER = "data-seaboost-native";
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

        var currentVideo = null;
        var audioContext = null;
        var sourceNode = null;
        var gainNode = null;
        var compressorNode = null;
        var bodyObserver = null;
        var mountQueued = false;
        var cleanupControl = null;
        var currentPercent = 100;

        function getVideo() {
          return doc.querySelector('video[data-vc-element="video"], video[data-video-core-element]');
        }

        function getNativeVolumeControl() {
          return doc.querySelector('[data-vc-element="control-volume"]');
        }

        function resetAudioForNewVideo(video) {
          if (currentVideo === video && gainNode && audioContext) return;
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

        function updateProgress(percent) {
          var control = getNativeVolumeControl();
          if (!control) return;
          var progress = control.querySelector('[data-vc-element="control-volume-slider-progress"]');
          if (progress) {
            var width = Math.max(0, Math.min(100, (percent / maxVolume) * 100));
            progress.style.setProperty("width", width + "%", "important");
          }
          var slider = control.querySelector('[data-vc-element="control-volume-slider"]');
          if (slider) {
            slider.setAttribute("title", "Volume: " + Math.round(percent) + "% (SeaBoost max " + maxVolume + "%)");
            slider.setAttribute("aria-valuemin", "0");
            slider.setAttribute("aria-valuemax", String(maxVolume));
            slider.setAttribute("aria-valuenow", String(Math.round(percent)));
          }
        }

        function applyPercent(percent) {
          var video = getVideo();
          if (!video) return;
          percent = Math.max(0, Math.min(maxVolume, percent));
          currentPercent = percent;

          if (percent <= 100) {
            setGain(1);
            try { video.volume = percent / 100; } catch (_) {}
          } else {
            try { video.volume = 1; } catch (_) {}
            setGain(percent / 100);
          }
          updateProgress(percent);
        }

        function percentFromPointer(event, slider) {
          var rect = slider.getBoundingClientRect();
          if (!rect.width) return currentPercent;
          var position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          return position * maxVolume;
        }

        function attachControl(control) {
          if (!control) return false;
          if (control.getAttribute(MARKER) === "1") {
            updateProgress(currentPercent);
            return true;
          }

          if (cleanupControl) {
            try { cleanupControl(); } catch (_) {}
            cleanupControl = null;
          }

          var slider = control.querySelector('[data-vc-element="control-volume-slider"]');
          if (!slider) return false;

          control.setAttribute(MARKER, "1");
          var dragging = false;

          function onPointerDown(event) {
            if (!slider.contains(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dragging = true;
            try { slider.setPointerCapture(event.pointerId); } catch (_) {}
            applyPercent(percentFromPointer(event, slider));
          }

          function onPointerMove(event) {
            if (!dragging) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            applyPercent(percentFromPointer(event, slider));
          }

          function onPointerUp(event) {
            if (!dragging) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dragging = false;
            try { slider.releasePointerCapture(event.pointerId); } catch (_) {}
            applyPercent(percentFromPointer(event, slider));
          }

          function onWheel(event) {
            if (!control.contains(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            var step = Math.max(2, Math.round(maxVolume / 100));
            applyPercent(currentPercent + (event.deltaY < 0 ? step : -step));
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
            control.removeAttribute(MARKER);
          };

          var video = getVideo();
          if (video) {
            var nativePercent = Math.max(0, Math.min(100, video.volume * 100));
            if (currentPercent <= 100) currentPercent = nativePercent;
          }
          updateProgress(currentPercent);
          return true;
        }

        function mount() {
          var video = getVideo();
          var control = getNativeVolumeControl();
          if (!video || !control) return false;
          if (currentVideo && currentVideo !== video) {
            resetAudioForNewVideo(video);
            currentPercent = Math.max(0, Math.min(100, video.volume * 100));
          } else if (!currentVideo) {
            currentVideo = video;
            currentPercent = Math.max(0, Math.min(100, video.volume * 100));
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

        bodyObserver = new host.MutationObserver(queueMount);
        if (doc.body) bodyObserver.observe(doc.body, { childList: true, subtree: true });

        host.__seaboost = {
          version: VERSION,
          maxVolume: maxVolume,
          mount: mount,
          getLevel: function () { return currentPercent; },
          destroy: function () {
            if (bodyObserver) { try { bodyObserver.disconnect(); } catch (_) {} }
            if (cleanupControl) { try { cleanupControl(); } catch (_) {} }
            resetAudioForNewVideo(null);
          }
        };

        mount();
      })();
    }

    function makeBootstrapHTML() {
      var script = "(" + pageBootstrap.toString() + ")(" + JSON.stringify(configuredMax) + ");";
      return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>" +
        script.replace(/<\\/script/gi, "<\\\\/script") +
        "</script></body></html>";
    }

    async function ensureBootstrap() {
      try {
        var existing = await ctx.dom.queryOne("iframe[" + BOOTSTRAP_ATTR + "=\"1\"]");
        if (existing) return;

        var frame = await ctx.dom.createElement("iframe");
        frame.setAttribute(BOOTSTRAP_ATTR, "1");
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
      } catch (_) {
        try { ctx.toast.error("SeaBoost failed to initialize."); } catch (_) {}
      }
    }

    async function ensureIfPlayerExists() {
      try {
        var video = await ctx.dom.queryOne('video[data-vc-element="video"]');
        if (video) await ensureBootstrap();
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
  });
}
