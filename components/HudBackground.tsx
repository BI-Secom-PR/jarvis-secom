"use client";

import { useEffect, useRef } from "react";
import { useIsDark } from "@/lib/useIsDark";

/**
 * Iron-Man "command lattice" backdrop — a rotating neural sphere of linked
 * particles over a deep void, with a perspective grid floor and an orb glow.
 * Ported from the reference ai-ui.html canvas; the rainbow palette is swapped
 * for an arc-reactor cyan → repulsor gold → hot-red cycle.
 *
 * Renders a fixed full-screen layer (z-0). `variant="subtle"` dims it and
 * thins the particle budget for use behind dense content (the chat list).
 */

type RGB = { r: number; g: number; b: number };

// Cyan → gold → hot-red → cool. Cross-fades between adjacent stops.
const PALETTES_DARK: RGB[] = [
  { r: 39, g: 224, b: 255 }, // arc-reactor cyan
  { r: 90, g: 200, b: 255 }, // sky cyan
  { r: 255, g: 181, b: 61 }, // repulsor gold
  { r: 255, g: 96, b: 40 }, // hot orange
  { r: 255, g: 60, b: 50 }, // hot red
  { r: 120, g: 180, b: 255 }, // cool return
];

// Stark-blueprint petrol ramp — dark enough to read on the paper background.
const PALETTES_LIGHT: RGB[] = [
  { r: 10, g: 126, b: 164 }, // petrol teal
  { r: 30, g: 110, b: 170 }, // steel blue
  { r: 168, g: 106, b: 16 }, // burnt amber
  { r: 190, g: 80, b: 30 }, // rust orange
  { r: 217, g: 45, b: 32 }, // signal red
  { r: 60, g: 100, b: 200 }, // cool return
];

