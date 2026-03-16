import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: 'linear-gradient(145deg, #12122a 0%, #0a0a16 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {/* Subtle glow behind star */}
      <div
        style={{
          position: 'absolute',
          width: 100,
          height: 100,
          borderRadius: 50,
          background: 'radial-gradient(circle, rgba(120,180,255,0.18) 0%, transparent 70%)',
        }}
      />
      <svg width="96" height="96" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 1L10.3 7.2L16.5 9L10.3 10.8L9 17L7.7 10.8L1.5 9L7.7 7.2L9 1Z"
          fill="#78b4ff"
          stroke="#aed4ff"
          strokeWidth="0.35"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    { ...size },
  );
}
