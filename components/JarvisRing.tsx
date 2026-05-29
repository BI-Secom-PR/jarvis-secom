"use client";

import { useEffect, useRef } from "react";

// HUD energy ring rendered on canvas: segmented rotating rings, tick marks,
// orbiting dots, a pulsing core, and drifting energy particles.
const CYAN = (a: number) => `rgba(120,180,255,${a})`;
const MAGENTA = (a: number) => `rgba(255,80,120,${a})`;
const PURPLE = (a: number) => `rgba(160,90,255,${a})`;
const PALETTE = [CYAN, MAGENTA, PURPLE];

type Particle = { angle: number; r: number; speed: number; alpha: number; color: (a: number) => string };

export default function JarvisRing({ size = 180 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const c = size / 2; // center in CSS px
    const R = c - 4; // outer radius with a little padding for glow

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Orbiting dots
    const DOT_COUNT = 12;
    const dots = Array.from({ length: DOT_COUNT }, (_, i) => ({
      angle: (i / DOT_COUNT) * Math.PI * 2,
      r: R * (0.55 + (i % 3) * 0.18),
      speed: 0.012 + (i % 4) * 0.006 * (i % 2 ? -1 : 1),
      color: PALETTE[i % PALETTE.length],
    }));

    // Energy particles drifting outward
    const particles: Particle[] = Array.from({ length: 70 }, () => spawn());
    function spawn(): Particle {
      return {
        angle: Math.random() * Math.PI * 2,
        r: R * (0.7 + Math.random() * 0.2),
        speed: 0.15 + Math.random() * 0.4,
        alpha: 0.5 + Math.random() * 0.5,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      };
    }

    let t = 0;
    let raf = 0;

    function ring(rad: number, lineWidth: number, color: (a: number) => string, rot: number, segments: number, gap: number) {
      const ctx2 = ctx!;
      ctx2.lineWidth = lineWidth;
      ctx2.strokeStyle = color(0.85);
      ctx2.shadowBlur = 8;
      ctx2.shadowColor = color(0.9);
      const seg = (Math.PI * 2) / segments;
      for (let i = 0; i < segments; i++) {
        ctx2.beginPath();
        ctx2.arc(0, 0, rad, rot + i * seg + gap, rot + (i + 1) * seg - gap);
        ctx2.stroke();
      }
    }

    function draw() {
      const ctx2 = ctx!;
      ctx2.setTransform(dpr, 0, 0, dpr, c * dpr, c * dpr);
      ctx2.clearRect(-c, -c, size, size);

      // Outer segmented ring — cyan, clockwise slow
      ring(R, 1.5, CYAN, t * 0.4, 5, 0.18);

      // Mid tick marks — magenta/red, counter-clockwise
      ctx2.lineWidth = 1.2;
      ctx2.strokeStyle = MAGENTA(0.8);
      ctx2.shadowBlur = 6;
      ctx2.shadowColor = MAGENTA(0.9);
      const ticks = 24;
      const midR = R * 0.78;
      for (let i = 0; i < ticks; i++) {
        const a = -t * 0.55 + (i / ticks) * Math.PI * 2;
        const inner = midR - 2.5;
        const outer = midR + 2.5;
        ctx2.beginPath();
        ctx2.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx2.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx2.stroke();
      }

      // Inner ring — purple, clockwise faster, one gap
      ring(R * 0.55, 1.5, PURPLE, t * 0.9, 1, 0.5);

      // Orbiting dots
      ctx2.shadowBlur = 8;
      for (const d of dots) {
        d.angle += d.speed;
        const x = Math.cos(d.angle) * d.r;
        const y = Math.sin(d.angle) * d.r;
        ctx2.fillStyle = d.color(0.95);
        ctx2.shadowColor = d.color(1);
        ctx2.beginPath();
        ctx2.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx2.fill();
      }

      // Energy particles drifting outward + fading
      for (const p of particles) {
        p.r += p.speed;
        p.alpha -= 0.012;
        if (p.alpha <= 0 || p.r > R + 6) Object.assign(p, spawn(), { r: R * 0.7, alpha: 0.7 });
        const x = Math.cos(p.angle) * p.r;
        const y = Math.sin(p.angle) * p.r;
        ctx2.fillStyle = p.color(Math.max(p.alpha, 0));
        ctx2.shadowBlur = 4;
        ctx2.shadowColor = p.color(p.alpha);
        ctx2.beginPath();
        ctx2.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx2.fill();
      }

      // Glowing core — pulsing radial gradient + bright center dot
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      const coreR = R * (0.32 + pulse * 0.06);
      const grad = ctx2.createRadialGradient(0, 0, 0, 0, 0, coreR);
      grad.addColorStop(0, CYAN(0.5 + pulse * 0.3));
      grad.addColorStop(0.6, CYAN(0.12));
      grad.addColorStop(1, CYAN(0));
      ctx2.shadowBlur = 0;
      ctx2.fillStyle = grad;
      ctx2.beginPath();
      ctx2.arc(0, 0, coreR, 0, Math.PI * 2);
      ctx2.fill();

      ctx2.fillStyle = CYAN(0.85);
      ctx2.shadowBlur = 10;
      ctx2.shadowColor = CYAN(1);
      ctx2.beginPath();
      ctx2.arc(0, 0, 2.4, 0, Math.PI * 2);
      ctx2.fill();
    }

    if (reduced) {
      draw();
      return;
    }

    const loop = () => {
      t += 0.016;
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} />;
}