export default function HudBackground({
  variant = "full",
}: {
  variant?: "full" | "subtle";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();

  useEffect(() => {
    const canvas = canvasRef.current;
    const orbGlow = orbRef.current;
    if (!canvas || !orbGlow) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const subtle = variant === "subtle";
    const PALETTES = isDark ? PALETTES_DARK : PALETTES_LIGHT;

    let PARTICLE_COUNT = 650;
    let MAX_DISTANCE = 82;
    let sphereRadius = 0;
    let sphereCenterY = 0.51;
    let particles: Particle[] = [];

    let colorIndex = 0;
    let nextColorIndex = 1;
    let transition = 0;

    let rotationX = 0.00145;
    let rotationY = 0.00225;
    let rotationZ = -0.0009;
    let targetRotationX = rotationX;
    let targetRotationY = rotationY;
    let targetRotationZ = rotationZ;
    let nextSpinShift = 0;

    class Particle {
      x3d: number;
      y3d: number;
      z3d: number;
      core: boolean;
      pulse: number;
      pulseSpeed: number;
      baseSize: number;
      x = 0;
      y = 0;
      scale = 1;

      constructor(core = false) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const shell = core
          ? 0.14 + Math.random() * 0.58
          : 0.66 + Math.random() * 0.36;
        const r = sphereRadius * shell;
        this.x3d = r * Math.sin(phi) * Math.cos(theta);
        this.y3d = r * Math.sin(phi) * Math.sin(theta);
        this.z3d = r * Math.cos(phi);
        this.core = core;
        this.pulse = Math.random() * Math.PI * 2;
        this.pulseSpeed = 0.012 + Math.random() * 0.035;
        this.baseSize = core
          ? 1.05 + Math.random() * 3.15
          : 1.55 + Math.random() * 4.05;
      }

      rotate() {
        const cosX = Math.cos(rotationX);
        const sinX = Math.sin(rotationX);
        const cosY = Math.cos(rotationY);
        const sinY = Math.sin(rotationY);
        const cosZ = Math.cos(rotationZ);
        const sinZ = Math.sin(rotationZ);
        const y = this.y3d * cosX - this.z3d * sinX;
        const z = this.z3d * cosX + this.y3d * sinX;
        const x = this.x3d * cosY - z * sinY;
        const z2 = z * cosY + this.x3d * sinY;
        this.x3d = x * cosZ - y * sinZ;
        this.y3d = y * cosZ + x * sinZ;
        this.z3d = z2;
      }

      project(width: number, height: number) {
        const perspective = Math.max(width, height) * 0.72;
        const cameraDistance = Math.max(width, height) * 0.83;
        const scale = perspective / (perspective + this.z3d + cameraDistance);
        // Organic radial breathing: each particle drifts in/out along its own
        // radius, phase-shifted by its pulse. Applied at projection time only,
        // so the 3D state never accumulates error.
        const breathe = 1 + Math.sin(this.pulse) * 0.04;
        this.x = this.x3d * breathe * scale + width / 2;
        this.y = this.y3d * breathe * scale + height * sphereCenterY;
        this.scale = scale;
        this.pulse += this.pulseSpeed;
      }
    }

    function configureDensity() {
      const w = window.innerWidth;
      let count = w < 760 ? 300 : w < 1100 ? 450 : 650;
      const cores = navigator.hardwareConcurrency || 8;
      if (cores <= 4) count = Math.min(count, 260);
      if (prefersReduced) count = Math.min(count, 220);
      if (subtle) count = Math.round(count * 0.55); // lighter behind content
      PARTICLE_COUNT = count;
      MAX_DISTANCE = sphereRadius * 0.16;
    }

    function init() {
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new Particle(i < PARTICLE_COUNT * 0.48));
      }
    }

    let lastInitWidth = 0;
    let lastInitHeight = 0;

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      sphereRadius = Math.min(w, h) * (w < 760 ? 0.5 : 0.47);
      sphereCenterY = w < 760 ? 0.34 : 0.51;
      configureDensity();

      const widthChanged = w !== lastInitWidth;
      const heightChanged = Math.abs(h - lastInitHeight) > lastInitHeight * 0.15;
      if (widthChanged || heightChanged || particles.length === 0) {
        lastInitWidth = w;
        lastInitHeight = h;
        init();
      }
    }

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    function rgba(c: RGB, alpha: number, ro = 0, go = 0, bo = 0) {
      // Offsets brighten toward white for the additive dark render; on the
      // light paper they would wash contrast out, so skip them.
      if (!isDark) { ro = 0; go = 0; bo = 0; }
      const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
      return `rgba(${ch(c.r + ro)}, ${ch(c.g + go)}, ${ch(c.b + bo)}, ${alpha})`;
    }

    function currentColor(): RGB {
      transition += 0.0022;
      if (transition >= 1) {
        transition = 0;
        colorIndex = nextColorIndex;
        nextColorIndex = (nextColorIndex + 1) % PALETTES.length;
      }
      const from = PALETTES[colorIndex];
      const to = PALETTES[nextColorIndex];
      return {
        r: Math.round(lerp(from.r, to.r, transition)),
        g: Math.round(lerp(from.g, to.g, transition)),
        b: Math.round(lerp(from.b, to.b, transition)),
      };
    }

    function updateSpin() {
      if (prefersReduced) return;
      if (performance.now() > nextSpinShift) {
        targetRotationX = (Math.random() - 0.5) * 0.006;
        targetRotationY = (Math.random() - 0.5) * 0.006;
        targetRotationZ = (Math.random() - 0.5) * 0.0032;
        nextSpinShift = performance.now() + 1500 + Math.random() * 2600;
      }
      rotationX += (targetRotationX - rotationX) * 0.018;
      rotationY += (targetRotationY - rotationY) * 0.018;
      rotationZ += (targetRotationZ - rotationZ) * 0.018;
    }

    let raf = 0;

    function drawScene() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const color = currentColor();
      updateSpin();
      const ctx2 = ctx!;

      ctx2.clearRect(0, 0, width, height);
      ctx2.fillStyle = isDark ? "rgba(3, 2, 10, 0.28)" : "rgba(238, 244, 248, 0.28)";
      ctx2.fillRect(0, 0, width, height);

      // Drive the orb glow from the cycling color.
      orbGlow!.style.background = `radial-gradient(circle, rgba(${color.r}, ${color.g}, ${color.b}, ${isDark ? 0.3 : 0.14}) 0%, rgba(${color.r}, ${color.g}, ${color.b}, ${isDark ? 0.13 : 0.06}) 32%, transparent 66%)`;

      particles.forEach((p) => {
        p.rotate();
        p.project(width, height);
      });

      ctx2.save();
      // Additive blending glows on the void but washes out on light paper.
      ctx2.globalCompositeOperation = isDark ? "lighter" : "source-over";

      const max2 = MAX_DISTANCE * MAX_DISTANCE;
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p1.x3d - p2.x3d;
          if (dx > MAX_DISTANCE || dx < -MAX_DISTANCE) continue;
          const dy = p1.y3d - p2.y3d;
          const dz = p1.z3d - p2.z3d;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < max2) {
            const depth = Math.min(1.4, (p1.scale + p2.scale) * 0.75);
            const alpha = (1 - Math.sqrt(d2) / MAX_DISTANCE) * depth * 0.33;
            ctx2.beginPath();
            ctx2.moveTo(p1.x, p1.y);
            ctx2.lineTo(p2.x, p2.y);
            ctx2.strokeStyle = rgba(color, alpha, 35, 28, 20);
            ctx2.lineWidth = p1.core && p2.core ? 0.42 : 0.72;
            ctx2.stroke();
          }
        }
      }

      particles.forEach((p) => {
        const flicker = 0.65 + Math.sin(p.pulse) * 0.35;
        const size = p.baseSize * p.scale * flicker;
        const centerBias =
          Math.abs(p.x3d) + Math.abs(p.y3d) < sphereRadius * 0.42;
        const alpha = p.core || centerBias ? 0.72 : 0.54;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx2.fillStyle = centerBias
          ? (isDark ? `rgba(255, 252, 255, ${alpha})` : `rgba(11, 36, 52, ${alpha})`)
          : rgba(color, alpha, 52, 42, 34);
        ctx2.fill();
        if (size > 1.35) {
          ctx2.beginPath();
          ctx2.arc(p.x, p.y, size * 3.2, 0, Math.PI * 2);
          ctx2.fillStyle = rgba(color, p.core ? 0.055 : 0.1);
          ctx2.fill();
        }
      });

      const haloY = height * (sphereCenterY + 0.01);
      const halo = ctx2.createRadialGradient(
        width / 2,
        haloY,
        0,
        width / 2,
        haloY,
        sphereRadius * 1.05,
      );
      halo.addColorStop(0, rgba(color, 0.16, 30, 20, 10));
      halo.addColorStop(0.42, rgba(color, 0.055));
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx2.fillStyle = halo;
      ctx2.fillRect(0, 0, width, height);

      ctx2.restore();
      raf = requestAnimationFrame(drawScene);
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize, { passive: true });

    resize();
    if (prefersReduced) {
      // One static frame, no spin loop.
      const w = window.innerWidth;
      const h = window.innerHeight;
      particles.forEach((p) => p.project(w, h));
      drawScene();
      cancelAnimationFrame(raf);
    } else {
      drawScene();
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [variant, isDark]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity: variant === "subtle" ? 0.4 : 1 }}
      aria-hidden
    >
      {/* Starfield */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, light-dark(rgba(20,70,110,0.35), rgba(201,231,255,0.45)) 0 1px, transparent 1.5px), radial-gradient(circle, light-dark(rgba(10,126,164,0.25), rgba(111,201,255,0.28)) 0 1px, transparent 1.3px)",
          backgroundPosition: "7% 11%, 68% 19%",
          backgroundSize: "171px 179px, 263px 211px",
          opacity: 0.22,
        }}
      />
      {/* Orb glow behind the sphere (color driven by the loop) */}
      <div
        ref={orbRef}
        className="absolute left-1/2 top-1/2 aspect-square w-[min(78vw,960px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ filter: "blur(18px)", opacity: 0.9 }}
      />
      {/* Neural sphere */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ filter: "saturate(1.15) contrast(1.06)" }}
      />
      {/* Perspective grid floor */}
      <div
        className="absolute bottom-[-7vh] left-[-8vw] right-[-8vw] h-[23vh]"
        style={{
          transform: "perspective(390px) rotateX(65deg)",
          transformOrigin: "bottom center",
          backgroundImage:
            "linear-gradient(light-dark(rgba(10,110,160,0.22), rgba(57,200,255,0.26)) 1px, transparent 1px), linear-gradient(90deg, light-dark(rgba(10,110,160,0.18), rgba(57,200,255,0.22)) 1px, transparent 1px)",
          backgroundSize: "44px 27px",
          borderTop: "1px solid light-dark(rgba(10,110,160,0.32), rgba(80,210,255,0.36))",
          boxShadow: "0 -20px 46px color-mix(in srgb, var(--hud-cyan) 12%, transparent)",
          opacity: 0.72,
        }}
      />
    </div>
  );
}
