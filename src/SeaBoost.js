function init() {
  $ui.register((ctx) => {
    const BOOTSTRAP_ATTR = "data-seaboost-bootstrap";

    function pageBootstrap() {
      (function () {
        var host = window.parent;
        var doc = host && host.document;
        if (!host || !doc) return;

        var VERSION = "0.1.1";
        var ROOT_ID = "seaboost-player-control";
        var STYLE_ID = "seaboost-player-style";
        var STORAGE_KEY = "seaboost.level";

        if (host.__seaboost && host.__seaboost.version === VERSION) {
          try {
            host.__seaboost.mount();
          } catch (_) {}
          return;
        }

        var level = parseInt(host.localStorage.getItem(STORAGE_KEY) || "100", 10);
        if (!isFinite(level)) level = 100;
        level = Math.max(100, Math.min(300, level));

        var currentVideo = null;
        var audioContext = null;
        var sourceNode = null;
        var gainNode = null;
        var compressorNode = null;
        var bodyObserver = null;
        var mountQueued = false;
        var documentPointerHandler = null;

        function getVideo() {
          return doc.querySelector('video[data-vc-element="video"], video[data-video-core-element]');
        }

        function getNativeVolumeControl() {
          return doc.querySelector('[data-vc-element="control-volume"]');
        }

        function ensureStyle() {
          if (doc.getElementById(STYLE_ID)) return;

          var style = doc.createElement("style");
          style.id = STYLE_ID;
          style.textContent =
            "#" + ROOT_ID + "{position:relative;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:inherit;z-index:70}" +
            "#" + ROOT_ID + " *{box-sizing:border-box}" +
            "#" + ROOT_ID + " .sb-trigger{height:2.25rem;min-width:3.7rem;border:0;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;gap:.3rem;padding:0 .45rem;border-radius:.5rem;cursor:pointer;font:600 .78rem/1 inherit;opacity:.92;transition:background .15s ease,opacity .15s ease,transform .15s ease}" +
            "#" + ROOT_ID + " .sb-trigger:hover,#" + ROOT_ID + ".sb-open .sb-trigger{background:rgba(255,255,255,.12);opacity:1}" +
            "#" + ROOT_ID + " .sb-trigger:active{transform:scale(.96)}" +
            "#" + ROOT_ID + " .sb-bolt{font-size:.9rem;line-height:1}" +
            "#" + ROOT_ID + " .sb-level{font-variant-numeric:tabular-nums;white-space:nowrap}" +
            "#" + ROOT_ID + "[data-boosted=true] .sb-trigger{color:#f7c948}" +
            "#" + ROOT_ID + " .sb-panel{position:absolute;left:50%;bottom:calc(100% + .65rem);transform:translateX(-50%) translateY(.35rem);width:15rem;padding:.8rem;border:1px solid rgba(255,255,255,.13);border-radius:.8rem;background:rgba(14,14,18,.96);box-shadow:0 12px 36px rgba(0,0,0,.45);backdrop-filter:blur(14px);display:none;flex-direction:column;gap:.7rem;color:#fff}" +
            "#" + ROOT_ID + ".sb-open .sb-panel{display:flex;animation:sb-pop .14s ease-out forwards}" +
            "@keyframes sb-pop{from{opacity:0;transform:translateY(.3rem)}to{opacity:1;transform:translateY(0)}}" +
            "#" + ROOT_ID + " .sb-head{display:flex;align-items:center;justify-content:space-between;gap:.8rem}" +
            "#" + ROOT_ID + " .sb-title{font-size:.82rem;font-weight:750;letter-spacing:.01em}" +
            "#" + ROOT_ID + " .sb-readout{font-size:.78rem;font-weight:750;color:#f7c948;font-variant-numeric:tabular-nums}" +
            "#" + ROOT_ID + " .sb-slider{width:100%;accent-color:#f7c948;cursor:pointer}" +
            "#" + ROOT_ID + " .sb-scale{display:flex;justify-content:space-between;opacity:.55;font-size:.67rem;margin-top:-.4rem}" +
            "#" + ROOT_ID + " .sb-presets{display:grid;grid-template-columns:repeat(5,1fr);gap:.3rem}" +
            "#" + ROOT_ID + " .sb-preset{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;border-radius:.45rem;padding:.36rem .2rem;font:650 .67rem/1 inherit;cursor:pointer}" +
            "#" + ROOT_ID + " .sb-preset:hover{background:rgba(255,255,255,.13)}" +
            "#" + ROOT_ID + " .sb-preset[data-active=true]{border-color:rgba(247,201,72,.6);background:rgba(247,201,72,.16);color:#f7c948}" +
            "#" + ROOT_ID + " .sb-note{font-size:.65rem;line-height:1.35;opacity:.5}" +
            "#" + ROOT_ID + " .sb-error{display:none;color:#ff8f8f;font-size:.66rem;line-height:1.35}" +
            "#" + ROOT_ID + "[data-error=true] .sb-error{display:block}";

          (doc.head || doc.documentElement).appendChild(style);
        }

        function setError(message) {
          var root = doc.getElementById(ROOT_ID);
          if (!root) return;
          var error = root.querySelector(".sb-error");
          root.setAttribute("data-error", message ? "true" : "false");
          if (error) error.textContent = message || "";
        }

        function resetAudioForNewVideo(video) {
          if (currentVideo === video && gainNode && audioContext) return;

          if (sourceNode) {
            try { sourceNode.disconnect(); } catch (_) {}
          }
          if (gainNode) {
            try { gainNode.disconnect(); } catch (_) {}
          }
          if (compressorNode) {
            try { compressorNode.disconnect(); } catch (_) {}
          }
          if (audioContext) {
            try { audioContext.close(); } catch (_) {}
          }

          currentVideo = video;
          audioContext = null;
          sourceNode = null;
          gainNode = null;
          compressorNode = null;
        }

        function ensureAudio() {
          var video = getVideo();
          if (!video) {
            setError("No Seanime video element was found.");
            return false;
          }

          if (currentVideo !== video) resetAudioForNewVideo(video);

          if (gainNode && audioContext) {
            try {
              if (audioContext.state === "suspended") audioContext.resume().catch(function () {});
            } catch (_) {}
            return true;
          }

          var AudioContextCtor = host.AudioContext || host.webkitAudioContext;
          if (!AudioContextCtor) {
            setError("Web Audio is unavailable in this Seanime client.");
            return false;
          }

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

            setError("");
            return true;
          } catch (err) {
            setError("Could not attach audio boost: " + (err && err.message ? err.message : String(err)));
            return false;
          }
        }

        function applyLevel() {
          var multiplier = level / 100;

          if (level > 100 && !ensureAudio()) return;

          if (gainNode && audioContext) {
            try {
              gainNode.gain.cancelScheduledValues(audioContext.currentTime);
              gainNode.gain.setTargetAtTime(multiplier, audioContext.currentTime, 0.015);
              compressorNode.ratio.value = level > 100 ? 12 : 1;
              compressorNode.threshold.value = level > 100 ? -3 : 0;
            } catch (_) {}
          }
        }

        function updateUI() {
          var root = doc.getElementById(ROOT_ID);
          if (!root) return;

          root.setAttribute("data-boosted", level > 100 ? "true" : "false");

          var triggerLevel = root.querySelector(".sb-level");
          var readout = root.querySelector(".sb-readout");
          var slider = root.querySelector(".sb-slider");
          if (triggerLevel) triggerLevel.textContent = String(level) + "%";
          if (readout) readout.textContent = String(level) + "%";
          if (slider) slider.value = String(level);

          var presets = root.querySelectorAll(".sb-preset");
          for (var i = 0; i < presets.length; i++) {
            presets[i].setAttribute(
              "data-active",
              parseInt(presets[i].getAttribute("data-level") || "0", 10) === level ? "true" : "false"
            );
          }
        }

        function setLevel(next) {
          next = parseInt(String(next), 10);
          if (!isFinite(next)) return;
          level = Math.max(100, Math.min(300, next));
          try { host.localStorage.setItem(STORAGE_KEY, String(level)); } catch (_) {}
          updateUI();
          applyLevel();
        }

        function closePanel() {
          var root = doc.getElementById(ROOT_ID);
          if (root) root.classList.remove("sb-open");
        }

        function buildControl() {
          var root = doc.createElement("div");
          root.id = ROOT_ID;
          root.setAttribute("data-boosted", level > 100 ? "true" : "false");
          root.setAttribute("data-error", "false");
          root.innerHTML =
            '<button class="sb-trigger" type="button" title="SeaBoost volume booster" aria-label="SeaBoost volume booster">' +
              '<span class="sb-bolt" aria-hidden="true">⚡</span><span class="sb-level">' + String(level) + '%</span>' +
            '</button>' +
            '<div class="sb-panel" role="dialog" aria-label="SeaBoost volume booster">' +
              '<div class="sb-head"><span class="sb-title">SeaBoost</span><span class="sb-readout">' + String(level) + '%</span></div>' +
              '<input class="sb-slider" type="range" min="100" max="300" step="10" value="' + String(level) + '" aria-label="Volume boost percentage">' +
              '<div class="sb-scale"><span>100%</span><span>200%</span><span>300%</span></div>' +
              '<div class="sb-presets">' +
                '<button class="sb-preset" type="button" data-level="100">100</button>' +
                '<button class="sb-preset" type="button" data-level="150">150</button>' +
                '<button class="sb-preset" type="button" data-level="200">200</button>' +
                '<button class="sb-preset" type="button" data-level="250">250</button>' +
                '<button class="sb-preset" type="button" data-level="300">300</button>' +
              '</div>' +
              '<div class="sb-note">Boosts Seanime audio above the normal 100% limit. Higher levels may sound different depending on the source.</div>' +
              '<div class="sb-error"></div>' +
            '</div>';

          root.addEventListener("click", function (event) {
            event.stopPropagation();
          });
          root.addEventListener("pointerdown", function (event) {
            event.stopPropagation();
          });
          root.addEventListener("wheel", function (event) {
            event.stopPropagation();
          });

          var trigger = root.querySelector(".sb-trigger");
          var slider = root.querySelector(".sb-slider");
          var presets = root.querySelectorAll(".sb-preset");

          trigger.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            root.classList.toggle("sb-open");
            if (level > 100) applyLevel();
          });

          slider.addEventListener("input", function (event) {
            setLevel(event.target.value);
          });

          for (var i = 0; i < presets.length; i++) {
            presets[i].addEventListener("click", function (event) {
              event.preventDefault();
              setLevel(event.currentTarget.getAttribute("data-level"));
            });
          }

          updateUI();
          return root;
        }

        function mount() {
          ensureStyle();

          var nativeVolume = getNativeVolumeControl();
          if (!nativeVolume || !getVideo()) return false;

          var existing = doc.getElementById(ROOT_ID);
          if (existing && existing.parentElement === nativeVolume.parentElement) {
            updateUI();
            return true;
          }
          if (existing) existing.remove();

          var root = buildControl();
          nativeVolume.insertAdjacentElement("afterend", root);

          if (!documentPointerHandler) {
            documentPointerHandler = function (event) {
              var currentRoot = doc.getElementById(ROOT_ID);
              if (currentRoot && !currentRoot.contains(event.target)) closePanel();
            };
            doc.addEventListener("pointerdown", documentPointerHandler, true);
          }

          if (level > 100) {
            var video = getVideo();
            if (video) {
              var resume = function () {
                applyLevel();
                video.removeEventListener("play", resume);
              };
              video.addEventListener("play", resume);
            }
          }

          return true;
        }

        function queueMount() {
          if (mountQueued) return;
          mountQueued = true;
          host.requestAnimationFrame(function () {
            mountQueued = false;
            mount();
          });
        }

        bodyObserver = new host.MutationObserver(function () {
          queueMount();
        });

        if (doc.body) {
          bodyObserver.observe(doc.body, { childList: true, subtree: true });
        }

        host.__seaboost = {
          version: VERSION,
          mount: mount,
          setLevel: setLevel,
          getLevel: function () { return level; }
        };

        mount();
      })();
    }

    function makeBootstrapHTML() {
      var script = "(" + pageBootstrap.toString() + ")();";
      return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>" +
        script.replace(/<\/script/gi, "<\\/script") +
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
            var mounted = await ctx.dom.queryOne("#seaboost-player-control");
            if (!mounted) {
              var video = await ctx.dom.queryOne('video[data-vc-element="video"]');
              if (video) {
                ctx.toast.warning("SeaBoost could not attach to the player. Restart playback and send the Seanime log if it keeps happening.");
              }
            }
          } catch (_) {}
        }, 1400);
      } catch (err) {
        try {
          ctx.toast.error("SeaBoost failed to initialize.");
        } catch (_) {}
      }
    }

    async function ensureIfPlayerExists() {
      try {
        var video = await ctx.dom.queryOne('video[data-vc-element="video"]');
        if (video) {
          await ensureBootstrap();
        }
      } catch (_) {}
    }

    ctx.dom.onReady(() => {
      ensureIfPlayerExists();
    });

    ctx.dom.onMainTabReady(() => {
      ensureIfPlayerExists();
    });

    ctx.dom.observe('video[data-vc-element="video"]', (elements) => {
      if (elements && elements.length) {
        ensureBootstrap();
      }
    });

    ctx.dom.observe('[data-vc-element="control-volume"]', (elements) => {
      if (elements && elements.length) {
        ensureBootstrap();
      }
    });
  });
}
