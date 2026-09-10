// Lumos Marquee Initialization.
//
// This lived as an inline <script> in index.html only, so club-secreto (two
// marquees) and carta-item (the SOMOS FUEGO strip under the dish gallery)
// carried the markup with nothing to drive it and rendered as static text.
// Same code, moved into one file all three pages load.
//
// window.initMarquees() is safe to call more than once: every component is
// tagged with data-marquee-init and skipped on a second pass. carta-item needs
// that second call because its gallery section starts display:none while the
// dish data loads, and a marquee measured at zero width never animates.
(function () {
  function initMarquees(root) {
    (root || document).querySelectorAll("[data-marquee='component']").forEach(function (comp, index) {
        if (comp.dataset.marqueeInit) return;
        comp.dataset.marqueeInit = "true";
        const staggerDelay = index * 150;
        setTimeout(() => {
          initMarquee(comp);
        }, staggerDelay);
    });
  }

      function initMarquee(comp) {
        const el = comp.querySelector(".marquee_element");
        const list = comp.querySelector(".marquee_list");
        if (!el || !list) return;
        if (el.getAttribute("data-marquee-mode") !== "true") return;

        const dirBool = el.getAttribute("data-marquee-direction") === "true";
        const speedMs = parseInt(el.getAttribute("data-marquee-speed"), 10) || 12000;
        const hoverPause = el.getAttribute("data-marquee-hover-pause") === "true";
        const hoverEase = el.getAttribute("data-marquee-hover-ease") === "true";
        const respectPRM = el.getAttribute("data-marquee-respect-prm") === "true";
        const draggableEnabled = el.getAttribute("data-marquee-draggable") === "true";

        const prm = window.matchMedia("(prefers-reduced-motion: reduce)");
        const reduceMotion = respectPRM && prm.matches;

        el.classList.add("is-marquee");
        [...list.children].forEach(n => n.style.flex = "0 0 auto");

        // Smart text sizing & auto-duplication
        (function setupSmartText() {
          if (!el.hasAttribute("data-marquee-text-width-multiplier")) return;
          const textMultiplier = parseFloat(el.getAttribute("data-marquee-text-width-multiplier")) || 2;
          const scalingEnabled = el.hasAttribute("data-marquee-scale-text") &&
            el.getAttribute("data-marquee-scale-text") === "true";
          if (!scalingEnabled) return;

          const originalItems = [...list.children].filter(item => !item.classList.contains("marquee-clone"));

          function waitForValidWidth(callback, maxAttempts = 100) {
            let attempts = 0;
            function check() {
              attempts++;
              const parentWidth = comp.offsetWidth;
              if (parentWidth > 0) {
                callback(parentWidth);
              } else if (attempts < maxAttempts) {
                requestAnimationFrame(check);
              }
            }
            check();
          }

          if (originalItems.length === 1) {
            waitForValidWidth((parentWidth) => {
              const neededDuplicates = Math.ceil(parentWidth / (parentWidth / textMultiplier)) + 2;
              for (let i = 0; i < neededDuplicates; i++) {
                const clone = originalItems[0].cloneNode(true);
                clone.setAttribute("data-auto-duplicate", "true");
                list.appendChild(clone);
              }
            });
          }

          [...list.children].forEach((item) => {
            if (item.classList.contains("marquee-clone")) return;
            comp.classList.add("text-fill-container");
            item.classList.add("u-text-fill-width");
            item.style.whiteSpace = 'nowrap';
            item.style.lineHeight = '1';
          });

          function adjustTextSize() {
            const currentParentWidth = comp.offsetWidth;
            if (currentParentWidth === 0) {
              requestAnimationFrame(() => {
                requestAnimationFrame(adjustTextSize);
              });
              return;
            }

            [...list.children].forEach((item) => {
              if (item.classList.contains("marquee-clone")) return;
              const targetWidth = currentParentWidth * textMultiplier;
              const textElement = item.querySelector('p, h1, h2, h3, h4, h5, h6') || item;

              const tempMeasure = textElement.cloneNode(true);
              tempMeasure.style.cssText = 'position:absolute;visibility:hidden;width:auto;display:inline-block;white-space:nowrap;';
              document.body.appendChild(tempMeasure);

              const currentTextWidth = tempMeasure.offsetWidth;
              const currentFontSize = parseFloat(getComputedStyle(tempMeasure).fontSize);
              document.body.removeChild(tempMeasure);

              const newFontSize = (targetWidth / currentTextWidth) * currentFontSize;
              textElement.style.setProperty('font-size', `${newFontSize}px`, 'important');
            });
          }

          function waitAndAdjust() {
            const currentParentWidth = comp.offsetWidth;
            if (currentParentWidth > 0) {
              adjustTextSize();
            } else {
              requestAnimationFrame(waitAndAdjust);
            }
          }

          waitAndAdjust();
          setTimeout(adjustTextSize, 100);
          setTimeout(adjustTextSize, 300);
          setTimeout(adjustTextSize, 500);

          if (document.fonts) {
            document.fonts.ready.then(adjustTextSize);
          }

          let resizeTimeout;
          window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
              if (comp.offsetWidth > 0) {
                adjustTextSize();
              }
            }, 150);
          });
        })();

        const waitAssets = () => Promise.all([
          new Promise(res => {
            const imgs = list.querySelectorAll("img");
            let pending = imgs.length;
            if (!pending) return res();
            imgs.forEach(im => {
              if (im.complete) {
                if (--pending === 0) res();
              } else {
                im.addEventListener("load", () => { if (--pending === 0) res(); }, { once: true });
                im.addEventListener("error", () => { if (--pending === 0) res(); }, { once: true });
              }
            });
          }),
          ("fonts" in document) ? document.fonts.ready.catch(() => { }) : Promise.resolve()
        ]);

        let packDistance = 0;
        let offset = 0;
        let targetPxPerMs = 0;
        let currentPxPerMs = 0;
        let playing = true;
        let rafId = 0;
        let lastTime = 0;
        let dragging = false;
        let lastPointerX = 0;
        let dragMoved = 0;
        const CLICK_SUPPRESS_PX = 3;

        function measureAndClone() {
          [...list.querySelectorAll(".marquee-clone")].forEach(n => n.remove());

          const items = [...list.children].filter(n => !n.classList.contains("marquee-clone"));
          if (!items.length) return 0;

          const first = items[0];
          const last = items[items.length - 1];
          const firstLeft = first.offsetLeft;
          const lastRight = last.offsetLeft + last.offsetWidth;
          const dist = Math.round(lastRight - firstLeft);

          items.forEach(n => {
            const c = n.cloneNode(true);
            c.classList.add("marquee-clone");
            list.appendChild(c);
          });

          if (dirBool) {
            for (let i = items.length - 1; i >= 0; i--) {
              const c = items[i].cloneNode(true);
              c.classList.add("marquee-clone");
              list.insertBefore(c, list.firstChild);
            }
          }

          offset = dirBool ? -dist + 0.001 : -0.001;
          list.style.transform = `translate3d(${offset}px,0,0)`;
          return dist;
        }

        function setSpeed() {
          const cycle = reduceMotion ? Math.max(1, speedMs) * 3 : Math.max(1, speedMs);
          const v = packDistance / cycle;
          targetPxPerMs = dirBool ? v : -v;
          if (!hoverEase) currentPxPerMs = targetPxPerMs;
        }

        function wrapOffset(span) {
          if (dirBool) {
            while (offset >= 0) offset -= span;
            while (offset < -span) offset += span;
          } else {
            while (offset <= -span) offset += span;
            while (offset > 0) offset -= span;
          }
        }

        function tick(now) {
          if (!lastTime) lastTime = now;
          const dt = Math.min(now - lastTime, 100);
          lastTime = now;

          if (hoverEase) {
            const ease = 0.15;
            currentPxPerMs += (targetPxPerMs - currentPxPerMs) * ease;
          }

          const velocity = hoverEase ? currentPxPerMs : targetPxPerMs;

          if ((playing && !dragging) || hoverEase) {
            offset += velocity * dt;
            const span = packDistance;
            if (span > 0) wrapOffset(span);
            const roundedOffset = Math.round(offset);
            list.style.transform = `translate3d(${roundedOffset}px,0,0)`;
          }

          rafId = requestAnimationFrame(tick);
        }

        function start() { cancelAnimationFrame(rafId); lastTime = 0; rafId = requestAnimationFrame(tick); }
        function pause() { playing = false; targetPxPerMs = 0; if (!hoverEase) { currentPxPerMs = 0; } }
        function resume() { playing = true; setSpeed(); }

        if (hoverPause) {
          el.addEventListener("mouseenter", () => { if (!dragging) pause(); });
          el.addEventListener("mouseleave", () => { if (!dragging) resume(); });
        }

        if (draggableEnabled) {
          const suppressClick = (e) => {
            if (dragMoved > CLICK_SUPPRESS_PX) {
              e.stopPropagation();
              e.preventDefault();
            }
          };
          comp.addEventListener("click", suppressClick, true);

          const onPointerDown = (e) => {
            dragging = true;
            dragMoved = 0;
            lastPointerX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
            el.classList.add("is-dragging");
            el.style.touchAction = "none";
            pause();
            try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (_) { }
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp, { once: true });
            window.addEventListener("pointercancel", onPointerUp, { once: true });
          };

          const onPointerMove = (e) => {
            if (!dragging) return;
            const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
            const dx = x - lastPointerX;
            lastPointerX = x;
            dragMoved += Math.abs(dx);
            offset += dx;
            if (packDistance > 0) wrapOffset(packDistance);
            list.style.transform = `translate3d(${offset}px,0,0)`;
          };

          const onPointerUp = () => {
            dragging = false;
            el.classList.remove("is-dragging");
            el.style.touchAction = "";
            resume();
            window.removeEventListener("pointermove", onPointerMove);
          };

          el.addEventListener("pointerdown", onPointerDown);
        }

        let t;
        const rebuild = () => { packDistance = measureAndClone(); setSpeed(); };
        const debounced = () => { clearTimeout(t); t = setTimeout(rebuild, 120); };

        window.addEventListener("resize", debounced, { passive: true });
        window.addEventListener("orientationchange", debounced, { passive: true });

        function initAnimation() {
          const checkDimensions = () => {
            if (comp.offsetWidth > 0 && comp.offsetHeight > 0) {
              rebuild();
              start();
            } else {
              requestAnimationFrame(checkDimensions);
            }
          };
          waitAssets().then(() => {
            checkDimensions();
          });
        }

        initAnimation();
      }

  window.initMarquees = initMarquees;
  document.addEventListener("DOMContentLoaded", function () { initMarquees(); });
})();
